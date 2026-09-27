import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const sqlite = new DatabaseSync(":memory:");
const queries = [];
let afterQuery = null;
function prepare(sql, parameters = []) {
  function execute(method) {
    queries.push({ sql, parameters });
    const statement = sqlite.prepare(sql);
    if (method === "first") return statement.get(...parameters) ?? null;
    if (method === "all") {
      const result = { results: statement.all(...parameters) };
      afterQuery?.(sql, result);
      return result;
    }
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
globalThis.__boraCatalogPerformanceDb = {
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
const server = await createServer({
  root, configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": root } },
  plugins: [{
    name: "catalog-performance-synthetic-d1",
    resolveId(id) { if (id === "cloudflare:workers") return "\0catalog-performance-workers"; },
    load(id) {
      if (id === "\0catalog-performance-workers") {
        return "export const env = { DB: globalThis.__boraCatalogPerformanceDb };";
      }
    },
  }],
  server: { middlewareMode: true, watch: null },
});
const cache = await server.ssrLoadModule("/lib/public-data/cache.ts");
const view = await server.ssrLoadModule("/lib/public-data/catalog-view.ts");
const sections = await server.ssrLoadModule("/lib/public-data/youth-policy-sections.ts");
const { YOUTH_POLICY_REGIONS } = await server.ssrLoadModule("/lib/auth/youth-policy-profile.ts");
const { filterPublicInformationItems } = await server.ssrLoadModule("/lib/public-data/retention.ts");
const { publicItemRecency } = await server.ssrLoadModule("/lib/public-data/dates.ts");
await cache.readPublicCategoryCatalogCounts();
test.after(async () => {
  await server.close();
  sqlite.close();
  delete globalThis.__boraCatalogPerformanceDb;
});

test("a failed generation reset restores old staging and cursor without touching live or private data", async () => {
  sqlite.exec("CREATE TABLE IF NOT EXISTS synthetic_private_assets (user_id TEXT PRIMARY KEY, amount INTEGER)");
  sqlite.prepare("INSERT OR REPLACE INTO synthetic_private_assets VALUES (?, ?)").run("test-owner", 12345);
  const item = (id) => ({ ...youthItem(1, "nationwide", [], "employment"), category: "startup", id });
  const checkpoint = {
    sourceId: "kstartup", querySignature: "startup-v1-kstartup-atomic-test", queryState: "{}",
    nextPage: 3, pageSize: 2, providerTotalCount: 4, fetchedCount: 4,
    completed: true, latestRefreshAt: now, completedAt: now, updatedAt: now,
  };
  await cache.commitPublicBackfillPage({ checkpoint, pageNumber: 1, items: [item("kstartup-old-1"), item("kstartup-old-2")] });
  await cache.commitPublicBackfillPage({ checkpoint, pageNumber: 2, items: [item("kstartup-old-3"), item("kstartup-old-4")] });
  const staging = () => sqlite.prepare("SELECT * FROM public_api_backfill_pages WHERE source_id = 'kstartup' ORDER BY page_number").all();
  const cursor = () => sqlite.prepare("SELECT * FROM public_api_backfill_checkpoints WHERE source_id = 'kstartup'").get();
  const live = () => sqlite.prepare("SELECT * FROM public_data_catalog_chunks ORDER BY source_id, chunk_index").all();
  const privateData = () => sqlite.prepare("SELECT * FROM synthetic_private_assets").all();
  const before = { staging: staging(), cursor: cursor(), live: live(), private: privateData() };
  const next = { ...checkpoint, nextPage: 2, providerTotalCount: 5, fetchedCount: 2, completed: false, completedAt: null, updatedAt: now + 1 };
  const reset = { checkpoint: next, pageNumber: 1, resetGeneration: true, items: [item("kstartup-new-1"), item("kstartup-new-2")] };
  sqlite.exec(`CREATE TRIGGER fail_checkpoint_reset BEFORE UPDATE ON public_api_backfill_checkpoints
    WHEN NEW.source_id = 'kstartup' BEGIN SELECT RAISE(ABORT, 'synthetic checkpoint write failure'); END`);
  try {
    await assert.rejects(cache.commitPublicBackfillPage(reset), /synthetic checkpoint write failure/u);
    assert.deepEqual({ staging: staging(), cursor: cursor(), live: live(), private: privateData() }, before);
  } finally {
    sqlite.exec("DROP TRIGGER fail_checkpoint_reset");
  }
  await cache.commitPublicBackfillPage(reset);
  assert.deepEqual(staging().map((row) => row.page_number), [1]);
  assert.equal(cursor().next_page, 2);
  assert.equal(cursor().completed, 0);
  assert.deepEqual(live(), before.live);
  assert.deepEqual(privateData(), before.private);
  await assert.rejects(cache.commitPublicBackfillPage({ ...reset, pageNumber: 2 }), /public_backfill_page_invalid/u);
});

test("a youth section reset removes only that section's legacy and historical staging slots", async () => {
  const checkpoint = {
    sourceId: "youth-center", querySignature: "youth-center-open-v2-atomic-test", queryState: "{}",
    nextPage: 2, pageSize: 40, providerTotalCount: 4, fetchedCount: 4,
    completed: false, latestRefreshAt: now, completedAt: null, updatedAt: now,
  };
  for (const pageNumber of [0, 1, 100001, 100002, 200001]) {
    await cache.commitPublicBackfillPage({ checkpoint, pageNumber,
      items: [youthItem(pageNumber, "nationwide", [], "employment")] });
  }
  await cache.commitPublicBackfillPage({ checkpoint, pageNumber: 100001, resetSection: 0,
    items: [youthItem(99, "nationwide", [], "employment")] });
  const rows = sqlite.prepare("SELECT page_number FROM public_api_backfill_pages WHERE source_id = 'youth-center' ORDER BY page_number").all();
  assert.deepEqual(rows.map((row) => row.page_number), [1, 100001, 200001]);
  await assert.rejects(cache.commitPublicBackfillPage({ checkpoint, pageNumber: 100002, resetSection: 0, items: [] }), /public_backfill_page_invalid/u);
});

function seedCatalog(source, category, items, count = items.length) {
  sqlite.prepare("INSERT INTO public_data_catalog_chunks VALUES (?, ?, 0, ?, ?, 1)")
    .run(source, category, JSON.stringify({ categories: [{ id: category, items }] }), count);
}

test("scoped catalogue counts match full totals and preserve financial date boundaries", async () => {
  sqlite.exec("DELETE FROM public_data_catalog_chunks");
  const date = (modifier) => sqlite.prepare("SELECT date('now', '+9 hours', ?) AS date").get(modifier).date;
  seedCatalog("kstartup", "startup", [], 37);
  seedCatalog("bizinfo", "startup", [], 14);
  seedCatalog("youth-center", "youth", [], 29);
  seedCatalog("finlife", "finance", [], 8);
  seedCatalog("financial-company", "finance", [
    { id: "company-today", publishedAt: date("+0 days") },
    { id: "company-boundary-old", publishedAt: date("-30 days") },
    { id: "company-boundary-new", publishedAt: date("+1 day") },
    { id: "company-too-old", publishedAt: date("-31 days") },
    { id: "company-future", publishedAt: date("+2 days") },
    { id: "company-invalid-day", publishedAt: "2026-02-30" },
    { id: "company-invalid-text", publishedAt: "not-a-date" },
    { id: "different-prefix", publishedAt: date("+0 days") },
  ]);
  const all = await cache.readPublicCategoryCatalogCounts();
  assert.deepEqual([...all], [["finance", 11], ["startup", 51], ["youth", 29]]);
  for (const category of ["finance", "startup", "youth", "employment"]) {
    queries.length = 0;
    const scoped = await cache.readPublicCategoryCatalogCounts(category);
    assert.deepEqual([...scoped], all.has(category) ? [[category, all.get(category)]] : []);
    const query = queries.find(({ sql }) => sql.startsWith("SELECT c.category,"));
    assert.match(query.sql, /WHERE c\.category = \?/u);
    assert.deepEqual(query.parameters, [category]);
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.parameters);
    assert.ok(plan.some(({ detail }) => /SEARCH c USING INDEX public_data_catalog_chunks_category_idx \(category=\?\)/u.test(detail)),
      "unrelated categories are excluded using the category index before the JSON projection");
  }
});

test("home totals remain unscoped and reflect changed rows without a stale shared cache", async () => {
  sqlite.prepare("UPDATE public_data_catalog_chunks SET item_count = 15 WHERE source_id = 'bizinfo'").run();
  queries.length = 0;
  const all = await cache.readPublicCategoryCatalogCounts();
  assert.equal(all.get("startup"), 52);
  assert.equal(all.get("finance"), 11);
  const query = queries.find(({ sql }) => sql.startsWith("SELECT c.category,"));
  assert.doesNotMatch(query.sql, /WHERE c\.category = \?/u);
  assert.deepEqual(query.parameters, []);
});

// Keep the former multi-pass implementation as an independent equivalence
// oracle. Region and section filters intentionally affect different facets.
function formerYouthFacets(sectionFiltered, regionFiltered) {
  return {
    sectionCounts: Object.fromEntries(sections.YOUTH_POLICY_SECTION_IDS.map((section) => [
      section, regionFiltered.filter((item) => sections.youthPolicySectionForItem(item) === section).length,
    ])),
    allRegionCount: sectionFiltered.length,
    nationwideCount: sectionFiltered.filter((item) => sections.youthPolicyRegionScope(item) === "nationwide").length,
    regionCounts: Object.fromEntries(YOUTH_POLICY_REGIONS.map((region) => [
      region, sectionFiltered.filter((item) => sections.youthPolicyRegionScope(item) === "regional"
        && Boolean(item.youthPolicyEligibility?.regions?.includes(region))).length,
    ])),
  };
}

const now = Date.parse("2026-09-23T00:00:00Z");
const cutoff = Date.parse("2026-09-15T00:00:00Z");
function youthItem(index, scope, regions, section, overrides = {}) {
  return {
    id: `policy-${String(index).padStart(4, "0")}`, category: "youth",
    title: `Official policy ${index}`, summary: "Official policy detail", source: "Public provider",
    sourceUrl: "https://example.go.kr/policy", tags: [`section:${section.replaceAll("_", "-")}`],
    publishedAt: index % 3 === 0 ? "2026-08-25" : "2026-09-22",
    discoveredAt: index % 2 ? "2026-09-22T00:00:00Z" : "2026-09-01T00:00:00Z",
    lastVerifiedAt: "2026-09-22T00:00:00Z",
    youthPolicyEligibility: { regionScope: scope, regions },
    youthPolicyMatch: { fitScore: index % 5 },
    ...overrides,
  };
}
const items = sections.YOUTH_POLICY_SECTION_IDS.flatMap((section, sectionIndex) => [
  ...YOUTH_POLICY_REGIONS.map((region, index) => youthItem(sectionIndex * 100 + index,
    "regional", [region], section)),
  youthItem(sectionIndex * 100 + 20, "regional", ["seoul", "seoul", "busan", "unknown", "__proto__"], section),
  youthItem(sectionIndex * 100 + 21, "nationwide", ["seoul"], section),
  youthItem(sectionIndex * 100 + 22, "unknown", ["busan"], section),
  youthItem(sectionIndex * 100 + 23, "regional", [], section),
  youthItem(sectionIndex * 100 + 24, "regional", ["seoul"], section, { expiresAt: "2026-09-01" }),
]);
const sourceItems = [...items, { ...items[0], summary: "A richer official policy detail" }];
const dashboard = { categories: [view.withPublicNewItemScope({
  id: "youth", items: sourceItems, totalCount: sourceItems.length, newCount: sourceItems.length,
}, cutoff)] };

test("single-pass youth facets preserve every date/section/region/nationwide/page combination", () => {
  const original = structuredClone(sourceItems);
  const deduplicated = view.deduplicatePublicCatalogItems(sourceItems);
  for (const freshness of ["active", "recent-7d", "recent-30d", "expired", "all"]) {
    const fresh = filterPublicInformationItems(deduplicated, freshness, now);
    for (const section of [null, ...sections.YOUTH_POLICY_SECTION_IDS]) {
      const sectionFiltered = section ? fresh.filter((item) => sections.youthPolicySectionForItem(item) === section) : fresh;
      for (const region of [null, "nationwide", ...YOUTH_POLICY_REGIONS]) {
        for (const includeNationwide of [false, true]) {
          const selection = !region ? { mode: "all" } : region === "nationwide" ? { mode: "nationwide" }
            : { mode: "region", region, includeNationwide };
          const regionFiltered = fresh.filter((item) => sections.youthPolicyMatchesRegionSelection(item, selection));
          const expectedFacets = formerYouthFacets(sectionFiltered, regionFiltered);
          const filtered = sectionFiltered.filter((item) => sections.youthPolicyMatchesRegionSelection(item, selection))
            .sort((left, right) => (right.youthPolicyMatch?.fitScore ?? 0) - (left.youthPolicyMatch?.fitScore ?? 0)
              || publicItemRecency(right, now) - publicItemRecency(left, now)
              || left.id.localeCompare(right.id, "ko-KR"));
          const expectedNew = filtered.filter((item) => Date.parse(item.discoveredAt) > cutoff).length;
          for (const page of [1, 2, 40]) {
            const result = view.filterAndPaginatePublicDashboard(dashboard, "youth", freshness, page, 7, now,
              { section, region, includeNationwide }).categories[0];
            assert.deepEqual(result.youthFacets, expectedFacets, JSON.stringify({ freshness, section, region, includeNationwide, page }));
            assert.equal(result.totalCount, deduplicated.length);
            assert.equal(result.filteredTotalCount, filtered.length);
            assert.equal(result.newCount, expectedNew);
            assert.deepEqual(result.items, filtered.slice((page - 1) * 7, page * 7));
            assert.equal(result.hasMore, page * 7 < filtered.length);
          }
        }
      }
    }
  }
  assert.deepEqual(sourceItems, original, "faceting does not modify the shared official catalogue");
});

test("empty youth catalogue keeps every facet key with a zero value", () => {
  const empty = { categories: [{ id: "youth", items: [], totalCount: 0, newCount: 0 }] };
  const result = view.filterAndPaginatePublicDashboard(empty, "youth", "active", 1, 48, now).categories[0];
  assert.deepEqual(result.youthFacets, formerYouthFacets([], []));
  assert.equal(result.filteredTotalCount, 0);
  assert.equal(result.hasMore, false);
});

function cacheItem(id, category = "startup") {
  return { id, category, title: "공식 공고", summary: "내용", source: "공식 기관", sourceUrl: "https://example.go.kr/notice",
    sourceLinkKind: "detail", publishedAt: "2026-09-22", discoveredAt: "2026-09-22T00:00:00Z", tags: ["원본"] };
}
function payloadReads() { return queries.filter(({ sql }) => sql.startsWith("SELECT source_id AS sourceId, category,")).length; }

test("bounded neutral catalogue cache avoids repeat JSON reads and invalidates on generation change", async () => {
  sqlite.exec("DELETE FROM public_data_catalog_chunks");
  await cache.savePublicSourceCatalog("cache-source", [cacheItem("cache-1")], 100);
  queries.length = 0;
  const [first, second] = await Promise.all([cache.readPublicCategoryCatalog("startup"), cache.readPublicCategoryCatalog("startup")]);
  assert.equal(payloadReads(), 1);
  assert.deepEqual(first, second);
  assert.notEqual(first, second, "callers receive their own array");
  assert.ok(Object.isFrozen(second[0]) && Object.isFrozen(second[0].tags), "public neutral cache is immutable");
  assert.throws(() => { second[0].tags.push("private viewer tag"); }, TypeError);
  const before = await cache.readPublicCatalogVersion("startup", "2026-09-22T00:00:00Z");
  // Even a same-timestamp generation has an opaque, unique publication id.
  await cache.savePublicSourceCatalog("cache-source", [cacheItem("cache-2")], 100);
  const after = await cache.readPublicCatalogVersion("startup", "2026-09-22T00:00:00Z");
  assert.notEqual(before, after);
  assert.deepEqual((await cache.readPublicCategoryCatalog("startup")).map((row) => row.id), ["cache-2"]);
  assert.equal(payloadReads(), 2);
});

test("catalogue cache expires and limits retained categories to two", async () => {
  sqlite.exec("DELETE FROM public_data_catalog_chunks");
  for (const category of ["startup", "finance", "employment"]) {
    await cache.savePublicSourceCatalog("ttl-" + category, [cacheItem("ttl-" + category, category)], 200);
  }
  queries.length = 0;
  for (const category of ["startup", "finance", "employment", "startup"]) await cache.readPublicCategoryCatalog(category);
  assert.equal(payloadReads(), 4, "third category evicts the least recently read category");
  const original = Date.now;
  const future = original() + 61_000;
  try {
    Date.now = () => future;
    await cache.readPublicCategoryCatalog("startup");
    assert.equal(payloadReads(), 5);
  } finally { Date.now = original; }
});

test("catalogue versions include snapshot and KST date boundaries, never viewer information", async () => {
  const at = Date.parse("2026-09-22T14:59:59Z");
  const first = await cache.readPublicCatalogVersion("startup", "2026-09-22T00:00:00Z", at);
  const same = await cache.readPublicCatalogVersion("startup", "2026-09-22T00:00:00Z", at);
  assert.equal(first, same);
  assert.match(first, /^v1-[a-f0-9]{64}$/);
  assert.notEqual(first, await cache.readPublicCatalogVersion("startup", "2026-09-22T00:00:01Z", at));
  assert.notEqual(first, await cache.readPublicCatalogVersion("startup", "2026-09-22T00:00:00Z", at + 1000));
});

test("a publication during a cold read fails explicitly and cannot poison the cache", async () => {
  sqlite.exec("DELETE FROM public_data_catalog_chunks");
  await cache.savePublicSourceCatalog("race-source", [cacheItem("race-1")], 300);
  try {
    afterQuery = (sql) => {
      if (!sql.startsWith("SELECT source_id AS sourceId, category,")) return;
      afterQuery = null;
      sqlite.exec("UPDATE public_data_catalog_chunks SET updated_at = updated_at + 1 WHERE source_id = 'race-source'");
    };
    await assert.rejects(cache.readPublicCategoryCatalog("startup"), /public_catalog_changed/);
  } finally { afterQuery = null; }
  queries.length = 0;
  assert.equal((await cache.readPublicCategoryCatalog("startup"))[0].id, "race-1");
  assert.equal(payloadReads(), 1, "failed flight was removed and the next read rebuilds safely");
});

test("catalogue cache never retains a generation above its declared source-byte ceiling", async () => {
  sqlite.exec("DELETE FROM public_data_catalog_chunks");
  await cache.savePublicSourceCatalog("large-source", [cacheItem("large-1")], 400);
  try {
    afterQuery = (sql, result) => {
      if (sql.startsWith("SELECT c.source_id AS sourceId,")) {
        for (const row of result.results) row.bytes = 33 * 1024 * 1024;
      }
    };
    queries.length = 0;
    await cache.readPublicCategoryCatalog("startup");
    await cache.readPublicCategoryCatalog("startup");
    assert.equal(payloadReads(), 2);
  } finally { afterQuery = null; }
});
