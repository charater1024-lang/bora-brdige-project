import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const stateKey = Symbol.for("bora.rag.post-route.synthetic-test");
const previousState = globalThis[stateKey];
const previousFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new Error("rag_route_test_network_forbidden");
};

function publicDocument(id, excerpt = "월 최대 20만 원을 지원한다. 조건은 공고 원문에서 확인한다.") {
  return {
    id,
    category: "youth",
    title: `합성 지원자료 ${id}`,
    excerpt,
    sourceUrl: `https://public.example/${id.replaceAll(":", "/")}`,
    publisher: "합성 테스트 자료",
    publishedAt: null,
    verifiedAt: "2026-08-29T00:00:00Z",
    expiresAt: null,
    regionScope: "nationwide",
    regions: [],
    kind: "notice",
  };
}

function createState() {
  const document = publicDocument("public:policy-a");
  return {
    calls: [],
    user: { id: "synthetic-test-user" },
    sameOrigin: true,
    rateLimit: { allowed: true, retryAfterSeconds: 0 },
    selected: { provider: "local", model: "synthetic-test-model", billingRisk: false, env: {} },
    preferences: { memoryEnabled: false, conversationContextEnabled: false, recentActivityEnabled: false },
    recentContext: { text: "", historicalMessages: [], activityCount: 0, conversationCount: 0 },
    knowledgeHits: [],
    publicSearch: { status: "ready", hits: [{ document, score: 10 }], candidateCount: 1, elapsedMs: 0, method: "synthetic-test-catalog" },
    dashboard: { cached: false, stale: false, categories: [], lastSuccessfulAt: null },
    legalTopic: null,
    legalKey: null,
    manualFinanceContext: null,
    answer: "공고 원문의 조건을 확인하세요. [public:policy-a]",
    demo: false,
    providerError: undefined,
  };
}

let state = createState();
function resetState() {
  state = createState();
  return state;
}

function calls(name) {
  return state.calls.filter((entry) => entry.name === name);
}

globalThis[stateKey] = {
  invoke(name, args) {
    state.calls.push({ name, args });
    switch (name) {
      case "authenticatedUser": return state.user;
      case "requireSameOrigin": return state.sameOrigin;
      case "requireCurrentRequiredConsent": return undefined;
      case "claimAiRequestRateLimit": return state.rateLimit;
      case "selectedAiRuntime": return state.selected;
      case "getAiContextPreferences": return state.preferences;
      case "getRecentAiContext": return structuredClone(state.recentContext);
      case "getAiUserMemories": return [];
      case "classifyAiTopic": return "synthetic-test-topic";
      case "recordAiChatEvent": return true;
      case "recordAiUserMemory": return true;
      case "recordAiConversationContext": return true;
      case "getManualFinanceAiContext": return state.manualFinanceContext;
      case "searchKnowledge": return structuredClone(state.knowledgeHits);
      case "searchPublicCatalogEvidence": return structuredClone(state.publicSearch);
      case "getPublicDashboard": return structuredClone(state.dashboard);
      case "detectFinancialLegalIntent": return state.legalTopic;
      case "runtimeSecret": return state.legalKey;
      case "readFinancialLawGuidanceCache": return null;
      case "writeFinancialLawGuidanceCache": return undefined;
      case "publicItemRagDocument": return null;
      case "publicCatalogRequested": return false;
      case "fetchFinancialLawGuidance": throw new Error("unexpected_law_fetch_in_synthetic_route_test");
      case "formatFinancialLawGroundingSources": return [];
      case "generateAICompletion": return {
        provider: args[0].provider,
        model: args[0].model,
        content: state.answer,
        demo: state.demo,
        demoReason: state.demo ? "provider_error" : undefined,
        providerError: state.providerError,
        usage: { promptTokens: 0, completionTokens: 0 },
      };
      default: throw new Error(`unhandled_rag_route_mock:${name}`);
    }
  },
};

// Keep the actual POST handler, query resolver, evidence packer, and grounding
// inspector. Only external state/provider boundaries are replaced by spies.
const mockModules = {
  "lib/ai/providers": ["generateAICompletion"],
  "lib/rag/knowledge": ["searchKnowledge"],
  "lib/auth/current-user": ["authenticatedUser"],
  "lib/auth/http": ["requireSameOrigin"],
  "lib/auth/account-lifecycle": ["requireCurrentRequiredConsent"],
  "lib/ai/history": ["classifyAiTopic", "getAiUserMemories", "recordAiChatEvent", "recordAiUserMemory"],
  "lib/ai/context-store": ["getAiContextPreferences", "getRecentAiContext", "recordAiConversationContext"],
  "lib/ai/rate-limit": ["claimAiRequestRateLimit"],
  "lib/ai/selected-runtime": ["selectedAiRuntime"],
  "lib/legal/financial-law": ["detectFinancialLegalIntent", "fetchFinancialLawGuidance", "formatFinancialLawGroundingSources"],
  "lib/legal/financial-law-cache": ["readFinancialLawGuidanceCache", "writeFinancialLawGuidanceCache"],
  "lib/manual-finance-store": ["getManualFinanceAiContext"],
  "lib/runtime-settings": ["runtimeSecret"],
  "lib/public-data/service": ["getPublicDashboard"],
  "lib/rag/public-catalog": ["searchPublicCatalogEvidence", "publicItemRagDocument", "publicCatalogRequested"],
};

function moduleKey(source) {
  const normalized = source.replaceAll("\\", "/").replace(/\.(?:ts|js)$/u, "");
  return Object.keys(mockModules).find((key) => normalized === key || normalized.endsWith(`/${key}`)) ?? null;
}

const loadedMocks = new Set();
const synchronousMocks = new Set(["searchKnowledge", "classifyAiTopic", "detectFinancialLegalIntent", "formatFinancialLawGroundingSources", "publicItemRagDocument", "publicCatalogRequested"]);

const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": projectRoot } },
  plugins: [{
    name: "synthetic-rag-route-state-boundaries",
    enforce: "pre",
    resolveId(source) {
      const key = moduleKey(source);
      return key && Object.hasOwn(mockModules, key) ? `\0rag-route-mock:${key}` : null;
    },
    load(id) {
      if (!id.startsWith("\0rag-route-mock:")) return null;
      const key = id.slice("\0rag-route-mock:".length);
      loadedMocks.add(key);
      const functions = mockModules[key].map((name) => `export const ${name} = ${synchronousMocks.has(name) ? "" : "async "}(...args) => globalThis[Symbol.for("bora.rag.post-route.synthetic-test")].invoke("${name}", args);`).join("\n");
      const extra = key === "lib/auth/account-lifecycle"
        ? "export class AccountLifecycleError extends Error { constructor(code) { super(code); this.code = code; } }"
        : key === "lib/ai/context-store"
          ? 'export { sanitizeConversationContext } from "/lib/ai/context-policy.ts";'
          : "";
      return `${functions}\n${extra}`;
    },
  }],
  server: { middlewareMode: true },
});
let POST;
try {
  ({ POST } = await server.ssrLoadModule("/app/api/ai/route.ts"));
  for (const key of Object.keys(mockModules)) assert.ok(loadedMocks.has(key), `${key} must be mocked before handler tests`);
} catch (error) {
  await server.close();
  globalThis.fetch = previousFetch;
  if (previousState === undefined) delete globalThis[stateKey];
  else globalThis[stateKey] = previousState;
  throw error;
}

test.after(async () => {
  try {
    await server.close();
    assert.equal(networkAttempts, 0, "no request may reach an external network function");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousState === undefined) delete globalThis[stateKey];
    else globalThis[stateKey] = previousState;
  }
});

async function post(body) {
  const response = await POST(new Request("https://borabridge.example/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://borabridge.example" },
    body: JSON.stringify(body),
  }));
  return { response, body: await response.json() };
}

test("the observed greeting and capability request uses the fixed multilingual guide without provider, RAG, context, or history work", async () => {
  resetState();
  const result = await post({
    message: "안녕하세요. 오늘 이용할 수 있는 기능을 간단히 알려줘.",
    locale: "ko",
    useRag: true,
    memoryConsent: true,
    conversationContextConsent: true,
    recentActivityConsent: true,
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.answerMode, "product-guide");
  assert.equal(result.body.provider, "built-in");
  assert.equal(result.body.model, null);
  assert.equal(result.body.demo, false);
  assert.equal(result.body.billableCall, false);
  assert.equal(result.body.billableCallAttempted, false);
  assert.equal(result.body.retrieval.status, "not-needed");
  assert.equal(result.body.retrieval.method, "built-in-product-guide");
  assert.equal(result.body.grounding.status, "not-checked");
  assert.deepEqual(result.body.sources, []);
  assert.match(result.body.answer, /자산·현금흐름/u);
  assert.match(result.body.answer, /청년 정책/u);
  assert.match(result.body.answer, /양방향/u);
  assert.doesNotMatch(result.body.answer, /지급정지|1394|피싱 상담/u);
  assert.deepEqual(state.calls.map((entry) => entry.name), [
    "authenticatedUser",
    "requireCurrentRequiredConsent",
    "requireSameOrigin",
    "claimAiRequestRateLimit",
  ]);
});

test("a greeting prefixed financial question still follows the evidence path", async () => {
  resetState();
  const result = await post({ message: "안녕하세요. 현재 예금 금리가 얼마인지 알려줘.", locale: "ko" });
  assert.equal(result.response.status, 200);
  assert.notEqual(result.body.answerMode, "product-guide");
  assert.equal(calls("selectedAiRuntime").length, 1);
  assert.equal(calls("searchPublicCatalogEvidence").length, 1);
  assert.equal(calls("generateAICompletion").length, 1);
});

test("runtime fallback exposes only safe availability codes and keeps the answer contract", async () => {
  for (const code of ["model_warming", "local_inference_busy", "local_inference_timeout", "unexpected-private-detail"]) {
    resetState();
    state.demo = true;
    state.providerError = code;
    const result = await post({ message: "안녕하세요. 현재 예금 금리가 얼마인지 알려줘.", locale: "ko" });
    assert.equal(result.response.status, 200, code);
    assert.equal(result.body.demo, true, code);
    assert.equal(result.body.answerMode, "provider-fallback", code);
    assert.equal(result.body.providerError, code === "unexpected-private-detail" ? null : code);
    assert.equal(typeof result.body.answer, "string");
    assert.ok(result.body.answer.length > 0);
    assert.equal(calls("generateAICompletion").length, 1, "no automatic provider retry");
    assert.doesNotMatch(JSON.stringify(result.body), /unexpected-private-detail/);
  }
});

test("regional and eligibility service questions are never diverted to the product guide", async () => {
  for (const message of [
    "서울 청년이 이용할 수 있는 금융지원 서비스 알려줘.",
    "외국인이 이용할 수 있는 정착 서비스 알려줘.",
    "고용24에서 이용할 수 있는 서비스 알려줘.",
  ]) {
    resetState();
    const result = await post({ message, locale: "ko" });
    assert.equal(result.response.status, 200, message);
    assert.notEqual(result.body.answerMode, "product-guide", message);
    assert.equal(calls("selectedAiRuntime").length, 1, message);
    assert.equal(calls("searchPublicCatalogEvidence").length, 1, message);
  }
});

test("a catalogue no-match returns rules without calling a model, even when generic knowledge matches", async () => {
  resetState();
  state.publicSearch = { ...state.publicSearch, status: "no-match", hits: [], candidateCount: 0 };
  state.knowledgeHits = [{ document: {
    id: "generic-guide", title: "일반 안내", content: "지원사업 원문을 확인한다.", keywords: [],
    source: { publisher: "합성", title: "일반 안내", url: "https://public.example/guide", reviewedAt: "2026-08-29" },
  }, score: 1 }];
  const result = await post({ message: "대전 청년 월세 지원 공고만 확인하고 싶어요." });
  assert.equal(result.response.status, 200);
  assert.match(result.response.headers.get("cache-control"), /no-store/u);
  assert.equal(result.body.answerMode, "rules");
  assert.equal(result.body.retrieval.status, "no-match");
  assert.equal(result.body.billableCallAttempted, false);
  assert.deepEqual(result.body.sources, []);
  assert.equal(calls("generateAICompletion").length, 0);
  assert.equal(calls("recordAiChatEvent").length, 0);
});

test("unavailable catalogue evidence is not disguised as no-match and never calls the model", async () => {
  resetState();
  state.publicSearch = { ...state.publicSearch, status: "unavailable", hits: [], candidateCount: 0 };
  const result = await post({ message: "서울 청년 월세 지원 공고를 알려 주세요." });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.answerMode, "rules");
  assert.equal(result.body.retrieval.status, "unavailable");
  assert.equal(result.body.billableCall, false);
  assert.equal(result.body.billableCallAttempted, false);
  assert.equal(calls("generateAICompletion").length, 0);
});

test("unknown citations in a provider response are replaced with retrieved excerpts", async () => {
  resetState();
  state.answer = "신청이 승인됐습니다. [invented-source]";
  const result = await post({ message: "서울 청년 지원 안내를 확인해 주세요." });
  assert.equal(calls("generateAICompletion").length, 1);
  assert.equal(result.body.answerMode, "rules");
  assert.equal(result.body.grounding.status, "excerpt-fallback");
  assert.equal(result.body.grounding.semanticEntailmentVerified, false);
  assert.doesNotMatch(result.body.answer, /신청이 승인|invented-source/u);
  assert.match(result.body.answer, /20만 원/u);
  assert.deepEqual(result.body.sources.map((source) => source.id), ["public:policy-a"]);
});

test("financial and public-policy intent cannot disable evidence retrieval with useRag false", async () => {
  resetState();
  const result = await post({
    message: "서울 청년 금융 지원 공고를 알려 주세요.",
    useRag: false,
  });
  assert.equal(result.response.status, 200);
  assert.equal(calls("searchPublicCatalogEvidence").length, 1);
  assert.equal(calls("generateAICompletion").length, 1);
  assert.deepEqual(result.body.sources.map((source) => source.id), ["public:policy-a"]);
});

test("an invented amount with a valid citation triggers the actual POST fallback", async () => {
  resetState();
  state.answer = "월 30만 원을 지원합니다. [public:policy-a]";
  const result = await post({ message: "서울 청년 지원 금액을 알려 주세요." });
  assert.equal(calls("generateAICompletion").length, 1);
  assert.equal(result.body.answerMode, "rules");
  assert.equal(result.body.grounding.status, "excerpt-fallback");
  assert.doesNotMatch(result.body.answer, /30만/u);
  assert.match(result.body.answer, /20만 원/u);
});

test("a metadata-only review date cannot validate a fabricated application deadline", async () => {
  resetState();
  const document = publicDocument("public:policy-a", "지원 조건은 공고 원문을 확인해야 한다. 신청 마감일은 제공되지 않았다.");
  document.verifiedAt = "2026-08-29T00:00:00Z";
  state.publicSearch.hits = [{ document, score: 10 }];
  state.answer = "신청 마감일은 2026-08-29입니다. [public:policy-a]";
  const result = await post({ message: "서울 청년 지원 공고의 신청 마감일이 언제인가요?" });
  assert.equal(calls("generateAICompletion").length, 1);
  assert.equal(result.body.answerMode, "rules");
  assert.equal(result.body.grounding.status, "excerpt-fallback");
  assert.doesNotMatch(result.body.answer, /2026-08-29/u);
});

test("a successful model answer exposes only sources it actually cites", async () => {
  resetState();
  state.publicSearch.hits.push({ document: publicDocument("public:policy-b", "임대차계약서와 신청서가 필요하다."), score: 9 });
  state.publicSearch.candidateCount = 2;
  state.answer = "임대차계약서와 신청서를 준비하세요. [public:policy-b]";
  const result = await post({ message: "청년 지원 공고의 서류를 알려 주세요." });
  assert.equal(result.body.answerMode, "model");
  assert.equal(result.body.grounding.status, "citation-value-checks-passed");
  assert.equal(result.body.contextMode, "stored-public-data");
  assert.equal(result.body.retrieval.sourceCount, 2);
  assert.equal(result.body.retrieval.usedSourceCount, 1);
  assert.deepEqual(result.body.sources.map((source) => source.id), ["public:policy-b"]);
});

test("a source omitted by the real context budget is not accepted as a valid citation", async () => {
  resetState();
  const oversized = publicDocument("public:too-long", "이 자료는 매우 긴 합성 문장이다. ".repeat(1000));
  const fitting = publicDocument("public:fits", "원문에서 신청 조건을 확인한다.");
  state.publicSearch.hits = [{ document: oversized, score: 10 }, { document: fitting, score: 9 }];
  state.publicSearch.candidateCount = 2;
  state.answer = "확인했습니다. [public:too-long]";
  const result = await post({ message: "청년 지원 공고의 조건을 알려 주세요." });
  assert.equal(result.body.answerMode, "rules");
  assert.equal(result.body.grounding.status, "excerpt-fallback");
  const completion = calls("generateAICompletion")[0].args[0];
  assert.doesNotMatch(JSON.stringify(completion.messages), /\[public:too-long\]/u);
  assert.deepEqual(result.body.sources.map((source) => source.id), ["public:fits"]);
});

test("an uncited response falls back when evidence was supplied", async () => {
  resetState();
  state.answer = "원문 조건을 확인하면 됩니다.";
  const result = await post({ message: "청년 지원 조건을 확인해 주세요." });
  assert.equal(result.body.answerMode, "rules");
  assert.equal(result.body.grounding.status, "excerpt-fallback");
  assert.match(result.body.answer, /\[public:policy-a\]/u);
});

test("follow-up history is sent to retrieval only for local runtime with both saved and request consent", async () => {
  for (const scenario of [
    { provider: "local", savedConsent: false, requestConsent: true },
    { provider: "local", savedConsent: true, requestConsent: false },
    { provider: "openai", savedConsent: true, requestConsent: true },
  ]) {
    resetState();
    state.selected.provider = scenario.provider;
    state.selected.billingRisk = scenario.provider !== "local";
    state.preferences.conversationContextEnabled = scenario.savedConsent;
    state.recentContext = {
      text: "STORED_PRIVATE_MARKER",
      historicalMessages: [{ role: "user", content: "[Historical user question]\n외국인 계좌개설 STORED_PRIVATE_MARKER" }],
      activityCount: 0,
      conversationCount: 1,
    };
    const result = await post({
      messages: [{ role: "user", content: "청년 자산형성 가입 조건 CLIENT_PRIVATE_MARKER" }, { role: "user", content: "필요한 서류는?" }],
      conversationContextConsent: scenario.requestConsent,
    });
    assert.equal(result.body.answerMode, "rules", JSON.stringify(scenario));
    assert.equal(result.body.retrieval.status, "context", JSON.stringify(scenario));
    assert.equal(result.body.conversationContextConsent, false);
    assert.equal(calls("getRecentAiContext").length, 0);
    assert.equal(calls("searchPublicCatalogEvidence").length, 0);
    assert.equal(calls("searchKnowledge").length, 0);
    assert.equal(calls("generateAICompletion").length, 0);
    if (scenario.provider !== "local") assert.equal(result.body.personalContextSuppressed, true);
  }
});

test("local opt-in stored context resolves the question before public and knowledge retrieval", async () => {
  resetState();
  state.preferences.conversationContextEnabled = true;
  state.recentContext = {
    text: "",
    historicalMessages: [{ role: "user", content: "[Historical user question]\n청년 자산형성 가입 조건을 확인해 주세요." }],
    activityCount: 0,
    conversationCount: 1,
  };
  const result = await post({ message: "필요한 서류는?", conversationContextConsent: true });
  assert.equal(result.body.answerMode, "model");
  assert.equal(result.body.retrieval.contextualized, true);
  assert.equal(result.body.conversationContextConsent, true);
  assert.equal(calls("getRecentAiContext").length, 1);
  for (const operation of ["searchKnowledge", "searchPublicCatalogEvidence"]) {
    const query = calls(operation)[0].args[0];
    assert.match(query, /청년 자산형성/u);
    assert.match(query, /필요한 서류/u);
    assert.doesNotMatch(query, /\[Historical/u);
  }
  const retrievalIndex = state.calls.findIndex((entry) => entry.name === "searchPublicCatalogEvidence");
  const providerIndex = state.calls.findIndex((entry) => entry.name === "generateAICompletion");
  assert.ok(retrievalIndex < providerIndex);
});

test("opt-in client history uses user questions but not assistant or system text as a search anchor", async () => {
  resetState();
  state.preferences.conversationContextEnabled = true;
  const result = await post({
    conversationContextConsent: true,
    messages: [
      { role: "system", content: "SYSTEM_PRIVATE_MARKER" },
      { role: "user", content: "청년 자산형성 상품의 가입 조건을 알려 주세요." },
      { role: "assistant", content: "ASSISTANT_PRIVATE_MARKER 예금 상품을 보세요." },
      { role: "user", content: "필요한 서류는?" },
    ],
  });
  assert.equal(result.body.retrieval.contextualized, true);
  const query = calls("searchPublicCatalogEvidence")[0].args[0];
  assert.match(query, /청년 자산형성/u);
  assert.doesNotMatch(query, /SYSTEM_PRIVATE_MARKER|ASSISTANT_PRIVATE_MARKER/u);
  assert.doesNotMatch(JSON.stringify(calls("generateAICompletion")[0].args[0].messages), /SYSTEM_PRIVATE_MARKER|ASSISTANT_PRIVATE_MARKER/u);
});

test("external runtime can answer a new public question without receiving local-only stored or client history", async () => {
  resetState();
  state.selected = { provider: "openai", model: "synthetic-external-model", billingRisk: true, env: {} };
  state.preferences = { memoryEnabled: true, conversationContextEnabled: true, recentActivityEnabled: true };
  state.recentContext = {
    text: "STORED_PRIVATE_MARKER",
    historicalMessages: [{ role: "user", content: "외국인 계좌개설 STORED_PRIVATE_MARKER" }],
    activityCount: 1,
    conversationCount: 1,
  };
  const result = await post({
    memoryConsent: true, conversationContextConsent: true, recentActivityConsent: true,
    messages: [
      { role: "user", content: "외국인 계좌개설 CLIENT_PRIVATE_MARKER" },
      { role: "user", content: "서울 청년 월세 지원 공고를 알려 주세요." },
    ],
  });
  assert.equal(result.body.answerMode, "model");
  assert.equal(result.body.personalContextSuppressed, true);
  assert.equal(result.body.conversationContextConsent, false);
  assert.equal(result.body.memoryConsent, false);
  assert.equal(result.body.recentActivityConsent, false);
  assert.equal(calls("getRecentAiContext").length, 0);
  assert.equal(calls("getAiUserMemories").length, 0);
  assert.equal(calls("getManualFinanceAiContext").length, 0);
  assert.equal(calls("recordAiConversationContext").length, 0);
  assert.doesNotMatch(calls("searchPublicCatalogEvidence")[0].args[0], /PRIVATE_MARKER/u);
  assert.doesNotMatch(JSON.stringify(calls("generateAICompletion")[0].args[0].messages), /PRIVATE_MARKER/u);
});

test("missing shared employment statistics return unavailable without calling a model", async () => {
  resetState();
  const result = await post({ message: "청년 고용률의 최근 공식 수치를 알려 주세요." });
  assert.equal(result.body.answerMode, "rules");
  assert.equal(result.body.retrieval.status, "unavailable");
  assert.equal(calls("getPublicDashboard").length, 1);
  assert.equal(calls("searchPublicCatalogEvidence").length, 0);
  assert.equal(calls("generateAICompletion").length, 0);
});

test("authentication and rate-limit rejection happen before retrieval or provider work", async () => {
  resetState();
  state.user = null;
  let result = await post({ message: "청년 지원을 알려 주세요." });
  assert.equal(result.response.status, 401);
  assert.deepEqual(state.calls.map((entry) => entry.name), ["authenticatedUser"]);

  resetState();
  state.rateLimit = { allowed: false, retryAfterSeconds: 30 };
  result = await post({ message: "청년 지원을 알려 주세요." });
  assert.equal(result.response.status, 429);
  assert.equal(result.response.headers.get("retry-after"), "30");
  for (const operation of ["getAiContextPreferences", "selectedAiRuntime", "searchKnowledge", "searchPublicCatalogEvidence", "generateAICompletion"]) {
    assert.equal(calls(operation).length, 0, operation);
  }
});

test("legal intent with no official basis configuration stops before any model or network work", async () => {
  resetState();
  state.legalTopic = "voice-phishing-recovery";
  const result = await post({ message: "보이스피싱 피해구제 법률을 설명해 주세요." });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.error, "official_legal_basis_not_configured");
  assert.equal(calls("fetchFinancialLawGuidance").length, 0);
  assert.equal(calls("generateAICompletion").length, 0);
  assert.equal(calls("searchPublicCatalogEvidence").length, 0);
});

test("short model citations resolve only to the exact evidence included in this request", async () => {
  resetState();
  state.answer = "월 최대 20만 원을 지원합니다. [S1]";
  let result = await post({ message: "청년 지원 금액을 알려 주세요." });
  assert.equal(result.body.answerMode, "model");
  assert.match(result.body.answer, /\[public:policy-a\]/u);
  assert.doesNotMatch(result.body.answer, /\[S1\]/u);
  assert.equal(result.body.grounding.numericChecksApplied, true);
  const sent = calls("generateAICompletion")[0].args[0].messages;
  assert.match(sent.at(-1).content, /\[S1\]/u);
  assert.doesNotMatch(sent[0].content, /월 최대 20만 원/u);
  state.answer = "월 최대 20만 원을 지원합니다. [S9]";
  result = await post({ message: "청년 지원 금액을 알려 주세요." });
  assert.equal(result.body.answerMode, "rules");
  assert.doesNotMatch(result.body.answer, /\[S9\]/u);
});

test("manual finance calculation exceptions are transparent and never disable public-evidence value checks", async () => {
  resetState();
  state.manualFinanceContext = "User-entered, unverified snapshot. incomeMonthly=300000 KRW.";
  state.publicSearch = { ...state.publicSearch, status: "not-requested", hits: [], candidateCount: 0 };
  state.knowledgeHits = [{ document: {
    id: "budget-guide", title: "예산 안내", content: "소득과 지출을 먼저 확인합니다.", keywords: [],
    source: { publisher: "합성 기관", url: "https://public.example/budget", reviewedAt: "2026-08-29" },
  }, score: 1 }];
  state.answer = "직접 입력한 월 소득 30만 원을 바탕으로 지출을 확인해 보세요. [S1]";
  let result = await post({ message: "내 자산과 월 소득을 분석해 줘." });
  assert.equal(result.body.manualFinanceApplied, true);
  assert.equal(result.body.grounding.status, "citation-only-checks-passed");
  assert.equal(result.body.grounding.numericChecksApplied, false);

  state.publicSearch = { ...state.publicSearch, status: "ready", hits: [{ document: publicDocument("public:policy-a"), score: 10 }] };
  state.answer = "내 월 소득이면 월 99만 원을 지원받습니다. [S1]";
  result = await post({ message: "내 월 소득으로 청년 지원금을 받을 수 있어?" });
  assert.equal(result.body.grounding.numericChecksApplied, true);
  assert.equal(result.body.answerMode, "rules");
  assert.doesNotMatch(result.body.answer, /99만/u);
});

test("disabled RAG never advertises citation and numeric validation as passed", async () => {
  resetState();
  state.answer = "무엇을 도와드릴까요?";
  const result = await post({ message: "안녕하세요", useRag: false });
  assert.equal(result.body.grounding.status, "not-checked");
  assert.equal(result.body.grounding.numericChecksApplied, false);
});
