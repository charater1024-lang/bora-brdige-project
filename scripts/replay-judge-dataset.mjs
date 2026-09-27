import { createServer } from "vite";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const server = await createServer({
  root: process.cwd(),
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": process.cwd() } },
  server: { middlewareMode: true },
});

try {
  const evaluation = await server.ssrLoadModule("/lib/judge-evaluation.ts");
  const coverage = await server.ssrLoadModule("/lib/judge-coverage-corpus.ts");
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const originalRandom = Math.random;
  let observedFetchCalls = 0;
  let observedDateNowCalls = 0;
  let observedRandomCalls = 0;
  globalThis.fetch = async () => {
    observedFetchCalls += 1;
    throw new Error("offline_judge_network_call_blocked");
  };
  Date.now = () => {
    observedDateNowCalls += 1;
    return 1_786_377_600_000;
  };
  Math.random = () => {
    observedRandomCalls += 1;
    return 0.5;
  };
  let cases;
  let repeatedCases;
  let coverageCases;
  let repeatedCoverageCases;
  let coverageRun;
  let repeatedCoverageRun;
  let attachedSession;
  try {
    cases = evaluation.runOfflineJudgeCases();
    repeatedCases = evaluation.runOfflineJudgeCases();
    coverageCases = coverage.runJudgeCoverageCorpusCases();
    repeatedCoverageCases = coverage.runJudgeCoverageCorpusCases();
    coverageRun = await coverage.compactJudgeCoverageCorpusResult(coverageCases);
    repeatedCoverageRun = await coverage.compactJudgeCoverageCorpusResult(repeatedCoverageCases);
    const session = evaluation.createJudgeSession({
      id: "judge_00000000-0000-4000-8000-000000000001",
      title: "offline replay",
      reviewer: { displayName: "replay", provider: "offline" },
      now: new Date("2026-08-11T00:00:00.000Z"),
    });
    attachedSession = await evaluation.attachAutomaticRun(session, {
      id: "offline-replay-run",
      runnerVersion: evaluation.JUDGE_RUNNER_VERSION,
      datasetId: evaluation.JUDGE_DATASET_ID,
      datasetHash: evaluation.JUDGE_DATASET_HASH,
      startedAt: "2026-08-11T00:00:01.000Z",
      completedAt: "2026-08-11T00:00:02.000Z",
      resultDigest: evaluation.canonicalJudgeRunDigest(cases),
      cases,
      snapshot: evaluation.judgeCoreSnapshot(),
    }, coverageRun, new Date("2026-08-11T00:00:02.000Z"));
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
    Math.random = originalRandom;
  }
  const repeatByteIdentical = JSON.stringify(cases) === JSON.stringify(repeatedCases)
    && JSON.stringify(coverageCases) === JSON.stringify(repeatedCoverageCases)
    && JSON.stringify(coverageRun) === JSON.stringify(repeatedCoverageRun);
  const score = cases.reduce((sum, item) => sum + item.earnedScore, 0);
  const failed = cases.filter((item) => item.status !== "pass");
  const coverageFailed = coverageCases.filter((item) => item.status !== "pass");
  const artifactFiles = {
    coreDataset: "evaluation/datasets/bora-judge-core-v2.json",
    apiSnapshots: "evaluation/datasets/bora-api-contract-snapshots-v1.json",
    evidenceManifest: "evaluation/datasets/bora-submission-evidence-v1.json",
  };
  const artifactHashes = Object.fromEntries(await Promise.all(Object.entries(artifactFiles).map(async ([key, path]) => [
    key,
    sha256(await readFile(resolve(process.cwd(), path))),
  ])));
  const expectedArtifactHashes = evaluation.JUDGE_ARTIFACT_HASHES;
  const artifactHashMismatches = Object.keys(artifactFiles).filter(
    (key) => artifactHashes[key] !== expectedArtifactHashes[key],
  );
  const runnerSource = await readFile(resolve(process.cwd(), "lib/judge-evaluation.ts"), "utf8");
  const forbiddenRunnerDependencies = [
    ["fetch", /\bfetch\s*\(/u],
    ["runtime-settings", /runtime-settings/u],
    ["AI completion", /generateAICompletion|createChatCompletion|responses\.create/u],
    ["cloudflare-runtime", /cloudflare:workers/u],
    ["wall-clock", /Date\.now\s*\(/u],
    ["randomness", /Math\.random\s*\(/u],
  ].filter(([, pattern]) => pattern.test(runnerSource)).map(([label]) => label);
  const report = {
    evaluationMode: "offline-dataset-replay",
    datasetId: evaluation.JUDGE_DATASET_ID,
    datasetSha256: evaluation.JUDGE_DATASET_HASH,
    artifactHashes,
    runnerVersion: evaluation.JUDGE_RUNNER_VERSION,
    caseCount: cases.length,
    score,
    maxScore: evaluation.JUDGE_AUTOMATIC_MAX_SCORE,
    resultDigest: evaluation.canonicalJudgeRunDigest(cases),
    digestAlgorithm: "fnv1a-32",
    observedFetchCalls,
    observedDateNowCalls,
    observedRandomCalls,
    declaredModelCalls: evaluation.judgeCoreSnapshot().modelCalls,
    repeatByteIdentical,
    coverage: {
      corpusId: coverageRun.corpusId,
      manifestSha256: coverageRun.manifestSha256,
      resultSha256: coverageRun.resultSha256,
      caseCount: coverageRun.totalCases,
      passed: coverageRun.passedCases,
      failed: coverageRun.failedCases,
      errors: coverageRun.errorCases,
      allPassed: coverageRun.allPassed,
      suiteSummaries: coverageRun.suiteSummaries,
      scoreContribution: coverageRun.relationshipToDeepScore.coverageScoreContribution,
      networkCalls: coverageRun.execution.networkCalls,
      modelCalls: coverageRun.execution.modelCalls,
      compactJsonCharacters: coverageRun.compactJsonCharacters,
    },
    sessionJsonCharacters: JSON.stringify(attachedSession).length,
    sessionCharacterLimit: 131_072,
    integrity: {
      artifactHashMismatches,
      forbiddenRunnerDependencies,
    },
    status: failed.length === 0
      && score === evaluation.JUDGE_AUTOMATIC_MAX_SCORE
      && artifactHashMismatches.length === 0
      && forbiddenRunnerDependencies.length === 0
      && observedFetchCalls === 0
      && observedDateNowCalls === 0
      && observedRandomCalls === 0
      && repeatByteIdentical
      && coverageRun.totalCases === 600
      && coverageRun.passedCases === 600
      && coverageRun.failedCases === 0
      && coverageRun.errorCases === 0
      && coverageRun.suiteSummaries.length === 6
      && coverageRun.suiteSummaries.every((suite) => suite.total === 100 && suite.passed === 100 && suite.gate === "pass")
      && coverageRun.relationshipToDeepScore.coverageScoreContribution === 0
      && coverageRun.execution.networkCalls === 0
      && coverageRun.execution.modelCalls === 0
      && coverageFailed.length === 0
      && JSON.stringify(attachedSession).length < 131_072
      && attachedSession.summary.readinessGate === "pass"
      ? "pass"
      : "fail",
    failed: failed.map((item) => ({
      id: item.id,
      status: item.status,
      errorCode: item.errorCode,
      failedAssertions: item.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.id),
    })),
    coverageFailed: coverageFailed.map((item) => ({
      id: item.id,
      status: item.status,
      errorCode: item.errorCode,
      failedAssertions: item.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.id),
    })),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "pass") process.exitCode = 1;
} finally {
  await server.close();
}
