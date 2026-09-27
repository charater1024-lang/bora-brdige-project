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
  resolve: { alias: { "@": projectRoot } },
  server: { middlewareMode: true },
});
const { collectPublicData } = await server.ssrLoadModule("/lib/public-data/adapters.ts");
test.after(() => server.close());

function recentBusinessDatesForTest(limit) {
  const dates = [];
  for (let offset = 0; dates.length < limit && offset < 21; offset += 1) {
    const date = new Date(Date.now() - offset * 24 * 60 * 60 * 1_000);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      weekday: "short",
    }).format(date);
    if (weekday === "Sat" || weekday === "Sun") continue;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    dates.push(`${values.year}${values.month}${values.day}`);
  }
  return dates;
}

const [recentCompanyBaseDate] = recentBusinessDatesForTest(1);

function companyRows(page, count = 100, baseDate = recentCompanyBaseDate) {
  return Array.from({ length: count }, (_, index) => ({
    fncoNm: `금융회사 ${page}-${index + 1}`,
    crno: `COMPANY-${page}-${index + 1}`,
    fncoTypeNm: "금융회사",
    basDt: baseDate,
  }));
}

function companyResponse(page, totalCount, count = 100, baseDate = recentCompanyBaseDate) {
  return new Response(JSON.stringify({
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
      body: {
        items: { item: companyRows(page, count, baseDate) },
        totalCount,
        pageNo: page,
        numOfRows: 100,
      },
    },
  }), { headers: { "content-type": "application/json" } });
}

test("financial-company collects the latest point-in-time catalogue instead of paging daily history", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(input);
    const page = Number(endpoint.searchParams.get("pageNo"));
    const baseDate = endpoint.searchParams.get("basDt");
    calls.push({ page, baseDate });
    return companyResponse(page, 230, page === 3 ? 30 : 100);
  });

  const result = await collectPublicData(null, {
    sourceIds: ["financial-company"],
    resolvedKeys: { DATA_GO_KR_API_KEY: "test-data-go-key" },
  });
  const source = result.sourceResults[0];
  assert.deepEqual(calls, [
    { page: 1, baseDate: recentCompanyBaseDate },
    { page: 1, baseDate: recentCompanyBaseDate },
    { page: 2, baseDate: recentCompanyBaseDate },
    { page: 3, baseDate: recentCompanyBaseDate },
  ]);
  assert.equal(source.status, "live");
  assert.equal(source.completeness, "complete");
  assert.equal(source.errorCode, undefined);
  assert.equal(source.providerTotalCount, 230);
  assert.equal(source.fetchedCount, 230);
  assert.equal(source.itemCount, 230);
  assert.equal(result.requestCounts["financial-company"], 4);
  assert.equal(result.status, "live");
});

test("financial-company reports the bounded provider window as truncated, never live", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(input);
    const page = Number(endpoint.searchParams.get("pageNo"));
    calls.push(page);
    return companyResponse(page, 2_100);
  });

  const result = await collectPublicData(null, {
    sourceIds: ["financial-company"],
    resolvedKeys: { DATA_GO_KR_API_KEY: "test-data-go-key" },
  });
  const source = result.sourceResults[0];
  assert.deepEqual(calls, [1, ...Array.from({ length: 20 }, (_, index) => index + 1)]);
  assert.equal(source.id, "financial-company");
  assert.equal(source.status, "truncated");
  assert.equal(source.completeness, "truncated");
  assert.equal(source.errorCode, "provider_page_window_limit_reached");
  assert.equal(source.providerTotalCount, 2_100);
  assert.equal(source.fetchedCount, 2_000);
  assert.equal(source.itemCount, 2_000);
  assert.equal(result.status, "partial");
});

test("financial-company skips empty recent business days before collecting the latest available date", async (t) => {
  const [emptyDate, availableDate] = recentBusinessDatesForTest(2);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(input);
    const page = Number(endpoint.searchParams.get("pageNo"));
    const baseDate = endpoint.searchParams.get("basDt");
    calls.push({ page, baseDate });
    if (baseDate === emptyDate) return companyResponse(page, 0, 0, emptyDate);
    return companyResponse(page, 1, 1, availableDate);
  });

  const result = await collectPublicData(null, {
    sourceIds: ["financial-company"],
    resolvedKeys: { DATA_GO_KR_API_KEY: "test-data-go-key" },
  });
  const source = result.sourceResults[0];
  assert.deepEqual(calls, [
    { page: 1, baseDate: emptyDate },
    { page: 1, baseDate: availableDate },
    { page: 1, baseDate: availableDate },
  ]);
  assert.equal(source.status, "live");
  assert.equal(source.providerTotalCount, 1);
  assert.equal(source.fetchedCount, 1);
  assert.equal(source.itemCount, 1);
  assert.equal(result.requestCounts["financial-company"], 3);
});

test("financial-company retries a transient latest-date probe within the bounded call budget", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(input);
    const page = Number(endpoint.searchParams.get("pageNo"));
    const baseDate = endpoint.searchParams.get("basDt");
    calls.push({ page, baseDate });
    if (calls.length === 1) return new Response("temporarily unavailable", { status: 503 });
    return companyResponse(page, 1, 1);
  });

  const result = await collectPublicData(null, {
    sourceIds: ["financial-company"],
    resolvedKeys: { DATA_GO_KR_API_KEY: "test-data-go-key" },
  });
  const source = result.sourceResults[0];
  assert.deepEqual(calls, [
    { page: 1, baseDate: recentCompanyBaseDate },
    { page: 1, baseDate: recentCompanyBaseDate },
    { page: 1, baseDate: recentCompanyBaseDate },
  ]);
  assert.equal(source.status, "live");
  assert.equal(source.itemCount, 1);
  assert.equal(result.requestCounts["financial-company"], 3);
});

test("financial-company shares two probe retries across dates and reports every consumed call", async (t) => {
  const [firstDate, secondDate] = recentBusinessDatesForTest(2);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(input);
    const baseDate = endpoint.searchParams.get("basDt");
    calls.push(baseDate);
    if (calls.length <= 2 || baseDate === secondDate) {
      return new Response("temporarily unavailable", { status: 503 });
    }
    return companyResponse(1, 0, 0, firstDate);
  });

  const result = await collectPublicData(null, {
    sourceIds: ["financial-company"],
    resolvedKeys: { DATA_GO_KR_API_KEY: "test-data-go-key" },
  });
  assert.deepEqual(calls, [firstDate, firstDate, firstDate, secondDate]);
  assert.equal(result.sourceResults[0].status, "unavailable");
  assert.equal(result.sourceResults[0].errorCode, "upstream_http_503");
  assert.equal(result.requestCounts["financial-company"], 4);
});

test("financial-company does not retry authorization, quota, or semantic provider errors", async (t) => {
  const cases = [
    { status: 403, body: "forbidden", errorCode: "upstream_http_403" },
    { status: 429, body: "quota", errorCode: "upstream_http_429" },
    {
      status: 200,
      body: JSON.stringify({ response: { header: { resultCode: "99" }, body: {} } }),
      errorCode: "upstream_result_99",
    },
  ];
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const current = cases[calls];
    calls += 1;
    return new Response(current.body, {
      status: current.status,
      headers: { "content-type": "application/json" },
    });
  });

  for (const expected of cases) {
    const before = calls;
    const result = await collectPublicData(null, {
      sourceIds: ["financial-company"],
      resolvedKeys: { DATA_GO_KR_API_KEY: "test-data-go-key" },
    });
    assert.equal(calls, before + 1);
    assert.equal(result.sourceResults[0].errorCode, expected.errorCode);
    assert.equal(result.requestCounts["financial-company"], 1);
  }
});

test("financial-company counts a paging response that changes the provider total", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(input);
    const page = Number(endpoint.searchParams.get("pageNo"));
    calls.push(page);
    if (calls.length === 1) return companyResponse(1, 200, 1);
    return companyResponse(page, page === 1 ? 200 : 201);
  });

  const result = await collectPublicData(null, {
    sourceIds: ["financial-company"],
    resolvedKeys: { DATA_GO_KR_API_KEY: "test-data-go-key" },
  });
  assert.deepEqual(calls, [1, 1, 2]);
  assert.equal(result.sourceResults[0].status, "unavailable");
  assert.equal(result.sourceResults[0].errorCode, "upstream_total_count_changed");
  assert.equal(result.requestCounts["financial-company"], 3);
});

test("financial-company rejects a provider response that ignores the requested latest base date", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(input);
    calls.push({
      page: Number(endpoint.searchParams.get("pageNo")),
      baseDate: endpoint.searchParams.get("basDt"),
    });
    return companyResponse(1, 2_315_282, 100, "20200408");
  });

  const result = await collectPublicData(null, {
    sourceIds: ["financial-company"],
    resolvedKeys: { DATA_GO_KR_API_KEY: "test-data-go-key" },
  });
  const source = result.sourceResults[0];
  assert.deepEqual(calls, [{ page: 1, baseDate: recentCompanyBaseDate }]);
  assert.equal(source.status, "unavailable");
  assert.equal(source.errorCode, "financial_company_date_filter_ignored");
  assert.equal(source.itemCount, 0);
  assert.equal(result.requestCounts["financial-company"], 1);
  assert.equal(result.status, "partial");
});

test("financial-company preserves collected rows and exposes a later page failure as partial", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(input);
    const page = Number(endpoint.searchParams.get("pageNo"));
    calls.push(page);
    if (page === 3) return new Response("temporarily unavailable", { status: 503 });
    return companyResponse(page, 500);
  });

  const result = await collectPublicData(null, {
    sourceIds: ["financial-company"],
    resolvedKeys: { DATA_GO_KR_API_KEY: "test-data-go-key" },
  });
  const source = result.sourceResults[0];
  assert.deepEqual(calls, [1, 1, 2, 3]);
  assert.equal(source.status, "partial");
  assert.equal(source.completeness, "partial");
  assert.equal(source.providerTotalCount, 500);
  assert.equal(source.fetchedCount, 200);
  assert.equal(source.itemCount, 200);
  assert.equal(result.status, "partial");
});
