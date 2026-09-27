import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { createServer } from "vite";

const DIRECTORY = "evaluation/datasets/bora-judge-coverage-v14";
const EXPECTED_CORPUS_ID = "bora-judge-coverage-2026-09-23-v14";
const REQUIRED_EVALUATOR_SOURCE_PATHS = [
  "package.json",
  "lib/judge-coverage-contract.ts",
  "lib/judge-coverage-corpus.ts",
  "lib/judge-coverage-policies.ts",
  "scripts/replay-judge-coverage-corpus-v14.mjs",
  "tests/safe-browsing-v5.test.mjs",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const textFileSha256 = (value) => sha256(
  new TextDecoder("utf-8", { fatal: true }).decode(value).replace(/\r\n?/gu, "\n"),
);
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

const cliArguments = new Set(process.argv.slice(2));
const requireSealed = cliArguments.delete("--require-sealed");
if (cliArguments.size > 0) throw new Error(`coverage_replay_arguments_invalid:${[...cliArguments].join(",")}`);

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function safeRepositoryPath(path) {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path) || /^[/\\]{2}/u.test(path)) {
    return false;
  }
  const repositoryRelative = relative(root, resolve(root, path));
  return repositoryRelative.length > 0 && !repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative);
}

async function librarySourcePaths(directory = "lib") {
  const entries = await readdir(resolve(root, directory), { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...await librarySourcePaths(path));
    else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|json)$/u.test(entry.name)) paths.push(path);
  }
  return paths;
}

const root = process.cwd();
const manifestText = await readFile(resolve(root, DIRECTORY, "manifest.json"), "utf8");
const manifest = JSON.parse(manifestText);
const integrityText = await readFile(resolve(root, DIRECTORY, "integrity.json"), "utf8");
const integrity = JSON.parse(integrityText);
const release = await readOptionalJson(resolve(root, DIRECTORY, "release.json"));
const releaseState = release ? "sealed" : "draft";
if (!Array.isArray(manifest.artifacts?.suites)
  || !manifest.artifacts?.dependencyLock
  || !Array.isArray(manifest.artifacts?.evaluatorSourceBundle?.files)) {
  throw new Error("coverage_preexecution_manifest_pins_missing");
}
const artifactHashMismatches = [];
if (manifest.corpusId !== EXPECTED_CORPUS_ID || integrity.corpusId !== EXPECTED_CORPUS_ID) {
  artifactHashMismatches.push("corpus-id");
}
if (manifest.schemaVersion !== "bora-judge-coverage-manifest/v2"
  || manifest.generatorVersion !== "bora-coverage-generator/2.6"
  || manifest.releasePolicy?.sealFilename !== "release.json"
  || manifest.releasePolicy?.overwriteReleasedCorpus !== false) {
  artifactHashMismatches.push("manifest-contract");
}
const orderedCases = [];
for (const descriptor of manifest.artifacts.suites) {
  if (!/^[a-z-]+\.json$/u.test(descriptor.filename)) {
    artifactHashMismatches.push(`${descriptor.filename}:invalid-path`);
    continue;
  }
  const content = await readFile(resolve(root, DIRECTORY, descriptor.filename));
  if (sha256(content) !== descriptor.sha256) artifactHashMismatches.push(descriptor.filename);
  const artifact = JSON.parse(content.toString("utf8"));
  if (artifact.corpusId !== EXPECTED_CORPUS_ID || artifact.suite !== descriptor.suite) {
    artifactHashMismatches.push(`${descriptor.filename}:identity`);
  }
  orderedCases.push(...(artifact.cases ?? []));
}
if (orderedCases.length !== 600
  || manifest.definitionSha256 !== sha256(jsonText(orderedCases))
  || manifest.caseOrderSha256 !== sha256(jsonText(orderedCases.map((item) => item.id)))) {
  artifactHashMismatches.push("case-definitions");
}
if (manifest.definitionSha256 !== "b55787f2a5463c6a304ea6b03286be2b6b40d929a7cab3c221e1889ebb371d84"
  || manifest.caseOrderSha256 !== "6fde18dfe289e3ad02c856a92a0cce50c09b3f8b0d5aaaebcaf51d39edc0b680") {
  artifactHashMismatches.push("inherited-v13-definitions");
}
if (manifest.artifacts.provenance.filename !== "provenance.json") {
  artifactHashMismatches.push("provenance-path");
} else {
  const provenanceBytes = await readFile(resolve(root, DIRECTORY, "provenance.json"));
  if (sha256(provenanceBytes) !== manifest.artifacts.provenance.sha256) artifactHashMismatches.push("provenance.json");
  if (JSON.parse(provenanceBytes.toString("utf8")).corpusId !== EXPECTED_CORPUS_ID) {
    artifactHashMismatches.push("provenance.json:identity");
  }
}
if (manifest.artifacts.generator.path !== "scripts/generate-judge-coverage-corpus-v14.mjs"
  || manifest.artifacts.generator.algorithm !== "sha256-canonical-utf8-lf/v1") {
  artifactHashMismatches.push("generator-path");
} else {
  const generatorBytes = await readFile(resolve(root, manifest.artifacts.generator.path));
  if (textFileSha256(generatorBytes) !== manifest.artifacts.generator.sha256) artifactHashMismatches.push(manifest.artifacts.generator.path);
}
if (sha256(manifestText) !== integrity.manifestSha256) artifactHashMismatches.push("manifest.json");
if (manifest.artifacts.dependencyLock?.path !== "package-lock.json"
  || manifest.artifacts.dependencyLock?.algorithm !== "sha256-canonical-utf8-lf/v1") {
  artifactHashMismatches.push("dependency-lock-path");
} else {
  const dependencyLockBytes = await readFile(resolve(root, manifest.artifacts.dependencyLock.path));
  if (textFileSha256(dependencyLockBytes) !== manifest.artifacts.dependencyLock.sha256) {
    artifactHashMismatches.push(manifest.artifacts.dependencyLock.path);
  }
}
const actualSourceDescriptors = [];
for (const descriptor of manifest.artifacts.evaluatorSourceBundle.files) {
  if (!safeRepositoryPath(descriptor.path)) {
    artifactHashMismatches.push(`${descriptor.path}:invalid-path`);
    continue;
  }
  const bytes = await readFile(resolve(root, descriptor.path));
  const actualSha256 = textFileSha256(bytes);
  actualSourceDescriptors.push({ path: descriptor.path, sha256: actualSha256 });
  if (actualSha256 !== descriptor.sha256) artifactHashMismatches.push(descriptor.path);
}
if (manifest.artifacts.evaluatorSourceBundle.algorithm !== "sha256-over-canonical-file-descriptors/v1"
  || manifest.artifacts.evaluatorSourceBundle.fileHashAlgorithm !== "sha256-canonical-utf8-lf/v1"
  || manifest.artifacts.evaluatorSourceBundle.sha256 !== sha256(jsonText(actualSourceDescriptors))) {
  artifactHashMismatches.push("evaluator-source-bundle");
}
const expectedSourcePaths = [...new Set([
  ...REQUIRED_EVALUATOR_SOURCE_PATHS,
  ...await librarySourcePaths(),
  ...orderedCases.flatMap((item) => item.sourceRefs ?? []),
])].sort();
if (JSON.stringify(manifest.artifacts.evaluatorSourceBundle.files.map((item) => item.path)) !== JSON.stringify(expectedSourcePaths)
  || manifest.artifacts.evaluatorSourceBundle.fileCount !== expectedSourcePaths.length) {
  artifactHashMismatches.push("evaluator-source-paths");
}

const releaseSealMismatches = [];
if (requireSealed && !release) releaseSealMismatches.push("release.json:missing");
if (release && (release.schemaVersion !== "bora-judge-coverage-release/v1"
  || release.corpusId !== manifest.corpusId
  || release.state !== "sealed"
  || release.manifestSha256 !== sha256(manifestText)
  || release.integritySha256 !== sha256(integrityText)
  || release.definitionSha256 !== manifest.definitionSha256
  || release.caseOrderSha256 !== manifest.caseOrderSha256
  || release.dependencyLockSha256 !== manifest.artifacts.dependencyLock.sha256
  || release.evaluatorSourceBundleSha256 !== manifest.artifacts.evaluatorSourceBundle.sha256
  || release.acceptance?.validator?.status !== "pass"
  || release.acceptance?.validator?.totalCases !== 600
  || release.acceptance?.validator?.manifestSha256 !== sha256(manifestText)
  || release.acceptance?.validator?.dependencyLockSha256 !== manifest.artifacts.dependencyLock.sha256
  || release.acceptance?.validator?.evaluatorSourceBundleSha256 !== manifest.artifacts.evaluatorSourceBundle.sha256
  || release.acceptance?.replay?.status !== "pass"
  || release.acceptance?.replay?.passedCases !== 600
  || release.acceptance?.replay?.failedCases !== 0
  || release.acceptance?.replay?.errorCases !== 0
  || release.acceptance?.replay?.manifestSha256 !== sha256(manifestText)
  || release.acceptance?.replay?.dependencyLockSha256 !== manifest.artifacts.dependencyLock.sha256
  || release.acceptance?.replay?.evaluatorSourceBundleSha256 !== manifest.artifacts.evaluatorSourceBundle.sha256
  || release.overwritePolicy !== "new-corpus-id-and-directory-required")) {
  releaseSealMismatches.push("release.json:mismatch");
}
if (artifactHashMismatches.length > 0 || releaseSealMismatches.length > 0) {
  throw new Error(`coverage_preexecution_integrity_failed:${[
    ...artifactHashMismatches,
    ...releaseSealMismatches,
  ].join(",")}`);
}

const server = await createServer({
  root,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

const originalFetch = globalThis.fetch;
let observedFetchCalls = 0;
let fetchTrapInstalled = false;
try {
  globalThis.fetch = async () => {
    observedFetchCalls += 1;
    throw new Error("coverage_network_call_blocked");
  };
  fetchTrapInstalled = true;
  const coverage = await server.ssrLoadModule("/lib/judge-coverage-corpus.ts");
  const contract = await server.ssrLoadModule("/lib/judge-coverage-contract.ts");
  const runtimeIdentityMismatches = [];
  if (coverage.JUDGE_COVERAGE_CORPUS_ID !== manifest.corpusId) runtimeIdentityMismatches.push("corpus-id");
  if (coverage.JUDGE_COVERAGE_MANIFEST_SHA256 !== integrity.manifestSha256) runtimeIdentityMismatches.push("manifest-sha256");
  if (coverage.JUDGE_COVERAGE_DEFINITION_SHA256 !== manifest.definitionSha256) runtimeIdentityMismatches.push("definition-sha256");
  if (coverage.JUDGE_COVERAGE_CASE_ORDER_SHA256 !== manifest.caseOrderSha256) runtimeIdentityMismatches.push("case-order-sha256");
  if (coverage.JUDGE_COVERAGE_TOTAL_CASES !== manifest.totalCases) runtimeIdentityMismatches.push("total-cases");
  if (coverage.JUDGE_COVERAGE_CASES_PER_SUITE !== manifest.casesPerSuite) runtimeIdentityMismatches.push("cases-per-suite");
  if (JSON.stringify(coverage.JUDGE_COVERAGE_SUITE_ORDER) !== JSON.stringify(manifest.suiteOrder)) {
    runtimeIdentityMismatches.push("suite-order");
  }
  if (runtimeIdentityMismatches.length > 0) {
    throw new Error(`coverage_runtime_identity_failed:${runtimeIdentityMismatches.join(",")}`);
  }

  const runnerSources = await Promise.all([
    "lib/judge-coverage-corpus.ts",
    "lib/judge-coverage-policies.ts",
  ].map((path) => readFile(resolve(root, path), "utf8")));
  const joinedSource = runnerSources.join("\n");
  const forbiddenRunnerDependencies = [
    ["fetch", /\bfetch\s*\(/u],
    ["wall-clock", /Date\.now\s*\(/u],
    ["randomness", /Math\.random\s*\(/u],
    ["AI completion", /generateAICompletion|createChatCompletion|responses\.create/u],
    ["cloudflare runtime", /cloudflare:workers/u],
  ].filter(([, pattern]) => pattern.test(joinedSource)).map(([label]) => label);

  const OriginalDate = globalThis.Date;
  const originalRandom = Math.random;
  const originalPerformanceNow = globalThis.performance.now;
  const originalGetRandomValues = globalThis.crypto.getRandomValues;
  const originalRandomUUID = globalThis.crypto.randomUUID;
  let observedDateNowCalls = 0;
  let observedDateConstructorCalls = 0;
  let observedRandomCalls = 0;
  let observedPerformanceNowCalls = 0;
  let observedCryptoRandomCalls = 0;
  class CoverageReplayDate extends OriginalDate {
    constructor(...arguments_) {
      if (arguments_.length === 0) {
        observedDateConstructorCalls += 1;
        super(1_786_377_600_000);
      } else {
        super(...arguments_);
      }
    }

    static now() {
      observedDateNowCalls += 1;
      return 1_786_377_600_000;
    }
  }
  globalThis.Date = CoverageReplayDate;
  Math.random = () => {
    observedRandomCalls += 1;
    return 0.5;
  };
  Object.defineProperty(globalThis.performance, "now", {
    configurable: true,
    value: () => {
      observedPerformanceNowCalls += 1;
      return 0;
    },
  });
  Object.defineProperty(globalThis.crypto, "getRandomValues", {
    configurable: true,
    value: () => {
      observedCryptoRandomCalls += 1;
      throw new Error("coverage_crypto_randomness_blocked");
    },
  });
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: () => {
      observedCryptoRandomCalls += 1;
      throw new Error("coverage_crypto_randomness_blocked");
    },
  });

  let first;
  let second;
  let firstCompact;
  let secondCompact;
  try {
    first = coverage.runJudgeCoverageCorpusCases();
    second = coverage.runJudgeCoverageCorpusCases();
    firstCompact = await coverage.compactJudgeCoverageCorpusResult(first);
    secondCompact = await coverage.compactJudgeCoverageCorpusResult(second);
    contract.judgeCoverageSessionPatch(firstCompact);
    contract.judgeCoverageSessionPatch(secondCompact);
  } finally {
    globalThis.Date = OriginalDate;
    Math.random = originalRandom;
    Object.defineProperty(globalThis.performance, "now", { configurable: true, value: originalPerformanceNow });
    Object.defineProperty(globalThis.crypto, "getRandomValues", { configurable: true, value: originalGetRandomValues });
    Object.defineProperty(globalThis.crypto, "randomUUID", { configurable: true, value: originalRandomUUID });
  }

  const compactIdentityMismatches = [];
  for (const [label, compact] of [["first", firstCompact], ["second", secondCompact]]) {
    if (compact.corpusId !== manifest.corpusId) compactIdentityMismatches.push(`${label}:corpus-id`);
    if (compact.manifestSha256 !== integrity.manifestSha256) compactIdentityMismatches.push(`${label}:manifest-sha256`);
    if (compact.definitionSha256 !== manifest.definitionSha256) compactIdentityMismatches.push(`${label}:definition-sha256`);
    if (compact.caseOrderSha256 !== manifest.caseOrderSha256) compactIdentityMismatches.push(`${label}:case-order-sha256`);
    if (compact.totalCases !== manifest.totalCases) compactIdentityMismatches.push(`${label}:total-cases`);
  }
  if (compactIdentityMismatches.length > 0) {
    throw new Error(`coverage_compact_identity_failed:${compactIdentityMismatches.join(",")}`);
  }

  const repeatByteIdentical = JSON.stringify(first) === JSON.stringify(second)
    && JSON.stringify(firstCompact) === JSON.stringify(secondCompact);
  if (release && release.acceptance?.replay?.resultSha256 !== firstCompact.resultSha256) {
    releaseSealMismatches.push("release.json:result-receipt-mismatch");
  }
  const suiteCounts = Object.fromEntries(manifest.suiteOrder.map((suite) => [
    suite,
    first.filter((item) => item.suite === suite).length,
  ]));
  const failed = first.filter((item) => item.status !== "pass");
  const report = {
    corpusId: coverage.JUDGE_COVERAGE_CORPUS_ID,
    manifestSha256: integrity.manifestSha256,
    definitionSha256: manifest.definitionSha256,
    dependencyLockSha256: manifest.artifacts.dependencyLock.sha256,
    evaluatorSourceBundleSha256: manifest.artifacts.evaluatorSourceBundle.sha256,
    releaseState,
    releaseRequired: requireSealed,
    resultSha256: firstCompact.resultSha256,
    suiteCounts,
    caseCount: first.length,
    passed: first.filter((item) => item.status === "pass").length,
    failed: first.filter((item) => item.status === "fail").length,
    errors: first.filter((item) => item.status === "error").length,
    allSuiteGatesPass: firstCompact.suiteSummaries.every((item) => item.gate === "pass"),
    relationshipToDeepScore: firstCompact.relationshipToDeepScore,
    compactJsonCharacters: firstCompact.compactJsonCharacters,
    compactSessionBudgetCharacters: firstCompact.sessionBudgetCharacters,
    observedFetchCalls,
    observedDateNowCalls,
    observedDateConstructorCalls,
    observedRandomCalls,
    observedPerformanceNowCalls,
    observedCryptoRandomCalls,
    declaredModelCalls: firstCompact.execution.modelCalls,
    repeatByteIdentical,
    artifactHashMismatches,
    releaseSealMismatches,
    forbiddenRunnerDependencies,
    failureDetails: failed.slice(0, 24).map((item) => ({
      id: item.id,
      status: item.status,
      errorCode: item.errorCode,
      failedAssertionIds: item.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.id),
    })),
  };
  report.status = report.caseCount === 600
    && Object.values(suiteCounts).every((count) => count === 100)
    && report.passed === 600
    && report.failed === 0
    && report.errors === 0
    && report.allSuiteGatesPass
    && report.relationshipToDeepScore.deepCasesPreserved === 28
    && report.relationshipToDeepScore.deepAutomaticMaxScorePreserved === 100
    && report.relationshipToDeepScore.coverageScoreContribution === 0
    && report.compactJsonCharacters <= report.compactSessionBudgetCharacters
    && observedFetchCalls === 0
    && observedDateNowCalls === 0
    && observedDateConstructorCalls === 0
    && observedRandomCalls === 0
    && observedPerformanceNowCalls === 0
    && observedCryptoRandomCalls === 0
    && report.declaredModelCalls === 0
    && repeatByteIdentical
    && artifactHashMismatches.length === 0
    && releaseSealMismatches.length === 0
    && forbiddenRunnerDependencies.length === 0
      ? "pass"
      : "fail";
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "pass") process.exitCode = 1;
} finally {
  if (fetchTrapInstalled) globalThis.fetch = originalFetch;
  await server.close();
}
