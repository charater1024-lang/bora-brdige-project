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
  detectEmploymentStatisticsIntent,
  formatPublicEmploymentStatisticsContext,
  publicEmploymentStatisticsSources,
} = await server.ssrLoadModule("/lib/rag/public-statistics.ts");
test.after(() => server.close());

const item = {
  id: "kosis-employment-youth",
  category: "employment",
  title: "청년층 취업 통계",
  summary: "청년층 고용 지표의 최신 공식 기준입니다.",
  source: "KOSIS 국가통계포털",
  sourceUrl: "https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_1DA7002S",
  publishedAt: "2026-06-01",
  discoveredAt: "2026-07-24T00:00:00.000Z",
  lastVerifiedAt: "2026-07-24T01:00:00.000Z",
  tags: ["고용통계"],
  employmentStatistic: {
    group: "youth",
    groupLabel: "청년층",
    period: "2026.06",
    tableId: "DT_1DA7002S",
    metrics: [{ name: "고용률", value: 46.7, unit: "%" }],
  },
};

const dashboard = {
  cached: true,
  stale: false,
  lastSuccessfulAt: "2026-07-24T01:00:00.000Z",
  categories: [
    { id: "youth", items: [], totalCount: 0, newCount: 0 },
    { id: "finance", items: [], totalCount: 0, newCount: 0 },
    { id: "startup", items: [], totalCount: 0, newCount: 0 },
    { id: "employment", items: [item], totalCount: 1, newCount: 1 },
  ],
};

test("employment-statistics intent requires both a topic and a statistics request", () => {
  assert.equal(detectEmploymentStatisticsIntent("청년 취업률 통계를 알려줘"), true);
  assert.equal(detectEmploymentStatisticsIntent("외국인 고용 현황 추이는?"), true);
  assert.equal(detectEmploymentStatisticsIntent("취업 준비를 도와줘"), false);
});

test("employment rates and everyday quantity questions work across supported languages", () => {
  for (const query of [
    "청년 고용률은 몇 퍼센트야?", "지금 실업률 얼마나 돼?", "최근 일자리 숫자 알려줘",
    "외국인 취업자 수가 궁금해요", "What is the youth employment rate?",
    "How many young people are out of work?", "Employment 25％ is that current?",
    "若者の就業率を教えて", "高齢者の雇用は何パーセント？", "青年就业率是多少？",
    "外国人的就业人数是多少？",
    "고령층 취업자 비중과 지난 조사 이후의 흐름을 보여주세요.", "Current employment data",
  ]) assert.equal(detectEmploymentStatisticsIntent(query), true, query);
});

test("population terms and English word fragments do not misroute financial questions", () => {
  for (const query of [
    "청년 적금 이자율은?", "청년 신청 수수료 얼마나 내?", "외국인 계좌 금리 비교",
    "foreign resident interest rate", "youth corporate benefits", "employment application help",
    "취업 준비를 도와줘", "请问开户需要什么材料",
    "취업 면접 준비 자료를 찾아줘.", "I need advice for a data analyst job interview.",
  ]) assert.equal(detectEmploymentStatisticsIntent(query), false, query);
});

test("AI context uses only structured shared-cache values and exact source ids", () => {
  const context = formatPublicEmploymentStatisticsContext(dashboard);
  assert.match(context, /\[kosis-employment-youth\]/u);
  assert.match(context, /고용률=46\.7%/u);
  assert.match(context, /DT_1DA7002S/u);
  assert.match(context, /Never compare/u);
  assert.equal(context.includes("apiKey"), false);

  assert.deepEqual(publicEmploymentStatisticsSources(dashboard), [{
    id: "kosis-employment-youth",
    title: "청년층 취업 통계",
    publisher: "KOSIS 국가통계포털",
    url: item.sourceUrl,
    reviewedAt: "2026-07-24",
  }]);
});

test("missing cache explicitly forbids guessing current statistics", () => {
  const context = formatPublicEmploymentStatisticsContext({
    cached: false,
    stale: false,
    lastSuccessfulAt: null,
    categories: dashboard.categories.map((group) => ({ ...group, items: [] })),
  });
  assert.match(context, /Do not guess a current value/u);
});
