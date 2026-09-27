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

function dartRow(receipt, date) {
  return {
    rcept_no: receipt,
    corp_name: `테스트기업 ${receipt}`,
    report_nm: "주요사항보고서",
    flr_nm: "테스트기업",
    rcept_dt: date,
    corp_cls: "Y",
  };
}

test("DART history resumes from its durable page checkpoint while latest data refreshes first", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (input) => {
    const endpoint = new URL(input);
    const begin = endpoint.searchParams.get("bgn_de");
    const end = endpoint.searchParams.get("end_de");
    const page = Number(endpoint.searchParams.get("page_no"));
    const rangeDays = Math.round(
      (Date.parse(`${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}T00:00:00Z`)
        - Date.parse(`${begin.slice(0, 4)}-${begin.slice(4, 6)}-${begin.slice(6, 8)}T00:00:00Z`))
      / 86_400_000,
    );
    const latest = rangeDays <= 3;
    calls.push({ latest, page });
    return Response.json({
      status: "000",
      total_page: latest ? 1 : 4,
      total_count: latest ? 1 : 8,
      list: latest
        ? [dartRow("LATEST", end)]
        : [
            dartRow(`HISTORY-${page}-1`, end),
            dartRow(`HISTORY-${page}-2`, end),
          ],
    });
  };

  let checkpoint = null;
  const storedByPage = new Map();
  const commitPage = async (commit) => {
    checkpoint = structuredClone(commit.checkpoint);
    storedByPage.set(commit.pageNumber, structuredClone(commit.items));
  };
  const first = await collectPublicData(null, {
    sourceIds: ["dart"],
    resolvedKeys: { DART_API_KEY: "TEST_DART_KEY" },
    backfill: {
      checkpoints: new Map(),
      stagedItems: new Map(),
      maxBackfillPagesPerRun: 2,
      commitPage,
    },
  });

  assert.deepEqual(calls, [
    { latest: true, page: 1 },
    { latest: false, page: 1 },
    { latest: false, page: 2 },
  ]);
  assert.equal(first.sourceResults[0].errorCode, "dart_backfill_in_progress");
  assert.equal(checkpoint.nextPage, 3);
  assert.equal(checkpoint.completed, false);

  calls.length = 0;
  const oldRetainedCatalogueItem = {
    id: "dart-OLD-ARCHIVE", category: "finance", title: "오래된 공식 공시", summary: "합성 과거 공시",
    source: "OpenDART", sourceUrl: "https://dart.fss.or.kr/", tags: ["공시"],
    publishedAt: "2020-01-01", discoveredAt: "2020-01-01T00:00:00Z", lastVerifiedAt: "2020-01-01T00:00:00Z",
  };
  const second = await collectPublicData(first.payload, {
    sourceIds: ["dart"],
    resolvedKeys: { DART_API_KEY: "TEST_DART_KEY" },
    backfill: {
      checkpoints: new Map([["dart", checkpoint]]),
      stagedItems: new Map([["dart", [...storedByPage.values()].flat().concat(oldRetainedCatalogueItem)]]),
      maxBackfillPagesPerRun: 2,
      commitPage,
    },
  });

  assert.deepEqual(calls, [
    { latest: true, page: 1 },
    { latest: false, page: 3 },
    { latest: false, page: 4 },
  ]);
  assert.equal(second.sourceResults[0].errorCode, undefined);
  assert.equal(second.sourceResults[0].completeness, "complete");
  assert.equal(checkpoint.nextPage, 5);
  assert.equal(checkpoint.completed, true);
  assert.ok(second.sourceCatalogs[0].completeGeneration);
  assert.ok(second.sourceCatalogs[0].items.some((item) => item.id === oldRetainedCatalogueItem.id));
  assert.ok(!second.payload.categories.find((group) => group.id === "finance").items
    .some((item) => item.id === oldRetainedCatalogueItem.id), "compact/default payload keeps archive pruning");
  assert.ok(
    second.payload.categories
      .find((group) => group.id === "finance")
      .items.some((item) => item.id === "dart-HISTORY-4-2"),
  );
  assert.doesNotMatch(JSON.stringify(second), /TEST_DART_KEY/u);

  calls.length = 0;
  const oldGeneration = {
    ...checkpoint,
    querySignature: "dart-v1-old-generation",
    queryState: JSON.stringify({ version: 1 }),
    nextPage: 99,
    completed: true,
  };
  await collectPublicData(second.payload, {
    sourceIds: ["dart"],
    resolvedKeys: { DART_API_KEY: "TEST_DART_KEY" },
    backfill: {
      checkpoints: new Map([["dart", oldGeneration]]),
      stagedItems: new Map([["dart", [...storedByPage.values()].flat()]]),
      maxBackfillPagesPerRun: 2,
      commitPage,
    },
  });
  assert.deepEqual(calls, [
    { latest: true, page: 1 },
    { latest: false, page: 1 },
    { latest: false, page: 2 },
  ]);
  assert.notEqual(checkpoint.querySignature, oldGeneration.querySignature);
});
