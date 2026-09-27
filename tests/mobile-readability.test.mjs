import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const page = read("../app/page.tsx");
const globalStyles = read("../app/globals.css");
const floatingGuide = read("../app/components/bora-floating-guide.tsx");
const floatingGuideStyles = read("../app/components/bora-floating-guide.module.css");
const publicLayout = read("../app/components/public-information-layout.tsx");
const publicStyles = read("../app/components/public-information-pages.module.css");
const publicPages = read("../app/components/public-information-pages.tsx");
const startupRegionStyles = read("../app/components/startup-region-explorer.module.css");
const youthSectionStyles = read("../app/components/youth-policy-four-sections.module.css");
const settlement = read("../app/components/foreign-settlement-copilot.tsx");
const settlementStyles = read("../app/components/foreign-settlement-copilot.module.css");
const developerStyles = read("../app/developer/developer.module.css");
const challengePage = read("../app/challenge/page.tsx");
const challengeLayout = read("../app/challenge/layout.tsx");
const challengeStyles = read("../app/challenge/challenge.module.css");
const legalPolicy = read("../app/components/legal-policy-page.tsx");
const commercialSearch = read("../app/components/commercial-store-search.tsx");
const commercialSearchStyles = read("../app/components/commercial-store-search.module.css");
const assetWorkbookStyles = read("../app/components/personal-asset-workbook.module.css");
const publicDataOverview = read("../app/components/public-data-overview.tsx");
const publicDataOverviewStyles = read("../app/components/public-data-overview.module.css");

test("mobile dashboard keeps a dynamic viewport, readable form controls, and safe navigation", () => {
  assert.match(globalStyles, /\.app-shell \{[^}]*min-height: 100dvh/u);
  assert.match(globalStyles, /\.workspace \{[^}]*min-height: 100dvh/u);
  assert.match(globalStyles, /\.workspace > footer/u);
  assert.match(globalStyles, /@media \(max-width: 640px\)[\s\S]*?\.main-content input,[\s\S]*?font-size: 16px/u);
  assert.match(globalStyles, /\.mobile-bottom-nav \{[^}]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/u);
  assert.match(globalStyles, /\.language-picker select \{[^}]*min-height: 44px/u);
  assert.match(globalStyles, /\.easy-mode \.topbar button \{ min-height: 44px; height: 44px; \}/u);
  assert.match(globalStyles, /@media \(max-width: 380px\)[\s\S]*?\.easy-toggle \{ width: 60px/u);
  assert.match(globalStyles, /\.easy-toggle \.easy-state \{ display: inline-block/u);
  assert.match(page, /aria-label=\{`\$\{t\.easyMode\} \$\{easyMode \? a11yT\.stateOn : a11yT\.stateOff\}/u);
  assert.match(page, /<main id="main-content" className="main-content" tabIndex=\{-1\}>/u);
  assert.match(page, /nav\.map\(\(\{id,label,icon:Icon\}\)/u);
});

test("the mobile drawer traps focus, closes with Escape, and restores focus", () => {
  assert.match(page, /const menuButtonRef = useRef<HTMLButtonElement>\(null\)/u);
  assert.match(page, /const sidebarRef = useRef<HTMLElement>\(null\)/u);
  assert.match(page, /workspace\?\.setAttribute\("inert", ""\)/u);
  assert.match(page, /event\.key === "Escape"/u);
  assert.match(page, /menuTrigger\?\.focus\(\)/u);
});

test("the floating guide starts compact on phones and clears bottom navigation", () => {
  assert.match(floatingGuide, /matchMedia\("\(max-width: 640px\)"\)/u);
  assert.match(floatingGuide, /dispatchVisibility\(\{ type: "viewport", mobile: mobileQuery\.matches \}\)/u);
  assert.match(floatingGuide, /mobileDefaultClosed/u);
  assert.match(floatingGuide, /hasBottomNavigation/u);
  assert.match(floatingGuideStyles, /z-index: 34/u);
  assert.match(floatingGuideStyles, /\.withBottomNavigation \{/u);
  assert.match(floatingGuide, /aria-controls=\{messageId\}/u);
  assert.match(floatingGuide, /isFormOrConsentTarget/u);
  assert.match(floatingGuide, /setInteractionSafe\(true\)[\s\S]*dispatchVisibility\(\{ type: "focus" \}\)/u);
  assert.match(floatingGuideStyles, /\.interactionSafe\.collapsed \.mascotButton/u);
  assert.match(globalStyles, /\.view-safety \.main-content,[\s\S]*?padding-bottom: calc\(180px/u);
});

test("motion preferences and user-facing evidence labels avoid implementation jargon", () => {
  assert.match(page, /function preferredScrollBehavior\(\): ScrollBehavior/u);
  assert.match(page, /prefers-reduced-motion: reduce/u);
  assert.match(page, /scrollIntoView\(\{ behavior: preferredScrollBehavior\(\)/u);
  assert.match(page, /opportunitySearch: "AI로 맞춤 기회 찾기"/u);
  assert.doesNotMatch(page, />RAG Search</u);
  assert.doesNotMatch(page, /BORA AI · RAG/u);
});

test("public information navigation remains discoverable and readable on narrow screens", () => {
  assert.match(publicLayout, /const reduceMotion = window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/u);
  assert.match(publicLayout, /scrollIntoView\(\{ behavior: reduceMotion \? "auto" : "smooth", block: "nearest", inline: "center" \}\)/u);
  assert.match(publicStyles, /scroll-snap-type: x proximity/u);
  assert.match(publicStyles, /@media \(max-width: 680px\)[\s\S]*?\.localePicker select \{[^}]*font-size: 16px/u);
  assert.match(publicStyles, /@media \(max-width: 680px\)[\s\S]*?\.portalNav a \{[^}]*min-height: 48px[^}]*font-size: 13px/u);
  assert.match(publicPages, /const MOBILE_CATEGORY_PAGE_SIZE = 12/u);
  assert.match(publicPages, /matchMedia\(COMPACT_CATALOG_QUERY\)\.matches/u);
  assert.match(startupRegionStyles, /@media \(max-width: 680px\)[\s\S]*?\.koreaMap > button span \{\s*font-size: 12px/u);
  assert.match(startupRegionStyles, /@media \(max-width: 680px\)[\s\S]*?\.koreaMap > button small \{\s*font-size: 11px/u);
  assert.match(youthSectionStyles, /@media \(max-width: 680px\)[\s\S]*?\.koreaMap > button span \{ font-size: 12px/u);
});

test("wide settlement tables are keyboard-scrollable and preserve their row labels", () => {
  assert.match(settlement, /role="region"[^>]*tabIndex=\{0\}/u);
  assert.match(settlement, /className=\{styles\.tableWrap\} role="region"/u);
  assert.match(settlementStyles, /position: sticky/u);
  assert.match(settlementStyles, /overscroll-behavior-x: contain/u);
});

test("developer inputs avoid iOS focus zoom and actions remain touch-sized", () => {
  assert.match(developerStyles, /@media \(max-width: 760px\)[\s\S]*?\.apiCard input,[\s\S]*?font-size: 16px/u);
  assert.match(developerStyles, /@media \(max-width: 760px\)[\s\S]*?\.providerToggle,[\s\S]*?min-height: 44px/u);
});

test("mobile phishing intake requires one-time app consent and an explicit browser clipboard action", () => {
  const pasteStart = page.indexOf("async function pastePhishingFromClipboard");
  const pasteEnd = page.indexOf("function clearPhishingInput", pasteStart);
  const pasteHandler = page.slice(pasteStart, pasteEnd);
  const clearEnd = page.indexOf("async function askAi", pasteEnd);
  const clearHandler = page.slice(pasteEnd, clearEnd);
  const analyzeStart = page.indexOf("async function analyzePhishing");
  const analyzeEnd = page.indexOf("function togglePhishingExposure", analyzeStart);
  const analyzeHandler = page.slice(analyzeStart, analyzeEnd);
  const safetyStart = page.indexOf('{activeView === "safety"');
  const safetyEnd = page.indexOf('{activeView === "ai"', safetyStart);
  const safetyView = page.slice(safetyStart, safetyEnd);

  assert.ok(pasteStart > 0 && pasteEnd > pasteStart);
  assert.ok(analyzeStart > 0 && analyzeEnd > analyzeStart);
  assert.match(page, /BORA Bridge는 문자함을 읽지 않으며, 사용자가 직접 복사해 가져온 텍스트만 점검합니다/u);
  assert.match(page, /현재 클립보드의 텍스트를 가져왔어요. 점검할 문자 한 건이 맞는지 확인하세요/u);
  assert.match(page, /링크·첨부·미리보기·QR·전화번호·앱 설치 버튼은 열지 마세요/u);
  assert.match(page, /문자 텍스트의 위험 신호를 점검하며 휴대폰 감염 여부를 진단하지는 않습니다/u);
  assert.match(page, /이 체크는 BORA에서 이번 읽기 시도에 동의하는 선택이며 브라우저의 사이트 권한을 켜거나 끄지 않습니다/u);
  assert.equal(page.match(/clipboardConsentRequired: "/gu)?.length, 4);
  assert.equal(page.match(/clipboardReading: "/gu)?.length, 4);
  assert.match(page, /const \[phishingClipboardConsent, setPhishingClipboardConsent\] = useState\(false\)/u);
  assert.match(page, /const \[phishingClipboardReading, setPhishingClipboardReading\] = useState\(false\)/u);
  assert.match(page, /className="clipboard-consent"><input type="checkbox" checked=\{phishingClipboardConsent\} disabled=\{phishingClipboardReading\} aria-describedby="clipboard-consent-help"/u);
  assert.match(page, /disabled=\{!phishingClipboardConsent \|\| phishingClipboardReading\} aria-describedby="clipboard-consent-help" aria-busy=\{phishingClipboardReading\}/u);
  assert.match(page, /onClick=\{\(\) => void pastePhishingFromClipboard\(\)\}/u);
  assert.match(pasteHandler, /if \(phishingClipboardReading\) return/u);
  assert.match(pasteHandler, /if \(!phishingClipboardConsent\)[\s\S]*?clipboardConsentRequired/u);
  assert.match(pasteHandler, /setPhishingClipboardConsent\(false\)[\s\S]*?setPhishingClipboardReading\(true\)[\s\S]*?navigator\.clipboard/u);
  assert.match(pasteHandler, /const clipboard = navigator\.clipboard/u);
  assert.match(pasteHandler, /if \(!clipboard\?\.readText\)/u);
  assert.match(pasteHandler, /await clipboard\.readText\(\)[\s\S]*?requestId !== phishingClipboardRequestRef\.current/u);
  assert.match(pasteHandler, /clipboardText\.length > 20_000/u);
  assert.match(pasteHandler, /finally \{[\s\S]*?setPhishingClipboardReading\(false\)/u);
  assert.doesNotMatch(pasteHandler, /analyzePhishing/u);
  assert.doesNotMatch(pasteHandler, /\bfetch\s*\(/u);
  assert.doesNotMatch(page, /navigator\.permissions/u);
  assert.doesNotMatch(page, /localStorage\.[^(]*\([^\n]*phishingClipboard|document\.cookie[^\n]*phishingClipboard/u);
  assert.match(pasteHandler, /setPhishingExposures\(\[\]\)/u);
  assert.match(pasteHandler, /setPhishingReputationConsent\(false\)/u);
  assert.match(clearHandler, /setPhishingExposures\(\[\]\)/u);
  assert.match(clearHandler, /setPhishingReputationConsent\(false\)/u);
  assert.match(clearHandler, /setPhishingClipboardConsent\(false\)[\s\S]*?phishingClipboardRequestRef\.current \+= 1[\s\S]*?setPhishingClipboardReading\(false\)/u);
  assert.match(analyzeHandler, /const requestId = phishingAnalysisRequestRef\.current \+ 1/u);
  assert.match(analyzeHandler, /if \(phishingLoading \|\| phishingClipboardReading \|\| !phishingText\.trim\(\)\) return;/u);
  assert.match(analyzeHandler, /phishingClipboardRequestRef\.current \+= 1[\s\S]*?setPhishingClipboardReading\(false\)[\s\S]*?setPhishingClipboardConsent\(false\)/u);
  assert.match(analyzeHandler, /const submittedText = phishingText/u);
  assert.match(analyzeHandler, /const submittedLocale = locale/u);
  assert.match(analyzeHandler, /const submittedExposures = \[\.\.\.phishingExposures\]/u);
  assert.match(analyzeHandler, /const submittedReputationConsent = phishingReputationConsent/u);
  assert.match(analyzeHandler, /signal: controller\.signal/u);
  assert.equal(analyzeHandler.match(/requestId !== phishingAnalysisRequestRef\.current/gu)?.length, 3);
  assert.match(analyzeHandler, /controller\.signal\.aborted/u);
  assert.match(analyzeHandler, /function invalidatePhishingAnalysis\(\)[\s\S]*?phishingAnalysisRequestRef\.current \+= 1[\s\S]*?\.abort\(\)[\s\S]*?setPhishingLoading\(false\)/u);
  assert.match(page, /function changeLocale\([^)]*\) \{\s*invalidatePhishingAnalysis\(\)/u);
  assert.match(page, /function togglePhishingExposure\([^)]*\) \{\s*invalidatePhishingAnalysis\(\)/u);
  assert.match(pasteHandler, /invalidatePhishingAnalysis\(\)/u);
  assert.match(pasteHandler, /clipboardText\.length > 20_000[\s\S]*?invalidatePhishingAnalysis\(\)[\s\S]*?setPhishingText\(clipboardText\)/u);
  assert.match(clearHandler, /invalidatePhishingAnalysis\(\)/u);
  assert.match(safetyView, /onChange=\{\(event\) => \{ invalidatePhishingAnalysis\(\); phishingClipboardRequestRef/u);
  assert.match(safetyView, /checked=\{phishingReputationConsent\} onChange=\{\(event\) => \{ invalidatePhishingAnalysis\(\)/u);
  assert.match(safetyView, /onClick=\{analyzePhishing\} aria-busy=\{phishingLoading\} disabled=\{phishingLoading \|\| phishingClipboardReading \|\| !phishingText\.trim\(\)\}/u);
  assert.equal(page.match(/navigator\.clipboard/gu)?.length, 1);
  assert.match(page, /ref=\{phishingTextareaRef\}/u);
  assert.match(page, /htmlFor="phishing-message-input"/u);
  assert.match(page, /aria-describedby="phishing-privacy-note phishing-inert-note"/u);
  assert.match(page, /autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck=\{false\} translate="no"/u);
  assert.match(page, /detectedUrls\.map\(\(item\) => <article[\s\S]*?<strong>\{item\.host \|\| item\.url\}<\/strong>/u);
  assert.doesNotMatch(page, /href=\{item\.url\}/u);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/u);
  assert.doesNotMatch(safetyView, /type="file"|onDrop=|href=\{phishingText\}|src=\{phishingText\}/u);
  assert.match(safetyView, /onChange=\{\(event\) => \{[^}]*setPhishingExposures\(\[\]\); setPhishingReputationConsent\(false\); setPhishingClipboardConsent\(false\); \}\}/u);
  assert.match(page, /setPhishingInputNotice\(securityT\.inputCleared\)/u);
  assert.match(page, /<div className="reputation-consent"><label>[\s\S]*?<\/label><a href="https:\/\/developers\.google\.com\/safe-browsing\/terms"/u);
  assert.doesNotMatch(page, /<label className="reputation-consent"/u);
  assert.match(legalPolicy, /이번 한 번의 읽기에 동의하고 버튼을 누른 경우에만 브라우저 안에서 시도/u);
  assert.match(legalPolicy, /가져온 텍스트는 ‘위험 분석하기’를 누르기 전까지 서버로 보내지 않습니다/u);
  assert.match(legalPolicy, /The checkbox state is not stored and is separate from the browser's site permission/u);
  assert.match(legalPolicy, /チェック状態は保存せず、ブラウザのサイト権限とも別です/u);
  assert.match(legalPolicy, /勾选状态不会保存，且与浏览器的网站权限相互独立/u);
  assert.match(legalPolicy, /Google URL reputation is used only with a separate opt-in/u);
  assert.match(page, /role="status" aria-live="polite"/u);
  assert.match(globalStyles, /\.clipboard-consent \{[^}]*min-height: 44px/u);
  assert.match(globalStyles, /\.scan-intake-actions button \{[^}]*min-height: 44px/u);
  assert.match(globalStyles, /\.scan-intake-actions button:disabled \{[^}]*cursor: not-allowed/u);
  assert.match(globalStyles, /\.scan-intake-actions button\[aria-busy="true"\] \{ cursor: wait; \}/u);
  assert.match(globalStyles, /@media \(max-width: 640px\)[\s\S]*?\.scan-intake-guide \{ align-items: stretch; flex-direction: column; \}/u);
  assert.match(globalStyles, /@media \(max-width: 640px\)[\s\S]*?\.scan-intake-controls \{ width: 100%; flex-basis: auto; \}/u);
});

test("the safety heading warns before opening links, replying, or sending money in every locale", () => {
  assert.match(page, /safetyTitle: "의심 메시지는 링크·첨부파일을 열거나 응답·송금하기 전에 확인하세요"/u);
  assert.match(page, /safetyTitle: "Check a suspicious message before opening links or attachments, replying, or sending money"/u);
  assert.match(page, /safetyTitle: "不審なメッセージは、リンクや添付ファイルを開く・返信する・送金する前に確認"/u);
  assert.match(page, /safetyTitle: "在打开链接或附件、回复或转账前检查可疑信息"/u);
  assert.doesNotMatch(page, /의심 메시지를 보내기 전에 확인하세요/u);
});

test("disabled controls distinguish unmet prerequisites from active work", () => {
  assert.match(globalStyles, /button:disabled \{[^}]*cursor: not-allowed/u);
  assert.doesNotMatch(globalStyles, /^button:disabled \{[^}]*cursor: wait/gmu);
  assert.match(globalStyles, /button:disabled\[aria-busy="true"\] \{ cursor: wait; \}/u);
  assert.match(globalStyles, /\.primary-button:hover:not\(:disabled\) \{ background: #4f3ba4; \}/u);
  assert.match(commercialSearch, /disabled=\{industryLoadState !== "ready"\}[\s\S]*?aria-busy=\{industryLoadState === "loading"\}/u);
  assert.match(commercialSearchStyles, /\.searchForm select:disabled \{[^}]*cursor: not-allowed/u);
  assert.match(commercialSearchStyles, /\.searchForm select:disabled\[aria-busy="true"\] \{ cursor: wait; \}/u);
  assert.match(assetWorkbookStyles, /\.amountInput input:disabled \{ cursor: not-allowed; \}/u);
  assert.match(page, /onClick=\{quickSignOut\} aria-busy=\{quickLogoutPending\} disabled=\{quickLogoutPending\}/u);
  assert.match(page, /aria-label=\{t\.send\} aria-busy=\{aiLoading\} disabled=\{aiLoading \|\| !aiQuestion\.trim\(\)\}/u);
  assert.equal(publicDataOverview.match(/aria-busy=\{busy\} disabled=\{busy \|\| !dashboard\.canRefresh\}/gu)?.length, 2);
  assert.match(publicDataOverviewStyles, /\.header button:disabled\[aria-busy="true"\] \{ cursor: wait; \}/u);
  assert.match(publicDataOverviewStyles, /\.compactUpdateHeading button:disabled \{[^}]*cursor: not-allowed/u);
  assert.match(publicDataOverviewStyles, /\.compactUpdateHeading button:disabled\[aria-busy="true"\] \{ cursor: wait; \}/u);
});

test("the public service overview keeps Korean headlines readable and its mascot directly loadable", () => {
  assert.match(challengeStyles, /\.hero h1 \{[^}]*font-size: clamp\(44px, 4\.2vw, 64px\)[^}]*word-break: keep-all[^}]*overflow-wrap: normal/u);
  assert.match(challengeStyles, /@media \(max-width: 820px\)[\s\S]*?\.hero h1 \{ font-size: clamp\(38px, 8\.5vw, 58px\)/u);
  assert.match(challengePage, /priority\s+unoptimized\s+sizes=/u);
  assert.match(challengePage, /3분 서비스 둘러보기/u);
  assert.doesNotMatch(challengePage, /3분 심사 시작|Finance AI · Review mode/u);
  assert.match(challengeLayout, /absolute: "BORA Bridge란\? \| 서비스 소개"/u);
});

test("the public service overview describes phishing and public-data generation truthfully", () => {
  assert.match(challengePage, /AI 모델을 호출하지 않는 규칙 엔진/u);
  assert.match(challengePage, /외부 URL 평판 조회는 기본 OFF/u);
  assert.match(challengePage, /서비스 데이터베이스나 영구 캐시에 저장하지 않습니다/u);
  assert.match(challengePage, /같은 응답 구조와 대응 순서를 제공하되, 표현에 따라 탐지 신호는 달라질 수 있음/u);
  assert.match(challengePage, /피싱 신고·상담은 1394/u);
  assert.match(challengePage, /과금 가능 모델의 새 설명만 개발자 확인 후 해당 항목에 한 번 생성/u);
  assert.doesNotMatch(challengePage, /언어를 바꿔도 동일한 위험 신호/u);
  assert.doesNotMatch(challengePage, /공공정보 설명은 개발자가 요청한 경우에만 생성/u);
});
