import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const dailyGuide = readFileSync(new URL("../app/components/bora-daily-guide.tsx", import.meta.url), "utf8");
const floatingGuide = readFileSync(new URL("../app/components/bora-floating-guide.tsx", import.meta.url), "utf8");
const financeStatus = readFileSync(new URL("../app/components/home-finance-status.tsx", import.meta.url), "utf8");
const financeWorkbook = readFileSync(new URL("../app/components/personal-asset-workbook.tsx", import.meta.url), "utf8");
const publicLayout = readFileSync(new URL("../app/components/public-information-layout.tsx", import.meta.url), "utf8");
const publicStyles = readFileSync(new URL("../app/components/public-information-pages.module.css", import.meta.url), "utf8");

test("home follows one action, real money status, official data, then discovery", () => {
  const actionIndex = page.indexOf("<BoraDailyGuide");
  const moneyIndex = page.indexOf("<HomeFinanceStatus");
  const publicIndex = page.indexOf("<PublicDataOverview");
  const discoveryIndex = page.indexOf("<InformationShortcuts locale={locale} compact");

  assert.ok(actionIndex > 0);
  assert.ok(actionIndex < moneyIndex);
  assert.ok(moneyIndex < publicIndex);
  assert.ok(publicIndex < discoveryIndex);
  assert.match(page, /오늘 해야 할 금융 행동 하나부터/u);
  assert.doesNotMatch(page, /summary-grid home-widget/u);
  assert.doesNotMatch(page, /className="chart-empty-home"/u);
});

test("home money status uses only the authenticated saved snapshot", () => {
  assert.match(financeStatus, /fetch\("\/api\/finance\/snapshot"/u);
  assert.match(financeStatus, /snapshot \? manualFinanceSummary\(snapshot\.amounts\) : null/u);
  assert.match(financeStatus, /계좌번호 없이 금액만 입력/u);
  assert.match(financeStatus, /금융회사에서 확인한 잔액이 아닌/u);
  assert.match(financeStatus, /share\.toFixed\(1\).*%/su);
});

test("money status distinguishes sign-in, never-saved, consent, and genuine errors", () => {
  assert.match(financeStatus, /저장된 금융 상태를 확인하려면 로그인을 진행해 주세요/u);
  assert.match(financeStatus, /아직 한 번도 저장한 금융 정보가 없네요/u);
  assert.match(financeStatus, /response\.status === 401[^\n]+state: "signed-out"/u);
  assert.match(financeStatus, /response\.status === 428[^\n]+state: "consent-required"/u);
  assert.match(financeStatus, /state: snapshot \? "ready" : "empty"/u);
  assert.doesNotMatch(financeStatus, /manualFinanceSummary\(snapshot\.amounts\)\.completedFields > 0/u);
  assert.match(financeStatus, /sessionState === "checking"[\s\S]*sessionState === "unavailable"[\s\S]*sessionState === "signed-out"/u);
  assert.match(page, /useState<"checking" \| "signed-in" \| "signed-out" \| "unavailable">\("checking"\)/u);
  assert.match(page, /setSessionState\(nextState \?\? \(user \? "signed-in" : "signed-out"\)\)/u);
  assert.match(page, /setSessionUnavailable\(true\)/u);
  assert.match(page, /if \(!principalUserIdRef\.current\) setSessionState\("unavailable"\)/u);
  assert.doesNotMatch(page, /synchronizePrincipal\(null, "unavailable"\)/u);
  assert.match(financeWorkbook, /저장하려면 로그인을 진행해 주세요/u);
  assert.match(financeWorkbook, /아직 한 번도 저장한 금융 정보가 없네요/u);
});

test("daily guide presents one primary action and keeps the rest in a disclosure", () => {
  assert.match(dailyGuide, /className=\{styles\.primaryCard\}/u);
  assert.match(dailyGuide, /<details className=\{styles\.queue\}>/u);
  assert.match(dailyGuide, /queuedTasks\.length > 0 && !easyMode/u);
  assert.match(dailyGuide, /task\.id === "profile-setup"/u);
  assert.doesNotMatch(dailyGuide, /className="action-grid"/u);
});

test("the floating mascot never duplicates or auto-rotates the home guide", () => {
  assert.match(floatingGuide, /pathname === "\/"/u);
  assert.doesNotMatch(floatingGuide, /window\.setInterval/u);
  assert.match(floatingGuide, /setActiveIndex/u);
});

test("mobile navigation and public tools retain accessible names and focus", () => {
  assert.match(page, /id="primary-navigation"/u);
  assert.match(page, /aria-expanded=\{menuOpen\}/u);
  assert.match(page, /aria-controls="primary-navigation"/u);
  assert.match(page, /<nav className="mobile-bottom-nav"[\s\S]*?\{nav\.map/u);
  assert.match(globalStyles, /\.sidebar \{ width: 264px; visibility: hidden; pointer-events: none;/u);
  assert.match(globalStyles, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/u);
  assert.match(globalStyles, /summary:focus-visible/u);
  assert.match(globalStyles, /prefers-contrast: more/u);

  assert.match(publicLayout, /aria-label=\{t\.back\}/u);
  assert.match(publicLayout, /aria-label=\{t\.hub\}/u);
  assert.match(publicLayout, /bora-locale-change/u);
  assert.match(publicLayout, /<details className=\{styles\.accountMenu\}>/u);
  assert.match(publicLayout, /fetch\("\/api\/session"/u);
  const publicSessionFailure = publicLayout.match(/\.catch\(\(error: unknown\) => \{[\s\S]*?\n      \}\);/u)?.[0] ?? "";
  assert.match(publicSessionFailure, /setSessionState\("error"\)/u);
  assert.doesNotMatch(publicSessionFailure, /setSessionUser\(null\)/u);
  assert.match(publicLayout, /function retrySessionCheck\(\)[\s\S]*setSessionRetry\(\(current\) => current \+ 1\)/u);
  assert.match(publicLayout, /sessionState === "error" && <div className=\{styles\.sessionCheckError\} role="alert">/u);
  assert.match(publicLayout, /fetchAuthJson<unknown>\("\/api\/auth\/logout"/u);
  assert.match(publicLayout, /logoutError && <p role="alert">\{t\.signOutFailed\}<\/p>/u);
  assert.doesNotMatch(publicStyles, /\.backHome span, \.easyToggle span, \.myPageLink \{ display: none; \}/u);
  assert.match(publicStyles, /\.localePicker:focus-within/u);
  assert.match(publicStyles, /@media \(min-width: 681px\)[\s\S]*font-size: 12px/u);
  assert.match(publicStyles, /\.accountPopover > a, \.accountPopover > button \{[^}]*min-height: 44px/u);
  assert.match(publicStyles, /\.sessionCheckError button \{[^}]*min-height: 44px/u);
});

test("easy mode simplifies actions without hiding evidence or using danger for every CTA", () => {
  const easyHideRule = globalStyles.match(/\.easy-mode \.ai-brief-panel[^\n]+display: none; \}/u)?.[0] ?? "";
  assert.doesNotMatch(easyHideRule, /source-note|period-pill/u);
  assert.match(globalStyles, /\.easy-mode \.action-card button[^{]*\{[^}]*background: var\(--brand-deep\)/su);
  assert.match(globalStyles, /\.easy-mode \.danger-action button \{ background: var\(--danger\); \}/u);
});
