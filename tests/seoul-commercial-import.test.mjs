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
const {
  seoulManifestCompleteness,
  validateSeoulCommercialImportPayload,
} = await server.ssrLoadModule("/app/api/public-data/import/seoul-commercial/route.ts");
const {
  seoulCommercialCatalogCoverage,
} = await server.ssrLoadModule("/lib/public-data/adapters.ts");
test.after(() => server.close());

const hours = [0, 6, 11, 14, 17, 21];

function item(index, {
  quarter = "20261",
  sales = index < 1_400,
  footfall = index < 1_499,
} = {}) {
  const code = String(3_000_001 + index);
  return {
    id: `seoul-commercial-${code}`,
    category: "startup",
    title: `서울 공식 상권 ${index}`,
    summary: "서울시 공식 HTTPS Sheet CSV를 같은 기준 분기로 결합한 상권 정보입니다.",
    source: "서울시 상권분석서비스 공식 HTTPS Sheet CSV",
    sourceUrl: "https://data.seoul.go.kr/dataList/OA-15572/A/1/datasetView.do",
    sourceLinkKind: "dataset",
    publishedAt: quarter === "20261" ? "2026-03-31" : "2025-12-31",
    discoveredAt: "2026-07-31T00:00:00.123456Z",
    lastVerifiedAt: "2026-07-31T00:00:00.123456Z",
    tags: ["서울", "상권"],
    commercialArea: {
      areaSquareMeters: 1_000 + index,
      referenceDate: quarter === "20261" ? "2026-03-31" : "2025-12-31",
      coordinateCount: null,
      analytics: {
        officialCode: code,
        referenceQuarter: quarter,
        areaType: "골목상권",
        estimatedTotalSales: sales ? 1_000_000 + index : null,
        industrySalesComposition: sales
          ? [{ name: "음식", sharePercent: 100, storeCount: null }]
          : [],
        salesByHour: sales
          ? hours.map((hour) => ({ hour, amount: 10_000 + hour }))
          : [],
        footfallByHour: footfall
          ? hours.map((hour) => ({ hour, people: 1_000 + hour }))
          : [],
        sourceUrl: "https://data.seoul.go.kr/dataList/OA-15572/A/1/datasetView.do",
      },
    },
  };
}

function dataset(infId, rowCount, areaCount, marker) {
  return {
    infId,
    providerRowCount: rowCount,
    fetchedRowCount: rowCount,
    providerAreaCount: areaCount,
    fetchedAreaCount: areaCount,
    contentBytes: rowCount * 100,
    sha256: marker.repeat(64),
  };
}

function payload() {
  const items = Array.from({ length: 1_500 }, (_, index) => item(index));
  return {
    sourceId: "seoul-commercial",
    manifest: {
      schemaVersion: 1,
      fullSnapshot: true,
      quarter: "20261",
      collectedAt: "2026-07-31T00:00:00.123456Z",
      unionAreaCount: items.length,
      itemCount: items.length,
      datasets: {
        sales: dataset("OA-15572", 18_000, 1_400, "a"),
        footfall: dataset("OA-15568", 1_499, 1_499, "b"),
        area: dataset("OA-15560", 1_500, 1_500, "c"),
      },
      coverage: {
        salesAreaCount: 1_400,
        footfallAreaCount: 1_499,
        areaCount: 1_500,
        salesRatio: 1_400 / 1_500,
        footfallRatio: 1_499 / 1_500,
      },
    },
    items,
  };
}

test("the full Seoul Sheet manifest cross-validates every item and official coverage", () => {
  const input = payload();
  const validated = validateSeoulCommercialImportPayload(input);
  assert.ok(validated);
  assert.equal(validated.items.length, 1_500);
  assert.equal(seoulManifestCompleteness(validated.manifest), "complete");

  const coverage = seoulCommercialCatalogCoverage(validated.items);
  assert.equal(coverage.complete, true);
  assert.equal(coverage.quarter, "20261");
  assert.equal(coverage.salesAreaCount, 1_400);
  assert.equal(coverage.footfallAreaCount, 1_499);

  const officialNullArea = payload();
  officialNullArea.items[0].commercialArea.areaSquareMeters = null;
  assert.ok(validateSeoulCommercialImportPayload(officialNullArea));
});

test("official provider gaps remain complete while incomplete downloads remain partial", () => {
  const input = payload();
  // One official area without footfall is represented by provider=fetched
  // counts and must not make the collection partial.
  assert.equal(input.manifest.coverage.footfallAreaCount, 1_499);
  assert.equal(seoulManifestCompleteness(input.manifest), "complete");

  input.manifest.datasets.footfall.fetchedRowCount -= 1;
  input.manifest.datasets.footfall.fetchedAreaCount -= 1;
  input.manifest.coverage.footfallAreaCount -= 1;
  input.manifest.coverage.footfallRatio = input.manifest.coverage.footfallAreaCount
    / input.manifest.coverage.areaCount;
  input.items[1_498].commercialArea.analytics.footfallByHour = [];
  const validated = validateSeoulCommercialImportPayload(input);
  assert.ok(validated);
  assert.equal(seoulManifestCompleteness(validated.manifest), "partial");
});

test("mixed quarters, duplicate IDs, count drift, and resurrected missing metrics fail closed", () => {
  const mixed = payload();
  mixed.items[0] = item(0, { quarter: "20254" });
  assert.equal(validateSeoulCommercialImportPayload(mixed), null);

  const duplicate = payload();
  duplicate.items[1].id = duplicate.items[0].id;
  duplicate.items[1].commercialArea.analytics.officialCode
    = duplicate.items[0].commercialArea.analytics.officialCode;
  assert.equal(validateSeoulCommercialImportPayload(duplicate), null);

  const drift = payload();
  drift.manifest.coverage.footfallAreaCount -= 1;
  assert.equal(validateSeoulCommercialImportPayload(drift), null);

  const fabricated = payload();
  const missingSales = fabricated.items.at(-1).commercialArea.analytics;
  missingSales.salesByHour = hours.map((hour) => ({ hour, amount: 0 }));
  assert.equal(validateSeoulCommercialImportPayload(fabricated), null);
});

test("central refresh loads and replaces the complete Seoul catalogue without stale merging", async () => {
  const service = await readFile(
    new URL("../lib/public-data/service.ts", import.meta.url),
    "utf8",
  );
  const route = await readFile(
    new URL("../app/api/public-data/import/seoul-commercial/route.ts", import.meta.url),
    "utf8",
  );
  const policies = await readFile(
    new URL("../lib/public-data/policies.ts", import.meta.url),
    "utf8",
  );

  assert.match(service, /sourceId === "seoul-commercial"/u);
  assert.match(service, /const fullSnapshot = catalog\.sourceId === "seoul-commercial"/u);
  assert.match(service, /if \(!fullSnapshot && !catalog\.completeGeneration[\s\S]*&& \(catalog\.status !== "live" \|\| catalog\.incremental\)\)/u);
  assert.match(route, /export async function GET\(request: Request\)/u);
  assert.match(route, /return noStore\(\{ error: "source_disabled" \}, \{ status: 409 \}\)/u);
  assert.match(route, /error: "incomplete_import_catalog"[\s\S]*status: 422/u);
  assert.match(route, /incomplete_import_catalog[\s\S]*const previous = new Map/u);
  assert.match(route, /await savePublicSourceCatalog\(SOURCE_ID, items, now\)[\s\S]*setPublicSourceActivation/u);
  assert.doesNotMatch(route, /priorAnalytics\?\.footfallByHour/u);
  assert.match(policies, /sourceId: "seoul-commercial"[\s\S]*estimatedCalls: 3/u);
});
