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
  detectFinancialLegalIntent,
  fetchFinancialLawGuidance,
  FinancialLawClientError,
  FinancialLawTopic,
  FINANCIAL_LAW_MANIFEST,
  formatFinancialLawContext,
} = await server.ssrLoadModule("/lib/legal/financial-law.ts");
test.after(() => server.close());

const SECRET_OC = "SECRET_OC_MUST_NOT_LEAK";

function listLaw(overrides = {}) {
  return {
    법령일련번호: "271923",
    현행연혁코드: "현행",
    법령명한글: FINANCIAL_LAW_MANIFEST[FinancialLawTopic.VoicePhishingRecovery].lawName,
    법령ID: "010101",
    공포일자: "20260102",
    공포번호: "제21001호",
    소관부처명: "금융위원회",
    시행일자: "20260701",
    법령상세링크: `/DRF/lawService.do?OC=${SECRET_OC}&MST=271923`,
    ...overrides,
  };
}

function listPayload(law) {
  return {
    LawSearch: {
      resultCode: "00",
      resultMsg: "success",
      totalCnt: Array.isArray(law) ? String(law.length) : "1",
      law,
    },
  };
}

function article(number, text, overrides = {}) {
  const [main, branch = ""] = String(number).split("의");
  return {
    조문키: `${main.padStart(4, "0")}${branch.padStart(2, "0") || "00"}`,
    조문번호: main,
    ...(branch ? { 조문가지번호: branch } : {}),
    조문제목: "공식 조문",
    조문시행일자: "20260701",
    조문내용: text,
    ...overrides,
  };
}

function servicePayload(lawName, units, effectiveDate = "20260701") {
  return {
    법령: {
      기본정보: {
        법령명_한글: lawName,
        법령ID: "010101",
        시행일자: effectiveDate,
        공포일자: "20260102",
        공포번호: "제21001호",
      },
      조문: { 조문단위: units },
    },
  };
}

function jsonResponse(payload, options = {}) {
  return new Response(JSON.stringify(payload), {
    status: options.status ?? 200,
    headers: { "content-type": options.contentType ?? "application/json; charset=utf-8" },
  });
}

test("financial-law manifest exposes six bounded topics and detects intent locally", () => {
  assert.deepEqual(Object.values(FinancialLawTopic), [
    "financial-consumer-protection",
    "electronic-finance",
    "credit-information",
    "voice-phishing-recovery",
    "depositor-protection",
    "fair-debt-collection",
  ]);
  assert.equal(
    detectFinancialLegalIntent("보이스피싱 피해 계좌의 지급정지와 피해환급을 알고 싶어요"),
    FinancialLawTopic.VoicePhishingRecovery,
  );
  assert.equal(
    detectFinancialLegalIntent("추심 전화와 불법추심 문제"),
    FinancialLawTopic.FairDebtCollection,
  );
  assert.equal(detectFinancialLegalIntent("오늘 날씨가 궁금합니다"), null);
  for (const topic of Object.values(FinancialLawTopic)) {
    assert.ok(FINANCIAL_LAW_MANIFEST[topic].lawName);
    assert.ok(FINANCIAL_LAW_MANIFEST[topic].preferredArticles.length > 0);
  }
});

test("client uses only the exact manifest law name, validates the current match, and returns public citations without OC", async () => {
  const topic = FinancialLawTopic.VoicePhishingRecovery;
  const exactName = FINANCIAL_LAW_MANIFEST[topic].lawName;
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    assert.equal(url.origin, "https://www.law.go.kr");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.headers?.Accept, "application/json");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(url.searchParams.get("OC"), SECRET_OC);
    assert.equal(url.searchParams.get("target"), "eflaw");
    assert.equal(url.searchParams.get("type"), "JSON");

    if (url.pathname === "/DRF/lawSearch.do") {
      assert.equal(url.searchParams.get("query"), exactName);
      assert.equal(url.searchParams.get("search"), "1");
      assert.equal(url.searchParams.get("nw"), "3");
      return jsonResponse(listPayload([
        listLaw({ 법령명한글: `${exactName} 시행령` }),
        listLaw({ 현행연혁코드: "연혁" }),
        listLaw(),
      ]));
    }
    assert.equal(url.pathname, "/DRF/lawService.do");
    assert.equal(url.searchParams.has("query"), false);
    assert.equal(url.searchParams.get("MST"), "271923");
    assert.equal(url.searchParams.get("efYd"), "20260701");
    return jsonResponse(servicePayload(exactName, [
      {
        조문여부: { "#text": " 전문 " },
        조문번호: "1",
        조문제목: "법률 전문 헤더",
      },
      article("3", "피해구제의 신청에 관한 공식 조문"),
      article("4", "사기이용계좌의 지급정지에 관한 공식 조문", {
        항: [
          { 항번호: "①", 항내용: "금융회사는 법률에 정한 절차를 따른다." },
          { 항번호: "②", 항내용: "지급정지 관련 공식 내용" },
        ],
      }),
      article("99", "주제와 관련 없는 부칙성 내용"),
    ]));
  };

  const result = await fetchFinancialLawGuidance({ oc: SECRET_OC, topic, fetchImpl });
  assert.equal(calls.length, 2);
  assert.equal(result.status, "official-current");
  assert.equal(result.law.lawName, exactName);
  assert.equal(result.law.mst, "271923");
  assert.equal(result.law.effectiveDate, "20260701");
  assert.deepEqual(result.articles.map((item) => item.articleNumber), ["3", "4"]);
  assert.match(result.articles[1].text, /지급정지 관련 공식 내용/u);
  assert.match(result.law.sourceUrl, /^https:\/\/www\.law\.go\.kr\/법령\//u);
  assert.match(result.articles[0].sourceUrl, /\/제3조$/u);

  const serialized = JSON.stringify(result);
  const context = formatFinancialLawContext(result);
  assert.doesNotMatch(serialized, /SECRET_OC_MUST_NOT_LEAK/u);
  assert.doesNotMatch(context, /SECRET_OC_MUST_NOT_LEAK/u);
  assert.doesNotMatch(serialized, /\/DRF\/|lawSearch\.do|lawService\.do/u);
  assert.match(context, /\[law-go-kr:010101:000300:20260701\]/u);
  assert.match(context, /effective_date: 20260701/u);
  assert.ok(new TextEncoder().encode(context).byteLength <= 4_000);
});

test("singleton list, article, and nested paragraph objects are normalized", async () => {
  const topic = FinancialLawTopic.FinancialConsumerProtection;
  const lawName = FINANCIAL_LAW_MANIFEST[topic].lawName;
  const singletonLaw = listLaw({
    법령명한글: lawName,
    법령ID: "014101",
    법령일련번호: "281111",
  });
  let request = 0;
  const result = await fetchFinancialLawGuidance({
    oc: SECRET_OC,
    topic,
    fetchImpl: async () => {
      request += 1;
      if (request === 1) return jsonResponse(listPayload(singletonLaw));
      return jsonResponse(servicePayload(lawName, article("19", "설명의무에 관한 공식 조문", {
        항: { 항번호: "①", 항내용: "금융상품에 관한 중요 사항의 공식 조문 내용" },
      })));
    },
  });

  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].articleNumber, "19");
  assert.match(result.articles[0].text, /중요 사항의 공식 조문 내용/u);
});

test("official preamble/header variants are skipped while malformed real articles remain strict", async () => {
  const topic = FinancialLawTopic.FairDebtCollection;
  const lawName = FINANCIAL_LAW_MANIFEST[topic].lawName;
  let calls = 0;
  const result = await fetchFinancialLawGuidance({
    oc: SECRET_OC,
    topic,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return jsonResponse(listPayload(listLaw({ 법령명한글: lawName })));
      return jsonResponse(servicePayload(lawName, [
        { 조문여부: "전문", 조문번호: "1" },
        { 조문제목: { value: "전문" }, 조문번호: "1" },
        article("9", "폭행 또는 협박을 금지하는 공식 채권추심 조문"),
      ]));
    },
  });
  assert.deepEqual(result.articles.map((item) => item.articleNumber), ["9"]);

  calls = 0;
  await assert.rejects(
    fetchFinancialLawGuidance({
      oc: SECRET_OC,
      topic,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return jsonResponse(listPayload(listLaw({ 법령명한글: lawName })));
        return jsonResponse(servicePayload(lawName, [
          { 조문여부: "조문", 조문번호: "9", 조문키: "000900" },
          article("10", "채권추심 관련 공식 조문"),
        ]));
      },
    }),
    (error) => error.code === "financial_law_article_shape_invalid",
  );
});

test("formatted official-law context is capped at 4,000 UTF-8 bytes in total", () => {
  const topic = FinancialLawTopic.FinancialConsumerProtection;
  const lawName = FINANCIAL_LAW_MANIFEST[topic].lawName;
  const guidance = {
    status: "official-current",
    topic,
    topicLabel: "금융상품 소비자보호",
    publisher: "국가법령정보센터",
    law: {
      lawId: "014101",
      mst: "281111",
      lawName,
      promulgationDate: "20260102",
      promulgationNumber: "제21001호",
      effectiveDate: "20260701",
      ministry: "금융위원회",
      retrievedAt: "2026-07-24T00:00:00.000Z",
      sourceUrl: `https://www.law.go.kr/법령/${lawName}`,
    },
    articles: ["17", "18", "19", "21", "46", "47"].map((number) => ({
      sourceId: `law-go-kr:014101:${number.padStart(4, "0")}00:20260701`,
      articleKey: `${number.padStart(4, "0")}00`,
      articleNumber: number,
      articleTitle: "공식 조문 제목",
      text: `제${number}조 공식 조문 ${"가나다라마바사아자차카타파하".repeat(2_000)}`,
      effectiveDate: "20260701",
      sourceUrl: `https://www.law.go.kr/법령/${lawName}/제${number}조`,
    })),
  };
  const context = formatFinancialLawContext(guidance);
  assert.ok(new TextEncoder().encode(context).byteLength <= 4_000);
  assert.match(context, /\[law-go-kr:014101:001700:20260701\]/u);
  assert.match(context, /\[law-go-kr:014101:004700:20260701\]/u);
  assert.doesNotMatch(context, /SECRET_OC_MUST_NOT_LEAK/u);
});

test("an exact but historical result and a current partial-name result fail closed", async () => {
  const topic = FinancialLawTopic.DepositorProtection;
  const lawName = FINANCIAL_LAW_MANIFEST[topic].lawName;
  let calls = 0;
  await assert.rejects(
    fetchFinancialLawGuidance({
      oc: SECRET_OC,
      topic,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(listPayload([
          listLaw({ 법령명한글: lawName, 현행연혁코드: "연혁" }),
          listLaw({ 법령명한글: `${lawName} 시행령`, 현행연혁코드: "현행" }),
        ]));
      },
    }),
    (error) => (
      error instanceof FinancialLawClientError
      && error.code === "financial_law_current_match_missing"
      && !JSON.stringify(error).includes(SECRET_OC)
    ),
  );
  assert.equal(calls, 1);
});

test("redirect failures, non-JSON, malformed shapes, API errors, and oversized bodies fail closed without key leakage", async (t) => {
  const topic = FinancialLawTopic.ElectronicFinance;

  await t.test("redirect/network rejection is sanitized", async () => {
    await assert.rejects(
      fetchFinancialLawGuidance({
        oc: SECRET_OC,
        topic,
        fetchImpl: async (_input, init) => {
          assert.equal(init?.redirect, "manual");
          throw new TypeError(`redirect rejected for ${SECRET_OC}`);
        },
      }),
      (error) => (
        error.code === "financial_law_network_error"
        && !error.message.includes(SECRET_OC)
        && !JSON.stringify(error).includes(SECRET_OC)
      ),
    );
  });

  await t.test("non-JSON response is rejected", async () => {
    await assert.rejects(
      fetchFinancialLawGuidance({
        oc: SECRET_OC,
        topic,
        fetchImpl: async () => new Response("<html>error</html>", {
          headers: { "content-type": "text/html" },
        }),
      }),
      (error) => error.code === "financial_law_non_json_response",
    );
  });

  await t.test("malformed successful JSON is rejected", async () => {
    await assert.rejects(
      fetchFinancialLawGuidance({
        oc: SECRET_OC,
        topic,
        fetchImpl: async () => jsonResponse({ unexpected: true }),
      }),
      (error) => error.code === "financial_law_search_shape_invalid",
    );
  });

  await t.test("upstream resultCode is rejected", async () => {
    await assert.rejects(
      fetchFinancialLawGuidance({
        oc: SECRET_OC,
        topic,
        fetchImpl: async () => jsonResponse({
          LawSearch: { resultCode: "99", resultMsg: SECRET_OC, law: [] },
        }),
      }),
      (error) => (
        error.code === "financial_law_search_rejected"
        && !error.message.includes(SECRET_OC)
      ),
    );
  });

  await t.test("HTTP errors are mapped to a fixed safe code", async () => {
    await assert.rejects(
      fetchFinancialLawGuidance({
        oc: SECRET_OC,
        topic,
        fetchImpl: async () => new Response(SECRET_OC, { status: 500 }),
      }),
      (error) => (
        error.code === "financial_law_upstream_http_error"
        && !error.message.includes(SECRET_OC)
      ),
    );
  });

  await t.test("declared oversized responses are rejected before buffering", async () => {
    await assert.rejects(
      fetchFinancialLawGuidance({
        oc: SECRET_OC,
        topic,
        fetchImpl: async () => new Response("{}", {
          headers: {
            "content-type": "application/json",
            "content-length": "5000001",
          },
        }),
      }),
      (error) => error.code === "financial_law_response_too_large",
    );
  });
});

test("body version and shape mismatches never return partial legal guidance", async (t) => {
  const topic = FinancialLawTopic.CreditInformation;
  const lawName = FINANCIAL_LAW_MANIFEST[topic].lawName;

  async function rejectsBody(body, expectedCode) {
    let calls = 0;
    await assert.rejects(
      fetchFinancialLawGuidance({
        oc: SECRET_OC,
        topic,
        fetchImpl: async () => {
          calls += 1;
          return calls === 1
            ? jsonResponse(listPayload(listLaw({ 법령명한글: lawName })))
            : jsonResponse(body);
        },
      }),
      (error) => error.code === expectedCode,
    );
    assert.equal(calls, 2);
  }

  await t.test("effective-date mismatch", () => rejectsBody(
    servicePayload(lawName, article("32", "개인신용정보 동의 관련 조문"), "20260702"),
    "financial_law_service_version_mismatch",
  ));
  await t.test("missing law container", () => rejectsBody(
    { 법령: { 기본정보: {} } },
    "financial_law_service_shape_invalid",
  ));
  await t.test("no relevant article", () => rejectsBody(
    servicePayload(lawName, article("99", "무관한 부칙 내용")),
    "financial_law_relevant_articles_missing",
  ));
});
