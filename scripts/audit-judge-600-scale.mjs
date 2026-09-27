import { createServer } from "vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const SESSION_LIMIT_CHARACTERS = 128 * 1024;
const TARGET_CASES_PER_SUITE = 100;

function bytes(value) {
  return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

function characters(value) {
  return (typeof value === "string" ? value : JSON.stringify(value)).length;
}

function duplicateToTarget(items, suite, targetCount) {
  const source = items.filter((item) => item.suite === suite);
  if (source.length === 0) throw new Error(`missing_suite:${suite}`);
  return Array.from({ length: targetCount }, (_, index) => {
    const seed = source[index % source.length];
    return { ...seed, id: `${suite}-${String(index + 1).padStart(3, "0")}` };
  });
}

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
  const datasetPath = resolve(process.cwd(), "evaluation/datasets/bora-judge-core-v2.json");
  const datasetText = await readFile(datasetPath, "utf8");
  const dataset = JSON.parse(datasetText);
  const suites = [...new Set(dataset.cases.map((item) => item.suite))];
  const startedAt = "2026-08-11T00:00:00.000Z";
  const base = evaluation.createJudgeSession({
    id: "judge-scale-audit",
    title: "600-case storage audit",
    reviewer: { displayName: "audit", provider: "offline" },
    now: new Date(startedAt),
  });
  const cases = evaluation.runOfflineJudgeCases();
  const run = {
    id: "run-scale-audit",
    runnerVersion: evaluation.JUDGE_RUNNER_VERSION,
    datasetId: evaluation.JUDGE_DATASET_ID,
    datasetHash: evaluation.JUDGE_DATASET_HASH,
    startedAt,
    completedAt: startedAt,
    resultDigest: evaluation.canonicalJudgeRunDigest(cases),
    cases,
    snapshot: evaluation.judgeCoreSnapshot(),
  };
  const coverageCases = coverage.runJudgeCoverageCorpusCases();
  const compactCoverage = await coverage.compactJudgeCoverageCorpusResult(coverageCases);
  const currentSession = await evaluation.attachAutomaticRun(base, run, compactCoverage, new Date(startedAt));
  const currentSessionWithCompactCoverage = currentSession;
  const projectedDefinitions = suites.flatMap((suite) => (
    duplicateToTarget(currentSession.definitions.automaticCases, suite, TARGET_CASES_PER_SUITE)
  ));
  const projectedResults = suites.flatMap((suite) => (
    duplicateToTarget(currentSession.automaticRun.cases, suite, TARGET_CASES_PER_SUITE)
  ));
  const naiveProjectedSession = {
    ...currentSession,
    definitions: {
      ...currentSession.definitions,
      automaticCases: projectedDefinitions,
    },
    automaticRun: {
      ...currentSession.automaticRun,
      cases: projectedResults,
    },
  };
  const statusBits = Buffer.alloc(Math.ceil(projectedResults.length * 2 / 8)).toString("base64");
  const compactProjection = {
    schemaVersion: 7,
    id: "judge-scale-audit",
    datasetRef: {
      id: "bora-judge-core-600-v3",
      sha256: "0".repeat(64),
      caseCount: projectedResults.length,
      casesPerSuite: TARGET_CASES_PER_SUITE,
    },
    scoring: {
      contributionPoints: 0,
      deepScorePreserved: 100,
      readinessRule: "all-600-pass-and-six-suite-gates-pass",
    },
    outcomeEncoding: {
      format: "two-bit-status-in-dataset-order",
      caseOrderSha256: "0".repeat(64),
      value: statusBits,
    },
    suiteSummaries: suites.map((suite) => ({ suite, passed: 100, failed: 0, error: 0 })),
    gates: dataset.gates.map((gate) => ({ id: gate.id, status: "pass", failedCaseIds: [] })),
    resultSha256: "0".repeat(64),
    failureDetails: [],
  };
  const currentSessionBytes = bytes(currentSession);
  const naiveProjectedBytes = bytes(naiveProjectedSession);
  const currentSessionCharacters = characters(currentSession);
  const naiveProjectedCharacters = characters(naiveProjectedSession);
  const report = {
    current: {
      datasetCases: dataset.cases.length,
      datasetBytes: bytes(datasetText),
      sessionBytes: currentSessionBytes,
      sessionCharacters: currentSessionCharacters,
      definitionsBytes: bytes(currentSession.definitions),
      automaticRunBytes: bytes(currentSession.automaticRun),
      withCompactCoverageBytes: bytes(currentSessionWithCompactCoverage),
      withCompactCoverageCharacters: characters(currentSessionWithCompactCoverage),
    },
    target: {
      suites: suites.length,
      casesPerSuite: TARGET_CASES_PER_SUITE,
      totalCases: suites.length * TARGET_CASES_PER_SUITE,
      naiveProjectedSessionBytes: naiveProjectedBytes,
      naiveProjectedSessionCharacters: naiveProjectedCharacters,
      compactProjectionBytes: bytes(compactProjection),
      compactProjectionCharacters: characters(compactProjection),
    },
    storage: {
      d1SessionLimitCharacters: SESSION_LIMIT_CHARACTERS,
      naiveProjectedFits: naiveProjectedCharacters <= SESSION_LIMIT_CHARACTERS,
      naiveProjectedOverLimitByCharacters: Math.max(0, naiveProjectedCharacters - SESSION_LIMIT_CHARACTERS),
      currentUtilizationPercent: Number((currentSessionCharacters / SESSION_LIMIT_CHARACTERS * 100).toFixed(1)),
      projectedUtilizationPercent: Number((naiveProjectedCharacters / SESSION_LIMIT_CHARACTERS * 100).toFixed(1)),
    },
    scoring: {
      existingSuitePoints: Object.fromEntries(suites.map((suite) => [
        suite,
        dataset.cases.filter((item) => item.suite === suite).reduce((sum, item) => sum + item.weight, 0),
      ])),
      coverageScoreContribution: 0,
      readinessPolicy: "The 28-case deep evaluation keeps the 100-point score; all 600 coverage cases and all six suite gates must pass.",
      recommendation: "Store only compact suite summaries, status bits, hashes, and bounded failure evidence; keep the 600-case corpus as an unscored fail-closed readiness gate.",
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await server.close();
}
