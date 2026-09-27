import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ configFile: false, appType: "custom", logLevel: "silent", server: { middlewareMode: true } });
const client = await server.ssrLoadModule("/lib/auth/client-requests.ts");
const providers = await server.ssrLoadModule("/lib/auth/providers.ts");
const originalFetch = globalThis.fetch;
const tokenInput = { provider: "naver", credentials: { clientId: "test-client", clientSecret: "test-client-secret" },
  redirectUri: "https://example.test/api/auth/callback/naver", state: "synthetic", code: "synthetic", codeVerifier: "synthetic" };
test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(async () => { globalThis.fetch = originalFetch; await server.close(); });

test("auth JSON deadline includes a stalled body even when fetch ignores cancellation", async () => {
  let signal;
  globalThis.fetch = async (_url, init) => {
    signal = init.signal;
    return { ok: true, status: 200, json: () => new Promise(() => {}) };
  };
  await assert.rejects(client.fetchAuthJson("/api/account", {}, 15), { name: "TimeoutError" });
  assert.equal(signal.aborted, true);
});

test("upstream abort after headers prevents a late body from being accepted", async () => {
  let resolveBody;
  let bodyStarted;
  const started = new Promise((resolve) => { bodyStarted = resolve; });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: () => {
    bodyStarted(); return new Promise((resolve) => { resolveBody = resolve; });
  } });
  const controller = new AbortController();
  const pending = client.fetchAuthJson("/api/account", { signal: controller.signal }, 1_000);
  await started;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  resolveBody({ private: "old principal synthetic fixture" });
  await Promise.resolve();
});

test("pre-aborted auth request never reaches fetch", async () => {
  globalThis.fetch = async () => assert.fail("network must not start");
  await assert.rejects(client.fetchAuthJson("/api/account", { signal: AbortSignal.abort() }), { name: "AbortError" });
});

test("only the exact cookie-cleared logout 503 contract completes local sign-out", () => {
  assert.equal(client.localLogoutCompleted({ ok: true, status: 200 }, { loggedOut: true }), true);
  assert.equal(client.localLogoutCompleted({ ok: false, status: 503 }, { loggedOut: true, storageAvailable: false }), true);
  for (const payload of [null, {}, { loggedOut: "true", storageAvailable: false }, { loggedOut: true }, { loggedOut: true, storageAvailable: true }]) {
    assert.equal(client.localLogoutCompleted({ ok: false, status: 503 }, payload), false);
  }
  assert.equal(client.localLogoutCompleted({ ok: false, status: 403 }, { loggedOut: true, storageAvailable: false }), false);
});

test("provider body without Content-Length is cancelled at the byte limit", async () => {
  let cancelled = 0;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(600_000)); controller.enqueue(new Uint8Array(400_001)); },
    cancel() { cancelled += 1; },
  }));
  await assert.rejects(providers.exchangeAuthorizationCode(tokenInput), { code: "provider_response_too_large" });
  assert.equal(cancelled, 1);
});

test("provider announced oversized body is rejected without reading it", async () => {
  let cancelled = 0;
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled += 1; } }), {
    headers: { "Content-Length": "1000001" },
  });
  await assert.rejects(providers.exchangeAuthorizationCode(tokenInput), { code: "provider_response_too_large" });
  assert.equal(cancelled, 1);
});

test("provider JSON accepts split UTF-8 chunks without corrupting profile fields", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ resultcode: "00", response: { id: "fixture", nickname: "보리" } }));
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
  const profile = await providers.fetchOAuthProfile("naver", "synthetic-token");
  assert.equal(profile.nickname, "보리");
});

test("provider redirects remain rejected and are not followed", async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    assert.equal(init.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://outside.example/" } });
  };
  await assert.rejects(providers.exchangeAuthorizationCode(tokenInput), { code: "provider_redirect_rejected" });
  assert.equal(calls, 1);
});

test("provider body deadline cancels a stuck stream after headers", async () => {
  const originalTimeout = AbortSignal.timeout;
  const controller = new AbortController();
  let bodyStarted;
  const started = new Promise((resolve) => { bodyStarted = resolve; });
  let cancelled = 0;
  AbortSignal.timeout = () => controller.signal;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull() { bodyStarted(); }, cancel() { cancelled += 1; },
  }));
  try {
    const pending = providers.exchangeAuthorizationCode(tokenInput);
    await started;
    controller.abort();
    await assert.rejects(pending, { code: "provider_unavailable" });
    assert.equal(cancelled, 1);
  } finally { AbortSignal.timeout = originalTimeout; }
});
