import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": projectRoot } },
  server: { middlewareMode: true },
});
const search = await server.ssrLoadModule("/lib/public-data/commercial-store-search.ts");
const config = await server.ssrLoadModule("/lib/public-data/commercial-search-config.ts");
test.after(() => server.close());

test("nationwide commercial search exposes every current province code", () => {
  assert.equal(config.COMMERCIAL_SEARCH_PROVINCES.length, 17);
  assert.equal(new Set(config.COMMERCIAL_SEARCH_PROVINCES.map((item) => item.code)).size, 17);
  assert.equal(
    config.COMMERCIAL_SEARCH_PROVINCES.find((item) => item.name === "강원특별자치도")?.code,
    "51",
  );
  assert.equal(
    config.COMMERCIAL_SEARCH_PROVINCES.find((item) => item.name === "전북특별자치도")?.code,
    "52",
  );
});

test("store lookup uses official scoped endpoints and never sends a business-name keyword upstream", () => {
  const province = search.commercialStoreProviderRequest({
    provinceCode: "26",
    industryCode: "I1",
    page: 3,
    pageSize: 24,
  });
  assert.match(province.endpoint, /\/storeListInDong$/u);
  assert.deepEqual(province.params, {
    divId: "ctprvnCd",
    key: "26",
    indsLclsCd: "I1",
    pageNo: "3",
    numOfRows: "24",
    type: "json",
  });
  assert.equal("query" in province.params, false);
  assert.equal("bizesNm" in province.params, false);

  const area = search.commercialStoreProviderRequest({
    areaCode: "9368",
    page: 1,
    pageSize: 50,
  });
  assert.match(area.endpoint, /\/storeListInArea$/u);
  assert.deepEqual(area.params, {
    key: "9368",
    pageNo: "1",
    numOfRows: "50",
    type: "json",
  });
});

test("commercial provider request validation fails closed before spending quota", () => {
  assert.throws(() => search.commercialStoreProviderRequest({
    provinceCode: "99",
    page: 1,
    pageSize: 24,
  }), /commercial_search_province_required/u);
  assert.throws(() => search.commercialStoreProviderRequest({
    provinceCode: "11",
    page: 0,
    pageSize: 24,
  }), /invalid_commercial_search_page/u);
  assert.throws(() => search.commercialStoreProviderRequest({
    areaCode: "9368 OR 1=1",
    page: 1,
    pageSize: 24,
  }), /invalid_commercial_area_code/u);
  assert.throws(() => search.commercialStoreProviderRequest({
    provinceCode: "11",
    industryCode: "I1&serviceKey=leak",
    page: 1,
    pageSize: 24,
  }), /invalid_commercial_industry_code/u);
});

test("official store rows retain industry, address and safe Korean coordinates", () => {
  const rows = search.normalizeCommercialStoreRows([{
    bizesId: "12345678",
    bizesNm: "보라카페",
    brchNm: "서면점",
    indsLclsCd: "I1",
    indsLclsNm: "음식",
    indsMclsCd: "I101",
    indsMclsNm: "카페",
    indsSclsCd: "I10101",
    indsSclsNm: "커피 전문점",
    ksicCd: "I56220",
    ksicNm: "비알코올 음료점업",
    ctprvnCd: "26",
    ctprvnNm: "부산광역시",
    signguCd: "26230",
    signguNm: "부산진구",
    adongNm: "부전동",
    rdnmAdr: "부산광역시 부산진구 중앙대로 1",
    lnoAdr: "부산광역시 부산진구 부전동 1",
    newZipcd: "47290",
    lon: "129.0593",
    lat: "35.1578",
  }, {
    bizesId: "outside",
    bizesNm: "좌표오류점",
    lon: "12.34",
    lat: "56.78",
  }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].industry.minorName, "커피 전문점");
  assert.equal(rows[0].address.road, "부산광역시 부산진구 중앙대로 1");
  assert.deepEqual(rows[0].location, {
    longitude: 129.0593,
    latitude: 35.1578,
    precision: "point",
  });
  assert.equal(rows[1].location, null);
});

test("store composition is explicitly count-based and percentages use the returned page", () => {
  const items = search.normalizeCommercialStoreRows([
    { bizesId: "1", bizesNm: "A", indsLclsCd: "I1", indsLclsNm: "음식" },
    { bizesId: "2", bizesNm: "B", indsLclsCd: "I1", indsLclsNm: "음식" },
    { bizesId: "3", bizesNm: "C", indsLclsCd: "G1", indsLclsNm: "소매" },
  ]);
  const composition = search.commercialStoreComposition(items);
  assert.equal(composition.total, 3);
  assert.deepEqual(composition.items.map(({ name, count, sharePercent }) => ({
    name,
    count,
    sharePercent,
  })), [
    { name: "음식", count: 2, sharePercent: 66.7 },
    { name: "소매", count: 1, sharePercent: 33.3 },
  ]);
});

test("commercial search cache rejects malformed rows and mismatched expiry metadata", () => {
  const fetchedAt = "2026-07-29T01:00:00.000Z";
  const expiresAt = "2026-07-29T07:00:00.000Z";
  const item = search.normalizeCommercialStoreRows([{
    bizesId: "cache-1",
    bizesNm: "보라상점",
    indsLclsCd: "G1",
    indsLclsNm: "소매",
    rdnmAdr: "서울특별시 중구 세종대로 1",
    lon: "126.978",
    lat: "37.5665",
  }])[0];
  const payload = JSON.stringify({
    version: 1,
    kind: "stores",
    items: [item],
    providerTotalCount: 1,
    partial: false,
    fetchedAt,
    expiresAt,
  });
  assert.equal(
    search.parseCommercialSearchEnvelope(payload, "stores", Date.parse(expiresAt))?.items.length,
    1,
  );
  assert.equal(
    search.parseCommercialSearchEnvelope(payload, "stores", Date.parse(expiresAt) + 1),
    null,
  );
  assert.equal(
    search.parseCommercialSearchEnvelope(JSON.stringify({
      ...JSON.parse(payload),
      items: [{ id: "broken", name: "손상 캐시" }],
    }), "stores", Date.parse(expiresAt)),
    null,
  );
  assert.equal(
    search.parseCommercialSearchEnvelope(JSON.stringify({
      ...JSON.parse(payload),
      fetchedAt: "2026-07-30T01:00:00.000Z",
    }), "stores", Date.parse(expiresAt)),
    null,
  );
});

test("commercial search is authenticated, cached and charged to the shared quota ledger", async () => {
  const route = await readFile(
    new URL("../app/api/public-data/commercial-search/route.ts", import.meta.url),
    "utf8",
  );
  const backend = await readFile(
    new URL("../lib/public-data/commercial-store-search.ts", import.meta.url),
    "utf8",
  );
  const component = await readFile(
    new URL("../app/components/commercial-store-search.tsx", import.meta.url),
    "utf8",
  );
  const responseTypes = await readFile(
    new URL("../lib/public-data/commercial-search-types.ts", import.meta.url),
    "utf8",
  );
  const quotaLedger = await readFile(
    new URL("../lib/public-data/cache.ts", import.meta.url),
    "utf8",
  );
  const publicService = await readFile(
    new URL("../lib/public-data/service.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /authenticatedUser\(request\)/u);
  assert.match(route, /export async function POST/u);
  assert.match(route, /await requireSameOrigin\(request\)/u);
  assert.match(route, /json_content_type_required/u);
  assert.match(route, /authentication_required/u);
  assert.doesNotMatch(route, /export async function GET/u);
  assert.doesNotMatch(route, /areaName|industryName/u);
  assert.match(backend, /commercial_search_cache/u);
  assert.match(backend, /commercial_search_rate_limits/u);
  assert.match(
    backend,
    /const apiKey = await runtimeSecret\("DATA_GO_KR_API_KEY"\);\s*if \(!apiKey\) throw new CommercialSearchError\(503, "commercial_search_not_configured"\)/u,
  );
  assert.match(backend, /reserveInteractivePublicSourceCalls/u);
  assert.match(backend, /PUBLIC_API_MANUAL_RATIO/u);
  assert.match(backend, /"ServiceKey"/u);
  assert.match(backend, /storeZoneInAdmi/u);
  assert.match(backend, /storeListInArea/u);
  assert.match(backend, /storeListInDong/u);
  assert.doesNotMatch(component, /from "@\/lib\/public-data\/commercial-store-search"/u);
  assert.match(component, /점포 수 기준 업종 구성/u);
  assert.match(component, /추정매출·유동인구·임대료는 제공하지 않/u);
  assert.match(responseTypes, /basis: "current-provider-page"/u);
  assert.match(quotaLedger, /public_api_interactive_reservations/u);
  assert.match(quotaLedger, /reservation_token = \? AND source_id = \? AND quota_day = \?/u);
  assert.match(quotaLedger, /reserved_calls = reserved_calls \+ \?/u);
  assert.doesNotMatch(publicService, /errorCode: "reservation-conflict"/u);
});

test("commercial search keeps applied requests, selection and responsive details consistent", async () => {
  const component = await readFile(
    new URL("../app/components/commercial-store-search.tsx", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../app/components/commercial-store-search.module.css", import.meta.url),
    "utf8",
  );
  const startupPage = await readFile(
    new URL("../app/components/public-information-pages.tsx", import.meta.url),
    "utf8",
  );
  const startupCss = await readFile(
    new URL("../app/components/public-information-pages.module.css", import.meta.url),
    "utf8",
  );

  assert.match(component, /type AppliedAreaRequest/u);
  assert.match(component, /type AppliedStoreRequest/u);
  assert.match(component, /loadAreas\(appliedAreaRequest, areas\.page [+-] 1\)/u);
  assert.match(component, /loadStores\(appliedStoreRequest, stores\.page [+-] 1\)/u);
  assert.match(component, /function changeProvince\(nextProvinceCode: string\)[\s\S]*setAreas\(null\)[\s\S]*clearStoreResults\(\{ clearArea: true \}\)/u);
  assert.match(component, /function changeIndustry\(nextIndustryCode: string\)[\s\S]*clearStoreResults\(\)/u);
  assert.match(component, /const selectedStore = displayedStores\.find[\s\S]*\?\? null/u);
  assert.doesNotMatch(component, /stores\?\.items\.find\(\(item\) => item\.id === selectedStoreId\)/u);
  assert.match(component, /industryLoadState === "error"/u);
  assert.match(component, /visibleComposition\(stores, t\.other\)/u);
  assert.doesNotMatch(component, /영업 중인 점포|Browse operating stores/u);
  assert.doesNotMatch(component, /role="tab"/u);
  assert.doesNotMatch(component, /aria-selected=/u);
  assert.match(css, /\.modeTabs button\[aria-pressed="true"\]/u);
  assert.match(css, /\.detailLinks a \{ min-height: 44px;/u);
  assert.doesNotMatch(
    css,
    /@media \(max-width: 680px\)[\s\S]*\.insights \{ grid-row: auto; \}/u,
  );

  assert.match(startupPage, /useState<"nationwide" \| "analytics">\("analytics"\)/u);
  assert.match(
    startupPage,
    /function changeCommercialRegion\(region: string \| null\)[\s\S]*region\.includes\("서울"\) \? "analytics" : "nationwide"/u,
  );
  assert.match(startupPage, /const seoulCommercialItems = useMemo[\s\S]*\^seoul-commercial-\\d\{7,10\}/u);
  assert.match(startupPage, /<CommercialAreaInsights items=\{seoulCommercialItems\}/u);
  assert.ok(
    startupPage.indexOf("{commercialViewCopy.analytics}</button>")
      < startupPage.indexOf("{commercialViewCopy.nationwide}</button>"),
    "Seoul sales ranking must be the first commercial-area menu",
  );
  assert.match(startupPage, /onCommercialRegionChange=\{showTools \? changeCommercialRegion : undefined\}/u);
  assert.match(startupPage, /className=\{styles\.commercialViewTabs\} role="group"/u);
  assert.match(startupCss, /\.commercialViewTabs button\[aria-pressed="true"\]/u);
});
