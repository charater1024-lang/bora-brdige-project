import assert from "node:assert/strict";
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
const { normalizeRagText, ragSearchTerms, resolveRagQuery } = await server.ssrLoadModule("/lib/rag/query.ts");
test.after(() => server.close());

test("RAG normalization preserves multilingual text and normalizes full-width input", () => {
  assert.equal(normalizeRagText("  청년／ＹＯＵＴＨ  ＬＯＡＮ！年金  "), "청년 youth loan 年金");
  assert.equal(normalizeRagText(""), "");
  assert.equal(normalizeRagText("---!?"), "");
});

test("query terms drop English filler, retain names and add bounded Korean stems", () => {
  assert.deepEqual(ragSearchTerms("help me in it that the"), []);
  const terms = ragSearchTerms("카카오페이 계좌개설은 어떤 서류가 필요한가요?");
  assert.ok(terms.includes("카카오페이"));
  assert.ok(terms.includes("계좌개설"));
  assert.ok(terms.includes("서류"));
  assert.equal(ragSearchTerms("misinvestment training").includes("투자"), false);
});

test("query aliases cover natural language without adding answer facts", () => {
  const cases = [
    ["검사라는 사람이 안전계좌로 돈을 옮기래요", "피싱"],
    ["택배 주소를 고치라는 연락이 왔어요", "문자 링크"],
    ["가게 열려는데 정부에서 받을 수 있는 도움이 있나요", "창업"],
    ["Can I open a bank account with my passport?", "계좌개설"],
    ["在韩国开户需要什么材料", "계좌개설"],
    ["外国人が口座を作るには何が必要ですか", "계좌개설"],
    ["대학 등록금 빌릴 수 있나요?", "학자금대출"],
    ["달마다 은행에 돈을 모으려는데 뭘 따져 봐야 해요?", "적금"],
  ];
  for (const [query, expected] of cases) assert.ok(ragSearchTerms(query).includes(expected), query);
});

test("query expansion is deterministic, deduplicated and limited to 24 short terms", () => {
  const query = `청년 취업 창업 적금 월세 학자금 ${Array.from({ length: 200 }, (_, index) => `term${index}`).join(" ")}`;
  const terms = ragSearchTerms(query);
  assert.ok(terms.length <= 24);
  assert.equal(new Set(terms).size, terms.length);
  assert.ok(terms.every((term) => term.length <= 64));
  assert.deepEqual(ragSearchTerms(query), terms);
});

test("elliptical detail questions use only explicitly supplied prior user questions", () => {
  const prior = Object.freeze(["청년 월세 지원 신청 조건이 궁금해요"]);
  for (const question of ["그럼 신청 서류는?", "신청 서류는?", "신청서류는?", "마감이 언제예요?"]) {
    const resolved = resolveRagQuery(question, prior);
    assert.equal(resolved.contextualized, true, question);
    assert.equal(resolved.needsClarification, false, question);
    assert.equal(resolved.query, `${prior[0]}\n${question}`);
    assert.deepEqual(resolveRagQuery(question), {
      query: question, contextualized: false, needsClarification: true,
    });
  }
  assert.deepEqual(prior, ["청년 월세 지원 신청 조건이 궁금해요"]);
});

test("multilingual detail follow-ups resolve against the consented subject", () => {
  for (const question of ["What documents are needed?", "then what is the rate?", "必要な書類は何ですか", "需要什么材料"] ) {
    const resolved = resolveRagQuery(question, ["외국인 계좌개설을 도와주세요"]);
    assert.equal(resolved.contextualized, true, question);
    assert.equal(resolved.needsClarification, false, question);
  }
});

test("vague follow-ups ask for clarification even when history is supplied", () => {
  for (const question of ["", "그럼?", "그러면?", "더 알려줘", "what about that?", "then?", "那呢？"]) {
    const resolved = resolveRagQuery(question, ["청년 월세 지원은?"]);
    assert.equal(resolved.contextualized, false, question);
    assert.equal(resolved.needsClarification, true, question);
  }
});

test("an explicit new topic and unrelated questions never inherit a former subject", () => {
  for (const question of ["그럼 창업지원은?", "그럼 보이스피싱 신고는?", "청년 고용률은 몇 퍼센트야?", "What is a student loan?", "그럼 날씨는?", "안녕하세요"]) {
    assert.deepEqual(resolveRagQuery(question, ["주식 투자 공시는 어디서 보나요?"]), {
      query: question, contextualized: false, needsClarification: false,
    });
  }
});

test("follow-up context selects the newest subject and scans only three prior questions", () => {
  const resolved = resolveRagQuery("그럼 서류는?", ["주식 투자 확인", "청년 월세 지원", "마감은?"]);
  assert.equal(resolved.query, "청년 월세 지원\n그럼 서류는?");
  const tooOld = resolveRagQuery("그럼 서류는?", ["청년 월세 지원", "그럼?", "마감은?", "조건은?"]);
  assert.equal(tooOld.contextualized, false);
  assert.equal(tooOld.needsClarification, true);
});

test("follow-up actions and locations retain a supplied subject without assuming a new one", () => {
  for (const [prior, latest] of [
    ["청년 자산형성 제도가 궁금해요", "그럼 중간에 해지하면 뭘 확인해야 해?"],
    ["보이스피싱으로 돈을 송금했어요", "그다음엔 어디에 연락해야 하나요?"],
    ["투자하기 전에 DART 공시를 보고 싶어요", "그건 어디서 보나요?"],
  ]) {
    assert.equal(resolveRagQuery(latest, [prior]).query, `${prior}\n${latest}`);
    assert.equal(resolveRagQuery(latest).needsClarification, true);
  }
});

test("follow-up and source question lengths are bounded without hidden I/O", () => {
  const prior = `청년 월세 ${"상세 조건 ".repeat(1_000)}`;
  const resolved = resolveRagQuery("그럼 서류는?", [prior]);
  assert.equal(resolved.query.split("\n")[0].length, 800);
  assert.ok(resolved.query.length <= 2_400);
  const longLatest = resolveRagQuery(`그럼 ${"서류 ".repeat(2_000)}`, [prior]);
  assert.ok(longLatest.query.length <= 2_400);
  assert.equal(longLatest.contextualized, false);
  assert.equal(longLatest.needsClarification, true);
});
