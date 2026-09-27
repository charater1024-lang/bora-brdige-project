import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [home, controls, mypage, publicPages, workbook] = await Promise.all([
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/home-control-center.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/mypage/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/public-information-pages.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/personal-asset-workbook.tsx", import.meta.url), "utf8"),
]);

test("the home shell is the single session source and transient failure preserves a known principal", () => {
  assert.equal((home.match(/fetch\("\/api\/session"/gu) ?? []).length, 1);
  assert.equal((controls.match(/fetch\("\/api\/session"/gu) ?? []).length, 0);
  assert.match(home, /controlledSession=\{sessionSnapshot\}/u);
  assert.match(home, /requestId !== sessionRequestSequenceRef\.current/u);
  assert.match(home, /sessionRequestAbortRef\.current\?\.abort\(\)/u);
  assert.match(home, /HOME_SESSION_REQUEST_TIMEOUT_MS = 12_000/u);
  assert.match(home, /timedOut = true;\s*controller\.abort\(\);/u);
  assert.match(home, /controller\.signal\.aborted && !timedOut/u);
  assert.match(home, /window\.clearTimeout\(timeoutId\)/u);
  assert.match(home, /if \(!principalUserIdRef\.current\) setSessionState\("unavailable"\)/u);
  assert.doesNotMatch(home, /synchronizePrincipal\(null, "unavailable"\)/u);
  assert.match(controls, /controlledSessionUnavailable[\s\S]*onSessionRetry/u);
  assert.match(home, /sessionExpiryInstant\(sessionSnapshot\?\.expiresAt\)/u);
  assert.match(home, /expiresAt - Date\.now\(\)[\s\S]*clearExpiredHomePrincipal\(\)/u);
  assert.match(home, /clearExpiredHomePrincipal[\s\S]*synchronizePrincipal\(null, "signed-out"\)/u);
  assert.match(home, /key=\{`home-finance-\$\{currentUser\?\.id \?\? "signed-out"\}`\}/u);
  assert.match(home, /key=\{`personal-assets-\$\{currentUser\?\.id \?\? "signed-out"\}`\}/u);
});

test("my page exposes recoverable session and logout failures", () => {
  assert.match(mypage, /useState<"loading" \| "ready" \| "error">\("loading"\)/u);
  assert.match(mypage, /MY_PAGE_REQUEST_TIMEOUT_MS = 12_000/u);
  assert.match(mypage, /setSessionFailure\(timedOut \? "timeout" : "request"\)/u);
  assert.match(mypage, /setSessionStatus\("error"\)/u);
  assert.match(mypage, /setSessionRetry\(\(current\) => current \+ 1\)/u);
  assert.match(mypage, /logoutAbortRef\.current\?\.abort\(\)/u);
  assert.match(mypage, /signal: controller\.signal[\s\S]*logout_timeout/u);
  assert.match(mypage, /setLogoutFailure\(timedOut \? "timeout" : "request"\)[\s\S]*setLogoutPending\(false\)/u);
  assert.match(mypage, /로그아웃 요청 시간이 초과되었습니다/u);
  assert.match(mypage, /마이페이지를 다시 열어 로그인 상태를 확인/u);
  assert.match(mypage, /localLogoutCompleted\(response, data\)/u);
});

test("public dashboards retry only bounded transient failures and remain cancellable", () => {
  assert.match(publicPages, /PUBLIC_DASHBOARD_RETRY_DELAYS_MS = \[750, 2_000\] as const/u);
  assert.match(publicPages, /PUBLIC_DASHBOARD_REQUEST_TIMEOUT_MS = 10_000/u);
  assert.match(publicPages, /const requestController = new AbortController\(\)/u);
  assert.match(publicPages, /lifecycleController\.signal\.addEventListener\("abort", cancelForUnmount/u);
  assert.match(publicPages, /timedOut \|\| !\(error instanceof PublicDashboardRequestError\) \|\| error\.retryable/u);
  assert.match(publicPages, /response\.status === 408 \|\| response\.status === 425 \|\| response\.status >= 500/u);
  assert.match(publicPages, /if \(!retryable \|\| delay === undefined\) throw error/u);
  assert.match(publicPages, /waitForPublicDashboardRetry\(delay, lifecycleController\.signal\)/u);
  assert.match(publicPages, /return \(\) => lifecycleController\.abort\(\)/u);
  assert.match(publicPages, /if \(!recorded\) window\.sessionStorage\.removeItem\(key\)/u);
  assert.match(publicPages, /retry: \(\) => setRetryGeneration\(\(current\) => current \+ 1\)/u);
  assert.match(publicPages, /<DashboardFailure locale=\{locale\} onRetry=\{retry\}/u);
});

test("product comparison ignores superseded responses and pagination restores context", () => {
  assert.match(publicPages, /recommendationRequestRef\.current = requestId/u);
  assert.match(publicPages, /recommendationAbortRef\.current\?\.abort\(\)/u);
  assert.match(publicPages, /PRODUCT_RECOMMENDATION_REQUEST_TIMEOUT_MS = 12_000/u);
  assert.match(publicPages, /setRecommendationFailure\(timedOut \? "request_timeout"/u);
  assert.match(publicPages, /recommendationState === "failed" \? t\.retry : t\.compare/u);
  assert.match(publicPages, /signal: controller\.signal/u);
  assert.match(publicPages, /\(controller\.signal\.aborted && !timedOut\) \|\| requestId !== recommendationRequestRef\.current/u);
  assert.match(publicPages, /function resetComparison\(\)[\s\S]*recommendationRequestRef\.current \+= 1[\s\S]*abort/u);
  assert.match(publicPages, /catalogResultsRef\.current[\s\S]*scrollIntoView[\s\S]*focus/u);
  // Product catalogue pages now share the outer catalogue focus target rather
  // than maintaining an independent, overlapping client-side product pager.
  assert.doesNotMatch(publicPages, /productListStartRef|FINANCE_PRODUCT_PAGE_SIZE|safeProductPage/u);
  assert.match(publicPages, /function openCatalogPage\(nextPage: number\)[\s\S]*pendingCatalogFocusRef\.current = true;[\s\S]*updateCategoryQuery/u);
  assert.match(publicPages, /ref=\{catalogResultsRef\}[\s\S]*tabIndex=\{-1\}/u);
  assert.match(publicPages, /recommendationListRef\.current[\s\S]*scrollIntoView[\s\S]*focus/u);
});

test("the personal workbook times out snapshot operations without losing retry recovery", () => {
  assert.match(workbook, /FINANCE_SNAPSHOT_REQUEST_TIMEOUT_MS = 12_000/u);
  assert.ok((workbook.match(/timedOut = true;\s*controller\.abort\(\);/gu) ?? []).length >= 3);
  assert.match(workbook, /snapshot_load_timeout/u);
  assert.match(workbook, /snapshot_save_timeout/u);
  assert.match(workbook, /snapshot_delete_timeout/u);
  assert.match(workbook, /controller\.signal\.aborted && !timedOut/u);
  assert.match(workbook, /loadRequestRef\.current \+= 1;\s*saveRequestRef\.current \+= 1;/u);
  assert.match(workbook, /authState === "unavailable"[\s\S]*loadSnapshot\(principal\)[\s\S]*onSessionRetry\(\)/u);
  assert.match(workbook, /authState === "signed-in" && saveError[\s\S]*saveSnapshot\(\)/u);
});

test("the goal simulator accepts grouped won and manwon input while keeping canonical won", () => {
  assert.match(home, /useState<ManualMoneyUnit>\("won"\)/u);
  assert.match(home, /normalizeManualMoneyInput\(value, goalAmountUnit\)/u);
  assert.match(home, /canonicalWonFromMoneyInput\(normalized, goalAmountUnit\)/u);
  assert.match(home, /formatCanonicalWonInput\(goalAmount, nextUnit\)/u);
  assert.match(home, /<option value="won">\{t\.wonUnit\}<\/option><option value="manwon">\{t\.manwonUnit\}<\/option>/u);
  assert.match(home, /pattern="\[0-9,.\]\*"/u);
});
