import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const database = new DatabaseSync(":memory:");
let failDelete = false;
function prepare(sql, parameters = []) {
  function execute(method) {
    if (failDelete && sql.startsWith("DELETE FROM auth_sessions WHERE token_hash")) throw new Error("synthetic private storage failure");
    const statement = database.prepare(sql);
    if (method === "first") return statement.get(...parameters) ?? null;
    if (method === "all") return { results: statement.all(...parameters) };
    return { success: true, meta: { changes: Number(statement.run(...parameters).changes) } };
  }
  return { bind: (...values) => prepare(sql, values), first: async () => execute("first"),
    all: async () => execute("all"), run: async () => execute("run"), execute };
}
globalThis.__authCallbackFixture = { prepare, batch: async (statements) => {
  database.exec("BEGIN");
  try { const result = statements.map((statement) => statement.execute("run")); database.exec("COMMIT"); return result; }
  catch (error) { database.exec("ROLLBACK"); throw error; }
} };
const names = ["AUTH_MODE", "APP_BASE_URL", "NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET", "NAVER_REDIRECT_URI",
  "KAKAO_REST_API_KEY", "KAKAO_CLIENT_SECRET", "KAKAO_REDIRECT_URI", "AUTH_SESSION_TTL_SECONDS"];
const previous = new Map(names.map((name) => [name, process.env[name]]));
for (const name of names) delete process.env[name];
Object.assign(process.env, { AUTH_MODE: "external", APP_BASE_URL: "https://example.test",
  NAVER_CLIENT_ID: "test-client", NAVER_CLIENT_SECRET: "test-client-secret", KAKAO_REST_API_KEY: "test-kakao" });
const originalFetch = globalThis.fetch;
const originalError = console.error;
let networkCalls = [], consentCalls = [], failToken = false;
globalThis.__authCallbackConsent = (input) => consentCalls.push(input);
const server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": root } },
  plugins: [{ name: "callback-isolated-bindings", enforce: "pre",
    resolveId(id) {
      if (id === "cloudflare:workers") return "\0callback-workers";
      if (id.endsWith("/lib/auth/account-lifecycle") || id === "@/lib/auth/account-lifecycle") return "\0callback-consent";
    },
    load(id) {
      if (id === "\0callback-workers") return "export const env = { DB: globalThis.__authCallbackFixture };";
      if (id === "\0callback-consent") return `
        export const CURRENT_TERMS_VERSION = 'synthetic-terms';
        export const CURRENT_PRIVACY_VERSION = 'synthetic-privacy';
        export async function acceptRequiredConsents(input) { globalThis.__authCallbackConsent(input); }
        export async function getRequiredConsentState() { return { accepted: true }; }
      `;
    },
  }], server: { middlewareMode: true },
});
const callback = await server.ssrLoadModule("/app/api/auth/callback/[provider]/route.ts");
const logout = await server.ssrLoadModule("/app/api/auth/logout/route.ts");
const store = await server.ssrLoadModule("/lib/auth/store.ts");
const policy = await server.ssrLoadModule("/lib/auth/consent-policy.ts");
const crypto = await server.ssrLoadModule("/lib/auth/crypto.ts");
await store.ensureAuthSchema();

test.beforeEach(() => {
  failDelete = false; failToken = false; networkCalls = []; consentCalls = [];
  database.exec("DELETE FROM auth_sessions; DELETE FROM oauth_transactions;");
  console.error = () => {};
  globalThis.fetch = async (url, init = {}) => {
    networkCalls.push({ url: String(url), method: init.method ?? "GET" });
    if (url === "https://nid.naver.com/oauth2.0/token") {
      if (failToken) return new Response("rejected synthetic token", { status: 400 });
      assert.equal(init.redirect, "manual");
      return Response.json({ access_token: "test-provider-token" });
    }
    if (url === "https://openapi.naver.com/v1/nid/me") {
      return Response.json({ resultcode: "00", response: { id: "fixture-existing-member", nickname: "Synthetic Member" } });
    }
    throw new Error("Unexpected network target blocked by isolated test");
  };
});
test.after(async () => {
  globalThis.fetch = originalFetch; console.error = originalError;
  await server.close(); database.close();
  delete globalThis.__authCallbackFixture; delete globalThis.__authCallbackConsent;
  for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});

async function transaction(returnTo = "/") {
  const state = policy.currentOAuthConsentStatePrefix() + crypto.randomBase64Url(32);
  await store.createOAuthTransaction({ state, provider: "naver", codeVerifier: crypto.randomBase64Url(64),
    redirectUri: "https://example.test/api/auth/callback/naver", returnTo });
  return state;
}
function call(state, { cookie = state, provider = "naver", error, code = "synthetic-code", extra = "" } = {}) {
  const url = new URL(`https://example.test/api/auth/callback/${provider}`);
  url.searchParams.set("state", state);
  if (error) url.searchParams.set("error", error); else url.searchParams.set("code", code);
  if (extra) url.searchParams.set("returnTo", extra);
  return callback.GET(new Request(url, { headers: { Cookie: `bora_oauth_state_${provider}=${cookie}` } }),
    { params: Promise.resolve({ provider }) });
}
function sessions() { return database.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get().count; }
function assertRetry(response) {
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://example.test/mypage?auth=failed&auth_reason=login_retry_required");
  assert.match(response.headers.get("Set-Cookie"), /Max-Age=0/u);
  assert.match(response.headers.get("Cache-Control"), /no-store/u);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.doesNotMatch(response.headers.get("Set-Cookie"), /bora_session=/u);
}

test("missing or mismatched callback state recovers locally without authorizing or following a return query", async () => {
  const state = await transaction();
  assertRetry(await call(state, { cookie: "different", extra: "https://outside.example/" }));
  assertRetry(await call("", { cookie: "" }));
  assert.equal(sessions(), 0); assert.equal(networkCalls.length, 0); assert.equal(consentCalls.length, 0);
});

test("expired state and mismatched provider cannot create a session", async () => {
  const state = await transaction("/information/finance");
  database.prepare("UPDATE oauth_transactions SET expires_at = ?").run(Date.now() - 1);
  assertRetry(await call(state));
  const valid = await transaction();
  assertRetry(await call(valid, { provider: "kakao" }));
  assert.equal(sessions(), 0); assert.equal(networkCalls.length, 0);
});

test("normal callback creates one hashed session, clears state, and replay only offers retry", async () => {
  const state = await transaction("/information/finance?page=2");
  const response = await call(state);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "https://example.test/information/finance?page=2&auth=success");
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("bora_session="));
  for (const attribute of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/", "Max-Age=28800"]) assert.ok(cookie.includes(attribute));
  const token = cookie.split(";", 1)[0].split("=", 2)[1];
  assert.notEqual(database.prepare("SELECT token_hash FROM auth_sessions").get().token_hash, token);
  assert.equal(sessions(), 1); assert.equal(consentCalls.length, 1);
  assertRetry(await call(state));
  assert.equal(sessions(), 1); assert.equal(networkCalls.length, 2);
});

test("parallel callback replay consumes the transaction once", async () => {
  const state = await transaction();
  const results = await Promise.all([call(state), call(state)]);
  assert.equal(results.filter((response) => response.headers.get("Location").includes("auth=success")).length, 1);
  assert.equal(results.filter((response) => response.headers.get("Location").includes("login_retry_required")).length, 1);
  assert.equal(sessions(), 1); assert.equal(networkCalls.length, 2);
});

test("provider cancellation consumes only its transaction and keeps the existing session", async () => {
  await call(await transaction());
  networkCalls = [];
  const response = await call(await transaction("/mypage"), { error: "access_denied" });
  assert.equal(response.headers.get("Location"), "https://example.test/mypage?auth=cancelled");
  assert.equal(sessions(), 1); assert.equal(networkCalls.length, 0);
  assert.doesNotMatch(response.headers.get("Set-Cookie"), /bora_session=/u);
});

test("provider token failure is not retried and cannot persist a user session", async () => {
  failToken = true;
  const state = await transaction();
  const response = await call(state);
  assert.equal(response.headers.get("Location"), "https://example.test/?auth=failed&auth_reason=provider_rejected_request");
  assert.equal(sessions(), 0); assert.equal(networkCalls.length, 1); assert.equal(consentCalls.length, 0);
  assertRetry(await call(state));
  assert.equal(networkCalls.length, 1);
});

test("logout storage failure still clears the cookie but never claims server revocation", async () => {
  failDelete = true;
  const response = await logout.POST(new Request("https://example.test/api/auth/logout", {
    method: "POST", headers: { Origin: "https://example.test", Cookie: "bora_session=synthetic-session" },
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { loggedOut: true, storageAvailable: false });
  assert.match(response.headers.get("Set-Cookie"), /bora_session=;.*Max-Age=0; Secure/u);
});

test("cross-origin logout remains forbidden and does not clear a session cookie", async () => {
  const response = await logout.POST(new Request("https://example.test/api/auth/logout", {
    method: "POST", headers: { Origin: "https://outside.example", Cookie: "bora_session=synthetic-session" },
  }));
  assert.equal(response.status, 403); assert.equal(response.headers.get("Set-Cookie"), null);
});
