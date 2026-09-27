import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": projectRoot } },
  esbuild: { jsx: "automatic" },
  server: { middlewareMode: true, watch: null },
});
const regionView = await server.ssrLoadModule("/lib/public-data/startup-region-view.ts");
const mapPositions = await server.ssrLoadModule("/app/components/korea-region-map-positions.ts");
test.after(() => server.close());

test("startup map renders server-wide counts and every item of an already-paginated response", async () => {
  const { StartupRegionExplorer } = await server.ssrLoadModule("/app/components/startup-region-explorer.tsx");
  const items = Array.from({ length: 24 }, (_, index) => announcement(`page-item-${index}`, { tags: ["서울"] }));
  const markup = renderToStaticMarkup(createElement(StartupRegionExplorer, {
    items, locale: "ko", loading: false, catalogTotalCount: 80,
    facets: { allRegionCount: 150, nationwideCount: 30, unknownRegionCount: 4, regionCounts: { seoul: 80, jeju: 7 } },
    selection: { mode: "region", region: "seoul" }, query: "", onSelectionChange() {}, onQueryChange() {},
    renderItems: values => createElement("ul", null, values.map(item => createElement("li", { key: item.id }, item.id))),
  }));
  assert.match(markup, /aria-label="제주특별자치도 · 7"/u);
  assert.match(markup, /전체 서울특별시 대상 공고 80건/u);
  assert.match(markup, /page-item-23/u, "server page must not be truncated to the old 12-item client slice");
  assert.match(markup, /전체 검색 결과 80건 중 현재 페이지 24건/u);
});

function announcement(id, {
  title = id,
  tags = [],
  location,
  eligibility,
} = {}) {
  return {
    id,
    category: "startup",
    title,
    summary: "Official startup-support notice",
    source: "Official provider",
    sourceUrl: "https://example.go.kr/notice",
    publishedAt: "2026-07-29",
    discoveredAt: "2026-07-29T00:00:00.000Z",
    lastVerifiedAt: "2026-07-29T00:00:00.000Z",
    tags,
    ...(location ? { location } : {}),
    ...(eligibility ? { youthPolicyEligibility: eligibility } : {}),
  };
}

test("startup region scope uses normalized structured fields and ignores incidental title text", () => {
  const nationwide = announcement("nationwide", {
    title: "서울에서 열리는 전국 설명회",
    tags: ["전국"],
  });
  const regional = announcement("regional", {
    tags: ["서울특별시", "경기도"],
  });
  const location = announcement("location", {
    location: {
      label: "강원특별자치도 춘천시",
      province: "강원특별자치도",
      precision: "administrative",
    },
  });
  const unknown = announcement("unknown", {
    title: "부산 판로개척 지원",
  });

  assert.deepEqual(regionView.startupAnnouncementRegionScope(nationwide), {
    kind: "nationwide",
    regions: [],
  });
  assert.deepEqual(regionView.startupAnnouncementRegionScope(regional), {
    kind: "regional",
    regions: ["seoul", "gyeonggi"],
  });
  assert.deepEqual(regionView.startupAnnouncementRegionScope(location), {
    kind: "regional",
    regions: ["gangwon"],
  });
  assert.deepEqual(regionView.startupAnnouncementRegionScope(unknown), {
    kind: "unknown",
    regions: [],
  });
});

test("map counts exclude nationwide notices and region selection never mixes them in", () => {
  const items = [
    announcement("nationwide", { tags: ["전국"] }),
    announcement("seoul-1", { tags: ["서울특별시"] }),
    announcement("seoul-gyeonggi", { tags: ["서울", "경기도"] }),
    announcement("unknown"),
  ];
  const counts = regionView.startupAnnouncementRegionCounts(items);

  assert.equal(counts.total, 4);
  assert.equal(counts.nationwide, 1);
  assert.equal(counts.unknown, 1);
  assert.equal(counts.regions.seoul, 2);
  assert.equal(counts.regions.gyeonggi, 1);
  assert.equal(counts.regions.busan, 0);
  assert.deepEqual(
    regionView.startupAnnouncementsForRegion(items, { mode: "region", region: "seoul" })
      .map((item) => item.id),
    ["seoul-1", "seoul-gyeonggi"],
  );
  assert.deepEqual(
    regionView.startupAnnouncementsForRegion(items, { mode: "nationwide" })
      .map((item) => item.id),
    ["nationwide"],
  );
});

test("structured youth-region metadata remains a supported normalized input", () => {
  const item = announcement("structured", {
    eligibility: {
      regionScope: "regional",
      regions: ["jeju"],
    },
  });
  assert.deepEqual(regionView.startupAnnouncementRegionScope(item), {
    kind: "regional",
    regions: ["jeju"],
  });
});

test("provider-wide province taxonomy is not treated as evidence of regional eligibility", () => {
  const allProvinceTags = Object.values(regionView.STARTUP_PROVINCE_BY_REGION);
  const districtOnly = announcement("yeongwol-only", {
    title: "영월군 청년 창업육성 지원사업",
    tags: [...allProvinceTags, "영월군"],
  });
  const structuredLocation = announcement("structured-gangwon", {
    tags: [...allProvinceTags, "영월군"],
    location: {
      label: "강원특별자치도 영월군",
      province: "강원특별자치도",
      precision: "administrative",
    },
  });
  const explicitlyNationwide = announcement("taxonomy-nationwide", {
    tags: [...allProvinceTags, "전국"],
  });
  const sixteenRegions = announcement("sixteen-regions", {
    tags: allProvinceTags.slice(0, -1),
  });
  const structuredEligibility = announcement("structured-eligibility-seoul", {
    tags: allProvinceTags,
    eligibility: {
      regionScope: "regional",
      regions: ["seoul"],
    },
  });

  assert.deepEqual(regionView.startupAnnouncementRegionScope(districtOnly), {
    kind: "unknown",
    regions: [],
  });
  assert.deepEqual(regionView.startupAnnouncementRegionScope(structuredLocation), {
    kind: "regional",
    regions: ["gangwon"],
  });
  assert.deepEqual(regionView.startupAnnouncementRegionScope(explicitlyNationwide), {
    kind: "nationwide",
    regions: [],
  });
  assert.deepEqual(regionView.startupAnnouncementRegionScope(sixteenRegions), {
    kind: "regional",
    regions: Object.keys(regionView.STARTUP_PROVINCE_BY_REGION).slice(0, -1),
  });
  assert.deepEqual(regionView.startupAnnouncementRegionScope(structuredEligibility), {
    kind: "regional",
    regions: ["seoul"],
  });
  assert.deepEqual(
    regionView.startupAnnouncementsForRegion([districtOnly], { mode: "region", region: "seoul" }),
    [],
  );
  assert.deepEqual(
    regionView.startupAnnouncementsForRegion([districtOnly], { mode: "region", region: "gangwon" }),
    [],
  );
  assert.deepEqual(
    regionView.startupAnnouncementsForRegion([districtOnly], { mode: "all" })
      .map((item) => item.id),
    ["yeongwol-only"],
  );
  const counts = regionView.startupAnnouncementRegionCounts([districtOnly]);
  assert.equal(counts.unknown, 1);
  assert.equal(counts.nationwide, 0);
  assert.equal(Object.values(counts.regions).every((count) => count === 0), true);
});

test("mobile map grid protects touch targets and focus rings at a 320px viewport", () => {
  const mapWidth = 240;
  const mapPadding = 10;
  const columnGap = 12;
  const columns = 3;
  const focusRingExtent = 5;
  const cellWidth = (mapWidth - mapPadding * 2 - columnGap * (columns - 1)) / columns;

  assert.ok(cellWidth >= 64, "localized labels need at least 64px per grid cell");
  assert.ok(mapPadding >= focusRingExtent, "edge focus rings must remain inside the map");
  assert.ok(columnGap >= focusRingExtent * 2, "adjacent focus rings must not overlap");
  assert.equal(new Set(mapPositions.MOBILE_REGION_ORDER).size, 17);
  assert.deepEqual(
    [...mapPositions.MOBILE_REGION_ORDER].sort(),
    Object.keys(mapPositions.KOREA_REGION_MAP_POSITIONS).sort(),
  );
});

function renderedMapButtons(markup) {
  return [...markup.matchAll(
    /<button[^>]*data-region="([^"]+)"[^>]*><span>([^<]+)<\/span><small>/gu,
  )].map((match) => ({ region: match[1], label: match[2] }));
}

function estimatedLabelWidth(label) {
  return [...label].reduce((width, character) => (
    width + (/^[\u0000-\u007f]$/u.test(character) ? 6.5 : 12)
  ), 0);
}

test("startup and youth maps share visual DOM order and safe labels in every locale", async () => {
  const [{ StartupRegionExplorer }, { YouthPolicyFourSections }] = await Promise.all([
    server.ssrLoadModule("/app/components/startup-region-explorer.tsx"),
    server.ssrLoadModule("/app/components/youth-policy-four-sections.tsx"),
  ]);
  const expectedOrder = [...mapPositions.MOBILE_REGION_ORDER];
  const minimumCellContentWidth = 60;

  for (const locale of ["ko", "en", "ja", "zh"]) {
    const startupMarkup = renderToStaticMarkup(createElement(StartupRegionExplorer, {
      items: [], locale, loading: false, catalogTotalCount: 0,
      facets: { allRegionCount: 0, nationwideCount: 0, unknownRegionCount: 0, regionCounts: {} },
      selection: { mode: "all" }, query: "", onSelectionChange() {}, onQueryChange() {},
    }));
    const youthMarkup = renderToStaticMarkup(createElement(YouthPolicyFourSections, {
      dashboard: {
        authenticated: false,
        categories: [
          { id: "youth", items: [], totalCount: 0, newCount: 0 },
          { id: "finance", items: [], totalCount: 0, newCount: 0 },
          { id: "startup", items: [], totalCount: 0, newCount: 0 },
        ],
        sources: [],
        youthPolicyPersonalization: undefined,
      },
      locale, loading: false, viewMode: "all", selectedSection: "scholarship",
      regionSelection: { mode: "all" }, onSectionChange() {},
      onRegionSelectionChange() {}, onViewModeChange() {},
    }));

    for (const [name, markup] of [["startup", startupMarkup], ["youth", youthMarkup]]) {
      const buttons = renderedMapButtons(markup);
      assert.deepEqual(buttons.map((button) => button.region), expectedOrder, `${name}/${locale}`);
      for (const button of buttons) {
        assert.ok(
          estimatedLabelWidth(button.label) <= minimumCellContentWidth,
          `${name}/${locale}/${button.region} label must fit the conservative mobile cell`,
        );
      }
    }
  }
});

test("startup UI exposes map, separate nationwide filter, search, zero state and district handoff", async () => {
  const [component, page, stylesheet, youthComponent, youthStylesheet] = await Promise.all([
    readFile(
      new URL("../app/components/startup-region-explorer.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/public-information-pages.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/startup-region-explorer.module.css", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/youth-policy-four-sections.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/youth-policy-four-sections.module.css", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(component, /role="group" aria-label=\{t\.mapLabel\}/u);
  assert.match(component, /selection\.mode === "nationwide"/u);
  assert.match(component, /counts\.regions\[region\]/u);
  assert.match(component, /type="search"/u);
  assert.match(component, /visibleItems\.length/u);
  assert.doesNotMatch(component, /visibleLimit|visibleItems\.slice/u);
  assert.match(component, /renderItems\(visibleItems\)/u);
  assert.match(component, /facets\?\.regionCounts/u);
  assert.match(component, /onSelectionChange\(\{ mode: "region", region \}\)/u);
  assert.match(component, /onQueryChange\(event\.target\.value\)/u);
  assert.match(component, /catalogTotalCount: number/u);
  assert.match(component, /전체 검색 결과.*현재 페이지/u);
  assert.match(component, /지도 숫자는 전체 검색 결과/u);
  assert.match(component, /현재 선택한 범위의 창업 공고는 0건입니다/u);
  assert.match(component, /commercial-district-title/u);
  assert.match(page, /StartupRegionExplorer/u);
  assert.match(page, /category === "startup" && parsedRegionSelection\.mode === "region"/u);
  assert.match(page, /includeNationwide: categoryQuery\.get\("includeNationwide"\) === "true"/u);
  assert.match(page, /STEP 2 · 상권 분석/u);
  assert.match(stylesheet, /@media \(max-width: 680px\)/u);
  assert.match(stylesheet, /\.regionList \{[\s\S]*grid-template-columns: 1fr/u);
  assert.match(stylesheet, /\.regionList button \{[\s\S]*min-height: 44px/u);
  for (const mapComponent of [component, youthComponent]) {
    assert.match(mapComponent, /MOBILE_REGION_ORDER\.map\(\(region\)/u);
    assert.match(mapComponent, /data-region=\{region\}/u);
  }
  for (const mapStylesheet of [stylesheet, youthStylesheet]) {
    assert.match(mapStylesheet, /@media \(max-width: 680px\)[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/u);
    assert.match(mapStylesheet, /padding: 10px/u);
    assert.match(mapStylesheet, /gap: 12px/u);
    assert.match(mapStylesheet, /position: relative/u);
    assert.match(mapStylesheet, /min-width: 0/u);
    assert.match(mapStylesheet, /min-height: 48px/u);
    assert.match(mapStylesheet, /overflow-wrap: anywhere/u);
    assert.match(mapStylesheet, /\.koreaMap > button:hover \{[\s\S]*transform: none/u);
  }
  assert.doesNotMatch(component + page + stylesheet, /\uFFFD/u);
});
