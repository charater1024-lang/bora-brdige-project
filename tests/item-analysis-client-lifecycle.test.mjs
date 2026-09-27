import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../app/components/public-information-pages.tsx", import.meta.url),
  "utf8",
);

function functionBody(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf("\n  async function ", start + 1);
  const render = source.indexOf("\n  return <li", start + 1);
  return source.slice(start, Math.min(...[next, render].filter((value) => value > start)));
}

test("free item explanations have an overall timeout and cancel stale work", () => {
  const body = functionBody("loadAnalysis");
  assert.match(source, /ITEM_ANALYSIS_REQUEST_TIMEOUT_MS = 30_000/u);
  assert.match(body, /analysisRequestRef\.current = requestId/u);
  assert.match(body, /analysisAbortRef\.current\?\.abort\(\)/u);
  assert.match(body, /signal: controller\.signal/u);
  assert.match(body, /controller\.abort\(new DOMException\("Item analysis request timed out", "TimeoutError"\)\)/u);
  assert.match(body, /if \(!ownsRequest\(\)\) return;/u);
  assert.match(body, /if \(timedOut\) throw new DOMException/u);
  assert.match(body, /controller\.signal\.addEventListener\("abort", cancelDelay/u);
  assert.match(body, /setAnalysisState\("failed"\)/u);
});

test("approved billable generation is one guarded PUT with no automatic retry", () => {
  const body = functionBody("generateBillableAnalysis");
  assert.match(source, /BILLABLE_ITEM_ANALYSIS_REQUEST_TIMEOUT_MS = 60_000/u);
  assert.match(body, /billableRequestPendingRef\.current/u);
  assert.match(body, /method: "PUT"/u);
  assert.equal((body.match(/method: "PUT"/gu) ?? []).length, 1);
  assert.doesNotMatch(body, /for \(let attempt|while \(/u);
  assert.match(body, /signal: controller\.signal/u);
  assert.match(body, /Billable item analysis request timed out/u);
  assert.match(body, /if \(!ownsRequest\(\)\) return;/u);
});

test("unmount and locale changes cannot commit an old item explanation", () => {
  assert.match(source, /key=\{`\$\{locale\}:\$\{item\.id\}`\}/u);
  assert.match(source, /useEffect\(\(\) => \(\) => \{\s*analysisRequestRef\.current \+= 1;\s*analysisAbortRef\.current\?\.abort\(\)/u);
});
