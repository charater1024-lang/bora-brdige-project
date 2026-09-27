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
  addExchangeDateDays,
  advanceExchangeBackfillWindow,
  initialExchangeBackfillCheckpoint,
  planExchangeBackfillActions,
  shouldStopExchangeBackfillBatch,
} = await server.ssrLoadModule("/lib/public-data/exchange-backfill.ts");
const {
  failureBackoffMs,
  sourceFailureBackoffMs,
} = await server.ssrLoadModule("/lib/public-data/policies.ts");
test.after(() => server.close());

test("one-year exchange backfill skips weekends and caps provider calls", () => {
  const checkpoint = initialExchangeBackfillCheckpoint("2026-07-27", 1);
  const plan = planExchangeBackfillActions(checkpoint, new Set(), 2);

  assert.equal(plan.phase, "history");
  assert.deepEqual(plan.actions, [
    { date: "2026-07-26", kind: "non-business-day" },
    { date: "2026-07-25", kind: "non-business-day" },
    { date: "2026-07-24", kind: "fetch" },
    { date: "2026-07-23", kind: "fetch" },
  ]);
});

test("stored exchange dates consume no provider quota and downtime gaps take priority", () => {
  const checkpoint = initialExchangeBackfillCheckpoint("2026-07-24", 1);
  checkpoint.historicalCursorDate = null;
  checkpoint.completedAt = 1;
  const advanced = advanceExchangeBackfillWindow(checkpoint, "2026-07-28", 2);
  const plan = planExchangeBackfillActions(
    advanced,
    new Set(["2026-07-27"]),
    4,
  );

  assert.equal(plan.phase, "gap");
  assert.deepEqual(plan.actions, [
    { date: "2026-07-27", kind: "already-stored" },
    { date: "2026-07-26", kind: "non-business-day" },
    { date: "2026-07-25", kind: "non-business-day" },
  ]);
});

test("stale downtime gaps are clamped to the retained rolling year", () => {
  const checkpoint = initialExchangeBackfillCheckpoint("2024-01-02", 1);
  checkpoint.historicalCursorDate = null;
  checkpoint.completedAt = 1;

  const advanced = advanceExchangeBackfillWindow(checkpoint, "2026-07-28", 2);
  const rollingFloor = addExchangeDateDays("2026-07-28", -365);

  assert.equal(advanced.gapFloorDate, rollingFloor);
  assert.equal(advanced.gapCursorDate, "2026-07-27");
  assert.equal(advanced.historicalFloorDate, rollingFloor);

  const preExistingGap = initialExchangeBackfillCheckpoint("2026-07-28", 1);
  preExistingGap.gapFloorDate = "2024-01-03";
  preExistingGap.gapCursorDate = "2026-07-27";
  const sanitized = advanceExchangeBackfillWindow(preExistingGap, "2026-07-28", 2);
  assert.equal(sanitized.gapFloorDate, rollingFloor);
});

test("a failed provider chunk stops all later backfill chunks", () => {
  assert.equal(shouldStopExchangeBackfillBatch([{ kind: "stored" }, { kind: "empty" }]), false);
  for (const failureKind of ["authorization", "quota", "transient"]) {
    assert.equal(
      shouldStopExchangeBackfillBatch([
        { kind: "stored" },
        { kind: "error", failureKind },
      ]),
      true,
    );
  }
});

test("repeated transient backfill failures use the shared escalating backoff", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 8].map((count) => failureBackoffMs(count, "transient")),
    [5, 15, 60, 360, 360].map((minutes) => minutes * 60_000),
  );
});

test("Work24 authorization failures use a weekly provider-approval recheck", () => {
  const day = 24 * 60 * 60_000;
  assert.equal(sourceFailureBackoffMs("work24", 0, "authorization"), 7 * day);
  assert.equal(sourceFailureBackoffMs("dart", 0, "authorization"), day);
  assert.equal(sourceFailureBackoffMs("work24", 0, "transient"), 5 * 60_000);
});

test("exchange collection reserves latest lookup plus bounded history and resumes quickly", async () => {
  const [policies, service, cache, backfill] = await Promise.all([
    readFile(new URL("../lib/public-data/policies.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-data/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-data/cache.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/public-data/exchange-backfill.ts", import.meta.url), "utf8"),
  ]);

  assert.match(
    policies,
    /sourceId: "exchange"[\s\S]*estimatedCalls: 7/u,
  );
  assert.match(backfill, /EXCHANGE_BACKFILL_CALLS_PER_REFRESH = 4/u);
  assert.match(backfill, /FETCH_CONCURRENCY = 2/u);
  assert.match(backfill, /exchange_history_backfill_checkpoint/u);
  assert.match(backfill, /if \(shouldStopExchangeBackfillBatch\([\s\S]*\)\) \{\s*break;/u);
  assert.match(service, /exchangeResult\.errorCode = "exchange_backfill_incomplete"/u);
  assert.match(service, /`warning_\$\{result\?\.errorCode/u);
  assert.match(service, /EXCHANGE_BACKFILL_REFRESH_MS/u);
  assert.match(service, /terminalFailure[\s\S]*&& !terminalFailure[\s\S]*exchangeBackfillFailureKind/u);
  assert.match(service, /sourceFailureBackoffMs\([\s\S]*sourceId,[\s\S]*reservation\.state\.consecutiveFailures,[\s\S]*failureKind/u);
  assert.match(cache, /consecutive_failures = CASE WHEN \? = 1 THEN 0 ELSE consecutive_failures \+ 1 END/u);
  assert.match(service, /PUBLIC_API_AUTOMATIC_RATIO/u);
  assert.match(service, /PUBLIC_API_HARD_STOP_RATIO/u);
});

test("home, exchange, and finance surfaces share an immediately visible two-way rate", async () => {
  const [converter, converterCss, overview, history, finance, portal] = await Promise.all([
    readFile(new URL("../app/components/exchange-converter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/exchange-converter.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/components/public-data-overview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/exchange-history-chart.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/finance-exchange-card.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/public-information-pages.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(converter, /1 \{currency\} =/u);
  assert.match(converter, /₩1,000 =/u);
  assert.match(converterCss, /\.ratePair \{[\s\S]*grid-template-columns: repeat\(2/u);
  assert.match(converterCss, /@media \(max-width: 560px\)[\s\S]*\.ratePair \{ grid-template-columns: 1fr/u);
  assert.match(overview, /<ExchangeConverter/u);
  assert.match(history, /<ExchangeConverter/u);
  assert.match(history, /chartDirection/u);
  assert.match(history, /REVERSE_CHART_KRW_BASIS \/ point\.rate/u);
  assert.match(history, /1천원 → 외화/u);
  assert.match(finance, /<ExchangeConverter/u);
  assert.match(portal, /<FinanceExchangeCard locale=\{locale\} \/>/u);
});
