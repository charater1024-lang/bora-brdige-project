import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const pageSource = readFileSync(new URL("../app/mypage/page.tsx", import.meta.url), "utf8");
const requestSource = readFileSync(new URL("../lib/auth/client-requests.ts", import.meta.url), "utf8");

// Real component/effect and request-helper code, deterministic hooks and clocks.
// Mock responses deliberately ignore AbortSignal to test late-response ownership.
function mount(query = "") {
  const slots = [], calls = [], navigations = [];
  const timers = new Map(), listeners = new Map();
  let cursor = 0, timerId = 0, dirty = false, disposed = false, tree, effects = [];
  let now = Date.parse("2026-09-23T00:00:00Z");
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, (next) => {
        const value = typeof next === "function" ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; }
      }];
    },
    useRef(initial) { return (slots[cursor++] ??= { current: initial }); },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || changed(slots[i].deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, effect: fn, cleanup: fn() };
      });
    },
  };
  const setTimer = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; };
  const clearTimer = (id) => timers.delete(id);
  const router = { replace: (path) => navigations.push(path) };
  const params = new URLSearchParams(query);
  const context = vm.createContext({
    AbortController, DOMException, URL, console, setTimeout: setTimer, clearTimeout: clearTimer,
    Date: class extends Date { static now() { return now; } },
    window: {
      setTimeout: setTimer, clearTimeout: clearTimer, queueMicrotask,
      location: { assign: (path) => navigations.push(path) }, confirm: () => true,
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {}, getElementById: () => null },
    fetch(url, init = {}) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      calls.push({ url, init, reject,
        resolve: (body, status = 200) => resolve({ ok: status >= 200 && status < 300, status, json: async () => body }),
        headers: (json, status = 200) => resolve({ ok: status >= 200 && status < 300, status, json }),
      });
      return promise;
    },
  });
  function evaluate(source, dependencies) {
    const exports = {};
    const compiled = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    vm.runInContext(`(function(require,module,exports){${compiled}\n})`, context)(dependencies, { exports }, exports);
    return exports;
  }
  const requests = evaluate(requestSource, require);
  const component = evaluate(pageSource, (id) => {
    if (id === "react") return hooks;
    if (id === "next/navigation") return { useRouter: () => router, useSearchParams: () => params };
    if (id === "next/link") return { __esModule: true, default: "a" };
    if (id === "lucide-react") return new Proxy({}, { get: (_, key) => String(key) });
    if (id.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (id === "@/lib/auth/consent-policy") return { CURRENT_TERMS_VERSION: "test-terms", CURRENT_PRIVACY_VERSION: "test-privacy" };
    if (id === "@/lib/auth/client-requests") return requests;
    return require(id);
  }).default;
  function render() {
    cursor = 0; dirty = false; effects = [];
    tree = component();
    for (const effect of effects) effect();
  }
  render();
  return {
    calls, navigations,
    get tree() { return tree; },
    async settle() {
      for (let i = 0; i < 30; i += 1) { await Promise.resolve(); if (dirty && !disposed) render(); }
    },
    focus() { now += 1_100; listeners.get("focus")?.(); },
    elapse(delay) {
      now += delay;
      for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); }
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
function text(node) {
  if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object") return text(node.props?.children);
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}
const button = (h, label) => elements(h.tree, (node) => node.type === "button" && text(node) === label)[0];
const latest = (h, path) => h.calls.filter((call) => call.url === path).at(-1);
const profile = (id) => ({ id, provider: "naver", displayName: `USER-${id}`, name: null, nickname: id,
  displayNameMode: "nickname", boraAlias: null, email: null,
  youthPolicyProfile: { enabled: false, birthYear: null, region: null, status: null, interests: [] } });
const session = (id) => ({ authenticated: !!id, user: id ? profile(id) : null, providers: { naver: true }, signInPaths: { naver: "/api/auth/naver" } });
function account(count) {
  return { authenticated: true,
    consent: { accepted: true, requiresAcceptance: false, termsVersion: "test-terms", privacyVersion: "test-privacy", acceptedAt: null },
    inventory: Object.fromEntries(["accountIdentity", "displayProfiles", "opportunityProfiles", "financeSnapshots", "aiChatEvents", "aiMemories", "aiContextPreferences", "aiConversationContexts", "recentActivities", "categoryReadMarkers", "activeSessions", "consentRecords", "serviceUsageCounters"].map((key) => [key, count])),
  };
}
async function login(h, id) { latest(h, "/api/session").resolve(session(id)); await h.settle(); }
async function ready(h, id = "A") { await login(h, id); latest(h, "/api/account").resolve(account(11)); await h.settle(); }

test("late account body never crosses A to B or A to B to A account generations", async () => {
  for (const returnToA of [false, true]) {
    const h = mount();
    try {
      await login(h, "A");
      const old = latest(h, "/api/account");
      let finishOld;
      old.headers(() => new Promise((resolve) => { finishOld = resolve; }));
      await h.settle();
      h.focus(); await h.settle(); await login(h, "B");
      if (returnToA) { h.focus(); await h.settle(); await login(h, "A"); }
      latest(h, "/api/account").resolve(account(22)); await h.settle();
      finishOld(account(999)); await h.settle();
      assert.equal(old.init.signal.aborted, true);
      assert.match(text(h.tree), returnToA ? /USER-A님의/ : /USER-B님의/);
      assert.match(text(h.tree), /22건/);
      assert.doesNotMatch(text(h.tree), /999건/);
    } finally { h.unmount(); }
  }
});

test("late profile mutation is aborted and never replaces a different signed-in account", async () => {
  const h = mount();
  try {
    await ready(h);
    void button(h, "설정 저장").props.onClick(); await h.settle();
    const old = latest(h, "/api/profile");
    h.focus(); await h.settle(); await login(h, "B");
    latest(h, "/api/account").resolve(account(22)); await h.settle();
    old.resolve({ user: { ...profile("A"), displayName: "OLD-RESPONSE" } }); await h.settle();
    assert.equal(old.init.signal.aborted, true);
    assert.match(text(h.tree), /USER-B님의/);
    assert.doesNotMatch(text(h.tree), /OLD-RESPONSE|표시 이름 설정을 저장했습니다/);
    assert.equal(button(h, "설정 저장").props.disabled, false);
  } finally { h.unmount(); }
});

test("stalled session JSON times out with retry UI and late body cannot restore login", async () => {
  const h = mount();
  try {
    let finish;
    h.calls[0].headers(() => new Promise((resolve) => { finish = resolve; })); await h.settle();
    h.elapse(12_000); await h.settle();
    assert.match(text(h.tree), /로그인 확인 시간이 초과되었습니다/);
    assert.ok(button(h, "다시 확인"));
    finish(session("A")); await h.settle();
    assert.doesNotMatch(text(h.tree), /USER-A/);
    assert.equal(h.calls.length, 1);
  } finally { h.unmount(); }
});

test("stalled account JSON ends loading and a late body cannot display inventory", async () => {
  const h = mount();
  try {
    await login(h, "A");
    let finish;
    latest(h, "/api/account").headers(() => new Promise((resolve) => { finish = resolve; })); await h.settle();
    h.elapse(12_000); await h.settle();
    assert.match(text(h.tree), /동의 및 저장 데이터 현황을 불러오지 못했습니다/);
    finish(account(999)); await h.settle();
    assert.doesNotMatch(text(h.tree), /999건/);
  } finally { h.unmount(); }
});

test("StrictMode replay replaces aborted startup request and still loads account", async () => {
  const h = mount();
  try {
    h.strictReplay(); await h.settle();
    assert.equal(h.calls[0].init.signal.aborted, true);
    await ready(h);
    h.calls[0].resolve(session("STALE")); await h.settle();
    assert.match(text(h.tree), /USER-A님의/);
    assert.match(text(h.tree), /11건/);
    assert.doesNotMatch(text(h.tree), /STALE/);
  } finally { h.unmount(); }
});

test("logout synchronizes cookie-cleared 503, but not a generic unavailable response", async () => {
  for (const cookieCleared of [true, false]) {
    const h = mount();
    try {
      await ready(h);
      void button(h, "로그아웃").props.onClick(); await h.settle();
      latest(h, "/api/auth/logout").resolve(cookieCleared
        ? { loggedOut: true, storageAvailable: false } : { error: "unavailable" }, 503);
      await h.settle();
      if (cookieCleared) {
        assert.deepEqual(h.navigations, ["/"]);
        assert.doesNotMatch(text(h.tree), /USER-A|11건/);
      } else {
        assert.deepEqual(h.navigations, []);
        assert.match(text(h.tree), /로그아웃 결과를 확인하지 못했습니다/);
        assert.match(text(h.tree), /USER-A님의/);
      }
    } finally { h.unmount(); }
  }
});

test("expired or replayed login displays fixed friendly retry without implicitly consenting", async () => {
  const h = mount("auth=failed&auth_reason=login_retry_required&returnTo=https://attacker.test");
  try {
    await login(h, null);
    assert.match(text(h.tree), /로그인 요청이 만료되었거나 이미 사용되었습니다/);
    assert.doesNotMatch(text(h.tree), /attacker/);
    assert.ok(elements(h.tree, (node) => node.type === "a" && node.props.href === "#login-required-consent" && text(node) === "로그인 다시 시작하기").length);
    const consent = elements(h.tree, (node) => node.type === "input" && node.props.type === "checkbox")[0];
    assert.equal(consent.props.checked, false);
    assert.equal(h.calls.length, 1, "no automatic login retry or consent write");
  } finally { h.unmount(); }
});

test("logout and known expiry invalidate an in-flight session refresh before its late body resolves", async () => {
  for (const reason of ["logout", "expiry"]) {
    const h = mount();
    try {
      h.calls[0].resolve({ ...session("A"), expiresAt: Date.parse("2026-09-23T00:00:00Z") + 1_500 });
      await h.settle();
      latest(h, "/api/account").resolve(account(11)); await h.settle();
      h.focus(); await h.settle();
      const pendingSession = latest(h, "/api/session");
      let finish;
      pendingSession.headers(() => new Promise((resolve) => { finish = resolve; })); await h.settle();
      if (reason === "logout") {
        void button(h, "로그아웃").props.onClick(); await h.settle();
        latest(h, "/api/auth/logout").resolve({ loggedOut: true }); await h.settle();
      } else {
        h.elapse(1_500); await h.settle();
      }
      finish(session("A")); await h.settle();
      assert.equal(pendingSession.init.signal.aborted, true);
      assert.doesNotMatch(text(h.tree), /USER-A|11건/);
      assert.match(text(h.tree), /마이페이지를 사용하려면 로그인해 주세요/);
    } finally { h.unmount(); }
  }
});

test("uncertain account deletion never promises data was unchanged and is never retried", async () => {
  const h = mount();
  try {
    await ready(h);
    const acknowledge = elements(h.tree, (node) => node.type === "label" && node.props.className === "deleteAcknowledge")[0];
    elements(acknowledge, (node) => node.type === "input")[0].props.onChange({ target: { checked: true } });
    elements(h.tree, (node) => node.type === "input" && node.props["aria-describedby"] === "account-delete-help")[0].props.onChange({ target: { value: "회원탈퇴" } });
    await h.settle();
    button(h, "계정과 모든 사용자 데이터 삭제").props.onClick(); await h.settle();
    const deletion = h.calls.filter((call) => call.init.method === "DELETE")[0];
    deletion.headers(() => new Promise(() => {})); await h.settle();
    h.elapse(12_000); await h.settle();
    assert.match(text(h.tree), /삭제 완료 여부를 확인하지 못했습니다/);
    assert.doesNotMatch(text(h.tree), /데이터는 변경되지 않았습니다/);
    assert.equal(h.calls.filter((call) => call.init.method === "DELETE").length, 1);
    assert.deepEqual(h.navigations, []);
  } finally { h.unmount(); }
});
