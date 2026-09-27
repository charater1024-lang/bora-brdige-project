export const AI_RATE_LIMIT_MAX_REQUESTS = 10;
export const AI_RATE_LIMIT_WINDOW_MS = 60_000;

export const AI_RATE_LIMIT_CLAIM_SQL = `INSERT INTO ai_user_rate_limits
  (user_id, window_started_at, request_count, updated_at)
  VALUES (?, ?, 1, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    window_started_at = CASE
      WHEN ai_user_rate_limits.window_started_at <= excluded.window_started_at - ${AI_RATE_LIMIT_WINDOW_MS}
        THEN excluded.window_started_at
      ELSE ai_user_rate_limits.window_started_at
    END,
    request_count = CASE
      WHEN ai_user_rate_limits.window_started_at <= excluded.window_started_at - ${AI_RATE_LIMIT_WINDOW_MS}
        THEN 1
      ELSE ai_user_rate_limits.request_count + 1
    END,
    updated_at = excluded.updated_at
  WHERE ai_user_rate_limits.window_started_at <= excluded.window_started_at - ${AI_RATE_LIMIT_WINDOW_MS}
    OR ai_user_rate_limits.request_count < ${AI_RATE_LIMIT_MAX_REQUESTS}`;

let schemaReady: Promise<void> | null = null;

async function getAiRateLimitD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("ai_rate_limit_storage_unavailable");
  return env.DB;
}

async function ensureAiRateLimitSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = await getAiRateLimitD1();
    await db.prepare(`CREATE TABLE IF NOT EXISTS ai_user_rate_limits (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES oauth_users(id) ON DELETE CASCADE,
      window_started_at INTEGER NOT NULL,
      request_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`).run();
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

type RateLimitRow = { windowStartedAt: number; requestCount: number };

export type AiRateLimitClaim =
  | { allowed: true; retryAfterSeconds: 0 }
  | { allowed: false; retryAfterSeconds: number };

/**
 * One conditional UPSERT owns the check-and-increment, so concurrent requests
 * cannot both observe a stale count and exceed the per-user allowance.
 */
export async function claimAiRequestRateLimit(
  userId: string,
  now = Date.now(),
): Promise<AiRateLimitClaim> {
  await ensureAiRateLimitSchema();
  const db = await getAiRateLimitD1();
  const result = await db.prepare(AI_RATE_LIMIT_CLAIM_SQL)
    .bind(userId, now, now)
    .run();
  const changes = Number(result.meta.changes);
  if (changes === 1) return { allowed: true, retryAfterSeconds: 0 };
  if (changes !== 0) throw new Error("ai_rate_limit_claim_indeterminate");

  const row = await db.prepare(`SELECT
      window_started_at AS windowStartedAt,
      request_count AS requestCount
    FROM ai_user_rate_limits WHERE user_id = ?`)
    .bind(userId)
    .first<RateLimitRow>();
  if (!row || !Number.isFinite(row.windowStartedAt) || row.requestCount < AI_RATE_LIMIT_MAX_REQUESTS) {
    throw new Error("ai_rate_limit_state_unavailable");
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((row.windowStartedAt + AI_RATE_LIMIT_WINDOW_MS - now) / 1_000),
    ),
  };
}
