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

function bizinfoRow(page, index) {
  const id = `PAGE-${page}-${index}`;
  return {
    pblancId: id,
    pblancNm: `기업마당 공고 ${id}`,
    bsnsSumryCn: `공고 ${id} 요약`,
    creatPnttm: "2026-07-29",
    reqstEndDe: "2026-12-31",
    pblancUrl: `https://www.bizinfo.go.kr/web/notice/${id}`,
  };
}

function fullPage(page) {
  return Array.from({ length: 100 }, (_, index) => bizinfoRow(page, index + 1));
}

test("direct Bizinfo refreshes page 1 first and resumes until a short page proves completion", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (input) => {
    const endpoint = new URL(input);
    const page = Number(endpoint.searchParams.get("pageIndex"));
    calls.push(page);
    const rows = page < 4
      ? fullPage(page)
      : [bizinfoRow(4, 1), bizinfoRow(4, 2)];
    return Response.json({ jsonArray: rows });
  };

  let checkpoint = null;
  const storedByPage = new Map();
  const commitPage = async (commit) => {
    checkpoint = structuredClone(commit.checkpoint);
    storedByPage.set(commit.pageNumber, structuredClone(commit.items));
  };
  const first = await collectPublicData(null, {
    sourceIds: ["bizinfo"],
    resolvedKeys: { BIZINFO_API_KEY: "TEST_BIZINFO_KEY" },
    backfill: {
      checkpoints: new Map(),
      stagedItems: new Map(),
      maxBackfillPagesPerRun: 2,
      commitPage,
    },
  });

  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(first.requestCounts.bizinfo, 3);
  assert.equal(first.sourceResults[0].errorCode, "bizinfo_backfill_in_progress");
  assert.equal(first.sourceResults[0].completeness, "truncated");
  assert.equal(first.sourceResults[0].fetchedCount, 300);
  assert.equal(checkpoint.nextPage, 4);
  assert.equal(checkpoint.completed, false);
  assert.deepEqual([...storedByPage.keys()], [1, 2, 3]);

  calls.length = 0;
  const second = await collectPublicData(first.payload, {
    sourceIds: ["bizinfo"],
    resolvedKeys: { BIZINFO_API_KEY: "TEST_BIZINFO_KEY" },
    backfill: {
      checkpoints: new Map([["bizinfo", checkpoint]]),
      stagedItems: new Map([["bizinfo", [...storedByPage.values()].flat()]]),
      maxBackfillPagesPerRun: 2,
      commitPage,
    },
  });

  assert.deepEqual(calls, [1, 4]);
  assert.equal(second.requestCounts.bizinfo, 2);
  assert.equal(second.sourceResults[0].errorCode, undefined);
  assert.equal(second.sourceResults[0].completeness, "complete");
  assert.equal(second.sourceResults[0].providerTotalCount, 302);
  assert.equal(second.sourceResults[0].fetchedCount, 302);
  assert.equal(checkpoint.nextPage, 5);
  assert.equal(checkpoint.completed, true);
  assert.ok(
    second.payload.categories
      .find((group) => group.id === "startup")
      .items.some((item) => item.id === "bizinfo-PAGE-4-2"),
  );
  assert.doesNotMatch(JSON.stringify(second), /TEST_BIZINFO_KEY/u);
});

test("direct Bizinfo atomically replaces a changed same-day short first page without retaining removed rows", async (context) => {
  let rows = [bizinfoRow(1, 1), bizinfoRow(1, 2)];
  context.mock.method(globalThis, "fetch", async () => Response.json({ jsonArray: rows }));
  let checkpoint = null;
  const saved = new Map();
  const resets = [];
  const run = (previous) => collectPublicData(previous, {
    sourceIds: ["bizinfo"], resolvedKeys: { BIZINFO_API_KEY: "TEST_BIZINFO_KEY" },
    backfill: {
      checkpoints: new Map(checkpoint ? [["bizinfo", checkpoint]] : []),
      stagedItems: new Map([["bizinfo", [...saved.values()].flat()]]), maxBackfillPagesPerRun: 2,
      commitPage: async (commit) => {
        resets.push(commit.resetGeneration);
        if (commit.resetGeneration) saved.clear();
        checkpoint = structuredClone(commit.checkpoint);
        saved.set(commit.pageNumber, structuredClone(commit.items));
      },
    },
  });
  const first = await run(null);
  assert.equal(first.sourceResults[0].completeness, "complete");
  rows = [bizinfoRow(1, 2)];
  const second = await run(first.payload);
  assert.deepEqual(resets, [true, true]);
  assert.deepEqual([...saved.keys()], [1]);
  assert.equal(second.sourceResults[0].providerTotalCount, 1);
  assert.deepEqual(second.sourceCatalogs[0].items.map((item) => item.id), ["bizinfo-PAGE-1-2"]);
});

test("direct Bizinfo does not advance its cursor after an authorization failure", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (input) => {
    const endpoint = new URL(input);
    const page = Number(endpoint.searchParams.get("pageIndex"));
    calls.push(page);
    return page === 1
      ? Response.json({ jsonArray: fullPage(1) })
      : Response.json({ reqErr: "Invalid authentication key" });
  };

  let checkpoint = null;
  const result = await collectPublicData(null, {
    sourceIds: ["bizinfo"],
    resolvedKeys: { BIZINFO_API_KEY: "AUTH_FAILURE_KEY" },
    backfill: {
      checkpoints: new Map(),
      stagedItems: new Map(),
      maxBackfillPagesPerRun: 3,
      commitPage: async (commit) => {
        checkpoint = structuredClone(commit.checkpoint);
      },
    },
  });

  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.requestCounts.bizinfo, 2);
  assert.equal(result.sourceResults[0].status, "partial");
  assert.equal(result.sourceResults[0].failureKind, "authorization");
  assert.equal(result.sourceResults[0].errorCode, "bizinfo_authorization");
  assert.equal(checkpoint.nextPage, 2);
  assert.equal(checkpoint.completed, false);
  assert.doesNotMatch(JSON.stringify(result), /AUTH_FAILURE_KEY/u);
});

test("direct Bizinfo discards old staged pages when its daily generation changes", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (input) => {
    const page = Number(new URL(input).searchParams.get("pageIndex"));
    calls.push(page);
    return Response.json({
      jsonArray: page === 1 ? [bizinfoRow(1, 1), bizinfoRow(1, 2)] : [],
    });
  };
  const stale = {
    ...bizinfoRow(9, 9),
    pblancId: "STALE",
    pblancNm: "stale announcement",
  };
  const checkpoint = {
    sourceId: "bizinfo",
    querySignature: "bizinfo-v1-old",
    queryState: JSON.stringify({ version: 1 }),
    nextPage: 99,
    pageSize: 100,
    providerTotalCount: 999,
    fetchedCount: 999,
    completed: true,
    latestRefreshAt: 1,
    completedAt: 1,
    updatedAt: 1,
  };
  let committed = null;
  const result = await collectPublicData(null, {
    sourceIds: ["bizinfo"],
    resolvedKeys: { BIZINFO_API_KEY: "TEST_BIZINFO_KEY" },
    backfill: {
      checkpoints: new Map([["bizinfo", checkpoint]]),
      stagedItems: new Map([["bizinfo", [{
        id: "bizinfo-STALE",
        category: "startup",
        title: stale.pblancNm,
        summary: "stale",
        source: "test",
        sourceUrl: "https://www.bizinfo.go.kr/",
        sourceLinkKind: "dataset",
        tags: [],
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
      }]]]),
      maxBackfillPagesPerRun: 2,
      commitPage: async (commit) => {
        committed = structuredClone(commit.checkpoint);
      },
    },
  });

  assert.deepEqual(calls, [1]);
  assert.equal(committed.completed, true);
  assert.ok(!result.payload.categories.flatMap((group) => group.items)
    .some((item) => item.id === "bizinfo-STALE"));
});

test("direct Bizinfo failure keeps the last valid snapshot and publishes no replacement catalogue", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => { throw new TypeError("synthetic upstream timeout"); };
  const previousItem = {
    id: "bizinfo-LAST-VALID",
    category: "startup",
    title: "마지막 정상 기업마당 공고",
    summary: "이전 정상 수집본",
    source: "중소벤처기업부 기업마당",
    sourceUrl: "https://www.bizinfo.go.kr/web/notice/LAST-VALID",
    sourceLinkKind: "detail",
    publishedAt: "2026-08-01",
    discoveredAt: "2026-08-01T00:00:00.000Z",
    lastVerifiedAt: "2026-08-31T00:00:00.000Z",
    expiresAt: "2026-12-31",
    tags: ["창업지원"],
  };
  const previous = {
    exchange: { source: "", sourceUrl: "https://www.koreaexim.go.kr/", asOf: null, rates: [] },
    market: [],
    categories: [
      { id: "youth", title: "", description: "", items: [], totalCount: 0 },
      { id: "finance", title: "", description: "", items: [], totalCount: 0 },
      { id: "startup", title: "", description: "", items: [previousItem], totalCount: 1 },
      { id: "employment", title: "", description: "", items: [], totalCount: 0 },
    ],
    sources: [{ id: "bizinfo", label: "기업마당", status: "live", itemCount: 1, sourceUrl: "https://www.bizinfo.go.kr/" }],
  };
  const result = await collectPublicData(previous, {
    sourceIds: ["bizinfo"],
    resolvedKeys: { BIZINFO_API_KEY: "TRANSIENT_FAILURE_KEY" },
  });
  assert.equal(result.sourceResults[0].failureKind, "transient");
  assert.equal(result.sourceCatalogs.length, 0, "a failed source must never replace the durable catalogue");
  assert.equal(result.payload.categories.find((group) => group.id === "startup").items[0].id, previousItem.id);
  assert.equal(result.payload.sources[0].itemCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /TRANSIENT_FAILURE_KEY/u);
});
