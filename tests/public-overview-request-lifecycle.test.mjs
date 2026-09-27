import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const overviewSource = readFileSync(new URL("../app/components/public-data-overview.tsx", import.meta.url), "utf8");
const floatingSource = readFileSync(new URL("../app/components/bora-floating-guide.tsx", import.meta.url), "utf8");

function dashboard({ authenticated = false, canRefresh = false, count = 3, rate = 1_300, refreshInSeconds = 0 } = {}) {
  return {
    status: "ready", cached: true, stale: false, authenticated, canRefresh, refreshInSeconds,
    lastSuccessfulAt: "2026-09-23T00:00:00.000Z", sourceSchedules: [], sources: [],
    exchange: { source: "Synthetic official source", sourceUrl: "https://example.test", asOf: "2026-09-23", rates: [{ currency: "USD", baseRate: rate }] },
    categories: [{ id: "finance", totalCount: count, newCount: 0, items: [] }],
  };
}

// Execute the real component functions and effect callbacks with deterministic
// React-hook/timer shims. Network completion is explicitly controlled so an
// aborted request can still resolve, exercising the ownership guard as well.
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
    AbortController, DOMException, Intl, URL, console,
    window: {
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
    if (id === "@/lib/public-data/urls") return { safePublicHttpUrl: (url) => url };
    if (id === "@/lib/ai/context-client") return { recordRecentActivity: async () => {} };
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
const displayedRate = (harness) => elements(harness.tree, (node) => node.type === "exchange-converter")[0]?.props.baseRate;
const refreshButton = (harness) => elements(harness.tree, (node) => node.type === "button" && node.props.onClick)[0];

test("hidden floating-guide routes perform no daily-guide request", () => {
  for (const path of ["/", "/privacy", "/terms", "/challenge", "/developer", "/developer/evaluation"]) {
    const harness = mount(floatingSource, "BoraFloatingGuide", {}, path);
    assert.equal(harness.calls.length, 0, path);
    assert.equal(harness.tree, null, path);
    harness.unmount();
  }
});

test("visible floating guide makes one request and cancels it on unmount", () => {
  const harness = mount(floatingSource, "BoraFloatingGuide", {}, "/exchange");
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.calls[0].url, "/api/daily-guide");
  assert.equal(harness.calls[0].init.signal.aborted, false);
  harness.unmount();
  assert.equal(harness.calls[0].init.signal.aborted, true);
});

test("anonymous overview performs one cache GET and language changes do not refetch", async () => {
  const harness = mount(overviewSource, "default", { locale: "ko" });
  harness.tick();
  assert.equal(harness.calls.length, 1);
  harness.calls[0].resolve(dashboard());
  await harness.settle();
  assert.equal(displayedRate(harness), 1_300);
  harness.render({ locale: "en" });
  harness.tick();
  assert.equal(harness.calls.length, 1);
  assert.equal(displayedRate(harness), 1_300);
  harness.unmount();
});

test("login refresh waits for a due authenticated cache response and marks only completion", async () => {
  const harness = mount(overviewSource, "default", { locale: "ko", userId: "synthetic-a" });
  harness.tick();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.storage.size, 0);
  harness.calls[0].resolve(dashboard({ authenticated: true, canRefresh: true }));
  await harness.settle();
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.calls[1].url, "/api/public-data/refresh");
  assert.deepEqual(JSON.parse(harness.calls[1].init.body), { trigger: "login" });
  assert.equal(harness.storage.size, 0);
  assert.equal(displayedRate(harness), 1_300);
  assert.equal(refreshButton(harness).props.disabled, true);
  assert.ok(elements(harness.tree, (node) => node.type === "strong" && node.props.children === "3건").length > 0,
    "background collection keeps the stored total visible");
  harness.render({ locale: "en", userId: "synthetic-a" });
  harness.tick();
  assert.equal(harness.calls.length, 2, "translation during collection never replaces the request");
  assert.equal(harness.calls[1].init.signal.aborted, false);
  harness.calls[1].resolve({ ...dashboard({ authenticated: true, rate: 1_310 }), refreshResult: "cached" });
  await harness.settle();
  assert.equal(displayedRate(harness), 1_310);
  assert.equal(harness.storage.get("bora-public-data-initialized:synthetic-a"), "true");
  harness.render({ locale: "ja", userId: "synthetic-a" });
  harness.tick();
  assert.equal(harness.calls.length, 2);
  harness.unmount();
});

test("not-due or unauthenticated cache responses never trigger login collection", async () => {
  for (const response of [dashboard({ authenticated: true }), dashboard({ canRefresh: true })]) {
    const harness = mount(overviewSource, "default", { locale: "ko", userId: "synthetic-a" });
    harness.tick(); harness.calls[0].resolve(response); await harness.settle();
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.storage.size, 0);
    harness.unmount();
  }
});

test("overview bounds hanging headers and JSON, ignores late results, and offers anonymous GET retry", async () => {
  for (const hangDuringJson of [false, true]) {
    const harness = mount(overviewSource, "default", { locale: "ko", compact: true });
    harness.tick();
    if (hangDuringJson) {
      harness.calls[0].resolveHeaders(() => new Promise(() => {}));
      await harness.settle();
    }
    harness.elapse(10_000);
    await harness.settle();
    assert.equal(harness.calls[0].init.signal.aborted, true);
    const retry = elements(harness.tree, (node) => node.type === "button" && node.props.children === "저장 정보 다시 불러오기")[0];
    assert.ok(retry);
    assert.equal(retry.props.disabled, false);
    retry.props.onClick(); harness.render(); harness.tick();
    assert.equal(harness.calls.length, 2);
    assert.equal(harness.calls[1].url, "/api/public-data/dashboard");
    assert.notEqual(harness.calls[1].init.method, "POST");
    harness.calls[0].resolve(dashboard({ rate: 9_999 }));
    harness.calls[1].resolve(dashboard({ rate: 1_333 }));
    await harness.settle();
    assert.equal(displayedRate(harness), 1_333);
    harness.unmount();
  }
});

test("explicit stored-data reload never starts collection even for a due signed-in user", async () => {
  const harness = mount(overviewSource, "default", { locale: "ko", userId: "synthetic-a" });
  harness.tick(); harness.calls[0].reject(new Error("synthetic outage")); await harness.settle();
  const retry = elements(harness.tree, (node) => node.type === "button" && node.props.children === "저장 정보 다시 불러오기")[0];
  retry.props.onClick(); harness.render(); harness.tick();
  harness.calls[1].resolve(dashboard({ authenticated: true, canRefresh: true }));
  await harness.settle();
  assert.equal(harness.calls.length, 2);
  assert.equal(harness.storage.size, 0);
  harness.unmount();
});

test("account changes immediately hide old data and cancel outstanding requests", async () => {
  const harness = mount(overviewSource, "default", { locale: "ko", userId: "synthetic-a" });
  harness.tick(); harness.calls[0].resolve(dashboard({ authenticated: true, canRefresh: true })); await harness.settle();
  assert.equal(harness.calls.length, 2);
  harness.render({ locale: "ko", userId: "synthetic-b" });
  assert.equal(displayedRate(harness), null);
  assert.equal(harness.calls[1].init.signal.aborted, true);
  harness.tick();
  harness.calls[1].resolve(dashboard({ authenticated: true, rate: 9_999 }));
  await harness.settle();
  assert.equal(displayedRate(harness), null);
  assert.equal(harness.storage.size, 0);
  harness.calls[2].resolve(dashboard({ authenticated: true, rate: 1_320 })); await harness.settle();
  assert.equal(displayedRate(harness), 1_320);
  harness.unmount();
});

test("Strict Mode replay cancels obsolete GETs without losing the login refresh", async () => {
  const harness = mount(overviewSource, "default", { locale: "ko", userId: "synthetic-a" });
  harness.tick();
  harness.strictReplay();
  assert.equal(harness.calls[0].init.signal.aborted, true);
  harness.tick();
  harness.calls[0].resolve(dashboard({ authenticated: true, canRefresh: true, rate: 9_999 }));
  await harness.settle();
  assert.equal(harness.calls.length, 2);
  assert.equal(displayedRate(harness), null);
  harness.calls[1].resolve(dashboard({ authenticated: true, canRefresh: true })); await harness.settle();
  assert.equal(harness.calls.length, 3);
  assert.equal(JSON.parse(harness.calls[2].init.body).trigger, "login");
  assert.equal(harness.storage.size, 0);
  harness.unmount();
  assert.equal(harness.calls[2].init.signal.aborted, true);
});

test("an interrupted login POST is not marked complete and can resume on replay", async () => {
  const harness = mount(overviewSource, "default", { locale: "ko", userId: "synthetic-a" });
  harness.tick(); harness.calls[0].resolve(dashboard({ authenticated: true, canRefresh: true })); await harness.settle();
  assert.equal(harness.calls.length, 2);
  harness.strictReplay(); harness.tick();
  assert.equal(harness.calls[1].init.signal.aborted, true);
  harness.calls[1].resolve(dashboard({ authenticated: true, rate: 9_999 })); await harness.settle();
  assert.equal(harness.storage.size, 0);
  harness.calls[2].resolve(dashboard({ authenticated: true, canRefresh: true })); await harness.settle();
  assert.equal(harness.calls.length, 4);
  assert.equal(JSON.parse(harness.calls[3].init.body).trigger, "login");
  harness.calls[3].resolve(dashboard({ authenticated: true, rate: 1_340 })); await harness.settle();
  assert.equal(harness.storage.get("bora-public-data-initialized:synthetic-a"), "true");
  assert.equal(displayedRate(harness), 1_340);
  harness.unmount();
});

test("a signed-out principal never receives the old account's late cache response", async () => {
  const harness = mount(overviewSource, "default", { locale: "ko", userId: "synthetic-a" });
  harness.tick();
  harness.render({ locale: "ko", userId: null }); harness.tick();
  assert.equal(harness.calls[0].init.signal.aborted, true);
  harness.calls[0].resolve(dashboard({ authenticated: true, canRefresh: true, rate: 9_999 })); await harness.settle();
  assert.equal(displayedRate(harness), null);
  assert.equal(harness.calls.length, 2);
  harness.calls[1].resolve(dashboard({ rate: 1_350 })); await harness.settle();
  assert.equal(displayedRate(harness), 1_350);
  assert.equal(harness.storage.size, 0);
  harness.unmount();
});

test("completed per-user login refresh is not repeated on remount", async () => {
  const harness = mount(overviewSource, "default", { locale: "ko", userId: "synthetic-a" });
  harness.storage.set("bora-public-data-initialized:synthetic-a", "true");
  harness.tick(); harness.calls[0].resolve(dashboard({ authenticated: true, canRefresh: true })); await harness.settle();
  assert.equal(harness.calls.length, 1);
  assert.equal(refreshButton(harness).props.disabled, false);
  harness.unmount();
});

test("manual refresh preserves cooldown notice and translates it without more requests", async () => {
  const harness = mount(overviewSource, "default", { locale: "ko", userId: "synthetic-a" });
  harness.storage.set("bora-public-data-initialized:synthetic-a", "true");
  harness.tick(); harness.calls[0].resolve(dashboard({ authenticated: true, canRefresh: true })); await harness.settle();
  refreshButton(harness).props.onClick();
  harness.calls[1].resolve(dashboard({ authenticated: true, refreshInSeconds: 60 }), 429);
  await harness.settle();
  assert.match(JSON.stringify(harness.tree), /현재 최신 정보를 사용하고 있습니다/u);
  assert.equal(refreshButton(harness).props.disabled, true);
  harness.render({ locale: "en", userId: "synthetic-a" }); harness.tick();
  assert.equal(harness.calls.length, 2);
  assert.match(JSON.stringify(harness.tree), /viewing the latest available information/u);
  harness.unmount();
});

test("failed manual refresh recovers cached data once, but aborts never start fallback work", async () => {
  const harness = mount(overviewSource, "default", { locale: "ko", userId: "synthetic-a" });
  harness.storage.set("bora-public-data-initialized:synthetic-a", "true");
  harness.tick(); harness.calls[0].resolve(dashboard({ authenticated: true, canRefresh: true })); await harness.settle();
  refreshButton(harness).props.onClick();
  harness.calls[1].resolve({ error: "synthetic-failure" }, 503); await harness.settle();
  assert.equal(harness.calls.length, 3);
  assert.equal(harness.calls[2].url, "/api/public-data/dashboard");
  harness.calls[2].resolve(dashboard({ authenticated: true, canRefresh: true, rate: 1_330 })); await harness.settle();
  assert.equal(displayedRate(harness), 1_330);
  assert.match(JSON.stringify(harness.tree), /공식 정보를 불러오지 못했습니다/u);
  refreshButton(harness).props.onClick();
  harness.unmount();
  harness.calls[3].reject(new DOMException("Aborted", "AbortError")); await harness.settle();
  assert.equal(harness.calls.length, 4);
});
