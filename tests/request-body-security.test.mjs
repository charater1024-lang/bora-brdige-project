import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test, { after } from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const virtualPrefix = "\0request-body-test:";
const mocks = {
  "@/lib/auth/current-user": `
    export async function authenticatedUser() {
      return globalThis.__boraBodyTestAuthenticated === false ? null : { id: 'synthetic-user' };
    }
  `,
  "@/lib/auth/developer-access": "export async function isDeveloperUser() { return true; }",
  "@/lib/auth/account-lifecycle": `
    export class AccountLifecycleError extends Error {}
    export async function requireCurrentRequiredConsent() {}
  `,
};
const server = await createServer({
  root, configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: [
    ...Object.keys(mocks).map((key) => ({ find: key, replacement: virtualPrefix + key })),
    { find: "@", replacement: root },
  ] },
  plugins: [{
    name: "request-body-test-auth", enforce: "pre",
    resolveId(source) {
      return source.startsWith(virtualPrefix) ? source : null;
    },
    load(id) { return id.startsWith(virtualPrefix) ? mocks[id.slice(virtualPrefix.length)] : null; },
  }],
  server: { middlewareMode: true },
});
const helper = await server.ssrLoadModule("/lib/http/request-body.ts");
after(async () => {
  delete globalThis.__boraBodyTestAuthenticated;
  await server.close();
});

function streamedRequest(url, { method = "POST", chunks = 16, size = 65_536, headers = {}, cancelNeverResolves = false } = {}) {
  const state = { pulls: 0, cancelled: false };
  const stream = new ReadableStream({
    pull(controller) {
      if (state.pulls === chunks) { controller.close(); return; }
      state.pulls += 1;
      controller.enqueue(new Uint8Array(size).fill(32));
    },
    cancel() {
      state.cancelled = true;
      if (cancelNeverResolves) return new Promise(() => {});
    },
  }, { highWaterMark: 0 });
  return { state, request: new Request(url, {
    method, body: stream, duplex: "half",
    headers: { "Content-Type": "application/json", Origin: new URL(url).origin, ...headers },
  }) };
}

test("stream byte cap stops a forged-small or absent Content-Length before full allocation", async () => {
  for (const headers of [{}, { "Content-Length": "1" }, { "Content-Length": "not-a-number" }]) {
    const { request, state } = streamedRequest("https://borabridge.example/api/test", { size: 1024, headers });
    await assert.rejects(helper.readBoundedRequestText(request, { maxBytes: 2048 }),
      (error) => error.code === "request_too_large" && error.status === 413);
    assert.equal(state.pulls, 3);
    assert.equal(state.cancelled, true);
  }
});

test("oversized declared lengths are rejected without reading and cancellation cannot stall rejection", async () => {
  for (const length of ["4096", "9".repeat(400)]) {
    const { request, state } = streamedRequest("https://borabridge.example/api/test", {
      headers: { "Content-Length": length }, cancelNeverResolves: true,
    });
    await assert.rejects(helper.readBoundedRequestText(request, { maxBytes: 2048 }),
      (error) => error.status === 413);
    assert.equal(state.pulls, 0);
    assert.equal(state.cancelled, true);
  }
  const { request, state } = streamedRequest("https://borabridge.example/api/test", { cancelNeverResolves: true });
  await assert.rejects(helper.readBoundedRequestText(request, { maxBytes: 2048 }),
    (error) => error.status === 413);
  assert.equal(state.cancelled, true);
});

test("UTF-8 byte accounting and existing character limits both apply across split multibyte chunks", async () => {
  const text = JSON.stringify({ label: "서울😀" });
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  const request = new Request("https://borabridge.example/api/test", { method: "POST", body: stream, duplex: "half" });
  assert.equal(await helper.readBoundedRequestText(request, { maxBytes: bytes.length, maxChars: text.length }), text);
  await assert.rejects(helper.readBoundedRequestText(new Request(request.url, { method: "POST", body: text }),
    { maxBytes: bytes.length - 1 }), (error) => error.status === 413);
  await assert.rejects(helper.readBoundedRequestText(new Request(request.url, { method: "POST", body: text }),
    { maxBytes: bytes.length, maxChars: text.length - 1 }), (error) => error.status === 413);
});

test("valid JSON is preserved and invalid JSON, UTF-8, or stream failures become safe 400 errors", async () => {
  for (const value of [{ value: "한글", enabled: true }, [], null, 42]) {
    const request = new Request("https://borabridge.example/api/test", { method: "POST", body: JSON.stringify(value) });
    assert.deepEqual(await helper.readBoundedRequestJson(request, { maxBytes: 100 }), value);
  }
  for (const body of ["{", Uint8Array.of(0xff)]) {
    await assert.rejects(helper.readBoundedRequestJson(new Request("https://borabridge.example/api/test", { method: "POST", body }),
      { maxBytes: 100 }), (error) => error.status === 400 && !error.message.includes("ff"));
  }
  const stream = new ReadableStream({ pull(controller) { controller.error(new Error("private upstream detail")); } });
  await assert.rejects(helper.readBoundedRequestText(new Request("https://borabridge.example/api/test", {
    method: "POST", body: stream, duplex: "half",
  }), { maxBytes: 100 }), (error) => error.status === 400 && error.message === "invalid_request");
});

test("the 8,000,000-byte import budget is accepted exactly and its next byte is rejected", async () => {
  const accepted = streamedRequest("https://borabridge.example/api/import", { chunks: 128, size: 62_500 });
  assert.equal((await helper.readBoundedRequestText(accepted.request, { maxBytes: 8_000_000 })).length, 8_000_000);
  const rejected = streamedRequest("https://borabridge.example/api/import", { chunks: 129, size: 62_500 });
  await assert.rejects(helper.readBoundedRequestText(rejected.request, { maxBytes: 8_000_000 }),
    (error) => error.status === 413);
  assert.equal(rejected.state.cancelled, true);
});

test("the shared account reader preserves its error API and rejects streams early", async () => {
  const account = await server.ssrLoadModule("/lib/auth/account-lifecycle.ts");
  const { request, state } = streamedRequest("https://borabridge.example/api/account");
  await assert.rejects(account.readBoundedAccountJson(request), (error) => error.code === "request_too_large");
  assert.equal(state.cancelled, true);
  assert.ok(state.pulls < 16);
});

const routeCases = [
  ["/api/legal/financial", "POST"],
  ["/api/legal/financial/summary", "POST"],
  ["/api/public-data/product-recommendations", "POST"],
  ["/api/ai", "POST"],
  ["/api/ai/context", "PUT"],
  ["/api/ai/history", "DELETE"],
  ["/api/public-data/item-analysis", "POST"],
  ["/api/public-data/commercial-search", "POST"],
  ["/api/public-data/refresh", "POST"],
  ["/api/public-data/read", "POST"],
  ["/api/developer/settings", "PUT"],
  ["/api/developer/settings", "DELETE"],
  ["/api/developer/explanation-cache", "DELETE"],
];

for (const [route, method] of routeCases) {
  test(`${method} ${route} cancels an oversized stream and rejects malformed JSON before any business action`, async () => {
    const routeModule = await server.ssrLoadModule(`/app${route}/route.ts`);
    const { request, state } = streamedRequest(`https://borabridge.example${route}`, { method, headers: { "Content-Length": "1" } });
    const response = await routeModule[method](request);
    assert.equal(response.status, 413);
    assert.equal((await response.json()).error, "request_too_large");
    assert.equal(state.cancelled, true);
    assert.ok(state.pulls < 16, "must not consume the whole 1 MiB request");
    const malformed = await routeModule[method](new Request(request.url, { method,
      headers: { "Content-Type": "application/json", Origin: "https://borabridge.example" }, body: "{",
    }));
    assert.equal(malformed.status, 400);
  });
}

test("authentication and CSRF rejection still precede body consumption", async () => {
  const ai = await server.ssrLoadModule("/app/api/ai/route.ts");
  const legal = await server.ssrLoadModule("/app/api/legal/financial/route.ts");
  globalThis.__boraBodyTestAuthenticated = false;
  try {
    const { request, state } = streamedRequest("https://borabridge.example/api/ai");
    assert.equal((await ai.POST(request)).status, 401);
    assert.equal(state.pulls, 0);
    void request.body.cancel();
  } finally { delete globalThis.__boraBodyTestAuthenticated; }
  const { request, state } = streamedRequest("https://borabridge.example/api/legal/financial", { headers: { Origin: "https://evil.example" } });
  assert.equal((await legal.POST(request)).status, 403);
  assert.equal(state.pulls, 0);
  void request.body.cancel();
});

test("all API raw text/JSON readers use bounded helpers and the Seoul import keeps its 8 MB budget", async () => {
  async function files(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => entry.isDirectory()
      ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
  }
  for (const file of await files(path.join(root, "app/api"))) {
    if (!file.endsWith(".ts")) continue;
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\brequest\.(?:text|json|formData)\s*\(/u, path.relative(root, file));
  }
  const importSource = await readFile(path.join(root, "app/api/public-data/import/seoul-commercial/route.ts"), "utf8");
  assert.match(importSource, /MAX_BODY_BYTES = 8_000_000/u);
  assert.match(importSource, /readBoundedRequestText\(request, \{ maxBytes: MAX_BODY_BYTES \}\)/u);
});
