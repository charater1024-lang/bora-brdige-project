import type { AIProviderName } from "@/lib/ai/providers";
import type { PublicInformationLocale } from "./analysis";
import type { PublicInformationItem } from "./types";
import { safePublicHttpUrl } from "./urls";

// v3 invalidates explanations generated before non-numeric high-risk claim
// validation (for example, unsupported "full funding" or "no repayment").
export const ITEM_ANALYSIS_PROMPT_VERSION = "public-item-explanation-v3";

const GENERATION_SLOT = 1;
// Provider requests may legitimately run for the configured 60 second maximum.
// Keep a generous buffer so another request cannot reclaim the same job while
// the first completion is still returning and cause duplicate inference work.
export const ITEM_ANALYSIS_GENERATION_LEASE_MS = 120_000;
const FAILED_RETRY_MS = 30_000;

type CacheIdentity = {
  cacheKey: string;
  generation: number;
  itemId: string;
  category: PublicInformationItem["category"];
  locale: PublicInformationLocale;
  provider: AIProviderName;
  configuredModel: string;
  promptVersion: string;
  contentHash: string;
  sourceName: string;
  sourceUrl: string;
  sourceExpiresAt: string | null;
};

type ReadyRow = {
  explanation: string;
  responseModel: string | null;
  generatedAt: number | null;
  hitCount: number;
};

type AggregateRow = {
  entryCount: number;
  generatingCount: number;
  hitCount: number;
  lastGeneratedAt: number | null;
};

type MetaRow = { generation: number; lastClearedAt: number | null };
type ModelRow = { provider: string; configuredModel: string; entryCount: number };

let schemaReady: Promise<D1Database> | null = null;

async function database() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const { env } = await import("cloudflare:workers");
      if (!env.DB) throw new Error("item_analysis_cache_unavailable");
      const db = env.DB;
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS public_item_analysis_cache (
          cache_key TEXT PRIMARY KEY NOT NULL,
          generation INTEGER NOT NULL DEFAULT 1,
          item_id TEXT NOT NULL,
          category TEXT NOT NULL,
          locale TEXT NOT NULL,
          provider TEXT NOT NULL,
          configured_model TEXT NOT NULL,
          response_model TEXT,
          prompt_version TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          explanation TEXT NOT NULL DEFAULT '',
          source_name TEXT NOT NULL,
          source_url TEXT NOT NULL,
          source_expires_at TEXT,
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
        db.prepare(`CREATE INDEX IF NOT EXISTS public_item_analysis_cache_runtime_idx
          ON public_item_analysis_cache (generation, provider, configured_model, status)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS public_item_analysis_cache_cleanup_idx
          ON public_item_analysis_cache (generation, last_accessed_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS public_item_analysis_cache_meta (
          slot INTEGER PRIMARY KEY NOT NULL,
          generation INTEGER NOT NULL DEFAULT 1,
          last_cleared_at INTEGER,
          last_cleared_by_user_id TEXT REFERENCES oauth_users(id) ON DELETE SET NULL
        )`),
        db.prepare(`INSERT OR IGNORE INTO public_item_analysis_cache_meta
          (slot, generation, last_cleared_at, last_cleared_by_user_id)
          VALUES (${GENERATION_SLOT}, 1, NULL, NULL)`),
      ]);
      return db;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function stableContent(item: PublicInformationItem, sourceUrl: string) {
  return JSON.stringify({
    id: item.id,
    category: item.category,
    title: item.title,
    summary: item.summary,
    source: item.source,
    sourceUrl,
    sourceLinkKind: item.sourceLinkKind ?? null,
    publishedAt: item.publishedAt,
    expiresAt: item.expiresAt ?? null,
    tags: [...item.tags].sort(),
    location: item.location ?? null,
    commercialArea: item.commercialArea ?? null,
    financialProduct: item.financialProduct ?? null,
    employmentStatistic: item.employmentStatistic ?? null,
  });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function generationMeta() {
  const db = await database();
  const row = await db.prepare(`SELECT generation, last_cleared_at AS lastClearedAt
    FROM public_item_analysis_cache_meta WHERE slot = ?`)
    .bind(GENERATION_SLOT)
    .first<MetaRow>();
  if (!row) throw new Error("item_analysis_cache_meta_unavailable");
  return row;
}

export async function itemAnalysisCacheIdentity(input: {
  item: PublicInformationItem;
  locale: PublicInformationLocale;
  provider: AIProviderName;
  configuredModel: string;
  generation?: number;
}): Promise<CacheIdentity> {
  const sourceUrl = safePublicHttpUrl(input.item.sourceUrl);
  if (!sourceUrl) throw new Error("official_source_url_invalid");
  const generation = input.generation ?? (await generationMeta()).generation;
  const contentHash = await sha256(stableContent(input.item, sourceUrl));
  const cacheKey = await sha256([
    "bora-public-item-analysis",
    String(generation),
    input.provider,
    input.configuredModel,
    input.locale,
    ITEM_ANALYSIS_PROMPT_VERSION,
    contentHash,
  ].join("\0"));
  return {
    cacheKey,
    generation,
    itemId: input.item.id,
    category: input.item.category,
    locale: input.locale,
    provider: input.provider,
    configuredModel: input.configuredModel,
    promptVersion: ITEM_ANALYSIS_PROMPT_VERSION,
    contentHash,
    sourceName: input.item.source,
    sourceUrl,
    sourceExpiresAt: input.item.expiresAt ?? null,
  };
}

export async function readCachedItemAnalysis(identity: CacheIdentity, now = Date.now()) {
  const db = await database();
  const row = await db.prepare(`SELECT explanation, response_model AS responseModel,
      generated_at AS generatedAt, hit_count AS hitCount
    FROM public_item_analysis_cache
    WHERE cache_key = ? AND generation = ? AND status = 'ready'`)
    .bind(identity.cacheKey, identity.generation)
    .first<ReadyRow>();
  if (!row?.explanation) return null;
  await db.prepare(`UPDATE public_item_analysis_cache
    SET hit_count = hit_count + 1, last_accessed_at = ?, updated_at = ?
    WHERE cache_key = ? AND generation = ? AND status = 'ready'`)
    .bind(now, now, identity.cacheKey, identity.generation)
    .run()
    .catch(() => undefined);
  return {
    explanation: row.explanation,
    responseModel: row.responseModel ?? identity.configuredModel,
    generatedAt: row.generatedAt,
    hitCount: row.hitCount + 1,
  };
}

export async function claimItemAnalysisGeneration(identity: CacheIdentity, now = Date.now()) {
  const db = await database();
  const lockToken = crypto.randomUUID();
  const lockUntil = now + ITEM_ANALYSIS_GENERATION_LEASE_MS;
  const inserted = await db.prepare(`INSERT OR IGNORE INTO public_item_analysis_cache
    (cache_key, generation, item_id, category, locale, provider, configured_model,
      response_model, prompt_version, content_hash, explanation, source_name,
      source_url, source_expires_at, status, lock_token, lock_until, error_code,
      hit_count, generated_at, last_accessed_at, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, '', ?, ?, ?, 'generating', ?, ?, NULL,
      0, NULL, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM public_item_analysis_cache_meta
      WHERE slot = ? AND generation = ?)`)
    .bind(
      identity.cacheKey,
      identity.generation,
      identity.itemId,
      identity.category,
      identity.locale,
      identity.provider,
      identity.configuredModel,
      identity.promptVersion,
      identity.contentHash,
      identity.sourceName,
      identity.sourceUrl,
      identity.sourceExpiresAt,
      lockToken,
      lockUntil,
      now,
      now,
      now,
      GENERATION_SLOT,
      identity.generation,
    )
    .run();
  if (Number(inserted.meta.changes ?? 0) === 1) return lockToken;

  const reclaimed = await db.prepare(`UPDATE public_item_analysis_cache
    SET status = 'generating', lock_token = ?, lock_until = ?, error_code = NULL,
      last_accessed_at = ?, updated_at = ?
    WHERE cache_key = ? AND generation = ? AND status <> 'ready' AND lock_until <= ?
      AND EXISTS (SELECT 1 FROM public_item_analysis_cache_meta
        WHERE slot = ? AND generation = ?)`)
    .bind(
      lockToken,
      lockUntil,
      now,
      now,
      identity.cacheKey,
      identity.generation,
      now,
      GENERATION_SLOT,
      identity.generation,
    )
    .run();
  return Number(reclaimed.meta.changes ?? 0) === 1 ? lockToken : null;
}

export async function saveGeneratedItemAnalysis(input: {
  identity: CacheIdentity;
  lockToken: string;
  explanation: string;
  responseModel: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const db = await database();
  const result = await db.prepare(`UPDATE public_item_analysis_cache
    SET status = 'ready', explanation = ?, response_model = ?, generated_at = ?,
      lock_token = NULL, lock_until = 0, error_code = NULL,
      last_accessed_at = ?, updated_at = ?
    WHERE cache_key = ? AND generation = ? AND status = 'generating' AND lock_token = ?
      AND EXISTS (SELECT 1 FROM public_item_analysis_cache_meta
        WHERE slot = ? AND generation = ?)`)
    .bind(
      input.explanation,
      input.responseModel,
      now,
      now,
      now,
      input.identity.cacheKey,
      input.identity.generation,
      input.lockToken,
      GENERATION_SLOT,
      input.identity.generation,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function failItemAnalysisGeneration(input: {
  identity: CacheIdentity;
  lockToken: string;
  errorCode: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const db = await database();
  await db.prepare(`UPDATE public_item_analysis_cache
    SET status = 'failed', lock_token = NULL, lock_until = ?, error_code = ?,
      last_accessed_at = ?, updated_at = ?
    WHERE cache_key = ? AND generation = ? AND status = 'generating' AND lock_token = ?`)
    .bind(
      now + FAILED_RETRY_MS,
      input.errorCode.slice(0, 80),
      now,
      now,
      input.identity.cacheKey,
      input.identity.generation,
      input.lockToken,
    )
    .run();
}

export async function itemAnalysisCacheStats(current?: {
  provider: AIProviderName;
  configuredModel: string;
} | null) {
  const db = await database();
  const meta = await generationMeta();
  const [aggregate, models] = await Promise.all([
    db.prepare(`SELECT
        SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS entryCount,
        SUM(CASE WHEN status = 'generating' AND lock_until > ? THEN 1 ELSE 0 END) AS generatingCount,
        SUM(CASE WHEN status = 'ready' THEN hit_count ELSE 0 END) AS hitCount,
        MAX(CASE WHEN status = 'ready' THEN generated_at ELSE NULL END) AS lastGeneratedAt
      FROM public_item_analysis_cache WHERE generation = ?`)
      .bind(Date.now(), meta.generation)
      .first<AggregateRow>(),
    db.prepare(`SELECT provider, configured_model AS configuredModel, COUNT(*) AS entryCount
      FROM public_item_analysis_cache
      WHERE generation = ? AND status = 'ready'
      GROUP BY provider, configured_model
      ORDER BY entryCount DESC, provider, configured_model`)
      .bind(meta.generation)
      .all<ModelRow>(),
  ]);
  let currentRuntimeEntryCount = 0;
  if (current) {
    const row = await db.prepare(`SELECT COUNT(*) AS entryCount
      FROM public_item_analysis_cache
      WHERE generation = ? AND status = 'ready' AND provider = ? AND configured_model = ?`)
      .bind(meta.generation, current.provider, current.configuredModel)
      .first<{ entryCount: number }>();
    currentRuntimeEntryCount = Number(row?.entryCount ?? 0);
  }
  return {
    generation: meta.generation,
    entryCount: Number(aggregate?.entryCount ?? 0),
    currentRuntimeEntryCount,
    generatingCount: Number(aggregate?.generatingCount ?? 0),
    hitCount: Number(aggregate?.hitCount ?? 0),
    lastGeneratedAt: aggregate?.lastGeneratedAt
      ? new Date(Number(aggregate.lastGeneratedAt)).toISOString()
      : null,
    lastClearedAt: meta.lastClearedAt
      ? new Date(Number(meta.lastClearedAt)).toISOString()
      : null,
    models: (models.results ?? []).map((row) => ({
      provider: row.provider,
      model: row.configuredModel,
      entryCount: Number(row.entryCount),
    })),
  };
}

export async function clearItemAnalysisCache(userId: string, now = Date.now()) {
  const db = await database();
  const count = await db.prepare("SELECT COUNT(*) AS entryCount FROM public_item_analysis_cache")
    .first<{ entryCount: number }>();
  await db.batch([
    db.prepare(`UPDATE public_item_analysis_cache_meta
      SET generation = generation + 1, last_cleared_at = ?, last_cleared_by_user_id = ?
      WHERE slot = ?`)
      .bind(now, userId, GENERATION_SLOT),
    db.prepare("DELETE FROM public_item_analysis_cache"),
  ]);
  return { deletedCount: Number(count?.entryCount ?? 0), clearedAt: new Date(now).toISOString() };
}
