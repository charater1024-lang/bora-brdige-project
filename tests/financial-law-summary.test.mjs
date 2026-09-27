import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import ts from "typescript";
import vm from "node:vm";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": projectRoot } },
  server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const {
  FINANCIAL_LAW_SUMMARY_PROMPT_VERSION,
  financialLawSummaryCacheIdentity,
  buildOfficialLawExcerptSummary, reusableOfficialLawExcerpt,
} = await server.ssrLoadModule("/lib/legal/financial-law-summary-cache.ts");
test.after(() => server.close());

function guidance(overrides = {}) {
  return {
    status: "official-current",
    topic: "financial-consumer-protection",
    topicLabel: "Financial consumer protection",
    publisher: "Korea Law Information Center",
    law: {
      lawId: "013704",
      mst: "277247",
      lawName: "Financial Consumer Protection Act",
      promulgationDate: "20251001",
      promulgationNumber: "21065",
      effectiveDate: "20260102",
      ministry: "Financial Services Commission",
      retrievedAt: "2026-07-28T00:00:00.000Z",
      sourceUrl: "https://www.law.go.kr/law/financial-consumer-protection",
      ...overrides,
    },
    articles: [{
      sourceId: "law-go-kr:013704:001900:20260102",
      articleKey: "001900",
      articleNumber: "19",
      articleTitle: "Duty to explain",
      text: "The official article text used for a bounded summary.",
      effectiveDate: overrides.effectiveDate ?? "20260102",
      sourceUrl: "https://www.law.go.kr/law/financial-consumer-protection/article19",
    }],
  };
}

test("shared law-summary identity is model, locale, prompt, and official-version aware", async () => {
  const base = await financialLawSummaryCacheIdentity({
    guidance: guidance(),
    locale: "ko",
    provider: "local",
    configuredModel: "exaone3.5:2.4b",
  });
  const same = await financialLawSummaryCacheIdentity({
    guidance: guidance(),
    locale: "ko",
    provider: "local",
    configuredModel: "exaone3.5:2.4b",
  });
  const otherModel = await financialLawSummaryCacheIdentity({
    guidance: guidance(),
    locale: "ko",
    provider: "local",
    configuredModel: "qwen2.5:1.5b",
  });
  const otherLocale = await financialLawSummaryCacheIdentity({
    guidance: guidance(),
    locale: "en",
    provider: "local",
    configuredModel: "exaone3.5:2.4b",
  });
  const otherOfficialVersion = await financialLawSummaryCacheIdentity({
    guidance: guidance({ mst: "277248", effectiveDate: "20260701" }),
    locale: "ko",
    provider: "local",
    configuredModel: "exaone3.5:2.4b",
  });

  assert.equal(FINANCIAL_LAW_SUMMARY_PROMPT_VERSION, "financial-law-official-excerpts-v3");
  assert.equal(base.cacheKey, same.cacheKey);
  assert.notEqual(base.cacheKey, otherModel.cacheKey);
  assert.notEqual(base.cacheKey, otherLocale.cacheKey);
  assert.notEqual(base.cacheKey, otherOfficialVersion.cacheKey);
  assert.equal(base.lawVersion, "277247:20260102");
});

test("official excerpts are server-owned and free-form or paid generations are forbidden", async () => {
  const route = await readFile(new URL("../app/api/legal/financial/summary/route.ts", import.meta.url), "utf8");
  assert.match(route, /readFinancialLawGuidanceCache\(parsed\.topic\)/u);
  assert.match(route, /reusableOfficialLawExcerpt\(cached\?\.summary, summary\)/u);
  assert.match(route, /aiGenerated: false/u);
  assert.match(route, /official-excerpts-no-model/u);
  assert.match(route, /selected\?\.provider === "local" && !selected\.billingRisk/u);
  assert.match(route, /Never write or rewrite law text/u);
  assert.doesNotMatch(route, /plainSummary|body\.(?:law|articles|officialText|sourceText)/u);
});

test("empty official passages stop before shared cache lookup", async () => {
  const route = await readFile(new URL("../app/api/legal/financial/summary/route.ts", import.meta.url), "utf8");
  assert.ok(route.indexOf("if (!summary)") < route.indexOf("const identity = await"));
  assert.match(route, /official_law_context_insufficient,?["']/u);
  assert.equal(buildOfficialLawExcerptSummary({ ...guidance(), articles: [] }, "ko"), "");
});

test("retrieval versions and explicit omissions invalidate a shared summary fingerprint", async () => {
  const original = guidance();
  const args = { locale: "ko", provider: "local", configuredModel: "exaone3.5:2.4b" };
  const legacy = await financialLawSummaryCacheIdentity({ ...args, guidance: original });
  const current = await financialLawSummaryCacheIdentity({ ...args, guidance: { ...original, retrievalVersion: 2 } });
  const omitted = await financialLawSummaryCacheIdentity({ ...args, guidance: {
    ...original, retrievalVersion: 2,
    articles: original.articles.map((article) => ({ ...article, textTruncated: true, omittedPassageCount: 1 })),
  } });
  assert.notEqual(legacy.cacheKey, current.cacheKey);
  assert.notEqual(current.cacheKey, omitted.cacheKey);
});

test("law guide explains cross-user reuse and never auto-approves a billable summary", async () => {
  const component = await readFile(
    new URL("../app/components/financial-law-safety.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /모든 사용자에게 공통으로 재사용/u);
  assert.match(component, /window\.confirm\(s\.paidConfirm\)/u);
  assert.match(component, /method: explicitBillableGeneration \? "PUT" : "POST"/u);
  assert.match(component, /className=\{styles\.lawCard\}/u);
  assert.match(component, /className=\{styles\.articleDisclosure\}/u);
  assert.match(component, /className=\{styles\.summaryDisclosure\}/u);
  assert.match(component, /className=\{styles\.checklist\}/u);
});

test("the shared summary cache has a durable D1 migration and bounded lookup indexes", async () => {
  const migration = await readFile(
    new URL("../drizzle/0014_chilly_salo.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE `financial_law_summary_cache`/u);
  assert.match(migration, /`cache_key` text PRIMARY KEY NOT NULL/u);
  assert.match(migration, /financial_law_summary_runtime_idx/u);
  assert.match(migration, /financial_law_summary_source_idx/u);
});

test("deposit law excerpts preserve one-in-a-thousand units and claimant without AI paraphrase", () => {
  const fixture = guidance();
  fixture.articles = [
    { ...fixture.articles[0], articleNumber: "30", articleTitle: "보험료",
      text: "부보금융회사는 매년 잔액에 1천분의5를 넘지 아니하는 범위에서 대통령령으로 정하는 비율을 곱한 금액을 보험료로 납부하여야 한다." },
    { ...fixture.articles[0], sourceId: "law-go-kr:013704:003100:20260102", articleNumber: "31", articleTitle: "보험금",
      text: "공사는 그 부보금융회사의 예금자등의 청구에 의하여 보험금을 지급한다." },
  ];
  const expected = buildOfficialLawExcerptSummary(fixture, "ko");
  for (const article of fixture.articles) assert.ok(expected.includes(article.text));
  assert.equal(reusableOfficialLawExcerpt(expected, expected), true);
  assert.equal(reusableOfficialLawExcerpt(expected.replace("1천분의5", "5%"), expected), false);
  assert.equal(reusableOfficialLawExcerpt(expected.replace("예금자등의 청구에 의하여", "청구에 의하여 부보금융회사에"), expected), false);
  assert.equal(reusableOfficialLawExcerpt("부보금융회사는 잔액의 5%를 납부한다. 공사는 부보금융회사에 보험금을 지급한다.", expected), false);
  assert.equal(reusableOfficialLawExcerpt("", ""), false);
});

test("legacy v1/v2 AI cache keys cannot match the official-excerpt policy", async () => {
  const identity = await financialLawSummaryCacheIdentity({ guidance: guidance(), locale: "ko", provider: "local", configuredModel: "official-excerpts-no-model" });
  for (const version of ["financial-law-summary-v1", "financial-law-summary-v2"]) {
    const material = ["bora-financial-law-summary", "local", "official-excerpts-no-model", "ko", version, identity.sourceFingerprint].join("\0");
    const legacyKey = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material))).toString("hex");
    assert.notEqual(identity.cacheKey, legacyKey);
  }
});

test("localized presentation explicitly identifies original Korean excerpts as non-AI text", () => {
  for (const locale of ["ko", "en", "ja", "zh"]) {
    const text = buildOfficialLawExcerptSummary(guidance(), locale);
    assert.ok(text.includes(guidance().articles[0].text));
    assert.match(text, /AI/u);
  }
});

test("real route reuses only exact excerpts, rejects poisoned cache, and survives cache failure without a model", async () => {
  const requestBody = await server.ssrLoadModule("/lib/http/request-body.ts");
  const routeText = await readFile(new URL("../app/api/legal/financial/summary/route.ts", import.meta.url), "utf8");
  const law = await server.ssrLoadModule("/lib/legal/financial-law.ts");
  const quality = await server.ssrLoadModule("/lib/legal/financial-law-summary-quality.ts");
  const fixture = guidance();
  const expected = buildOfficialLawExcerptSummary(fixture, "ko");
  let cached = null;
  let unavailable = false;
  let fresh = true;
  let writes = 0;
  const cache = {
    buildOfficialLawExcerptSummary, reusableOfficialLawExcerpt, financialLawSummaryCacheIdentity,
    async readCachedFinancialLawSummary() { if (unavailable) throw Error("synthetic cache unavailable"); return cached; },
    async claimFinancialLawSummaryGeneration() { return cached || unavailable ? null : "lease"; },
    async saveGeneratedFinancialLawSummary(input) { writes++; cached = { summary: input.summary, generatedAt: 1 }; return true; },
  };
  const output = ts.transpileModule(routeText, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, Request, Response, Date, Set, JSON,
    require(name) {
      if (name.endsWith("/http/request-body")) return requestBody;
      if (name.endsWith("/auth/http")) return { requireSameOrigin: async () => true };
      if (name.endsWith("/financial-law")) return law;
      if (name.endsWith("/financial-law-cache")) return { readFinancialLawGuidanceCache: async () => ({ fresh, guidance: fixture }) };
      if (name.endsWith("/financial-law-summary-cache")) return cache;
      if (name.endsWith("/financial-law-summary-quality")) return quality;
      if (name.endsWith("/selected-runtime")) return { selectedAiRuntime: async () => null };
      if (name.endsWith("/current-user")) return { authenticatedUser: async () => null };
      if (name.endsWith("/rate-limit")) return { claimAiRequestRateLimit: async () => { throw Error("model forbidden"); } };
      if (name.endsWith("/providers")) return { generateAICompletion: async () => { throw Error("model forbidden"); } };
      if (name.endsWith("/runtime-settings")) return { runtimeSecret: async () => "synthetic-public-source-enabled" };
      throw Error(`Unexpected dependency (model/network forbidden): ${name}`);
    },
  });
  const invoke = () => exports.POST(new Request("https://example.test/api/legal/financial/summary", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: "deposit_protection", locale: "ko" }),
  }));
  let result = await (await invoke()).json();
  assert.equal(result.summary, expected);
  assert.equal(result.aiGenerated, false);
  assert.equal(result.cache.hit, false);
  assert.equal(writes, 1);
  result = await (await invoke()).json();
  assert.equal(result.cache.hit, true);
  assert.equal(writes, 1);
  cached = { summary: "부보금융회사는 5%를 납부하며 부보금융회사에 보험금을 지급한다.", generatedAt: 1 };
  result = await (await invoke()).json();
  assert.equal(result.summary, expected);
  assert.equal(result.cache.hit, false);
  unavailable = true;
  result = await (await invoke()).json();
  assert.equal(result.summary, expected);
  assert.equal(result.cache.stored, false);
  fresh = false;
  assert.equal((await invoke()).status, 409);
});
