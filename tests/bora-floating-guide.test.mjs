import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../app/components/bora-floating-guide.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/components/bora-floating-guide.module.css", import.meta.url), "utf8");
// Static declaration checks, not a substitute for the main task's browser QA.
const stylesheet = css.replace(/\/\*[\s\S]*?\*\//gu, "");
const mobile = stylesheet.split("@media (max-width: 640px) {")[1].split("@media")[0];
function value(container, selector, property) {
  for (const [, selectors, body] of container.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    if (!selectors.split(",").map(s => s.trim()).includes(selector)) continue;
    const declaration = body.split(";").map(part => part.trim()).find(part => part.startsWith(`${property}:`));
    if (declaration) return declaration.slice(property.length + 1).trim();
  }
}
const require = createRequire(import.meta.url);
let pathname = "/exchange";
const componentModule = { exports: {} };
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const run = vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`);
run((id) => {
  if (id === "next/navigation") return { usePathname: () => pathname };
  if (id === "next/image") return function MockImage({ src, alt, width, height }) { return React.createElement("img", { src, alt, width, height }); };
  if (id === "next/link") return function MockLink({ href, children, ...props }) { return React.createElement("a", { href, ...props }, children); };
  if (id.endsWith(".module.css")) return Object.fromEntries([
    "shell", "withBottomNavigation", "protectedContent", "interactionSafe", "collapsed", "message",
    "mobileDefaultClosed", "messageHeader", "messageActions", "action", "skip", "progress", "mascotButton",
  ].map(name => [name, name]));
  return require(id);
}, componentModule, componentModule.exports);
function render(path) {
  pathname = path;
  return renderToStaticMarkup(React.createElement(componentModule.exports.BoraFloatingGuide));
}

test("form-heavy pages start collapsed in server rendering, without waiting for an effect", () => {
  for (const path of ["/assets", "/safety", "/ai-guide", "/mypage", "/exchange", "/exchange/details", "/information/finance", "/information/settlement"]) {
    const html = render(path);
    assert.match(html, /class="shell [^"]*protectedContent[^"]*collapsed[^"]*"/u);
    assert.match(html, /class="message" hidden=""/u);
    assert.match(html, /aria-expanded="false"/u);
    assert.match(html, /aria-label="보리 안내 열기"/u);
    const controlledId = /aria-controls="([^"]+)"/u.exec(html)?.[1];
    assert.ok(controlledId && html.includes(`id="${controlledId}"`));
  }
});
test("other desktop guidance remains initially expanded and hidden routes stay hidden", () => {
  const html = render("/information/youth");
  assert.match(html, /aria-expanded="true"/u);
  assert.doesNotMatch(html, /class="message" hidden/u);
  for (const path of ["/", "/privacy", "/terms", "/challenge", "/developer"]) assert.equal(render(path), "");
});
test("mobile scrolling bubble removes its overflow-producing tail, without changing desktop tail", () => {
  assert.equal(value(stylesheet, ".message::after", "right"), "-8px");
  assert.equal(value(mobile, ".message::after", "display"), "none");
  assert.equal(value(mobile, ".message", "overflow-y"), "auto");
  assert.equal(value(mobile, ".message", "overflow-x"), "hidden");
  assert.equal(value(stylesheet, ".message", "min-width"), "0");
  assert.equal(value(mobile, ".message", "overflow-wrap"), "anywhere");
});
test("long translated actions can wrap while icons and touch-size close button do not shrink", () => {
  assert.equal(value(mobile, ".messageHeader button", "flex-shrink"), "0");
  assert.equal(value(stylesheet, ".messageHeader button", "width"), "44px");
  for (const selector of [".action", ".skip"]) {
    assert.equal(value(mobile, selector, "max-width"), "100%");
    assert.equal(value(mobile, selector, "white-space"), "normal");
    assert.equal(value(mobile, `${selector} > span`, "overflow-wrap"), "anywhere");
    assert.equal(value(mobile, `${selector} svg`, "flex-shrink"), "0");
  }
});
test("protected mobile launch button is compact and stationary, with keyboard close and manual next retained", () => {
  assert.equal(value(mobile, ".protectedContent.collapsed .mascotButton", "width"), "48px");
  assert.equal(value(mobile, ".protectedContent.collapsed .mascotButton", "animation"), "none");
  assert.equal(value(mobile, ".mobileDefaultClosed .mascotButton", "width"), "48px");
  assert.equal(value(mobile, ".mobileDefaultClosed .message", "display"), "none");
  assert.match(source, /"\/assets"[\s\S]*"\/information\/finance"[\s\S]*"\/information\/settlement"/u);
  assert.match(source, /dispatchVisibility\(\{ type: "viewport", mobile: mobileQuery\.matches \}\)/u);
  assert.match(source, /event\.key === "Escape" && !guideCollapsed/u);
  assert.match(source, /mascotButtonRef\.current\?\.focus\(\)/u);
  assert.match(source, /onClick=\{closeGuide\}/u);
  assert.match(source, /setActiveIndex\(\(current\) => \(current \+ 1\) % pendingTasks\.length\)/u);
  assert.match(source, /setGuideState\("error"\)/u);
  assert.match(source, /setRetryRequest\(\(current\) => current \+ 1\)/u);
  assert.match(source, /t\.position\(recommendationPosition, pendingTasks\.length\)/u);
  assert.doesNotMatch(source, /<span className=\{styles\.progress\}>\{guide\.completedCount\}\/\{guide\.totalCount\}<\/span>\s*\}/u);
  assert.match(source, /dispatchVisibility\(\{ type: "openMobile" \}\)/u);
  assert.match(source, /if \(visibility\.mobileExplicitOpen\)[\s\S]*type: "closeMobile"[\s\S]*type: "openMobile"/u);
  assert.match(source, /dispatchVisibility\(\{ type: "toggleDesktop" \}\)/u);
  assert.match(source, /aria-live="polite"/u);
});
test("desktop collapse preference survives ordinary routes and mobile viewport round trips", () => {
  const {
    initialBoraGuideVisibility,
    reduceBoraGuideVisibility,
    isBoraGuideCollapsed,
  } = componentModule.exports;

  let state = initialBoraGuideVisibility(false);
  assert.equal(isBoraGuideCollapsed(state), false);

  state = reduceBoraGuideVisibility(state, { type: "toggleDesktop" });
  assert.equal(isBoraGuideCollapsed(state), true);
  state = reduceBoraGuideVisibility(state, {
    type: "route",
    protectsSensitiveContent: false,
  });
  assert.equal(state.desktopCollapsed, true);

  state = reduceBoraGuideVisibility(state, { type: "viewport", mobile: true });
  state = reduceBoraGuideVisibility(state, { type: "openMobile" });
  assert.equal(isBoraGuideCollapsed(state), false);
  state = reduceBoraGuideVisibility(state, { type: "viewport", mobile: false });
  assert.equal(isBoraGuideCollapsed(state), true);
  assert.equal(state.desktopCollapsed, true);

  state = reduceBoraGuideVisibility(state, { type: "toggleDesktop" });
  state = reduceBoraGuideVisibility(state, { type: "viewport", mobile: true });
  state = reduceBoraGuideVisibility(state, { type: "viewport", mobile: false });
  assert.equal(isBoraGuideCollapsed(state), false);
  assert.equal(state.desktopCollapsed, false);
});
test("saved locale is synchronized only after hydration and focused fields collapse the guide", () => {
  assert.match(source, /useState<Locale>\("ko"\)/u);
  assert.match(source, /const handleStorage = \(\) => setLocale\(readLocale\(\)\);\s*handleStorage\(\);/u);
  assert.doesNotMatch(source, /useState<Locale>\(\(\) =>/u);
  assert.match(source, /if \(!isFormOrConsentTarget\(event\.target\)\) return;\s*setInteractionSafe\(true\);\s*dispatchVisibility\(\{ type: "focus" \}\);/u);
  assert.equal(value(stylesheet, ".protectedContent.collapsed .mascotButton", "width"), "54px");
  assert.equal(value(stylesheet, ".interactionSafe.collapsed .mascotButton", "animation"), "none");
});
