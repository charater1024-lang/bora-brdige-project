import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const { FINANCIAL_KNOWLEDGE, searchKnowledge, formatKnowledgeContext } = await server.ssrLoadModule("/lib/rag/knowledge.ts");
test.after(() => server.close());

test("all 56 sealed reviewed search labels remain compatible without modifying the fixtures", () => {
  const corpus = JSON.parse(readFileSync(new URL("../evaluation/datasets/bora-judge-coverage-v4/evidence-grounding.json", import.meta.url), "utf8"));
  const cases = corpus.cases.filter((item) => item.operation === "knowledge-top-document");
  assert.equal(cases.length, 56);
  for (const item of cases) {
    const results = searchKnowledge(item.input.query, 4);
    assert.equal(results[0]?.document.id, item.expected.topDocumentId, item.input.query);
    assert.ok(results.length >= item.expected.minimumSourceCount, item.input.query);
  }
});

test("natural-language paraphrases preserve labels with reviewed deposit-principle enrichment", () => {
  const cases = [
    ["검사라는 사람이 안전계좌로 돈을 옮기래요", "phishing-emergency-response"],
    ["택배 주소를 고치라는 연락이 왔어요", "smishing-safe-verification"],
    ["젊은 사람이 목돈 모으게 나라에서 도와주는 게 있나요", "youth-asset-building"],
    ["가게 열려는데 정부에서 받을 수 있는 도움이 있나요", "startup-support-discovery"],
    ["Can I open a bank account with my passport?", "foreign-resident-finance"],
    ["회사에 돈 넣기 전에 어디서 확인해야 해요?", "investment-disclosure-check"],
    ["달마다 은행에 돈을 모으려는데 뭘 따져 봐야 해요?", "financial-product-comparison"],
    ["중도해지하면 얼마 받나요?", "financial-product-comparison"],
  ];
  assert.equal(FINANCIAL_KNOWLEDGE.length, 7);
  assert.equal(FINANCIAL_KNOWLEDGE.reduce((sum, document) => sum + document.content.length, 0), 1_184);
  for (const [query, expected] of cases) assert.equal(searchKnowledge(query)[0]?.document.id, expected, query);
});

test("short English fragments and common application words do not become evidence", () => {
  for (const query of ["help me", "in", "it", "a", "should it be in there", "misinvestment training", "신청 서류 조건 알려줘", "학자금대출 신청 조건이 궁금해요", "대학 등록금 빌릴 수 있나요?", "오늘 날씨 어때요?"]) {
    assert.deepEqual(searchKnowledge(query), [], query);
  }
});

test("multilingual banking and phishing requests avoid unrelated English substring matches", () => {
  for (const query of ["在韩国开户需要什么材料", "外国人が口座を作るには何が必要ですか", "open a bank account in Korea"]) {
    assert.equal(searchKnowledge(query)[0]?.document.id, "foreign-resident-finance", query);
  }
  const phishing = searchKnowledge("I got a text asking for my bank password");
  assert.equal(phishing[0]?.document.id, "phishing-emergency-response");
  assert.equal(phishing.some(({ document }) => document.id === "foreign-resident-finance"), false);
  const foreign = searchKnowledge("外国人 本人確認 1345")[0];
  assert.equal(new Set(foreign.matchedKeywords).size, foreign.matchedKeywords.length);
});

test("knowledge results remain bounded and source context preserves the original facts", () => {
  const query = "청년 창업 외국인 예금 투자 보이스피싱";
  const first = searchKnowledge(query, 2);
  assert.equal(first.length, 2);
  assert.deepEqual(searchKnowledge(query, 2), first);
  assert.ok(searchKnowledge(query, 200).length <= 10);
  assert.equal(searchKnowledge(query, -10).length, 1);
  const context = formatKnowledgeContext(first);
  for (const { document } of first) {
    assert.ok(context.includes(document.content));
    assert.ok(context.includes(document.source.url));
    assert.ok(context.includes(`Reviewed: ${document.source.reviewedAt}`));
  }
  assert.equal(formatKnowledgeContext([]), "No matching verified knowledge was found.");
});
