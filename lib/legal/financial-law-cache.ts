import {
  FINANCIAL_LAW_RETRIEVAL_VERSION,
  FinancialLawTopic,
  type FinancialLawArticle,
  type FinancialLawGuidance,
} from "./financial-law";

const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const CACHE_STALE_LIMIT_MS = 7 * CACHE_TTL_MS;
const CACHE_PAYLOAD_MAX_BYTES = 180_000;

type CacheRow = {
  payload: string;
  retrievedAt: number;
  expiresAt: number;
};

let schemaReady: Promise<D1Database> | null = null;

async function database() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const { env } = await import("cloudflare:workers");
      if (!env.DB) throw new Error("financial_law_cache_unavailable");
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS financial_law_guidance_cache (
        topic TEXT PRIMARY KEY NOT NULL,
        payload TEXT NOT NULL,
        retrieved_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`).run();
      return env.DB;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function boundedText(value: unknown, maximum: number) {
  return typeof value === "string" && value.trim() && value.length <= maximum
    ? value
    : null;
}

function officialLawUrl(value: unknown) {
  const text = boundedText(value, 2_048);
  if (!text || /[?&]OC=/iu.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname === "www.law.go.kr"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function normalizeCachedFinancialLawGuidance(
  value: unknown,
  expectedTopic: FinancialLawTopic,
): FinancialLawGuidance | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.status !== "official-current" || row.topic !== expectedTopic
    || row.publisher !== "국가법령정보센터"
    || !row.law || typeof row.law !== "object" || Array.isArray(row.law)
    || !Array.isArray(row.articles) || row.articles.length < 1 || row.articles.length > 6
    || row.retrievalVersion !== undefined && row.retrievalVersion !== FINANCIAL_LAW_RETRIEVAL_VERSION
    || row.candidateArticles !== undefined && (!Array.isArray(row.candidateArticles)
      || row.articles.length + row.candidateArticles.length > 12
      || row.retrievalVersion !== FINANCIAL_LAW_RETRIEVAL_VERSION)) {
    return null;
  }
  const law = row.law as Record<string, unknown>;
  const lawId = boundedText(law.lawId, 40);
  const mst = boundedText(law.mst, 40);
  const lawName = boundedText(law.lawName, 300);
  const effectiveDate = boundedText(law.effectiveDate, 8);
  const retrievedAt = boundedText(law.retrievedAt, 40);
  const sourceUrl = officialLawUrl(law.sourceUrl);
  if (!lawId || !mst || !lawName || !effectiveDate || !/^\d{8}$/u.test(effectiveDate)
    || !retrievedAt || !Number.isFinite(Date.parse(retrievedAt)) || !sourceUrl) return null;
  function normalizeArticles(values: unknown[]): FinancialLawArticle[] {
    return values.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const article = candidate as Record<string, unknown>;
      const sourceId = boundedText(article.sourceId, 160);
      const articleKey = boundedText(article.articleKey, 40);
      const articleNumber = boundedText(article.articleNumber, 20);
      const articleTitle = article.articleTitle === null ? null : boundedText(article.articleTitle, 300);
      const textTruncated = article.textTruncated === true;
      const omittedPassageCount = article.omittedPassageCount;
      if (article.textTruncated !== undefined && typeof article.textTruncated !== "boolean"
        || textTruncated && (row.retrievalVersion !== FINANCIAL_LAW_RETRIEVAL_VERSION
          || !Number.isSafeInteger(omittedPassageCount) || Number(omittedPassageCount) < 1)
        || !textTruncated && omittedPassageCount !== undefined) return [];
      const text = textTruncated && article.text === "" ? "" : boundedText(article.text, 20_000);
      const articleEffectiveDate = boundedText(article.effectiveDate, 8);
      const articleSourceUrl = officialLawUrl(article.sourceUrl);
      if (!sourceId || !sourceId.startsWith(`law-go-kr:${lawId}:`) || !articleKey
        || !articleNumber || article.articleTitle !== null && !articleTitle || text === null
        || !articleEffectiveDate || articleEffectiveDate !== effectiveDate || !articleSourceUrl) return [];
      return [{
        sourceId,
        articleKey,
        articleNumber,
        articleTitle,
        text,
        effectiveDate: articleEffectiveDate,
        sourceUrl: articleSourceUrl,
        ...(textTruncated ? { textTruncated: true, omittedPassageCount: Number(omittedPassageCount) } : {}),
      }];
    });
  }
  const articles = normalizeArticles(row.articles);
  if (articles.length !== row.articles.length) return null;
  const rawCandidates = Array.isArray(row.candidateArticles) ? row.candidateArticles : [];
  const candidateArticles = normalizeArticles(rawCandidates);
  if (candidateArticles.length !== rawCandidates.length
    || new Set([...articles, ...candidateArticles].map((article) => article.sourceId)).size !== articles.length + candidateArticles.length) return null;
  const topicLabel = boundedText(row.topicLabel, 120);
  if (!topicLabel) return null;
  return {
    status: "official-current",
    topic: expectedTopic,
    topicLabel,
    publisher: "국가법령정보센터",
    law: {
      lawId,
      mst,
      lawName,
      promulgationDate: law.promulgationDate === null
        ? null
        : boundedText(law.promulgationDate, 8),
      promulgationNumber: law.promulgationNumber === null
        ? null
        : boundedText(law.promulgationNumber, 80),
      effectiveDate,
      ministry: law.ministry === null ? null : boundedText(law.ministry, 120),
      retrievedAt,
      sourceUrl,
    },
    articles,
    ...(candidateArticles.length ? { candidateArticles } : {}),
    ...(row.retrievalVersion === FINANCIAL_LAW_RETRIEVAL_VERSION ? { retrievalVersion: FINANCIAL_LAW_RETRIEVAL_VERSION } : {}),
  };
}

export async function readFinancialLawGuidanceCache(
  topic: FinancialLawTopic,
  now = Date.now(),
) {
  const row = await (await database()).prepare(`SELECT payload,
    retrieved_at AS retrievedAt, expires_at AS expiresAt
    FROM financial_law_guidance_cache WHERE topic = ?`)
    .bind(topic)
    .first<CacheRow>();
  if (!row || row.retrievedAt > now || now - row.retrievedAt > CACHE_STALE_LIMIT_MS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payload);
  } catch {
    return null;
  }
  const guidance = normalizeCachedFinancialLawGuidance(parsed, topic);
  if (!guidance) return null;
  return {
    guidance,
    // Legacy six-article/prefix-truncated payloads are readable for metadata,
    // but never count as fresh evidence after the retrieval implementation changes.
    fresh: row.expiresAt > now && guidance.retrievalVersion === FINANCIAL_LAW_RETRIEVAL_VERSION,
    retrievedAt: row.retrievedAt,
  };
}

export async function writeFinancialLawGuidanceCache(
  guidance: FinancialLawGuidance,
  now = Date.now(),
) {
  const normalized = normalizeCachedFinancialLawGuidance(guidance, guidance.topic);
  if (!normalized) throw new Error("financial_law_cache_payload_invalid");
  const payload = JSON.stringify(normalized);
  if (new TextEncoder().encode(payload).byteLength > CACHE_PAYLOAD_MAX_BYTES) {
    throw new Error("financial_law_cache_payload_too_large");
  }
  await (await database()).prepare(`INSERT INTO financial_law_guidance_cache
    (topic, payload, retrieved_at, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(topic) DO UPDATE SET
      payload = excluded.payload,
      retrieved_at = excluded.retrieved_at,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at`)
    .bind(guidance.topic, payload, now, now + CACHE_TTL_MS, now)
    .run();
}
