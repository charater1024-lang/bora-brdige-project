import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": root } }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true } });
const { publicIndicatorSources, publicIndicatorsRequested } = await vite.ssrLoadModule("/lib/rag/indicators.ts");
test.after(() => vite.close());
const dashboard = {
  cached: true, lastSuccessfulAt: "2026-08-30T00:00:00Z",
  exchange: { source: "합성 환율 자료", sourceUrl: "https://public.example/exchange", asOf: "2026-08-28",
    rates: [
      { currency: "USD", unit: 1, baseRate: 1000, quotedUnit: 1, quotedRate: 1000 },
      { currency: "JPY", unit: 1, baseRate: 9, quotedUnit: 100, quotedRate: 900 },
    ] },
  market: [{ id: "kospi", name: "KOSPI", value: 2500, change: -12, changeRate: -0.48,
    asOf: "2026-08-28", sourceUrl: "https://public.example/market" }],
};

test("uncached or unrelated requests never turn default indicators into evidence", () => {
  assert.deepEqual(publicIndicatorSources("환율", { ...dashboard, cached: false }), []);
  assert.deepEqual(publicIndicatorSources("청년 정책", dashboard), []);
  assert.equal(publicIndicatorsRequested("為替レート"), true);
  assert.equal(publicIndicatorsRequested("汇率"), true);
  assert.equal(publicIndicatorsRequested("취업 지원 정책"), false);
});

test("exchange evidence includes both directions using normalized single-currency rates", () => {
  const [usd] = publicIndicatorSources("원달러 환율", dashboard);
  assert.match(usd.excerpt, /1 USD = 1,000 KRW/u);
  assert.match(usd.excerpt, /1 KRW = 0\.00100000 USD/u);
  const [jpy] = publicIndicatorSources("엔화 환율", dashboard);
  assert.match(jpy.excerpt, /1 JPY = 9 KRW/u);
  assert.doesNotMatch(jpy.excerpt, /1 JPY = 900 KRW/u);
});

test("indicator evidence distinguishes its observation date from an unrelated cache refresh", () => {
  const [source] = publicIndicatorSources("USD 환율", dashboard);
  assert.equal(source.publishedAt, "2026-08-28");
  assert.equal(source.reviewedAt, "");
  assert.match(source.excerpt, /기준일: 2026-08-28/u);
  assert.match(source.excerpt, /실시간.*아닙니다/u);
  assert.doesNotMatch(source.excerpt, /2026-08-30/u);
});

test("market evidence is source-bound and rejects invalid values or unsafe URLs", () => {
  const [source] = publicIndicatorSources("코스피", dashboard);
  assert.match(source.excerpt, /지수: 2500/u);
  assert.match(source.excerpt, /-0\.48%/u);
  assert.equal(source.publishedAt, "2026-08-28");
  for (const replacement of [{ value: NaN }, { changeRate: null }, { sourceUrl: "http://127.0.0.1/private" }]) {
    assert.deepEqual(publicIndicatorSources("코스피", { ...dashboard, market: [{ ...dashboard.market[0], ...replacement }] }), []);
  }
});
