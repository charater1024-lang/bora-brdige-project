import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  root,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});
const boundaries = await server.ssrLoadModule("/lib/public-data/seoul-commercial-boundaries.ts");
test.after(async () => server.close());

test("the official static Seoul boundary is attached only by its exact district code", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "public/data/seoul-commercial-boundaries.min.json"), "utf8"));
  const asset = boundaries.normalizeSeoulCommercialBoundaryAsset(raw);
  assert.ok(asset);
  const code = Object.keys(asset.boundaries)[0];
  const sourceItem = {
    id: `seoul-commercial-${code}`,
    category: "startup",
    title: "공식 상권",
    summary: "",
    source: "서울 열린데이터광장",
    sourceUrl: asset.sourceUrl,
    publishedAt: null,
    discoveredAt: "2026-07-23T00:00:00.000Z",
    tags: [],
    commercialArea: {
      areaSquareMeters: 10,
      referenceDate: null,
      coordinateCount: null,
      analytics: { officialCode: code },
    },
  };
  const unrelated = { ...sourceItem, id: "commercial-national-zone" };
  const applied = boundaries.applySeoulCommercialBoundaries([sourceItem, unrelated], asset);
  assert.equal(applied[0].commercialArea.displayBoundary.points.length >= 3, true);
  assert.equal(applied[0].commercialArea.displayBoundary.simplified, true);
  assert.equal(applied[0].commercialArea.displayBoundary.sourceUrl, asset.sourceUrl);
  assert.equal(applied[0].commercialArea.displayBoundary.referenceDate, asset.sourceUpdatedAt);
  assert.equal(applied[0].commercialArea.analytics, sourceItem.commercialArea.analytics);
  assert.equal(applied[1], unrelated);
});

test("invalid or legally ambiguous boundary assets fail closed", () => {
  assert.equal(boundaries.normalizeSeoulCommercialBoundaryAsset({}), null);
  assert.equal(boundaries.normalizeSeoulCommercialBoundaryAsset({
    sourceUrl: "https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do",
    sourceUpdatedAt: "2026-06-11",
    metadata: { inputCrs: "EPSG:5181", outputCrs: "EPSG:4326", notForLegalSurvey: false },
    boundaries: { "3110001": [[127, 37.5], [127.1, 37.5], [127, 37.6]] },
  }), null);
});
