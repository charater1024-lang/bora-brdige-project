import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": root } },
  plugins: [{ name: "collection-health-workers", resolveId(id) {
    if (id === "cloudflare:workers") return "\0health-workers";
  }, load(id) { if (id === "\0health-workers") return "export const env = {};"; } }],
  server: { middlewareMode: true, watch: null },
});
const operations = await server.ssrLoadModule("/lib/public-data/operations-view.ts");
const retention = await server.ssrLoadModule("/lib/public-data/retention.ts");
const view = await server.ssrLoadModule("/lib/public-data/catalog-view.ts");
const { publicRefreshFailureCode } = await server.ssrLoadModule("/lib/public-data/service.ts");
test.after(() => server.close());
const now = Date.parse("2026-09-23T00:00:00Z");
const source = (id) => ({ id, status: "live", completeness: "complete", itemCount: 123,
  label: id, sourceUrl: "https://example.go.kr", errorCode: "private-provider-error" });
const payload = { categories: [], sources: [source("bizinfo"), source("current"), source("off"), source("missing")] };

test("old complete coverage cannot mask repeated collection failures", () => {
  const old = now - 23 * 86400_000;
  const result = operations.projectPublicCollectionHealth(payload, [
    { sourceId: "bizinfo", lastError: "private-provider-error", lastSuccessAt: old,
      lastAttemptAt: now - 1000, consecutiveFailures: 92, nextDueAt: now + 1000 },
    { sourceId: "current", lastError: null, lastSuccessAt: now - 1000, nextDueAt: now + 1000 },
    { sourceId: "off", lastError: "disabled_by_operator", lastSuccessAt: old },
  ], now);
  assert.equal(result.sources[0].collectionStatus, "delayed");
  assert.equal(result.sources[0].completeness, "complete");
  assert.equal(result.sources[0].itemCount, 123);
  assert.equal(result.sources[0].lastCollectedAt, new Date(old).toISOString());
  assert.deepEqual(result.sources.map((row) => row.collectionStatus), ["delayed", "current", "disabled", "unknown"]);
  const publicView = operations.redactPublicDashboardOperations({ ...result, sourceSchedules: ["private"] }, false);
  assert.equal(JSON.stringify(publicView).includes("private-provider-error"), false);
  assert.deepEqual(publicView.sourceSchedules, []);
  assert.equal(payload.sources[0].collectionStatus, undefined, "stored coverage is not mutated");
});

test("uncollected and overdue sources are not called current", () => {
  const result = operations.projectPublicCollectionHealth({ sources: [source("new"), source("late")] }, [
    { sourceId: "new", lastError: null, lastSuccessAt: null, lastAttemptAt: now + 1000 },
    { sourceId: "late", lastError: null, lastSuccessAt: now - 86400_000, nextDueAt: now - 7200_000 },
  ], now);
  assert.equal(result.sources[0].collectionStatus, "unavailable");
  assert.equal(result.sources[0].lastCollectionAttemptAt, null);
  assert.equal(result.sources[1].collectionStatus, "delayed");
});

test("refresh diagnostics use a closed vocabulary without provider error contents", () => {
  assert.equal(publicRefreshFailureCode("staging_read", new Error("public_backfill_complete_cardinality_invalid")),
    "refresh_failed_staging_read_staging_cardinality");
  assert.equal(publicRefreshFailureCode("provider_collect", new Error("https://provider.test/?apiKey=test-synthetic-secret")),
    "refresh_failed_provider_collect_unknown");
  for (const message of ["__proto__", "constructor", "toString"]) {
    assert.equal(publicRefreshFailureCode("staging_read", new Error(message)), "refresh_failed_staging_read_unknown");
  }
});

const item = (id, overrides = {}) => ({ id, category: "startup", title: "지원사업", summary: "공식 안내",
  source: "공식 기관", sourceUrl: "https://example.go.kr", tags: [],
  publishedAt: "2026-09-01", discoveredAt: "2026-09-01T00:00:00Z", lastVerifiedAt: "2026-09-22T00:00:00Z", ...overrides });

test("expired and verification-needed buckets are disjoint and preserve all records", () => {
  const rows = [item("bizinfo-expired", { expiresAt: "2026-09-22" }),
    item("bizinfo-unverified", { lastVerifiedAt: "2026-06-01T00:00:00Z" }),
    item("bizinfo-old", { publishedAt: "2024-01-01" }), item("bizinfo-open")];
  assert.deepEqual(retention.filterPublicInformationItems(rows, "expired", now).map((row) => row.id), ["bizinfo-expired"]);
  assert.deepEqual(retention.filterPublicInformationItems(rows, "review-needed", now).map((row) => row.id), ["bizinfo-unverified", "bizinfo-old"]);
  assert.deepEqual(retention.filterPublicInformationItems(rows, "active", now).map((row) => row.id), ["bizinfo-open"]);
  assert.equal(retention.filterPublicInformationItems(rows, "all", now).length, 4);
});

test("finance scopes have disjoint rows and one server pagination without supplemental duplication", () => {
  const rows = ["finlife-1", "loan-1", "ecos-1", "stock-1", "company-1", "dart-1"]
    .map((id) => item(id, { category: "finance", publishedAt: "2026-09-22" }));
  const dashboard = { categories: [{ id: "finance", items: rows, totalCount: 6, newCount: 0 }] };
  const outputs = ["products", "indicators", "market"].map((financeSection) =>
    view.filterAndPaginatePublicDashboard(dashboard, "finance", "active", 1, 10, now, { financeSection }, true).categories[0]);
  assert.deepEqual(outputs.map((row) => row.filteredTotalCount), [2, 1, 3]);
  assert.equal(new Set(outputs.flatMap((row) => row.items.map((item) => item.id))).size, 6);
  assert.equal(outputs.every((row) => row.supplementalItems === undefined), true);
});
