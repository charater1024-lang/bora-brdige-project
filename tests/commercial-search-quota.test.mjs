import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

// Actual production SQL runs on an isolated in-memory SQLite database. Only
// Cloudflare binding, secret lookup and the provider transport are synthetic.
const sqlite = new DatabaseSync(":memory:");
const key = Symbol.for("bora.commercial.quota.synthetic");
const prior = globalThis[key], priorFetch = globalThis.fetch, priorNow = Date.now;
let now = Date.parse("2026-08-31T15:01:00Z"), providerCalls = 0, networkCalls = 0, failAllowance = false;
Date.now = () => now;
globalThis.fetch = async () => { networkCalls++; throw new Error("external_network_forbidden"); };
function statement(sql, values = []) {
  const execute = () => {
    if (failAllowance && /INSERT INTO commercial_search_rate_limits/u.test(sql)) throw new Error("synthetic_allowance_storage_failure");
    const result = sqlite.prepare(sql).run(...values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  };
  return {
    bind(...args) { return statement(sql, args); },
    async first(column) { const row = sqlite.prepare(sql).get(...values) ?? null; return column && row ? row[column] : row; },
    async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
    async run() { return execute(); },
    execute,
  };
}
const database = {
  prepare: statement,
  async batch(statements) {
    sqlite.exec("BEGIN IMMEDIATE");
    try { const result = statements.map(value => value.execute()); sqlite.exec("COMMIT"); return result; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  },
};
globalThis[key] = {
  database,
  async provider() { providerCalls++; return { items: [{ bizesId: "synthetic-store", bizesNm: "합성 점포" }], totalCount: 1, totalCountProvided: true }; },
};
const loaded = new Set();
const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": root } }, server: { middlewareMode: true, watch: null },
  plugins: [{ name: "isolated-commercial-transport", enforce: "pre",
    resolveId(id) {
      const path = id.replaceAll("\\", "/").replace(/\.(?:ts|js)$/u, "");
      const kind = path === "cloudflare:workers" ? "binding"
        : path.endsWith("/lib/runtime-settings") ? "secret"
        : path === "./adapters" || path.endsWith("/lib/public-data/adapters") ? "provider" : null;
      return kind ? `\0commercial-fixture:${kind}` : null;
    },
    load(id) {
      if (!id.startsWith("\0commercial-fixture:")) return null;
      const kind = id.split(":").at(-1); loaded.add(kind);
      const state = 'globalThis[Symbol.for("bora.commercial.quota.synthetic")]';
      if (kind === "binding") return `export const env={DB:${state}.database};`;
      if (kind === "secret") return 'export async function runtimeSecret(){return "synthetic-placeholder-not-a-key";}';
      return `export const dataGoJson=(...args)=>${state}.provider(...args);`;
    },
  }],
});
const search = await server.ssrLoadModule("/lib/public-data/commercial-store-search.ts");
const cache = await server.ssrLoadModule("/lib/public-data/cache.ts");
const policies = await server.ssrLoadModule("/lib/public-data/policies.ts");
const policy = policies.publicSourcePolicy("commercial-area");
const allowed = Math.min(Math.floor(policy.dailyLimit * policies.PUBLIC_API_MANUAL_RATIO),
  Math.floor(policy.dailyLimit * policies.PUBLIC_API_AUTOMATIC_RATIO) - policy.estimatedCalls);
const lookup = (userId = "synthetic-user", page = 1) => search.searchCommercialStores({ userId, provinceCode: "11", page, pageSize: 10 });
const row = () => sqlite.prepare("SELECT * FROM public_api_source_state WHERE source_id='commercial-area'").get();
const reservations = () => sqlite.prepare("SELECT count(*) AS n FROM public_api_interactive_reservations").get().n;
const allowances = () => {
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='commercial_search_rate_limits'").get()) return 0;
  return sqlite.prepare("SELECT coalesce(sum(request_count),0) AS n FROM commercial_search_rate_limits").get().n;
};
await cache.ensurePublicSourceStates([policy], policies.kstQuotaDay(now), now);
for (const kind of ["binding", "secret", "provider"]) assert.ok(loaded.has(kind), `synthetic ${kind} must be loaded`);
test.beforeEach(async () => {
  failAllowance = false; providerCalls = 0; now = Date.parse("2026-08-31T15:01:00Z");
  for (const table of ["public_api_source_state", "public_api_interactive_reservations", "commercial_search_cache", "commercial_search_rate_limits"]) {
    if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table)) sqlite.exec(`DELETE FROM ${table}`);
  }
  await cache.ensurePublicSourceStates([policy], policies.kstQuotaDay(now), now);
});
test.after(async () => {
  await server.close(); sqlite.close(); Date.now = priorNow; globalThis.fetch = priorFetch;
  if (prior === undefined) delete globalThis[key]; else globalThis[key] = prior;
  assert.equal(networkCalls, 0);
});

test("producer KST compact date reaches actual reservation SQL and completed search uses one call", async () => {
  assert.equal(policies.kstQuotaDay(now), "20260901");
  const result = await lookup();
  assert.equal(result.items.length, 1);
  assert.equal(providerCalls, 1);
  assert.equal(row().used_calls, 1); assert.equal(row().reserved_calls, 0);
  assert.equal(reservations(), 0); assert.equal(allowances(), 1);
});

test("shared cache hit consumes neither another provider call nor another user's allowance", async () => {
  await lookup();
  const result = await lookup("second-synthetic-user");
  assert.equal(result.meta.cached, true);
  assert.equal(providerCalls, 1); assert.equal(row().used_calls, 1);
  assert.equal(allowances(), 1); assert.equal(row().reserved_calls, 0);
});

test("provider quota and active backoff rejection never increment member search allowance", async () => {
  sqlite.prepare("UPDATE public_api_source_state SET used_calls=?").run(allowed);
  await assert.rejects(lookup(), error => error.code === "commercial_search_quota_protected");
  assert.equal(providerCalls, 0); assert.equal(allowances(), 0); assert.equal(reservations(), 0);
  sqlite.prepare("UPDATE public_api_source_state SET used_calls=0,backoff_until=?,last_error='synthetic-backoff'").run(now + 60_000);
  await assert.rejects(lookup(), error => error.code === "commercial_search_quota_protected");
  assert.equal(providerCalls, 0); assert.equal(allowances(), 0); assert.equal(row().reserved_calls, 0);
});

test("member allowance rejection releases unused reservation without changing provider error state", async () => {
  // Initialize the real search schema, then discard the successful sample.
  await lookup();
  sqlite.exec("DELETE FROM commercial_search_cache; DELETE FROM commercial_search_rate_limits;");
  providerCalls = 0;
  sqlite.prepare("UPDATE public_api_source_state SET used_calls=0,last_error='historical-error',backoff_until=?,consecutive_failures=2").run(now - 1);
  sqlite.prepare("INSERT INTO commercial_search_rate_limits VALUES(?,?,20,?)").run("synthetic-user", Math.floor(now / 3_600_000) * 3_600_000, now);
  await assert.rejects(lookup(), error => error.code === "commercial_search_rate_limited");
  assert.equal(providerCalls, 0); assert.equal(row().used_calls, 0); assert.equal(row().reserved_calls, 0);
  assert.equal(reservations(), 0); assert.equal(allowances(), 20);
  assert.equal(row().last_error, "historical-error"); assert.equal(row().backoff_until, now - 1);
  assert.equal(row().consecutive_failures, 2);
});

test("allowance SQL failure releases unused reservation and does not call provider", async () => {
  failAllowance = true;
  await assert.rejects(lookup(), error => error.code === "commercial_search_storage_unavailable");
  assert.equal(row().used_calls, 0); assert.equal(row().reserved_calls, 0);
  assert.equal(reservations(), 0); assert.equal(allowances(), 0); assert.equal(providerCalls, 0);
});

test("KST rollover resets the ledger and rejects malformed or mismatched reservation days", async () => {
  now = Date.parse("2026-09-01T14:59:59Z");
  await cache.ensurePublicSourceStates([policy], policies.kstQuotaDay(now), now);
  sqlite.prepare("UPDATE public_api_source_state SET used_calls=?").run(allowed);
  now += 1_000;
  assert.equal(policies.kstQuotaDay(now), "20260902");
  await cache.ensurePublicSourceStates([policy], policies.kstQuotaDay(now), now);
  assert.equal(row().used_calls, 0);
  for (const quotaDay of ["2026-09-02", "20260230", "20261301", "20260901", "", "20260902x"]) {
    await assert.rejects(cache.reserveInteractivePublicSourceCalls({ sourceId: "commercial-area", quotaDay, estimatedCalls: 1, allowedCalls: 1, now }), /public_interactive_reservation_invalid/u);
  }
  const reservation = await cache.reserveInteractivePublicSourceCalls({ sourceId: "commercial-area", quotaDay: policies.kstQuotaDay(now), estimatedCalls: 1, allowedCalls: 1, now });
  assert.ok(reservation);
  assert.equal(await cache.completeInteractivePublicSourceCalls({ reservation, actualCalls: 1, successful: true, now }), true);
  assert.equal(row().used_calls, 1); assert.equal(row().reserved_calls, 0);
  assert.equal(await cache.completeInteractivePublicSourceCalls({ reservation, actualCalls: 1, successful: true, now }), false);
  assert.equal(row().used_calls, 1);
});

test("concurrent different users cannot claim the last provider allowance twice", async () => {
  sqlite.prepare("UPDATE public_api_source_state SET used_calls=?").run(allowed - 1);
  const outcomes = await Promise.allSettled([lookup("user-one", 1), lookup("user-two", 2)]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(result => result.status === "rejected").length, 1);
  assert.equal(providerCalls, 1); assert.equal(row().used_calls, allowed);
  assert.equal(row().reserved_calls, 0); assert.equal(reservations(), 0); assert.equal(allowances(), 1);
});
