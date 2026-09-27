import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ root: process.cwd(), configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": process.cwd() } }, server: { middlewareMode: true } });
test.after(() => server.close());
const cache = await server.ssrLoadModule("/lib/public-data/cache.ts");
const view = await server.ssrLoadModule("/lib/public-data/catalog-view.ts");

function item(index, prefix = "kstartup") {
  return { id: `${prefix}-${String(index).padStart(5, "0")}`, category: prefix === "dart" ? "finance" : "startup",
    title: `공식 자료 ${index}`, summary: "공식 제공기관 원문 요약", source: "공식 제공기관",
    sourceUrl: "https://official.example/data", tags: [], publishedAt: "2026-08-01",
    discoveredAt: "2026-08-01T00:00:00Z", lastVerifiedAt: "2026-09-01T00:00:00Z" };
}

test("completed K-Startup and DART catalogues fit without silent retention", () => {
  assert.equal(cache.SOURCE_CATALOG_MAX_ITEMS, 50_000);
  const kstartup = Array.from({ length: 29_956 }, (_, index) => item(index));
  const dart = Array.from({ length: 22_963 }, (_, index) => item(index, "dart"));
  assert.equal(cache.boundPublicCatalogItems(kstartup).length, 29_956);
  assert.equal(cache.boundPublicCatalogItems(dart).length, 22_963);
  for (const [id, items] of [["kstartup", kstartup], ["dart", dart]]) {
    const source = view.projectCatalogRetentionCoverage({ id, label: id, status: "live", itemCount: items.length,
      sourceUrl: "https://official.example/data", providerTotalCount: items.length,
      fetchedCount: items.length, completeness: "complete" }, cache.SOURCE_CATALOG_MAX_ITEMS, items.length, items.length);
    assert.equal(source.status, "live");
    assert.equal(source.errorCode, undefined);
  }
});

test("retention remains deterministic and truthful above the bounded capacity", () => {
  const input = Array.from({ length: 50_003 }, (_, index) => ({ ...item(index),
    lastVerifiedAt: new Date(Date.parse("2026-09-01T00:00:00Z") - index * 1000).toISOString() }));
  const retained = cache.boundPublicCatalogItems([...input].reverse(), 50_000, Date.parse("2026-09-02T00:00:00Z"));
  assert.deepEqual(retained.slice(0, 3).map(({ id }) => id), ["kstartup-00000", "kstartup-00001", "kstartup-00002"]);
  assert.equal(retained.at(-1).id, "kstartup-49999");
  const source = view.projectCatalogRetentionCoverage({ id: "future-large", label: "large", status: "live",
    itemCount: input.length, sourceUrl: "https://official.example/data", providerTotalCount: input.length,
    fetchedCount: input.length, completeness: "complete" }, 50_000, input.length, retained.length);
  assert.equal(source.status, "truncated");
  assert.equal(source.errorCode, "catalog_retention_limit_reached");
});

test("an upstream paging window is not mislabeled as local retention loss", () => {
  const company = view.projectCatalogRetentionCoverage({ id: "financial-company", label: "금융회사", status: "truncated",
    itemCount: 1_011, sourceUrl: "https://official.example/data", providerTotalCount: 2_315_282,
    fetchedCount: 2_000, completeness: "truncated", errorCode: "provider_page_window_limit_reached" }, 50_000, 1_011, 1_011);
  assert.equal(company.status, "truncated");
  assert.equal(company.completeness, "truncated");
  assert.equal(company.errorCode, "provider_page_window_limit_reached");
});

test("upstream and local truncation remain jointly observable in the existing error field", () => {
  const source = view.projectCatalogRetentionCoverage({ id: "large-window", label: "large", status: "truncated",
    itemCount: 55_000, sourceUrl: "https://official.example/data", providerTotalCount: 80_000,
    fetchedCount: 60_000, completeness: "truncated", errorCode: "provider_page_window_limit_reached" },
  50_000, 55_000, 50_000);
  assert.equal(source.errorCode, "provider_page_window_and_catalog_retention_limit_reached");
});

test("100-item chunks stay below the existing response boundary with bounded excerpts", () => {
  const payload = { exchange: { rates: [], asOf: null, sourceUrl: "" }, market: [], sources: [], categories: [
    { id: "startup", items: Array.from({ length: 100 }, (_, index) => ({ ...item(index), summary: "가".repeat(1_300) })), totalCount: 100, newCount: 0 },
  ] };
  assert.ok(Buffer.byteLength(cache.serializePublicDataPayload(payload)) < cache.PUBLIC_SNAPSHOT_MAX_BYTES);
});

test("a completion flag cannot promote missing staged pages to a full catalogue", () => {
  const checkpoint = { sourceId: "kstartup", querySignature: "startup-v1-test", queryState: "{}",
    nextPage: 5, pageSize: 100, providerTotalCount: 350, fetchedCount: 350, completed: true,
    latestRefreshAt: 1, completedAt: 1, updatedAt: 1 };
  assert.doesNotThrow(() => cache.validateCompleteBackfillPages(checkpoint, new Set([0, 1, 2, 3, 4])));
  assert.throws(() => cache.validateCompleteBackfillPages(checkpoint, new Set([0, 1, 2, 4])), /missing_page/);
  assert.throws(() => cache.validateCompleteBackfillPages({ ...checkpoint, fetchedCount: 300 }, new Set([1, 2, 3, 4])), /complete_invalid/);
  assert.doesNotThrow(() => cache.validateCompleteBackfillPages({ ...checkpoint, completed: false }, new Set([1])));
});

test("completed backfill validates page and unique-item cardinality before replacement", () => {
  const checkpoint = { sourceId: "kstartup", querySignature: "startup-v1-test", queryState: "{}",
    nextPage: 4, pageSize: 100, providerTotalCount: 250, fetchedCount: 250, completed: true,
    latestRefreshAt: 1, completedAt: 1, updatedAt: 1 };
  const pages = new Set([0, 1, 2, 3]);
  assert.doesNotThrow(() => cache.validateCompleteBackfillPages(checkpoint, pages,
    new Map([[0, 20], [1, 100], [2, 100], [3, 50]]), 270));
  assert.throws(() => cache.validateCompleteBackfillPages(checkpoint, pages,
    new Map([[0, 20], [1, 100], [2, 99], [3, 50]]), 269), /cardinality_invalid/);
  assert.throws(() => cache.validateCompleteBackfillPages(checkpoint, pages,
    new Map([[0, 20], [1, 100], [2, 100], [3, 50]]), 249), /cardinality_invalid/);
});

test("legacy zero-first provider contracts resume without relaxing generic page integrity", () => {
  const base = { sourceId: "bizinfo", querySignature: "bizinfo-v1-synthetic", queryState: '{"version":2,"generation":"20260923"}',
    nextPage: 2, pageSize: 100, providerTotalCount: 67, fetchedCount: 67, completed: true,
    latestRefreshAt: 1, completedAt: 1, updatedAt: 1 };
  assert.doesNotThrow(() => cache.validateCompleteBackfillPages(base, new Set([0]), new Map([[0, 67]]), 67));
  const youth = { ...base, sourceId: "youth-center", querySignature: "youth-center-portal-v2-synthetic",
    queryState: '{"version":2,"mode":"portal","reconciliationDay":"20260923"}', nextPage: 29,
    providerTotalCount: 2745, fetchedCount: 2745 };
  const counts = new Map([[0, 100], ...Array.from({ length: 27 }, (_, index) => [index + 2, index === 26 ? 45 : 100])]);
  assert.doesNotThrow(() => cache.validateCompleteBackfillPages(youth, new Set(counts.keys()), counts, 2745));
  const broken = new Map(counts); broken.delete(15);
  assert.throws(() => cache.validateCompleteBackfillPages(youth, new Set(broken.keys()), broken, 2645), /missing_page/);
  assert.throws(() => cache.validateCompleteBackfillPages({ ...base, sourceId: "kstartup", querySignature: "startup-v1-kstartup-test" },
    new Set([0]), new Map([[0, 67]]), 67), /missing_page/);
  assert.throws(() => cache.validateCompleteBackfillPages({ ...base, queryState: "{}" },
    new Set([0]), new Map([[0, 67]]), 67), /missing_page/);
});

test("obsolete completed daily generations do not block fresh collection but current damage fails closed", () => {
  const base = { sourceId: "kstartup", querySignature: "startup-v1-kstartup-test", queryState: '{"version":2,"generation":"20260902"}',
    nextPage: 301, pageSize: 100, providerTotalCount: 29988, fetchedCount: 29988, completed: true,
    latestRefreshAt: 1, completedAt: 1, updatedAt: 1 };
  const now = Date.parse("2026-09-23T00:00:00Z");
  assert.equal(cache.shouldReadPublicBackfillStaging(base, now), false);
  assert.equal(cache.shouldReadPublicBackfillStaging({ ...base, completed: false }, now), true);
  const current = { ...base, queryState: '{"version":2,"generation":"20260923"}' };
  assert.equal(cache.shouldReadPublicBackfillStaging(current, now), true);
  const counts = new Map([[0, 100], ...Array.from({ length: 300 }, (_, index) => [index + 1, index === 299 ? 76 : 100])]);
  assert.throws(() => cache.validateCompleteBackfillPages(current, new Set(counts.keys()), counts, 29988), /cardinality_invalid/);
  assert.equal(cache.shouldReadPublicBackfillStaging({ ...base, queryState: "{}" }, now), true);
  assert.equal(cache.shouldReadPublicBackfillStaging({ ...base, queryState: '{"version":2,"generation":"20260000"}' }, now), true);
  assert.equal(cache.shouldReadPublicBackfillStaging({ ...base, queryState: '{"version":2,"generation":"20260924"}' }, now), true);
});

test("sectioned youth generations validate actual section slots and permit cross-section duplicates", () => {
  const sections = ["employment", "scholarship", "financial_support", "policy_news"].map((section) =>
    ({ section, initialized: true, completed: true, total: 2 }));
  const checkpoint = { sourceId: "youth-center", querySignature: "youth-center-open-v2-test",
    queryState: JSON.stringify({ version: 2, mode: "open-api", sections }), nextPage: 1, pageSize: 40,
    providerTotalCount: 8, fetchedCount: 8, completed: true, updatedAt: 1 };
  const legacy = new Map([[0, 2], [1, 2], [2, 2], [3, 2]]);
  assert.doesNotThrow(() => cache.validateCompleteBackfillPages(checkpoint, new Set(legacy.keys()), legacy, 4));
  const modern = new Map([[100001, 2], [200001, 2], [300001, 2], [400001, 2], [0, 2]]);
  assert.doesNotThrow(() => cache.validateCompleteBackfillPages(checkpoint, new Set(modern.keys()), modern, 4));
  modern.delete(300001);
  assert.throws(() => cache.validateCompleteBackfillPages(checkpoint, new Set(modern.keys()), modern, 4), /missing_page/);
});

test("category all and expired views can retrieve retained old completed records", () => {
  const old = { ...item(1), publishedAt: "2021-01-01", discoveredAt: "2021-01-01T00:00:00Z",
    lastVerifiedAt: "2021-01-01T00:00:00Z", expiresAt: "2021-12-31" };
  const dashboard = { categories: [{ id: "startup", items: [old], totalCount: 1, newCount: 0 }] };
  const all = view.filterAndPaginatePublicDashboard(dashboard, "startup", "all", 1, 10, Date.parse("2026-09-01T00:00:00Z"));
  const expired = view.filterAndPaginatePublicDashboard(dashboard, "startup", "expired", 1, 10, Date.parse("2026-09-01T00:00:00Z"));
  const active = view.filterAndPaginatePublicDashboard(dashboard, "startup", "active", 1, 10, Date.parse("2026-09-01T00:00:00Z"));
  assert.equal(all.categories[0].items[0]?.id, old.id);
  assert.equal(expired.categories[0].items[0]?.id, old.id);
  assert.equal(active.categories[0].items.length, 0);
});
