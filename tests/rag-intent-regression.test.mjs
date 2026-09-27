import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
test.after(() => server.close());
const query = await server.ssrLoadModule("/lib/rag/query.ts");
const catalog = await server.ssrLoadModule("/lib/rag/public-catalog.ts");
const knowledge = await server.ssrLoadModule("/lib/rag/knowledge.ts");
const { inspectAnswerGrounding: inspect } = await server.ssrLoadModule("/lib/rag/grounding.ts");
const productionQuestions = [
  "현재 원달러 환율과 기준일을 알려줘. 자료에 없는 값은 추측하지 말고 출처도 보여줘.",
  "예금과 적금의 차이를 처음 이용하는 사람도 이해할 수 있게 설명해줘. 자료에 있는 내용만 사용해줘.",
  "청년 월세 지원 정책에서 신청하기 전에 확인해야 할 조건을 출처와 함께 알려줘.",
  "학자금대출 금리를 확인할 때 이용할 공식 자료를 알려줘.",
];
test("four production questions preserve their intended offline retrieval paths", async () => {
  const indicators = await server.ssrLoadModule("/lib/rag/indicators.ts");
  assert.equal(indicators.publicIndicatorsRequested(productionQuestions[0]), true);
  assert.equal(query.financialConceptRequested(productionQuestions[1]), true);
  assert.equal(catalog.publicCatalogRequested(productionQuestions[2]), true);
  assert.equal(query.studentLoanOfficialGuideRequested(productionQuestions[3]), true);
  assert.equal(catalog.publicCatalogRequested(productionQuestions[3]), false);
  const guide = knowledge.searchKnowledge(productionQuestions[3])[0].document;
  assert.equal(guide.source.url, "https://www.kosaf.go.kr/ko/tuition.do?pg=tuition_main");
  assert.match(guide.content, /현재 금리 수치나 개인별 자격을 확인한 자료가 아니다/);
  assert.equal(query.studentLoanOfficialGuideRequested("학자금대출 현재 금리는 몇 퍼센트야?"), false);
  assert.equal(query.studentLoanOfficialGuideRequested("부산 학자금대출 이자 지원 공식 자료"), false);
});

// Synthetic offline regression scenarios based on observed production issues.
// These do not run a model and are not a claim of live model answer accuracy.
test("principles use educational evidence instead of application-period offers", async () => {
  for (const question of ["예금과 적금의 차이를 설명해줘", "Explain the difference between deposits and savings", "預金と積金の違い", "存款和储蓄的区别"]) {
    assert.equal(query.financialConceptRequested(question), true);
    assert.equal((await catalog.searchPublicCatalogEvidence(question)).status, "not-requested");
  }
  const hits = knowledge.searchKnowledge("예금과 적금의 차이를 설명해줘");
  assert.equal(hits[0].document.id, "financial-product-comparison");
  assert.match(hits[0].document.content, /각 납입금의 예치 기간/);
  assert.equal(catalog.publicCatalogRequested("현재 가입할 예금 적금 상품 추천"), true);
});

test("official student loan rates are not limited to deposit products", () => {
  const base = { category: "youth", publisher: "공식기관", publishedAt: null, expiresAt: null, verifiedAt: null, kind: "notice" };
  const docs = [
    { ...base, id: "local", title: "지역 학자금 대출 이자 지원 신청 공고", excerpt: "학자금 대출 이자 지원 신청 안내 금리 확인", sourceUrl: "https://www.busan.go.kr/notice", regionScope: "regional", regions: ["부산"] },
    { ...base, id: "kosaf-guide", title: "학자금 대출 안내", excerpt: "학자금 대출 금리와 상환 안내는 공식 원문에서 확인하세요.", sourceUrl: "https://www.kosaf.go.kr/ko/tuition.do" },
  ];
  for (const question of ["학자금 대출 금리를 확인할 공식 안내 자료", "student loan interest rate official 학자금", "奨学金 金利 학자금 공식"]) {
    const hits = catalog.rankPublicRagDocuments(question, docs);
    assert.equal(hits[0]?.document.id, "kosaf-guide");
    assert.doesNotMatch(hits[0].document.excerpt, /^기간상태:/);
  }
});

const fx = [{ id: "fx", title: "환율", excerpt: "기준일 2026-08-31. USD 1달러당 1,350원.", url: "https://official.example/fx" }];
test("short paragraph-end and exact source URL references ground known exchange figures", () => {
  assert.equal(inspect("기준일은 2026-08-31입니다. 1달러는 1,350원입니다. [fx]", fx).ok, true);
  assert.equal(inspect("1달러는 1,350원입니다. [공식 환율](https://official.example/fx)", fx).ok, true);
});
test("plausible invented figures and cross-paragraph citation borrowing stay blocked", () => {
  assert.equal(inspect("1달러는 1,450원입니다. [fx]", fx).ok, false);
  assert.equal(inspect("1달러는 1,350원입니다.\n\n참고 [fx]", fx).ok, false);
  assert.equal(inspect("1달러는 1,350원입니다. https://evil.example/fx", fx).ok, false);
});

test("production grounding rejects a rate borrowed from a different deposit term row", () => {
  const products = [{
    id: "deposit-terms",
    title: "예금 상품 기간별 금리",
    excerpt: "기간: 12개월; 기본금리: 2.9%\n기간: 24개월; 기본금리: 2.8%\n기간: 36개월; 기본금리: 2.8%",
    url: "https://official.example/deposit-terms",
  }];
  assert.equal(inspect("12개월 예금 금리는 2.9%입니다. [deposit-terms]", products).ok, true);
  assert.equal(inspect("12개월 예금 금리는 2.8%입니다. [deposit-terms]", products).ok, false);
});
