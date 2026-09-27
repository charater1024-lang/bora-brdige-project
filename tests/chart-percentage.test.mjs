import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("part-to-whole financial charts expose exact percentage labels", () => {
  const workbook = source("../app/components/personal-asset-workbook.tsx");
  const inclusive = source("../app/components/inclusive-finance-checkup.tsx");
  const home = source("../app/page.tsx");

  for (const chartSource of [workbook, inclusive]) {
    assert.match(chartSource, /sharePercent/u);
    assert.match(chartSource, /toFixed\(1\).*%/u);
  }

  assert.match(inclusive, /chartTotal/u);
  assert.match(home, /topicChartData[\s\S]*sharePercent/u);
  assert.doesNotMatch(home, /weeklySpendingData/u);
  assert.match(home, /직접 입력한 소비 내역이 0건입니다/u);
});

test("the home no longer presents a non-functional MyData widget", () => {
  const home = source("../app/page.tsx");
  const controls = source("../app/components/home-control-center.tsx");

  assert.doesNotMatch(home, /MyDataWidget/u);
  assert.doesNotMatch(controls, /"mydata"/u);
  assert.doesNotMatch(controls, /MyData connection/u);
  assert.doesNotMatch(home, /연결된 소비|connected spending|連携済み支出|已连接消费/u);
  assert.equal(existsSync(new URL("../app/api/mydata/route.ts", import.meta.url)), false);
});
