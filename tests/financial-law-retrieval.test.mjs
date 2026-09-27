import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

let cacheRow = null;
globalThis.__boraLawRetrievalTestDb = {
  prepare() {
    return { bind() { return this; }, async run() { return { meta: { changes: 0 } }; }, async first() { return cacheRow; } };
  },
};
const server = await createServer({
  root: fileURLToPath(new URL("..", import.meta.url)),
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  plugins: [{
    name: "test-only-law-cache-binding",
    resolveId(id) { return id === "cloudflare:workers" ? "\0test-law-workers" : undefined; },
    load(id) { return id === "\0test-law-workers" ? "export const env = { DB: globalThis.__boraLawRetrievalTestDb };" : undefined; },
  }],
});
const {
  FINANCIAL_LAW_RETRIEVAL_VERSION,
  FinancialLawTopic,
  FINANCIAL_LAW_MANIFEST,
  fetchFinancialLawGuidance,
  formatFinancialLawContext,
  formatFinancialLawGroundingSources,
  detectFinancialLegalIntent,
} = await server.ssrLoadModule("/lib/legal/financial-law.ts");
const { normalizeCachedFinancialLawGuidance, readFinancialLawGuidanceCache } = await server.ssrLoadModule("/lib/legal/financial-law-cache.ts");
test.after(async () => { await server.close(); delete globalThis.__boraLawRetrievalTestDb; });

const topic = FinancialLawTopic.CreditInformation;
const lawName = FINANCIAL_LAW_MANIFEST[topic].lawName;
function article(number, title, text) {
  return {
    sourceId: `law-go-kr:013704:${number.replace("의", "_")}:20260102`,
    articleKey: number.replace("의", "_"), articleNumber: number, articleTitle: title, text,
    effectiveDate: "20260102", sourceUrl: `https://www.law.go.kr/법령/${lawName}/제${number}조`,
  };
}
function guidance(articles, candidateArticles = []) {
  return {
    status: "official-current", topic, topicLabel: "신용정보", publisher: "국가법령정보센터",
    law: { lawId: "013704", mst: "277247", lawName, promulgationDate: "20251001", promulgationNumber: "21065", effectiveDate: "20260102", ministry: "금융위원회", retrievedAt: "2026-08-30T00:00:00.000Z", sourceUrl: `https://www.law.go.kr/법령/${lawName}` },
    articles, candidateArticles, retrievalVersion: FINANCIAL_LAW_RETRIEVAL_VERSION,
  };
}
function encodedLength(text) { return new TextEncoder().encode(text).byteLength; }

test("question-specific passages can use shared candidates without mutating the shared guidance", () => {
  const primary = ["15", "20", "31", "32", "33", "35"].map((number) => article(number, "일반 규정", "일반적인 공식 규정입니다. ".repeat(120)));
  const extra = article("37", "개인신용정보 삭제", "① 개인신용정보 삭제를 요구할 수 있다. 다만 법률에 정한 보존 대상은 예외로 한다.");
  const input = guidance(primary, [extra]);
  const before = JSON.stringify(input);
  const context = formatFinancialLawContext(input, "개인신용정보 삭제 방법과 예외는?");
  const selected = formatFinancialLawGroundingSources(input, "개인신용정보 삭제 방법과 예외는?");
  assert.equal(selected[0].id, extra.sourceId);
  assert.equal(selected[0].excerpt, extra.text);
  assert.ok(context.indexOf(`[${extra.sourceId}]`) < context.indexOf(`[${primary[0].sourceId}]`));
  assert.equal(JSON.stringify(input), before);
  assert.ok(encodedLength(context) <= 4_000);
});

test("conditions and exceptions in one numbered paragraph are never split", () => {
  const complete = "① 청약철회는 정해진 기간 안에 할 수 있다. 다만 예외 대상은 제외한다.";
  const input = guidance([article("37", "철회 조건", `${complete}\n② ${"기타 설명입니다. ".repeat(300)}`)]);
  const selected = formatFinancialLawGroundingSources(input, "철회 조건");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].excerpt, complete);
  assert.equal(selected[0].truncated, true);
  assert.match(formatFinancialLawContext(input, "철회 조건"), /excerpt_status: selected; omitted_passages=1/u);
});

test("an oversized conditional paragraph is explicitly omitted, not prefix-truncated", () => {
  const text = `① 이용할 수 있다. ${"일반 설명 문장입니다. ".repeat(300)}다만 예외에 해당하면 이용할 수 없다.`;
  const input = guidance([article("37", "이용 조건", text)]);
  const context = formatFinancialLawContext(input, "이용 조건");
  assert.match(context, /excerpt_status: omitted/u);
  assert.match(context, /official_text: ""/u);
  assert.doesNotMatch(context, /① 이용할 수 있다/u);
  assert.deepEqual(formatFinancialLawGroundingSources(input, "이용 조건"), []);
  assert.ok(encodedLength(context) <= 4_000);
});

test("a separately numbered exception stays with the paragraph it qualifies", () => {
  const input = guidance([article("37", "신청 조건", [
    "① 신청자는 접수할 수 있다.",
    `② ${"별도 항의 설명입니다. ".repeat(300)}`,
    "③ 제1항에도 불구하고 예외 대상자는 접수할 수 없다.",
  ].join("\n"))]);
  const selected = formatFinancialLawGroundingSources(input, "신청 조건");
  assert.match(selected[0].excerpt, /① 신청자는 접수할 수 있다/u);
  assert.match(selected[0].excerpt, /③ 제1항에도 불구하고/u);
  assert.doesNotMatch(selected[0].excerpt, /②/u);
});

test("grounding sources exactly match emitted official_text, excluding omitted records", () => {
  const input = guidance([
    article("15", "일반 규정", "① 공식 규정입니다."),
    article("37", "삭제 조건", "① 삭제를 요구할 수 있다. 다만 예외 조건은 공식 원문을 확인한다."),
  ]);
  const query = "제37조 삭제 조건";
  const context = formatFinancialLawContext(input, query);
  for (const source of formatFinancialLawGroundingSources(input, query)) {
    const record = context.slice(context.indexOf(`[${source.id}]`)).split("\n\n", 1)[0];
    const raw = /official_text: (.+)$/mu.exec(record)?.[1];
    assert.equal(JSON.parse(raw), source.excerpt);
    assert.ok(source.excerpt.length > 0);
  }
});

test("very long metadata is omitted without breaking the total byte limit", () => {
  const input = guidance([article("37", "아주 긴 제목".repeat(2_000), "공식 규정입니다.")]);
  input.law.sourceUrl = `https://www.law.go.kr/${"가".repeat(4_000)}`;
  const context = formatFinancialLawContext(input);
  assert.ok(encodedLength(context) <= 4_000);
  assert.match(context, /omitted/u);
  assert.deepEqual(formatFinancialLawGroundingSources(input), []);
});

async function fetchedGuidance(text = "① 개인신용정보에 관한 공식 규정이다.") {
  const numbers = ["15", "20", "31", "32", "33", "35", "37", "38의3", "40", "41", "42", "43", "44"];
  const requestedQueries = [];
  const result = await fetchFinancialLawGuidance({
    oc: "TEST_ONLY_CREDENTIAL", topic,
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("lawSearch.do")) {
        requestedQueries.push(url.searchParams.get("query"));
        return Response.json({ LawSearch: { resultCode: "00", law: [{ 법령일련번호: "277247", 현행연혁코드: "현행", 법령명한글: lawName, 법령ID: "013704", 공포일자: "20251001", 공포번호: "21065", 소관부처명: "금융위원회", 시행일자: "20260102" }] } });
      }
      return Response.json({ 법령: {
        기본정보: { 법령명_한글: lawName, 시행일자: "20260102" },
        조문: { 조문단위: numbers.map((number) => ({
          조문번호: number.split("의")[0], 조문가지번호: number.split("의")[1],
          조문여부: "조문", 조문제목: number === "37" ? "삭제" : "개인신용정보", 조문내용: text,
        })) },
      } });
    },
  });
  assert.deepEqual(requestedQueries, [lawName]);
  return result;
}

test("fetching keeps six UI articles plus bounded shared candidates and no personal query", async () => {
  const result = await fetchedGuidance();
  assert.deepEqual(result.articles.map((item) => item.articleNumber), ["15", "20", "31", "32", "33", "35"]);
  assert.equal(result.candidateArticles.length, 6);
  assert.equal(result.candidateArticles[0].articleNumber, "37");
  assert.equal(result.retrievalVersion, 2);
  assert.ok(normalizeCachedFinancialLawGuidance(result, topic));
});

test("storage bounds also retain complete passages and explicitly mark omitted long paragraphs", async () => {
  const result = await fetchedGuidance(`① ${"아주 긴 조건입니다. ".repeat(900)}다만 예외가 있다.`);
  for (const item of [...result.articles, ...result.candidateArticles]) {
    assert.equal(item.text, "");
    assert.equal(item.textTruncated, true);
    assert.equal(item.omittedPassageCount, 1);
  }
  assert.ok(normalizeCachedFinancialLawGuidance(result, topic));
  assert.ok(encodedLength(JSON.stringify(result)) <= 180_000);
});

test("twelve retained candidate bodies remain within the existing shared-cache payload limit", async () => {
  const sentence = "개인신용정보의 일반적인 설명 문장이다.";
  const result = await fetchedGuidance(`${sentence} `.repeat(1_000));
  for (const item of [...result.articles, ...result.candidateArticles]) {
    assert.ok(encodedLength(item.text) > 10_000);
    assert.ok(encodedLength(item.text) <= 12_000);
    assert.ok(item.text.endsWith(sentence));
    assert.equal(item.textTruncated, true);
  }
  assert.ok(encodedLength(JSON.stringify(result)) <= 180_000);
  assert.ok(normalizeCachedFinancialLawGuidance(result, topic));
});

test("legacy cache rows are readable but never fresh after the retrieval version changes", async () => {
  const now = Date.parse("2026-08-30T01:00:00.000Z");
  const current = guidance([article("37", "삭제 조건", "공식 규정입니다.")]);
  const legacy = structuredClone(current);
  delete legacy.retrievalVersion;
  delete legacy.candidateArticles;
  cacheRow = { payload: JSON.stringify(legacy), retrievedAt: now - 1_000, expiresAt: now + 3_600_000 };
  assert.equal((await readFinancialLawGuidanceCache(topic, now)).fresh, false);
  cacheRow = { ...cacheRow, payload: JSON.stringify(current) };
  assert.equal((await readFinancialLawGuidanceCache(topic, now)).fresh, true);
});

test("candidate cache validation rejects duplicates, legacy additions, and unmarked empty text", () => {
  const main = article("15", "일반 규정", "공식 규정입니다.");
  assert.equal(normalizeCachedFinancialLawGuidance(guidance([main], [main]), topic), null);
  const legacy = guidance([main], [article("37", "삭제 조건", "공식 규정입니다.")]);
  delete legacy.retrievalVersion;
  assert.equal(normalizeCachedFinancialLawGuidance(legacy, topic), null);
  assert.equal(normalizeCachedFinancialLawGuidance(guidance([{ ...main, text: "" }]), topic), null);
});

test("legal intent covers explicit official-law concepts in every supported locale", () => {
  for (const query of ["개인신용정보 삭제 방법", "How can I delete my credit information under Korean law?", "信用情報を削除するには？", "如何删除个人信用信息？"]) {
    assert.equal(detectFinancialLegalIntent(query), FinancialLawTopic.CreditInformation);
  }
  assert.equal(detectFinancialLegalIntent("預金者保護法の上限を教えてください"), FinancialLawTopic.DepositorProtection);
  assert.equal(detectFinancialLegalIntent("Tell me about debt collection"), FinancialLawTopic.FairDebtCollection);
  assert.equal(detectFinancialLegalIntent("Please delete this photograph"), null);
});
