import {
  fetchFinancialLawGuidance,
  FinancialLawClientError,
  FinancialLawTopic,
  type FinancialLawGuidance,
} from "@/lib/legal/financial-law";
import {
  readFinancialLawGuidanceCache,
  writeFinancialLawGuidanceCache,
} from "@/lib/legal/financial-law-cache";
import { requireSameOrigin } from "@/lib/auth/http";
import { runtimeSecret } from "@/lib/runtime-settings";
import { characterBodyLimits, readBoundedRequestText, requestBodyErrorResponse } from "@/lib/http/request-body";

const MAX_BODY_CHARS = 2_000;
const TOPICS: Record<string, FinancialLawTopic> = {
  financial_consumer: FinancialLawTopic.FinancialConsumerProtection,
  electronic_finance: FinancialLawTopic.ElectronicFinance,
  credit_information: FinancialLawTopic.CreditInformation,
  voice_phishing: FinancialLawTopic.VoicePhishingRecovery,
  deposit_protection: FinancialLawTopic.DepositorProtection,
  debt_collection: FinancialLawTopic.FairDebtCollection,
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function displayDate(value: string) {
  return /^\d{8}$/u.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value;
}

function publicResponse(
  guidance: FinancialLawGuidance,
  topic: keyof typeof TOPICS,
  stale = false,
) {
  return {
    status: stale ? "stale" as const : "verified" as const,
    topic,
    retrievedAt: guidance.law.retrievedAt,
    laws: [{
      id: `law-${guidance.law.lawId}-${guidance.law.effectiveDate}`,
      name: guidance.law.lawName,
      ministry: guidance.law.ministry ?? "소관부처 미제공",
      effectiveDate: displayDate(guidance.law.effectiveDate),
      retrievedAt: guidance.law.retrievedAt,
      sourceUrl: guidance.law.sourceUrl,
      articles: guidance.articles.map((article) => ({
        id: article.sourceId,
        articleNumber: `제${article.articleNumber}조`,
        title: article.articleTitle,
        text: article.text.slice(0, 1_200),
      })),
    }],
  };
}

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return json({ error: "origin_mismatch" }, 403);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    !== "application/json") return json({ error: "json_content_type_required" }, 415);

  let raw: string;
  try {
    raw = await readBoundedRequestText(request, characterBodyLimits(MAX_BODY_CHARS));
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return json({ error: "invalid_request" }, 400);
  }
  if (raw.length > MAX_BODY_CHARS) return json({ error: "request_too_large" }, 413);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "invalid_request" }, 400);
  }
  const topicAlias = (body as Record<string, unknown>).topic;
  if (typeof topicAlias !== "string" || !(topicAlias in TOPICS)) {
    return json({ error: "unsupported_topic" }, 400);
  }
  const topic = TOPICS[topicAlias];

  // Resolve activation before reading cache: turning the integration OFF must
  // immediately stop legal guidance rather than continuing to serve old text.
  const oc = await runtimeSecret("LAW_OPEN_API_KEY").catch(() => null);
  if (!oc) return json({ error: "law_api_not_configured" }, 503);

  const cached = await readFinancialLawGuidanceCache(topic).catch(() => null);
  if (cached?.fresh) return json(publicResponse(cached.guidance, topicAlias, false));

  try {
    const guidance = await fetchFinancialLawGuidance({ oc, topic });
    await writeFinancialLawGuidanceCache(guidance).catch(() => undefined);
    return json(publicResponse(guidance, topicAlias, false));
  } catch (error) {
    if (cached) return json(publicResponse(cached.guidance, topicAlias, true));
    const status = error instanceof FinancialLawClientError
      && (error.status === 401 || error.status === 403)
      ? 503
      : 502;
    return json({ error: status === 503 ? "law_api_authorization_pending" : "law_api_unavailable" }, status);
  }
}
