export const PHISHING_REPUTATION_LOOKUP_MAX_REQUESTS = 6;
export const PHISHING_REPUTATION_LOOKUP_WINDOW_MS = 60_000;
export const PHISHING_REPUTATION_QUOTA_RETENTION_MS = 48 * 60 * 60_000;
const PHISHING_REPUTATION_QUOTA_CLEANUP_INTERVAL_MS = 10 * 60_000;

export const PHISHING_REPUTATION_LOOKUP_CLAIM_SQL = `INSERT INTO phishing_reputation_lookup_quotas
  (subject_hash, window_started_at, request_count, updated_at)
  VALUES (?, ?, 1, ?)
  ON CONFLICT(subject_hash) DO UPDATE SET
    window_started_at = CASE
      WHEN phishing_reputation_lookup_quotas.window_started_at <= excluded.window_started_at - ${PHISHING_REPUTATION_LOOKUP_WINDOW_MS}
        THEN excluded.window_started_at
      ELSE phishing_reputation_lookup_quotas.window_started_at
    END,
    request_count = CASE
      WHEN phishing_reputation_lookup_quotas.window_started_at <= excluded.window_started_at - ${PHISHING_REPUTATION_LOOKUP_WINDOW_MS}
        THEN 1
      ELSE phishing_reputation_lookup_quotas.request_count + 1
    END,
    updated_at = excluded.updated_at
  WHERE phishing_reputation_lookup_quotas.window_started_at <= excluded.window_started_at - ${PHISHING_REPUTATION_LOOKUP_WINDOW_MS}
    OR phishing_reputation_lookup_quotas.request_count < ${PHISHING_REPUTATION_LOOKUP_MAX_REQUESTS}`;

const PHISHING_REPUTATION_LOOKUP_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS phishing_reputation_lookup_quotas (
  subject_hash TEXT PRIMARY KEY NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CONSTRAINT phishing_reputation_lookup_quotas_subject_check CHECK(length(subject_hash) = 64),
  CONSTRAINT phishing_reputation_lookup_quotas_count_check CHECK(request_count >= 0)
)`;
const PHISHING_REPUTATION_LOOKUP_INDEX_SQL = `CREATE INDEX IF NOT EXISTS phishing_reputation_lookup_quotas_updated_idx
  ON phishing_reputation_lookup_quotas(updated_at)`;

type ReputationQuotaRow = {
  windowStartedAt: number;
  requestCount: number;
};

export type PhishingReputationQuotaClaim =
  | { allowed: true; reason: "allowed"; retryAfterSeconds: 0 }
  | {
      allowed: false;
      reason: "quota-exhausted" | "storage-unavailable";
      retryAfterSeconds: number;
    };

export type PhishingReputationLookupRun<T> =
  | {
      status: "completed";
      value: T;
      retryAfterSeconds: 0;
    }
  | {
      status: "quota-exhausted" | "storage-unavailable";
      value: null;
      retryAfterSeconds: number;
    };

export interface PhishingReputationQuotaOptions {
  now?: number;
  /** Server-only key material; the Safe Browsing credential is used by the route. */
  pepper?: string;
  /** Pass null explicitly in tests or degraded runtimes to exercise fail-closed behavior. */
  database?: D1Database | null;
}

const schemaPromises = new WeakMap<object, Promise<void>>();
const lastCleanupAt = new WeakMap<object, number>();

async function runtimeD1(): Promise<D1Database | null> {
  try {
    const { env } = await import("cloudflare:workers");
    return env.DB ?? null;
  } catch {
    return null;
  }
}

async function ensureSchema(database: D1Database) {
  const existing = schemaPromises.get(database);
  if (existing) return existing;
  const pending = database.batch([
    database.prepare(PHISHING_REPUTATION_LOOKUP_SCHEMA_SQL),
    database.prepare(PHISHING_REPUTATION_LOOKUP_INDEX_SQL),
  ])
    .then(() => undefined)
    .catch((error) => {
      schemaPromises.delete(database);
      throw error;
    });
  schemaPromises.set(database, pending);
  return pending;
}

function requestIdentity(request: Request) {
  const candidate = request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "anonymous";
  const bounded = candidate.trim().slice(0, 64);
  return /^[0-9a-f:.]+$/iu.test(bounded) ? bounded.toLowerCase() : "anonymous";
}

async function subjectHash(request: Request, now: number, pepper: string) {
  // Daily rotation avoids retaining a stable network identifier while still
  // providing a durable distributed quota for every one-minute claim window.
  const day = new Date(now).toISOString().slice(0, 10);
  const material = `bora-phishing-reputation-v1:${day}:${requestIdentity(request)}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(material));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function cleanupExpiredRows(database: D1Database, now: number) {
  const previous = lastCleanupAt.get(database) ?? 0;
  if (now - previous < PHISHING_REPUTATION_QUOTA_CLEANUP_INTERVAL_MS) return;
  await database.prepare(
    "DELETE FROM phishing_reputation_lookup_quotas WHERE updated_at < ?",
  ).bind(now - PHISHING_REPUTATION_QUOTA_RETENTION_MS).run();
  lastCleanupAt.set(database, now);
}

/**
 * Claims one outbound URL-reputation provider request. D1 owns the atomic
 * check-and-increment across Worker instances. Any unavailable or indeterminate
 * storage state fails closed so the caller can keep the local rule result and
 * skip the external provider.
 */
export async function claimPhishingReputationLookupQuota(
  request: Request,
  options: PhishingReputationQuotaOptions = {},
): Promise<PhishingReputationQuotaClaim> {
  const now = options.now ?? Date.now();
  try {
    const database = options.database === undefined ? await runtimeD1() : options.database;
    const pepper = options.pepper?.trim() ?? "";
    if (!database || pepper.length < 16) {
      return {
        allowed: false,
        reason: "storage-unavailable",
        retryAfterSeconds: Math.ceil(PHISHING_REPUTATION_LOOKUP_WINDOW_MS / 1_000),
      };
    }

    await ensureSchema(database);
    await cleanupExpiredRows(database, now);
    const key = await subjectHash(request, now, pepper);
    const result = await database.prepare(PHISHING_REPUTATION_LOOKUP_CLAIM_SQL)
      .bind(key, now, now)
      .run();
    const changes = Number(result.meta.changes);
    if (changes === 1) {
      return { allowed: true, reason: "allowed", retryAfterSeconds: 0 };
    }
    if (changes !== 0) throw new Error("phishing_reputation_quota_claim_indeterminate");

    const row = await database.prepare(`SELECT
        window_started_at AS windowStartedAt,
        request_count AS requestCount
      FROM phishing_reputation_lookup_quotas WHERE subject_hash = ?`)
      .bind(key)
      .first<ReputationQuotaRow>();
    if (
      !row
      || !Number.isFinite(row.windowStartedAt)
      || row.requestCount < PHISHING_REPUTATION_LOOKUP_MAX_REQUESTS
    ) {
      throw new Error("phishing_reputation_quota_state_unavailable");
    }
    return {
      allowed: false,
      reason: "quota-exhausted",
      retryAfterSeconds: Math.max(
        1,
        Math.ceil(
          (row.windowStartedAt + PHISHING_REPUTATION_LOOKUP_WINDOW_MS - now) / 1_000,
        ),
      ),
    };
  } catch {
    return {
      allowed: false,
      reason: "storage-unavailable",
      retryAfterSeconds: Math.ceil(PHISHING_REPUTATION_LOOKUP_WINDOW_MS / 1_000),
    };
  }
}

/**
 * Security boundary for outbound provider work: the callback is never invoked
 * unless the durable quota claim succeeds.
 */
export async function runPhishingReputationLookupWithQuota<T>(
  request: Request,
  lookup: () => Promise<T>,
  options: PhishingReputationQuotaOptions = {},
): Promise<PhishingReputationLookupRun<T>> {
  const claim = await claimPhishingReputationLookupQuota(request, options);
  if (!claim.allowed) {
    return {
      status: claim.reason,
      value: null,
      retryAfterSeconds: claim.retryAfterSeconds,
    };
  }
  return {
    status: "completed",
    value: await lookup(),
    retryAfterSeconds: 0,
  };
}
