import { randomBase64Url } from "./crypto";

export const LOGIN_START_WINDOW_MS = 60_000;
export const LOGIN_START_GLOBAL_LIMIT = 120;
export const LOGIN_START_CLIENT_LIMIT = 12;

export const LOGIN_START_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS oauth_start_rate_limits (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  client_counts_json TEXT NOT NULL,
  client_salt TEXT NOT NULL
)`;

// The global and client counters are checked and incremented by ONE statement.
// This avoids a check-then-write race, including across different providers or
// application processes. At most 120 client keys exist in the single row.
export const LOGIN_START_CLAIM_SQL = `UPDATE oauth_start_rate_limits SET
  window_started_at = CASE WHEN window_started_at <= ? - ${LOGIN_START_WINDOW_MS}
    THEN ? ELSE window_started_at END,
  request_count = CASE WHEN window_started_at <= ? - ${LOGIN_START_WINDOW_MS}
    THEN 1 ELSE request_count + 1 END,
  client_counts_json = CASE WHEN window_started_at <= ? - ${LOGIN_START_WINDOW_MS}
    THEN json_object(?, 1)
    ELSE json_set(client_counts_json, ?, COALESCE(json_extract(client_counts_json, ?), 0) + 1) END
  WHERE singleton = 1 AND (
    window_started_at <= ? - ${LOGIN_START_WINDOW_MS}
    OR (request_count < ${LOGIN_START_GLOBAL_LIMIT}
      AND COALESCE(json_extract(client_counts_json, ?), 0) < ${LOGIN_START_CLIENT_LIMIT})
  )`;

const schemas = new WeakMap<D1Database, Promise<void>>();

async function getLoginStartD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("login_start_storage_unavailable");
  return env.DB;
}

async function ensureSchema(db: D1Database): Promise<void> {
  let ready = schemas.get(db);
  if (!ready) {
    ready = (async () => {
      await db.prepare(LOGIN_START_SCHEMA_SQL).run();
      await db.prepare(`INSERT INTO oauth_start_rate_limits
        (singleton, window_started_at, request_count, client_counts_json, client_salt)
        VALUES (1, 0, 0, '{}', ?) ON CONFLICT(singleton) DO NOTHING`)
        .bind(randomBase64Url(32)).run();
    })().catch((error) => {
      schemas.delete(db);
      throw error;
    });
    schemas.set(db, ready);
  }
  await ready;
}

function clientAddress(request: Request): string {
  // Cloudflare overwrites this on public ingress. It is only a best-effort
  // per-client restriction, NEVER authorization or a way around the global cap.
  // Do not trust X-Forwarded-For / arbitrary lists or store plaintext addresses.
  const raw = request.headers.get("cf-connecting-ip");
  if (!raw || raw.length > 45) return "unknown";
  const value = raw.trim().toLowerCase();
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(value)) {
    const octets = value.split(".").map(Number);
    return octets.every((part) => part <= 255) ? octets.join(".") : "unknown";
  }
  if (value.includes(":") && /^[0-9a-f:.]+$/u.test(value)) {
    try {
      return new URL(`http://[${value}]/`).hostname;
    } catch { /* Invalid address: share the conservative unknown bucket. */ }
  }
  return "unknown";
}

async function clientKey(request: Request, salt: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(salt)) throw new Error("login_start_state_unavailable");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(`oauth-start:${clientAddress(request)}`),
  ));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type LoginStartClaim =
  | { allowed: true; retryAfterSeconds: 0 }
  | { allowed: false; retryAfterSeconds: number };

export async function claimLoginStartRateLimit(
  request: Request,
  now = Date.now(),
): Promise<LoginStartClaim> {
  if (!Number.isSafeInteger(now) || now < LOGIN_START_WINDOW_MS) {
    throw new Error("login_start_time_unavailable");
  }
  const db = await getLoginStartD1();
  await ensureSchema(db);
  const state = await db.prepare("SELECT client_salt AS clientSalt FROM oauth_start_rate_limits WHERE singleton = 1")
    .first<{ clientSalt: string }>();
  if (!state) throw new Error("login_start_state_unavailable");
  const key = await clientKey(request, state.clientSalt);
  const path = `$."${key}"`;
  const result = await db.prepare(LOGIN_START_CLAIM_SQL)
    .bind(now, now, now, now, key, path, path, now, path).run();
  if (!result.success) throw new Error("login_start_claim_failed");
  const changes = Number(result.meta.changes);
  if (changes === 1) return { allowed: true, retryAfterSeconds: 0 };
  if (changes !== 0) throw new Error("login_start_claim_indeterminate");
  const current = await db.prepare("SELECT window_started_at AS windowStartedAt FROM oauth_start_rate_limits WHERE singleton = 1")
    .first<{ windowStartedAt: number }>();
  if (!current || !Number.isSafeInteger(current.windowStartedAt)) {
    throw new Error("login_start_state_unavailable");
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.min(
      LOGIN_START_WINDOW_MS / 1_000,
      Math.ceil((current.windowStartedAt + LOGIN_START_WINDOW_MS - now) / 1_000),
    )),
  };
}
