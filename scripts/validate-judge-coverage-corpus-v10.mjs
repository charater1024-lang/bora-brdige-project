import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const ROOT = process.cwd();
const DIRECTORY = "evaluation/datasets/bora-judge-coverage-v10";
const EXPECTED_CORPUS_ID = "bora-judge-coverage-2026-09-01-v10";
const EXPECTED_EVALUATOR_SOURCE_PATHS = [
  "package.json",
  "lib/judge-coverage-contract.ts",
  "lib/judge-coverage-corpus.ts",
  "lib/judge-coverage-policies.ts",
  "scripts/replay-judge-coverage-corpus-v10.mjs",
  "tests/safe-browsing-v5.test.mjs",
];
const EXPECTED_SUITES = [
  "financial-correctness",
  "evidence-grounding",
  "financial-safety",
  "privacy-consent",
  "stored-api-contract",
  "reproducibility",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const textFileSha256 = (value) => sha256(
  new TextDecoder("utf-8", { fatal: true }).decode(value).replace(/\r\n?/gu, "\n"),
);
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;

const cliArguments = new Set(process.argv.slice(2));
const requireSealed = cliArguments.delete("--require-sealed");
if (cliArguments.size > 0) throw new Error(`coverage_validator_arguments_invalid:${[...cliArguments].join(",")}`);

function canonical(value) {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

async function readJson(filename) {
  const text = await readFile(resolve(ROOT, DIRECTORY, filename), "utf8");
  return { text, value: JSON.parse(text) };
}

async function readOptionalJson(filename) {
  try {
    return await readJson(filename);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function safeRepositoryPath(path) {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path) || /^[/\\]{2}/u.test(path)) {
    return false;
  }
  const repositoryRelative = relative(ROOT, resolve(ROOT, path));
  return repositoryRelative.length > 0 && !repositoryRelative.startsWith("..") && !isAbsolute(repositoryRelative);
}

async function librarySourcePaths(directory = "lib") {
  const entries = await readdir(resolve(ROOT, directory), { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...await librarySourcePaths(path));
    else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|json)$/u.test(entry.name)) paths.push(path);
  }
  return paths;
}

const errors = [];
const { text: manifestText, value: manifest } = await readJson("manifest.json");
const { text: integrityText, value: integrity } = await readJson("integrity.json");
const { text: provenanceText, value: provenance } = await readJson("provenance.json");
const releaseRecord = await readOptionalJson("release.json");
const release = releaseRecord?.value ?? null;
const releaseState = release ? "sealed" : "draft";
if (manifest.corpusId !== EXPECTED_CORPUS_ID || integrity.corpusId !== EXPECTED_CORPUS_ID || provenance.corpusId !== EXPECTED_CORPUS_ID) {
  errors.push("corpus_id_mismatch");
}
if (manifest.schemaVersion !== "bora-judge-coverage-manifest/v2"
  || provenance.schemaVersion !== "bora-judge-coverage-provenance/v2"
  || manifest.generatorVersion !== "bora-coverage-generator/2.3"
  || provenance.generation.generatorVersion !== "bora-coverage-generator/2.3") {
  errors.push("coverage_version_mismatch");
}
if (integrity.manifestSha256 !== sha256(manifestText)) errors.push("manifest_hash_mismatch");
if (manifest.artifacts.provenance.sha256 !== sha256(provenanceText)) errors.push("provenance_hash_mismatch");
if (manifest.artifacts.provenance.filename !== "provenance.json") errors.push("provenance_path_invalid");
let generatorBytes = Buffer.from("");
if (manifest.artifacts.generator.path !== "scripts/generate-judge-coverage-corpus-v10.mjs"
  || manifest.artifacts.generator.algorithm !== "sha256-canonical-utf8-lf/v1") {
  errors.push("generator_descriptor_invalid");
} else {
  generatorBytes = await readFile(resolve(ROOT, manifest.artifacts.generator.path));
  if (manifest.artifacts.generator.sha256 !== textFileSha256(generatorBytes)) errors.push("generator_hash_mismatch");
  if (provenance.generation.generatorSha256 !== textFileSha256(generatorBytes)) errors.push("provenance_generator_hash_mismatch");
}
const generatorSource = generatorBytes.toString("utf8");
const forbiddenGeneratorDependencies = [
  ["fetch", /\bfetch\s*\(/u],
  ["wall-clock", /Date\.now\s*\(/u],
  ["randomness", /Math\.random\s*\(/u],
  ["AI completion", /generateAICompletion|createChatCompletion|responses\.create/u],
].filter(([, pattern]) => pattern.test(generatorSource)).map(([label]) => label);
if (forbiddenGeneratorDependencies.length > 0) errors.push(`forbidden_generator_dependency:${forbiddenGeneratorDependencies.join(",")}`);

const dependencyLock = manifest.artifacts.dependencyLock;
if (!dependencyLock || !safeRepositoryPath(dependencyLock.path)) {
  errors.push("dependency_lock_descriptor_invalid");
} else {
  const dependencyLockBytes = await readFile(resolve(ROOT, dependencyLock.path));
  if (dependencyLock.path !== "package-lock.json"
    || dependencyLock.algorithm !== "sha256-canonical-utf8-lf/v1"
    || textFileSha256(dependencyLockBytes) !== dependencyLock.sha256) {
    errors.push("dependency_lock_hash_mismatch");
  }
  if (provenance.generation.dependencyLock?.path !== dependencyLock.path
    || provenance.generation.dependencyLock?.sha256 !== dependencyLock.sha256) {
    errors.push("provenance_dependency_lock_mismatch");
  }
}

const allCases = [];
const sourceRefs = new Set();
for (const suite of EXPECTED_SUITES) {
  const descriptor = manifest.artifacts.suites.find((item) => item.suite === suite);
  if (!descriptor) {
    errors.push(`suite_descriptor_missing:${suite}`);
    continue;
  }
  if (descriptor.filename !== `${suite}.json`) {
    errors.push(`suite_descriptor_path_invalid:${suite}`);
    continue;
  }
  const { text, value: artifact } = await readJson(descriptor.filename);
  if (sha256(text) !== descriptor.sha256) errors.push(`suite_hash_mismatch:${suite}`);
  if (artifact.corpusId !== EXPECTED_CORPUS_ID || artifact.suite !== suite) errors.push(`suite_identity_mismatch:${suite}`);
  if (artifact.caseCount !== 100 || artifact.cases?.length !== 100 || descriptor.caseCount !== 100) errors.push(`suite_count_mismatch:${suite}`);
  if (artifact.execution !== "offline-replay" || artifact.syntheticOnly !== true) errors.push(`suite_boundary_mismatch:${suite}`);
  if (!artifact.cases?.some((item) => item.critical === true)) errors.push(`suite_critical_missing:${suite}`);
  for (const item of artifact.cases ?? []) {
    if (item.suite !== suite) errors.push(`case_suite_mismatch:${item.id}`);
    if (!Array.isArray(item.sourceRefs) || item.sourceRefs.length === 0) errors.push(`source_refs_missing:${item.id}`);
    for (const sourceRef of item.sourceRefs ?? []) sourceRefs.add(sourceRef);
    allCases.push(item);
  }
}

if (manifest.suiteCount !== 6 || manifest.casesPerSuite !== 100 || manifest.totalCases !== 600 || allCases.length !== 600) {
  errors.push("manifest_counts_invalid");
}
if (canonical(manifest.suiteOrder) !== canonical(EXPECTED_SUITES)) errors.push("suite_order_invalid");
const ids = allCases.map((item) => item.id);
if (new Set(ids).size !== ids.length) errors.push("duplicate_case_id");
if (manifest.caseOrderSha256 !== sha256(`${JSON.stringify(ids, null, 2)}\n`)) errors.push("case_order_hash_mismatch");
if (manifest.definitionSha256 !== sha256(`${JSON.stringify(allCases, null, 2)}\n`)) errors.push("definition_hash_mismatch");

const definitions = allCases.map((item) => canonical({
  operation: item.operation,
  input: item.input,
  expected: item.expected,
  grader: item.grader,
}));
const duplicateDefinitions = definitions.filter((definition, index) => definitions.indexOf(definition) !== index);
if (duplicateDefinitions.length > 0) errors.push(`duplicate_semantic_definition:${duplicateDefinitions.length}`);

for (const sourceRef of sourceRefs) {
  if (!safeRepositoryPath(sourceRef)) {
    errors.push(`source_ref_invalid:${sourceRef}`);
    continue;
  }
  try {
    await access(resolve(ROOT, sourceRef));
  } catch {
    errors.push(`source_ref_missing:${sourceRef}`);
  }
}

const expectedEvaluatorSourcePaths = [...new Set([
  ...EXPECTED_EVALUATOR_SOURCE_PATHS,
  ...await librarySourcePaths(),
  ...sourceRefs,
])].sort();
const pinnedSourceBundle = manifest.artifacts.evaluatorSourceBundle;
if (!pinnedSourceBundle
  || pinnedSourceBundle.algorithm !== "sha256-over-canonical-file-descriptors/v1"
  || pinnedSourceBundle.fileHashAlgorithm !== "sha256-canonical-utf8-lf/v1"
  || !Array.isArray(pinnedSourceBundle.files)) {
  errors.push("evaluator_source_bundle_descriptor_invalid");
} else {
  const pinnedPaths = pinnedSourceBundle.files.map((item) => item.path);
  if (canonical(pinnedPaths) !== canonical(expectedEvaluatorSourcePaths)
    || pinnedSourceBundle.fileCount !== expectedEvaluatorSourcePaths.length) {
    errors.push("evaluator_source_bundle_paths_mismatch");
  }
  const actualDescriptors = [];
  for (const descriptor of pinnedSourceBundle.files) {
    if (!safeRepositoryPath(descriptor.path)) {
      errors.push(`evaluator_source_path_invalid:${descriptor.path}`);
      continue;
    }
    try {
      const bytes = await readFile(resolve(ROOT, descriptor.path));
      const actualSha256 = textFileSha256(bytes);
      actualDescriptors.push({ path: descriptor.path, sha256: actualSha256 });
      if (actualSha256 !== descriptor.sha256) errors.push(`evaluator_source_hash_mismatch:${descriptor.path}`);
    } catch {
      errors.push(`evaluator_source_missing:${descriptor.path}`);
    }
  }
  if (pinnedSourceBundle.sha256 !== sha256(jsonText(actualDescriptors))) {
    errors.push("evaluator_source_bundle_hash_mismatch");
  }
  if (provenance.generation.evaluatorSourceBundle?.algorithm !== pinnedSourceBundle.algorithm
    || provenance.generation.evaluatorSourceBundle?.fileHashAlgorithm !== pinnedSourceBundle.fileHashAlgorithm
    || provenance.generation.evaluatorSourceBundle?.fileCount !== pinnedSourceBundle.fileCount
    || provenance.generation.evaluatorSourceBundle?.sha256 !== pinnedSourceBundle.sha256) {
    errors.push("provenance_evaluator_source_bundle_mismatch");
  }
}

const serializedCases = JSON.stringify(allCases);
const nonReservedEmails = serializedCases.match(/[\w.+-]+@([\w.-]+\.[A-Za-z]{2,})/gu) ?? [];
if (nonReservedEmails.some((email) => !email.toLowerCase().endsWith("@example.test"))) errors.push("non_reserved_email_present");
const urls = serializedCases.match(/https?:\/\/[^\s"\\]+/gu) ?? [];
if (urls.some((url) => !url.startsWith("https://example.test/"))) errors.push("non_reserved_url_present");
if (provenance.privacy.syntheticOnly !== true
  || provenance.privacy.containsRealPersonalData !== false
  || provenance.privacy.containsLiveMaliciousUrls !== false
  || provenance.authorship.officialModelReference !== "https://developers.openai.com/api/docs/models/gpt-5.6-sol"
  || provenance.authorship.codexSessionAuthorshipUsedModel !== true
  || provenance.authorship.runtimeModelUse !== false
  || provenance.authorship.independentExpertReview !== "not_performed"
  || provenance.generation.runtimeGeneratorReplayCalls.networkCalls !== 0
  || provenance.generation.runtimeGeneratorReplayCalls.modelCalls !== 0
  || provenance.generation.runtimeGeneratorReplayCalls.wallClockInputs !== 0
  || provenance.generation.runtimeGeneratorReplayCalls.randomInputs !== 0
  || provenance.generation.measurementBoundary?.fetchTrapScope !== "evaluator-module-load-and-case-execution"
  || provenance.generation.measurementBoundary?.timeRandomTrapScope !== "case-execution-after-module-load"
  || provenance.generation.measurementBoundary?.moduleInitializationTimeRandomInstrumented !== false
  || provenance.generation.measurementBoundary?.nativeHttpClientInstrumentation !== false) {
  errors.push("provenance_boundary_invalid");
}
if (manifest.execution.measurementScope !== "coverage-case-execution"
  || manifest.execution.fetchTrapIncludesEvaluatorModuleLoad !== true
  || manifest.execution.timeRandomTrapBeginsAfterEvaluatorModuleLoad !== true
  || manifest.execution.networkCalls !== 0
  || manifest.execution.modelCalls !== 0
  || manifest.execution.wallClockInputs !== 0
  || manifest.execution.randomInputs !== 0
  || manifest.relationshipToDeepScore.deepCasesPreserved !== 28
  || manifest.relationshipToDeepScore.deepAutomaticMaxScorePreserved !== 100
  || manifest.relationshipToDeepScore.coverageScoreContribution !== 0
  || manifest.resultStorage.maximumSessionCharacters > 81_920
  || manifest.resultStorage.failureDetailLimit > 32
  || manifest.resultStorage.fullCaseResultsStoredInSession !== false) {
  errors.push("manifest_boundary_invalid");
}
if (manifest.releasePolicy?.sealFilename !== "release.json"
  || manifest.releasePolicy?.sealSchemaVersion !== "bora-judge-coverage-release/v1"
  || manifest.releasePolicy?.overwriteReleasedCorpus !== false
  || manifest.releasePolicy?.draftReplacementRequiresExplicitFlag !== true
  || manifest.releasePolicy?.releasedReplacementRequiresNewCorpusId !== true
  || provenance.generation.releaseSeal?.filename !== "release.json"
  || provenance.generation.releaseSeal?.generationRefusesSealedDirectory !== true
  || provenance.generation.releaseSeal?.replacementRequiresNewCorpusId !== true) {
  errors.push("release_policy_invalid");
}
if (requireSealed && !release) errors.push("release_seal_required");
if (release) {
  if (release.schemaVersion !== "bora-judge-coverage-release/v1"
    || release.corpusId !== EXPECTED_CORPUS_ID
    || release.state !== "sealed"
    || release.manifestFilename !== "manifest.json"
    || release.manifestSha256 !== sha256(manifestText)
    || release.integrityFilename !== "integrity.json"
    || release.integritySha256 !== sha256(integrityText)
    || release.definitionSha256 !== manifest.definitionSha256
    || release.caseOrderSha256 !== manifest.caseOrderSha256
    || release.dependencyLockSha256 !== manifest.artifacts.dependencyLock?.sha256
    || release.evaluatorSourceBundleSha256 !== manifest.artifacts.evaluatorSourceBundle?.sha256
    || release.acceptance?.validator?.status !== "pass"
    || release.acceptance?.validator?.totalCases !== 600
    || release.acceptance?.validator?.manifestSha256 !== sha256(manifestText)
    || release.acceptance?.validator?.dependencyLockSha256 !== manifest.artifacts.dependencyLock?.sha256
    || release.acceptance?.validator?.evaluatorSourceBundleSha256 !== manifest.artifacts.evaluatorSourceBundle?.sha256
    || release.acceptance?.replay?.status !== "pass"
    || release.acceptance?.replay?.passedCases !== 600
    || release.acceptance?.replay?.failedCases !== 0
    || release.acceptance?.replay?.errorCases !== 0
    || !/^[a-f0-9]{64}$/u.test(release.acceptance?.replay?.resultSha256 ?? "")
    || release.acceptance?.replay?.manifestSha256 !== sha256(manifestText)
    || release.acceptance?.replay?.dependencyLockSha256 !== manifest.artifacts.dependencyLock?.sha256
    || release.acceptance?.replay?.evaluatorSourceBundleSha256 !== manifest.artifacts.evaluatorSourceBundle?.sha256
    || release.overwritePolicy !== "new-corpus-id-and-directory-required") {
    errors.push("release_seal_mismatch");
  }
}

const report = {
  corpusId: EXPECTED_CORPUS_ID,
  suiteCount: EXPECTED_SUITES.length,
  casesPerSuite: 100,
  totalCases: allCases.length,
  uniqueIds: new Set(ids).size,
  uniqueSemanticDefinitions: new Set(definitions).size,
  sourceRefCount: sourceRefs.size,
  evaluatorSourceFileCount: manifest.artifacts.evaluatorSourceBundle?.fileCount ?? 0,
  evaluatorSourceBundleSha256: manifest.artifacts.evaluatorSourceBundle?.sha256 ?? null,
  dependencyLockSha256: manifest.artifacts.dependencyLock?.sha256 ?? null,
  manifestSha256: sha256(manifestText),
  definitionSha256: manifest.definitionSha256,
  releaseState,
  releaseRequired: requireSealed,
  forbiddenGeneratorDependencies,
  errors,
  status: errors.length === 0 ? "pass" : "fail",
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (errors.length > 0) process.exitCode = 1;
