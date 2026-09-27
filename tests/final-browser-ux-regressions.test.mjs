import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const navigation = read("../app/components/navigation-feedback.tsx");
const navigationCss = read("../app/components/navigation-feedback.module.css");
const loading = read("../app/loading.tsx");
const layout = read("../app/layout.tsx");
const mascot = read("../app/components/bora-floating-guide.tsx");
const mascotCss = read("../app/components/bora-floating-guide.module.css");
const commercial = read("../app/components/commercial-area-insights.tsx");
const law = read("../app/components/financial-law-safety.tsx");

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const { resolveCommercialInsightSelection } = await server.ssrLoadModule("/app/components/commercial-selection.ts");
const navigationModule = await server.ssrLoadModule("/app/components/navigation-feedback.tsx");
const loadingModule = await server.ssrLoadModule("/app/loading.tsx");
test.after(() => server.close());

test("router loading lifecycle owns transition feedback without intercepting cancelled links", () => {
  assert.match(loading, /return <NavigationFeedback \/>/u);
  assert.doesNotMatch(layout, /NavigationFeedback|Suspense/u);
  assert.match(navigation, /const SHOW_DELAY_MS = 160/u);
  assert.match(navigation, /role="status" aria-live="polite"/u);
  assert.match(navigation, /body\.setAttribute\("aria-busy", "true"\)/u);
  assert.match(navigation, /window\.clearTimeout\(showTimer\)/u);
  assert.match(navigation, /previousAriaBusy === null[\s\S]*body\.removeAttribute\("aria-busy"\)/u);
  assert.doesNotMatch(navigation, /addEventListener\("click"|addEventListener\("popstate"/u);
  assert.doesNotMatch(navigation, /usePathname|useSearchParams|NAVIGATION_TIMEOUT|POPSTATE/u);

  const boundaryElement = loadingModule.default();
  assert.equal(boundaryElement.type, navigationModule.NavigationFeedback);
  const statusHtml = renderToStaticMarkup(React.createElement(
    navigationModule.NavigationFeedbackStatus,
    { locale: "en" },
  ));
  assert.match(statusHtml, /data-bora-navigation-feedback="true"/u);
  assert.match(statusHtml, /role="status" aria-live="polite"/u);
  assert.match(statusHtml, /Opening the next page/u);
  assert.match(navigationCss, /pointer-events: none/u);
  assert.match(navigationCss, /prefers-reduced-motion: reduce/u);
});

test("mobile Bori is compact before hydration and expands only after an explicit tap", () => {
  assert.match(mascot, /mobileExplicitOpen/u);
  assert.match(mascot, /state\.mobileViewport \? !state\.mobileExplicitOpen : state\.desktopCollapsed/u);
  assert.match(mascot, /dispatchVisibility\(\{ type: "openMobile" \}\)/u);
  assert.match(mascot, /if \(visibility\.mobileExplicitOpen\)[\s\S]*type: "closeMobile"[\s\S]*type: "openMobile"/u);
  assert.match(mascotCss, /\.mobileDefaultClosed \.message\s*\{\s*display: none/u);
  assert.match(mascotCss, /\.mobileDefaultClosed \.mascotButton[\s\S]*width: 48px;[\s\S]*height: 56px/u);
});

test("commercial detail selection follows the active search result set", () => {
  const all = [{ id: "old" }, { id: "new" }, { id: "third" }];
  assert.equal(resolveCommercialInsightSelection(all, [all[1]], [all[0]], "old", true), all[1]);
  assert.equal(resolveCommercialInsightSelection(all, [], [all[0]], "old", true), null);
  assert.equal(resolveCommercialInsightSelection(all, [all[1]], [all[0]], "old", false), all[0]);
  assert.match(commercial, /setQuery\(nextQuery\);\s*setSelectedId\(null\)/u);
  assert.match(commercial, /setQuery\(""\);\s*setSelectedId\(districtId\)/u);
  assert.match(commercial, /<section key=\{selected\.id\} className=\{styles\.detail\}/u);
});

test("official legal fallback is labelled as an excerpt rather than an AI summary", () => {
  assert.match(law, /officialExcerptFallback[\s\S]*summary\?\.contentMode === "official-excerpts"/u);
  assert.match(law, /공식 조문 발췌 · AI 요약 아님/u);
  assert.match(law, /품질 게이트 적용 · 공식 원문 그대로/u);
  assert.match(law, /officialExcerptFallback \? <BookOpenCheck/u);
  assert.match(law, /summaryTitle[\s\S]*summaryLead/u);
});
