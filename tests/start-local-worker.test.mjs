import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { localWorkerOptions } from "../scripts/local-worker-options.mjs";
import {
  createRuntimeRecoveryVerifier,
  runtimeErrorMessage,
} from "../scripts/local-worker-recovery.mjs";

const runnerUrl = new URL("../scripts/start-local-worker.mjs", import.meta.url);

test("local runner bypasses the development proxy using pinned Miniflare", async () => {
  const source = await readFile(runnerUrl, "utf8");

  assert.match(source, /unstable_getMiniflareWorkerOptions/u);
  assert.match(source, /wranglerRequire\.resolve\("miniflare"\)/u);
  assert.match(source, /new Miniflare/u);
  assert.match(source, /envFiles:\s*\[\]/u);
  assert.doesNotMatch(source, /unstable_startWorker|inspectorPort:|watch:\s*true/u);
  assert.doesNotMatch(source, /wrangler(?:\.js)?["']?\s+dev/u);
});

test("local worker runner preserves orderly shutdown", async () => {
  const source = await readFile(runnerUrl, "utf8");

  assert.match(source, /rawListeners\(signal\)/u);
  assert.match(source, /removeListener\(signal, listener\)/u);
  assert.match(source, /runningWorker\?\.dispose\(\)/u);
  assert.match(source, /process\.on\("SIGTERM"/u);
  assert.match(source, /dispose_timeout/u);
});

test("direct runtime preserves bindings, assets, DB namespace and explicit modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "bora-runtime-options-"));
  try {
    await mkdir(join(root, "server/ssr"), { recursive: true });
    await writeFile(join(root, "server/index.js"), "export default {};");
    await writeFile(join(root, "server/ssr/lazy.mjs"), "export const lazy = true;");
    await writeFile(join(root, "server/wrangler.runtime.json"), '{"vars":{}}');
    const bindingOptions = { bindings: { TEST: "synthetic" }, d1Databases: { DB: "synthetic-id" }, assets: { directory: join(root, "client") } };
    const converted = { main: join(root, "server/index.js"), workerOptions: bindingOptions, externalWorkers: [] };
    const options = await localWorkerOptions(converted, { hostname: "127.0.0.1", port: 13090, persistencePath: join(root, "state") });
    assert.equal(options.d1Persist, resolve(root, "state/v3/d1"));
    assert.equal(options.host, "127.0.0.1");
    assert.equal(options.inspectorPort, undefined);
    assert.equal(options.workers[0].bindings, bindingOptions.bindings);
    assert.equal(options.workers[0].assets, bindingOptions.assets);
    assert.equal(options.workers[0].d1Databases, bindingOptions.d1Databases);
    assert.deepEqual(options.workers[0].modules, [
      { type: "ESModule", path: converted.main },
      { type: "ESModule", path: join(root, "server/ssr/lazy.mjs") },
    ]);
    await assert.rejects(localWorkerOptions(converted, { hostname: "0.0.0.0", port: 13090, persistencePath: join(root, "state") }), /loopback_host_required/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runtime errors retain the nested ProxyWorker cause without multiline logs", () => {
  assert.equal(runtimeErrorMessage({
    cause: { cause: { message: "  downstream\nresponse\tfailed  " }, message: "wrapper" },
    reason: "proxy",
  }), "downstream response failed");
  assert.equal(runtimeErrorMessage({ cause: { message: "" }, reason: "proxy failure" }), "proxy failure");
  assert.equal(runtimeErrorMessage({}), "worker_runtime_error");
  assert.equal(runtimeErrorMessage({ message: "x".repeat(700) }).length, 500);
});

test("runtime recovery restarts only after three failed readiness probes", async () => {
  let healthChecks = 0;
  let waits = 0;
  let recoveries = 0;
  const verify = createRuntimeRecoveryVerifier({
    isHealthy: async () => { healthChecks += 1; return false; },
    onHealthy: async () => assert.fail("persistent failure cannot be healthy"),
    onUnhealthy: async () => { recoveries += 1; },
    delayMs: 0,
    wait: async () => { waits += 1; },
  });

  assert.equal(await verify(), true);
  assert.equal(healthChecks, 3);
  assert.equal(waits, 2);
  assert.equal(recoveries, 1);
});

test("concurrent runtime errors share one successful readiness probe", async () => {
  let healthChecks = 0;
  let healthyCallbacks = 0;
  let releaseHealth;
  const health = new Promise((resolveHealth) => { releaseHealth = resolveHealth; });
  const verify = createRuntimeRecoveryVerifier({
    isHealthy: async () => { healthChecks += 1; return health; },
    onHealthy: async (attempt) => { assert.equal(attempt, 1); healthyCallbacks += 1; },
    onUnhealthy: async () => assert.fail("healthy runtime cannot restart"),
  });

  const first = verify();
  const second = verify();
  assert.equal(first, second);
  releaseHealth(true);
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(healthChecks, 1);
  assert.equal(healthyCallbacks, 1);
});

test("local worker runner rejects unsafe listening options before startup", () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(runnerUrl), "--host", "0.0.0.0", "--port", "3000"],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /loopback_host_required/u);
});
