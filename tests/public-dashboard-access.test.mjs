import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

import {
  isRecentFinancialCompanyItem,
  projectInactivePublicSources,
  projectCurrentPublicCatalogItems,
  redactPublicDashboardOperations,
} from "../lib/public-data/operations-view.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": projectRoot } },
  server: { middlewareMode: true },
});
const {
  projectPublicDashboardCategory,
  projectPublicDashboardSummary,
  publicDashboardForViewer,
} = await server.ssrLoadModule("/lib/public-data/access.ts");
const {
  FINANCE_SUPPLEMENTAL_PRODUCT_LIMIT,
  filterAndPaginatePublicDashboard,
  selectPublicCatalogSummaryCounts,
  STARTUP_SUPPLEMENTAL_COMMERCIAL_LIMIT,
  withPublicNewItemScope,
} = await server.ssrLoadModule("/lib/public-data/catalog-view.ts");
const {
  compactCommercialAnalyticsDashboard,
  decodeCommercialAnalyticsSupplement,
  encodeCommercialAnalyticsSupplement,
} = await server.ssrLoadModule("/lib/public-data/commercial-supplement.ts");
const {
  buildCommercialAreaInsights,
  topCommercialAreasByConsumption,
} = await server.ssrLoadModule("/lib/public-data/commercial-area-insights.ts");
test.after(() => server.close());

function dashboard() {
  return {
    exchange: { source: "official", sourceUrl: "https://example.com", asOf: null, rates: [] },
    market: [],
    categories: [{ id: "finance", items: [], totalCount: 0, newCount: 0 }],
    sources: [{ id: "ecos", label: "ECOS", status: "unavailable", itemCount: 0, sourceUrl: "https://example.com", errorCode: "timeout" }],
    status: "partial",
    cached: true,
    stale: false,
    lastSuccessfulAt: null,
    nextRefreshAt: "2026-07-23T00:00:00.000Z",
    canRefresh: true,
    refreshInSeconds: 120,
    authenticated: true,
    sourceSchedules: [{
      sourceId: "ecos",
      nextDueAt: "2026-07-23T00:00:00.000Z",
      lastSuccessAt: null,
      lastAttemptAt: null,
      dailyLimit: 1000,
      usedCalls: 20,
      reservedCalls: 0,
      quotaVerified: true,
      quotaBasis: "official",
      refreshInSeconds: 120,
      canRefresh: false,
      lastError: "timeout",
    }],
  };
}

test("ordinary members keep product data and refresh controls but not API operations", () => {
  const original = dashboard();
  const redacted = redactPublicDashboardOperations(original, false);
  assert.deepEqual(redacted.sources, [{
    id: "ecos",
    label: "ECOS",
    status: "unavailable",
    itemCount: 0,
    sourceUrl: "https://example.com",
  }]);
  assert.equal("errorCode" in redacted.sources[0], false);
  assert.deepEqual(redacted.sourceSchedules, []);
  assert.equal(redacted.refreshInSeconds, 120);
  assert.equal(redacted.canRefresh, true);
  assert.equal(redacted.categories, original.categories);
  assert.equal(original.sources.length, 1, "the source dashboard must not be mutated");
});

test("developer responses retain source and schedule diagnostics", () => {
  const original = dashboard();
  assert.equal(redactPublicDashboardOperations(original, true), original);
});

test("disabled providers do not retain stale authorization badges from snapshots", () => {
  const original = dashboard();
  original.sources[0].id = "work24";
  original.sources[0].status = "authorization-pending";
  original.sources[0].itemCount = 12;
  original.sources[0].errorCode = "work24_authorization";

  const projected = projectInactivePublicSources(original, [{
    sourceId: "work24",
    lastError: "disabled_by_operator",
  }]);

  assert.equal(projected.sources[0].status, "not-configured");
  assert.equal(projected.sources[0].itemCount, 0);
  assert.equal("errorCode" in projected.sources[0], false);
  assert.equal(original.sources[0].status, "authorization-pending");
  assert.equal(original.sources[0].itemCount, 12);
});

test("historical financial-company pages are removed from current catalogue counts and previews", () => {
  const original = dashboard();
  const historical = {
    id: "company-20200408-001",
    category: "finance",
    title: "과거 금융회사 조회 결과",
    summary: "합성 과거 제공자 페이지",
    source: "금융위원회",
    sourceUrl: "https://www.data.go.kr/",
    tags: [],
    publishedAt: "2020-04-08",
    discoveredAt: "2026-08-31T00:00:00Z",
    lastVerifiedAt: "2026-08-31T00:00:00Z",
  };
  const currentProduct = { ...historical, id: "finlife-current", title: "현재 금융상품", publishedAt: "2026-08-30" };
  original.categories[0] = { id: "finance", items: [historical, currentProduct], totalCount: 1_012, newCount: 0 };
  original.sources[0] = { ...original.sources[0], id: "financial-company", itemCount: 1_011 };

  const projected = projectInactivePublicSources(original, [{
    sourceId: "financial-company",
    lastError: "warning_provider_page_window_limit_reached",
  }], Date.parse("2026-09-01T12:00:00+09:00"));

  assert.deepEqual(projected.categories[0].items.map((item) => item.id), ["finlife-current"]);
  assert.equal(projected.categories[0].totalCount, 1);
  assert.equal(projected.sources[0].status, "unavailable");
  assert.equal(projected.sources[0].itemCount, 0);
  assert.equal(projected.sources[0].errorCode, "provider_page_window_limit_reached");
  assert.equal(original.categories[0].items.length, 2, "stored payload remains immutable");
});

test("a recent date-valid financial-company snapshot survives a later provider probe failure", () => {
  const recent = {
    id: "company-20260830-001",
    category: "finance",
    title: "최근 금융회사 조회 결과",
    summary: "합성 최근 제공자 스냅샷",
    source: "금융위원회",
    sourceUrl: "https://www.data.go.kr/",
    tags: [],
    publishedAt: "2026-08-30",
    discoveredAt: "2026-08-30T00:00:00Z",
    lastVerifiedAt: "2026-08-30T00:00:00Z",
  };
  const at = Date.parse("2026-09-01T12:00:00+09:00");
  assert.equal(isRecentFinancialCompanyItem(recent, at), true);
  assert.deepEqual(projectCurrentPublicCatalogItems([recent], [{
    sourceId: "financial-company",
    lastError: "source_financial_company_recent_snapshot_unavailable",
  }], at), [recent]);
  assert.deepEqual(projectCurrentPublicCatalogItems([{ ...recent, publishedAt: "2020-04-14" }], [], at), []);
});

test("category projections retain only the requested personalized group without mutating full callers", () => {
  const original = dashboard();
  original.categories = [
    { id: "finance", items: [{ id: "finance-item" }], totalCount: 1, newCount: 0 },
    { id: "youth", items: [{ id: "personalized-youth-item" }], totalCount: 1, newCount: 1 },
    { id: "startup", items: [{ id: "startup-item" }], totalCount: 1, newCount: 0 },
  ];
  original.youthPolicyPersonalization = { status: "ready", recommendedCount: 1 };

  assert.equal(projectPublicDashboardCategory(original, null), original);
  const projected = projectPublicDashboardCategory(original, "youth");
  assert.notEqual(projected, original);
  assert.deepEqual(projected.categories.map((group) => group.id), ["youth"]);
  assert.equal(projected.categories[0].items[0].id, "personalized-youth-item");
  assert.equal(projected.youthPolicyPersonalization, original.youthPolicyPersonalization);
  assert.deepEqual(original.categories.map((group) => group.id), ["finance", "youth", "startup"]);
});

test("summary projections keep counts and status while omitting catalogue response bodies", () => {
  const original = dashboard();
  original.categories = [{
    id: "startup",
    items: [{ id: "large-startup-record", summary: "large response body" }],
    supplementalItems: [{ id: "large-commercial-record" }],
    youthFacets: { sectionCounts: {}, regionCounts: {} },
    totalCount: 11_944,
    newCount: 37,
    filteredTotalCount: 429,
    page: 1,
    pageSize: 48,
    hasMore: true,
  }];

  const projected = projectPublicDashboardSummary(original);

  assert.deepEqual(projected.categories, [{
    id: "startup",
    items: [],
    totalCount: 11_944,
    newCount: 37,
  }]);
  assert.equal(projected.status, original.status);
  assert.equal(projected.exchange, original.exchange);
  assert.equal(projected.sources, original.sources);
  assert.equal(original.categories[0].items.length, 1, "the stored/viewer dashboard must not be mutated");
  assert.equal(JSON.stringify(projected).includes("large response body"), false);
  assert.equal(JSON.stringify(projected).includes("large-commercial-record"), false);
});

test("anonymous viewers receive the neutral official youth catalogue without match evidence", async () => {
  const original = dashboard();
  original.authenticated = false;
  original.categories = [{
    id: "youth",
    items: [{
      id: "public-youth-policy",
      category: "youth",
      tags: ["section:employment"],
      youthPolicyMatch: { fitScore: 100, matchedFields: ["interests"] },
    }],
    totalCount: 3_000,
    newCount: 0,
  }];

  const visible = await publicDashboardForViewer(original, null);
  assert.deepEqual(visible.categories[0].items.map((item) => item.id), ["public-youth-policy"]);
  assert.equal(visible.categories[0].totalCount, 3_000);
  assert.equal(visible.categories[0].items[0].youthPolicyMatch, undefined);
  assert.equal(visible.youthPolicyPersonalization.status, "sign_in_required");
  assert.equal(original.categories[0].items[0].youthPolicyMatch.fitScore, 100);
});

test("all member-facing dashboard routes apply the shared server-side redactor", async () => {
  const routes = await Promise.all([
    readFile(new URL("../app/api/public-data/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public-data/refresh/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public-data/route.ts", import.meta.url), "utf8"),
  ]);
  for (const source of routes) assert.match(source, /publicDashboardForViewer/u);
});

test("cache-only dashboard reads never enter the refresh-state initialization writer", async () => {
  const source = await readFile(
    new URL("../lib/public-data/service.ts", import.meta.url),
    "utf8",
  );
  const getStart = source.indexOf("export async function getPublicDashboard");
  const getEnd = source.indexOf("export async function publicDashboardWithYouthCatalog", getStart);
  const getBody = source.slice(getStart, getEnd);
  const refreshStart = source.indexOf("export async function refreshPublicDashboard");
  const refreshEnd = source.indexOf("export async function markPublicCategoryRead", refreshStart);
  const refreshBody = source.slice(refreshStart, refreshEnd);

  assert.ok(getStart >= 0 && getEnd > getStart);
  assert.match(getBody, /currentDashboard\(user, now\)/u);
  assert.doesNotMatch(getBody, /initializedState\(|ensurePublicSnapshot\(|ensurePublicSourceStates\(/u);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
  assert.match(refreshBody, /initializedState\(now\)/u,
    "refresh routes must retain initialization, quota-day rollover, and reservation recovery");
});

test("catalog schema checks are memoized per database binding and retry after failure", async () => {
  const source = await readFile(
    new URL("../lib/public-data/cache.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /const youthCatalogTableReady = new WeakMap<D1Database, Promise<void>>\(\)/u);
  assert.match(source, /const publicCatalogTablesReady = new WeakMap<D1Database, Promise<void>>\(\)/u);
  assert.match(source, /const existing = publicCatalogTablesReady\.get\(db\);[\s\S]*if \(existing\) return existing/u);
  assert.match(source, /publicCatalogTablesReady\.set\(db, initialization\)/u);
  assert.match(source, /publicCatalogTablesReady\.delete\(db\)/u);
  assert.match(source, /youthCatalogTableReady\.delete\(db\)/u);
});

test("dashboard route validates category before work and projects only after viewer personalization", async () => {
  const source = await readFile(
    new URL("../app/api/public-data/dashboard/route.ts", import.meta.url),
    "utf8",
  );
  const validationAt = source.indexOf("!PUBLIC_CATEGORIES.includes");
  const authenticationAt = source.indexOf("authenticatedUser(request)");
  const personalizationAt = source.indexOf("await publicDashboardForViewer");
  const projectionAt = source.indexOf("projectPublicDashboardCategory(filteredDashboard");

  assert.ok(validationAt >= 0 && validationAt < authenticationAt);
  assert.ok(personalizationAt >= 0 && personalizationAt < projectionAt);
  assert.match(source, /status:\s*400/u);
  assert.match(source, /invalid_public_information_category/u);
  assert.doesNotMatch(source, /authentication_required_for_all_youth_policies/u);
  assert.match(source, /youthPolicyView: !category \|\| requestedView === "all" \|\| !user/u);
  assert.match(source, /requestedView === null && user\.youthPolicyProfile\?\.enabled !== true/u);
  assert.match(source, /await getPublicDashboard\(user, \{ failOnStorageError: true \}\)/u);
  assert.doesNotMatch(source, /refreshPublicDashboard/u,
    "page reads must not collect upstream data for either members or guests");
  assert.match(source, /category === "youth"\s*\?\s*await publicDashboardWithYouthCatalog/u);
  assert.match(source, /publicDashboardWithCategoryCatalog/u);
  assert.match(source, /filterAndPaginatePublicDashboard/u);
  assert.match(source, /searchParams\.get\("pageSize"\) \?\? "48"/u);
  assert.match(source, /pageSize > 50/u);
  assert.match(source, /invalid_youth_policy_section/u);
  assert.match(source, /invalid_youth_policy_region/u);
  assert.match(source, /invalid_youth_policy_nationwide_option/u);
  assert.match(source, /invalid_public_data_supplemental_option/u);
  assert.match(source, /public_data_supplemental_requires_supported_category/u);
  assert.match(source, /requestedIncludeSupplemental === "true"/u);
});

test("the full youth catalogue is chunked outside the bounded home snapshot", async () => {
  const [cache, service, schema, migration, itemAnalysis] = await Promise.all([
    readFile(new URL("../lib/public-data/cache.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-data/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0015_fearless_sebastian_shaw.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public-data/item-analysis/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(cache, /YOUTH_CATALOG_CHUNK_SIZE = 100/u);
  assert.match(cache, /YOUTH_CATALOG_MAX_ITEMS = 3_000/u);
  assert.match(cache, /SOURCE_CATALOG_MAX_ITEMS = 50_000/u);
  assert.match(cache, /serializePublicDataPayload\(payload\)/u);
  assert.match(cache, /parseStoredPayload\(row\.payload\)/u);
  assert.match(service, /saveYouthPolicyCatalog\([\s\S]*boundPublicCatalogItems\(youthItems, YOUTH_CATALOG_MAX_ITEMS\)/u);
  assert.match(service, /snapshotPayloadWithYouthPreview\(collected\.payload\)/u);
  assert.match(service, /Promise\.all\(\[[\s\S]*readPublicCategoryCatalog\("youth"\)[\s\S]*readYouthPolicyCatalog\(\)[\s\S]*\]\)/u);
  assert.match(service, /mergeCatalogWithSnapshot\(categoryCatalog, legacyCatalog\)/u);
  assert.match(schema, /public_youth_policy_catalog_chunks/u);
  assert.match(migration, /CREATE TABLE `public_youth_policy_catalog_chunks`/u);
  assert.match(itemAnalysis, /publicDashboardWithYouthCatalog\(baseDashboard, user\)/u);
});

test("detail-page dashboard requests include category while full callers remain unchanged", async () => {
  const source = await readFile(
    new URL("../app/components/public-information-pages.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const DESKTOP_CATEGORY_PAGE_SIZE = 24/u,
  );
  assert.match(source, /const MOBILE_CATEGORY_PAGE_SIZE = 12/u);
  assert.match(source, /const COMPACT_CATALOG_QUERY = "\(max-width: 680px\)"/u);
  assert.match(source, /return compact \? MOBILE_CATEGORY_PAGE_SIZE : DESKTOP_CATEGORY_PAGE_SIZE/u);
  assert.match(
    source,
    /dashboard\?category=\$\{encodeURIComponent\(category\)\}&freshness=\$\{encodeURIComponent\(freshness\)\}&page=\$\{page\}&pageSize=\$\{pageSize\}/u,
  );
  // Finance now has one server-paginated scope, so supplemental products must
  // not reappear beside its first page. Only startup keeps its tools payload.
  assert.match(source, /const supplementalQuery = page === 1 && category === "startup"/u);
  assert.match(source, /category === "finance" \? `&section=\$\{financeSection\}&query=/u);
  assert.match(source, /&includeSupplemental=true/u);
  assert.doesNotMatch(source, /pageSize=2000/u);
  assert.match(source, /:\s*"\/api\/public-data\/dashboard";/u);
  assert.match(source, /return \(\) => lifecycleController\.abort\(\);\s*\}, \[activeRequestKey, catalogScope, category, freshness, page, pageSize, supplementalQuery, youthQuery\]\);/u);
  assert.match(source, /PUBLIC_DASHBOARD_RETRY_DELAYS_MS = \[750, 2_000\]/u);
  assert.match(source, /<DashboardFailure locale=\{locale\} onRetry=\{retry\}/u);
  assert.match(source, /supportsPublicTemporalFilter\(category\)/u);
  assert.match(source, /const requestedFreshness = supportsTemporalFilter \? freshness : "active"/u);
  assert.match(source, /<CurrentSnapshotBar/u);
  assert.match(source, /const effectiveYouthPolicyView:[\s\S]*!dashboard\.authenticated[\s\S]*\? "all"/u);
  assert.match(source, /analysisEnabled=\{dashboard\.authenticated && effectiveYouthPolicyView === "personalized"\}/u);
  assert.match(source, /<FinanceInformation[^>]*analysisEnabled=\{dashboard\.authenticated\}/u);
  assert.match(source, /<StartupInformation[\s\S]*analysisEnabled=\{dashboard\.authenticated\}/u);
  assert.match(source, /analysisEnabled = false/u);
  assert.match(source, /useSyncExternalStore/u);
  assert.match(source, /window\.history\[historyMode === "replace" \? "replaceState" : "pushState"\]/u);
  assert.match(source, /updateCategoryQuery\(\{ freshness: next, page: 1 \}\)/u);
  assert.match(source, /updateCategoryQuery\(\{ view: next, page: 1 \}\)/u);
  assert.match(source, /updateCategoryQuery\(\{ section: next, page: 1 \}\)/u);
  assert.match(source, /updateCategoryQuery\(\{ regionSelection: next, page: 1 \}\)/u);
  assert.match(source, /copy\.page\(currentPage, totalPages\)/u);
  assert.match(source, /onPageChange\(totalPages\)/u);
  assert.match(source, /copy\.youthScope\(pageSize\)/u);
  assert.match(source, /showTools=\{currentPage === 1\}/u);
  assert.match(source, /supplementalItems=\{supplementalItems\}/u);
  assert.match(source, /<FinanceInformation[\s\S]*supplementalItems=\{supplementalItems\}/u);
  assert.match(source, /const displayTotalCount = loading \|\| failed \? null/u);
  assert.match(source, /return <details className=\{styles\.sourceReadingGuide\}>/u);
});

function catalogItem(id, category, overrides = {}) {
  return {
    id,
    category,
    title: id,
    summary: id,
    source: "Official source",
    sourceUrl: "https://example.com/source",
    publishedAt: "2026-08-20",
    discoveredAt: "2026-08-20T00:00:00.000Z",
    lastVerifiedAt: "2026-08-20T00:00:00.000Z",
    tags: [],
    ...overrides,
  };
}

test("new counts follow the complete current date, region, section, and search scope across pages", () => {
  const now = Date.parse("2026-09-01T00:00:00.000Z");
  const cutoff = Date.parse("2026-08-20T12:00:00.000Z");
  const youthItems = [
    catalogItem("employment-seoul-new", "youth", {
      title: "서울 청년 채용",
      discoveredAt: "2026-08-21T00:00:00.000Z",
      tags: ["section:employment"],
      youthPolicyEligibility: { regionScope: "regional", regions: ["seoul"], interests: [] },
    }),
    catalogItem("employment-seoul-seen", "youth", {
      title: "서울 기존 채용",
      discoveredAt: "2026-08-19T00:00:00.000Z",
      tags: ["section:employment"],
      youthPolicyEligibility: { regionScope: "regional", regions: ["seoul"], interests: [] },
    }),
    catalogItem("employment-busan-new", "youth", {
      title: "부산 청년 채용",
      discoveredAt: "2026-08-22T00:00:00.000Z",
      tags: ["section:employment"],
      youthPolicyEligibility: { regionScope: "regional", regions: ["busan"], interests: [] },
    }),
    catalogItem("finance-seoul-new", "youth", {
      title: "서울 청년 금융지원",
      discoveredAt: "2026-08-23T00:00:00.000Z",
      tags: ["section:financial-support"],
      youthPolicyEligibility: { regionScope: "regional", regions: ["seoul"], interests: [] },
    }),
  ];
  const source = {
    ...dashboard(),
    categories: [withPublicNewItemScope({
      id: "youth",
      items: youthItems,
      totalCount: youthItems.length,
      newCount: 0,
    }, cutoff)],
  };
  const filters = { section: "employment", region: "seoul", includeNationwide: false };
  const first = filterAndPaginatePublicDashboard(
    source, "youth", "active", 1, 1, now, filters,
  ).categories[0];
  const second = filterAndPaginatePublicDashboard(
    source, "youth", "active", 2, 1, now, filters,
  ).categories[0];
  const busan = filterAndPaginatePublicDashboard(
    source, "youth", "active", 1, 24, now,
    { section: "employment", region: "busan", includeNationwide: false },
  ).categories[0];

  assert.equal(first.filteredTotalCount, 2);
  assert.equal(first.newCount, 1);
  assert.equal(second.newCount, 1, "pagination must not change the current-scope new count");
  assert.equal(busan.filteredTotalCount, 1);
  assert.equal(busan.newCount, 1);
  assert.equal(JSON.stringify(source).includes("public-new-item-cutoff"), false);

  const startupItems = [
    catalogItem("bizinfo-seoul-match", "startup", {
      title: "서울 AI 창업 지원",
      discoveredAt: "2026-08-24T00:00:00.000Z",
      tags: ["서울", "AI"],
    }),
    catalogItem("bizinfo-seoul-other", "startup", {
      title: "서울 외식업 창업 지원",
      discoveredAt: "2026-08-25T00:00:00.000Z",
      tags: ["서울", "외식"],
    }),
  ];
  const searched = filterAndPaginatePublicDashboard({
    ...dashboard(),
    categories: [withPublicNewItemScope({
      id: "startup",
      items: startupItems,
      totalCount: startupItems.length,
      newCount: 0,
    }, cutoff)],
  }, "startup", "active", 1, 24, now, { query: "AI" }).categories[0];
  assert.equal(searched.filteredTotalCount, 1);
  assert.equal(searched.newCount, 1, "search-excluded new rows must not remain in the badge");
});

test("new counts follow freshness scope and summary totals select one coherent source", () => {
  const now = Date.parse("2026-09-01T00:00:00.000Z");
  const cutoff = Date.parse("2026-08-01T00:00:00.000Z");
  const items = [
    catalogItem("bizinfo-recent-new", "startup", {
      publishedAt: "2026-08-30",
      discoveredAt: "2026-08-30T00:00:00.000Z",
    }),
    catalogItem("bizinfo-older-new", "startup", {
      publishedAt: "2026-08-10",
      discoveredAt: "2026-08-10T00:00:00.000Z",
    }),
  ];
  const source = {
    ...dashboard(),
    categories: [withPublicNewItemScope({
      id: "startup",
      items,
      totalCount: items.length,
      newCount: 0,
    }, cutoff)],
  };
  const recent = filterAndPaginatePublicDashboard(
    source, "startup", "recent-7d", 1, 24, now,
  ).categories[0];
  const all = filterAndPaginatePublicDashboard(
    source, "startup", "all", 1, 24, now,
  ).categories[0];

  assert.equal(recent.filteredTotalCount, 1);
  assert.equal(recent.newCount, 1);
  assert.equal(all.filteredTotalCount, 2);
  assert.equal(all.newCount, 2);
  assert.deepEqual(
    selectPublicCatalogSummaryCounts(
      { totalCount: 300, newCount: 12 },
      { totalCount: 14_276, newCount: 84 },
    ),
    { totalCount: 14_276, newCount: 84 },
  );
  assert.deepEqual(
    selectPublicCatalogSummaryCounts(
      { totalCount: 300, newCount: 12 },
      { totalCount: 200, newCount: 84 },
    ),
    { totalCount: 300, newCount: 12 },
  );
});

test("finance page one preserves every ECOS indicator before paginated Finlife products", () => {
  const ecos = [
    catalogItem("ecos-base", "finance", { title: "기준금리" }),
    catalogItem("ecos-loan", "finance", { title: "대출금리" }),
    catalogItem("ecos-cpi", "finance", { title: "소비자물가지수" }),
    ...Array.from({ length: 5 }, (_, index) => catalogItem(`ecos-other-${index}`, "finance")),
  ];
  const finlife = Array.from({ length: 80 }, (_, index) =>
    catalogItem(`finlife-deposit-${String(index).padStart(3, "0")}`, "finance"));
  const projected = filterAndPaginatePublicDashboard({
    ...dashboard(),
    categories: [{ id: "finance", items: [...finlife, ...ecos], totalCount: 88, newCount: 0 }],
  }, "finance", "active", 1, 48, Date.parse("2026-08-21T00:00:00.000Z"), {}, true);
  const items = projected.categories[0].items;
  const supplementalItems = projected.categories[0].supplementalItems;

  assert.equal(items.length, 48);
  assert.equal(items.slice(0, 8).every((item) => item.id.startsWith("ecos-")), true);
  assert.equal(items.some((item) => /기준금리/u.test(item.title)), true);
  assert.equal(items.some((item) => /대출금리/u.test(item.title)), true);
  assert.equal(items.some((item) => /소비자물가/u.test(item.title)), true);
  assert.equal(items.filter((item) => item.id.startsWith("finlife-")).length, 40);
  assert.equal(supplementalItems.length, 40);
  assert.equal(
    supplementalItems.some((item) => item.id === "finlife-deposit-079"),
    true,
    "a product outside page one must remain searchable",
  );
  assert.equal(
    items.some((item) => supplementalItems.some((extra) => extra.id === item.id)),
    false,
    "the opt-in projection must not retransmit products already present on page one",
  );
  assert.equal(
    new Set([...items, ...supplementalItems].filter((item) => item.id.startsWith("finlife-")).map((item) => item.id)).size,
    80,
  );
  assert.equal(FINANCE_SUPPLEMENTAL_PRODUCT_LIMIT, 1_000);
});

test("youth facets and regional results remain stable across pages larger than the UI slice", () => {
  const regional = (id, section, region, fitScore = 0) => catalogItem(id, "youth", {
    tags: [`section:${section.replaceAll("_", "-")}`],
    youthPolicyEligibility: { regionScope: "regional", regions: [region], interests: [] },
    youthPolicyMatch: fitScore ? { fitScore, matchedFields: ["regions"] } : undefined,
  });
  const nationwide = (id, section) => catalogItem(id, "youth", {
    tags: [`section:${section.replaceAll("_", "-")}`],
    youthPolicyEligibility: { regionScope: "nationwide", interests: [] },
  });
  const youthItems = [
    ...Array.from({ length: 70 }, (_, index) => regional(`employment-seoul-${String(index).padStart(3, "0")}`, "employment", "seoul", index === 69 ? 100 : 10)),
    ...Array.from({ length: 10 }, (_, index) => regional(`employment-busan-${index}`, "employment", "busan")),
    ...Array.from({ length: 20 }, (_, index) => nationwide(`employment-nationwide-${index}`, "employment")),
    ...Array.from({ length: 10 }, (_, index) => regional(`finance-seoul-${index}`, "financial_support", "seoul")),
  ];
  const source = {
    ...dashboard(),
    categories: [{ id: "youth", items: youthItems, totalCount: youthItems.length, newCount: 0 }],
  };
  const args = ["youth", "active", 1, 48, Date.parse("2026-08-21T00:00:00.000Z"), {
    section: "employment",
    region: "seoul",
    includeNationwide: false,
  }];
  const first = filterAndPaginatePublicDashboard(source, ...args).categories[0];
  const second = filterAndPaginatePublicDashboard(source, ...args.toSpliced(2, 1, 2)).categories[0];
  const includingNationwide = filterAndPaginatePublicDashboard(
    source,
    "youth",
    "active",
    1,
    48,
    Date.parse("2026-08-21T00:00:00.000Z"),
    { section: "employment", region: "seoul", includeNationwide: true },
  ).categories[0];

  assert.equal(first.items.length, 48);
  assert.equal(second.items.length, 22);
  assert.equal(first.filteredTotalCount, 70);
  assert.equal(second.filteredTotalCount, 70);
  assert.equal(first.totalCount, 110, "the viewer-visible total is preserved apart from filters");
  assert.deepEqual(first.youthFacets, second.youthFacets);
  assert.equal(first.youthFacets.sectionCounts.employment, 70);
  assert.equal(first.youthFacets.sectionCounts.financial_support, 10);
  assert.equal(first.youthFacets.regionCounts.seoul, 70);
  assert.equal(first.youthFacets.regionCounts.busan, 10);
  assert.equal(first.youthFacets.nationwideCount, 20);
  assert.equal(first.youthFacets.allRegionCount, 100);
  assert.equal(includingNationwide.filteredTotalCount, 90);
  assert.equal(first.items[0].id, "employment-seoul-069", "fit score must win personalized ordering");
  assert.equal([...first.items, ...second.items].every((item) => item.youthPolicyEligibility.regions?.includes("seoul")), true);
});

test("startup pagination carries one bounded analytics supplement without duplicating catalogue rows", () => {
  const support = Array.from({ length: 75 }, (_, index) =>
    catalogItem(`bizinfo-${String(index).padStart(4, "0")}`, "startup", index === 74
      ? { startupMatch: { rank: 1, signals: ["preferred_region"], requiresOfficialConfirmation: true } }
      : {}));
  const commercial = Array.from({ length: STARTUP_SUPPLEMENTAL_COMMERCIAL_LIMIT + 5 }, (_, index) =>
    catalogItem(`seoul-commercial-${String(index).padStart(7, "0")}`, "startup", {
      commercialArea: {
        areaSquareMeters: null,
        referenceDate: "2026-08-20",
        coordinateCount: null,
        analytics: {
          officialCode: String(index).padStart(7, "0"),
          referenceQuarter: "20262",
          areaType: null,
          estimatedTotalSales: index * 1_000,
          industrySalesComposition: [],
          salesByHour: [],
          footfallByHour: [],
          sourceUrl: "https://data.seoul.go.kr/",
        },
      },
    }));
  const projected = filterAndPaginatePublicDashboard({
    ...dashboard(),
    categories: [{ id: "startup", items: [...commercial, ...support], totalCount: commercial.length + support.length, newCount: 0 }],
  }, "startup", "active", 1, 48, Date.parse("2026-08-21T00:00:00.000Z"), {}, true);
  const group = projected.categories[0];

  assert.equal(group.items.length, 48);
  assert.equal(group.items[0].id, "bizinfo-0074", "a personalized match outside the neutral first page must rank first");
  assert.equal(group.totalCount, commercial.length + support.length);
  assert.equal(group.filteredTotalCount, support.length, "analytics belong to the featured supplement, not primary pagination");
  assert.equal(group.items.every((item) => !item.commercialArea?.analytics), true);
  assert.equal(group.supplementalItems.length, STARTUP_SUPPLEMENTAL_COMMERCIAL_LIMIT);
  assert.equal(group.supplementalItems[0].commercialArea.analytics.estimatedTotalSales, 1_804_000);
  assert.equal(group.items.some((item) => item.id === "seoul-commercial-0001804"), false);
  const top = topCommercialAreasByConsumption(buildCommercialAreaInsights(group.supplementalItems));
  assert.equal(top[0].id, "seoul-commercial-0001804");
  assert.equal(top[0].rankByConsumption, 1);
  assert.equal(group.items.some((item) => group.supplementalItems.some((extra) => extra.id === item.id)), false);
  assert.equal(STARTUP_SUPPLEMENTAL_COMMERCIAL_LIMIT, 1_800);
});

test("startup primary pages exclude analytics and page two never intersects the page-one supplement", () => {
  const support = Array.from({ length: 72 }, (_, index) =>
    catalogItem(`bizinfo-primary-${String(index).padStart(3, "0")}`, "startup", { tags: ["창업"] }));
  const commercial = Array.from({ length: 96 }, (_, index) =>
    catalogItem(`seoul-commercial-overlap-${String(index).padStart(3, "0")}`, "startup", {
      commercialArea: {
        analytics: {
          officialCode: String(index).padStart(7, "0"),
          referenceQuarter: "20262",
          estimatedTotalSales: index * 1_000,
          industrySalesComposition: [],
          salesByHour: [],
          footfallByHour: [],
          sourceUrl: "https://data.seoul.go.kr/",
        },
      },
    }));
  const source = {
    ...dashboard(),
    categories: [{ id: "startup", items: [...commercial, ...support], totalCount: commercial.length + support.length, newCount: 0 }],
  };
  const args = ["startup", "active", 1, 48, Date.parse("2026-08-21T00:00:00.000Z"), {}, true];
  const first = filterAndPaginatePublicDashboard(source, ...args).categories[0];
  const second = filterAndPaginatePublicDashboard(source, ...args.toSpliced(2, 1, 2)).categories[0];

  assert.equal(first.items.length, 48);
  assert.equal(second.items.length, 24);
  assert.equal(first.filteredTotalCount, support.length);
  assert.equal(second.filteredTotalCount, support.length);
  assert.equal(first.supplementalItems.length, commercial.length);
  assert.equal(first.items.every((item) => !item.commercialArea?.analytics), true);
  assert.equal(second.items.every((item) => !item.commercialArea?.analytics), true);
  assert.equal(first.items.some((item) => first.supplementalItems.some((extra) => extra.id === item.id)), false);
  assert.equal(second.items.some((item) => first.supplementalItems.some((extra) => extra.id === item.id)), false);
  assert.equal("supplementalItems" in second, false);
  assert.equal(JSON.stringify(second).includes("supplementalItems"), false);
});

test("startup notice pages exclude commercial geometry even when a row has a match rank", () => {
  const support = Array.from({ length: 10 }, (_, index) =>
    catalogItem(`zzz-support-${String(index).padStart(2, "0")}`, "startup", { tags: ["창업"] }));
  const nationwideCommercial = Array.from({ length: 60 }, (_, index) =>
    catalogItem(`aaa-commercial-${String(index).padStart(2, "0")}`, "startup", {
      commercialArea: {
        areaSquareMeters: 100_000,
        referenceDate: "2026-08-20",
        coordinateCount: 4,
      },
      ...(index === 0
        ? { startupMatch: { rank: 1, signals: ["preferred_region"], requiresOfficialConfirmation: true } }
        : {}),
    }));
  const group = filterAndPaginatePublicDashboard({
    ...dashboard(),
    categories: [{ id: "startup", items: [...nationwideCommercial, ...support], totalCount: 70, newCount: 0 }],
  }, "startup", "active", 1, 48, Date.parse("2026-08-21T00:00:00.000Z")).categories[0];

  assert.deepEqual(group.items.slice(0, support.length).map((item) => item.id), support.map((item) => item.id));
  assert.equal(group.items.length, support.length);
  assert.equal(group.filteredTotalCount, 10);
  assert.equal(group.startupFacets.allRegionCount, 10);
});

test("maximum startup supplement keeps the projected dashboard below a three MiB raw JSON ceiling", () => {
  const commercial = Array.from({ length: STARTUP_SUPPLEMENTAL_COMMERCIAL_LIMIT + 48 }, (_, index) =>
    catalogItem(`seoul-commercial-budget-${String(index).padStart(4, "0")}`, "startup", {
      commercialArea: {
        areaSquareMeters: null,
        referenceDate: "2026-08-20",
        coordinateCount: null,
        analytics: {
          officialCode: String(index).padStart(7, "0"),
          referenceQuarter: "20262",
          areaType: "골목상권",
          estimatedTotalSales: index * 1_000,
          industrySalesComposition: [],
          salesByHour: [],
          footfallByHour: [],
          sourceUrl: "https://data.seoul.go.kr/",
        },
      },
    }));
  const projected = filterAndPaginatePublicDashboard({
    ...dashboard(),
    categories: [{ id: "startup", items: commercial, totalCount: commercial.length, newCount: 0 }],
  }, "startup", "active", 1, 48, Date.parse("2026-08-21T00:00:00.000Z"), {}, true);
  const rawBytes = Buffer.byteLength(JSON.stringify(projected), "utf8");

  assert.equal(projected.categories[0].supplementalItems.length, STARTUP_SUPPLEMENTAL_COMMERCIAL_LIMIT);
  assert.ok(rawBytes < 3 * 1024 * 1024, `projected dashboard used ${rawBytes} raw JSON bytes`);
});

test("Seoul analytics supplement round-trips through an 80-percent-smaller response projection", () => {
  const hours = [0, 6, 11, 14, 17, 21];
  const commercial = Array.from({ length: 1_650 }, (_, index) => {
    const code = String(1_000_000 + index);
    return catalogItem(`seoul-commercial-${code}`, "startup", {
      title: `테스트 상권 ${index}`,
      summary: "2026년 2분기 공식 추정매출 및 유동인구 정보를 제공합니다.",
      source: "서울시 상권분석서비스 공식 Sheet CSV",
      sourceUrl: "https://data.seoul.go.kr/dataList/OA-15572/S/1/datasetView.do",
      sourceLinkKind: "dataset",
      tags: ["서울", "상권", "2026년 2분기", "골목상권", "추정매출", "유동인구", "강남구", "역삼동"],
      location: {
        label: "서울특별시 강남구 역삼동",
        province: "서울특별시",
        city: "강남구",
        neighborhood: "역삼동",
        precision: "administrative",
      },
      commercialArea: {
        areaSquareMeters: 12_345.6,
        referenceDate: "2026-06-30",
        coordinateCount: null,
        analytics: {
          officialCode: code,
          referenceQuarter: "20262",
          areaType: "골목상권",
          estimatedTotalSales: 1_234_567_890 + index,
          industrySalesComposition: [
            { name: "한식음식점", sharePercent: 31.2, storeCount: null },
            { name: "커피-음료", sharePercent: 18.4, storeCount: null },
            { name: "편의점", sharePercent: 9.1, storeCount: null },
          ],
          salesByHour: hours.map((hour, offset) => ({ hour, amount: 1_000_000 + index + offset })),
          footfallByHour: hours.map((hour, offset) => ({ hour, people: 1_000 + index + offset })),
          sourceUrl: "https://data.seoul.go.kr/dataList/OA-15572/S/1/datasetView.do",
        },
      },
    });
  });
  const encoded = encodeCommercialAnalyticsSupplement(commercial);
  const decoded = decodeCommercialAnalyticsSupplement(encoded);
  const originalBytes = Buffer.byteLength(JSON.stringify(commercial), "utf8");
  const compactBytes = Buffer.byteLength(JSON.stringify(encoded), "utf8");

  assert.equal(decoded.length, commercial.length);
  assert.equal(decoded[0].id, commercial[0].id);
  assert.equal(decoded.at(-1).commercialArea.analytics.estimatedTotalSales, commercial.at(-1).commercialArea.analytics.estimatedTotalSales);
  assert.deepEqual(decoded[100].commercialArea.analytics.salesByHour, commercial[100].commercialArea.analytics.salesByHour);
  assert.deepEqual(decoded[100].commercialArea.analytics.footfallByHour, commercial[100].commercialArea.analytics.footfallByHour);
  assert.ok(compactBytes < originalBytes * 0.2, `${compactBytes} bytes was not below 20% of ${originalBytes}`);

  const projected = compactCommercialAnalyticsDashboard({
    ...dashboard(),
    categories: [{ id: "startup", items: [], supplementalItems: commercial, totalCount: commercial.length, newCount: 0 }],
  });
  assert.equal(projected.categories[0].supplementalItems, undefined);
  assert.equal(projected.categories[0].commercialAnalyticsSupplement.rows.length, commercial.length);
});

test("malformed compact commercial data fails closed without partial UI rows", () => {
  const item = catalogItem("seoul-commercial-1000000", "startup", {
    commercialArea: {
      areaSquareMeters: null,
      referenceDate: "2026-06-30",
      coordinateCount: null,
      analytics: {
        officialCode: "1000000",
        referenceQuarter: "20262",
        areaType: null,
        estimatedTotalSales: null,
        industrySalesComposition: [],
        salesByHour: [],
        footfallByHour: [],
        sourceUrl: "https://data.seoul.go.kr/dataList/OA-15572/S/1/datasetView.do",
      },
    },
  });
  const encoded = structuredClone(encodeCommercialAnalyticsSupplement([item]));
  encoded.rows[0][0] = 99_999;

  assert.deepEqual(decodeCommercialAnalyticsSupplement(encoded), []);
});
