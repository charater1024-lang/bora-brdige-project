import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI memory is opt-in and remains restricted to a literal consent plus Local runtime", async () => {
  const route = await readFile(new URL("../app/api/ai/route.ts", import.meta.url), "utf8");
  const historyRoute = await readFile(new URL("../app/api/ai/history/route.ts", import.meta.url), "utf8");

  assert.match(route, /const memoryContextRequested = body\.memoryConsent === true/u);
  assert.match(route, /const memoryConsent = personalContextAllowed && memoryContextRequested/u);
  assert.match(route, /memoryConsent\s*\?\s*getAiUserMemories\(user\.id\)/u);
  assert.match(route, /!memoryConsent \|\| legalGuidance[\s\S]*Promise\.resolve\(false\)[\s\S]*recordAiUserMemory/u);
  assert.match(route, /memoryConsent,/u);
  assert.match(historyRoute, /memoryRequiresExplicitConsent: true/u);
  assert.match(historyRoute, /memoryConsentDefault: false/u);
});

test("AI responses expose model, degraded-demo, rule, and evidence-context modes", async () => {
  const route = await readFile(new URL("../app/api/ai/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  for (const mode of ["model", "safe-demo", "provider-fallback", "rules"]) {
    assert.match(route, new RegExp(`"${mode}"`, "u"));
  }
  assert.match(route, /answerMode,/u);
  assert.match(route, /contextMode,/u);
  assert.match(page, /AI 미연결 · 고정 안전 안내/u);
  assert.match(page, /AI 연결 실패 · 고정 안전 안내/u);
  assert.match(page, /모델이 생성한 답변이 아닙니다/u);
  assert.match(page, /data\.demoReason === "provider_error"/u);
});

test("AI availability notices are allowlisted and remain manually retryable", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /providerError: data\.providerError === "model_warming" \|\| data\.providerError === "local_inference_busy" \|\| data\.providerError === "local_inference_timeout" \? data\.providerError : null/u);
  assert.match(page, /role="status"[^\n]*aiRuntimeNotice\[locale\]\[turn\.meta\.providerError\]/u);
  assert.match(page, /\(turn\.status === "error" \|\| turn\.meta\?\.providerError\)[^\n]*onClick=\{\(\) => retryAiTurn\(turn\)\} disabled=\{aiLoading\}/u);
});

test("AI counseling has no dead microphone control and no zero-valued spending chart", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(page, /\bMic\b|Voice input|weeklySpendingData/u);
  assert.doesNotMatch(page, /<BarChart\s+data=/u);
  assert.match(page, /memoryConsent: aiMemoryConsent/u);
  assert.match(page, /role="switch"/u);
  assert.match(page, /changeView\("assets"\)/u);
});

test("AI counseling keeps a bounded tab-only transcript with actionable failure and empty states", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /const AI_SESSION_TURN_LIMIT = 8/u);
  assert.match(page, /const \[aiSessionTurns, setAiSessionTurns\] = useState<AiSessionTurn\[\]>\(\[\]\)/u);
  assert.match(page, /\[\.\.\.turns, pendingTurn\]\.slice\(-AI_SESSION_TURN_LIMIT\)/u);
  assert.doesNotMatch(page, /localStorage[^\n]*(?:aiSessionTurns|ai-session|ai-transcript)/iu);
  assert.match(page, /status: "pending"/u);
  assert.match(page, /status: "error"/u);
  assert.match(page, /lastFailedAiTurn\?\.id === turn\.id/u);
  assert.match(page, /className="ai-retry-button"/u);
  assert.match(page, /turn\.status === "sign-in"[\s\S]*?href="\/mypage"/u);
  assert.match(page, /fetch(?:WithClientTimeout)?\("\/api\/finance\/snapshot"/u);
  assert.match(page, /className="panel ai-insights-empty"/u);
  assert.match(page, /<Link className="primary-button" href="\/assets"/u);
  assert.doesNotMatch(page, /aiT\.savingTips\.map/u);
  assert.match(page, /<details className="panel evidence-panel ai-evidence-disclosure">/u);
  assert.match(styles, /\.chat-transcript \{[^}]*overflow-y: auto/u);
  assert.match(styles, /\.ai-insights-empty \{[^}]*grid-column: span 2/u);
});
