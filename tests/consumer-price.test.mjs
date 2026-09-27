import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function loadInsight(context) {
  const server = await createServer({
    root: projectRoot,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    resolve: { alias: { "@": projectRoot } },
    server: { middlewareMode: true },
  });
  context.after(() => server.close());
  return server.ssrLoadModule("/lib/public-data/consumer-price.ts");
}

function cpiItem(overrides = {}) {
  return {
    title: "소비자물가지수(2020=100)",
    summary: "116.03 2020=100 · 2026.06",
    tags: ["경제지표"],
    ...overrides,
  };
}

test("a CPI index is explained against its stated base without calling it monthly inflation", async (context) => {
  const { consumerPriceInsight } = await loadInsight(context);
  const insight = consumerPriceInsight(cpiItem(), "ko");

  assert.equal(insight.available, true);
  assert.equal(insight.measure, "index");
  assert.equal(insight.numericValue, 116.03);
  assert.equal(insight.baseYear, 2020);
  assert.equal(insight.differenceFromBase, 16.03);
  assert.equal(insight.displayValue, "116.03 (2020=100)");
  assert.match(insight.headline, /2020년 평균/u);
  assert.match(insight.headline, /16\.03% 높/u);
  assert.match(insight.caution, /전월 대비 상승률이 아니/u);
});

test("an explicit inflation rate is not misread as a base-100 index", async (context) => {
  const { consumerPriceInsight } = await loadInsight(context);
  const korean = consumerPriceInsight(cpiItem({ title: "소비자물가 상승률", summary: "2.1 % · 전년동월비" }), "ko");
  const english = consumerPriceInsight(cpiItem({ title: "Consumer price inflation rate", summary: "-0.4 %" }), "en");

  assert.equal(korean.measure, "rate");
  assert.equal(korean.displayValue, "2.1%");
  assert.match(korean.comparison, /전월 대비인지 전년 같은 달 대비인지/u);
  assert.equal(english.measure, "rate");
  assert.match(english.headline, /0\.4% lower/u);
});

test("missing or unparseable CPI data stays unavailable and never invents a zero or example", async (context) => {
  const { consumerPriceInsight } = await loadInsight(context);
  for (const locale of ["ko", "en", "ja", "zh"]) {
    const missing = consumerPriceInsight(null, locale);
    const invalid = consumerPriceInsight(cpiItem({ summary: "자료 준비 중" }), locale);
    assert.equal(missing.available, false);
    assert.equal(missing.numericValue, null);
    assert.equal(missing.displayValue, "—");
    assert.equal(invalid.available, false);
    assert.equal(invalid.numericValue, null);
    assert.equal(invalid.displayValue, "—");
    assert.doesNotMatch(`${missing.headline} ${missing.meaning} ${missing.comparison}`, /116\.03|2\.1/u);
  }
});

test("unknown units are displayed but not interpreted as an increase or decrease", async (context) => {
  const { consumerPriceInsight } = await loadInsight(context);
  const insight = consumerPriceInsight(cpiItem({ title: "소비자물가 관련 값", summary: "7.5 포인트", tags: [] }), "ko");

  assert.equal(insight.measure, "value");
  assert.equal(insight.displayValue, "7.5");
  assert.match(insight.comparison, /상승·하락으로 해석하지 않았/u);
});

test("the card renders a truthful unavailable state and keeps the easy-language details accessible", async (context) => {
  const server = await createServer({
    root: projectRoot,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    resolve: { alias: { "@": projectRoot } },
    server: { middlewareMode: true },
  });
  context.after(() => server.close());
  const { ConsumerPriceCard } = await server.ssrLoadModule("/app/components/consumer-price-card.tsx");
  const html = renderToStaticMarkup(createElement(ConsumerPriceCard, { item: null, locale: "ko" }));

  assert.match(html, /data-measure="unavailable"/u);
  assert.match(html, /<strong>—<\/strong>/u);
  assert.match(html, /미제공/u);
  assert.match(html, /무슨 숫자인가요\?/u);
  assert.doesNotMatch(html, /href=/u);
});
