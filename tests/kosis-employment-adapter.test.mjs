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
  KOSIS_EMPLOYMENT_ENDPOINT,
  KOSIS_EMPLOYMENT_MAX_REQUESTS,
  KOSIS_EMPLOYMENT_SOURCE_ID,
  KOSIS_EMPLOYMENT_TABLES,
  kosisEmploymentAdapter,
} = await server.ssrLoadModule("/lib/public-data/kosis-employment-adapter.ts");
test.after(() => server.close());

const nowIso = "2026-07-24T03:00:00.000Z";

const CASES = {
  DT_1DE9046S: {
    period: "202605",
    frequency: "M",
    classifications: ["A.20", "B.00"],
    metrics: [
      ["T11", "취업자", "3,900", "천명"],
      ["T21", "고용률", "46.8", "%"],
      ["T22", "실업률", "6.6", "%"],
    ],
    modified: "20260723",
  },
  DT_1DE8031S: {
    period: "202505",
    frequency: "M",
    classifications: ["A.00"],
    metrics: [
      ["T11", "취업자", "9,780", "천명"],
      ["T30", "고용률", "59.5", "%"],
      ["T40", "실업률", "2.4", "%"],
    ],
    modified: "20250806",
  },
  DT_2FA002F: {
    period: "2025",
    frequency: "A",
    classifications: ["200"],
    metrics: [
      ["T111", "취업자", "1,120.4", "천명"],
      ["T220", "고용률", "66.2", "%"],
    ],
    modified: "20251218",
  },
};

function rowsFor(tableId, overrides = {}) {
  const definition = CASES[tableId];
  const period = overrides.period ?? definition.period;
  return definition.metrics.map(([itemId, itemName, value, unit]) => ({
    TBL_ID: tableId,
    TBL_NM: "공식 KOSIS 통계표",
    ...Object.fromEntries(
      definition.classifications.map((classification, index) =>
        [`C${index + 1}`, classification]),
    ),
    ITM_ID: itemId,
    ITM_NM: itemName,
    UNIT_NM: unit,
    PRD_SE: definition.frequency,
    PRD_DE: period,
    DT: overrides[itemId] ?? value,
    LST_CHN_DE: definition.modified,
  }));
}

function jsonResponse(value, init = {}) {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

test("uses the three verified official KOSIS tables and keyless record links", () => {
  assert.equal(KOSIS_EMPLOYMENT_SOURCE_ID, "kosis-employment");
  assert.equal(KOSIS_EMPLOYMENT_MAX_REQUESTS, 3);
  assert.deepEqual(
    KOSIS_EMPLOYMENT_TABLES.map(({ group, tableId }) => [group, tableId]),
    [
      ["youth", "DT_1DE9046S"],
      ["older-adult", "DT_1DE8031S"],
      ["foreigner", "DT_2FA002F"],
    ],
  );
  for (const table of KOSIS_EMPLOYMENT_TABLES) {
    const url = new URL(table.sourceUrl);
    assert.equal(url.origin, "https://kosis.kr");
    assert.equal(url.pathname, "/statHtml/statHtml.do");
    assert.equal(url.searchParams.get("orgId"), "101");
    assert.equal(url.searchParams.get("tblId"), table.tableId);
    assert.equal(url.searchParams.has("apiKey"), false);
  }
});

test("does not call KOSIS when the API key is absent or blank", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("must not run");
  };
  for (const apiKey of [null, "", "   "]) {
    const result = await kosisEmploymentAdapter({ apiKey, nowIso, fetchImpl });
    assert.equal(result.source.status, "not-configured");
    assert.equal(result.requestCount, 0);
    assert.deepEqual(result.items, []);
  }
  assert.equal(calls, 0);
});

test("returns one structured published-value item per group with exact request accounting", async () => {
  const secret = "kosis-super-secret";
  const requests = [];
  const result = await kosisEmploymentAdapter({
    apiKey: secret,
    nowIso,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      return jsonResponse(rowsFor(url.searchParams.get("tblId")));
    },
  });

  assert.equal(result.source.status, "live");
  assert.equal(result.source.completeness, "complete");
  assert.equal(result.requestCount, 3);
  assert.equal(requests.length, result.requestCount);
  assert.ok(result.requestCount <= KOSIS_EMPLOYMENT_MAX_REQUESTS);
  assert.equal(result.items.length, 3);
  assert.deepEqual(
    result.items.map((item) => item.employmentStatistic.group),
    ["youth", "older-adult", "foreigner"],
  );
  assert.deepEqual(
    result.items.map((item) => item.employmentStatistic.period),
    ["2026.05", "2025.05", "2025"],
  );
  assert.deepEqual(
    result.items[0].employmentStatistic.metrics,
    [
      { name: "취업자", value: 3900, unit: "천명" },
      { name: "고용률", value: 46.8, unit: "%" },
      { name: "실업률", value: 6.6, unit: "%" },
    ],
  );
  assert.deepEqual(
    result.items[2].employmentStatistic.metrics,
    [
      { name: "취업자", value: 1120.4, unit: "천명" },
      { name: "고용률", value: 66.2, unit: "%" },
    ],
  );
  assert.equal(result.items.every((item) => item.category === "employment"), true);
  assert.equal(result.items.every((item) => item.sourceLinkKind === "detail"), true);
  assert.equal(result.items.every((item) => !item.sourceUrl.includes(secret)), true);
  assert.equal(result.asOf, "2026-07-23");
  assert.doesNotMatch(JSON.stringify(result), /kosis-super-secret/u);

  for (const { url, init } of requests) {
    const tableId = url.searchParams.get("tblId");
    const table = KOSIS_EMPLOYMENT_TABLES.find((candidate) =>
      candidate.tableId === tableId);
    assert.equal(url.origin + url.pathname, KOSIS_EMPLOYMENT_ENDPOINT);
    assert.equal(url.searchParams.get("method"), "getList");
    assert.equal(url.searchParams.get("apiKey"), secret);
    assert.equal(url.searchParams.get("orgId"), "101");
    assert.equal(url.searchParams.get("newEstPrdCnt"), "1");
    assert.equal(url.searchParams.get("format"), "json");
    assert.equal(url.searchParams.get("jsonVD"), "Y");
    assert.equal(url.searchParams.get("prdSe"), table.frequency);
    assert.equal(init.redirect, "manual");
    assert.equal(init.headers.Accept, "application/json");
    assert.ok(init.signal instanceof AbortSignal);
  }
});

test("uses the fixed official item unit when KOSIS repeats the table head unit", async () => {
  const misleadingRows = rowsFor("DT_1DE9046S").map((row) => ({
    ...row,
    UNIT_NM: "천명",
  }));
  const result = await kosisEmploymentAdapter({
    apiKey: "unit-normalization-secret",
    nowIso,
    fetchImpl: async (input) => {
      const tableId = new URL(String(input)).searchParams.get("tblId");
      if (tableId === "DT_1DE9046S") return jsonResponse(misleadingRows);
      throw new DOMException("timed out", "TimeoutError");
    },
  });

  assert.deepEqual(
    result.items[0].employmentStatistic.metrics.map(({ name, unit }) => [name, unit]),
    [
      ["취업자", "천명"],
      ["고용률", "%"],
      ["실업률", "%"],
    ],
  );
  assert.doesNotMatch(JSON.stringify(result), /unit-normalization-secret/u);
});

test("keeps successful groups and the last verified failed group when a table fails", async () => {
  const retainedOlderAdult = {
    id: "kosis-employment-older-adult-dt_1de8031s-202405",
    category: "employment",
    title: "고령층 취업 통계 (2024.05)",
    summary: "취업자 9,500 천명",
    source: "KOSIS 국가통계포털",
    sourceUrl: "https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_1DE8031S",
    sourceLinkKind: "detail",
    publishedAt: "2024-08-06",
    discoveredAt: "2024-08-07T00:00:00.000Z",
    lastVerifiedAt: "2025-07-24T00:00:00.000Z",
    tags: ["고용통계", "KOSIS"],
    employmentStatistic: {
      group: "older-adult",
      groupLabel: "고령층(55~79세)",
      period: "2024.05",
      tableId: "DT_1DE8031S",
      metrics: [{ name: "취업자", value: 9500, unit: "천명" }],
    },
  };
  const result = await kosisEmploymentAdapter({
    apiKey: "partial-secret",
    nowIso,
    previous: new Map([[retainedOlderAdult.id, retainedOlderAdult]]),
    fetchImpl: async (input) => {
      const tableId = new URL(String(input)).searchParams.get("tblId");
      if (tableId === "DT_1DE8031S") {
        return jsonResponse({ message: "temporary" }, { status: 503 });
      }
      return jsonResponse(rowsFor(tableId));
    },
  });

  assert.equal(result.source.status, "partial");
  assert.equal(result.source.completeness, "partial");
  assert.equal(result.source.errorCode, "kosis_partial");
  assert.equal(result.failureKind, "transient");
  assert.equal(result.requestCount, 3);
  assert.deepEqual(
    result.items.map((item) => item.employmentStatistic.group),
    ["youth", "older-adult", "foreigner"],
  );
  assert.equal(result.items[1], retainedOlderAdult);
  assert.equal(result.items[1].lastVerifiedAt, "2025-07-24T00:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(result), /partial-secret/u);
});

test("reports authorization pending only after all three fixed requests reject the key", async () => {
  const result = await kosisEmploymentAdapter({
    apiKey: "rejected-secret",
    nowIso,
    fetchImpl: async () =>
      jsonResponse(
        { err: "11", errMsg: "유효하지 않은 인증KEY입니다." },
        { headers: { "content-type": "text/html;charset=UTF-8" } },
      ),
  });

  assert.equal(result.source.status, "authorization-pending");
  assert.equal(result.source.errorCode, "kosis_authorization");
  assert.equal(result.failureKind, "authorization");
  assert.equal(result.requestCount, 3);
  assert.deepEqual(result.items, []);
  assert.doesNotMatch(JSON.stringify(result), /rejected-secret/u);
});

test("enforces response-size and changed-shape limits without discarding healthy groups", async () => {
  const result = await kosisEmploymentAdapter({
    apiKey: "bounded-secret",
    nowIso,
    fetchImpl: async (input) => {
      const tableId = new URL(String(input)).searchParams.get("tblId");
      if (tableId === "DT_1DE8031S") {
        return jsonResponse([], { headers: { "content-length": "1000001" } });
      }
      if (tableId === "DT_2FA002F") {
        return jsonResponse([{ TBL_ID: "unexpected", DT: "99" }]);
      }
      return jsonResponse(rowsFor(tableId));
    },
  });

  assert.equal(result.source.status, "partial");
  assert.equal(result.source.completeness, "partial");
  assert.equal(result.requestCount, 3);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].employmentStatistic.group, "youth");
  assert.doesNotMatch(JSON.stringify(result), /bounded-secret/u);
});

test("rejects a table with a missing official metric instead of presenting it as complete", async () => {
  const result = await kosisEmploymentAdapter({
    apiKey: "missing-metric-secret",
    nowIso,
    fetchImpl: async (input) => {
      const tableId = new URL(String(input)).searchParams.get("tblId");
      const rows = rowsFor(tableId);
      return jsonResponse(tableId === "DT_1DE9046S" ? rows.slice(0, 2) : rows);
    },
  });

  assert.equal(result.source.status, "partial");
  assert.equal(result.source.completeness, "partial");
  assert.equal(result.source.errorCode, "kosis_partial");
  assert.deepEqual(
    result.items.map((item) => item.employmentStatistic.group),
    ["older-adult", "foreigner"],
  );
  assert.doesNotMatch(JSON.stringify(result), /missing-metric-secret/u);
});

test("selects the newest official period and preserves previous discovery time without deriving values", async () => {
  const oldRows = rowsFor("DT_1DE9046S", {
    period: "202505",
    T11: "3,700",
    T21: "45.0",
    T22: "7.0",
  });
  const currentRows = rowsFor("DT_1DE9046S");
  const id = "kosis-employment-youth-dt_1de9046s-202605";
  const previous = new Map([
    [id, {
      id,
      category: "employment",
      title: "previous",
      summary: "previous",
      source: "KOSIS 국가통계포털",
      sourceUrl: "https://kosis.kr/",
      publishedAt: null,
      discoveredAt: "2026-01-02T00:00:00.000Z",
      tags: [],
    }],
  ]);
  const result = await kosisEmploymentAdapter({
    apiKey: "latest-secret",
    nowIso,
    previous,
    fetchImpl: async (input) => {
      const tableId = new URL(String(input)).searchParams.get("tblId");
      if (tableId === "DT_1DE9046S") {
        return jsonResponse([...oldRows, ...currentRows]);
      }
      throw new DOMException("timed out", "TimeoutError");
    },
  });

  assert.equal(result.requestCount, 3);
  assert.equal(result.items.length, 1);
  const [item] = result.items;
  assert.equal(item.employmentStatistic.period, "2026.05");
  assert.equal(item.discoveredAt, "2026-01-02T00:00:00.000Z");
  assert.equal(item.employmentStatistic.metrics[0].value, 3900);
  assert.equal(item.employmentStatistic.metrics[1].value, 46.8);
  assert.equal(item.employmentStatistic.metrics[2].value, 6.6);
  assert.doesNotMatch(JSON.stringify(result), /latest-secret/u);
});
