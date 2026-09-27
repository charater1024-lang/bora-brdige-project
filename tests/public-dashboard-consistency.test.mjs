import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const key = Symbol.for("bora.dashboard.consistency.synthetic");
const previous = globalThis[key];
globalThis[key] = { views: [], reads: [], refreshes: [], readError: false, user: { id: "synthetic", youthPolicyProfile: { enabled: false } } };
const state = globalThis[key];
const stateCode = 'const state=globalThis[Symbol.for("bora.dashboard.consistency.synthetic")];';
const stubs = {
  "@/lib/auth/current-user": `${stateCode} export async function authenticatedUser(){return state.user;}`,
  "@/lib/auth/http": "export async function requireSameOrigin(){return true;}",
  "@/lib/public-data/access": `${stateCode}
    export async function publicDashboardForViewer(data,user,options){state.views.push(options.youthPolicyView);return {...data,authenticated:!!user};}
    export function projectPublicDashboardSummary(data){return {...data,categories:data.categories.map(group=>({...group,items:[]}))};}
    export function projectPublicDashboardCategory(data){return data;}`,
  "@/lib/public-data/service": `${stateCode}
    export async function readPublicCatalogVersion(){return state.catalogVersion ?? 'v1-'+'a'.repeat(64);}
    const data=()=>({categories:[{id:'youth',items:[],totalCount:24,newCount:0}],refreshInSeconds:0});
    export async function refreshPublicDashboard(user,trigger){state.refreshes.push({user,trigger});return {kind:'cached',dashboard:data()};}
    export async function getPublicDashboard(user,options){state.reads.push({user,options});if(state.readError)throw new Error('private database details');return data();}
    export async function publicDashboardWithCatalogCounts(value){if(state.catalogError)throw new Error('private catalog details');return {...value,categories:value.categories.map(group=>({...group,totalCount:14276}))};}
    export async function publicDashboardWithYouthCatalog(value){if(state.catalogError)throw new Error('private catalog details');return value;}
    export async function publicDashboardWithCategoryCatalog(value){if(state.catalogError)throw new Error('private catalog details');return value;}
    export function filterAndPaginatePublicDashboard(value){return value;}`,
  "@/lib/public-data/commercial-supplement": "export function compactCommercialAnalyticsDashboard(value){return value;}",
};
const loadedMocks = new Set();
const server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": root } }, server: { middlewareMode: true, watch: null },
  plugins: [{ name: "synthetic-dashboard-dependencies", enforce: "pre",
    resolveId(id) { const normalized = id.replaceAll("\\", "/").replace(/\.(?:ts|js)$/u, ""); const entry = Object.keys(stubs).find(path => normalized === path || normalized.endsWith(path.slice(1))); return entry ? `\0fixture:${entry}` : null; },
    load(id) { if (!id.startsWith("\0fixture:")) return null; const name = id.slice(9); loadedMocks.add(name); return stubs[name]; },
  }],
});
test.after(async () => { await server.close(); if (previous === undefined) delete globalThis[key]; else globalThis[key] = previous; });
const { GET } = await server.ssrLoadModule("/app/api/public-data/dashboard/route.ts");
const { POST } = await server.ssrLoadModule("/app/api/public-data/refresh/route.ts");
for (const name of Object.keys(stubs)) assert.ok(loadedMocks.has(name), `expected synthetic dependency: ${name}`);

test("authenticated GET and login refresh use the same full catalogue summary counts", async () => {
  const get = await GET(new Request("https://example.test/api/public-data/dashboard"));
  const post = await POST(new Request("https://example.test/api/public-data/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "login" }) }));
  assert.equal(get.status, 200); assert.equal(post.status, 200);
  const getData = await get.json(), postData = await post.json();
  assert.equal(getData.categories[0].totalCount, 14276);
  assert.deepEqual(getData.categories, postData.categories);
  assert.deepEqual(state.views.slice(-2), ["all", "all"]);
});

test("opted-out members default to all policies without enabling personalization", async () => {
  await GET(new Request("https://example.test/api/public-data/dashboard?category=youth"));
  assert.equal(state.views.at(-1), "all");
  assert.equal(state.user.youthPolicyProfile.enabled, false);
  await GET(new Request("https://example.test/api/public-data/dashboard?category=youth&view=personalized"));
  assert.equal(state.views.at(-1), "personalized");
});

test("member and anonymous page reads never collect upstream data and remain private", async () => {
  const member = state.user;
  const refreshCount = state.refreshes.length;
  try {
    for (const user of [member, null]) {
      state.user = user;
      for (const query of ["", "?category=youth", "?category=finance", "?category=startup", "?category=employment"]) {
        const response = await GET(new Request(`https://example.test/api/public-data/dashboard${query}`));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
        assert.equal((await response.json()).authenticated, Boolean(user));
        assert.equal(state.reads.at(-1).user, user);
        assert.deepEqual(state.reads.at(-1).options, { failOnStorageError: true });
      }
    }
    assert.equal(state.refreshes.length, refreshCount, "GET must not initiate collection");
  } finally { state.user = member; }
});

test("cache storage failures return 503 without upstream work or leaking diagnostics", async () => {
  const member = state.user;
  const refreshCount = state.refreshes.length;
  try {
    state.readError = true;
    for (const user of [member, null]) {
      state.user = user;
      const response = await GET(new Request("https://example.test/api/public-data/dashboard"));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
      assert.deepEqual(await response.json(), { error: "public_data_storage_unavailable" });
    }
    assert.equal(state.refreshes.length, refreshCount);
  } finally { state.user = member; state.readError = false; }
});

test("explicit authenticated manual refresh retains its collection path", async () => {
  const response = await POST(new Request("https://example.test/api/public-data/refresh", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trigger: "manual" }),
  }));
  assert.equal(response.status, 200);
  assert.equal(state.refreshes.at(-1).user, state.user);
  assert.equal(state.refreshes.at(-1).trigger, "manual");
});

test("catalogue and count failures never return the compact preview as a complete 200 response", async () => {
  try {
    state.catalogError = true;
    for (const suffix of ["", "?category=youth", "?category=finance", "?category=startup"]) {
      const response = await GET(new Request("https://example.test/api/public-data/dashboard" + suffix));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: "public_data_catalog_unavailable" });
    }
  } finally { state.catalogError = false; }
});

test("page revision mismatches fail explicitly rather than silently shifting results", async () => {
  const old = 'v1-'+'b'.repeat(64);
  const response = await GET(new Request(`https://example.test/api/public-data/dashboard?category=youth&page=2&catalogVersion=${old}`));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "public_catalog_changed", catalogVersion: 'v1-'+'a'.repeat(64) });
  const malformed = await GET(new Request("https://example.test/api/public-data/dashboard?category=youth&catalogVersion=private-value"));
  assert.equal(malformed.status, 400);
});

test("finance accepts scoped server-side search and verification-needed remains explicit", async () => {
  for (const section of ["products", "indicators", "market"]) {
    const response = await GET(new Request(`https://example.test/api/public-data/dashboard?category=finance&section=${section}&query=test`));
    assert.equal(response.status, 200);
  }
  assert.equal((await GET(new Request("https://example.test/api/public-data/dashboard?category=youth&freshness=review-needed"))).status, 200);
  assert.equal((await GET(new Request("https://example.test/api/public-data/dashboard?category=finance&section=scholarship"))).status, 400);
});

test("home response updates and category response updates reject superseded requests", async () => {
  const overview = await readFile(new URL("../app/components/public-data-overview.tsx", import.meta.url), "utf8");
  const category = await readFile(new URL("../app/components/public-information-pages.tsx", import.meta.url), "utf8");
  assert.match(overview, /if \(requestId !== requestSequence\.current\) return data/u);
  assert.match(overview, /if \(requestId !== requestSequence\.current\) return;/u);
  assert.match(overview, /loadCache\(requestId, controller\.signal, principal\)/u);
  assert.match(category, /if \(controller\.signal\.aborted\) return;/u);
  assert.match(overview, /저장 원본/u);
  assert.match(category, /hubStored: "저장 원본"/u);
  assert.match(category, /수집·재확인 시각은 사용하지 않습니다/u);
});
