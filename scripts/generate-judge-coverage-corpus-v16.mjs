import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, open, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Operational stability and discovery UX source revision. Inherit frozen v15 cases rather
// than re-authoring or recomputing their expected outcomes from current code.
const CORPUS_ID = "bora-judge-coverage-2026-09-23-v16";
const CREATED_AT = "2026-09-23T00:00:00+09:00";
const DIRECTORY = "evaluation/datasets/bora-judge-coverage-v16";
const PREDECESSOR_DIRECTORY = "evaluation/datasets/bora-judge-coverage-v15";
const GENERATOR_PATH = "scripts/generate-judge-coverage-corpus-v16.mjs";
const PREDECESSOR_ID = "bora-judge-coverage-2026-09-23-v15";
const PREDECESSOR_RELEASE_SHA256 = "4f6f7e1503b0e056fbec9e349b2b28e789aed569460baa53d7f439ed52ea22d0";
const EXPECTED_DEFINITION_SHA256 = "b55787f2a5463c6a304ea6b03286be2b6b40d929a7cab3c221e1889ebb371d84";
const EXPECTED_CASE_ORDER_SHA256 = "6fde18dfe289e3ad02c856a92a0cce50c09b3f8b0d5aaaebcaf51d39edc0b680";
const REQUIRED_SOURCES = [
  ".gitignore",
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "lib/judge-coverage-contract.ts",
  "lib/judge-coverage-corpus.ts",
  "lib/judge-coverage-policies.ts",
  "scripts/generate-judge-coverage-corpus-v16.mjs",
  "scripts/validate-judge-coverage-corpus-v16.mjs",
  "scripts/replay-judge-coverage-corpus-v16.mjs",
  "scripts/start-local-worker.mjs",
  "scripts/local-worker-recovery.mjs",
  "scripts/local-worker-options.mjs",
  "scripts/build-local-runtime-config.mjs",
  "scripts/check-public-source.mjs",
  "app/api/ai/route.ts",
  "app/api/public-data/dashboard/route.ts",
  "app/api/public-data/item-analysis/route.ts",
  "app/components/public-data-overview.tsx",
  "app/components/public-information-pages.tsx",
  "app/components/public-information-pages.module.css",
  "app/components/bora-floating-guide.tsx",
  "app/page.tsx",
  "local-llm-server/app.py",
  "local-llm-server/gateway_security.py",
  "local-llm-server/requirements.txt",
  "local-llm-server/.env.example",
  "local-llm-server/README.md",
  "deploy/backup-bora-sqlite.py",
  "deploy/windows-backup-client.py",
  "deploy/install-windows-backup-task.ps1",
  "deploy/run-bora-sandbox.sh",
  "deploy/run-bora-ops-sandbox.sh",
  "deploy/check-bora-deep-readiness.py",
  "deploy/bora-database-backup.service",
  "deploy/bora-database-backup.timer",
  "deploy/bora-deep-readiness.service",
  "deploy/bora-deep-readiness.timer",
  "deploy/ops.env.example",
  "deploy/requirements-ops.txt",
  ".github/workflows/hackathon-evaluation.yml",
  "deploy/README.md",
  "docs/operations-recovery.md",
  "tests/safe-browsing-v5.test.mjs",
  "tests/public-catalog-performance.test.mjs",
  "tests/public-overview-request-lifecycle.test.mjs",
  "tests/public-dashboard-consistency.test.mjs",
  "tests/public-dashboard-access.test.mjs",
  "tests/frontend-reliability.test.mjs",
  "tests/mobile-readability.test.mjs",
  "tests/judge-session-history.test.mjs",
  "tests/ai-transparency-consent.test.mjs",
  "tests/bizinfo-backfill.test.mjs",
  "tests/product-recommendation-ui.test.mjs",
  "tests/public-catalog-capacity.test.mjs",
  "tests/rag-route.test.mjs",
  "tests/rendered-html.test.mjs",
  "tests/start-local-worker.test.mjs",
  "tests/local-runtime-config.test.mjs",
  "tests/stop-local-worker.test.mjs",
  "tests/youth-adapters.test.mjs",
  "tests/ai-provider-deadline.test.mjs",
  "tests/auth-storage-readiness.test.mjs",
  "tests/public-collection-health.test.mjs",
  "tests/public-information-ux.test.mjs",
  "tests/item-analysis-client-lifecycle.test.mjs",
  "tests/public-catalog-generation.test.mjs",
  "tests/startup-catalog-pagination.test.mjs",
  "tests/test_local_llm_gateway.py",
  "tests/test_local_llm_security.py",
  "tests/test_ops_backup.py",
  "tests/test_ops_readiness.py",
  "tests/test_windows_backup_client.py",
  "tests/ops-sandbox.test.mjs",
  "tests/public-source-safety.test.mjs",
  "tests/startup-adapters.test.mjs",
];
const sha256 = value => createHash("sha256").update(value).digest("hex");
const jsonText = value => `${JSON.stringify(value, null, 2)}\n`;
const textSha256 = value => sha256(new TextDecoder("utf-8", { fatal: true }).decode(value).replace(/\r\n?/gu, "\n"));
const read = path => readFile(resolve(process.cwd(), path));
const output = resolve(process.cwd(), DIRECTORY);
const releasePath = resolve(output, "release.json");

async function exists(path) {
  try { await readFile(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function librarySourcePaths(directory = "lib") {
  const paths = [];
  for (const entry of await readdir(resolve(process.cwd(), directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...await librarySourcePaths(path));
    else if (entry.isFile() && /\.(?:ts|tsx|js|mjs|json)$/u.test(entry.name)) paths.push(path);
  }
  return paths;
}

function runAcceptance(script) {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`coverage_release_acceptance_failed:${script}:${(result.stderr || result.stdout || "process-error").trim().slice(0, 2000)}`);
  }
  const report = JSON.parse(result.stdout);
  if (report.status !== "pass") throw new Error(`coverage_release_acceptance_failed:${script}:status`);
  return report;
}

async function seal() {
  if (await exists(releasePath)) throw new Error("coverage_release_already_sealed");
  // Actual acceptance must complete before a release receipt can be written.
  const validation = runAcceptance("scripts/validate-judge-coverage-corpus-v16.mjs");
  const replay = runAcceptance("scripts/replay-judge-coverage-corpus-v16.mjs");
  const manifestBytes = await read(`${DIRECTORY}/manifest.json`);
  const integrityBytes = await read(`${DIRECTORY}/integrity.json`);
  const manifest = JSON.parse(manifestBytes);
  const pins = {
    manifestSha256: sha256(manifestBytes),
    dependencyLockSha256: manifest.artifacts.dependencyLock.sha256,
    evaluatorSourceBundleSha256: manifest.artifacts.evaluatorSourceBundle.sha256,
  };
  for (const report of [validation, replay]) {
    for (const [key, value] of Object.entries(pins)) {
      if (report[key] !== value) throw new Error(`coverage_release_acceptance_receipt_mismatch:${key}`);
    }
  }
  const release = {
    schemaVersion: "bora-judge-coverage-release/v1", corpusId: CORPUS_ID,
    releaseDeclaredAt: CREATED_AT, state: "sealed", manifestFilename: "manifest.json",
    manifestSha256: pins.manifestSha256, integrityFilename: "integrity.json",
    integritySha256: sha256(integrityBytes), definitionSha256: manifest.definitionSha256,
    caseOrderSha256: manifest.caseOrderSha256,
    dependencyLockSha256: pins.dependencyLockSha256,
    evaluatorSourceBundleSha256: pins.evaluatorSourceBundleSha256,
    acceptance: {
      validator: { status: validation.status, totalCases: validation.totalCases, ...pins },
      replay: {
        status: replay.status, passedCases: replay.passed, failedCases: replay.failed,
        errorCases: replay.errors, resultSha256: replay.resultSha256, ...pins,
      },
    },
    overwritePolicy: "new-corpus-id-and-directory-required",
  };
  await writeFile(releasePath, jsonText(release), { encoding: "utf8", flag: "wx" });
  process.stdout.write(jsonText({ corpusId: CORPUS_ID, state: "sealed", ...pins, resultSha256: replay.resultSha256 }));
}

async function generate(replaceDraft) {
  if (await exists(releasePath)) throw new Error("coverage_release_sealed_new_corpus_id_required");
  if (!replaceDraft && (await readdir(output)).some(name => name.endsWith(".json"))) throw new Error("coverage_draft_exists_use_replace_draft");
  const previousReleaseBytes = await read(`${PREDECESSOR_DIRECTORY}/release.json`);
  if (sha256(previousReleaseBytes) !== PREDECESSOR_RELEASE_SHA256) throw new Error("coverage_predecessor_release_changed");
  const previousRelease = JSON.parse(previousReleaseBytes);
  const previousManifestBytes = await read(`${PREDECESSOR_DIRECTORY}/manifest.json`);
  const manifest = JSON.parse(previousManifestBytes);
  if (previousRelease.corpusId !== PREDECESSOR_ID || previousRelease.state !== "sealed"
    || previousRelease.manifestSha256 !== sha256(previousManifestBytes)
    || manifest.definitionSha256 !== EXPECTED_DEFINITION_SHA256
    || manifest.caseOrderSha256 !== EXPECTED_CASE_ORDER_SHA256) throw new Error("coverage_predecessor_identity_changed");
  const previousProvenanceBytes = await read(`${PREDECESSOR_DIRECTORY}/provenance.json`);
  if (sha256(previousProvenanceBytes) !== manifest.artifacts.provenance.sha256) throw new Error("coverage_predecessor_provenance_changed");
  const provenance = JSON.parse(previousProvenanceBytes);
  const artifacts = [], cases = [];
  for (const descriptor of manifest.artifacts.suites) {
    if (!/^[a-z-]+\.json$/u.test(descriptor.filename)) throw new Error("coverage_predecessor_suite_path_invalid");
    const bytes = await read(`${PREDECESSOR_DIRECTORY}/${descriptor.filename}`);
    if (sha256(bytes) !== descriptor.sha256) throw new Error("coverage_predecessor_suite_changed");
    const artifact = JSON.parse(bytes);
    if (artifact.corpusId !== PREDECESSOR_ID || artifact.cases.length !== 100) throw new Error("coverage_predecessor_suite_invalid");
    cases.push(...artifact.cases);
    artifact.corpusId = CORPUS_ID;
    const content = jsonText(artifact);
    artifacts.push({ filename: descriptor.filename, content });
    descriptor.sha256 = sha256(content);
  }
  if (cases.length !== 600 || sha256(jsonText(cases)) !== EXPECTED_DEFINITION_SHA256
    || sha256(jsonText(cases.map(item => item.id))) !== EXPECTED_CASE_ORDER_SHA256) throw new Error("coverage_inherited_definitions_changed");
  const paths = [...new Set([...REQUIRED_SOURCES, ...await librarySourcePaths(), ...cases.flatMap(item => item.sourceRefs)])].sort();
  const files = await Promise.all(paths.map(async path => ({ path, sha256: textSha256(await read(path)) })));
  const bundle = {
    algorithm: "sha256-over-canonical-file-descriptors/v1", fileHashAlgorithm: "sha256-canonical-utf8-lf/v1",
    fileCount: files.length, files, sha256: sha256(jsonText(files)),
  };
  const dependencyLock = { path: "package-lock.json", algorithm: "sha256-canonical-utf8-lf/v1", sha256: textSha256(await read("package-lock.json")) };
  const generatorSha256 = textSha256(await read(GENERATOR_PATH));
  provenance.corpusId = CORPUS_ID;
  provenance.createdAt = CREATED_AT;
  Object.assign(provenance.generation, {
    generatorPath: GENERATOR_PATH, generatorVersion: "bora-coverage-generator/2.8", generatorSha256,
    deterministicSeed: "bora-coverage-v16-inherit-v15-frozen-definitions", dependencyLock,
    evaluatorSourceBundle: {
      algorithm: bundle.algorithm, fileHashAlgorithm: bundle.fileHashAlgorithm,
      fileCount: bundle.fileCount, sha256: bundle.sha256,
    },
    inheritedCaseDefinitions: {
      corpusId: PREDECESSOR_ID, directory: PREDECESSOR_DIRECTORY,
      releaseSha256: PREDECESSOR_RELEASE_SHA256, definitionSha256: EXPECTED_DEFINITION_SHA256,
      caseOrderSha256: EXPECTED_CASE_ORDER_SHA256, caseCount: 600,
      caseObjectsByteIdentical: true, expectedValuesRecomputed: false,
    },
    methodology: [
      "Operational stability and discovery UX source revision: all 600 frozen v15 case objects, IDs, source references and expected outcomes are inherited byte-identically.",
      "The authorship record describes the original synthetic case authorship, not new case authoring in this revision.",
      "No expected result is recomputed or relabeled by this generator; original v15 artifacts and their release seal remain unchanged.",
      "Dependency and evaluator-source pins cover local runtime compatibility, bounded AI availability, encrypted backup/readiness tooling, collection-health diagnostics and scoped public-information UX; new validator and replay receipts are produced by actual offline acceptance runs.",
      "Coverage semantics, six suite gates and zero contribution to the 28-case deep score are unchanged.",
      "Source hashing includes implementation and regression-test files, but the inherited 600-case evaluator does not itself execute every new runtime, browser, backup or gateway test; those must be reported separately.",
      "Replay blocks fetch from evaluator module load through execution and traps the declared time/random APIs during case execution; it does not claim instrumentation of module-initialization time/randomness or native HTTP clients.",
    ],
  });
  const provenanceContent = jsonText(provenance);
  manifest.corpusId = CORPUS_ID;
  manifest.createdAt = CREATED_AT;
  manifest.generatorVersion = "bora-coverage-generator/2.8";
  manifest.artifacts.provenance.sha256 = sha256(provenanceContent);
  manifest.artifacts.generator = { path: GENERATOR_PATH, algorithm: "sha256-canonical-utf8-lf/v1", sha256: generatorSha256 };
  manifest.artifacts.dependencyLock = dependencyLock;
  manifest.artifacts.evaluatorSourceBundle = bundle;
  const manifestContent = jsonText(manifest);
  const integrity = { schemaVersion: "bora-judge-coverage-integrity/v1", corpusId: CORPUS_ID, manifestFilename: "manifest.json", manifestSha256: sha256(manifestContent) };
  for (const artifact of artifacts) await writeFile(resolve(output, artifact.filename), artifact.content, "utf8");
  await writeFile(resolve(output, "provenance.json"), provenanceContent, "utf8");
  await writeFile(resolve(output, "manifest.json"), manifestContent, "utf8");
  await writeFile(resolve(output, "integrity.json"), jsonText(integrity), "utf8");
  process.stdout.write(jsonText({ corpusId: CORPUS_ID, totalCases: cases.length, inheritedDefinitionSha256: EXPECTED_DEFINITION_SHA256, manifestSha256: integrity.manifestSha256, evaluatorSourceFileCount: bundle.fileCount }));
}

const args = new Set(process.argv.slice(2));
const sealRelease = args.delete("--seal"), replaceDraft = args.delete("--replace-draft");
if (args.size || (sealRelease && replaceDraft)) throw new Error("coverage_generator_arguments_invalid");
await mkdir(output, { recursive: true });
const lockPath = resolve(output, ".generation.lock");
let lock;
try { lock = await open(lockPath, "wx"); }
catch (error) { if (error.code === "EEXIST") throw new Error("coverage_generation_already_running"); throw error; }
try {
  await lock.writeFile("bora-judge-coverage-v16 generation lock\n", "utf8");
  if (sealRelease) await seal();
  else await generate(replaceDraft);
} finally {
  await lock.close();
  await unlink(lockPath);
}
