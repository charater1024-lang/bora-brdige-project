import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": root } }, server: { middlewareMode: true, watch: null } });
test.after(() => server.close());
const { deduplicatePublicCatalogItems, filterAndPaginatePublicDashboard } = await server.ssrLoadModule("/lib/public-data/catalog-view.ts");
const { parseStoredPayload, boundPublicCatalogItems } = await server.ssrLoadModule("/lib/public-data/cache.ts");
const now = Date.parse("2026-09-01T01:00:00Z");
function notice(id, region, overrides = {}) {
  return { id, category: "startup", title: `Seed funding ${id}`, summary: "Official notice", source: "Official provider",
    sourceUrl: "https://example.go.kr/notice", publishedAt: "2026-08-31", discoveredAt: "2026-08-31T01:00:00Z",
    lastVerifiedAt: "2026-09-01T00:00:00Z", tags: [],
    youthPolicyEligibility: region === "nationwide" ? { regionScope: "nationwide", regions: [] }
      : region ? { regionScope: "regional", regions: [region] } : { regionScope: "unknown", regions: [] }, ...overrides };
}
const items = [
  ...Array.from({ length: 30 }, (_, i) => notice(`seoul-${i}`, "seoul")),
  ...Array.from({ length: 30 }, (_, i) => notice(`busan-${i}`, "busan")),
  ...Array.from({ length: 10 }, (_, i) => notice(`nationwide-${i}`, "nationwide")),
  notice("unknown-1"), notice("unknown-2"),
  notice("bizinfo-expired", "busan", { expiresAt: "2026-08-31" }),
  notice("commercial-geometry", "busan", { source: "전국 주요상권", commercialArea: { areaSquareMeters: 100, referenceDate: null, coordinateCount: 0 } }),
];
const dashboard = { categories: [{ id: "startup", items, totalCount: items.length, newCount: 0 }], sources: [] };
const page = (number = 1, filters = {}) => filterAndPaginatePublicDashboard(dashboard, "startup", "active", number, 24, now, filters).categories[0];

test("startup map counts all announcements before pagination and excludes nationwide from regional totals", () => {
  const first = page(), second = page(2);
  assert.equal(first.items.length, 24);
  assert.equal(first.startupFacets.allRegionCount, 72);
  assert.equal(first.startupFacets.regionCounts.busan, 30);
  assert.equal(first.startupFacets.nationwideCount, 10);
  assert.equal(first.startupFacets.unknownRegionCount, 2);
  assert.deepEqual(first.startupFacets, second.startupFacets);
  assert.equal(first.filteredTotalCount, 72);
  assert.equal(first.items.some(item => item.commercialArea), false);
});

test("regional filtering remains stable across pages and nationwide inclusion is explicit", () => {
  const first = page(1, { region: "busan" }), second = page(2, { region: "busan" });
  assert.equal(first.filteredTotalCount, 30);
  assert.equal(second.items.length, 6);
  assert.equal(second.hasMore, false);
  assert.equal([...first.items, ...second.items].every(item => item.id.startsWith("busan-")), true);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 30);
  assert.equal(page(1, { region: "busan", includeNationwide: true }).filteredTotalCount, 40);
  assert.equal(page(1, { region: "nationwide" }).filteredTotalCount, 10);
});

test("Seoul current-opportunity view excludes reverified historical K-Startup editions", () => {
  const oldEdition = notice("kstartup-14326", "seoul", {
    title: "2012년 전국창업경진대회 왕중왕전 SUPER STAR V",
    source: "K-Startup",
    publishedAt: null,
    sourceUpdatedAt: null,
    applicationStartsAt: null,
    expiresAt: null,
    discoveredAt: "2026-08-31T01:00:00Z",
    lastVerifiedAt: "2026-09-01T00:00:00Z",
  });
  const currentEdition = notice("kstartup-current-seoul", "seoul", {
    title: "2026년 서울 예비창업자 지원",
    source: "K-Startup",
  });
  const source = {
    categories: [{ id: "startup", items: [oldEdition, currentEdition], totalCount: 2, newCount: 0 }],
    sources: [],
  };
  const filters = { region: "seoul", includeNationwide: false };
  const active = filterAndPaginatePublicDashboard(source, "startup", "active", 1, 24, now, filters)
    .categories[0];
  const expired = filterAndPaginatePublicDashboard(source, "startup", "expired", 1, 24, now, filters)
    .categories[0];

  assert.deepEqual(active.items.map(({ id }) => id), ["kstartup-current-seoul"]);
  assert.equal(active.filteredTotalCount, 1);
  assert.equal(active.startupFacets.allRegionCount, 1);
  assert.equal(active.startupFacets.regionCounts.seoul, 1);
  assert.deepEqual(expired.items.map(({ id }) => id), ["kstartup-14326"]);
});

test("text query is applied to the complete catalogue before page slicing and region facets", () => {
  const result = page(1, { query: "SEED busan-29", region: "busan" });
  assert.deepEqual(result.items.map(item => item.id), ["busan-29"]);
  assert.equal(result.startupFacets.allRegionCount, 1);
  assert.equal(result.startupFacets.regionCounts.busan, 1);
  assert.equal(result.startupFacets.regionCounts.seoul, 0);
});

test("viewer normalization decodes provider entities and conservatively deduplicates mirrored startup notices", () => {
  const shared = {
    title: "&apos;청년&#32;창업&nbsp;사업화 지원&apos;",
    expiresAt: "2026-09-30",
    youthPolicyEligibility: { regionScope: "regional", regions: ["seoul"] },
  };
  const normalized = deduplicatePublicCatalogItems([
    notice("kstartup-mirror", "seoul", {
      ...shared,
      source: "K-Startup",
      sourceLinkKind: "detail",
      sourceUrl: "https://www.example.go.kr/notice/?utm_source=k-startup#overview",
      summary: "짧은 설명",
    }),
    notice("bizinfo-data-go-mirror", "seoul", {
      ...shared,
      source: "중소벤처기업부 기업마당",
      sourceLinkKind: "detail",
      sourceUrl: "https://example.go.kr/notice",
      summary: "공식 사업 대상과 신청 절차를 포함한 더 자세한 설명",
    }),
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].title, "'청년 창업 사업화 지원'");
  assert.equal(normalized[0].id, "bizinfo-data-go-mirror");
});

test("same-title startup notices from different institutions stay distinct without shared identity evidence", () => {
  const shared = {
    title: "2026 청년 창업 사업화 지원",
    expiresAt: "2026-09-30",
    youthPolicyEligibility: { regionScope: "regional", regions: ["seoul"] },
    sourceLinkKind: "detail",
  };
  const distinct = deduplicatePublicCatalogItems([
    notice("agency-a-001", "seoul", {
      ...shared,
      source: "서울 창업지원기관 A",
      sourceUrl: "https://agency-a.go.kr/notices/001",
    }),
    notice("agency-b-001", "seoul", {
      ...shared,
      source: "서울 창업지원기관 B",
      sourceUrl: "https://agency-b.go.kr/notices/001",
    }),
  ]);
  assert.equal(distinct.length, 2);
  assert.deepEqual(distinct.map((item) => item.id).sort(), ["agency-a-001", "agency-b-001"]);
});

test("exact Bizinfo official ids deduplicate mirrors even when their detail URLs differ", () => {
  const shared = {
    title: "기업마당 공식 식별자 공고",
    expiresAt: "2026-10-15",
    youthPolicyEligibility: { regionScope: "nationwide", regions: [] },
    sourceLinkKind: "detail",
  };
  const mirrored = deduplicatePublicCatalogItems([
    notice("bizinfo-shared-123", "nationwide", {
      ...shared,
      source: "기업마당",
      sourceUrl: "https://www.bizinfo.go.kr/web/notice/legacy-123",
    }),
    notice("bizinfo-data-go-shared-123", "nationwide", {
      ...shared,
      source: "공공데이터포털 기업마당",
      sourceUrl: "https://www.bizinfo.go.kr/web/notice/current-123",
    }),
  ]);
  assert.equal(mirrored.length, 1);
  assert.equal(mirrored[0].id, "bizinfo-data-go-shared-123");
});

test("recent announcement filters do not hide the independent Seoul commercial snapshot", () => {
  const commercial = notice("seoul-commercial-1000001", null, {
    title: "서울 분기 상권",
    publishedAt: "2026-03-31",
    lastVerifiedAt: "2026-08-31T00:00:00Z",
    source: "서울시 상권분석서비스",
    commercialArea: {
      areaSquareMeters: 1_000,
      referenceDate: "2026-03-31",
      coordinateCount: 0,
      analytics: {
        officialCode: "1000001",
        referenceQuarter: "20261",
        areaType: "골목상권",
        estimatedTotalSales: 1_000_000,
        industrySalesComposition: [],
        salesByHour: [],
        footfallByHour: [],
        sourceUrl: "https://data.seoul.go.kr/example",
      },
    },
  });
  const source = { categories: [{ id: "startup", items: [...items, commercial], totalCount: items.length + 1, newCount: 0 }], sources: [] };
  const result = filterAndPaginatePublicDashboard(
    source,
    "startup",
    "recent-7d",
    1,
    24,
    now,
    {},
    true,
  ).categories[0];
  assert.equal(result.items.some((item) => item.id === commercial.id), false);
  assert.equal(result.supplementalItems.some((item) => item.id === commercial.id), true);
});

test("stored future youth dates are quarantined on read before the durable repair runs", () => {
  const original = notice("youth-center-fixture", null, { category: "youth", publishedAt: "2026-09-02T00:00:00Z" });
  const payload = JSON.stringify({ categories: [{ id: "youth", items: [original], totalCount: 1, newCount: 0 }], sources: [] });
  const fixed = parseStoredPayload(payload, now).categories[0].items[0];
  assert.equal(fixed.publishedAt, null);
  assert.equal(fixed.sourceDateMetadata.rawPublishedAt, original.publishedAt);
  assert.equal(fixed.sourceDateMetadata.publishedAtStatus, "future");
  const older = notice("older", null, { publishedAt: "2026-12-01", discoveredAt: "2026-01-01T00:00:00Z", lastVerifiedAt: "2026-01-01T00:00:00Z" });
  assert.equal(boundPublicCatalogItems([older, original], 1, now)[0].id, original.id);
});
