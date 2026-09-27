import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { legalContactMailto, normalizeLegalContactEmail } from "../lib/legal/contact.ts";

const [privacyPage, termsPage, policyPage, styles, lifecycle, consentPolicy, aiRoute, floatingGuide] = await Promise.all([
  readFile(new URL("../app/privacy/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/terms/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/legal-policy-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/legal-policy-page.module.css", import.meta.url), "utf8"),
  readFile(new URL("../lib/auth/account-lifecycle.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/auth/consent-policy.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/ai/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/bora-floating-guide.tsx", import.meta.url), "utf8"),
]);

test("privacy and terms are public App Router pages with canonical metadata", () => {
  assert.match(privacyPage, /kind="privacy"/u);
  assert.match(privacyPage, /canonical: "\/privacy"/u);
  assert.match(termsPage, /kind="terms"/u);
  assert.match(termsPage, /canonical: "\/terms"/u);

  for (const page of [privacyPage, termsPage]) {
    assert.doesNotMatch(page, /authenticatedUser|requireChatGPTUser|redirect\(/u);
    assert.match(page, /legalPolicyLocale\(params\.lang\)/u);
  }
});

test("legal pages expose four languages and accessible account navigation", () => {
  for (const locale of ["ko", "en", "ja", "zh"]) {
    assert.match(policyPage, new RegExp(`${locale}: \\{`, "u"));
  }
  for (const label of ["한국어", "English", "日本語", "中文"]) {
    assert.match(policyPage, new RegExp(label, "u"));
  }
  assert.match(policyPage, /className=\{styles\.skipLink\} href="#policy-content"/u);
  assert.match(policyPage, /<main id="policy-content"/u);
  assert.match(policyPage, /lang=\{locale\}/u);
  assert.match(policyPage, /aria-current=\{locale === code \? "page"/u);
  assert.match(policyPage, /href="\/mypage"/u);
  assert.match(policyPage, /href="\/" aria-label=\{shared\.home\}/u);
  assert.match(policyPage, /href=\{`\/privacy\?lang=\$\{locale\}`\}/u);
  assert.match(policyPage, /href=\{`\/terms\?lang=\$\{locale\}`\}/u);
});

test("privacy disclosures match account storage and Local AI boundaries", () => {
  assert.match(policyPage, /CURRENT_PRIVACY_VERSION/u);
  assert.match(policyPage, /CURRENT_TERMS_VERSION/u);
  assert.match(consentPolicy, /CURRENT_PRIVACY_VERSION = "2026-08-08-v1"/u);
  assert.match(consentPolicy, /CURRENT_TERMS_VERSION = "2026-08-08-v1"/u);
  assert.match(lifecycle, /from "\.\/consent-policy"/u);

  for (const requiredDisclosure of [
    "네이버·카카오 로그인",
    "AI 맥락은 기본 OFF",
    "최대 6건, 최대 30일",
    "최대 40건, 최대 30일",
    "외부 유료 AI에는 전달하지 않습니다",
    "마이데이터 미사용",
    "계정 전체 삭제",
    "CONTACT_EMAIL",
  ]) {
    assert.match(policyPage, new RegExp(requiredDisclosure, "u"));
  }

  assert.match(aiRoute, /const personalContextAllowed = selected\.provider === "local"/u);
  assert.match(policyPage, /Saved personal memory, recent chats, recent activity, and the manual finance snapshot are used only with Local AI/u);
  assert.match(policyPage, /MyData connection/u);
  assert.match(policyPage, /マイデータ未連携/u);
  assert.match(policyPage, /未连接MyData/u);
});

test("public legal contact uses runtime configuration and rejects unsafe or placeholder mail links", () => {
  assert.match(policyPage, /environmentValue\("LEGAL_CONTACT_EMAIL"\)/u);
  assert.match(policyPage, /href=\{legalContactMailto\(contactEmail\)\}/u);
  assert.equal(normalizeLegalContactEmail(" contact@borabridge.com "), "contact@borabridge.com");
  assert.equal(legalContactMailto("ops#support@borabridge.com"), "mailto:ops%23support@borabridge.com");
  assert.equal(legalContactMailto("ops%0d%0a@borabridge.com"), "mailto:ops%250d%250a@borabridge.com");
  assert.equal(legalContactMailto("ops?subject@borabridge.com"), "mailto:ops%3Fsubject@borabridge.com");
  for (const invalid of [undefined, "", "privacy@example.invalid", "privacy@example.com", "someone@example.test", "mailto:contact@borabridge.com", "a@b.com?subject=bad", "a@b.com\r\nBcc:other@b.com", "<a@b.com>"]) {
    assert.equal(normalizeLegalContactEmail(invalid), null);
  }
});

test("rendered legal pages use the configured contact in every locale and never render an unset mail link", async (context) => {
  const previous = process.env.LEGAL_CONTACT_EMAIL;
  context.after(() => {
    if (previous === undefined) delete process.env.LEGAL_CONTACT_EMAIL;
    else process.env.LEGAL_CONTACT_EMAIL = previous;
  });
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url));
  const render = async (path) => {
    const response = await worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    }, { waitUntil() {}, passThroughOnException() {} });
    assert.equal(response.status, 200);
    return response.text();
  };
  process.env.LEGAL_CONTACT_EMAIL = "ops#support@borabridge.com";
  for (const kind of ["privacy", "terms"]) {
    for (const locale of ["ko", "en", "ja", "zh"]) {
      const html = await render(`/${kind}?lang=${locale}`);
      assert.ok(html.includes('href="mailto:ops%23support@borabridge.com"'));
      assert.ok(html.includes("ops#support@borabridge.com"));
      assert.ok(!html.includes("{{CONTACT_EMAIL}}"));
    }
  }
  delete process.env.LEGAL_CONTACT_EMAIL;
  const unset = await render("/privacy");
  assert.ok(unset.includes("운영자 문의 이메일 준비 중"));
  assert.ok(!unset.includes('href="mailto:'));
});

test("terms disclose the informational boundary in every locale", () => {
  for (const phrase of [
    "전문 자문 아님",
    "Not professional advice",
    "専門助言ではありません",
    "非专业建议",
    "공식 원문 재확인",
    "Recheck official sources",
  ]) {
    assert.match(policyPage, new RegExp(phrase, "u"));
  }
  assert.match(policyPage, /AI 기억·최근 대화·최근 활동은 기본 OFF/u);
  assert.match(policyPage, /마이데이터 연결 없이/u);
});

test("optional Safe Browsing disclosure covers provider use and sharing in every locale", () => {
  for (const phrase of [
    "Google은 제출된 URL과 관련 데이터를",
    "Safe Browsing 약관에 따라 사용하거나 공유할 수 있습니다",
    "Google may use the submitted URL and associated data",
    "may share data as permitted by its policies and Safe Browsing terms",
    "Googleは、提出されたURLと関連データ",
    "使用し、またはデータを共有することがあります",
    "Google可能依照其政策及Safe Browsing条款使用所提交的网址和相关数据",
    "也可能在条款允许的范围内共享数据",
  ]) {
    assert.match(policyPage, new RegExp(phrase, "u"));
  }
});

test("legal layout is responsive and preserves keyboard and print usability", () => {
  assert.match(styles, /\.skipLink:focus/u);
  assert.match(styles, /scroll-margin-top/u);
  assert.match(styles, /@media \(max-width: 900px\)/u);
  assert.match(styles, /@media \(max-width: 640px\)/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(styles, /@media print/u);
  assert.doesNotMatch(styles, /font-size:\s*[0-9](?:px|rem)/u, "body copy must not use unreadably tiny single-digit sizes");
  assert.match(floatingGuide, /pathname === "\/privacy" \|\| pathname === "\/terms"/u);
  assert.match(floatingGuide, /pathname === "\/challenge" \|\| pathname\.startsWith\("\/challenge\/"\)/u);
  assert.match(floatingGuide, /\|\| isPolicyPage \|\| isJudgePage\) return null/u);
});
