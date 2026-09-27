import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sqlite = new DatabaseSync(":memory:");
let failure = "";
let claimResult = null;
let queries = [];
function prepare(sql, parameters = []) {
  function execute(method) {
    queries.push({ sql, parameters });
    if (failure && sql.includes(failure)) throw new Error("synthetic database failure");
    if (claimResult && sql.startsWith("UPDATE oauth_start_rate_limits SET")) return claimResult;
    const statement = sqlite.prepare(sql);
    if (method === "first") return statement.get(...parameters) ?? null;
    if (method === "all") return { results: statement.all(...parameters) };
    return { success: true, meta: { changes: Number(statement.run(...parameters).changes) } };
  }
  return {
    bind: (...values) => prepare(sql, values),
    run: async () => execute("run"),
    first: async () => execute("first"),
    all: async () => execute("all"),
    execute,
  };
}
function binding() {
  return {
    prepare,
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute("run"));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
globalThis.__boraOAuthStartTestDb = binding();
const names = ["AUTH_MODE", "APP_BASE_URL", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET", "KAKAO_REST_API_KEY", "KAKAO_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "NAVER_REDIRECT_URI", "KAKAO_REDIRECT_URI", "GOOGLE_REDIRECT_URI"];
const previous = new Map(names.map((name) => [name, process.env[name]]));
for (const name of names) delete process.env[name];
Object.assign(process.env, {
  AUTH_MODE: "external", APP_BASE_URL: "https://example.com",
  NAVER_CLIENT_ID: "test-client", NAVER_CLIENT_SECRET: "test-secret",
  KAKAO_REST_API_KEY: "test-client", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret",
});
const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = async () => { networkCalls += 1; throw new Error("OAuth test must not use the network"); };
const server = await createServer({
  root: projectRoot, configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": projectRoot } },
  plugins: [{
    name: "oauth-start-synthetic-d1",
    resolveId(id) { if (id === "cloudflare:workers") return "\0oauth-start-workers"; },
    load(id) { if (id === "\0oauth-start-workers") return "export const env = { get DB() { return globalThis.__boraOAuthStartTestDb; } };"; },
  }],
  server: { middlewareMode: true },
});
const route = await server.ssrLoadModule("/app/api/auth/[provider]/route.ts");
const limiter = await server.ssrLoadModule("/lib/auth/login-start-rate-limit.ts");
const consent = await server.ssrLoadModule("/lib/auth/consent-policy.ts");
const store = await server.ssrLoadModule("/lib/auth/store.ts");
await store.ensureAuthSchema();
const accepted = {
  termsAccepted: true, privacyAccepted: true,
  termsVersion: consent.CURRENT_TERMS_VERSION, privacyVersion: consent.CURRENT_PRIVACY_VERSION,
  returnTo: "/finance?tab=assets",
};
function request({ provider = "naver", ip = "192.0.2.1", payload = accepted, headers = {}, body } = {}) {
  return new Request(`https://example.com/api/auth/${provider}`, {
    method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json", ...(ip ? { "CF-Connecting-IP": ip } : {}), ...headers },
    body: body ?? JSON.stringify(payload),
  });
}
function start(options = {}) {
  return route.POST(request(options), { params: Promise.resolve({ provider: options.provider ?? "naver" }) });
}
function transactionCount() {
  return sqlite.prepare("SELECT COUNT(*) AS count FROM oauth_transactions").get().count;
}
function bucket() {
  return sqlite.prepare("SELECT * FROM oauth_start_rate_limits WHERE singleton = 1").get();
}
function resetBucket() {
  if (sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'oauth_start_rate_limits'").get()) {
    sqlite.exec("UPDATE oauth_start_rate_limits SET window_started_at = 0, request_count = 0, client_counts_json = '{}'");
  }
}
test.beforeEach(() => {
  failure = ""; claimResult = null; queries = []; networkCalls = 0;
  sqlite.exec("DELETE FROM oauth_transactions");
  resetBucket();
});
test.after(async () => {
  await server.close(); sqlite.close(); delete globalThis.__boraOAuthStartTestDb;
  globalThis.fetch = originalFetch;
  for (const [name, value] of previous) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test("actual handler preserves normal provider URL, current consent, PKCE, transaction and secure state cookie", async () => {
  for (const provider of ["naver", "kakao", "google"]) {
    const response = await start({ provider });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    const url = new URL((await response.json()).authorizationUrl);
    assert.equal(url.searchParams.get("redirect_uri"), `https://example.com/api/auth/callback/${provider}`);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const state = url.searchParams.get("state");
    assert.equal(consent.isCurrentOAuthConsentState(state), true);
    const cookie = response.headers.get("set-cookie");
    assert.ok(cookie.includes(`bora_oauth_state_${provider}=${encodeURIComponent(state)}`));
    assert.ok(cookie.includes(`Path=/api/auth/callback/${provider}`));
    for (const attribute of ["HttpOnly", "SameSite=Lax", "Secure", "Max-Age=600"]) assert.ok(cookie.includes(attribute));
    const row = sqlite.prepare("SELECT * FROM oauth_transactions WHERE provider = ?").get(provider);
    assert.notEqual(row.state_hash, state);
    assert.equal(row.return_to, accepted.returnTo);
    assert.equal(row.expires_at - row.created_at, 600_000);
    assert.equal(row.consumed_at, null);
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(row.code_verifier))).toString("base64url");
    assert.equal(url.searchParams.get("code_challenge"), challenge);
  }
  assert.equal(transactionCount(), 3);
  assert.equal(networkCalls, 0);
});

test("parallel provider-combined login starts atomically stop at the per-client cap", async () => {
  const results = await Promise.all(Array.from({ length: 48 }, (_, index) => start({ provider: index % 2 ? "kakao" : "naver" })));
  assert.equal(results.filter((response) => response.status === 200).length, limiter.LOGIN_START_CLIENT_LIMIT);
  assert.equal(results.filter((response) => response.status === 429).length, 48 - limiter.LOGIN_START_CLIENT_LIMIT);
  assert.equal(transactionCount(), limiter.LOGIN_START_CLIENT_LIMIT);
  assert.equal(bucket().request_count, limiter.LOGIN_START_CLIENT_LIMIT);
  for (const response of results.filter((item) => item.status === 429)) {
    assert.equal((await response.json()).error, "login_start_rate_limit_exceeded");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.ok(Number(response.headers.get("retry-after")) >= 1);
    assert.ok(Number(response.headers.get("retry-after")) <= 60);
  }
});

test("parallel rotating-client flood cannot evade global cap and storage remains one bounded row", async () => {
  const count = limiter.LOGIN_START_GLOBAL_LIMIT + 40;
  const results = await Promise.all(Array.from({ length: count }, (_, index) => start({ ip: `198.51.100.${index + 1}` })));
  assert.equal(results.filter((response) => response.status === 200).length, limiter.LOGIN_START_GLOBAL_LIMIT);
  assert.equal(transactionCount(), limiter.LOGIN_START_GLOBAL_LIMIT);
  assert.equal(bucket().request_count, limiter.LOGIN_START_GLOBAL_LIMIT);
  assert.equal(Object.keys(JSON.parse(bucket().client_counts_json)).length, limiter.LOGIN_START_GLOBAL_LIMIT);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM oauth_start_rate_limits").get().count, 1);
  const before = sqlite.prepare("SELECT * FROM oauth_transactions ORDER BY state_hash").all();
  assert.equal((await start({ ip: "203.0.113.100" })).status, 429);
  assert.deepEqual(sqlite.prepare("SELECT * FROM oauth_transactions ORDER BY state_hash").all(), before);
});

test("window rollover clears old client keys in place and rejected requests do not extend the window", async () => {
  const now = 1_800_000_000_000;
  for (let index = 0; index < limiter.LOGIN_START_CLIENT_LIMIT; index += 1) {
    assert.equal((await limiter.claimLoginStartRateLimit(request(), now + index)).allowed, true);
  }
  assert.deepEqual(await limiter.claimLoginStartRateLimit(request(), now + 10_000), { allowed: false, retryAfterSeconds: 50 });
  assert.equal(bucket().window_started_at, now);
  const oldKeys = Object.keys(JSON.parse(bucket().client_counts_json));
  const result = await limiter.claimLoginStartRateLimit(request({ ip: "203.0.113.2" }), now + limiter.LOGIN_START_WINDOW_MS);
  assert.equal(result.allowed, true);
  assert.equal(bucket().request_count, 1);
  const newKeys = Object.keys(JSON.parse(bucket().client_counts_json));
  assert.equal(newKeys.length, 1);
  assert.notEqual(newKeys[0], oldKeys[0]);
});

test("client privacy uses HMAC only, canonicalizes IPv6, ignores spoofed XFF, and bounds malformed headers", async () => {
  const addr = "2001:db8::1";
  await start({ ip: addr });
  await start({ ip: "2001:0db8:0000:0000:0000:0000:0000:0001" });
  assert.deepEqual(Object.values(JSON.parse(bucket().client_counts_json)), [2]);
  for (let index = 0; index < limiter.LOGIN_START_CLIENT_LIMIT; index += 1) {
    assert.equal((await start({ ip: null, headers: { "X-Forwarded-For": `192.0.2.${index + 1}` } })).status, 200);
  }
  assert.equal((await start({ ip: "not-an-ip" })).status, 429);
  assert.equal((await start({ ip: "192.0.2.1, 192.0.2.2" })).status, 429);
  assert.equal((await start({ ip: "1".repeat(10_000) })).status, 429);
  const counts = JSON.parse(bucket().client_counts_json);
  assert.equal(Object.keys(counts).length, 2);
  assert.ok(Object.keys(counts).every((key) => /^[a-f0-9]{64}$/.test(key)));
  const serializedQueries = JSON.stringify(queries);
  assert.equal(serializedQueries.includes(addr), false);
  assert.equal(serializedQueries.includes("192.0.2."), false);
  assert.equal(serializedQueries.includes("not-an-ip"), false);
});

test("invalid provider, origin, JSON, consent and body size never reach the database", async () => {
  const checks = [
    [{ provider: "unsupported" }, 404],
    [{ headers: { Origin: "https://other.example" } }, 403],
    [{ headers: { "Content-Type": "text/plain" } }, 415],
    [{ payload: { ...accepted, termsAccepted: false } }, 400],
    [{ payload: { ...accepted, privacyVersion: "old" } }, 400],
    [{ body: "{" }, 400],
    [{ payload: { ...accepted, unused: "a".repeat(10_000) } }, 413],
  ];
  for (const [options, expected] of checks) {
    queries = [];
    const response = await start(options);
    assert.equal(response.status, expected);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(queries, []);
    assert.equal(transactionCount(), 0);
  }
});

test("GET remains a consent navigation without a quota claim, transaction or state cookie", async () => {
  const response = await route.GET(new Request("https://example.com/api/auth/naver?returnTo=/finance"), { params: { provider: "naver" } });
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get("location")).searchParams.get("login_consent"), "required");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(queries, []);
  assert.equal(transactionCount(), 0);
});

test("schema failures fail closed and retry initialization, without altering prior login transactions", async () => {
  await start();
  const priorTransactions = sqlite.prepare("SELECT * FROM oauth_transactions").all();
  globalThis.__boraOAuthStartTestDb = binding();
  failure = "CREATE TABLE IF NOT EXISTS oauth_start_rate_limits";
  const response = await start();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "login_start_rate_limit_unavailable" });
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.deepEqual(sqlite.prepare("SELECT * FROM oauth_transactions").all(), priorTransactions);
  failure = "";
  assert.equal((await start()).status, 200);
});

test("claim/read failures fail closed and do not create transactions or leak storage details", async () => {
  for (const operation of ["UPDATE oauth_start_rate_limits SET", "SELECT client_salt"]) {
    failure = operation;
    const response = await start();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "login_start_rate_limit_unavailable" });
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(transactionCount(), 0);
  }
});

test("unavailable binding and unsuccessful or indeterminate claims fail closed", async () => {
  const saved = globalThis.__boraOAuthStartTestDb;
  try {
    globalThis.__boraOAuthStartTestDb = undefined;
    assert.equal((await start()).status, 503);
  } finally {
    globalThis.__boraOAuthStartTestDb = saved;
  }
  for (const result of [
    { success: false, meta: { changes: 1 } },
    { success: true, meta: {} },
    { success: true, meta: { changes: 2 } },
  ]) {
    claimResult = result;
    const response = await start();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.equal(transactionCount(), 0);
  }
});

test("disabled or unconfigured authentication never consumes a login quota", async () => {
  const mode = process.env.AUTH_MODE;
  const client = process.env.NAVER_CLIENT_ID;
  try {
    process.env.AUTH_MODE = "sites";
    assert.equal((await start()).status, 404);
    process.env.AUTH_MODE = "external";
    delete process.env.NAVER_CLIENT_ID;
    assert.equal((await start()).status, 503);
    assert.deepEqual(queries, []);
  } finally {
    process.env.AUTH_MODE = mode;
    process.env.NAVER_CLIENT_ID = client;
  }
});

test("additive migration and runtime schemas agree and prohibit additional rows", async () => {
  const migrated = new DatabaseSync(":memory:");
  try {
    migrated.exec(await readFile(new URL("../drizzle/0027_oauth_start_rate_limit.sql", import.meta.url), "utf8"));
    assert.deepEqual(migrated.prepare("PRAGMA table_info(oauth_start_rate_limits)").all(), sqlite.prepare("PRAGMA table_info(oauth_start_rate_limits)").all());
    assert.throws(() => migrated.prepare("INSERT INTO oauth_start_rate_limits VALUES (2, 0, 0, '{}', 'synthetic')").run(), /CHECK constraint/);
  } finally { migrated.close(); }
});
