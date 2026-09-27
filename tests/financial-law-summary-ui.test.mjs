import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/components/financial-law-safety.tsx", import.meta.url), "utf8");
test("law disclosures expose expanded state and requests have bounded client timeouts", () => {
  assert.match(source, /function AccessibleDisclosure/u);
  assert.match(source, /aria-expanded=\{expanded\} aria-controls=\{contentId\}/u);
  assert.match(source, /LAW_TOPIC_REQUEST_TIMEOUT_MS = 15_000/u);
  assert.match(source, /LAW_SUMMARY_REQUEST_TIMEOUT_MS = 45_000/u);
  assert.match(source, /controller\.abort\(new DOMException\("Summary request timed out", "TimeoutError"\)\)/u);
});
test("summary copy identifies AI prioritization without claiming rewritten legal advice", () => {
  assert.match(source, /핵심 조항 요약 · 공식 원문 기반/u);
  assert.match(source, /로컬 AI가 사용자 권리·보호와 가까운 조항을 우선 배치/u);
  assert.match(source, /법률 문장은 재작성하지 않습니다/u);
});
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

// Execute the real component and event callbacks with deterministic hooks and
// deferred fetches that intentionally IGNORE abort, exercising the serial guard.
function harness() {
  const slots = []; const effects = []; const pending = []; const requests = [];
  let index = 0; let locale = "ko"; let tree; let writes = 0;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], value => { writes++; slots[slot] = typeof value === "function" ? value(slots[slot]) : value; }]; },
    useRef(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; },
    useLayoutEffect(callback, deps) { const slot = index++; const old = effects[slot];
      if (!old || deps.some((dep, i) => dep !== old.deps[i])) {
        pending.push(() => { old?.cleanup?.(); effects[slot] = { deps, cleanup: callback() }; });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, Intl, Date, queueMicrotask,
    window: { confirm: () => true, setTimeout, clearTimeout },
    fetch(url, options) { return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })); },
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "lucide-react") return new Proxy({}, { get: (_target, key) => key });
      if (name.endsWith(".css")) return { default: new Proxy({}, { get: (_target, key) => key }) };
      throw Error(`Unexpected import ${name}`);
    },
  });
  function render(nextLocale = locale) {
    locale = nextLocale; index = 0; tree = exports.FinancialLawSafety({ locale });
    while (pending.length) pending.shift()();
    return tree;
  }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(child => nodes(child));
    if (!node || typeof node !== "object") return [];
    return [node, ...nodes(node.props?.children ?? null)];
  }
  render(); render();
  return { requests, render, snapshot: () => slots.slice(0, 5), writes: () => writes,
    topic(number) { render(); return nodes().filter(node => node.type === "button" && "aria-pressed" in node.props)[number].props.onClick; },
    approval() { render(); return nodes().find(node => node.type === "button" && typeof node.props.children === "string" && node.props.children.includes("비용 확인"))?.props.onClick; },
    unmount() { for (const effect of effects) effect?.cleanup?.(); },
  };
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function reply(request, payload, status = 200) { request.resolve({ ok: status < 400, status, json: async () => payload }); }
function official(name) { return { status: "verified", retrievedAt: "2026-09-01", laws: [{ id: name, name, ministry: "기관", effectiveDate: "2026-01-01", sourceUrl: "https://www.law.go.kr", articles: [] }] }; }

test("late previous-topic summary cannot appear beside the newly selected law", async () => {
  const h = harness(); h.topic(4)(); reply(h.requests[0], official("예금자보호법")); await tick();
  const oldSummary = h.requests[1];
  h.topic(5)(); assert.equal(oldSummary.options.signal.aborted, true);
  reply(h.requests[2], official("채권추심법")); await tick();
  reply(h.requests[3], { status: "ready", summary: "새 법령 발췌" }); await tick();
  reply(oldSummary, { status: "ready", summary: "이전 법령 발췌" }); await tick();
  assert.equal(h.snapshot()[2].laws[0].name, "채권추심법");
  assert.equal(h.snapshot()[4].summary, "새 법령 발췌");
  h.unmount();
});
test("late failure cannot replace current ready summary with unavailable", async () => {
  const h = harness(); h.topic(4)(); reply(h.requests[0], official("A")); await tick();
  const stale = h.requests[1]; h.topic(5)(); reply(h.requests[2], official("B")); await tick();
  reply(h.requests[3], { status: "ready", summary: "B" }); await tick();
  stale.reject(Error("late network failure")); await tick();
  assert.equal(h.snapshot()[3], "ready"); assert.equal(h.snapshot()[4].summary, "B"); h.unmount();
});
test("late guidance is ignored and never starts a wrong-topic summary", async () => {
  const h = harness(); const chooseB = h.topic(5); h.topic(4)(); chooseB();
  reply(h.requests[1], official("B")); await tick();
  reply(h.requests[0], official("A")); await tick();
  assert.equal(h.requests.length, 3);
  assert.equal(JSON.parse(h.requests[2].options.body).topic, "debt_collection");
  assert.equal(h.snapshot()[2].laws[0].name, "B"); h.unmount();
});
test("locale change invalidates outstanding summary and stale paid approval callback", async () => {
  const h = harness(); h.topic(4)(); reply(h.requests[0], official("A")); await tick();
  reply(h.requests[1], { status: "approval-required", approvalAvailable: true, provider: "old", model: "old" }); await tick();
  const approve = h.approval(); assert.equal(typeof approve, "function");
  h.topic(5)(); const count = h.requests.length; approve(); assert.equal(h.requests.length, count);
  reply(h.requests[2], official("B")); await tick(); const pendingSummary = h.requests[3];
  h.render("en"); assert.equal(pendingSummary.options.signal.aborted, true);
  reply(pendingSummary, { status: "ready", summary: "늦은 한국어" }); await tick();
  assert.equal(h.snapshot()[0], null); assert.equal(h.snapshot()[4], null); h.unmount();
});
test("unmount aborts pending work and prevents late state writes", async () => {
  const h = harness(); h.topic(4)(); reply(h.requests[0], official("A")); await tick();
  const request = h.requests[1]; h.unmount(); const writes = h.writes();
  reply(request, { status: "ready", summary: "late" }); await tick();
  assert.equal(request.options.signal.aborted, true); assert.equal(h.writes(), writes);
});
