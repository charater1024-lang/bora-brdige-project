import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const floatingGuide = readFileSync(new URL("../app/components/bora-floating-guide.tsx", import.meta.url), "utf8");
const floatingGuideStyles = readFileSync(new URL("../app/components/bora-floating-guide.module.css", import.meta.url), "utf8");
const shortcuts = readFileSync(new URL("../app/components/information-shortcuts.tsx", import.meta.url), "utf8");
const homeControls = readFileSync(new URL("../app/components/home-control-center.tsx", import.meta.url), "utf8");
const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const homeControlStyles = readFileSync(new URL("../app/components/home-control-center.module.css", import.meta.url), "utf8");

test("home action buttons render on the server and dispatch genuine layout/account requests", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
    esbuild: { jsx: "automatic" }, resolve: { alias: { "@": root } }, server: { middlewareMode: true, watch: null } });
  try {
    const { HomeControlCenterActions } = await server.ssrLoadModule("/app/components/home-control-center.tsx");
    const calls = [];
    const props = { locale: "ko", easyMode: false, user: null, onPanelOpen: (...args) => calls.push(args) };
    const markup = renderToStaticMarkup(createElement(HomeControlCenterActions, props));
    assert.equal((markup.match(/<button\b/gu) ?? []).length, 2);
    assert.match(markup, /홈 편집<\/button>/u);
    assert.match(markup, /로그인<\/button>/u);
    assert.doesNotMatch(markup, /<(?:div|button)\b[^>]*(?:\shidden(?:\s|=|>)|aria-hidden="true"|\sdisabled(?:\s|=|>))/u);
    const buttons = HomeControlCenterActions(props).props.children[1].props.children;
    const trigger = { syntheticButton: true };
    buttons[0].props.onClick({ currentTarget: trigger });
    buttons[1].props.onClick({ currentTarget: trigger });
    assert.deepEqual(calls, [["layout", trigger], ["account", trigger]]);
  } finally { await server.close(); }
});

test("the top-right account button exposes a compact account menu", () => {
  assert.match(page, /<details className="account-quick-menu">/u);
  assert.match(page, /href="\/mypage"/u);
  assert.match(page, /href="\/developer"/u);
  assert.match(page, /fetchAuthJson<unknown>\("\/api\/auth\/logout"/u);
  assert.match(page, /quickLogoutPending/u);
});

test("recent features stay device-local and are capped at three", () => {
  assert.match(page, /bora-recent-features-v1/u);
  assert.match(page, /window\.localStorage\.setItem\(RECENT_FEATURES_KEY/u);
  assert.match(page, /current\.filter\(\(item\) => item !== view\)\]\.slice\(0, 3\)/u);
  assert.match(page, /function rememberRecentView\(view: View\)/u);
  assert.match(page, /onClick=\{\(\) => rememberRecentView\(id\)\}/u);
  assert.match(page, /className="recent-features"/u);
});

test("the public challenge walkthrough is always available from the top bar", () => {
  const topbarStart = page.indexOf('<header className="topbar">');
  const topbarEnd = page.indexOf("</header>", topbarStart);
  const challengeLink = page.indexOf('<Link className="challenge-top-link" href="/challenge"', topbarStart);

  assert.ok(topbarStart >= 0 && topbarEnd > topbarStart);
  assert.ok(challengeLink > topbarStart && challengeLink < topbarEnd);
  assert.match(page, /aria-label=\{shellT\.challenge\}/u);
  assert.match(page, /challenge: "BORA Bridge란\?"/u);
  assert.match(page, /challenge: "About BORA Bridge"/u);
  assert.match(page, /<CircleHelp size=\{17\} aria-hidden="true" \/>/u);
  assert.match(globalStyles, /\.challenge-top-link \{[^}]*min-height: 42px/u);
  assert.match(globalStyles, /@media \(max-width: 640px\)[\s\S]*?\.challenge-top-link \{[^}]*min-height: 44px/u);
});

test("opportunity data is split into focused information routes", () => {
  assert.match(page, /<InformationShortcuts locale=\{locale\} \/>/u);
  assert.doesNotMatch(page, /<details className="opportunity-data-disclosure">/u);
  assert.match(shortcuts, /href: "\/information\/youth"/u);
  assert.match(shortcuts, /href: "\/information\/finance"/u);
  assert.match(shortcuts, /href: "\/information\/startup"/u);
  assert.match(shortcuts, /href: "\/information\/settlement"/u);
});

test("the BORA brand returns to home and the floating guide mascot is site-wide", () => {
  assert.match(page, /className="brand-home-link"/u);
  assert.match(page, /href="\/"/u);
  assert.match(layout, /<BoraFloatingGuide \/>/u);
  assert.match(floatingGuide, /src="\/bora-mascot\.webp"/u);
  assert.match(floatingGuide, /unoptimized/u);
  assert.match(floatingGuide, /BORA GUIDE · 보리/u);
  assert.match(floatingGuide, /className=\{styles\.skip\}/u);
  assert.match(floatingGuide, /\(current \+ 1\) % pendingTasks\.length/u);
  assert.match(floatingGuide, /다음 추천/u);
  assert.match(floatingGuideStyles, /animation: mascotFloat/u);
  assert.match(floatingGuideStyles, /\.skip/u);
  assert.match(floatingGuideStyles, /prefers-reduced-motion/u);
});

test("the home replaces hard-coded zero progress with the account-backed Bori guide", () => {
  assert.match(page, /<BoraDailyGuide/u);
  assert.match(page, /userId=\{currentUser\?\.id\}/u);
  assert.doesNotMatch(page, /<small>0\/3<\/small>/u);
});

test("main dashboard views have stable dedicated URLs and policy entry points", () => {
  assert.match(page, /assets: "\/assets"/u);
  assert.match(page, /safety: "\/safety"/u);
  assert.match(page, /opportunity: "\/opportunities"/u);
  assert.match(page, /ai: "\/ai-guide"/u);
  assert.match(page, /className="information-portal-entry"/u);
  assert.match(page, /href="\/information"/u);
});

test("client-side dashboard navigation synchronizes the visible view with the route", () => {
  assert.match(page, /import \{ usePathname \} from "next\/navigation";/u);
  assert.match(page, /function viewFromPathname\(pathname: string \| null, fallback: View\): View/u);
  assert.match(page, /const pathname = usePathname\(\);/u);
  assert.match(page, /const activeView = viewFromPathname\(pathname, initialView\);/u);
  assert.doesNotMatch(page, /setActiveView/u);
});

test("the shared dashboard shell restores the signed-in identity on every direct route", () => {
  assert.match(page, /fetch\("\/api\/session"/u);
  assert.match(page, /credentials: "same-origin"/u);
  assert.match(page, /const user = sessionUserFromResponse\(session\)/u);
  assert.match(page, /setCurrentUser\(user\)/u);
});

test("the sidebar BORA Member control opens the shared account dialog on every dashboard route", () => {
  assert.match(page, /className="sidebar-profile"/u);
  assert.match(page, /onClick=\{openSidebarAccountDialog\}/u);
  assert.match(page, /aria-haspopup="dialog"/u);
  assert.match(page, /accountDialogRequest=\{accountDialogRequest\}/u);
  assert.match(page, /layoutDialogRequest=\{layoutDialogRequest\}[\s\S]*launchersHidden/u);
  assert.equal((page.match(/<HomeControlCenter\b/gu) ?? []).length, 1);
  assert.match(homeControls, /accountDialogRequest <= consumedAccountRequest\.current/u);
  assert.match(page, /<HomeControlCenterActions/u);
  assert.match(homeControls, /layoutDialogRequest <= consumedLayoutRequest\.current/u);
  assert.doesNotMatch(homeControls + page, /createPortal|homeControlContainer/u);
  assert.match(homeControls, /setActiveTab\("account"\);[\s\S]*setDialogOpen\(true\)/u);
  assert.match(homeControls, /accountDialogTriggerRef\?\.current/u);
  assert.match(page, /matchMedia\("\(max-width: 900px\)"\)/u);
  assert.doesNotMatch(page, /matchMedia\("\(max-width: 980px\)"\)/u);
});

test("member sign-in exposes only Kakao and Naver with accessible mobile presentation", () => {
  assert.match(homeControls, /const LOGIN_PROVIDERS: LoginProvider\[\] = \["kakao", "naver"\]/u);
  assert.doesNotMatch(homeControls, /const LOGIN_PROVIDERS: LoginProvider\[\] = \[[^\]]*google/u);
  assert.match(globalStyles, /\.sidebar-profile:focus-visible/u);
  assert.match(homeControlStyles, /@media \(max-width: 640px\)[\s\S]*\.dialog[\s\S]*width: 100vw/u);
  assert.match(homeControlStyles, /max-height: calc\(100dvh - 18px\)/u);
  assert.match(homeControls, /\{!displayedSessionUser && !sessionLoading && \(/u);
});
