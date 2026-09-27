import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

let workerPromise;

async function getWorker() {
  if (!workerPromise) {
    const workerUrl = new URL("../dist/server/index.js", import.meta.url);
    workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
    workerPromise = import(workerUrl.href).then((module) => module.default);
  }
  return workerPromise;
}

async function request(path = "/", init = {}) {
  const worker = await getWorker();
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the BORA Bridge product shell", async () => {
  const response = await request("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /href="\/challenge"/u);
  assert.match(html, /<title>BORA Bridge \| 오늘의 금융 행동을 잇는 AI 동반자<\/title>/i);
  assert.match(html, /공식 공공정보와 사용자가 직접 입력한 금융 프로필/);
  assert.match(html, />한국어<\/option>/);
  assert.match(html, />English<\/option>/);
  assert.match(html, />日本語<\/option>/);
  assert.match(html, />简体中文<\/option>/);
  assert.match(html, /쉬운 모드/);
  assert.match(html, /홈 편집/);
  assert.match(html, /공식 금융·정책 정보/);
  assert.match(html, /청년 정책 정보/);
  assert.match(html, /금융 정보/);
  assert.match(html, /창업·상권 정보/);
  assert.match(html, /직접 입력 · 계정 저장/);
  assert.doesNotMatch(html, /연결된 자산 정보 0건/);
  assert.match(html, /AI 상담/);
  assert.doesNotMatch(html, /42,800,000|3,248\.18|92% 일치|12만원 더 모을/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("the challenge walkthrough is public without a session", async () => {
  const response = await request("/challenge", {
    headers: { accept: "text/html" },
  });

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /bora-challenge-2026-v1/u);
  assert.match(html, /<title>BORA Bridge란\? \| 서비스 소개<\/title>/u);
  assert.match(html, /3분 서비스 둘러보기/u);
  assert.match(html, /src="\/bora-mascot\.webp"/u);
  assert.doesNotMatch(html, />3분 심사 시작</u);
  assert.doesNotMatch(html, />Finance AI · Review mode</u);
});

test("phishing API returns explainable high-risk signals", async () => {
  const response = await request("/api/phishing", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({
      locale: "ko",
      text: "[긴급] 오늘 안에 안전계좌로 송금하고 OTP 인증번호를 보내세요. https://bit.ly/check-now",
    }),
  });
  assert.equal(response.status, 200);

  const result = await response.json();
  assert.equal(result.riskLevel, "high");
  assert.ok(result.score >= 65);
  assert.ok(result.signals.some((signal) => signal.id === "credential-request"));
  assert.ok(result.signals.some((signal) => signal.id === "payment-request"));
  assert.equal("confidence" in result, false);
  assert.equal(result.assessmentStatus, "partial");
  assert.equal(result.scoreBreakdown.total, result.score);
  assert.equal(result.urlReputation.queryParametersRemoved, true);
  assert.equal(result.urlReputation.status, "not-consented");
  assert.equal(result.urlReputation.consentApplied, false);
  assert.equal(result.urlReputation.provider, null);
  assert.equal(result.urlReputation.advisory, false);
  assert.ok(Array.isArray(result.recommendedActions));
  assert.ok(result.recommendedActions.length > 0);
  assert.ok(result.disclaimer);
  assert.equal(result.contacts.policeEmergency, "112");
  assert.equal(result.contacts.phishingHotline, "1394");
  assert.equal(result.contacts.kisaIncidentHelp, "118");
});

test("phishing API rejects oversized bodies before JSON parsing", async () => {
  const response = await request("/api/phishing", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-forwarded-for": "198.51.100.77",
    },
    body: "x".repeat(60_001),
  });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "Request body is too large." });
});

test("AI API rejects anonymous requests before a billable provider can be selected", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBillingPolicy = process.env.DISABLE_BILLABLE_APIS;
  process.env.OPENAI_API_KEY = "test-key-that-must-never-be-called";
  process.env.DISABLE_BILLABLE_APIS = "true";
  try {
    const response = await request("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        locale: "ko",
        provider: "openai",
        message: "피싱 의심 문자를 받았을 때 어떻게 해야 하나요?",
      }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBillingPolicy === undefined) delete process.env.DISABLE_BILLABLE_APIS;
    else process.env.DISABLE_BILLABLE_APIS = previousBillingPolicy;
  }
});

test("anonymous requests cannot bypass paid-provider opt-in", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousBillingPolicy = process.env.DISABLE_BILLABLE_APIS;
  process.env.OPENAI_API_KEY = "test-key-that-must-never-be-called";
  process.env.DISABLE_BILLABLE_APIS = "false";
  try {
    const response = await request("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        locale: "ko",
        provider: "openai",
        message: "명시적으로 켜지 않은 유료 모델은 호출하지 마세요.",
      }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousBillingPolicy === undefined) delete process.env.DISABLE_BILLABLE_APIS;
    else process.env.DISABLE_BILLABLE_APIS = previousBillingPolicy;
  }
});

test("anonymous requests cannot reach a configured local endpoint", async () => {
  const previousBaseUrl = process.env.LOCAL_LLM_BASE_URL;
  process.env.LOCAL_LLM_BASE_URL = "http://127.0.0.1:11434/v1";
  try {
    const response = await request("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        locale: "ko",
        provider: "local",
        message: "선택되지 않은 로컬 모델에는 연결하지 마세요.",
      }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
  } finally {
    if (previousBaseUrl === undefined) delete process.env.LOCAL_LLM_BASE_URL;
    else process.env.LOCAL_LLM_BASE_URL = previousBaseUrl;
  }
});

test("public-data API returns a zero cache state without credentials", async () => {
  const previousKey = process.env.KOREA_EXIM_API_KEY;
  process.env.KOREA_EXIM_API_KEY = "";
  try {
    const response = await request("/api/public-data?source=exim&date=20260721&currencies=USD,JPY,CNY,EUR,GBP");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.demo, false);
    assert.equal(result.integrationStatus, "empty");
    assert.deepEqual(result.rates, []);
    assert.equal(result.cached, false);
  } finally {
    process.env.KOREA_EXIM_API_KEY = previousKey;
  }
});

test("public-data keys are not used when no persisted activation state is available", async () => {
  const previousKey = process.env.KOREA_EXIM_API_KEY;
  process.env.KOREA_EXIM_API_KEY = "test-public-data-key-that-must-not-be-called";
  try {
    const response = await request("/api/public-data?source=exim&date=20260721&currencies=USD");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.demo, false);
    assert.deepEqual(result.rates, []);
    assert.equal(result.cached, false);
  } finally {
    if (previousKey === undefined) delete process.env.KOREA_EXIM_API_KEY;
    else process.env.KOREA_EXIM_API_KEY = previousKey;
  }
});

test("session API does not expose ChatGPT sign-in or trust forwarded ChatGPT identity", async () => {
  const anonymous = await request("/api/session");
  assert.equal(anonymous.status, 200);
  assert.deepEqual(await anonymous.json(), {
    authenticated: false,
    user: null,
    provider: null,
    providers: { google: false, kakao: false, naver: false },
    signInPaths: {},
    signInPath: null,
  });

  const authenticated = await request("/api/session", {
    headers: {
      "oai-authenticated-user-email": "jimin@example.com",
      "oai-authenticated-user-full-name": encodeURIComponent("김지민"),
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
    },
  });
  assert.equal(authenticated.status, 200);
  assert.deepEqual(await authenticated.json(), {
    authenticated: false,
    user: null,
    provider: null,
    providers: { google: false, kakao: false, naver: false },
    signInPaths: {},
    signInPath: null,
  });
});

test("developer settings API never exposes data to an anonymous request", async () => {
  const response = await request("/api/developer/settings");
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
});

test("AI explanation cache administration remains developer-only and same-origin", async () => {
  const status = await request("/api/developer/explanation-cache");
  assert.equal(status.status, 401);
  assert.deepEqual(await status.json(), { error: "authentication_required" });

  const anonymousDelete = await request("/api/developer/explanation-cache", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: "public-item-explanations" }),
  });
  assert.equal(anonymousDelete.status, 403);
  assert.deepEqual(await anonymousDelete.json(), { error: "origin_mismatch" });

  const crossOrigin = await request("/api/developer/explanation-cache", {
    method: "DELETE",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ scope: "public-item-explanations" }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(await crossOrigin.json(), { error: "origin_mismatch" });
});

test("public item explanations require a member and cannot trust client billing consent", async () => {
  const response = await request("/api/public-data/item-analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId: "bizinfo-1", useAi: true, confirmBillable: true }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });

  const crossOriginApproval = await request("/api/public-data/item-analysis", {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({
      scope: "single-public-item-explanation",
      itemId: "bizinfo-1",
      locale: "ko",
    }),
  });
  assert.equal(crossOriginApproval.status, 403);
  assert.deepEqual(await crossOriginApproval.json(), { error: "origin_mismatch" });

  const anonymousApproval = await request("/api/public-data/item-analysis", {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({
      scope: "single-public-item-explanation",
      itemId: "bizinfo-1",
      locale: "ko",
    }),
  });
  assert.equal(anonymousApproval.status, 401);
  assert.deepEqual(await anonymousApproval.json(), { error: "authentication_required" });

  const route = await readFile(new URL("../app/api/public-data/item-analysis/route.ts", import.meta.url), "utf8");
  assert.match(route, /readCachedItemAnalysis/);
  assert.match(route, /claimItemAnalysisGeneration/);
  assert.match(route, /selected\.billingRisk/);
  assert.doesNotMatch(route, /body\.confirmBillable/);
  assert.ok(
    route.indexOf("const cached = await readCachedItemAnalysis(identity)")
      < route.indexOf("if (selected.billingRisk && !explicitBillableGeneration)"),
    "a paid provider must read its model-specific cache before the no-auto-spend guard",
  );
  assert.match(route, /await requireSameOrigin\(request\)/);
  assert.match(route, /explicitBillableGeneration && !\(await isDeveloperUser\(user\)/);
  assert.match(route, /body\.scope !== BILLABLE_GENERATION_SCOPE/);
  assert.match(route, /selected\.provider !== expectedProvider \|\| selected\.model !== expectedModel/);
  assert.match(route, /billable_runtime_changed/);
  assert.match(route, /billableCallAttempted/);
  assert.match(route, /const baseDashboard = await getPublicDashboard\(user\);[\s\S]*publicDashboardForViewer\(/);
  assert.match(route, /publicDashboardWithYouthCatalog\(baseDashboard, user\)/);
  assert.match(route, /explicitBillableGeneration && !selected\.billingRisk[\s\S]*billable_provider_not_selected[\s\S]*409/);
  assert.match(route, /billingRisk: selected\.billingRisk,[\s\S]*billableCall: false/);
  assert.match(route, /billableCall: selected\.billingRisk && explicitBillableGeneration/);
  assert.match(route, /links:\s*\[\{/);
  assert.match(route, /generation-in-progress[\s\S]*202[\s\S]*Retry-After/);

  const cache = await readFile(new URL("../lib/public-data/item-analysis-cache.ts", import.meta.url), "utf8");
  assert.match(cache, /ITEM_ANALYSIS_GENERATION_LEASE_MS = 120_000/);
  assert.match(cache, /INSERT OR IGNORE INTO public_item_analysis_cache[\s\S]*WHERE EXISTS[\s\S]*generation = \?/);
  assert.match(cache, /saveGeneratedItemAnalysis[\s\S]*WHERE cache_key = \? AND generation = \?[\s\S]*status = 'generating'[\s\S]*lock_token = \?[\s\S]*WHERE slot = \? AND generation = \?/);
  assert.match(cache, /UPDATE public_item_analysis_cache_meta[\s\S]*generation = generation \+ 1[\s\S]*DELETE FROM public_item_analysis_cache/);

  const informationUi = await readFile(new URL("../app/components/public-information-pages.tsx", import.meta.url), "utf8");
  assert.match(informationUi, /maximumPeerRetries = 2/);
  assert.match(informationUi, /response\.status === 202/);
  assert.match(informationUi, /approvalRequired === true && ai\.approvalAvailable === true/);
  assert.match(informationUi, /method: "PUT"/);
  assert.match(informationUi, /scope: "single-public-item-explanation"/);
  assert.match(informationUi, /expectedProvider/);
  assert.match(informationUi, /expectedModel/);
  assert.match(informationUi, /OfficialSourceReadingGuide/);
  assert.match(informationUi, /className=\{styles\.itemBrief\}/);
  assert.match(informationUi, /className=\{styles\.officialPurpose\}/);
  assert.match(informationUi, /latestConditions/);
  assert.ok(
    informationUi.lastIndexOf("className={styles.sourceActions}")
      < informationUi.indexOf("className={styles.analysisPanel}"),
    "the official source action should be accessible before optional AI explanation",
  );
  const billableButton = await readFile(new URL("../app/components/billable-item-analysis-button.tsx", import.meta.url), "utf8");
  assert.match(billableButton, /window\.confirm\(text\.confirm\(`/);
  assert.match(billableButton, /유료 AI 설명 1회 생성/);
});

test("billable, quota-consuming, and stored-state JSON mutations enforce exact same-origin requests", async () => {
  const [aiRoute, itemRoute, refreshRoute, readRoute] = await Promise.all([
    readFile(new URL("../app/api/ai/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public-data/item-analysis/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public-data/refresh/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/public-data/read/route.ts", import.meta.url), "utf8"),
  ]);
  for (const route of [aiRoute, itemRoute, refreshRoute, readRoute]) {
    assert.match(route, /await requireSameOrigin\(request\)/);
    assert.match(route, /json_content_type_required/);
    assert.match(route, /application\/json/);
  }
  assert.match(aiRoute, /selectedAiRuntime\(\)/);
  assert.doesNotMatch(aiRoute, /automaticProvider/);
});

test("AI history starts at zero without a signed-in user", async () => {
  const response = await request("/api/ai/history");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.authenticated, false);
  assert.equal(result.demo, false);
  assert.equal(result.retention, "topic-metadata-only");
  assert.equal(result.totalChats, 0);
  assert.equal(result.last7Days, 0);
  assert.ok(result.topicStats.every((item) => item.count === 0));
});

test("public-data refresh and read mutations require a real member session", async () => {
  const refresh = await request("/api/public-data/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trigger: "manual" }),
  });
  assert.equal(refresh.status, 401);
  assert.deepEqual(await refresh.json(), { error: "authentication_required" });

  const read = await request("/api/public-data/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ category: "finance" }),
  });
  assert.equal(read.status, 401);
  assert.deepEqual(await read.json(), { error: "authentication_required" });
});

test("public-data integration uses shared cache, cooldown, and one-time key normalization", async () => {
  const adapters = await readFile(new URL("../lib/public-data/adapters.ts", import.meta.url), "utf8");
  const cache = await readFile(new URL("../lib/public-data/cache.ts", import.meta.url), "utf8");
  const service = await readFile(new URL("../lib/public-data/service.ts", import.meta.url), "utf8");
  const overview = await readFile(new URL("../app/components/public-data-overview.tsx", import.meta.url), "utf8");
  const informationPages = await readFile(new URL("../app/components/public-information-pages.tsx", import.meta.url), "utf8");
  const developerPage = await readFile(new URL("../app/developer/page.tsx", import.meta.url), "utf8");
  const settingsRoute = await readFile(new URL("../app/api/developer/settings/route.ts", import.meta.url), "utf8");
  const runtimeSettings = await readFile(new URL("../lib/runtime-settings.ts", import.meta.url), "utf8");
  assert.match(adapters, /decodeURIComponent\(trimmed\)/);
  assert.match(adapters, /sdsc2\/storeZoneInAdmi/);
  assert.doesNotMatch(adapters, /storeListInDong/);
  assert.doesNotMatch(adapters, /"bizesNm"/);
  assert.match(adapters, /KeyStatisticList/);
  assert.match(adapters, /depositProductsSearch\.json/);
  assert.match(adapters, /opendart\.fss\.or\.kr\/api\/list\.json/);
  assert.match(adapters, /bizinfoApi\.do/);
  assert.match(adapters, /mapWithConcurrency\(selectedSourceIds, 3/);
  assert.match(adapters, /endpoint:\s*FINANCIAL_COMPANY_ENDPOINT,[\s\S]*keyParameter:\s*"ServiceKey"/);
  assert.match(adapters, /dataGoJson\(apiKey, STOCK_ENDPOINT,[\s\S]*"serviceKey", 15_000/);
  assert.match(adapters, /fetchJson\(endpoint, 15_000\)/);
  assert.match(adapters, /async function fetchResponse[\s\S]*catch \(error\)[\s\S]*errorName === "TypeError"/);
  assert.match(adapters, /throw new UpstreamError\(502, "upstream_network"\)/);
  assert.match(adapters, /loopbackProxyUrl/);
  assert.match(adapters, /environmentValue\("PUBLIC_API_PROXY_TOKEN"\)/);
  assert.match(adapters, /fetchDartJson\(endpoint\)/);
  const sourceErrorCodeBody = adapters.match(/function sourceErrorCode[\s\S]*?\n}\n\nfunction source\(/)?.[0] ?? "";
  assert.doesNotMatch(sourceErrorCodeBody, /errorName === "TypeError"/);
  assert.doesNotMatch(adapters, /searchParams\.set\("servicekey"/);
  assert.match(adapters, /"finprdnm"/);
  assert.match(adapters, /"ofrinstnm"/);
  assert.match(adapters, /status === "020" \? 429/);
  assert.match(adapters, /errorCode: sourceErrorCode\(error\)/);
  assert.match(adapters, /error\.status === 429\) return "quota"/);
  assert.match(adapters, /exchangeResultCode === "4"\) throw new UpstreamError\(429/);
  assert.match(adapters, /resultCode === "22"\s*\? 429/);
  assert.match(adapters, /failureKind: sourceFailureKind\(error\)/);
  assert.doesNotMatch(adapters, /shouldRetainPrevious/);
  assert.match(cache, /public_data_snapshots/);
  assert.match(cache, /public_api_source_state/);
  assert.match(cache, /reserved_calls/);
  assert.match(cache, /WHERE source_id = \? AND reserved_calls >= \?/);
  assert.match(cache, /last_error = CASE WHEN \? = 1 THEN \? ELSE \? END/);
  assert.match(cache, /WHERE cache_key = \? AND lock_until = \?/);
  assert.match(service, /leaseUntil/);
  assert.match(cache, /parseSnapshotViewPayload/);
  assert.match(cache, /attemptedPayload/);
  assert.match(service, /PUBLIC_SOURCE_POLICIES/);
  assert.match(service, /automatic-budget-exhausted/);
  assert.match(service, /failureKind === "quota"\s*\? nextKstQuotaDayStart\(completedAt\)/);
  assert.match(service, /result\?\.errorCode \?\? result\?\.status/);
  assert.match(service, /actualCalls: reservation\.policy\.estimatedCalls/);
  assert.match(service, /publicRefreshFailureCode\(stage, error\)/);
  assert.match(service, /refresh_failed_\$\{stage\}_\$\{reason \?\? "unknown"\}/);
  assert.doesNotMatch(service, /refresh_failed_unknown_outcome/);
  const snapshotPreflight = service.indexOf("serializePublicDataPayload(snapshotPayload)");
  const sourceCompletion = service.indexOf("for (const [sourceId, reservation] of reserved)", snapshotPreflight);
  assert.ok(snapshotPreflight >= 0 && sourceCompletion > snapshotPreflight);
  assert.match(service, /const saved = await savePublicSnapshot[\s\S]*if \(!saved\) throw new Error\("public_snapshot_save_conflict"\)/);
  assert.match(service, /recoverPublicSourcesAfterSnapshotFailure/);
  assert.match(cache, /buildPublicSourceSnapshotRecovery[\s\S]*last_success_at = CASE source_id/);
  assert.match(cache, /buildPublicSourceActivationUpdate[\s\S]*last_error = NULL/);
  assert.match(service, /INACTIVE_PUBLIC_SOURCE_RECHECK_MS/);
  assert.match(service, /errorCode: successful[\s\S]*warning_[\s\S]*source_/);
  assert.match(service, /errorCode: "credential-unavailable"/);
  assert.match(cache, /SELECT c\.category,[\s\S]*SUM\(CASE[\s\S]*source_id <> 'financial-company'/);
  assert.match(cache, /date\('now', '\+9 hours', '-30 days'\)/);
  assert.match(service, /publicDashboardWithCatalogCounts/);
  assert.match(service, /serviceKey: publicDataSourceCredentialKey/);
  assert.match(service, /saveExchangeHistory/);
  assert.match(overview, /loadCache\(requestId, controller\.signal, principal\)\.then\(async \(data\) => \{[\s\S]*if \(cacheReadRequest\?\.principal === principal \|\| !principal \|\| !data\.authenticated \|\| !data\.canRefresh\) return;[\s\S]*await requestRefresh\("login"\);/);
  assert.doesNotMatch(overview, /queueMicrotask\(\(\) => void requestRefresh\("login"\)\)/,
    "login collection must wait for the cache response instead of racing it");
  assert.match(overview, /if \(trigger === "login" && principal\)[\s\S]*window\.sessionStorage\.setItem\(`bora-public-data-initialized:\$\{principal\}`, "true"\)/);
  assert.match(informationPages, /const seenThrough = dashboard\.lastSuccessfulAt/);
  assert.match(informationPages, /EmploymentInformation/);
  assert.match(developerPage, /사용 OFF/);
  assert.match(developerPage, /키 필요/);
  assert.match(developerPage, /호출 보호 중/);
  assert.doesNotMatch(developerPage, /`\s*·\s*\$\{schedule\.lastError\}/);
  assert.match(settingsRoute, /synchronizePublicSourceSwitch/);
  assert.match(runtimeSettings, /service_adapter_not_ready/);
  assert.match(runtimeSettings, /KOSIS_API_KEY:[^\n]*대상별 취업 통계/);
});

test("scheduled public-data refresh fails closed and keeps secrets out of timer logs", async () => {
  const route = await readFile(new URL("../app/api/public-data/scheduled/route.ts", import.meta.url), "utf8");
  const serviceUnit = await readFile(new URL("../deploy/bora-public-data-refresh.service", import.meta.url), "utf8");
  const proxyUnit = await readFile(new URL("../deploy/bora-public-api-proxy.service", import.meta.url), "utf8");
  const proxy = await readFile(new URL("../deploy/public-api-proxy.mjs", import.meta.url), "utf8");
  assert.match(route, /!secret \|\| secret\.length < 32/);
  assert.match(route, /scheduler_secret_missing/);
  assert.doesNotMatch(route, /isLoopbackRequest|hostname === "localhost"/);
  assert.match(serviceUnit, /EnvironmentFile=.*\.env\.scheduler/);
  assert.doesNotMatch(serviceUnit, /EnvironmentFile=-/);
  assert.match(serviceUnit, /--output \/dev\/null/);
  assert.match(serviceUnit, /--config -/);
  assert.match(serviceUnit, /\$\$\{SCHEDULER_SECRET\}/);
  assert.doesNotMatch(serviceUnit, /--header "Authorization: Bearer \$\{SCHEDULER_SECRET\}"/);
  assert.match(serviceUnit, /NoNewPrivileges=true/);
  assert.match(proxyUnit, /EnvironmentFile=.*\.env\.public-api-proxy/);
  assert.match(proxyUnit, /ProtectSystem=strict/);
  assert.match(proxyUnit, /UMask=0077/);
  assert.match(proxy, /server\.listen\(port, "127\.0\.0\.1"\)/);
  assert.match(proxy, /timingSafeEqual/);
  assert.match(proxy, /const UPSTREAM = "https:\/\/opendart\.fss\.or\.kr\/api\/list\.json"/);
  assert.match(proxy, /redirect: "manual"/);
  assert.match(proxy, /x-bora-proxy-upstream/);
});

test("exchange history API is cache-only and distinguishes unavailable storage from zero data", async () => {
  const response = await request("/api/public-data/exchange-history?currency=USD&days=30");
  assert.equal(response.status, 503);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const result = await response.json();
  assert.equal(result.currency, "USD");
  assert.equal(result.baseCurrency, "KRW");
  assert.equal(result.rangeDays, 30);
  assert.equal(result.storageAvailable, false);
  assert.equal(result.hasData, false);
  assert.deepEqual(result.points, []);
  assert.deepEqual(result.summary, {
    latest: 0,
    change: 0,
    changeRate: 0,
    high: 0,
    low: 0,
  });
});

test("exchange history API rejects unsupported currencies and ranges", async () => {
  const currency = await request("/api/public-data/exchange-history?currency=BTC&days=30");
  assert.equal(currency.status, 400);
  assert.deepEqual(await currency.json(), { error: "unsupported_currency" });

  const range = await request("/api/public-data/exchange-history?currency=USD&days=31");
  assert.equal(range.status, 400);
  assert.deepEqual(await range.json(), { error: "unsupported_range" });
});

test("exchange history storage deduplicates provider dates and enforces retention", async () => {
  const history = await readFile(new URL("../lib/public-data/history.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/public-data/exchange-history/route.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0007_public_api_timeline.sql", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");

  assert.match(history, /EXCHANGE_HISTORY_RANGES\s*=\s*\[7, 30, 90, 365\]/);
  assert.match(history, /ON CONFLICT\(source_id, currency, effective_date\) DO UPDATE/);
  assert.match(history, /RETENTION_DAYS\s*=\s*400/);
  assert.match(history, /DELETE FROM exchange_rate_points WHERE effective_date < \?/);
  assert.match(history, /ORDER BY effective_date ASC/);
  assert.doesNotMatch(history, /\bfetch\s*\(/);
  assert.doesNotMatch(route, /\bfetch\s*\(/);
  assert.match(route, /private, no-store, max-age=0/);
  assert.match(migration, /PRIMARY KEY\(`source_id`,`currency`,`effective_date`\)/);
  assert.match(migration, /exchange_rate_points_currency_date_idx/);
  assert.match(schema, /export const publicApiSourceState/);
  assert.match(schema, /export const exchangeRatePoints/);
});

test("AI counseling UI keeps provider selection out of the customer experience", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /4_800_000/);
  assert.doesNotMatch(source, /setProvider\s*\(/);
  assert.doesNotMatch(source, /className=["']provider-list["']/);
  assert.match(source, /상담 주제 통계/);
  assert.match(source, /검색 근거/);
  assert.match(source, /금주의 소비 패턴/);
});

test("AI counseling applies a saved finance snapshot only through server-side consent", async () => {
  const route = await readFile(new URL("../app/api/ai/route.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../lib/manual-finance-store.ts", import.meta.url), "utf8");
  const snapshot = await readFile(new URL("../lib/manual-finance-snapshot.ts", import.meta.url), "utf8");
  assert.match(route, /getManualFinanceAiContext\(user\.id\)/);
  assert.match(route, /manualFinanceContextRequested\(resolved\.query\)/);
  assert.match(route, /personalContextAllowed && shouldUseManualFinance/);
  assert.match(route, /USER-CONSENTED MANUAL FINANCE SNAPSHOT/);
  assert.match(route, /manualFinanceApplied: packed\.personalContextIncluded && Boolean\(manualFinanceContext\)/);
  assert.match(store, /return snapshot \? manualFinanceAiContext\(snapshot\) : null/);
  assert.match(snapshot, /if \(!snapshot\.useForAi\) return null/);
  assert.doesNotMatch(route, /body\.userId|body\.financeSnapshot/);
});

test("commercial-area explorer caps featured cards while keeping every mapped district selectable", async () => {
  const source = await readFile(new URL("../app/components/public-information-pages.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/components/public-information-pages.module.css", import.meta.url), "utf8");
  const adapter = await readFile(new URL("../lib/public-data/adapters.ts", import.meta.url), "utf8");
  const commercialAdapter = adapter.slice(
    adapter.indexOf("async function commercialAreaAdapter"),
    adapter.indexOf("async function kosafAdapter"),
  );

  assert.match(source, /const availableDistricts = queryActive \? visibleDistricts : districts/);
  assert.match(source, /const featuredDistricts = availableDistricts\.slice\(0, 10\)/);
  assert.match(source, /const mappedDistricts = availableDistricts\.filter/);
  assert.match(source, /featuredDistricts\.map\(\(district\) => <li/);
  assert.match(source, /mappedDistricts\.map\(\(district\) => <button/);
  assert.match(source, /areaSquareMeters:[\s\S]*sort\(\(left, right\) => \{/);
  assert.match(source, /right\.areaSquareMeters - left\.areaSquareMeters/);
  assert.match(source, /공식 면적 기준 상위 10개/);
  assert.match(source, /현재 공식 주요상권 API에는 업종 구성 정보가 없습니다/);
  assert.match(source, /실매출/);
  assert.match(source, /시간대별 결제·유동인구/);
  assert.match(source, /미제공 특성이나 수치는 추정하지 않습니다/);
  assert.match(commercialAdapter, /item\.trarArea/);
  assert.match(commercialAdapter, /item\.coords/);
  assert.match(commercialAdapter, /item\.stdrDt/);
  assert.match(commercialAdapter, /commercial_area_incomplete/);
  assert.doesNotMatch(commercialAdapter, /trarTypeNm|mainTrarTypeNm|item\.basDt/);
  assert.match(css, /\.districtCards button:focus-visible/);
  assert.match(css, /\.districtDetailGrid/);
  assert.match(css, /\.mapCoordinateEmpty/);
  assert.match(css, /\.easyMode \.districtDetailGrid article > p/);
});
