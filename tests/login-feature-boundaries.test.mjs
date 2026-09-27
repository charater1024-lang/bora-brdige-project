import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const stateKey = Symbol.for("bora.login.feature.boundaries");
const priorState = globalThis[stateKey];
const state = globalThis[stateKey] = {
  user: null,
  sameOrigin: true,
  calls: [],
};
const stateRef = 'globalThis[Symbol.for("bora.login.feature.boundaries")]';
const modules = {
  "lib/auth/current-user": `export async function authenticatedUser(){const s=${stateRef};s.calls.push(['authenticatedUser']);return s.user;}`,
  "lib/auth/http": `export async function requireSameOrigin(){const s=${stateRef};s.calls.push(['requireSameOrigin']);return s.sameOrigin;}`,
  "lib/public-data/commercial-store-search": `
    export class CommercialSearchError extends Error { constructor(status,code,retryAfterSeconds=null){super(code);this.status=status;this.code=code;this.retryAfterSeconds=retryAfterSeconds;} }
    const invoke=(name,userId,input)=>{const s=${stateRef};s.calls.push([name,userId,input]);return {kind:name==='listCommercialIndustries'?'industries':name==='searchCommercialAreas'?'areas':'stores',items:[],meta:{}};};
    export async function listCommercialIndustries(userId){return invoke('listCommercialIndustries',userId,null);}
    export async function searchCommercialAreas(input){return invoke('searchCommercialAreas',input.userId,input);}
    export async function searchCommercialStores(input){return invoke('searchCommercialStores',input.userId,input);}`,
};
const loaded = new Set();
function moduleKey(id) {
  const normalized = id.replaceAll("\\", "/").replace(/\.(?:ts|js)$/u, "");
  return Object.keys(modules).find(key => normalized === key || normalized.endsWith(`/${key}`)) ?? null;
}
const server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": root } }, server: { middlewareMode: true, watch: null },
  plugins: [{ name: "login-feature-boundary-fixtures", enforce: "pre",
    resolveId(id) { const key = moduleKey(id); return key ? `\0login-feature:${key}` : null; },
    load(id) { if (!id.startsWith("\0login-feature:")) return null; const key = id.slice(15); loaded.add(key); return modules[key]; },
  }],
});
const { POST } = await server.ssrLoadModule("/app/api/public-data/commercial-search/route.ts");
for (const key of Object.keys(modules)) assert.ok(loaded.has(key), `fixture required: ${key}`);
test.after(async () => {
  await server.close();
  if (priorState === undefined) delete globalThis[stateKey]; else globalThis[stateKey] = priorState;
});
function reset({ user = { id: "member-a" }, sameOrigin = true } = {}) {
  state.user = user; state.sameOrigin = sameOrigin; state.calls.length = 0;
}
function request(body) {
  return new Request("https://borabridge.test/api/public-data/commercial-search", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://borabridge.test" }, body: JSON.stringify(body),
  });
}

test("signed-out nationwide search stops before origin, quota, storage and provider functions", async () => {
  reset({ user: null });
  const response = await POST(request({ kind: "stores", provinceCode: "11", page: 1, pageSize: 24 }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "authentication_required" });
  assert.deepEqual(state.calls, [["authenticatedUser"]]);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
});

test("signed-in search requires same origin before dispatching the member id", async () => {
  reset({ sameOrigin: false });
  let response = await POST(request({ kind: "stores", provinceCode: "11" }));
  assert.equal(response.status, 403);
  assert.deepEqual(state.calls, [["authenticatedUser"], ["requireSameOrigin"]]);

  reset({ user: { id: "member-specific" } });
  response = await POST(request({ kind: "stores", provinceCode: "11", page: 2, pageSize: 24 }));
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls.slice(0, 2), [["authenticatedUser"], ["requireSameOrigin"]]);
  assert.deepEqual(state.calls[2], ["searchCommercialStores", "member-specific", {
    provinceCode: "11", areaCode: null, industryCode: null, page: 2, pageSize: 24, userId: "member-specific",
  }]);
});

test("all nationwide search kinds use only the authenticated member identity", async () => {
  reset({ user: { id: "member-b" } });
  await POST(request({ kind: "industries" }));
  await POST(request({ kind: "areas", provinceCode: "26", query: "서면", page: 1, pageSize: 20 }));
  assert.deepEqual(state.calls.filter(call => call[0].startsWith?.("list") || call[0].startsWith?.("search")), [
    ["listCommercialIndustries", "member-b", null],
    ["searchCommercialAreas", "member-b", { provinceCode: "26", query: "서면", page: 1, pageSize: 20, userId: "member-b" }],
  ]);
});

test("UI uses same-origin credentials and translates a server 401 into a sign-in instruction", async () => {
  const [commercial, page, dashboard, account] = await Promise.all([
    readFile(new URL("../app/components/commercial-store-search.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/public-information-pages.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/home-control-center.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(commercial, /credentials:\s*"same-origin"/u);
  assert.match(commercial, /if \(code === "authentication_required"\) return t\.signIn/u);
  assert.match(commercial, /전국 점포 검색은[^\n]*로그인 후/u);
  assert.match(page, /if \(!currentUser\)[\s\S]*status: "sign-in"[\s\S]*return;/u);
  assert.ok(page.indexOf("if (!currentUser)") < page.indexOf('fetchWithClientTimeout("/api/ai"'));
  assert.match(page, /controller\.signal\.aborted \|\| requestId !== aiRequestSequenceRef\.current/u);
  assert.match(page, /supersededTurnId !== null[\s\S]*turn\.id === supersededTurnId && turn\.status === "pending"[\s\S]*status: "error"/u);
  assert.match(page, /data\.error === "authentication_required"[\s\S]*synchronizePrincipal\(null\)[\s\S]*question: ""[\s\S]*status: "sign-in"[\s\S]*sources: \[\]/u);
  assert.match(page, /if \(requestId === aiRequestSequenceRef\.current[\s\S]*principalMatches\(principalGeneration, requestingUserId\)[\s\S]*aiRequestAbortRef\.current = null;[\s\S]*setAiLoading\(false\)/u);
  assert.match(page, /controlledSession=\{sessionSnapshot\}/u);
  assert.match(page, /onSessionRetry=\{refreshHomeSession\}/u);
  assert.match(page, /controlledSessionUser=\{currentUser\}/u);
  assert.match(account, /const displayedSessionUser = controlledSessionUser \?\? null/u);
  assert.doesNotMatch(account, /fetch\("\/api\/session"/u);
  assert.match(dashboard, /!dashboard\.authenticated[\s\S]*\? "all"/u);
  assert.match(dashboard, /analysisEnabled=\{dashboard\.authenticated && effectiveYouthPolicyView === "personalized"\}/u);
});

test("a deferred response cannot commit after logout or an account switch even when abort is ignored", async () => {
  const pageModule = await server.ssrLoadModule("/app/page.tsx");
  const matches = pageModule.principalRequestMatches;
  assert.equal(typeof matches, "function");

  let generation = 7;
  let userId = "member-a";
  const capturedGeneration = generation;
  const capturedUserId = userId;
  let release;
  const ignoredAbortResponse = new Promise((resolve) => { release = resolve; });
  const committed = [];
  const pending = ignoredAbortResponse.then((value) => {
    if (matches(generation, userId, capturedGeneration, capturedUserId)) committed.push(value);
  });

  generation += 1;
  userId = null;
  release("private-a");
  await pending;
  assert.deepEqual(committed, []);

  assert.equal(matches(8, "member-b", 7, "member-a"), false);
  assert.equal(matches(8, "member-b", 8, "member-b"), true);
});
