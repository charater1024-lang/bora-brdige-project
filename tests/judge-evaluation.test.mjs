import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": projectRoot } },
  server: { middlewareMode: true },
});
const evaluation = await server.ssrLoadModule("/lib/judge-evaluation.ts");
const coverage = await server.ssrLoadModule("/lib/judge-coverage-corpus.ts");
const judgeExports = await server.ssrLoadModule("/lib/judge-export.ts");
const phishing = await server.ssrLoadModule("/app/api/phishing/route.ts");
test.after(() => server.close());

const {
  JUDGE_API_SNAPSHOT_HASH,
  JUDGE_ARTIFACT_HASHES,
  JUDGE_AUTOMATIC_MAX_SCORE,
  JUDGE_CASE_CATALOG,
  JUDGE_DATASET_HASH,
  JUDGE_DATASET_ID,
  JUDGE_DIAGNOSTIC_VERSION,
  JUDGE_EVIDENCE_MANIFEST_HASH,
  JUDGE_EXPORT_SCHEMA_VERSION,
  JUDGE_HUMAN_MAX_SCORE,
  JUDGE_HUMAN_RUBRIC,
  JUDGE_RUNNER_VERSION,
  JUDGE_SESSION_SCHEMA_VERSION,
  JUDGE_SAFETY_GATES,
  JUDGE_TOTAL_MAX_SCORE,
  applyJudgeReviewUpdate,
  attachAutomaticRun,
  attachDiagnosticRun,
  canonicalJudgeRunDigest,
  createJudgeSession,
  currentJudgeDefinitions,
  deriveAutomaticGates,
  diagnosticCounts,
  judgeCoverageReadinessPassed,
  judgeCoreSnapshot,
  judgeDatasetMetadata,
  judgeSessionSummary,
  runOfflineJudgeCases,
  validJudgeCoverageRun,
} = evaluation;

const FIXED_TIME = "2026-08-11T00:00:00.000Z";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function newSession(suffix = "000000000001") {
  return createJudgeSession({
    id: `judge_00000000-0000-4000-8000-${suffix}`,
    title: "최종 제출 전 자동점검",
    reviewer: { displayName: "내부 평가자", provider: "naver" },
    now: new Date(FIXED_TIME),
  });
}

function coreRun(cases = runOfflineJudgeCases(), id = "core-run-1") {
  return {
    id,
    runnerVersion: JUDGE_RUNNER_VERSION,
    datasetId: JUDGE_DATASET_ID,
    datasetHash: JUDGE_DATASET_HASH,
    startedAt: "2026-08-11T00:00:01.000Z",
    completedAt: "2026-08-11T00:00:02.000Z",
    resultDigest: canonicalJudgeRunDigest(cases),
    cases,
    snapshot: judgeCoreSnapshot(),
  };
}

async function compactCoverageRun() {
  return coverage.compactJudgeCoverageCorpusResult(coverage.runJudgeCoverageCorpusCases());
}

function diagnosticRun(checks = [{
  id: "health-handler",
  label: "헬스 API 핸들러",
  kind: "in-process-handler",
  target: "GET /api/health",
  expected: "HTTP 200 및 status=ok",
  externalNetworkCalls: 0,
  status: "fail",
  actual: "HTTP 503",
  durationMs: 7,
  evidence: ["app/api/health/route.ts"],
  errorCode: null,
}]) {
  return {
    id: "diagnostic-run-1",
    version: JUDGE_DIAGNOSTIC_VERSION,
    startedAt: "2026-08-11T00:00:03.000Z",
    completedAt: "2026-08-11T00:00:04.000Z",
    checks,
    counts: diagnosticCounts(checks),
    snapshot: {
      capturedAt: "2026-08-11T00:00:03.000Z",
      origin: "https://borabridge.example",
      appVersion: "0.7.0",
      buildCommit: "0123456789abcdef",
      ai: { provider: "openai", model: "diagnostic-model", runtimeUsable: false, issue: "not configured" },
      publicData: { status: "stale", lastSuccessfulAt: null, sourceCount: 0, liveSourceCount: 0, itemCount: 0 },
      serviceIntegrations: { configured: 0, enabled: 0, runtimeUsable: 0 },
    },
  };
}

function exportDefinitions() {
  return {
    rubric: JUDGE_HUMAN_RUBRIC,
    gates: JUDGE_SAFETY_GATES,
    cases: JUDGE_CASE_CATALOG,
  };
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  cells.push(value);
  return cells;
}

test("v2 core fixture is 28 immutable offline cases worth exactly 100 points", async () => {
  const raw = await readFile(new URL("../evaluation/datasets/bora-judge-core-v2.json", import.meta.url));
  const fixture = JSON.parse(raw.toString("utf8"));

  assert.equal(fixture.schemaVersion, "bora-judge-dataset/v2");
  assert.equal(fixture.datasetId, JUDGE_DATASET_ID);
  assert.equal(fixture.runnerVersion, JUDGE_RUNNER_VERSION);
  assert.equal(sha256(raw), JUDGE_DATASET_HASH);
  assert.equal(fixture.cases.length, 28);
  assert.equal(new Set(fixture.cases.map((item) => item.id)).size, 28);
  assert.equal(fixture.cases.reduce((sum, item) => sum + item.weight, 0), 100);
  assert.equal(fixture.cases.every((item) => item.execution === "offline-replay"), true);
  assert.deepEqual(
    [...new Set(fixture.cases.map((item) => item.riskClass))].sort(),
    ["adversarial", "boundary", "high-risk-finance", "typical"],
  );
  assert.equal(fixture.privacy.syntheticOnly, true);
  assert.equal(fixture.privacy.containsPersonalData, false);
  assert.equal(fixture.privacy.networkCallsDuringCoreEvaluation, false);
  assert.deepEqual(fixture.scoring, {
    automaticPoints: 100,
    humanReviewPoints: 0,
    apiDiagnosticPointsIncluded: 0,
    officialHackathonScore: false,
    label: "내부 자동 제출 준비도",
  });
  assert.deepEqual(
    fixture.cases.map((item) => item.id),
    JUDGE_CASE_CATALOG.map((item) => item.id),
  );
  assert.deepEqual(
    fixture.cases.map((item) => ({
      id: item.id,
      adapter: item.adapter,
      execution: item.execution,
      weight: item.weight,
      riskClass: item.riskClass,
      sourceRefs: item.sourceRefs,
    })),
    JUDGE_CASE_CATALOG.map((item) => ({
      id: item.id,
      adapter: item.adapter,
      execution: item.execution,
      weight: item.weight,
      riskClass: item.riskClass,
      sourceRefs: [...item.sourceRefs],
    })),
  );
  assert.equal(JUDGE_CASE_CATALOG.some((item) => [
    "challenge-route",
    "health-route",
    "public-data-route",
    "runtime-ai-provider",
  ].includes(item.id)), false);
  assert.equal(JUDGE_AUTOMATIC_MAX_SCORE, 100);
  assert.equal(JUDGE_HUMAN_MAX_SCORE, 0);
  assert.equal(JUDGE_TOTAL_MAX_SCORE, 100);
  assert.equal(JUDGE_SESSION_SCHEMA_VERSION, 7);
  assert.deepEqual(JUDGE_HUMAN_RUBRIC, []);
  assert.equal(currentJudgeDefinitions().rubric.length, 0);

  const caseIds = new Set(JUDGE_CASE_CATALOG.map((item) => item.id));
  assert.ok(JUDGE_SAFETY_GATES.length > 0);
  for (const gate of JUDGE_SAFETY_GATES) {
    assert.ok(gate.requiredCaseIds.length > 0, `${gate.id} has no required cases`);
    assert.equal(gate.requiredCaseIds.every((id) => caseIds.has(id)), true, gate.id);
  }
});

test("GPT-5.6 Sol provenance binds the core and auxiliary artifacts without overstating review", async () => {
  const [coreRaw, apiRaw, evidenceRaw, provenanceRaw, legacyRaw, legacyProvenanceRaw] = await Promise.all([
    readFile(new URL("../evaluation/datasets/bora-judge-core-v2.json", import.meta.url)),
    readFile(new URL("../evaluation/datasets/bora-api-contract-snapshots-v1.json", import.meta.url)),
    readFile(new URL("../evaluation/datasets/bora-submission-evidence-v1.json", import.meta.url)),
    readFile(new URL("../evaluation/datasets/bora-judge-core-v2.provenance.json", import.meta.url)),
    readFile(new URL("../evaluation/datasets/bora-judge-core-v1.json", import.meta.url)),
    readFile(new URL("../evaluation/datasets/bora-judge-core-v1.provenance.json", import.meta.url)),
  ]);
  const core = JSON.parse(coreRaw.toString("utf8"));
  const provenance = JSON.parse(provenanceRaw.toString("utf8"));
  const legacy = JSON.parse(legacyRaw.toString("utf8"));
  const legacyProvenance = JSON.parse(legacyProvenanceRaw.toString("utf8"));

  assert.equal(core.authorship.provider, "OpenAI");
  assert.equal(core.authorship.model, "gpt-5.6-sol");
  assert.equal(core.authorship.runtimeJudgeUse, false);
  assert.equal(core.authorship.independentExpertReview, "not_performed");
  assert.match(core.authorship.provenanceConfidence, /self-declared/u);
  assert.equal(provenance.currentDataset.datasetId, JUDGE_DATASET_ID);
  assert.equal(provenance.currentDataset.datasetSha256, sha256(coreRaw));
  assert.equal(provenance.currentDataset.caseCount, 28);
  assert.equal(provenance.currentDataset.automaticScoreMax, 100);
  assert.equal(provenance.provenanceClaim.model.declaredModel, "gpt-5.6-sol");
  assert.equal(provenance.provenanceClaim.model.displayName, "GPT-5.6 Sol");
  assert.equal(provenance.provenanceClaim.model.runtimeJudgeUse, false);
  assert.equal(provenance.provenanceClaim.model.portableRunIdStored, false);
  assert.equal(provenance.provenanceClaim.model.signedInferenceLogStored, false);
  assert.equal(provenance.reviewScope.independentHumanDomainExpertReviewRecorded, false);

  const dependencies = Object.fromEntries(provenance.artifactDependencies.map((item) => [item.role, item]));
  assert.equal(dependencies["stored-api-contract-fixture"].sha256, sha256(apiRaw));
  assert.equal(JUDGE_API_SNAPSHOT_HASH, sha256(apiRaw));
  assert.equal(dependencies["stored-api-contract-fixture"].liveCapture, false);
  assert.equal(dependencies["stored-api-contract-fixture"].externalCallsDuringEvaluation, false);
  assert.equal(dependencies["submission-evidence-structure"].sha256, sha256(evidenceRaw));
  assert.equal(JUDGE_EVIDENCE_MANIFEST_HASH, sha256(evidenceRaw));
  assert.equal(dependencies["submission-evidence-structure"].qualityClaim, "evidence-completeness-only");
  assert.equal(provenance.dependencyBinding.auxiliaryHashesIncludedInCoreHash, false);
  assert.equal(provenance.dependencyBinding.sessionSchemaVersion, 4);
  assert.equal(provenance.dependencyBinding.sessionPinsAllThreeArtifactHashes, true);

  assert.equal(provenance.legacyArtifacts.preserved, true);
  assert.equal(provenance.legacyArtifacts.activeRuntimeSource, false);
  assert.equal(provenance.legacyArtifacts.policy, "Do not rewrite v1 provenance with v2 claims.");
  assert.equal(legacyProvenance.dataset.datasetId, legacy.datasetId);
  assert.equal(legacyProvenance.dataset.runnerVersion, legacy.runnerVersion);
  assert.equal(legacyProvenance.dataset.datasetSha256, sha256(legacyRaw));
  assert.notEqual(legacy.datasetId, JUDGE_DATASET_ID);
  assert.notEqual(legacy.runnerVersion, JUDGE_RUNNER_VERSION);
});

test("offline replay is case-explainable and produces the same digest on repeated runs", () => {
  const first = runOfflineJudgeCases();
  const second = runOfflineJudgeCases();
  const firstDigest = canonicalJudgeRunDigest(first);
  const secondDigest = canonicalJudgeRunDigest(second);

  assert.equal(first.length, 28);
  assert.equal(first.every((item) => item.status === "pass"), true, JSON.stringify(first, null, 2));
  assert.equal(first.reduce((sum, item) => sum + item.earnedScore, 0), 100);
  assert.equal(firstDigest, secondDigest);
  assert.match(firstDigest, /^[0-9a-f]{8}$/u);
  assert.deepEqual(
    first.map((item) => ({ ...item, durationMs: 0 })),
    second.map((item) => ({ ...item, durationMs: 0 })),
  );
  for (const result of first) {
    assert.equal(result.execution, "offline-replay");
    assert.equal(result.earnedScore, result.weight);
    assert.equal(result.digestAlgorithm, "fnv1a-32");
    assert.match(result.inputDigest, /^[0-9a-f]{8}$/u);
    assert.match(result.outputDigest, /^[0-9a-f]{8}$/u);
    assert.ok(result.assertions.length > 0, `${result.id} lacks assertions`);
    assert.equal(result.assertions.every((item) => item.passed), true, result.id);
    assert.ok(result.evidence.length > 0, `${result.id} lacks evidence`);
    assert.equal(result.errorCode, null);
  }
  const evidenceCase = first.find((item) => item.id === "submission-evidence-manifest");
  const minimumEvidence = evidenceCase?.assertions.find((item) => item.id === "minimumEvidenceRefsPerRequirement");
  assert.equal(typeof minimumEvidence?.actual, "number");
  assert.equal(minimumEvidence?.passed, Number(minimumEvidence?.actual) >= Number(minimumEvidence?.expected));

  const snapshot = judgeCoreSnapshot();
  assert.deepEqual({ mode: snapshot.mode, networkCalls: snapshot.networkCalls, modelCalls: snapshot.modelCalls }, {
    mode: "offline-dataset-replay",
    networkCalls: 0,
    modelCalls: 0,
  });
  assert.equal(snapshot.authorship.model, "gpt-5.6-sol");
  assert.deepEqual(snapshot.artifactHashes, JUDGE_ARTIFACT_HASHES);
  assert.ok(snapshot.limitations.length > 0);
  assert.equal(judgeDatasetMetadata().caseCount, 28);
});

test("600-case coverage replay is deterministic, compact, zero-score, and 100 cases per suite", async () => {
  const first = coverage.runJudgeCoverageCorpusCases();
  const second = coverage.runJudgeCoverageCorpusCases();
  const firstCompact = await coverage.compactJudgeCoverageCorpusResult(first);
  const secondCompact = await coverage.compactJudgeCoverageCorpusResult(second);
  const metadata = judgeDatasetMetadata().coverageCorpus;

  assert.equal(first.length, 600);
  assert.equal(first.every((item) => item.status === "pass"), true);
  assert.deepEqual(first, second);
  assert.deepEqual(firstCompact, secondCompact);
  assert.equal(firstCompact.totalCases, 600);
  assert.equal(firstCompact.passedCases, 600);
  assert.equal(firstCompact.failedCases, 0);
  assert.equal(firstCompact.errorCases, 0);
  assert.equal(firstCompact.relationshipToDeepScore.coverageScoreContribution, 0);
  assert.equal(firstCompact.execution.networkCalls, 0);
  assert.equal(firstCompact.execution.modelCalls, 0);
  assert.equal(firstCompact.suiteSummaries.length, 6);
  assert.equal(firstCompact.suiteSummaries.every((suite) => suite.total === 100 && suite.passed === 100), true);
  assert.ok(firstCompact.compactJsonCharacters < 10_000);
  assert.equal(metadata.totalCases, 600);
  assert.equal(metadata.casesPerSuite, 100);
  assert.equal("cases" in metadata, false);

  const regressedCases = structuredClone(first);
  regressedCases[0].status = "fail";
  regressedCases[0].assertions[0].passed = false;
  const regressedCompact = await coverage.compactJudgeCoverageCorpusResult(regressedCases);
  assert.equal(validJudgeCoverageRun(regressedCompact), true);
  assert.equal(judgeCoverageReadinessPassed(regressedCompact), false);
  const regressedGates = deriveAutomaticGates(
    currentJudgeDefinitions().safetyGates,
    runOfflineJudgeCases(),
    regressedCompact,
  );
  assert.equal(Object.values(regressedGates).every((gate) => gate.status === "fail"), true);

  const reportableFailure = newSession("000000000099");
  reportableFailure.automaticRun = coreRun();
  reportableFailure.coverageRun = regressedCompact;
  reportableFailure.gateReviews = regressedGates;
  reportableFailure.summary = judgeSessionSummary(reportableFailure);
  const sealedFailure = applyJudgeReviewUpdate(reportableFailure, {}, "sealed");
  assert.equal(sealedFailure.status, "sealed");
  assert.equal(sealedFailure.summary.readinessGate, "fail");
});

test("automatic gates are derived from deep and 600-case coverage results and cannot be supplied as reviewer scores", async () => {
  const session = newSession("000000000002");
  session.gateReviews = Object.fromEntries(JUDGE_SAFETY_GATES.map((gate) => [
    gate.id,
    { status: "fail", note: "client supplied" },
  ]));
  const passed = await attachAutomaticRun(
    session,
    coreRun(),
    await compactCoverageRun(),
    new Date("2026-08-11T00:00:02.000Z"),
  );

  assert.equal(passed.summary.automaticScore, 100);
  assert.equal(passed.summary.automaticMaxScore, 100);
  assert.equal(passed.summary.humanScore, 0);
  assert.equal(passed.summary.humanMaxScore, 0);
  assert.equal(passed.summary.totalScore, 100);
  assert.equal(passed.summary.totalMaxScore, 100);
  assert.equal(passed.summary.readinessGate, "pass");
  assert.equal(passed.summary.counts.pass, 28);
  assert.equal(passed.coverageRun.totalCases, 600);
  assert.equal(passed.coverageRun.passedCases, 600);
  assert.equal(passed.coverageRun.suiteSummaries.every((suite) => suite.total === 100 && suite.passed === 100), true);
  assert.ok(JSON.stringify(passed).length < 131_072);
  assert.equal(passed.summary.gatesReviewed, JUDGE_SAFETY_GATES.length);
  assert.equal(Object.values(passed.gateReviews).every((gate) => gate.status === "pass"), true);
  assert.equal(Object.values(passed.gateReviews).every((gate) => /자동 통과/u.test(gate.note)), true);

  const targetGate = JUDGE_SAFETY_GATES[0];
  const forcedGateFailure = structuredClone(passed);
  forcedGateFailure.gateReviews[targetGate.id] = { status: "fail", note: "필수 케이스 실패" };
  assert.equal(judgeSessionSummary(forcedGateFailure).readinessGate, "fail");
  const missingCoverage = structuredClone(passed);
  missingCoverage.coverageRun = null;
  assert.equal(judgeSessionSummary(missingCoverage).readinessGate, "fail");

  const ignoredReviewInput = applyJudgeReviewUpdate(passed, {
    manualReviews: { invented: { score: 999, note: "override", evidence: "none" } },
    gateReviews: { [targetGate.id]: { status: "fail", note: "override" } },
  }, "review");
  assert.deepEqual(ignoredReviewInput.manualReviews, {});
  assert.deepEqual(ignoredReviewInput.gateReviews, passed.gateReviews);
  assert.equal(ignoredReviewInput.summary.totalScore, 100);
});

test("API diagnostics remain separately counted and never change the core score or readiness gate", async () => {
  const coreAttached = await attachAutomaticRun(newSession("000000000004"), coreRun(), await compactCoverageRun());
  const scoreBefore = structuredClone(coreAttached.summary);
  const digestBefore = coreAttached.automaticRun.resultDigest;
  const checks = [
    {
      id: "health-handler",
      label: "헬스 API 핸들러",
      kind: "in-process-handler",
      target: "GET /api/health",
      expected: "HTTP 200 및 status=ok",
      externalNetworkCalls: 0,
      status: "fail",
      actual: "HTTP 503",
      durationMs: 5,
      evidence: ["app/api/health/route.ts"],
      errorCode: null,
    },
    {
      id: "ai-runtime",
      label: "AI 런타임",
      kind: "runtime-snapshot",
      target: "AI provider settings",
      expected: "runtimeUsable=true",
      externalNetworkCalls: 0,
      status: "error",
      actual: "provider unavailable",
      durationMs: 9,
      evidence: ["lib/runtime-settings.ts"],
      errorCode: "provider_unavailable",
    },
  ];
  const withDiagnostics = attachDiagnosticRun(coreAttached, diagnosticRun(checks));

  assert.deepEqual(withDiagnostics.summary, scoreBefore);
  assert.equal(withDiagnostics.summary.totalScore, 100);
  assert.equal(withDiagnostics.summary.readinessGate, "pass");
  assert.equal(withDiagnostics.automaticRun.resultDigest, digestBefore);
  assert.deepEqual(withDiagnostics.diagnosticRun.counts, {
    pass: 0,
    warn: 0,
    fail: 1,
    error: 1,
    "not-run": 0,
  });

  const diagnosticsOnly = attachDiagnosticRun(newSession("000000000005"), diagnosticRun(checks));
  assert.equal(diagnosticsOnly.summary.totalScore, 0);
  assert.equal(diagnosticsOnly.summary.readinessGate, "review");
  assert.equal(diagnosticsOnly.automaticRun, null);
});

test("the internal phishing diagnostic reuses request handling without consuming the public anonymous rate limit", async () => {
  for (let index = 0; index < 14; index += 1) {
    const response = await phishing.runPhishingDiagnosticRequest(new Request("https://borabridge.example/api/phishing", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://borabridge.example" },
      body: JSON.stringify({
        locale: "en",
        text: "Bank security: urgent, act now. Transfer money to a safe account and send your OTP password. Do not tell anyone.",
      }),
    }));
    assert.equal(response.status, 200, `diagnostic attempt ${index + 1}`);
    const body = await response.json();
    assert.equal(body.riskLevel, "high");
  }
});

test("core and coverage runs are version-pinned, recomputed, append-once, and sealed against mutation", async () => {
  const session = newSession("000000000006");
  const validRun = coreRun();
  const validCoverage = await compactCoverageRun();
  await assert.rejects(
    () => attachAutomaticRun(session, { ...validRun, runnerVersion: "bora-evaluator/1.2" }, validCoverage),
    /judge_session_version_mismatch/u,
  );
  await assert.rejects(
    () => attachAutomaticRun(session, { ...validRun, datasetHash: "0".repeat(64) }, validCoverage),
    /judge_session_version_mismatch/u,
  );
  await assert.rejects(
    () => attachAutomaticRun(session, { ...validRun, resultDigest: "00000000" }, validCoverage),
    /judge_session_version_mismatch/u,
  );
  await assert.rejects(
    () => attachAutomaticRun(session, {
      ...validRun,
      snapshot: {
        ...validRun.snapshot,
        artifactHashes: { ...validRun.snapshot.artifactHashes, apiSnapshots: "0".repeat(64) },
      },
    }, validCoverage),
    /judge_session_version_mismatch/u,
  );
  await assert.rejects(
    () => attachAutomaticRun(session, {
      ...validRun,
      snapshot: {
        ...validRun.snapshot,
        networkCalls: 99,
        modelCalls: 99,
        authorship: {
          ...validRun.snapshot.authorship,
          model: "forged-model",
          independentExpertReview: "performed",
        },
        limitations: [],
      },
    }, validCoverage),
    /judge_session_version_mismatch/u,
  );
  const duplicateCases = runOfflineJudgeCases();
  duplicateCases[duplicateCases.length - 1] = structuredClone(duplicateCases[0]);
  await assert.rejects(
    () => attachAutomaticRun(session, coreRun(duplicateCases, "core-run-duplicate"), validCoverage),
    /judge_session_version_mismatch/u,
  );
  const tamperedCases = runOfflineJudgeCases();
  tamperedCases[0] = { ...tamperedCases[0], earnedScore: 999 };
  await assert.rejects(
    () => attachAutomaticRun(session, coreRun(tamperedCases, "core-run-tampered"), validCoverage),
    /judge_session_version_mismatch/u,
  );
  const forgedEvidenceCases = runOfflineJudgeCases();
  forgedEvidenceCases[0] = {
    ...forgedEvidenceCases[0],
    actual: "{\"totalAssets\":0}",
    outputDigest: "00000000",
    assertions: forgedEvidenceCases[0].assertions.map((assertion) => ({
      ...assertion,
      actual: "forged",
      passed: true,
    })),
  };
  await assert.rejects(
    () => attachAutomaticRun(session, coreRun(forgedEvidenceCases, "core-run-forged-evidence"), validCoverage),
    /judge_session_version_mismatch/u,
  );
  await assert.rejects(
    () => attachAutomaticRun(session, validRun, null),
    /judge_session_version_mismatch/u,
  );
  const forgedCoverage = { ...validCoverage, resultSha256: "0".repeat(64) };
  await assert.rejects(
    () => attachAutomaticRun(session, validRun, forgedCoverage),
    /judge_session_version_mismatch/u,
  );
  assert.throws(
    () => applyJudgeReviewUpdate(session, {}, "sealed"),
    /judge_automatic_run_required/u,
  );

  const withCore = await attachAutomaticRun(session, validRun, validCoverage);
  const coreWithoutCoverage = { ...withCore, coverageRun: null };
  assert.throws(
    () => applyJudgeReviewUpdate(coreWithoutCoverage, {}, "sealed"),
    /judge_coverage_run_required/u,
  );
  await assert.rejects(
    () => attachAutomaticRun(withCore, coreRun(runOfflineJudgeCases(), "core-run-2"), validCoverage),
    /judge_core_run_already_exists/u,
  );
  assert.throws(
    () => attachDiagnosticRun(withCore, { ...diagnosticRun(), version: "bora-api-diagnostics/0" }),
    /judge_diagnostic_version_mismatch/u,
  );
  const withBoth = attachDiagnosticRun(withCore, diagnosticRun());
  assert.throws(
    () => attachDiagnosticRun(withBoth, { ...diagnosticRun(), id: "diagnostic-run-2" }),
    /judge_diagnostic_run_already_exists/u,
  );

  const sealed = applyJudgeReviewUpdate(
    withBoth,
    { reviewerNotes: "자동평가와 별도 진단을 확인함" },
    "sealed",
    new Date("2026-08-11T00:00:05.000Z"),
  );
  assert.equal(sealed.status, "sealed");
  assert.equal(sealed.sealedAt, "2026-08-11T00:00:05.000Z");
  assert.equal(sealed.summary.totalScore, 100);
  assert.throws(() => applyJudgeReviewUpdate(sealed, {}, "review"), /judge_session_sealed/u);
  await assert.rejects(() => attachAutomaticRun(sealed, validRun, validCoverage), /judge_session_sealed/u);
  assert.throws(() => attachDiagnosticRun(sealed, diagnosticRun()), /judge_session_sealed/u);
});

test("JSON and CSV exports retain provenance, score boundaries, case evidence, and formula protection", async () => {
  const withCore = await attachAutomaticRun(newSession("000000000007"), coreRun(), await compactCoverageRun());
  const withBoth = attachDiagnosticRun(withCore, diagnosticRun());
  const injected = structuredClone(withBoth);
  injected.title = "=HYPERLINK(\"https://invalid.example\")";
  injected.gateReviews[JUDGE_SAFETY_GATES[0].id].note = "+SUM(1,1)";
  injected.automaticRun.cases[0].assertions[0].actual = "@CMD";
  injected.automaticRun.cases[1].assertions[0].actual = "https://admin:password@example.invalid/private";
  injected.diagnosticRun.checks[0].actual = "-1+2";
  injected.reviewerNotes = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123456 ghp_abcdefghijklmnopqrstuvwxyz123456 AKIAABCDEFGHIJKLMNOP ya29.abcdefghijklmnopqrstuvwxyz123456";

  const canonical = judgeExports.judgeCanonicalExport(
    injected,
    exportDefinitions(),
    "2026-08-11T00:00:06.000Z",
  );
  assert.equal(canonical.schemaVersion, JUDGE_EXPORT_SCHEMA_VERSION);
  assert.equal(canonical.evaluationMode, "offline-dataset-replay");
  assert.match(canonical.scoringNotice, /공식 심사 점수.*아닙니다/u);
  assert.match(canonical.scoreBoundary, /API.*별도.*점수에 합산하지 않/u);
  assert.equal(canonical.datasetProvenance.model, "gpt-5.6-sol");
  assert.equal(canonical.datasetProvenance.runtimeJudgeUse, false);
  assert.equal(canonical.session.datasetId, JUDGE_DATASET_ID);
  assert.equal(canonical.session.datasetHash, JUDGE_DATASET_HASH);
  assert.equal(canonical.session.runnerVersion, JUDGE_RUNNER_VERSION);
  assert.equal(canonical.session.automaticRun.resultDigest, withCore.automaticRun.resultDigest);
  assert.equal(canonical.session.automaticRun.cases.length, 28);
  assert.equal(canonical.session.diagnosticRun.checks.length, 1);
  assert.equal(canonical.session.summary.totalScore, 100);
  assert.equal(canonical.session.reviewer.displayName, "승인된 개발자");
  assert.deepEqual(canonical.session.manualReviews, {});
  assert.match(canonical.session.reviewerNotes, /\[secret-redacted\]/u);
  assert.doesNotMatch(JSON.stringify(canonical), /ghp_|AKIAABCDEFGHIJKLMNOP|ya29\.|eyJhbGci/u);
  assert.match(JSON.stringify(canonical), /https:\/\/\[userinfo-redacted\]@example\.invalid/u);

  const csv = judgeExports.judgeSessionCsv(injected, exportDefinitions());
  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.match(csv, /"record_type".*"dataset_sha256".*"dataset_authoring_model".*"result_digest"/u);
  assert.match(csv, /"session_summary","core"/u);
  assert.match(csv, /"core_assertion","core"/u);
  assert.match(csv, /"automatic_gate","core"/u);
  assert.match(csv, /"api_diagnostic","diagnostic"/u);
  assert.match(csv, /"diagnostic_summary","diagnostic"/u);
  assert.match(csv, /"dataset_provenance","core"/u);
  assert.match(csv, new RegExp(JUDGE_API_SNAPSHOT_HASH, "u"));
  assert.match(csv, new RegExp(JUDGE_EVIDENCE_MANIFEST_HASH, "u"));
  assert.match(csv, /"not_performed"/u);
  assert.match(csv, new RegExp(JUDGE_DATASET_HASH, "u"));
  assert.match(csv, /"gpt-5\.6-sol"/u);
  assert.match(csv, new RegExp(withCore.automaticRun.resultDigest, "u"));
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/invalid\.example""\)"/u);
  assert.match(csv, /"'\+SUM\(1,1\)"/u);
  assert.match(csv, /"'@CMD"/u);
  assert.match(csv, /"'-1\+2"/u);
  assert.equal(judgeExports.neutralizeCsvFormula(" ordinary"), " ordinary");
  assert.equal(judgeExports.neutralizeCsvFormula("=1+1"), "'=1+1");
  assert.equal(judgeExports.neutralizeCsvFormula(" \t@payload"), "' \t@payload");
  assert.equal(judgeExports.neutralizeCsvFormula(-1), "'-1");

  const parsedRows = csv.slice(1).trimEnd().split("\r\n").map(parseCsvLine);
  const [header, ...records] = parsedRows;
  assert.equal(records.every((row) => row.length === header.length), true);
  const typeIndex = header.indexOf("record_type");
  const scoreIndex = header.indexOf("score");
  const maxScoreIndex = header.indexOf("max_score");
  const coreCases = records.filter((row) => row[typeIndex] === "core_case");
  const coreAssertions = records.filter((row) => row[typeIndex] === "core_assertion");
  const coverageSummaries = records.filter((row) => row[typeIndex] === "coverage_summary");
  const coverageSuites = records.filter((row) => row[typeIndex] === "coverage_suite");
  assert.equal(coreCases.reduce((sum, row) => sum + Number(row[scoreIndex]), 0), 100);
  assert.equal(coreCases.reduce((sum, row) => sum + Number(row[maxScoreIndex]), 0), 100);
  assert.equal(coreAssertions.every((row) => row[scoreIndex] === "" && row[maxScoreIndex] === ""), true);
  assert.equal(coverageSummaries.length, 1);
  assert.equal(coverageSuites.length, 6);
  assert.equal([...coverageSummaries, ...coverageSuites]
    .every((row) => row[scoreIndex] === "" && row[maxScoreIndex] === ""), true);
  assert.match(csv, /600-case deterministic coverage/u);
  assert.match(csv, new RegExp(withCore.coverageRun.resultSha256, "u"));
});

test("developer evaluation route is separate, access-controlled, server-evaluated, and non-indexed", async () => {
  const [route, page, layout, css, developerPage, store, attributes, evaluationSource, replayScript] = await Promise.all([
    readFile(new URL("../app/api/developer/judge-sessions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/developer/evaluation/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/developer/evaluation/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/developer/evaluation/evaluation.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/developer/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/judge-session-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../.gitattributes", import.meta.url), "utf8"),
    readFile(new URL("../lib/judge-evaluation.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/replay-judge-dataset.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(route, /authenticatedUser\(request\)/u);
  assert.match(route, /isDeveloperUser\(user\)/u);
  assert.match(route, /requireSameOrigin\(request\)/u);
  assert.match(route, /MAX_REQUEST_BYTES = 64 \* 1024/u);
  assert.match(route, /body\.action === "run"/u);
  assert.match(route, /body\.action === "diagnostics"|body\.action !== "run" && body\.action !== "diagnostics"/u);
  assert.match(route, /const cases = runOfflineJudgeCases\(\)/u);
  assert.match(route, /runJudgeCoverageCorpusCases\(\)/u);
  assert.match(route, /compactJudgeCoverageCorpusResult/u);
  assert.match(route, /await attachAutomaticRun/u);
  assert.match(route, /resultDigest: canonicalJudgeRunDigest\(cases\)/u);
  assert.match(route, /runApiDiagnostics\(request, snapshot\)/u);
  assert.match(route, /healthRouteHandler/u);
  assert.match(route, /publicDashboardRouteHandler/u);
  assert.match(route, /runPhishingDiagnosticRequest/u);
  assert.doesNotMatch(route, /body\.(?:cases|probes|automaticRun|coverageRun|diagnosticRun)/u);
  assert.doesNotMatch(route, /\bfetch\s*\(/u);
  assert.doesNotMatch(route, /generateAICompletion|runtimeSecret\s*\(/u);

  assert.match(page, /requestJson\("\/api\/developer\/judge-sessions"/u);
  assert.match(page, /judgeCanonicalExport/u);
  assert.match(page, /judgeSessionCsv/u);
  assert.match(page, /window\.print\(\)/u);
  assert.match(page, /API.*100점.*합산되지 않습니다/u);
  assert.match(page, /628건 자동검증/u);
  assert.match(page, /600건 전수 회귀검사/u);
  assert.match(page, /GPT.?5\.6 Sol/u);
  assert.doesNotMatch(page, /manualReviews|type="number"/u);
  assert.match(layout, /robots: \{ index: false, follow: false \}/u);
  assert.match(css, /@media print/u);
  assert.match(css, /min-height: 44px/u);
  assert.match(developerPage, /href="\/developer\/evaluation"/u);
  assert.match(store, /parsed\.schemaVersion !== 2 && parsed\.schemaVersion !== 3 && parsed\.schemaVersion !== 4 && parsed\.schemaVersion !== 5 && parsed\.schemaVersion !== 6 && parsed\.schemaVersion !== JUDGE_SESSION_SCHEMA_VERSION/u);
  assert.match(store, /validStoredJudgeCoverageRun\(parsed\.coverageRun\)/u);
  assert.match(store, /ORDER BY created_at DESC, id DESC/u);
  assert.match(route, /nextCursor/u);
  assert.match(page, /serverCount !== currentSessionCount/u);
  assert.match(page, /uniqueSessions\.length < serverCount/u);
  assert.match(attributes, /(?:evaluation\/datasets\/)?\*\.json text eol=lf/u);
  assert.match(evaluationSource, /bora-judge-core-v2\.json/u);
  assert.doesNotMatch(evaluationSource, /import judgeDataset from .*bora-judge-core-v1\.json/u);
  assert.match(replayScript, /artifactHashMismatches/u);
  assert.match(replayScript, /forbiddenRunnerDependencies/u);
});

test("API listing rejects legacy v1 instead of reinterpreting it as the v2 100-point evaluation", async () => {
  const [route, legacyRaw, legacyProvenanceRaw] = await Promise.all([
    readFile(new URL("../app/api/developer/judge-sessions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../evaluation/datasets/bora-judge-core-v1.json", import.meta.url), "utf8"),
    readFile(new URL("../evaluation/datasets/bora-judge-core-v1.provenance.json", import.meta.url), "utf8"),
  ]);
  const legacy = JSON.parse(legacyRaw);
  const legacyProvenance = JSON.parse(legacyProvenanceRaw);

  assert.equal(legacy.scoring.automaticPoints, 60);
  assert.equal(legacy.scoring.humanReviewPoints, 40);
  assert.equal(legacy.cases.length, 16);
  assert.equal(legacyProvenance.dataset.datasetId, legacy.datasetId);
  assert.equal(legacyProvenance.dataset.runnerVersion, legacy.runnerVersion);
  assert.notEqual(legacy.datasetId, JUDGE_DATASET_ID);
  assert.notEqual(legacy.runnerVersion, JUDGE_RUNNER_VERSION);
  assert.match(route, /schemaVersion: JUDGE_SESSION_SCHEMA_VERSION/u);
  assert.match(route, /listJudgeSessionsForDefinition/u);
  assert.match(route, /countJudgeSessionsForDefinition/u);
  assert.match(route, /legacySessionCount: Math\.max\(0, totalSessionCount - currentSessionCount\)/u);
  assert.match(route, /current\.schemaVersion !== JUDGE_SESSION_SCHEMA_VERSION/u);
  assert.match(route, /current\.runnerVersion !== JUDGE_RUNNER_VERSION/u);
  assert.match(route, /current\.rubricVersion !== JUDGE_RUBRIC_VERSION/u);
  assert.match(route, /current\.datasetId !== JUDGE_DATASET_ID/u);
  assert.match(route, /current\.datasetHash !== JUDGE_DATASET_HASH/u);
});
