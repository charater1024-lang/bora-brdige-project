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
  buildEmploymentChartData,
  buildEmploymentMetricOptions,
  employmentMetricKey,
  normalizeEmploymentStatisticItem,
} = await server.ssrLoadModule("/lib/public-data/employment-statistics-view.ts");
test.after(() => server.close());

function item(group, groupLabel, period, metrics) {
  return {
    id: `employment-${group}`,
    category: "youth",
    title: groupLabel,
    summary: "KOSIS 공식 통계",
    source: "KOSIS",
    sourceUrl: "https://kosis.kr/",
    publishedAt: "2026-07-01",
    discoveredAt: "2026-07-01T00:00:00.000Z",
    tags: [],
    employmentStatistic: {
      group,
      groupLabel,
      period,
      tableId: `TABLE-${group}`,
      metrics,
    },
  };
}

const records = [
  item("youth", "청년", "2026.05", [
    { name: "취업자", value: 3900, unit: "천명" },
    { name: "고용률", value: 46.8, unit: "%" },
    { name: "실업률", value: 6.6, unit: "%" },
  ]),
  item("older-adult", "고령층", "2026.05", [
    { name: "취업자", value: 9850, unit: "천명" },
    { name: "고용률", value: 69.5, unit: "%" },
    { name: "실업률", value: Number.NaN, unit: "%" },
  ]),
  item("foreigner", "외국인", "2025", [
    { name: "취업자", value: 1100, unit: "천명" },
    { name: "고용률", value: 64.7, unit: "%" },
  ]),
];

test("employment metric choices are deterministic and never invent invalid data", () => {
  const options = buildEmploymentMetricOptions(records);
  assert.deepEqual(
    options.map(({ name, unit, availableGroups }) => [name, unit, availableGroups]),
    [
      ["고용률", "%", 3],
      ["실업률", "%", 1],
      ["취업자", "천명", 3],
    ],
  );
});

test("employment chart rows include only the selected metric and identical unit", () => {
  const rateRows = buildEmploymentChartData(records, employmentMetricKey("고용률", "%"));
  assert.deepEqual(rateRows.map(({ group, value, unit, period }) => [group, value, unit, period]), [
    ["youth", 46.8, "%", "2026.05"],
    ["older-adult", 69.5, "%", "2026.05"],
    ["foreigner", 64.7, "%", "2025"],
  ]);

  const wrongUnit = buildEmploymentChartData(records, employmentMetricKey("고용률", "천명"));
  assert.deepEqual(wrongUnit, []);
});

test("employment chart excludes non-finite values and keeps official table evidence", () => {
  const rows = buildEmploymentChartData(records, employmentMetricKey("실업률", "%"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].group, "youth");
  assert.equal(rows[0].tableId, "TABLE-youth");
  assert.equal(rows[0].itemId, "employment-youth");
});

test("duplicate snapshots count one group and chart only its newest official period", () => {
  const olderYouth = item("youth", "청년", "2026.04", [
    { name: "고용률", value: 45.1, unit: "%" },
  ]);
  olderYouth.id = "employment-youth-202604";
  const newerYouth = item("youth", "청년", "2026.05", [
    { name: "고용률", value: 46.8, unit: "%" },
  ]);
  newerYouth.id = "employment-youth-202605";

  const options = buildEmploymentMetricOptions([olderYouth, newerYouth]);
  assert.equal(options[0].availableGroups, 1);
  const rows = buildEmploymentChartData(
    [newerYouth, olderYouth],
    employmentMetricKey("고용률", "%"),
  );
  assert.deepEqual(rows.map(({ period, value, itemId }) => [period, value, itemId]), [
    ["2026.05", 46.8, "employment-youth-202605"],
  ]);
});

test("legacy cached fixed tables repair only their units and never their values", () => {
  const legacy = item("youth", "청년", "2026.05", [
    { name: "취업자", value: 3427.3, unit: "천명" },
    { name: "고용률", value: 43.8, unit: "천명" },
    { name: "실업률", value: 7.2, unit: "천명" },
  ]);
  legacy.employmentStatistic.tableId = "DT_1DE9046S";
  const normalized = normalizeEmploymentStatisticItem(legacy);
  assert.deepEqual(normalized.employmentStatistic.metrics, [
    { name: "취업자", value: 3427.3, unit: "천명" },
    { name: "고용률", value: 43.8, unit: "%" },
    { name: "실업률", value: 7.2, unit: "%" },
  ]);
  assert.equal(legacy.employmentStatistic.metrics[1].unit, "천명", "shared cache objects stay immutable");
});
