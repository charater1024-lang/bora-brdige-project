import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const key = Symbol.for("bora.auth.readiness.synthetic");
let calls = 0, action = async () => ({ tableCount: 5 });
globalThis[key] = { prepare() { return { first() { calls++; return action(); } }; } };
const server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  server: { middlewareMode: true, hmr: false, watch: null },
  plugins: [{ name: "mock-readiness-d1", enforce: "pre",
    resolveId(id) { return id === "cloudflare:workers" ? "\0readiness-d1" : null; },
    load(id) { return id === "\0readiness-d1" ? 'export const env = { DB: globalThis[Symbol.for("bora.auth.readiness.synthetic")] };' : null; },
  }],
});
const { authStorageIsReady } = await server.ssrLoadModule("/lib/auth/store.ts");
after(async () => { delete globalThis[key]; await server.close(); });

test("readiness performs a fresh DB operation after schema initialization", async () => {
  assert.equal(await authStorageIsReady(), true);
  const initialized = calls;
  assert.equal(await authStorageIsReady(), true);
  assert.equal(calls, initialized + 1);
  action = async () => { throw new Error("private database details"); };
  assert.equal(await authStorageIsReady(), false);
  action = async () => ({ tableCount: 4 });
  assert.equal(await authStorageIsReady(), false);
  action = async () => ({ tableCount: 5 });
  assert.equal(await authStorageIsReady(), true);
});

test("a stuck D1 probe times out and concurrent/repeated probes do not enqueue more SQL", async () => {
  let release;
  action = () => new Promise(resolve => { release = resolve; });
  const before = calls;
  const results = await Promise.all([authStorageIsReady(), authStorageIsReady(), authStorageIsReady()]);
  assert.deepEqual(results, [false, false, false]);
  assert.equal(calls, before + 1);
  assert.equal(await authStorageIsReady(), false);
  assert.equal(calls, before + 1);
  release({ tableCount: 5 });
  await new Promise(resolve => setImmediate(resolve));
  action = async () => ({ tableCount: 5 });
  assert.equal(await authStorageIsReady(), true);
});
