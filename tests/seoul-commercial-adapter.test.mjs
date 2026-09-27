import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const {
  collectSeoulCommercialData,
  collectSeoulServicePages,
  normalizeSeoulCommercialRows,
  recentSeoulQuarterCandidates,
  SeoulCommercialRequestBudget,
  SEOUL_COMMERCIAL_MAX_REQUESTS,
  SEOUL_COMMERCIAL_PAGE_CONCURRENCY,
} = await server.ssrLoadModule("/lib/public-data/seoul-commercial-adapter.ts");
const { readBoundedResponseText } = await server.ssrLoadModule("/lib/public-data/bounded-response.ts");
test.after(() => server.close());

const hourSales = {
  TMZON_00_06_SELNG_AMT: "1",
  TMZON_06_11_SELNG_AMT: "2",
  TMZON_11_14_SELNG_AMT: "3",
  TMZON_14_17_SELNG_AMT: "4",
  TMZON_17_21_SELNG_AMT: "5",
  TMZON_21_24_SELNG_AMT: "6",
};
const hourFootfall = {
  TMZON_00_06_FLPOP_CO: "10",
  TMZON_06_11_FLPOP_CO: "20",
  TMZON_11_14_FLPOP_CO: "30",
  TMZON_14_17_FLPOP_CO: "40",
  TMZON_17_21_FLPOP_CO: "50",
  TMZON_21_24_FLPOP_CO: "60",
};

function salesRow(code, industryCode, industryName, amount) {
  return {
    STDR_YYQU_CD: "20261",
    TRDAR_CD: code,
    TRDAR_CD_NM: `상권 ${code}`,
    TRDAR_SE_CD_NM: "골목상권",
    SVC_INDUTY_CD: industryCode,
    SVC_INDUTY_CD_NM: industryName,
    THSMON_SELNG_AMT: String(amount),
    ...hourSales,
  };
}

function footfallRow(code) {
  return { STDR_YYQU_CD: "20261", TRDAR_CD: code, ...hourFootfall };
}

function areaRow(code) {
  return {
    TRDAR_CD: code,
    TRDAR_CD_NM: `상권 ${code}`,
    TRDAR_SE_CD_NM: "골목상권",
    SIGNGU_CD_NM: "종로구",
    ADSTRD_CD_NM: "청운효자동",
    RELM_AR: "1234.5",
  };
}

test("Seoul row labels repair middle-dot mojibake and remove repeated district prefixes", () => {
  const row = {
    ...areaRow("1000001"),
    TRDAR_CD_NM: "종로?청계 관광특구",
    SIGNGU_CD_NM: "동작구",
    ADSTRD_CD_NM: "동작구 노량진1동",
  };
  const [item] = normalizeSeoulCommercialRows({
    salesRows: [{ ...salesRow("1000001", "CS100001", "한식", 100), TRDAR_CD_NM: row.TRDAR_CD_NM }],
    footfallRows: [footfallRow("1000001")],
    areaRows: [row],
    quarter: "20261",
    nowIso: "2026-07-23T00:00:00.000Z",
    previous: new Map(),
  });
  assert.equal(item.title, "종로·청계 관광특구");
  assert.equal(item.location.label, "동작구 노량진1동");
  assert.equal(item.location.neighborhood, "노량진1동");
});

test("Seoul rows normalize sales, industries, hourly series, area and optional boundary without rent", () => {
  const nowIso = "2026-07-23T00:00:00.000Z";
  const previous = new Map([["seoul-commercial-1000001", { discoveredAt: "2026-07-01T00:00:00.000Z" }]]);
  const [item] = normalizeSeoulCommercialRows({
    salesRows: [
      salesRow("1000001", "CS100001", "한식", 600),
      salesRow("1000001", "CS100002", "소매", 400),
    ],
    footfallRows: [footfallRow("1000001")],
    areaRows: [areaRow("1000001")],
    quarter: "20261",
    nowIso,
    previous,
    boundaryLookup: () => ({
      points: [[126.98, 37.57], [127, 37.57], [127, 37.59], [126.98, 37.57]],
      simplified: true,
    }),
  });
  assert.equal(item.discoveredAt, "2026-07-01T00:00:00.000Z");
  assert.equal(item.commercialArea.areaSquareMeters, 1234.5);
  assert.equal(item.commercialArea.analytics.estimatedTotalSales, 1_000);
  assert.deepEqual(item.commercialArea.analytics.industrySalesComposition, [
    { name: "한식", sharePercent: 60, storeCount: null },
    { name: "소매", sharePercent: 40, storeCount: null },
  ]);
  assert.deepEqual(item.commercialArea.analytics.salesByHour.map((point) => point.amount), [2, 4, 6, 8, 10, 12]);
  assert.deepEqual(item.commercialArea.analytics.footfallByHour.map((point) => point.people), [10, 20, 30, 40, 50, 60]);
  assert.equal(item.commercialArea.displayBoundary.points.length, 4);
  assert.equal("rent" in item.commercialArea.analytics, false);
  assert.doesNotMatch(JSON.stringify(item), /openapi\.seoul\.go\.kr|SECRET/u);
});

test("Seoul collector finds the latest common quarter and collects every validated page under 40 calls", async () => {
  const count = 1_001;
  const sales = Array.from({ length: count }, (_, index) => {
    const code = String(1_000_001 + index);
    return salesRow(code, `CS${String(index).padStart(6, "0")}`, "한식", 100);
  });
  const footfall = Array.from({ length: count }, (_, index) => footfallRow(String(1_000_001 + index)));
  const areas = Array.from({ length: count }, (_, index) => areaRow(String(1_000_001 + index)));
  const calls = [];
  const fakeFetch = async (input, init) => {
    assert.equal(init?.redirect, "manual");
    const endpoint = new URL(input);
    calls.push(endpoint.toString());
    assert.equal(endpoint.protocol, "http:");
    assert.equal(endpoint.hostname, "openapi.seoul.go.kr");
    assert.equal(endpoint.port, "8088");
    const [, key, format, serviceName, startText, endText, quarter] = endpoint.pathname.split("/");
    assert.equal(key, "SECRET_KEY_FOR_TEST");
    assert.equal(format, "json");
    if ((serviceName === "VwsmTrdarSelngQq" || serviceName === "VwsmTrdarFlpopQq") && quarter !== "20261") {
      return new Response(JSON.stringify({ RESULT: { CODE: "INFO-200" } }), {
        headers: { "content-type": "application/json" },
      });
    }
    const sourceRows = serviceName === "VwsmTrdarSelngQq"
      ? sales
      : serviceName === "VwsmTrdarFlpopQq"
        ? footfall
        : areas;
    const start = Number(startText);
    const end = Number(endText);
    return new Response(JSON.stringify({
      [serviceName]: {
        list_total_count: sourceRows.length,
        RESULT: { CODE: "INFO-000" },
        row: sourceRows.slice(start - 1, end),
      },
    }), { headers: { "content-type": "application/json" } });
  };

  const result = await collectSeoulCommercialData({
    apiKey: "SECRET_KEY_FOR_TEST",
    nowIso: "2026-07-23T00:00:00.000Z",
    previous: new Map(),
    fetchImpl: fakeFetch,
  });
  assert.equal(result.quarter, "20261");
  assert.equal(result.items.length, count);
  assert.equal(result.requestCount, 8);
  assert.equal(calls.length, result.requestCount);
  assert.ok(result.requestCount <= SEOUL_COMMERCIAL_MAX_REQUESTS);
  assert.equal(result.items.at(-1).id, "seoul-commercial-1001001");
  assert.doesNotMatch(JSON.stringify(result.items[0]), /SECRET_KEY_FOR_TEST|openapi\.seoul\.go\.kr/u);
  assert.deepEqual(recentSeoulQuarterCandidates("2026-07-23T00:00:00.000Z", 4), ["20263", "20262", "20261", "20254"]);
});

test("Seoul collector waits for the sibling page stream before reporting consumed calls", async () => {
  const quarter = "20263";
  const sales = Array.from({ length: 1_001 }, (_, index) => ({
    ...salesRow("1000001", `CS${String(index).padStart(6, "0")}`, "Dining", 100),
    STDR_YYQU_CD: quarter,
  }));
  const footfall = Array.from({ length: 2_001 }, (_, index) => ({
    ...footfallRow(String(1_000_001 + index)),
    STDR_YYQU_CD: quarter,
  }));
  const calls = [];
  const pageResponse = (serviceName, rows, totalCount) => new Response(JSON.stringify({
    [serviceName]: {
      list_total_count: totalCount,
      RESULT: { CODE: "INFO-000" },
      row: rows,
    },
  }), { headers: { "content-type": "application/json" } });

  await assert.rejects(
    collectSeoulCommercialData({
      apiKey: "SECRET_KEY_FOR_TEST",
      nowIso: "2026-07-23T00:00:00.000Z",
      previous: new Map(),
      fetchImpl: async (input) => {
        const endpoint = new URL(input);
        calls.push(endpoint.pathname);
        const [, , , serviceName, startText, endText] = endpoint.pathname.split("/");
        const start = Number(startText);
        const end = Number(endText);
        if (serviceName === "VwsmTrdarSelngQq") {
          if (start === 1) return pageResponse(serviceName, sales.slice(0, end), sales.length);
          return new Response("upstream failure", { status: 500 });
        }
        if (serviceName === "VwsmTrdarFlpopQq") {
          if (start === 1) return pageResponse(serviceName, footfall.slice(0, end), footfall.length);
          if (start === 1_001) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return pageResponse(serviceName, footfall.slice(start - 1, end), footfall.length);
        }
        throw new Error(`unexpected service ${serviceName}`);
      },
    }),
    (error) => error?.message === "seoul_http_500" && error?.requestCount === 5,
  );
  assert.equal(calls.length, 5);
  assert.equal(calls.some((path) => path.includes("/VwsmTrdarFlpopQq/2001/2001/20263")), true);
});

test("Seoul page collection caps page 2..N concurrency at five and restores page-index order", async () => {
  const quarter = "20263";
  const totalCount = 12_001;
  const rows = Array.from({ length: totalCount }, (_, index) => ({
    ...salesRow(String(1_000_001 + index), `CS${String(index).padStart(6, "0")}`, "Dining", index + 1),
    STDR_YYQU_CD: quarter,
  }));
  const budget = new SeoulCommercialRequestBudget();
  let active = 0;
  let maximumActive = 0;
  const completionStarts = [];
  const collected = await collectSeoulServicePages({
    apiKey: "SECRET_KEY_FOR_TEST",
    service: "VwsmTrdarSelngQq",
    quarter,
    budget,
    firstPage: {
      totalCount,
      rows: rows.slice(0, 1_000),
      noData: false,
    },
    fetchImpl: async (input) => {
      const endpoint = new URL(input);
      const [, , , serviceName, startText, endText] = endpoint.pathname.split("/");
      const start = Number(startText);
      const end = Number(endText);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const page = Math.ceil(start / 1_000);
      await new Promise((resolve) => setTimeout(resolve, (14 - page) % 5 * 3 + 2));
      completionStarts.push(start);
      active -= 1;
      return new Response(JSON.stringify({
        [serviceName]: {
          list_total_count: totalCount,
          RESULT: { CODE: "INFO-000" },
          row: rows.slice(start - 1, end),
        },
      }), { headers: { "content-type": "application/json" } });
    },
  });

  assert.ok(maximumActive > 1);
  assert.equal(SEOUL_COMMERCIAL_PAGE_CONCURRENCY, 5);
  assert.ok(maximumActive <= SEOUL_COMMERCIAL_PAGE_CONCURRENCY, `observed ${maximumActive} simultaneous page requests`);
  assert.notDeepEqual(completionStarts, [...completionStarts].sort((left, right) => left - right));
  assert.equal(budget.used, 12);
  assert.equal(collected.length, totalCount);
  assert.deepEqual(
    collected.map((row) => row.SVC_INDUTY_CD),
    rows.map((row) => row.SVC_INDUTY_CD),
  );
});

test("national commercial directory deterministically retains ten largest official areas per province", async () => {
  const adapterServer = await createServer({
    root: projectRoot,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    resolve: { alias: { "@": projectRoot } },
    server: { middlewareMode: true },
  });
  const {
    NATIONAL_COMMERCIAL_AREAS_PER_PROVINCE,
    retainNationalCommercialAreas,
  } = await adapterServer.ssrLoadModule("/lib/public-data/adapters.ts");
  await adapterServer.close();
  const provinces = Array.from({ length: 17 }, (_, index) => `Province-${String(index + 1).padStart(2, "0")}`);
  const input = provinces.flatMap((province) => [
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `${province}-item-${String(index).padStart(2, "0")}`,
      title: `${province} area ${index}`,
      location: { province },
      commercialArea: { areaSquareMeters: 100 - index },
    })),
    {
      id: `${province}-tie-b`,
      title: `${province} tied B`,
      location: { province },
      commercialArea: { areaSquareMeters: 200 },
    },
    {
      id: `${province}-tie-a`,
      title: `${province} tied A`,
      location: { province },
      commercialArea: { areaSquareMeters: 200 },
    },
  ]).reverse();

  const retained = retainNationalCommercialAreas(input);
  assert.equal(NATIONAL_COMMERCIAL_AREAS_PER_PROVINCE, 10);
  assert.equal(retained.length, 170);
  assert.deepEqual(
    retained.map((item) => item.id),
    retainNationalCommercialAreas([...input].reverse()).map((item) => item.id),
  );
  for (const province of provinces) {
    const provinceItems = retained.filter((item) => item.location.province === province);
    assert.equal(provinceItems.length, 10);
    assert.deepEqual(provinceItems.slice(0, 2).map((item) => item.id), [
      `${province}-tie-a`,
      `${province}-tie-b`,
    ]);
    assert.deepEqual(provinceItems.slice(2).map((item) => item.commercialArea.areaSquareMeters), [
      100, 99, 98, 97, 96, 95, 94, 93,
    ]);
  }
});

test("failed Seoul probes report their consumed calls for conservative quota accounting", async () => {
  let calls = 0;
  await assert.rejects(
    collectSeoulCommercialData({
      apiKey: "SECRET_KEY_FOR_TEST",
      nowIso: "2026-07-23T00:00:00.000Z",
      previous: new Map(),
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ RESULT: { CODE: "INFO-200" } }), {
          headers: { "content-type": "application/json" },
        });
      },
    }),
    (error) => error?.message === "seoul_no_common_quarter" && error?.requestCount === 6,
  );
  assert.equal(calls, 6);
});

test("upstream response bodies stop at the byte ceiling before full buffering", async () => {
  assert.equal(await readBoundedResponseText(new Response("12345"), 5), "12345");
  await assert.rejects(
    readBoundedResponseText(new Response("123456"), 5),
    /public_response_body_too-large/u,
  );
});
