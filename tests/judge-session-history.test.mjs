import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sqlite = new DatabaseSync(":memory:");
sqlite.exec("CREATE TABLE oauth_users (id TEXT PRIMARY KEY); INSERT INTO oauth_users VALUES ('owner'), ('other');");
function prepare(sql, parameters = []) {
  return {
    bind: (...values) => prepare(sql, values),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...parameters).changes) } }),
    first: async () => sqlite.prepare(sql).get(...parameters) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...parameters) }),
  };
}
globalThis.__boraJudgeHistoryTestDb = {
  prepare,
  batch: async (statements) => Promise.all(statements.map((statement) => statement.run())),
};
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": projectRoot } },
  plugins: [{
    name: "in-memory-judge-history-d1",
    resolveId(id) { if (id === "cloudflare:workers") return "\0judge-history-workers"; },
    load(id) { if (id === "\0judge-history-workers") return "export const env = { DB: globalThis.__boraJudgeHistoryTestDb };"; },
  }],
  server: { middlewareMode: true },
});
const evaluation = await server.ssrLoadModule("/lib/judge-evaluation.ts");
const coverage = await server.ssrLoadModule("/lib/judge-coverage-corpus.ts");
const store = await server.ssrLoadModule("/lib/judge-session-store.ts");
const exports = await server.ssrLoadModule("/lib/judge-export.ts");
await store.ensureJudgeSessionSchema();
test.after(async () => {
  await server.close();
  sqlite.close();
  delete globalThis.__boraJudgeHistoryTestDb;
});

const now = new Date("2026-09-23T00:00:00Z");
const compact = await coverage.compactJudgeCoverageCorpusResult(coverage.runJudgeCoverageCorpusCases());
const cases = evaluation.runOfflineJudgeCases();
const draft = evaluation.createJudgeSession({ id: "current", title: "Synthetic audit", reviewer: { displayName: "Reviewer", provider: "naver" }, now });
const canonical = await evaluation.attachAutomaticRun(draft, {
  id: "synthetic-run", runnerVersion: evaluation.JUDGE_RUNNER_VERSION,
  datasetId: evaluation.JUDGE_DATASET_ID, datasetHash: evaluation.JUDGE_DATASET_HASH,
  startedAt: now.toISOString(), completedAt: now.toISOString(),
  resultDigest: evaluation.canonicalJudgeRunDigest(cases), cases, snapshot: evaluation.judgeCoreSnapshot(),
}, compact, now);
const filter = {
  schemaVersion: evaluation.JUDGE_SESSION_SCHEMA_VERSION,
  runnerVersion: evaluation.JUDGE_RUNNER_VERSION,
  rubricVersion: evaluation.JUDGE_RUBRIC_VERSION,
  datasetId: evaluation.JUDGE_DATASET_ID,
  datasetHash: evaluation.JUDGE_DATASET_HASH,
  artifactHashes: { ...evaluation.JUDGE_ARTIFACT_HASHES },
};

async function releaseSession(version) {
  const base = `evaluation/datasets/bora-judge-coverage-${version}/`;
  const manifest = JSON.parse(await readFile(new URL(`../${base}manifest.json`, import.meta.url), "utf8"));
  const integrity = JSON.parse(await readFile(new URL(`../${base}integrity.json`, import.meta.url), "utf8"));
  const result = structuredClone(canonical);
  result.id = version;
  Object.assign(result.coverageRun, {
    corpusId: manifest.corpusId, manifestSha256: integrity.manifestSha256,
    definitionSha256: manifest.definitionSha256, caseOrderSha256: manifest.caseOrderSha256,
  });
  result.coverageRun.compactJsonCharacters = JSON.stringify(result.coverageRun).length;
  return result;
}

test("actual D1 reads, counts and pagination preserve v11 through v16 records without relabeling them", async () => {
  sqlite.exec("DELETE FROM judge_evaluation_sessions;");
  const sessions = [canonical, await releaseSession("v11"), await releaseSession("v12"), await releaseSession("v13"), await releaseSession("v14"), await releaseSession("v15"), await releaseSession("v16")];
  for (const session of sessions) await store.insertJudgeSession("owner", session);
  const legacy = { ...structuredClone(canonical), id: "legacy-schema4", schemaVersion: 4 };
  legacy.coverageRun.corpusId = "bora-judge-coverage-2026-08-11-v1";
  await store.insertJudgeSession("owner", legacy);
  await store.insertJudgeSession("other", { ...structuredClone(canonical), id: "other-user" });
  for (const session of sessions) {
    assert.deepEqual(await store.getJudgeSession("owner", session.id), session);
    assert.equal(await store.getJudgeSession("other", session.id), null);
  }
  assert.deepEqual(await store.getJudgeSession("owner", legacy.id), legacy);
  const listed = await store.listJudgeSessionsForDefinition("owner", filter, 50);
  assert.equal(listed.length, sessions.length);
  assert.equal(await store.countJudgeSessionsForDefinition("owner", filter), listed.length);
  assert.equal(await store.countJudgeSessions("owner"), sessions.length + 1);
  assert.equal((await store.listJudgeSessions("owner", 50)).length, sessions.length + 1);
  const first = await store.listJudgeSessionsForDefinition("owner", filter, 1);
  const rest = await store.listJudgeSessionsForDefinition("owner", filter, 50, {
    createdAt: Date.parse(first[0].createdAt), id: first[0].id,
  });
  assert.deepEqual([first[0].id, ...rest.map((session) => session.id)], listed.map((session) => session.id));
});

test("historical results retain pins, status, score and evidence in JSON/CSV exports", async () => {
  for (const version of ["v11", "v12", "v13", "v14", "v15", "v16"]) {
    const session = await releaseSession(version);
    session.status = "sealed";
    session.sealedAt = now.toISOString();
    const original = JSON.stringify(session);
    const definitions = { rubric: [], gates: session.definitions.safetyGates, cases: session.definitions.automaticCases };
    const exported = exports.judgeCanonicalExport(session, definitions, now.toISOString());
    assert.equal(exported.session.status, "sealed");
    assert.equal(exported.session.summary.totalScore, session.summary.totalScore);
    for (const key of ["corpusId", "manifestSha256", "definitionSha256", "caseOrderSha256", "resultSha256"]) {
      assert.equal(exported.coverageCorpus[key], session.coverageRun[key]);
    }
    const csv = exports.judgeSessionCsv(session, definitions);
    assert.ok(csv.includes(session.coverageRun.corpusId));
    assert.ok(csv.includes(session.coverageRun.manifestSha256));
    assert.equal(JSON.stringify(session), original);
  }
});

test("reading known history does not authorize mutation or treating it as a current readiness result", async () => {
  let historicalReleases = 0;
  for (const version of ["v11", "v12", "v13", "v14", "v15", "v16"]) {
    const session = await releaseSession(version);
    assert.equal(evaluation.validStoredJudgeCoverageRun(session.coverageRun), true);
    if (evaluation.validJudgeCoverageRun(session.coverageRun)) continue;
    historicalReleases += 1;
    assert.equal(evaluation.judgeCoverageReadinessPassed(session.coverageRun), false);
    const before = JSON.stringify(session);
    assert.throws(() => evaluation.applyJudgeReviewUpdate(session, { title: "Changed" }, "review", now), /judge_session_version_mismatch/);
    assert.throws(() => evaluation.attachDiagnosticRun(session, { version: evaluation.JUDGE_DIAGNOSTIC_VERSION }, now), /judge_session_version_mismatch/);
    await assert.rejects(store.updateJudgeSession("owner", session, session.updatedAt), /judge_session_version_mismatch/);
    assert.equal(JSON.stringify(session), before);
    assert.deepEqual(await store.getJudgeSession("owner", version), session);
  }
  assert.ok(historicalReleases >= 1);
});

test("unknown or mixed release pins fail closed and are excluded from compatible list counts", async () => {
  const invalid = await releaseSession("v11");
  invalid.id = "unknown-release";
  invalid.coverageRun.corpusId = "bora-judge-coverage-unknown";
  invalid.coverageRun.compactJsonCharacters = JSON.stringify(invalid.coverageRun).length;
  assert.equal(evaluation.validStoredJudgeCoverageRun(invalid.coverageRun), false);
  await store.insertJudgeSession("owner", invalid);
  assert.equal(await store.getJudgeSession("owner", invalid.id), null);
  assert.equal((await store.listJudgeSessionsForDefinition("owner", filter, 50)).length, 7);
  assert.equal(await store.countJudgeSessionsForDefinition("owner", filter), 7);
  const mixed = await releaseSession("v11");
  mixed.coverageRun.manifestSha256 = compact.manifestSha256;
  assert.equal(evaluation.validStoredJudgeCoverageRun(mixed.coverageRun), false);
});

test("history UI does not relabel old provenance and disables writes while allowing original exports", async () => {
  const ui = await readFile(new URL("../app/developer/evaluation/page.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../app/api/developer/judge-sessions/route.ts", import.meta.url), "utf8");
  assert.match(ui, /coverageCorpus: historicalCoverage \? undefined : dataset\?\.coverageCorpus/);
  assert.match(ui, /이전 버전 평가 기록 · 읽기 전용/);
  assert.match(ui, /disabled=\{readOnly \|\| running/);
  assert.match(ui, /disabled=\{!ready && !historical\}/);
  assert.equal((api.match(/current\.coverageRun !== null && !validJudgeCoverageRun\(current\.coverageRun\)/gu) ?? []).length, 2);
});
