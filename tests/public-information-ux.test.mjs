import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const pageSource = readFileSync(new URL("../app/components/public-information-pages.tsx", import.meta.url), "utf8");
const source = pageSource + `
export { InformationItem, LoadingState, EmptyState, FinanceInformation, FinanceIndicators, StatusStrip, normalizeItemAnalysis };
export function CatalogueProbe(props) {
 return usePublicDashboard("finance", "all", "active", props.page, "employment", {mode:"all"}, 24, props.query ?? "", props.section ?? "products");
}
`;

function mount(source, name, initialProps = {}, initialPath = "/") {
  const slots = [];
  const timers = new Map();
  const storage = new Map();
  const calls = [];
  let cursor = 0, timerId = 0, dirty = false, disposed = false;
  let props = initialProps, pathname = initialPath, tree;
  let effects = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (next) => {
        const value = typeof next === "function" ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return (slots[index] ??= { current: initial }); },
    useMemo(fn, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { value: fn(), deps };
      return slots[index].value;
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) {
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, effect: fn, cleanup: fn() };
        });
      }
    },
    useReducer(reducer, initial, init) {
      const [state, setState] = hooks.useState(() => init ? init(initial) : initial);
      return [state, (action) => setState((current) => reducer(current, action))];
    },
    useId() { return hooks.useMemo(() => `synthetic-${cursor}`, []); },
  };
  const context = vm.createContext({
    AbortController, DOMException, Intl, URL, URLSearchParams, Event, console,
    window: {
      location: new URL(initialPath, "https://example.test"),
      history: { state: null, replaceState(_state, _title, path) { context.window.location = new URL(path, "https://example.test"); }, pushState(_state, _title, path) { context.window.location = new URL(path, "https://example.test"); } },
      dispatchEvent() {},
      localStorage: { getItem: () => null, setItem() {} },
      sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
      clearTimeout: (id) => timers.delete(id),
      setInterval: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
      clearInterval: (id) => timers.delete(id),
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
      addEventListener() {}, removeEventListener() {}, requestAnimationFrame() { return 0; }, cancelAnimationFrame() {},
    },
    document: { addEventListener() {}, removeEventListener() {}, activeElement: null },
    fetch(url, init = {}) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      calls.push({ url, init, resolve: (body, status = 200) => resolve({ ok: status >= 200 && status < 300, status, json: async () => body }), resolveHeaders: (json) => resolve({ ok: true, status: 200, json }), reject });
      return promise;
    },
  });
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context)((id) => {
    if (id === "react") return hooks;
    if (id === "next/navigation") return { usePathname: () => pathname };
    if (id === "next/link" || id === "next/image") return { __esModule: true, default: id === "next/link" ? "a" : "img" };
    if (id === "lucide-react") return new Proxy({}, { get: (_, key) => String(key) });
    if (id.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (id === "./exchange-converter") return { ExchangeConverter: "exchange-converter" };
    if (id === "@/lib/public-data/types") return { emptyPublicDataPayload: () => ({ exchange: { rates: [] }, categories: [], sources: [] }) };
    
    if (id === "@/lib/ai/context-client") return { recordRecentActivity: async () => {} };
    if (id === "./public-application-period") return { applicationPeriodView: () => null };
    if (id === "./public-information-layout") return { usePublicInformationLocale: () => "ko" };
    if (id === "@/lib/public-data/urls") return { safePublicHttpUrl: (url) => url, officialLinkKind: () => "detail" };
    if (id.startsWith("@/") || id.startsWith("./")) return new Proxy({}, { get: (_, key) => String(key) });
    return require(id);
  }, { exports }, exports);
  function render(nextProps = props, { commit = true } = {}) {
    props = nextProps;
    cursor = 0; dirty = false; effects = [];
    tree = exports[name](props);
    if (commit) for (const effect of effects) effect();
    return tree;
  }
  render();
  return {
    calls, storage,
    get tree() { return tree; },
    get search() { return context.window.location.search; },
    render,
    tick() {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== 0) continue;
        timers.delete(id); timer.fn();
      }
      if (dirty && !disposed) render();
    },
    elapse(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delay) continue;
        timers.delete(id); timer.fn();
      }
      if (dirty && !disposed) render();
    },
    async settle() {
      for (let turn = 0; turn < 15; turn += 1) {
        await Promise.resolve();
        if (dirty && !disposed) render();
      }
    },
    strictReplay() {
      const active = slots.filter((slot) => slot?.effect);
      for (const slot of active) slot.cleanup?.();
      for (const slot of active) slot.cleanup = slot.effect();
    },
    unmount() { disposed = true; for (const slot of slots) slot?.cleanup?.(); },
  };
}

function elements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...elements(node.props?.children, predicate)];
}

const item = { id: "finlife-synthetic", category: "finance", title: "Synthetic product", summary: "Collected official terms. ".repeat(30), source: "Synthetic institution", sourceUrl: "https://example.test/item", sourceLinkKind: "detail", publishedAt: "2026-09-23", discoveredAt: "2026-09-23", tags: [] };
const textOf = (node) => Array.isArray(node) ? node.map(textOf).join(" ") : node && typeof node === "object" ? textOf(node.props?.children) : String(node ?? "");

test("opening information details does not invoke AI; the explicit button does", async () => {
  const harness = mount(source, "InformationItem", { item, locale: "ko", analysisEnabled: true });
  const details = elements(harness.tree, (node) => node.type === "details" && node.props.onToggle)[0];
  details.props.onToggle({ currentTarget: { open: true } });
  await harness.settle();
  assert.equal(harness.calls.length, 0);
  const action = elements(harness.tree, (node) => node.type === "button" && textOf(node).includes("AI 설명 요청"))[0];
  assert.ok(action);
  action.props.onClick(); await harness.settle();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].url, "/api/public-data/item-analysis");
  harness.unmount();
  assert.equal(harness.calls[0].init.signal.aborted, true);
});

test("official source stays before long content and AI, with full text explicitly expandable", () => {
  const harness = mount(source, "InformationItem", { item, locale: "ko", analysisEnabled: false });
  const body = elements(harness.tree, (node) => node.props?.className === "itemBody")[0];
  const children = body.props.children.filter(Boolean);
  assert.equal(children[0].props.className, "sourceActions");
  const link = elements(children[0], (node) => node.type === "a")[0];
  assert.equal(link.props.href, item.sourceUrl);
  assert.match(link.props["aria-label"], /Synthetic product/);
  assert.equal(elements(harness.tree, (node) => node.type === "details" && node.props.className === "collectedText").length, 1);
  assert.equal(elements(harness.tree, (node) => node.type === "button" && textOf(node).includes("AI")).length, 0);
  harness.unmount();
});

test("a temporary AI fallback is explicit and retries only after a separate user request", async () => {
  const harness = mount(source, "InformationItem", { item, locale: "ko", analysisEnabled: true });
  elements(harness.tree, (node) => node.type === "button" && textOf(node).includes("AI 설명 요청"))[0].props.onClick();
  harness.calls[0].resolve({ explanation: "Official stored guidance", ai: { invoked: false }, providerError: "model_warming" });
  await harness.settle();
  assert.equal(harness.calls.length, 1, "warming must not automatically retry");
  const notice = elements(harness.tree, (node) => node.props?.role === "status")[0];
  assert.match(textOf(notice), /AI 모델을 준비/);
  elements(notice, (node) => node.type === "button")[0].props.onClick();
  await harness.settle();
  assert.equal(harness.calls.length, 2, "a ready fallback remains manually retryable");
  assert.equal(harness.calls[1].init.method, "POST");
  harness.calls[1].resolve({ explanation: "Generated explanation", ai: { invoked: true } });
  await harness.settle();
  assert.equal(elements(harness.tree, (node) => node.props?.role === "status").length, 0);
  const normalized = mount(source, "normalizeItemAnalysis", { explanation: "Safe explanation", providerError: "unexpected-private-detail" });
  assert.equal(normalized.tree.providerError, null);
  normalized.unmount(); harness.unmount();
});

test("loading is announced without a false zero result", () => {
  const loading = mount(source, "LoadingState", { locale: "ko" });
  assert.equal(loading.tree.props.role, "status");
  assert.equal(loading.tree.props["aria-busy"], "true");
  assert.equal(elements(loading.tree, (node) => node.type === "strong").length, 0);
  const empty = mount(source, "EmptyState", { icon: "Icon", message: "No records" });
  assert.equal(elements(empty.tree, (node) => node.type === "strong")[0].props.children, "0");
  loading.unmount(); empty.unmount();
});

test("catalogue pages pin the previous generation and reset to page one on a safe 409", async () => {
  const harness = mount(source, "CatalogueProbe", { page: 1 }, "/information/finance?page=2");
  assert.match(harness.calls[0].url, /section=products/);
  assert.doesNotMatch(harness.calls[0].url, /includeSupplemental/);
  harness.calls[0].resolve({ catalogVersion: "synthetic-v1", authenticated: false, categories: [], sources: [] });
  await harness.settle();
  harness.render({ page: 2 });
  assert.match(harness.calls[1].url, /catalogVersion=synthetic-v1/);
  harness.calls[1].resolve({ error: "public_catalog_changed", catalogVersion: "synthetic-v2" }, 409);
  await harness.settle();
  assert.equal(harness.tree.catalogChanged, true);
  assert.doesNotMatch(harness.search, /page=/);
  harness.render({ page: 1 });
  harness.calls[2].resolve({ catalogVersion: "synthetic-v2", authenticated: false, categories: [], sources: [] });
  await harness.settle();
  harness.render({ page: 2, section: "market", query: "synthetic" });
  assert.match(harness.calls[3].url, /section=market&query=synthetic/);
  assert.doesNotMatch(harness.calls[3].url, /catalogVersion=synthetic-v1/);
  harness.unmount();
});

test("collection warnings are separate from stored completeness and show the last success", () => {
  const dashboard = { categories: [{ id: "finance", totalCount: 5 }], cached: true, stale: false, lastSuccessfulAt: "2026-09-23", sources: [{ id: "finlife", label: "Synthetic source", status: "live", collectionStatus: "delayed", lastCollectedAt: "2026-09-01" }] };
  const harness = mount(source, "StatusStrip", { dashboard, loading: false, failed: false, locale: "ko", category: "finance" });
  assert.match(textOf(harness.tree), /수집 지연/);
  assert.match(textOf(harness.tree), /마지막 수집 성공/);
  assert.match(textOf(harness.tree), /Synthetic source/);
  harness.unmount();
});

test("an in-flight collection change without a version resets later pages and bounds first-page retries", async () => {
  const later = mount(source, "CatalogueProbe", { page: 2 }, "/information/finance?page=2");
  later.calls[0].resolve({ error: "public_catalog_changed" }, 409);
  await later.settle();
  assert.equal(later.tree.catalogChanged, true);
  assert.doesNotMatch(later.search, /page=/);
  later.render({ page: 1 });
  later.calls[1].resolve({ catalogVersion: "synthetic-v2", authenticated: false, categories: [], sources: [] });
  await later.settle();
  assert.equal(later.tree.loading, false);
  assert.equal(later.tree.failed, false);
  later.unmount();

  const first = mount(source, "CatalogueProbe", { page: 1 });
  first.calls[0].resolve({ error: "public_catalog_changed" }, 409);
  await first.settle();
  first.elapse(750); await first.settle();
  assert.equal(first.calls.length, 2);
  first.calls[1].resolve({ error: "public_catalog_changed" }, 409);
  await first.settle();
  first.elapse(2_000); await first.settle();
  assert.equal(first.calls.length, 3);
  first.calls[2].resolve({ error: "public_catalog_changed" }, 409);
  await first.settle();
  first.elapse(2_000); await first.settle();
  assert.equal(first.calls.length, 3, "repeated collection changes cannot spin indefinitely");
  assert.equal(first.tree.loading, false);
  assert.equal(first.tree.failed, true);
  first.unmount();
});
