import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

import { displayCommercialBoundary } from "../lib/public-data/geo.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const {
  buildCommercialAreaInsights,
  topCommercialAreasByConsumption,
} = await server.ssrLoadModule("/lib/public-data/commercial-area-insights.ts");
const {
  normalizeStoredCommercialArea,
  parseStoredPayload,
  PUBLIC_SNAPSHOT_MAX_BYTES,
  serializePublicDataPayload,
} = await server.ssrLoadModule("/lib/public-data/cache.ts");
test.after(() => server.close());

function commercialItem(id, title, boundary = null) {
  return {
    id,
    category: "startup",
    title,
    summary: "공식 주요상권",
    source: "소상공인시장진흥공단 주요상권정보",
    sourceUrl: "https://www.data.go.kr/data/15012005/openapi.do",
    sourceLinkKind: "dataset",
    publishedAt: "2026-06-30",
    discoveredAt: "2026-07-23T00:00:00.000Z",
    tags: ["주요상권"],
    location: {
      label: "서울특별시 중구",
      province: "서울특별시",
      city: "중구",
      precision: "point",
    },
    commercialArea: {
      areaSquareMeters: 123_400,
      referenceDate: "2026-06-30",
      coordinateCount: boundary?.points.length ?? null,
      ...(boundary ? { displayBoundary: boundary } : {}),
    },
  };
}

function metric(value, unit, sourceName = "공식 분석 데이터") {
  return {
    value,
    unit,
    status: "available",
    sourceName,
    sourceUrl: "https://data.seoul.go.kr/example",
    referenceDate: "2026-Q2",
  };
}

test("commercial boundary keeps a compact official Korean WGS84 outline", () => {
  const vertices = Array.from({ length: 80 }, (_, index) => {
    const angle = index / 80 * Math.PI * 2;
    return `${127 + Math.cos(angle) * 0.02} ${37.56 + Math.sin(angle) * 0.01}`;
  });
  vertices.push(vertices[0]);
  const boundary = displayCommercialBoundary(`POLYGON ((${vertices.join(", ")}))`, 24);
  assert.ok(boundary);
  assert.equal(boundary.points.length, 24);
  assert.equal(boundary.simplified, true);
  assert.deepEqual(boundary.points[0], boundary.points.at(-1));
  assert.equal(displayCommercialBoundary("POLYGON ((953000 1950000, 954000 1950000, 954000 1951000))"), null);
});

test("missing sales analytics remain null and area is never used as a spending rank", () => {
  const boundary = displayCommercialBoundary("POLYGON ((126.99 37.55, 127.01 37.55, 127.01 37.57, 126.99 37.57, 126.99 37.55))");
  const insights = buildCommercialAreaInsights([
    commercialItem("commercial-a", "A 상권", boundary),
    commercialItem("commercial-b", "B 상권"),
  ]);
  assert.equal(insights.length, 2);
  assert.equal(insights.every((item) => item.rankByConsumption === null), true);
  assert.equal(insights[0].totalConsumption.value, null);
  assert.equal(insights[0].totalConsumption.status, "not-provided");
  assert.equal(insights[0].boundaryArea.value, 123_400);
  assert.equal(insights[0].boundary.status, "available");
  assert.equal(topCommercialAreasByConsumption(insights).length, 0);
});

test("official consumption ranks records while every metric retains source and reference metadata", () => {
  const items = [
    commercialItem("commercial-a", "A 상권"),
    commercialItem("commercial-b", "B 상권"),
    commercialItem("commercial-c", "C 상권"),
  ];
  const insights = buildCommercialAreaInsights(items, [
    {
      itemId: "commercial-a",
      totalConsumption: metric(900_000_000, "KRW"),
      areaType: metric("골목상권", "classification"),
      industryComposition: metric([
        { name: "음식", sharePercent: 60, storeCount: 30 },
        { name: "소매", sharePercent: 40, storeCount: 20 },
      ], "%"),
      paymentsByHour: metric([{ hour: 9, amount: 10_000 }, { hour: 18, amount: 50_000 }], "KRW"),
      footfallByHour: metric([{ hour: 9, people: 120 }, { hour: 18, people: 480 }], "people"),
      rent: metric(82_000, "KRW/㎡/month"),
    },
    {
      itemId: "commercial-b",
      totalConsumption: metric(1_200_000_000, "KRW"),
    },
    {
      itemId: "commercial-c",
      totalConsumption: metric(-1, "KRW"),
    },
  ]);
  assert.deepEqual(insights.map((item) => [item.id, item.rankByConsumption]), [
    ["commercial-b", 1],
    ["commercial-a", 2],
    ["commercial-c", null],
  ]);
  const areaA = insights.find((item) => item.id === "commercial-a");
  assert.ok(areaA);
  assert.equal(areaA.areaType.value, "골목상권");
  assert.equal(areaA.industryComposition.value.length, 2);
  assert.equal(areaA.paymentsByHour.value[1].amount, 50_000);
  assert.equal(areaA.footfallByHour.value[1].people, 480);
  assert.equal(areaA.rent.source.referenceDate, "2026-Q2");
  assert.equal(areaA.rent.source.name, "공식 분석 데이터");
  assert.equal(insights.find((item) => item.id === "commercial-c").totalConsumption.status, "temporarily-unavailable");
});

test("invalid or incomplete chart values are not turned into example data", () => {
  const [insight] = buildCommercialAreaInsights([commercialItem("commercial-a", "A 상권")], [{
    itemId: "commercial-a",
    industryComposition: metric([{ name: "음식", sharePercent: 120, storeCount: 3 }], "%"),
    paymentsByHour: metric([{ hour: 25, amount: 50_000 }], "KRW"),
    footfallByHour: metric([{ hour: 18, people: -3 }], "people"),
  }]);
  assert.equal(insight.industryComposition.value, null);
  assert.equal(insight.paymentsByHour.value, null);
  assert.equal(insight.footfallByHour.value, null);
  assert.equal(insight.industryComposition.status, "temporarily-unavailable");
});

test("embedded Seoul analytics drive rankings and charts without inventing rent", () => {
  const item = commercialItem("seoul-commercial-1000001", "Seoul commercial area");
  item.source = "Seoul Commercial Area Analysis Service";
  item.commercialArea.analytics = {
    officialCode: "1000001",
    referenceQuarter: "20261",
    areaType: "Alley commercial area",
    estimatedTotalSales: 1_250_000_000,
    industrySalesComposition: [
      { name: "Dining", sharePercent: 65, storeCount: null },
      { name: "Retail", sharePercent: 35, storeCount: null },
    ],
    salesByHour: [{ hour: 17, amount: 700_000_000 }, { hour: 6, amount: 550_000_000 }],
    footfallByHour: [{ hour: 17, people: 5_000 }, { hour: 6, people: 2_500 }],
    sourceUrl: "https://data.seoul.go.kr/dataList/OA-15572/A/1/datasetView.do",
  };

  const [insight] = buildCommercialAreaInsights([item]);
  assert.equal(insight.rankByConsumption, 1);
  assert.equal(insight.totalConsumption.value, 1_250_000_000);
  assert.equal(insight.totalConsumption.source.referenceDate, "2026-06-30");
  assert.equal(insight.totalConsumption.source.url, item.commercialArea.analytics.sourceUrl);
  assert.equal(insight.areaType.value, "Alley commercial area");
  assert.deepEqual(insight.industryComposition.value, item.commercialArea.analytics.industrySalesComposition);
  assert.deepEqual(insight.paymentsByHour.value.map(({ hour }) => hour), [6, 17]);
  assert.deepEqual(insight.footfallByHour.value.map(({ hour }) => hour), [6, 17]);
  assert.equal(insight.rent.value, null);
  assert.equal(insight.rent.status, "not-provided");

  const [overridden] = buildCommercialAreaInsights([item], [{
    itemId: item.id,
    totalConsumption: metric(42, "KRW", "Explicit source"),
  }]);
  assert.equal(overridden.totalConsumption.value, 42);
  assert.equal(overridden.totalConsumption.source.name, "Explicit source");
  assert.equal(overridden.areaType.value, "Alley commercial area");
});

test("stored Seoul names and structured locations repair separator mojibake without duplication", () => {
  const item = commercialItem("seoul-commercial-1000002", "종로?청계 관광특구");
  item.location = {
    label: "동작구 노량진1동",
    province: "서울특별시",
    city: "동작구",
    neighborhood: "동작구 노량진1동",
    precision: "administrative",
  };
  const [insight] = buildCommercialAreaInsights([item]);
  assert.equal(insight.name, "종로·청계 관광특구");
  assert.equal(insight.locationLabel, "서울특별시 동작구 노량진1동");
});

test("stored Seoul analytics are strictly sanitized before entering a snapshot", () => {
  const valid = normalizeStoredCommercialArea({
    areaSquareMeters: 12_300,
    referenceDate: "2026-03-31",
    coordinateCount: 0,
    analytics: {
      officialCode: "1000001",
      referenceQuarter: "20261",
      areaType: "Alley commercial area",
      estimatedTotalSales: 900_000,
      industrySalesComposition: [{ name: "Dining", sharePercent: 100, storeCount: null }],
      salesByHour: [0, 6, 11, 14, 17, 21].map((hour) => ({ hour, amount: 150_000 })),
      footfallByHour: [0, 6, 11, 14, 17, 21].map((hour) => ({ hour, people: 50 })),
      sourceUrl: "https://data.seoul.go.kr/dataList/OA-15572/A/1/datasetView.do#ignored",
    },
  });
  assert.ok(valid?.analytics);
  assert.equal(valid.analytics.sourceUrl.includes("#"), false);
  assert.equal(valid.analytics.estimatedTotalSales, 900_000);

  const invalid = normalizeStoredCommercialArea({
    areaSquareMeters: 12_300,
    referenceDate: "2026-03-31",
    coordinateCount: 0,
    analytics: {
      officialCode: "1000001",
      referenceQuarter: "20265",
      areaType: "Alley commercial area",
      estimatedTotalSales: -1,
      industrySalesComposition: [{ name: "Dining", sharePercent: 120, storeCount: null }],
      salesByHour: [{ hour: 6, amount: -1 }],
      footfallByHour: [{ hour: 6, people: 300 }],
      sourceUrl: "http://127.0.0.1/secret",
    },
  });
  assert.ok(invalid);
  assert.equal("analytics" in invalid, false);
});

function syntheticSeoulItem(index) {
  const code = String(3_110_001 + index);
  const industries = [
    ["한식", 30], ["카페", 25], ["소매", 20],
    ["생활서비스", 10], ["교육", 10], ["기타", 5],
  ];
  return {
    id: `seoul-commercial-${code}`,
    category: "startup",
    title: `서울 공식 상권 ${index}`,
    summary: "2026-03-31 기준 서울시 상권 추정매출·업종 구성·시간대별 유동인구 정보입니다.",
    source: "서울시 상권분석서비스",
    sourceUrl: "https://data.seoul.go.kr/dataList/OA-15572/A/1/datasetView.do",
    sourceLinkKind: "dataset",
    publishedAt: "2026-03-31",
    discoveredAt: "2026-07-23T00:00:00.000Z",
    lastVerifiedAt: "2026-07-23T00:00:00.000Z",
    tags: ["서울상권", "추정매출", "골목상권", "종로구", `행정동 ${index}`],
    location: {
      label: `종로구 행정동 ${index}`,
      province: "서울특별시",
      city: "종로구",
      neighborhood: `행정동 ${index}`,
      precision: "administrative",
    },
    commercialArea: {
      areaSquareMeters: 10_000 + index,
      referenceDate: "2026-03-31",
      coordinateCount: null,
      analytics: {
        officialCode: code,
        referenceQuarter: "20261",
        areaType: "골목상권",
        estimatedTotalSales: 100_000_000 + index,
        industrySalesComposition: industries.map(([name, sharePercent]) => ({
          name,
          sharePercent,
          storeCount: null,
        })),
        salesByHour: [0, 6, 11, 14, 17, 21].map((hour, hourIndex) => ({
          hour,
          amount: 10_000_000 + index + hourIndex,
        })),
        footfallByHour: [0, 6, 11, 14, 17, 21].map((hour, hourIndex) => ({
          hour,
          people: 10_000 + index + hourIndex,
        })),
        sourceUrl: "https://data.seoul.go.kr/dataList/OA-15572/A/1/datasetView.do",
      },
    },
  };
}

function syntheticNationalItem(provinceIndex, areaIndex) {
  const province = `Province ${String(provinceIndex + 1).padStart(2, "0")}`;
  const longitude = 126 + provinceIndex * 0.08 + areaIndex * 0.002;
  const latitude = 34 + provinceIndex * 0.17 + areaIndex * 0.002;
  const ring = Array.from({ length: 23 }, (_, pointIndex) => {
    const angle = pointIndex / 23 * Math.PI * 2;
    return [
      Number((longitude + Math.cos(angle) * 0.012).toFixed(6)),
      Number((latitude + Math.sin(angle) * 0.008).toFixed(6)),
    ];
  });
  ring.push([...ring[0]]);
  return {
    id: `commercial-national-${provinceIndex}-${areaIndex}`,
    category: "startup",
    title: `${province} major commercial area ${areaIndex + 1}`,
    summary: `${province} official commercial boundary directory entry`,
    source: "Small Enterprise and Market Service commercial area information",
    sourceUrl: "https://www.data.go.kr/data/15012005/openapi.do",
    sourceLinkKind: "dataset",
    publishedAt: "2026-06-30",
    discoveredAt: "2026-07-23T00:00:00.000Z",
    lastVerifiedAt: "2026-07-23T00:00:00.000Z",
    tags: ["commercial area", province, `district ${areaIndex + 1}`],
    location: {
      label: `${province} district ${areaIndex + 1}`,
      province,
      city: `City ${areaIndex + 1}`,
      latitude,
      longitude,
      precision: "point",
    },
    commercialArea: {
      areaSquareMeters: 500_000 - provinceIndex * 1_000 - areaIndex * 100,
      referenceDate: "2026-06-30",
      coordinateCount: ring.length,
      displayBoundary: { points: ring, simplified: true },
    },
  };
}

function syntheticPayload(items) {
  return {
    exchange: { source: "공식 환율", sourceUrl: "https://www.koreaexim.go.kr", asOf: null, rates: [] },
    market: [],
    categories: [
      { id: "youth", items: [], totalCount: 0, newCount: 0 },
      { id: "finance", items: [], totalCount: 0, newCount: 0 },
      { id: "startup", items, totalCount: items.length, newCount: 0 },
    ],
    sources: [{
      id: "seoul-commercial",
      label: "서울시 상권분석서비스",
      status: "live",
      itemCount: items.length,
      sourceUrl: "https://data.seoul.go.kr/dataList/OA-15572/A/1/datasetView.do",
    }],
  };
}

test("1,650 Seoul analytics rows round-trip below the D1 safety ceiling", () => {
  const items = Array.from({ length: 1_650 }, (_, index) => syntheticSeoulItem(index));
  const payload = syntheticPayload(items);
  const uncompressedBytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  assert.ok(uncompressedBytes > 2_000_000);
  const stored = serializePublicDataPayload(payload);
  const storedBytes = new TextEncoder().encode(stored).byteLength;
  assert.ok(storedBytes < PUBLIC_SNAPSHOT_MAX_BYTES);
  const restored = parseStoredPayload(stored);
  assert.ok(restored);
  const restoredItems = restored.categories.find((group) => group.id === "startup").items;
  assert.equal(restoredItems.length, 1_650);
  assert.deepEqual(restoredItems[0], items[0]);
  assert.deepEqual(restoredItems.at(-1), items.at(-1));

  const malformed = JSON.parse(stored);
  malformed.__boraCompact.r[0][13][4] = [1];
  assert.equal(parseStoredPayload(JSON.stringify(malformed)), null);
});

test("compact Seoul analytics preserves unavailable hourly series without inventing zeroes", () => {
  const noFootfall = syntheticSeoulItem(0);
  noFootfall.commercialArea.analytics.footfallByHour = [];
  const noSalesBands = syntheticSeoulItem(1);
  noSalesBands.commercialArea.analytics.salesByHour = [];
  const stored = serializePublicDataPayload(syntheticPayload([noFootfall, noSalesBands]));
  const restored = parseStoredPayload(stored);
  assert.ok(restored);
  const restoredItems = restored.categories.find((group) => group.id === "startup").items;
  assert.deepEqual(restoredItems[0].commercialArea.analytics.footfallByHour, []);
  assert.deepEqual(restoredItems[0].commercialArea.analytics.salesByHour, noFootfall.commercialArea.analytics.salesByHour);
  assert.deepEqual(restoredItems[1].commercialArea.analytics.salesByHour, []);
  assert.deepEqual(restoredItems[1].commercialArea.analytics.footfallByHour, noSalesBands.commercialArea.analytics.footfallByHour);

  const malformed = JSON.parse(stored);
  malformed.__boraCompact.r[0][13][5] = [1];
  assert.equal(parseStoredPayload(JSON.stringify(malformed)), null);
});

test("a combined Seoul 1,650 plus national province-top-10 snapshot stays below the D1 ceiling", () => {
  const seoulItems = Array.from({ length: 1_650 }, (_, index) => syntheticSeoulItem(index));
  const nationalItems = Array.from({ length: 17 }, (_, provinceIndex) => (
    Array.from({ length: 10 }, (_, areaIndex) => syntheticNationalItem(provinceIndex, areaIndex))
  )).flat();
  const payload = syntheticPayload([...seoulItems, ...nationalItems]);
  payload.sources.push({
    id: "commercial-area",
    label: "National province top-ten commercial area directory",
    status: "live",
    itemCount: nationalItems.length,
    sourceUrl: "https://www.data.go.kr/data/15012005/openapi.do",
  });

  const stored = serializePublicDataPayload(payload);
  const storedBytes = new TextEncoder().encode(stored).byteLength;
  assert.ok(storedBytes < PUBLIC_SNAPSHOT_MAX_BYTES, `${storedBytes} must be below ${PUBLIC_SNAPSHOT_MAX_BYTES}`);
  const restored = parseStoredPayload(stored);
  assert.ok(restored);
  const restoredItems = restored.categories.find((group) => group.id === "startup").items;
  assert.equal(restoredItems.length, 1_820);
  assert.equal(restoredItems.filter((item) => item.id.startsWith("seoul-commercial-")).length, 1_650);
  const restoredNational = restoredItems.filter((item) => item.id.startsWith("commercial-national-"));
  assert.equal(restoredNational.length, 170);
  assert.equal(restoredNational.every((item) => item.commercialArea?.analytics === undefined), true);
  assert.equal(restoredNational.every((item) => item.commercialArea?.displayBoundary?.points.length === 24), true);
});

test("legacy object snapshots strictly cross-validate every Seoul analytics owner and official URL", () => {
  const legacyPayload = (item, groupId = "startup") => {
    const payload = syntheticPayload([]);
    const group = payload.categories.find((candidate) => candidate.id === groupId);
    group.items = [item];
    group.totalCount = 1;
    return JSON.stringify(payload);
  };
  const valid = syntheticSeoulItem(0);
  assert.ok(parseStoredPayload(legacyPayload(valid)));

  const rejected = [
    {
      label: "official code does not match the item ID",
      item: { ...structuredClone(valid), id: "seoul-commercial-3999999" },
      groupId: "startup",
    },
    {
      label: "analytics is owned by a non-Seoul item ID",
      item: { ...structuredClone(valid), id: "commercial-national-0-0" },
      groupId: "startup",
    },
    {
      label: "the item is outside the startup category",
      item: { ...structuredClone(valid), category: "finance" },
      groupId: "finance",
    },
    {
      label: "the item source is not the official Seoul host",
      item: { ...structuredClone(valid), sourceUrl: "https://example.com/seoul-commercial" },
      groupId: "startup",
    },
    {
      label: "the item source is not HTTPS",
      item: { ...structuredClone(valid), sourceUrl: "http://data.seoul.go.kr/dataList/OA-15572/A/1/datasetView.do" },
      groupId: "startup",
    },
    {
      label: "the analytics source is not the official Seoul host",
      item: {
        ...structuredClone(valid),
        commercialArea: {
          ...structuredClone(valid.commercialArea),
          analytics: {
            ...structuredClone(valid.commercialArea.analytics),
            sourceUrl: "https://example.com/seoul-analytics",
          },
        },
      },
      groupId: "startup",
    },
    {
      label: "the analytics source is not HTTPS",
      item: {
        ...structuredClone(valid),
        commercialArea: {
          ...structuredClone(valid.commercialArea),
          analytics: {
            ...structuredClone(valid.commercialArea.analytics),
            sourceUrl: "http://data.seoul.go.kr/dataList/OA-15572/A/1/datasetView.do",
          },
        },
      },
      groupId: "startup",
    },
  ];
  for (const { label, item, groupId } of rejected) {
    assert.equal(parseStoredPayload(legacyPayload(item, groupId)), null, label);
  }
});

test("oversized non-compact snapshots fail closed before a D1 write", () => {
  const oversized = syntheticPayload([{
    ...syntheticSeoulItem(0),
    id: "bizinfo-oversized",
    commercialArea: undefined,
    summary: "x".repeat(PUBLIC_SNAPSHOT_MAX_BYTES),
  }]);
  assert.throws(() => serializePublicDataPayload(oversized), /public_snapshot_too_large/u);
});
