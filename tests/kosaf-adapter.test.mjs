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
  resolve: { alias: { "@": projectRoot } },
  server: { middlewareMode: true },
});
const { latestKosafEndpoint, normalizeKosafRows } = await server.ssrLoadModule("/lib/public-data/adapters.ts");
test.after(() => server.close());

test("current KOSAF university fields become structured scholarship records", () => {
  const [item] = normalizeKosafRows([{
    번호: 17,
    운영기관명: "보라장학재단",
    상품명: "지역인재 생활비 장학금",
    신청대상: "대학생 및 대학원생",
    신청기간: "2026.07.01 ~ 2026.08.31",
    지원금액: "학기당 100만원",
    "지원내역 상세내용": "생활비 지원",
    데이터기준일자: "2026-07-23",
  }], "university");

  assert.equal(item.id, "kosaf-university-17");
  assert.equal(item.title, "보라장학재단 · 지역인재 생활비 장학금");
  assert.match(item.summary, /대학생 및 대학원생/u);
  assert.match(item.summary, /학기당 100만원/u);
  assert.equal(item.expiresAt, "2026-08-31");
  assert.equal(item.publishedAt, "2026-07-23");
  assert.equal(item.tags.includes("section:scholarship"), true);
  assert.deepEqual(item.youthPolicyEligibility.statuses, ["university", "graduate_school"]);
  assert.deepEqual(item.youthPolicyEligibility.interests, ["education"]);
});

test("KOSAF high-school records use official current identifiers and fail closed without a title", () => {
  const items = normalizeKosafRows([
    {
      번호: "H-3",
      운영기관명: "교육청",
      상품명: "고교 장학지원",
      신청대상: "고등학생",
      데이터기준일자: "20260723",
    },
    { 번호: "missing-title", 신청대상: "고등학생" },
  ], "high");

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "kosaf-high-H-3");
  assert.deepEqual(items[0].youthPolicyEligibility.statuses, ["high_school"]);
  assert.equal(items[0].sourceLinkKind, "dataset");
});

test("KOSAF resolves the newest monthly ODCloud resource from the official specification", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    paths: {
      "/15028252/v1/uddi:11111111-1111-4111-8111-111111111111": {
        get: { summary: "한국장학재단_학자금지원정보(대학생)_20260612" },
      },
      "/15028252/v1/uddi:22222222-2222-4222-8222-222222222222": {
        get: { summary: "한국장학재단_학자금지원정보(대학생)_20260722" },
      },
      "/other/v1/uddi:33333333-3333-4333-8333-333333333333": {
        get: { summary: "다른 데이터_20990101" },
      },
    },
  }), { headers: { "content-type": "application/json" } });
  try {
    assert.equal(
      await latestKosafEndpoint("university"),
      "https://api.odcloud.kr/api/15028252/v1/uddi:22222222-2222-4222-8222-222222222222",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
