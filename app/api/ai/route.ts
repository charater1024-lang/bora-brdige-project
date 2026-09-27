import {
  generateAICompletion,
  type AIMessage,
} from "@/lib/ai/providers";
import {
  searchKnowledge,
  type SupportedLocale,
} from "@/lib/rag/knowledge";
import {
  detectEmploymentStatisticsIntent,
} from "@/lib/rag/public-statistics";
import { authenticatedUser } from "@/lib/auth/current-user";
import { requireSameOrigin } from "@/lib/auth/http";
import { characterBodyLimits, readBoundedRequestText, requestBodyErrorResponse } from "@/lib/http/request-body";
import {
  AccountLifecycleError,
  requireCurrentRequiredConsent,
} from "@/lib/auth/account-lifecycle";
import {
  classifyAiTopic,
  getAiUserMemories,
  recordAiChatEvent,
  recordAiUserMemory,
} from "@/lib/ai/history";
import {
  getAiContextPreferences,
  getRecentAiContext,
  recordAiConversationContext,
  sanitizeConversationContext,
} from "@/lib/ai/context-store";
import { manualFinanceContextRequested } from "@/lib/ai/manual-finance-intent";
import { evidenceRequiredForAiQuery } from "@/lib/ai/evidence-intent";
import {
  productCapabilitiesReply,
  productCapabilitiesRequested,
} from "@/lib/ai/product-capabilities";
import { claimAiRequestRateLimit } from "@/lib/ai/rate-limit";
import { selectedAiRuntime } from "@/lib/ai/selected-runtime";
import {
  detectFinancialLegalIntent,
  fetchFinancialLawGuidance,
  formatFinancialLawGroundingSources,
  type FinancialLawGuidance,
} from "@/lib/legal/financial-law";
import {
  readFinancialLawGuidanceCache,
  writeFinancialLawGuidanceCache,
} from "@/lib/legal/financial-law-cache";
import { getManualFinanceAiContext } from "@/lib/manual-finance-store";
import { runtimeSecret } from "@/lib/runtime-settings";
import { getPublicDashboard } from "@/lib/public-data/service";
import { resolveRagQuery } from "@/lib/rag/query";
import {
  publicCatalogRequested,
  publicItemRagDocument,
  searchPublicCatalogEvidence,
} from "@/lib/rag/public-catalog";
import { publicIndicatorSources, publicIndicatorsRequested } from "@/lib/rag/indicators";
import { inspectAnswerGrounding } from "@/lib/rag/grounding";
import {
  buildBoundedRagMessages, evidenceFallback, ragClarification, ragSystemInstructions, restoreRagSourceIds,
  type RagEvidenceSource,
} from "@/lib/rag/context";

const MAX_BODY_CHARS = 120_000;
const MAX_MESSAGE_CHARS = 24_000;
const MAX_CONVERSATION_MESSAGES = 20;
const LOCALES = new Set<SupportedLocale>(["ko", "en", "ja", "zh"]);

interface AIRequestBody {
  locale?: unknown;
  message?: unknown;
  prompt?: unknown;
  messages?: unknown;
  useRag?: unknown;
  memoryConsent?: unknown;
  conversationContextConsent?: unknown;
  recentActivityConsent?: unknown;
  maxTokens?: unknown;
}

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function isJsonRequest(request: Request) {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    === "application/json";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function localeFrom(value: unknown): SupportedLocale {
  return typeof value === "string" && LOCALES.has(value as SupportedLocale)
    ? (value as SupportedLocale)
    : "ko";
}

function cleanText(value: unknown, limit = MAX_MESSAGE_CHARS) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function clientMessages(body: AIRequestBody): AIMessage[] {
  const messages: AIMessage[] = [];

  if (Array.isArray(body.messages)) {
    for (const raw of body.messages.slice(-MAX_CONVERSATION_MESSAGES)) {
      if (!isRecord(raw) || (raw.role !== "user" && raw.role !== "assistant")) continue;
      const content = cleanText(raw.content);
      if (content) messages.push({ role: raw.role, content });
    }
  }

  const singleMessage = cleanText(body.message) || cleanText(body.prompt);
  if (singleMessage && (!messages.length || messages.at(-1)?.content !== singleMessage)) {
    messages.push({ role: "user", content: singleMessage });
  }

  return messages.slice(-MAX_CONVERSATION_MESSAGES);
}

export async function POST(request: Request) {
  const user = await authenticatedUser(request).catch(() => null);
  if (!user) return json({ error: "authentication_required" }, 401);
  try {
    await requireCurrentRequiredConsent(user.id);
  } catch (error) {
    if (error instanceof AccountLifecycleError && error.code === "required_consent_missing") {
      return json({ error: error.code }, 428);
    }
    return json({ error: "account_consent_unavailable" }, 503);
  }
  // This endpoint can consume a paid model. Require an actual same-origin JSON
  // fetch so sibling subdomains and HTML forms cannot spend the user's quota.
  if (!(await requireSameOrigin(request))) return json({ error: "origin_mismatch" }, 403);
  if (!isJsonRequest(request)) return json({ error: "json_content_type_required" }, 415);

  let body: AIRequestBody;

  try {
    const raw = await readBoundedRequestText(request, characterBodyLimits(MAX_BODY_CHARS));
    if (raw.length > MAX_BODY_CHARS) {
      return json({ error: "Request body is too large." }, 413);
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return json({ error: "A JSON object is required." }, 400);
    body = parsed;
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return json({ error: "Invalid JSON body." }, 400);
  }

  const messages = clientMessages(body);
  if (!messages.length || !messages.some((message) => message.role === "user")) {
    return json({ error: "Provide a non-empty message, prompt, or user message." }, 400);
  }

  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (totalChars > MAX_MESSAGE_CHARS) {
    return json({ error: "Conversation text is too large." }, 413);
  }

  let rateLimit;
  try {
    rateLimit = await claimAiRequestRateLimit(user.id);
  } catch {
    // A missing or indeterminate counter must never fall through to a model.
    return json({ error: "ai_rate_limit_unavailable" }, 503);
  }
  if (!rateLimit.allowed) {
    return json(
      {
        error: "ai_rate_limit_exceeded",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  const locale = localeFrom(body.locale);
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")!.content;
  if (productCapabilitiesRequested(latestUserMessage)) {
    const personalContextSuppressed = body.memoryConsent === true
      || body.conversationContextConsent === true
      || body.recentActivityConsent === true;
    return json({
      answer: productCapabilitiesReply(locale),
      provider: "built-in",
      model: null,
      demo: false,
      answerMode: "product-guide",
      contextMode: "none",
      billableCall: false,
      billableCallAttempted: false,
      billingRisk: false,
      sources: [],
      topic: "other",
      historyStored: false,
      memoryStored: false,
      memoryApplied: 0,
      conversationContextStored: false,
      conversationContextApplied: 0,
      recentActivityApplied: 0,
      manualFinanceApplied: false,
      memoryConsent: false,
      conversationContextConsent: false,
      recentActivityConsent: false,
      personalContextPolicy: "local-only",
      personalContextSuppressed,
      retrieval: {
        status: "not-needed",
        method: "built-in-product-guide",
        contextualized: false,
        candidateCount: 0,
        sourceCount: 0,
        usedSourceCount: 0,
        elapsedMs: 0,
        estimatedInputTokens: 0,
        coverage: "not-applicable",
      },
      grounding: {
        status: "not-checked",
        numericChecksApplied: false,
        semanticEntailmentVerified: false,
      },
    });
  }
  const contextPreferences = await getAiContextPreferences(user.id).catch(() => null);
  const memoryContextRequested = body.memoryConsent === true
    && contextPreferences?.memoryEnabled === true;
  const conversationContextRequested = body.conversationContextConsent === true
    && contextPreferences?.conversationContextEnabled === true;
  const recentActivityRequested = body.recentActivityConsent === true
    && contextPreferences?.recentActivityEnabled === true;
  const selected = await selectedAiRuntime().catch(() => null);
  if (!selected) return json({ error: "ai_provider_not_enabled" }, 503);
  // Stored personal context must never be sent under Local-only consent to an external model.
  const personalContextAllowed = selected.provider === "local";
  const memoryConsent = personalContextAllowed && memoryContextRequested;
  const conversationContextConsent = personalContextAllowed && conversationContextRequested;
  const recentActivityConsent = personalContextAllowed && recentActivityRequested;
  const personalContextSuppressed = !personalContextAllowed
    && (memoryContextRequested || conversationContextRequested || recentActivityRequested);
  const recentContext = conversationContextConsent || recentActivityConsent
    ? await getRecentAiContext(user.id, {
      includeActivities: recentActivityConsent,
      includeConversations: conversationContextConsent,
    }).catch(() => ({ text: "Recent opt-in context is unavailable.", historicalMessages: [], activityCount: 0, conversationCount: 0 }))
    : { text: "", historicalMessages: [], activityCount: 0, conversationCount: 0 };
  const priorQuestions = conversationContextConsent ? [
    ...recentContext.historicalMessages.filter((message) => message.role === "user")
      .map((message) => message.content.replace(/^\[Historical[^\n]*\]\n/u, "")),
    ...messages.slice(0, -1).filter((message) => message.role === "user")
      .flatMap((message) => {
        const safe = sanitizeConversationContext({ question: message.content, answer: "Context only" });
        return safe ? [safe.userExcerpt] : [];
      }),
  ].slice(-3) : [];
  const resolved = resolveRagQuery(latestUserMessage, priorQuestions);
  const privacy = { memoryConsent, conversationContextConsent, recentActivityConsent,
    personalContextPolicy: "local-only", personalContextSuppressed };
  const fixedReply = (reason: "context" | "length" | "unavailable" | "no-match") => json({
    answer: ragClarification(locale, reason), answerMode: "rules", contextMode: "none",
    provider: selected.provider, model: selected.model, demo: false,
    billableCall: false, billableCallAttempted: false, billingRisk: selected.billingRisk,
    sources: [], historyStored: false, memoryStored: false, memoryApplied: 0,
    conversationContextStored: false, conversationContextApplied: 0, recentActivityApplied: 0,
    manualFinanceApplied: false, ...privacy,
    retrieval: { status: reason, contextualized: resolved.contextualized, sourceCount: 0 },
    grounding: { status: "not-checked" },
  });
  if (resolved.needsClarification) return fixedReply("context");

  const legalTopic = detectFinancialLegalIntent(resolved.query);
  const employmentIntent = detectEmploymentStatisticsIntent(resolved.query);
  const indicatorIntent = publicIndicatorsRequested(resolved.query);
  const catalogueIntent = publicCatalogRequested(resolved.query);
  const evidenceRequired = Boolean(legalTopic)
    || employmentIntent
    || indicatorIntent
    || catalogueIntent
    || evidenceRequiredForAiQuery(resolved.query);
  const useRag = evidenceRequired || body.useRag !== false;
  let legalGuidance: FinancialLawGuidance | null = null;
  let legalContextMode: "none" | "cached-official-law" | "live-official-law" = "none";
  if (legalTopic) {
    const oc = await runtimeSecret("LAW_OPEN_API_KEY").catch(() => null);
    if (!oc) return json({ error: "official_legal_basis_not_configured" }, 503);
    const cached = await readFinancialLawGuidanceCache(legalTopic).catch(() => null);
    if (cached?.fresh) {
      legalGuidance = cached.guidance;
      legalContextMode = "cached-official-law";
    } else {
      try {
        legalGuidance = await fetchFinancialLawGuidance({ oc, topic: legalTopic });
        legalContextMode = "live-official-law";
        await writeFinancialLawGuidanceCache(legalGuidance).catch(() => undefined);
      } catch {
        return json({ error: "official_legal_basis_unavailable" }, 503);
      }
    }
  }
  const knowledge = useRag ? searchKnowledge(resolved.query, 3) : [];
  const employmentStatisticsRequested = useRag && employmentIntent;
  const indicatorsRequested = useRag && indicatorIntent;
  const shouldSearchCatalogue = useRag && !legalGuidance && !employmentStatisticsRequested && !indicatorsRequested;
  const [publicSearch, publicDashboard] = await Promise.all([
    shouldSearchCatalogue ? searchPublicCatalogEvidence(resolved.query) : Promise.resolve(null),
    employmentStatisticsRequested || indicatorsRequested ? getPublicDashboard(user).catch(() => null) : Promise.resolve(null),
  ]);

  const evidence: RagEvidenceSource[] = [];
  if (legalGuidance) {
    evidence.push(...formatFinancialLawGroundingSources(legalGuidance, resolved.query).map((source) => ({
      ...source,
      excerpt: source.excerpt + (source.truncated ? "\n[일부 조문 발췌. 법령 전체가 아니며 다른 조건·예외는 원문 확인 필요.]" : ""),
      publishedAt: legalGuidance!.law.effectiveDate?.replace(/^(\d{4})(\d{2})(\d{2})$/u, "$1-$2-$3") ?? null,
      kind: "law" as const,
    })));
  } else {
    // Leave one evidence slot for principles when a current-offer question also
    // has useful educational guidance. The packer has a four-source ceiling.
    for (const hit of (publicSearch?.hits ?? []).slice(0, knowledge.length ? 3 : 4)) {
      const document = hit.document;
      evidence.push({
        id: document.id, title: document.title, excerpt: document.excerpt,
        publisher: document.publisher, url: document.sourceUrl,
        reviewedAt: document.verifiedAt?.slice(0, 10) ?? "",
        publishedAt: document.publishedAt, expiresAt: document.expiresAt, kind: "public-catalog",
      });
    }
    if (employmentStatisticsRequested && publicDashboard?.cached) {
      const requestedGroup = /외국인|foreign|外国人/iu.test(resolved.query) ? "foreigner"
        : /고령|노인|older|高齢|高龄/iu.test(resolved.query) ? "older-adult"
          : /청년|youth|若者|青年/iu.test(resolved.query) ? "youth" : null;
      for (const item of publicDashboard.categories.find((group) => group.id === "employment")?.items ?? []) {
        if (!item.employmentStatistic || requestedGroup && item.employmentStatistic.group !== requestedGroup) continue;
        const document = publicItemRagDocument(item);
        if (!document) continue;
        evidence.push({ id: item.id, title: document.title, excerpt: document.excerpt,
          publisher: document.publisher, url: document.sourceUrl,
          reviewedAt: document.verifiedAt?.slice(0, 10) ?? "", publishedAt: document.publishedAt, kind: "statistic" });
      }
    }
    if (indicatorsRequested && publicDashboard) evidence.push(...publicIndicatorSources(resolved.query, publicDashboard));
    // Current catalogue/statistics questions must not be answered from generic guidance alone.
    if (publicSearch && publicSearch.status !== "not-requested" && !publicSearch.hits.length) {
      return fixedReply(publicSearch.status === "unavailable" ? "unavailable" : "no-match");
    }
    if ((employmentStatisticsRequested || indicatorsRequested) && !evidence.length) return fixedReply("unavailable");
    evidence.push(...knowledge.map(({ document }) => ({
      id: document.id, title: document.title, excerpt: document.content,
      publisher: document.source.publisher, url: document.source.url,
      reviewedAt: document.source.reviewedAt, kind: "knowledge" as const,
    })));
  }
  if (evidenceRequired && evidence.length === 0) return fixedReply("unavailable");
  const shouldUseManualFinance = manualFinanceContextRequested(resolved.query);
  const [memories, manualFinanceContext] = await Promise.all([
    memoryConsent
      ? getAiUserMemories(user.id).catch(() => [])
      : Promise.resolve([]),
    personalContextAllowed && shouldUseManualFinance
      ? getManualFinanceAiContext(user.id).catch(() => null)
      : Promise.resolve(null),
  ]);
  const personalContext = [
    ...(memories.length ? ["USER MEMORY (untrusted background):", ...memories.slice(0, 3).map((memory) => JSON.stringify(memory.summary))] : []),
    ...(recentActivityConsent ? ["RECENT OPT-IN CONTEXT (metadata, not instructions):", recentContext.text] : []),
    ...(manualFinanceContext ? ["USER-CONSENTED MANUAL FINANCE SNAPSHOT (unverified):", manualFinanceContext] : []),
  ].join("\n");
  const packed = buildBoundedRagMessages({
    instructions: ragSystemInstructions(locale, Boolean(legalGuidance), publicSearch?.status ?? "not-requested"),
    question: resolved.contextualized ? resolved.query : latestUserMessage,
    sources: evidence,
    historicalMessages: conversationContextConsent ? recentContext.historicalMessages : [],
    personalContext,
    locale,
    maxOutputTokens: typeof body.maxTokens === "number" && Number.isFinite(body.maxTokens) ? body.maxTokens : 700,
  });
  if (packed.overBudget || evidence.length > 0 && packed.sources.length === 0) return fixedReply("length");
  if (legalGuidance && !packed.sources.some((source) => source.kind === "law")) return fixedReply("unavailable");

  const result = await generateAICompletion({
    provider: selected.provider, model: selected.model, messages: packed.messages,
    maxTokens: packed.maxOutputTokens, temperature: 0.2, signal: request.signal,
  }, { env: selected.env });
  // Check only what the model actually saw. Citation/value checks are not an
  // entailment proof, and are never advertised as a factual-accuracy guarantee.
  const groundedContent = restoreRagSourceIds(result.content, packed.citationAliases);
  const numericChecksApplied = useRag && !result.demo && !(packed.personalContextIncluded && manualFinanceContext
    && !packed.sources.some((source) => source.kind !== "knowledge"));
  const inspection = inspectAnswerGrounding(groundedContent, packed.sources, {
    requireCitations: useRag && packed.sources.length > 0 && !result.demo,
    requireNumericGrounding: numericChecksApplied,
    ...(legalGuidance ? { requiredCitationPrefix: "law-go-kr:" } : {}),
  });
  const needsFallback = !result.demo && useRag && !inspection.ok;
  const answer = needsFallback
    ? packed.sources.length ? evidenceFallback(locale, packed.sources) : ragClarification(locale, "no-match")
    : groundedContent;
  const answerMode = needsFallback ? "rules" : result.demo
    ? result.demoReason === "provider_error" ? "provider-fallback" : "safe-demo" : "model";
  const usedIds = new Set(needsFallback ? packed.sources.slice(0, 3).map((source) => source.id) : inspection.citedSourceIds);
  const usedSources = result.demo ? [] : packed.sources.filter((source) => usedIds.has(source.id));
  const contextMode = legalContextMode !== "none" ? legalContextMode
    : usedSources.some((source) => source.kind === "public-catalog" || source.kind === "statistic" || source.kind === "indicator")
      ? "stored-public-data"
      : usedSources.some((source) => source.kind === "knowledge") ? "reviewed-knowledge" : "none";
  const topic = classifyAiTopic(latestUserMessage);
  const [historyResult, memoryResult, conversationContextResult] = await Promise.allSettled([
    recordAiChatEvent({ userId: user.id, topic, sourceCount: usedSources.length, locale }),
    !memoryConsent || legalGuidance
      ? Promise.resolve(false)
      : recordAiUserMemory({ userId: user.id, topic, message: latestUserMessage }),
    !conversationContextConsent || (answerMode !== "model" && answerMode !== "rules")
      ? Promise.resolve(false)
      : recordAiConversationContext({ userId: user.id, topic, question: latestUserMessage, answer }),
  ]);
  const historyStored = historyResult.status === "fulfilled";
  const memoryStored = memoryResult.status === "fulfilled" && memoryResult.value;
  const conversationContextStored = conversationContextResult.status === "fulfilled" && conversationContextResult.value;
  return json({
    answer, provider: result.provider, model: result.model, demo: result.demo, demoReason: result.demoReason,
    providerError: result.providerError === "model_warming" || result.providerError === "local_inference_busy" || result.providerError === "local_inference_timeout" ? result.providerError : null,
    answerMode, contextMode, warning: result.warning, usage: result.usage,
    billingRisk: selected.billingRisk, billableCall: selected.billingRisk && !result.demo,
    billableCallAttempted: selected.billingRisk && (!result.demo || result.demoReason === "provider_error"),
    topic, historyStored, memoryStored, conversationContextStored,
    memoryApplied: packed.personalContextIncluded ? memories.length : 0,
    conversationContextApplied: packed.historyIncluded || resolved.contextualized ? recentContext.conversationCount : 0,
    recentActivityApplied: packed.personalContextIncluded ? recentContext.activityCount : 0,
    manualFinanceApplied: packed.personalContextIncluded && Boolean(manualFinanceContext),
    ...privacy,
    sources: usedSources,
    retrieval: {
      status: publicSearch?.status ?? (packed.sources.length ? "ready" : "no-match"),
      method: publicSearch?.method ?? "reviewed-knowledge-and-official-sources",
      contextualized: resolved.contextualized, candidateCount: publicSearch?.candidateCount ?? evidence.length,
      sourceCount: packed.sources.length, usedSourceCount: usedSources.length,
      elapsedMs: publicSearch?.elapsedMs ?? 0, estimatedInputTokens: packed.estimatedInputTokens,
      coverage: "stored-catalog-only",
    },
    grounding: {
      status: result.demo || !useRag ? "not-checked" : needsFallback ? "excerpt-fallback"
        : numericChecksApplied ? "citation-value-checks-passed" : "citation-only-checks-passed",
      numericChecksApplied,
      semanticEntailmentVerified: false,
    },
  });
}
