import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import ts from "typescript";
import vm from "node:vm";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: "silent",
  resolve: { alias: { "@": root } }, server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] } });
test.after(() => server.close());
const { selectLawExcerptCandidate, parseLawExcerptCandidate, lawExcerptQualityCacheModel } = await server.ssrLoadModule("/lib/legal/financial-law-summary-quality.ts");
const { financialLawSummaryCacheIdentity } = await server.ssrLoadModule("/lib/legal/financial-law-summary-cache.ts");
const guidance = {
  topic: "depositor-protection", publisher: "국가법령정보센터",
  law: { lawId: "1", mst: "1", lawName: "예금자보호법", effectiveDate: "20260101", retrievedAt: "2026-09-01", sourceUrl: "https://www.law.go.kr" },
  articles: [
    { sourceId: "law:30", articleNumber: "30", articleTitle: "보험료", text: "부보금융회사는 잔액에 1천분의5를 넘지 아니하는 범위에서 대통령령으로 정하는 비율을 곱한 금액을 납부한다.", sourceUrl: "https://www.law.go.kr" },
    { sourceId: "law:31", articleNumber: "31", articleTitle: "보험금", text: "공사는 그 부보금융회사의 예금자등의 청구에 의하여 보험금을 지급한다.", sourceUrl: "https://www.law.go.kr" },
  ],
};
test("higher-priority consumer article is selected without deleting or rewriting a block", () => {
  const result = selectLawExcerptCandidate(guidance, "ko", { order: ["S2", "S1"] });
  assert.equal(result.selected, true);
  assert.ok(result.score > result.baselineScore);
  assert.ok(result.summary.indexOf("제31조") < result.summary.indexOf("제30조"));
  for (const article of guidance.articles) assert.ok(result.summary.includes(article.text));
});
test("equal or lower ordering scores never replace the baseline", () => {
  assert.equal(selectLawExcerptCandidate(guidance, "ko", { order: ["S1", "S2"] }).selected, false);
  const betterBaseline = { ...guidance, articles: [...guidance.articles].reverse() };
  assert.equal(selectLawExcerptCandidate(betterBaseline, "ko", { order: ["S2", "S1"] }).selected, false);
});
test("missing/duplicate/unknown IDs and changes to rates, conditions or claimants are rejected", () => {
  for (const bad of [{ order: ["S2"] }, { order: ["S2", "S2"] }, { order: ["S2", "S9"] },
    { order: ["S2", "S1"], summary: "매년 5%를 납부한다" },
    { order: ["S2", "S1"], text: "부보금융회사에 지급한다" },
    { order: ["S2", "S1"], exception: "조건 없음" }]) {
    assert.equal(selectLawExcerptCandidate(guidance, "ko", bad).selected, false);
  }
  assert.equal(parseLawExcerptCandidate("법령 요약: 5%를 납부합니다"), null);
});
test("quality identity is tied to model, rubric, official text and never the no-model legacy identity", async () => {
  const make = (model, official = guidance) => financialLawSummaryCacheIdentity({ guidance: official, locale: "ko", provider: "local", configuredModel: model });
  const current = await make(lawExcerptQualityCacheModel("model-a"));
  assert.notEqual(current.cacheKey, (await make(lawExcerptQualityCacheModel("model-b"))).cacheKey);
  assert.notEqual(current.cacheKey, (await make("official-excerpts-no-model")).cacheKey);
  assert.notEqual(current.cacheKey, (await make("model-a:future-rubric-v2")).cacheKey);
  const changed = { ...guidance, articles: guidance.articles.map(a => ({ ...a, text: a.text + " 추가 조건." })) };
  assert.notEqual(current.cacheKey, (await make(lawExcerptQualityCacheModel("model-a"), changed)).cacheKey);
});
test("bounded, deduplicated local attempts also save negative results; ready winners cannot be overwritten", async () => {
  const route = await readFile(new URL("../app/api/legal/financial/summary/route.ts", import.meta.url), "utf8");
  const cache = await readFile(new URL("../lib/legal/financial-law-summary-cache.ts", import.meta.url), "utf8");
  assert.match(route, /AI_TIMEOUT_MS: "3000"/u);
  assert.match(route, /AbortSignal.timeout\(1_500\)/u);
  assert.match(route, /if \(orderedCache\)/u);
  assert.match(route, /summary: JSON.stringify\(\{ order: quality.order \}\)/u);
  assert.match(cache, /status <> 'ready' AND lock_until <=/u);
  assert.match(cache, /WHERE cache_key = \? AND status = 'generating' AND lock_token = \?/u);
});

test("route deduplicates contenders, keeps its winner, and caches negative evaluation per model", async () => {
  const requestBody = await server.ssrLoadModule("/lib/http/request-body.ts");
  const cacheModule = await server.ssrLoadModule("/lib/legal/financial-law-summary-cache.ts");
  const qualityModule = await server.ssrLoadModule("/lib/legal/financial-law-summary-quality.ts");
  const law = await server.ssrLoadModule("/lib/legal/financial-law.ts");
  const rows = new Map();
  let model = "model-a";
  let generations = 0;
  let candidate = '{"order":["S2","S1"]}';
  const cache = { ...cacheModule,
    async readCachedFinancialLawSummary(id) { const row = rows.get(id.cacheKey); return row?.ready ? row : null; },
    async claimFinancialLawSummaryGeneration(id) { if (rows.has(id.cacheKey)) return null; rows.set(id.cacheKey, { ready: false }); return "lease"; },
    async saveGeneratedFinancialLawSummary(input) { const row = rows.get(input.identity.cacheKey); if (!row || row.ready) return false;
      rows.set(input.identity.cacheKey, { ready: true, summary: input.summary, generatedAt: 1 }); return true; },
  };
  const source = await readFile(new URL("../app/api/legal/financial/summary/route.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Request, Response, Date, Set, JSON, AbortSignal,
    fetch: async () => Response.json({ model_state: "ready", selected_model: model }),
    require(name) {
      if (name.endsWith("/http/request-body")) return requestBody;
      if (name.endsWith("/auth/http")) return { requireSameOrigin: async () => true };
      if (name.endsWith("/financial-law")) return law;
      if (name.endsWith("/financial-law-cache")) return { readFinancialLawGuidanceCache: async () => ({ fresh: true, guidance }) };
      if (name.endsWith("/financial-law-summary-cache")) return cache;
      if (name.endsWith("/financial-law-summary-quality")) return qualityModule;
      if (name.endsWith("/selected-runtime")) return { selectedAiRuntime: async () => ({ provider: "local", model, billingRisk: false, env: { LOCAL_LLM_BASE_URL: "http://127.0.0.1:11435/v1" } }) };
      if (name.endsWith("/current-user")) return { authenticatedUser: async () => ({ id: "synthetic" }) };
      if (name.endsWith("/rate-limit")) return { claimAiRequestRateLimit: async () => ({ allowed: true }) };
      if (name.endsWith("/providers")) return { generateAICompletion: async () => { generations++; await Promise.resolve(); return { content: candidate, model, demo: false }; } };
      if (name.endsWith("/runtime-settings")) return { runtimeSecret: async () => "synthetic" };
      throw Error("unexpected dependency");
    },
  });
  const invoke = async () => (await exports.POST(new Request("https://example.test/api/legal/financial/summary", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: "deposit_protection" }) }))).json();
  const simultaneous = await Promise.all([invoke(), invoke()]);
  assert.equal(generations, 1);
  assert.ok(simultaneous.some(result => result.quality.selected));
  candidate = '{"order":["S1","S2"]}';
  const winner = await invoke();
  assert.equal(winner.quality.selected, true);
  assert.equal(winner.quality.cacheHit, true);
  assert.equal(generations, 1);
  model = "model-b";
  const negative = await invoke();
  assert.equal(negative.quality.selected, false);
  assert.equal(generations, 2);
  assert.equal((await invoke()).quality.cacheHit, true);
  assert.equal(generations, 2);
});
