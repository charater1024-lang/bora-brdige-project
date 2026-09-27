import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [home, mypage, controls, publicPages, startup, youth, legal, publicLayout, challenge, evaluationLayout, mypageLayout, sessionRoute, authStore] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/mypage/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/home-control-center.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/public-information-pages.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/startup-region-explorer.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/youth-policy-four-sections.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/legal-policy-page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/public-information-layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/challenge/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/developer/evaluation/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/mypage/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/session/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/auth/store.ts", import.meta.url), "utf8"),
]);

test("AI and account interactions are bounded and expose input limits", () => {
  assert.match(home, /AI_QUESTION_MAX_LENGTH = 24_000/u);
  assert.match(home, /maxLength=\{AI_QUESTION_MAX_LENGTH\}/u);
  assert.match(home, /id="ai-question-remaining" aria-live="polite"/u);
  assert.match(home, /fetchWithClientTimeout\("\/api\/ai"[\s\S]*AI_REQUEST_TIMEOUT_MS/u);
  assert.match(home, /window\.addEventListener\("focus", revalidate\)/u);
  assert.match(mypage, /fetchMyPageRequest<AccountLifecycleResponse>\("\/api\/account"/u);
  assert.match(mypage, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/u);
  assert.match(mypage, /session\.expiresAt[\s\S]*clearExpiredPrincipal/u);
  assert.match(sessionRoute, /expiresAt: user\.sessionExpiresAt/u);
  assert.match(authStore, /s\.expires_at AS sessionExpiresAt/u);
});

test("login dialog requests are consumed across remounts", () => {
  assert.match(controls, /useRef\(accountDialogRequest\)/u);
  assert.match(controls, /useRef\(layoutDialogRequest\)/u);
});

test("forms, pagination and catalog copy expose accessible UI state", () => {
  assert.match(home, /aria-label=\{securityT\.previewLabel\}/u);
  assert.match(publicPages, /displayPublicText\(item\.title\)/u);
  assert.match(publicPages, /ref=\{catalogResultsRef\}[\s\S]*tabIndex=\{-1\}[\s\S]*catalogFocusTarget/u);
  assert.match(publicPages, /toLocaleString\(localeTags\[locale\]\)/u);
  assert.match(publicLayout, /sessionPrincipalRef[\s\S]*window\.location\.reload\(\)/u);
  assert.match(publicLayout, /window\.addEventListener\("focus", refresh\)/u);
});

test("all-scope region selectors stay on a localized placeholder", () => {
  assert.match(startup, /value=\{selection\.mode === "region" \? selectedRegion : ""\}/u);
  assert.match(youth, /value=\{regionMode === "region" \? selectedRegion : ""\}/u);
  assert.match(startup, /mapRegionLabel\(locale, region\)/u);
  assert.match(youth, /mapRegionLabel\(locale, region\)/u);
});

test("visible labels and page metadata use consistent localized wording", () => {
  assert.match(publicLayout, /easy: "쉬운 모드"/u);
  assert.match(publicLayout, /privacy: "개인정보 처리방침"/u);
  assert.match(challenge, />개인정보 처리방침<\/Link>/u);
  assert.match(legal, /zh: "简体中文"/u);
  assert.match(evaluationLayout, /title: "자동평가 센터"/u);
  assert.match(mypageLayout, /title: "마이페이지"/u);
});
