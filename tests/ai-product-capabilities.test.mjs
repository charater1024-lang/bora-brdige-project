import assert from "node:assert/strict";
import test from "node:test";

import {
  productCapabilitiesReply,
  productCapabilitiesRequested,
} from "../lib/ai/product-capabilities.ts";

test("product capability intent covers the observed request, greetings, and four UI languages", () => {
  for (const query of [
    "안녕하세요. 오늘 이용할 수 있는 기능을 간단히 알려줘.",
    "안녕하세요",
    "Hello, what can you do?",
    "What services can I use?",
    "How does BORA work?",
    "BORA에서 환율 기능은 어떻게 써?",
    "BORA에서 피싱 점검 기능은 어떻게 써?",
    "どんな機能が使えますか？",
    "何ができますか？",
    "有哪些功能可以使用？",
    "你能做什么？",
  ]) {
    assert.equal(productCapabilitiesRequested(query), true, query);
  }
});

test("greetings do not divert real financial, legal, policy, or phishing questions", () => {
  for (const query of [
    "안녕하세요. 현재 예금 금리가 얼마인지 알려줘.",
    "안녕하세요. 보이스피싱 피해구제 법률을 설명해줘.",
    "서울 청년 정책 신청 조건을 알려줘.",
    "Hello, what is the current exchange rate?",
    "こんにちは。預金金利を教えてください。",
    "您好，请告诉我当前贷款利率。",
    "서울에서 이용할 수 있는 서비스 알려줘.",
    "청년이 이용할 수 있는 서비스가 뭐야?",
    "서울 청년이 이용할 수 있는 금융지원 서비스 알려줘.",
    "외국인이 이용할 수 있는 정착 서비스 알려줘.",
    "고용24에서 이용할 수 있는 서비스 알려줘.",
    "청년이 신청 가능한 서비스가 있어?",
    "What services can I use in Seoul?",
    "What support services can a foreigner use?",
    "外国人が利用できるサービスを教えてください。",
    "请告诉我外国人可以使用的服务。",
    `${"기능을 알려줘. ".repeat(80)}현재 예금 금리가 얼마야?`,
  ]) {
    assert.equal(productCapabilitiesRequested(query), false, query);
  }
});

test("fixed capability replies are localized, bounded, and describe only product features", () => {
  const expected = {
    ko: [/자산·현금흐름/u, /안전 점검/u, /기회 탐색/u, /환율/u, /근거 기반 AI/u, /주요 메뉴/u],
    en: [/Assets & cash flow/u, /Safety check/u, /Opportunity search/u, /Exchange rates/u, /Evidence-based AI/u, /main menu/u],
    ja: [/資産・キャッシュフロー/u, /安全チェック/u, /機会を探す/u, /為替/u, /根拠ベースAI/u, /メインメニュー/u],
    zh: [/资产与现金流/u, /安全检查/u, /机会查询/u, /汇率/u, /依据型AI/u, /主菜单/u],
  };
  for (const [locale, patterns] of Object.entries(expected)) {
    const reply = productCapabilitiesReply(locale);
    assert.ok(reply.length > 100 && reply.length < 1_600, locale);
    for (const pattern of patterns) assert.match(reply, pattern, locale);
    assert.doesNotMatch(reply, /\[(?:S\d+|public:|law-go-kr:)/u, locale);
  }
});
