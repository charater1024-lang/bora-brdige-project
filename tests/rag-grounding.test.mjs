import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
});
const { inspectAnswerGrounding } = await server.ssrLoadModule("/lib/rag/grounding.ts");
test.after(() => server.close());

const sources = [
  { id: "deposit-guide", title: "예금 상품", excerpt: "확인된 금리는 연 3.5%이며, 가입 금액은 100,000,000원입니다.", url: "https://official.example/deposit", publisher: "공식 기관" },
  { id: "kosis-youth", title: "청년 고용통계", excerpt: "고용률은 47.2%입니다. 기준일은 2026-08-30입니다.", url: "https://official.example/employment" },
  { id: "policy-seoul", title: "지원사업", excerpt: "자격 심사를 거쳐 지원할 수 있습니다. 접수는 2026년 9월 2일 마감입니다.", url: "https://official.example/policy", reviewedAt: "2026-08-31" },
];

test("only actually cited supplied evidence is returned, preserving source metadata", () => {
  const result = inspectAnswerGrounding("예금 금리는 연 3.5%입니다. [deposit-guide]", sources);
  assert.equal(result.ok, true);
  assert.deepEqual(result.citedSourceIds, ["deposit-guide"]);
  assert.deepEqual(result.usedSources, [sources[0]]);
  assert.equal(result.usedSources[0].publisher, "공식 기관");
});

test("unknown IDs, numeric pseudo-citations, and omitted empty excerpts are rejected", () => {
  for (const answer of ["공식 안내입니다. [made-up-id]", "공식 안내입니다. [1]"]) {
    const result = inspectAnswerGrounding(answer, sources);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.includes("unknown_source_id"));
  }
  const result = inspectAnswerGrounding("공식 안내입니다. [omitted-law]", [{ id: "omitted-law", title: "생략된 조문", excerpt: "" }]);
  assert.deepEqual(result.unknownSourceIds, ["omitted-law"]);
});

test("uncited source-based answers can be withheld while greetings explicitly opt out", () => {
  assert.equal(inspectAnswerGrounding("공식 안내입니다.", sources).missingCitations, true);
  assert.equal(inspectAnswerGrounding("안녕하세요.", [], { requireCitations: false }).ok, true);
  assert.equal(inspectAnswerGrounding("", [], { requireCitations: false }).ok, false);
});

test("links must belong to the supplied URL set, including markdown destinations", () => {
  const accepted = inspectAnswerGrounding("공식 자료 [deposit-guide](https://official.example/deposit#terms)", sources);
  assert.equal(accepted.ok, true);
  for (const answer of [
    "공식 자료 [deposit-guide](https://unrelated.example/deposit)",
    "공식 자료 [deposit-guide](javascript:alert)",
    "공식 자료 [deposit-guide] https://official.example/deposit?redirect=unknown",
  ]) {
    const result = inspectAnswerGrounding(answer, sources);
    assert.equal(result.ok, false);
    assert.ok(result.unknownUrls.length > 0);
  }
});

test("amount equivalents are normalized but changed amounts and rates are rejected", () => {
  assert.equal(inspectAnswerGrounding("가입 금액은 1억 원입니다. [deposit-guide]", sources).ok, true);
  const wrong = inspectAnswerGrounding("금리는 4.5%이고 가입 금액은 2억 원입니다. [deposit-guide]", sources);
  assert.equal(wrong.ok, false);
  assert.deepEqual(wrong.unsupportedClaims.map((claim) => claim.kind), ["amount", "rate"]);
});

test("a number in another supplied or cited document cannot validate the current citation", () => {
  const wrongDocument = inspectAnswerGrounding("청년 고용률은 3.5%입니다. [kosis-youth]", sources);
  assert.equal(wrongDocument.ok, false);
  assert.equal(wrongDocument.unsupportedClaims[0].value, "3.5%");
  const wrongSentence = inspectAnswerGrounding("예금 금리는 3.5%입니다. [deposit-guide] 청년 고용률은 3.5%입니다. [kosis-youth]", sources);
  assert.equal(wrongSentence.ok, false);
  assert.equal(wrongSentence.unsupportedClaims.length, 1);
});

test("numbers need a citation on their own statement, not merely elsewhere in the answer", () => {
  const result = inspectAnswerGrounding("공식 예금 정보를 확인하세요. [deposit-guide]\n금리는 3.5%입니다.", sources);
  assert.equal(result.ok, false);
  assert.equal(result.missingCitations, false);
  assert.equal(result.unsupportedClaims.length, 1);
  assert.equal(inspectAnswerGrounding("금리는 3.5%입니다.\n[deposit-guide]", sources).ok, true);
});

test("dates compare at their stated precision and collection metadata is not a deadline", () => {
  assert.equal(inspectAnswerGrounding("마감일은 2026-09-02입니다. [policy-seoul]", sources).ok, true);
  assert.equal(inspectAnswerGrounding("접수는 2026년 9월 마감입니다. [policy-seoul]", sources).ok, true);
  assert.equal(inspectAnswerGrounding("마감일은 2026-08-31입니다. [policy-seoul]", sources).ok, false);
  const yearOnly = [{ id: "annual-policy", title: "2026년 지원사업", excerpt: "접수 일정은 추후 공지합니다." }];
  assert.equal(inspectAnswerGrounding("마감일은 2026-09-02입니다. [annual-policy]", yearOnly).ok, false);
});

test("rate ranges check both endpoints and percentage points remain distinct", () => {
  const rangeSource = [{ id: "rate-range", title: "금리 범위", excerpt: "금리는 3~5%입니다." }];
  assert.equal(inspectAnswerGrounding("금리는 3~5%입니다. [rate-range]", rangeSource).ok, true);
  assert.equal(inspectAnswerGrounding("금리는 2~5%입니다. [rate-range]", rangeSource).ok, false);
  assert.equal(inspectAnswerGrounding("3.5%p 증가했습니다. [deposit-guide]", sources).ok, false);
});

test("a rate must match the exact product term row, not merely occur elsewhere in the cited source", () => {
  const termRates = [{
    id: "term-rates",
    title: "정기예금 금리",
    excerpt: [
      "기간: 12개월; 기본금리: 2.9%; 최고금리: 3.1%",
      "기간: 24개월; 기본금리: 2.8%; 최고금리: 3.0%",
      "기간: 36개월; 기본금리: 2.8%; 최고금리: 3.0%",
    ].join("\n"),
  }];
  assert.equal(inspectAnswerGrounding("12개월 기본금리는 2.9%입니다. [term-rates]", termRates).ok, true);
  assert.equal(inspectAnswerGrounding("1년 기본금리는 2.9%입니다. [term-rates]", termRates).ok, true);
  assert.equal(inspectAnswerGrounding("24개월 기본금리는 2.8%입니다. [term-rates]", termRates).ok, true);
  const swapped = inspectAnswerGrounding("12개월 기본금리는 2.8%입니다. [term-rates]", termRates);
  assert.equal(swapped.ok, false);
  assert.deepEqual(swapped.unsupportedClaims.map((claim) => claim.value), ["2.8%"]);
  assert.ok(swapped.reasons.includes("unsupported_numeric_claim"));
  assert.equal(inspectAnswerGrounding("기본금리는 2.8%입니다. [term-rates]", termRates).ok, true,
    "a rate-only claim retains the existing value-presence check when it makes no term claim");
});

test("numeric checking is independently configurable and emergency phone numbers are not amounts", () => {
  const calculation = inspectAnswerGrounding("직접 입력한 값의 예상 잔액은 500,000원입니다. [deposit-guide]", sources, { requireNumericGrounding: false });
  assert.equal(calculation.ok, true);
  const help = inspectAnswerGrounding("금융회사와 112에 연락하고 1394에서 상담받으세요. [help-guide]", [{ id: "help-guide", title: "피해 대응", excerpt: "공식 대응 창구를 확인하세요." }]);
  assert.equal(help.ok, true);
});

test("translated numeric forms remain checkable without accepting changed values", () => {
  const translated = [
    { id: "amount-detail", title: "자금 안내", excerpt: "금액은 150,000,000원입니다." },
    { id: "japan-detail", title: "金額", excerpt: "金額は10000円です。" },
    { id: "china-detail", title: "金额", excerpt: "金额为10000元，利率为5%。" },
  ];
  assert.equal(inspectAnswerGrounding("금액은 1억5천만원입니다. [amount-detail]", translated).ok, true);
  assert.equal(inspectAnswerGrounding("금액은 2억5천만원입니다. [amount-detail]", translated).ok, false);
  assert.equal(inspectAnswerGrounding("金額は1万円です。 [japan-detail]", translated).ok, true);
  assert.equal(inspectAnswerGrounding("金额为1万元，利率为百分之5。 [china-detail]", translated).ok, true);
  assert.equal(inspectAnswerGrounding("基準日は2026年8月30日です。 [kosis-youth]", sources).ok, true);
  assert.equal(inspectAnswerGrounding("The reference date is August 30, 2026. [kosis-youth]", sources).ok, true);
  assert.equal(inspectAnswerGrounding("기준일은 2026-99-99입니다. [kosis-youth]", sources).ok, false);
});

test("amount ranges validate both limits, not just the suffix amount", () => {
  const limits = [{ id: "amount-range", title: "한도", excerpt: "금액은 100~200만 원입니다." }];
  assert.equal(inspectAnswerGrounding("금액은 100~200만 원입니다. [amount-range]", limits).ok, true);
  assert.equal(inspectAnswerGrounding("금액은 50~200만 원입니다. [amount-range]", limits).ok, false);
});

test("legal answers can require a real legal citation independently of other citations", () => {
  const options = { requiredCitationPrefix: "law-go-kr:" };
  assert.equal(inspectAnswerGrounding("조건을 확인하세요. [policy-seoul]", sources, options).ok, false);
  const legal = [{ id: "law-go-kr:123:000100:20260101", title: "제1조", excerpt: "공식 조문입니다." }];
  assert.equal(inspectAnswerGrounding("조건을 확인하세요. [law-go-kr:123:000100:20260101]", legal, options).ok, true);
});

test("passing ID checks does not claim semantic entailment or correctness", () => {
  const result = inspectAnswerGrounding("모든 신청자는 심사 없이 지급됩니다. [policy-seoul]", sources);
  assert.equal(result.ok, true, "non-numeric semantic contradiction needs separate review, not an invented automated verdict");
});
