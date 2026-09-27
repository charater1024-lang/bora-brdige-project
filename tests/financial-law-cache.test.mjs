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
const { normalizeCachedFinancialLawGuidance } = await server.ssrLoadModule(
  "/lib/legal/financial-law-cache.ts",
);
const { FinancialLawTopic } = await server.ssrLoadModule("/lib/legal/financial-law.ts");
test.after(() => server.close());

function guidance(overrides = {}) {
  return {
    status: "official-current",
    topic: FinancialLawTopic.FinancialConsumerProtection,
    topicLabel: "금융상품 소비자보호",
    publisher: "국가법령정보센터",
    law: {
      lawId: "013704",
      mst: "277247",
      lawName: "금융소비자 보호에 관한 법률",
      promulgationDate: "20251001",
      promulgationNumber: "21065",
      effectiveDate: "20260102",
      ministry: "금융위원회",
      retrievedAt: "2026-07-24T00:00:00.000Z",
      sourceUrl: "https://www.law.go.kr/법령/금융소비자보호에관한법률",
    },
    articles: [{
      sourceId: "law-go-kr:013704:0019001:20260102",
      articleKey: "0019001",
      articleNumber: "19",
      articleTitle: "설명의무",
      text: "공식 조문 내용",
      effectiveDate: "20260102",
      sourceUrl: "https://www.law.go.kr/법령/금융소비자보호에관한법률/제19조",
    }],
    ...overrides,
  };
}

test("validated official guidance can enter the legal cache", () => {
  const normalized = normalizeCachedFinancialLawGuidance(
    guidance(),
    FinancialLawTopic.FinancialConsumerProtection,
  );
  assert.ok(normalized);
  assert.equal(normalized.articles[0].articleNumber, "19");
});

test("cache validation rejects credentials, topic confusion and version mismatches", () => {
  const withCredential = guidance();
  withCredential.law.sourceUrl += "?OC=SECRET";
  assert.equal(normalizeCachedFinancialLawGuidance(
    withCredential,
    FinancialLawTopic.FinancialConsumerProtection,
  ), null);

  assert.equal(normalizeCachedFinancialLawGuidance(
    guidance(),
    FinancialLawTopic.ElectronicFinance,
  ), null);

  const mismatchedArticle = guidance();
  mismatchedArticle.articles[0].effectiveDate = "20260103";
  assert.equal(normalizeCachedFinancialLawGuidance(
    mismatchedArticle,
    FinancialLawTopic.FinancialConsumerProtection,
  ), null);
});
