import type { AIProviderName } from "@/lib/ai/providers";
import type { FinancialLawGuidance } from "./financial-law";
import { formatFinancialLawGroundingSources } from "./financial-law";

export const FINANCIAL_LAW_SUMMARY_PROMPT_VERSION = "financial-law-official-excerpts-v3";

/** Exact original passages only: no numeric conversion, paraphrase or translation. */
export function buildOfficialLawExcerptSummary(guidance: FinancialLawGuidance, locale: FinancialLawSummaryLocale) {
  const sources = formatFinancialLawGroundingSources(guidance);
  return renderOfficialLawExcerpts(sources, locale);
}

export function renderOfficialLawExcerpts(sources: readonly { title: string; excerpt: string }[], locale: FinancialLawSummaryLocale) {
  if (!sources.length) return "";
  const notice = {
    ko: "공식 조문 발췌입니다. AI가 생성하거나 쉽게 풀어쓴 요약이 아닙니다. 일부 조문만 표시하며 전체 요건·예외와 공포 원문을 확인해야 합니다.",
    en: "Official Korean excerpts, not an AI-generated summary or translation. Only selected passages are shown; check all conditions and exceptions in the complete promulgated text.",
    ja: "韓国語の公式条文抜粋です。AI要約・翻訳ではありません。一部の条文のみ表示しています。全条件・例外は公布原文で確認してください。",
    zh: "以下为韩文官方条文摘录，并非 AI 摘要或翻译。仅展示部分条文，请核对公布原文的全部条件与例外。",
  }[locale];
  return [notice, ...sources.map((source) => `${source.title}\n${source.excerpt}`)].join("\n\n");
}

/** Validate payload integrity by retaining exact text; this is not a legal interpretation. */
export function reusableOfficialLawExcerpt(cached: unknown, expected: string) {
  return Boolean(expected) && typeof cached === "string" && cached === expected;
}
export const FINANCIAL_LAW_SUMMARY_LEASE_MS = 120_000;

const FAILED_RETRY_MS = 30_000;

export type FinancialLawSummaryLocale = "ko" | "en" | "ja" | "zh";

export type FinancialLawSummaryIdentity = {
  cacheKey: string;
  topic: FinancialLawGuidance["topic"];
  locale: FinancialLawSummaryLocale;
  provider: AIProviderName;
  configuredModel: string;
  promptVersion: string;
  sourceFingerprint: string;
  lawName: string;
  lawId: string;
  lawVersion: string;
  sourceUrl: string;
};

type ReadyRow = {
  summary: string;
  responseModel: string | null;
  generatedAt: number | null;
  hitCount: number;
};

let schemaReady: Promise<D1Database> | null = null;

async function database() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const { env } = await import("cloudflare:workers");
      if (!env.DB) throw new Error("financial_law_summary_cache_unavailable");
      const db = env.DB;
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS financial_law_summary_cache (
          cache_key TEXT PRIMARY KEY NOT NULL,
          topic TEXT NOT NULL,
          locale TEXT NOT NULL,
          provider TEXT NOT NULL,
          configured_model TEXT NOT NULL,
          response_model TEXT,
          prompt_version TEXT NOT NULL,
          source_fingerprint TEXT NOT NULL,
          law_name TEXT NOT NULL,
          law_id TEXT NOT NULL,
          law_version TEXT NOT NULL,
          source_url TEXT NOT NULL,
          summary TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'generating',
          lock_token TEXT,
          lock_until INTEGER NOT NULL DEFAULT 0,
          error_code TEXT,
          hit_count INTEGER NOT NULL DEFAULT 0,
          generated_at INTEGER,
          last_accessed_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS financial_law_summary_runtime_idx
          ON financial_law_summary_cache (provider, configured_model, locale, status)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS financial_law_summary_source_idx
          ON financial_law_summary_cache (topic, source_fingerprint, status)`),
      ]);
      return db;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableOfficialSource(guidance: FinancialLawGuidance) {
  return JSON.stringify({
    topic: guidance.topic,
    retrievalVersion: guidance.retrievalVersion ?? 1,
    publisher: guidance.publisher,
    law: {
      lawId: guidance.law.lawId,
      mst: guidance.law.mst,
      lawName: guidance.law.lawName,
      effectiveDate: guidance.law.effectiveDate,
      sourceUrl: guidance.law.sourceUrl,
    },
    articles: [...guidance.articles, ...(guidance.candidateArticles ?? [])].map((article) => ({
      sourceId: article.sourceId,
      articleNumber: article.articleNumber,
      articleTitle: article.articleTitle,
      text: article.text,
      effectiveDate: article.effectiveDate,
      sourceUrl: article.sourceUrl,
      textTruncated: article.textTruncated ?? false,
      omittedPassageCount: article.omittedPassageCount ?? 0,
    })),
  });
}

export async function financialLawSummaryCacheIdentity(input: {
  guidance: FinancialLawGuidance;
  locale: FinancialLawSummaryLocale;
  provider: AIProviderName;
  configuredModel: string;
}): Promise<FinancialLawSummaryIdentity> {
  const sourceFingerprint = await sha256(stableOfficialSource(input.guidance));
  const cacheKey = await sha256([
    "bora-financial-law-summary",
    input.provider,
    input.configuredModel,
    input.locale,
    FINANCIAL_LAW_SUMMARY_PROMPT_VERSION,
    sourceFingerprint,
  ].join("\0"));
  return {
    cacheKey,
    topic: input.guidance.topic,
    locale: input.locale,
    provider: input.provider,
    configuredModel: input.configuredModel,
    promptVersion: FINANCIAL_LAW_SUMMARY_PROMPT_VERSION,
    sourceFingerprint,
    lawName: input.guidance.law.lawName,
    lawId: input.guidance.law.lawId,
    lawVersion: `${input.guidance.law.mst}:${input.guidance.law.effectiveDate}`,
    sourceUrl: input.guidance.law.sourceUrl,
  };
}

export async function readCachedFinancialLawSummary(
  identity: FinancialLawSummaryIdentity,
  now = Date.now(),
) {
  const db = await database();
  const row = await db.prepare(`SELECT summary, response_model AS responseModel,
      generated_at AS generatedAt, hit_count AS hitCount
    FROM financial_law_summary_cache
    WHERE cache_key = ? AND status = 'ready'`)
    .bind(identity.cacheKey)
    .first<ReadyRow>();
  if (!row?.summary) return null;
  await db.prepare(`UPDATE financial_law_summary_cache
    SET hit_count = hit_count + 1, last_accessed_at = ?, updated_at = ?
    WHERE cache_key = ? AND status = 'ready'`)
    .bind(now, now, identity.cacheKey)
    .run()
    .catch(() => undefined);
  return {
    summary: row.summary,
    responseModel: row.responseModel ?? identity.configuredModel,
    generatedAt: row.generatedAt,
    hitCount: row.hitCount + 1,
  };
}

export async function claimFinancialLawSummaryGeneration(
  identity: FinancialLawSummaryIdentity,
  now = Date.now(),
) {
  const db = await database();
  const lockToken = crypto.randomUUID();
  const lockUntil = now + FINANCIAL_LAW_SUMMARY_LEASE_MS;
  const inserted = await db.prepare(`INSERT OR IGNORE INTO financial_law_summary_cache
    (cache_key, topic, locale, provider, configured_model, response_model,
      prompt_version, source_fingerprint, law_name, law_id, law_version,
      source_url, summary, status, lock_token, lock_until, error_code, hit_count,
      generated_at, last_accessed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, '', 'generating', ?, ?, NULL,
      0, NULL, ?, ?, ?)`)
    .bind(
      identity.cacheKey,
      identity.topic,
      identity.locale,
      identity.provider,
      identity.configuredModel,
      identity.promptVersion,
      identity.sourceFingerprint,
      identity.lawName,
      identity.lawId,
      identity.lawVersion,
      identity.sourceUrl,
      lockToken,
      lockUntil,
      now,
      now,
      now,
    )
    .run();
  if (Number(inserted.meta.changes ?? 0) === 1) return lockToken;

  const reclaimed = await db.prepare(`UPDATE financial_law_summary_cache
    SET status = 'generating', lock_token = ?, lock_until = ?, error_code = NULL,
      last_accessed_at = ?, updated_at = ?
    WHERE cache_key = ? AND status <> 'ready' AND lock_until <= ?`)
    .bind(lockToken, lockUntil, now, now, identity.cacheKey, now)
    .run();
  return Number(reclaimed.meta.changes ?? 0) === 1 ? lockToken : null;
}

export async function saveGeneratedFinancialLawSummary(input: {
  identity: FinancialLawSummaryIdentity;
  lockToken: string;
  summary: string;
  responseModel: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const db = await database();
  const result = await db.prepare(`UPDATE financial_law_summary_cache
    SET status = 'ready', summary = ?, response_model = ?, generated_at = ?,
      lock_token = NULL, lock_until = 0, error_code = NULL,
      last_accessed_at = ?, updated_at = ?
    WHERE cache_key = ? AND status = 'generating' AND lock_token = ?`)
    .bind(
      input.summary,
      input.responseModel,
      now,
      now,
      now,
      input.identity.cacheKey,
      input.lockToken,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function failFinancialLawSummaryGeneration(input: {
  identity: FinancialLawSummaryIdentity;
  lockToken: string;
  errorCode: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const db = await database();
  await db.prepare(`UPDATE financial_law_summary_cache
    SET status = 'failed', lock_token = NULL, lock_until = ?, error_code = ?,
      last_accessed_at = ?, updated_at = ?
    WHERE cache_key = ? AND status = 'generating' AND lock_token = ?`)
    .bind(
      now + FAILED_RETRY_MS,
      input.errorCode.slice(0, 80),
      now,
      now,
      input.identity.cacheKey,
      input.lockToken,
    )
    .run();
}
