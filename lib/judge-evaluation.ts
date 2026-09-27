import { evaluatePhishingRuleText } from "@/app/api/phishing/route";
import { CHALLENGE_PAGE_MARKER, CHALLENGE_ROUTE_PATH } from "./challenge-contract";
import {
  AccountLifecycleError,
  parseRequiredConsentAcceptance,
} from "./auth/consent-policy";
import {
  parseAiContextPreferenceUpdate,
  sanitizeConversationContext,
} from "./ai/context-policy";
import { detectFinancialLegalIntent } from "./legal/financial-law";
import { canonicalWonFromMoneyInput, formatCanonicalWonInput } from "./money-input";
import { foreignSettlementBudgetSummary } from "./foreign-settlement";
import { manualFinanceSummary, normalizeManualFinanceAmounts } from "./manual-finance";
import { searchKnowledge } from "./rag/knowledge";
import { evaluateSecurityTriage } from "./security-triage";
import {
  JUDGE_COVERAGE_CASES_PER_SUITE,
  JUDGE_COVERAGE_CASE_ORDER_SHA256,
  JUDGE_COVERAGE_CORPUS_ID,
  JUDGE_COVERAGE_DEFINITION_SHA256,
  JUDGE_COVERAGE_FAILURE_DETAIL_LIMIT,
  JUDGE_COVERAGE_MANIFEST_SHA256,
  JUDGE_COVERAGE_SESSION_BUDGET_CHARACTERS,
  JUDGE_COVERAGE_SUITE_ORDER,
  JUDGE_COVERAGE_TOTAL_CASES,
  compactJudgeCoverageCorpusResult,
  judgeCoverageCorpusSummaryMetadata,
  runJudgeCoverageCorpusCases,
  type JudgeCoverageCompactResult,
  type JudgeCoverageSuite,
} from "./judge-coverage-corpus";
import { judgeCoverageSessionPatch } from "./judge-coverage-contract";
import { HISTORICAL_JUDGE_COVERAGE_PINS, type JudgeCoveragePins } from "./judge-coverage-history";
import { sanitizeJudgeText } from "./judge-shared";
import apiSnapshots from "../evaluation/datasets/bora-api-contract-snapshots-v1.json";
import judgeDataset from "../evaluation/datasets/bora-judge-core-v2.json";
import evidenceManifest from "../evaluation/datasets/bora-submission-evidence-v1.json";

export const JUDGE_DATASET_ID = "bora-judge-core-2026-08-11-v2";
export const JUDGE_DATASET_HASH = "f849abc73a7389b4fb9ea74c405c2613f3365771852756aeb737f222687ca45e";
export const JUDGE_API_SNAPSHOT_HASH = "d84cf7f8b6bc82709f5b4031a115c13e1a5028c225bcef07e2126f082513ede5";
export const JUDGE_EVIDENCE_MANIFEST_HASH = "c440ddb2352e32573afd7142200bc31549a9ec9ce43cf0ac0f038caf5832ddfb";
export const JUDGE_RUNNER_VERSION = "bora-evaluator/2.0";
export const JUDGE_RUBRIC_VERSION = "bora-auto-readiness-rubric/2.0";
export const JUDGE_DIAGNOSTIC_VERSION = "bora-api-diagnostics/1.0";
export const JUDGE_SESSION_SCHEMA_VERSION = 7 as const;
export { JUDGE_EXPORT_SCHEMA_VERSION, sanitizeJudgeText } from "./judge-shared";
export const JUDGE_AUTOMATIC_MAX_SCORE = 100;
export const JUDGE_HUMAN_MAX_SCORE = 0;
export const JUDGE_TOTAL_MAX_SCORE = 100;

export type JudgeArtifactHashes = {
  coreDataset: string;
  apiSnapshots: string;
  evidenceManifest: string;
};

export const JUDGE_ARTIFACT_HASHES: Readonly<JudgeArtifactHashes> = Object.freeze({
  coreDataset: JUDGE_DATASET_HASH,
  apiSnapshots: JUDGE_API_SNAPSHOT_HASH,
  evidenceManifest: JUDGE_EVIDENCE_MANIFEST_HASH,
});

export type JudgeCaseStatus = "pass" | "fail" | "error" | "blocked" | "not-run" | "skipped";
export type JudgeSessionStatus = "draft" | "review" | "sealed";
export type JudgeGateStatus = "not-reviewed" | "pass" | "fail";
export type JudgeReadinessGate = "review" | "pass" | "fail";
export type JudgeExecutionKind = "offline-replay";
export type JudgeRiskClass = "typical" | "boundary" | "high-risk-finance" | "adversarial";
export type JudgeDiagnosticStatus = "pass" | "warn" | "fail" | "error" | "not-run";

type JsonRecord = Record<string, unknown>;

type JudgeFixtureCase = {
  id: string;
  suite: string;
  label: string;
  adapter: string;
  execution: JudgeExecutionKind;
  riskClass: JudgeRiskClass;
  weight: number;
  critical?: boolean;
  input: JsonRecord;
  expected: JsonRecord;
  grader: string;
  sourceRefs: string[];
};

type JudgeDatasetGate = {
  id: string;
  label: string;
  requiredCaseIds: string[];
};

type JudgeDatasetShape = {
  schemaVersion: string;
  datasetId: string;
  runnerVersion: string;
  title: string;
  authorship: {
    provider: string;
    model: string;
    environment: string;
    role: string;
    creationMode: string;
    promptSummary: string;
    runtimeJudgeUse: boolean;
    disclosure: string;
    independentExpertReview: string;
    provenanceConfidence: string;
  };
  methodology: {
    steps: string[];
    designPrinciples: string[];
    officialGuidance: string[];
  };
  privacy: {
    syntheticOnly: boolean;
    containsPersonalData: boolean;
    containsLiveMaliciousUrls: boolean;
    networkCallsDuringCoreEvaluation: boolean;
  };
  scoring: {
    automaticPoints: number;
    humanReviewPoints: number;
    apiDiagnosticPointsIncluded: number;
    officialHackathonScore: boolean;
    label: string;
  };
  gates: JudgeDatasetGate[];
  cases: JudgeFixtureCase[];
  limitations: string[];
};

const DATASET = judgeDataset as unknown as JudgeDatasetShape;
const FIXTURE_CASES = DATASET.cases;

export function judgeFixtureCase(id: string): JudgeFixtureCase {
  const fixture = FIXTURE_CASES.find((item) => item.id === id);
  if (!fixture) throw new Error(`judge_fixture_missing:${id}`);
  return fixture;
}

export type JudgeRubricDefinition = {
  id: string;
  label: string;
  description: string;
  maxScore: number;
  evidenceHint: string;
};

// Legacy sessions remain stored, but the API never reinterprets them with this 100-point rubric.
export const JUDGE_HUMAN_RUBRIC: readonly JudgeRubricDefinition[] = [];

export type JudgeGateDefinition = {
  id: string;
  label: string;
  description: string;
  requiredCaseIds: readonly string[];
};

export const JUDGE_SAFETY_GATES: readonly JudgeGateDefinition[] = DATASET.gates.map((gate) => ({
  id: gate.id,
  label: gate.label,
  description: `필수 저장형 케이스 ${gate.requiredCaseIds.length}개가 모두 통과해야 합니다.`,
  requiredCaseIds: [...gate.requiredCaseIds],
}));

export type JudgeCaseDefinition = {
  id: string;
  suite: string;
  label: string;
  adapter: string;
  execution: JudgeExecutionKind;
  riskClass: JudgeRiskClass;
  weight: number;
  expected: string;
  grader: string;
  sourceRefs: readonly string[];
  critical?: boolean;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function compactJson(value: unknown, maximum = 320) {
  const serialized = stableStringify(value);
  return serialized.length <= maximum ? serialized : `${serialized.slice(0, maximum - 1)}…`;
}

function sameArtifactHashes(
  left: JudgeArtifactHashes | undefined,
  right: JudgeArtifactHashes,
) {
  return left?.coreDataset === right.coreDataset
    && left.apiSnapshots === right.apiSnapshots
    && left.evidenceManifest === right.evidenceManifest;
}

export const JUDGE_CASE_CATALOG: readonly JudgeCaseDefinition[] = FIXTURE_CASES.map((item) => ({
  id: item.id,
  suite: item.suite,
  label: item.label,
  adapter: item.adapter,
  execution: item.execution,
  riskClass: item.riskClass,
  weight: item.weight,
  expected: compactJson(item.expected),
  grader: item.grader,
  sourceRefs: [...item.sourceRefs],
  critical: item.critical === true,
}));

if (DATASET.datasetId !== JUDGE_DATASET_ID
  || DATASET.runnerVersion !== JUDGE_RUNNER_VERSION
  || DATASET.scoring.automaticPoints !== JUDGE_AUTOMATIC_MAX_SCORE
  || DATASET.scoring.humanReviewPoints !== JUDGE_HUMAN_MAX_SCORE
  || JUDGE_CASE_CATALOG.reduce((sum, item) => sum + item.weight, 0) !== JUDGE_AUTOMATIC_MAX_SCORE
  || new Set(JUDGE_CASE_CATALOG.map((item) => item.id)).size !== JUDGE_CASE_CATALOG.length) {
  throw new Error("judge_dataset_definition_invalid");
}

export type JudgeDefinitionSnapshot = {
  rubric: JudgeRubricDefinition[];
  safetyGates: JudgeGateDefinition[];
  automaticCases: JudgeCaseDefinition[];
};

export function currentJudgeDefinitions(): JudgeDefinitionSnapshot {
  return {
    rubric: [],
    safetyGates: JUDGE_SAFETY_GATES.map((item) => ({ ...item, requiredCaseIds: [...item.requiredCaseIds] })),
    automaticCases: JUDGE_CASE_CATALOG.map((item) => ({ ...item, sourceRefs: [...item.sourceRefs] })),
  };
}

export type JudgeAssertionResult = {
  id: string;
  label: string;
  operator: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
};

export type JudgeAutomaticCaseResult = {
  id: string;
  suite: string;
  label: string;
  adapter: string;
  execution: JudgeExecutionKind;
  riskClass: JudgeRiskClass;
  status: JudgeCaseStatus;
  weight: number;
  earnedScore: number;
  expected: string;
  actual: string;
  inputDigest: string;
  outputDigest: string;
  digestAlgorithm: "fnv1a-32";
  assertions: JudgeAssertionResult[];
  durationMs: number;
  evidence: string[];
  errorCode: string | null;
};

export type JudgeCoreSnapshot = {
  mode: "offline-dataset-replay";
  networkCalls: 0;
  modelCalls: 0;
  apiSnapshotSetId: string;
  evidenceManifestId: string;
  artifactHashes: JudgeArtifactHashes;
  authorship: JudgeDatasetShape["authorship"];
  limitations: string[];
};

export type JudgeOperationalSnapshot = {
  capturedAt: string;
  origin: string;
  appVersion: string;
  buildCommit: string | null;
  ai: {
    provider: string;
    model: string;
    runtimeUsable: boolean;
    issue: string | null;
  } | null;
  publicData: {
    status: string;
    lastSuccessfulAt: string | null;
    sourceCount: number;
    liveSourceCount: number;
    itemCount: number;
  } | null;
  serviceIntegrations: {
    configured: number;
    enabled: number;
    runtimeUsable: number;
  } | null;
};

export type JudgeAutomaticRun = {
  id: string;
  runnerVersion: string;
  datasetId: string;
  datasetHash: string;
  startedAt: string;
  completedAt: string;
  resultDigest: string;
  cases: JudgeAutomaticCaseResult[];
  snapshot: JudgeCoreSnapshot;
};

export type JudgeDiagnosticCheckResult = {
  id: string;
  label: string;
  kind: "build-contract" | "in-process-handler" | "runtime-snapshot";
  target: string;
  expected: string;
  externalNetworkCalls: 0;
  status: JudgeDiagnosticStatus;
  actual: string;
  durationMs: number;
  evidence: string[];
  errorCode: string | null;
};

export type JudgeDiagnosticRun = {
  id: string;
  version: string;
  startedAt: string;
  completedAt: string;
  checks: JudgeDiagnosticCheckResult[];
  counts: Record<JudgeDiagnosticStatus, number>;
  snapshot: JudgeOperationalSnapshot;
};

export type JudgeManualReview = {
  score: number | null;
  note: string;
  evidence: string;
};

export type JudgeSafetyGateReview = {
  status: JudgeGateStatus;
  note: string;
};

export type JudgeSessionSummary = {
  automaticScore: number;
  automaticMaxScore: number;
  humanScore: number;
  humanMaxScore: number;
  totalScore: number;
  totalMaxScore: number;
  readinessGate: JudgeReadinessGate;
  counts: Record<JudgeCaseStatus, number>;
  manualReviewed: number;
  manualTotal: number;
  gatesReviewed: number;
  gatesTotal: number;
};

export type JudgeSession = {
  schemaVersion: 2 | 3 | 4 | 5 | 6 | typeof JUDGE_SESSION_SCHEMA_VERSION;
  id: string;
  title: string;
  status: JudgeSessionStatus;
  runnerVersion: string;
  rubricVersion: string;
  datasetId: string;
  datasetHash: string;
  artifactHashes?: JudgeArtifactHashes;
  datasetPrivacy: { syntheticOnly: boolean; containsPersonalData: boolean };
  definitions: JudgeDefinitionSnapshot;
  reviewer: { displayName: string; provider: string };
  manualReviews: Record<string, JudgeManualReview>;
  gateReviews: Record<string, JudgeSafetyGateReview>;
  reviewerNotes: string;
  automaticRun: JudgeAutomaticRun | null;
  coverageRun: JudgeCoverageCompactResult | null;
  diagnosticRun: JudgeDiagnosticRun | null;
  summary: JudgeSessionSummary;
  createdAt: string;
  updatedAt: string;
  sealedAt: string | null;
};

function fnv1a32(value: unknown) {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function assertion(
  id: string,
  operator: string,
  expected: unknown,
  actual: unknown,
  passed: boolean,
  label = id,
): JudgeAssertionResult {
  return { id, label, operator, expected, actual, passed };
}

function exactFields(actual: JsonRecord, expected: JsonRecord): JudgeAssertionResult[] {
  return Object.entries(expected).map(([key, expectedValue]) => assertion(
    key,
    "eq",
    expectedValue,
    actual[key],
    stableStringify(actual[key]) === stableStringify(expectedValue),
  ));
}

function caseResult(
  fixture: JudgeFixtureCase,
  actualValue: unknown,
  assertions: JudgeAssertionResult[],
  durationMs: number,
  errorCode: string | null = null,
): JudgeAutomaticCaseResult {
  const passed = assertions.length > 0 && assertions.every((item) => item.passed);
  const status: JudgeCaseStatus = errorCode ? "error" : passed ? "pass" : "fail";
  return {
    id: fixture.id,
    suite: fixture.suite,
    label: fixture.label,
    adapter: fixture.adapter,
    execution: fixture.execution,
    riskClass: fixture.riskClass,
    status,
    weight: fixture.weight,
    earnedScore: status === "pass" ? fixture.weight : 0,
    expected: compactJson(fixture.expected),
    actual: compactJson(actualValue, 1_000),
    inputDigest: fnv1a32(fixture.input),
    outputDigest: fnv1a32(actualValue),
    digestAlgorithm: "fnv1a-32",
    assertions,
    durationMs: Math.max(0, Math.min(60_000, Math.round(durationMs))),
    evidence: [...fixture.sourceRefs],
    errorCode,
  };
}

function runCase(fixture: JudgeFixtureCase): JudgeAutomaticCaseResult {
  try {
    const input = fixture.input;
    const expected = fixture.expected;
    let actual: unknown;
    let assertions: JudgeAssertionResult[];

    switch (fixture.adapter) {
      case "manual-finance-summary": {
        const result = manualFinanceSummary(input);
        actual = Object.fromEntries(Object.keys(expected).map((key) => [key, (result as unknown as JsonRecord)[key]]));
        assertions = exactFields(recordValue(actual), expected);
        break;
      }
      case "manual-finance-normalize": {
        actual = normalizeManualFinanceAmounts(input);
        assertions = exactFields(recordValue(actual), expected);
        break;
      }
      case "foreign-settlement-summary": {
        const result = foreignSettlementBudgetSummary(input);
        actual = {
          totalExpenses: result.totalExpenses,
          remaining: result.remaining,
          expenseRatio: result.expenseRatio == null ? null : Math.round(result.expenseRatio),
        };
        assertions = exactFields(recordValue(actual), expected);
        break;
      }
      case "money-unit-conversion": {
        const unit = input.unit === "won" ? "won" : "manwon";
        const canonicalWon = canonicalWonFromMoneyInput(stringValue(input.value), unit);
        actual = { canonicalWon, formatted: formatCanonicalWonInput(canonicalWon, unit) };
        assertions = exactFields(recordValue(actual), expected);
        break;
      }
      case "knowledge-search": {
        const result = searchKnowledge(stringValue(input.query), 4);
        actual = { topDocumentId: result[0]?.document.id ?? null, sourceCount: result.length };
        assertions = [
          assertion("topDocumentId", "eq", expected.topDocumentId, recordValue(actual).topDocumentId, recordValue(actual).topDocumentId === expected.topDocumentId),
          assertion("minimumSourceCount", "gte", expected.minimumSourceCount, recordValue(actual).sourceCount, finiteNumber(recordValue(actual).sourceCount) >= finiteNumber(expected.minimumSourceCount)),
        ];
        break;
      }
      case "financial-law-intent": {
        const topic = detectFinancialLegalIntent(stringValue(input.query));
        actual = { topic };
        assertions = [assertion("topic", "eq", expected.topic, topic, topic === expected.topic)];
        break;
      }
      case "security-triage": {
        const domain = input.domain === "insurance_document" || input.domain === "ai_agent" ? input.domain : "transaction";
        const result = evaluateSecurityTriage(domain, stringList(input.signalIds));
        actual = { score: result.score, priority: result.priority, selectedCount: result.selectedCount };
        assertions = exactFields(recordValue(actual), expected);
        break;
      }
      case "phishing-rule-core": {
        const locale = input.locale === "en" || input.locale === "ja" || input.locale === "zh" ? input.locale : "ko";
        const result = evaluatePhishingRuleText(stringValue(input.text), locale);
        const signals = result.signals.map((item) => item.id);
        actual = { riskLevel: result.riskLevel, score: result.score, signals, disclaimerPresent: Boolean(result.disclaimer) };
        assertions = [
          assertion("riskLevel", "eq", expected.riskLevel, result.riskLevel, result.riskLevel === expected.riskLevel),
          ...(typeof expected.minimumScore === "number" ? [assertion("minimumScore", "gte", expected.minimumScore, result.score, result.score >= expected.minimumScore)] : []),
          ...(typeof expected.maximumScoreExclusive === "number" ? [assertion("maximumScoreExclusive", "lt", expected.maximumScoreExclusive, result.score, result.score < expected.maximumScoreExclusive)] : []),
          ...(Array.isArray(expected.requiredSignals) ? [assertion("requiredSignals", "contains-all", expected.requiredSignals, signals, stringList(expected.requiredSignals).every((signal) => signals.includes(signal)))] : []),
          assertion("disclaimerPresent", "eq", expected.disclaimerPresent, Boolean(result.disclaimer), Boolean(result.disclaimer) === expected.disclaimerPresent),
        ];
        break;
      }
      case "required-consent": {
        try {
          const result = parseRequiredConsentAcceptance(input);
          actual = { accepted: true, ...result };
        } catch (error) {
          actual = {
            accepted: false,
            errorCode: error instanceof AccountLifecycleError ? error.code : error instanceof Error ? error.message : "unknown",
          };
        }
        assertions = exactFields(recordValue(actual), expected);
        break;
      }
      case "context-preference": {
        try {
          actual = { accepted: true, ...parseAiContextPreferenceUpdate(input) };
        } catch (error) {
          actual = { accepted: false, errorCode: error instanceof Error ? error.message : "unknown" };
        }
        const comparable = Object.fromEntries(Object.keys(expected).map((key) => [key, recordValue(actual)[key]]));
        assertions = exactFields(comparable, expected);
        break;
      }
      case "context-sanitizer": {
        const result = sanitizeConversationContext({ question: stringValue(input.question), answer: stringValue(input.answer) });
        const text = result ? `${result.userExcerpt} ${result.assistantExcerpt}` : "";
        actual = { resultPresent: Boolean(result), text };
        assertions = [
          assertion("resultPresent", "eq", expected.resultPresent, Boolean(result), Boolean(result) === expected.resultPresent),
          ...stringList(expected.requiredMarkers).map((marker) => assertion(`marker:${marker}`, "contains", marker, text.includes(marker), text.includes(marker))),
          ...stringList(expected.forbiddenFragments).map((fragment) => assertion(`absent:${fragment}`, "absent", fragment, text.includes(fragment), !text.includes(fragment))),
        ];
        break;
      }
      case "stored-api-snapshot": {
        const set = apiSnapshots as unknown as {
          snapshotSetId: string;
          liveCapture: boolean;
          externalCallsDuringEvaluation: boolean;
          snapshots: Array<{ id: string; assertions: unknown[]; recordedResponse: JsonRecord; sourceRefs: string[] }>;
        };
        const snapshot = set.snapshots.find((item) => item.id === input.snapshotId);
        if (!snapshot) throw new Error("stored_api_snapshot_missing");
        const response = recordValue(snapshot.recordedResponse);
        const body = recordValue(response.body);
        const sources = Array.isArray(body.sources) ? body.sources.map(recordValue) : [];
        const categories = Array.isArray(body.categories) ? body.categories.map(recordValue) : [];
        const itemCount = categories.reduce((sum, category) => sum + (Array.isArray(category.items) ? category.items.length : 0), 0);
        const baseAssertions = input.snapshotId === "health-contract"
          ? [
              assertion("httpStatus", "eq", 200, response.httpStatus, response.httpStatus === 200),
              assertion("body.status", "eq", "ok", body.status, body.status === "ok"),
            ]
          : [
              assertion("httpStatus", "eq", 200, response.httpStatus, response.httpStatus === 200),
              assertion("body.status", "one-of", ["live", "partial"], body.status, body.status === "live" || body.status === "partial"),
              assertion("sources", "min-length", 1, sources.length, sources.length >= 1),
              assertion("sourceUrl", "https-only", true, sources.map((item) => item.sourceUrl), sources.every((item) => typeof item.sourceUrl === "string" && item.sourceUrl.startsWith("https://"))),
              assertion("sourceDate", "present", true, sources.map((item) => item.sourceDate), sources.every((item) => typeof item.sourceDate === "string" && item.sourceDate.length > 0)),
              assertion("items", "min-total-length", 1, itemCount, itemCount >= 1),
            ];
        actual = {
          snapshotId: snapshot.id,
          assertionCount: snapshot.assertions.length,
          liveCapture: set.liveCapture,
          externalCallsDuringEvaluation: set.externalCallsDuringEvaluation,
        };
        assertions = [
          ...baseAssertions,
          assertion("minimumAssertions", "gte", expected.minimumAssertions, snapshot.assertions.length, snapshot.assertions.length >= finiteNumber(expected.minimumAssertions)),
          assertion("offline", "eq", true, !set.liveCapture && !set.externalCallsDuringEvaluation, !set.liveCapture && !set.externalCallsDuringEvaluation),
        ];
        break;
      }
      case "challenge-build-contract": {
        actual = { route: CHALLENGE_ROUTE_PATH, marker: CHALLENGE_PAGE_MARKER };
        assertions = [
          assertion("route", "eq", input.route, CHALLENGE_ROUTE_PATH, CHALLENGE_ROUTE_PATH === input.route),
          assertion("marker", "eq", input.marker, CHALLENGE_PAGE_MARKER, CHALLENGE_PAGE_MARKER === input.marker),
        ];
        break;
      }
      case "submission-evidence-manifest": {
        const manifest = evidenceManifest as unknown as {
          manifestId: string;
          qualityClaim: string;
          officialHackathonScore: boolean;
          requirements: Array<{ id: string; claimType: string; measurementState: string; evidenceRefs: string[] }>;
          automaticChecks: { requiredRequirementIds: string[]; minimumEvidenceRefsPerRequirement: number; allowedMeasurementStates: string[]; forbiddenClaimTypes: string[] };
        };
        const required = manifest.automaticChecks.requiredRequirementIds;
        const byId = new Map(manifest.requirements.map((item) => [item.id, item]));
        const allRequired = required.every((id) => byId.has(id));
        const evidenceRefCounts = required.map((id) => byId.get(id)?.evidenceRefs.length ?? 0);
        const minEvidenceRefs = evidenceRefCounts.length > 0 ? Math.min(...evidenceRefCounts) : 0;
        const expectedMinimumEvidenceRefs = finiteNumber(
          expected.minimumEvidenceRefsPerRequirement,
          manifest.automaticChecks.minimumEvidenceRefsPerRequirement,
        );
        const evidenceComplete = minEvidenceRefs >= expectedMinimumEvidenceRefs;
        const statesAllowed = manifest.requirements.every((item) => manifest.automaticChecks.allowedMeasurementStates.includes(item.measurementState));
        const forbiddenClaimsAbsent = manifest.requirements.every((item) => !manifest.automaticChecks.forbiddenClaimTypes.includes(item.claimType));
        actual = { manifestId: manifest.manifestId, requirementCount: manifest.requirements.length, allRequired, minEvidenceRefs, evidenceComplete, statesAllowed, forbiddenClaimsAbsent, qualityClaim: manifest.qualityClaim };
        assertions = [
          assertion("manifestId", "eq", input.manifestId, manifest.manifestId, manifest.manifestId === input.manifestId),
          assertion("requiredRequirementCount", "eq", expected.requiredRequirementCount, manifest.requirements.length, manifest.requirements.length === expected.requiredRequirementCount),
          assertion("allRequired", "eq", true, allRequired, allRequired),
          assertion("minimumEvidenceRefsPerRequirement", "gte", expectedMinimumEvidenceRefs, minEvidenceRefs, evidenceComplete),
          assertion("measurementStates", "allowlist", true, statesAllowed, statesAllowed),
          assertion("forbiddenClaimsAbsent", "eq", true, forbiddenClaimsAbsent, forbiddenClaimsAbsent),
          assertion("officialHackathonScore", "eq", false, manifest.officialHackathonScore, manifest.officialHackathonScore === false),
        ];
        break;
      }
      case "dataset-provenance": {
        actual = {
          datasetId: DATASET.datasetId,
          provider: DATASET.authorship.provider,
          model: DATASET.authorship.model,
          runtimeJudgeUse: DATASET.authorship.runtimeJudgeUse,
          independentExpertReview: DATASET.authorship.independentExpertReview,
          syntheticOnly: DATASET.privacy.syntheticOnly,
          disclosurePresent: DATASET.authorship.disclosure.length > 40,
        };
        assertions = [
          ...exactFields(recordValue(actual), { datasetId: input.datasetId, ...expected }),
          assertion("disclosurePresent", "eq", true, recordValue(actual).disclosurePresent, recordValue(actual).disclosurePresent === true),
        ];
        break;
      }
      default:
        throw new Error(`judge_adapter_missing:${fixture.adapter}`);
    }
    return caseResult(fixture, actual, assertions, 0);
  } catch (error) {
    const code = error instanceof Error ? error.message : "offline_case_error";
    return caseResult(
      fixture,
      { error: "평가 실행 중 오류" },
      [assertion("execution", "no-error", true, false, false)],
      0,
      code.slice(0, 120),
    );
  }
}

export function runOfflineJudgeCases(): JudgeAutomaticCaseResult[] {
  return FIXTURE_CASES.map(runCase);
}

// Compatibility alias retained for existing internal test imports.
export const runDeterministicJudgeCases = runOfflineJudgeCases;

export function canonicalJudgeRunDigest(cases: readonly JudgeAutomaticCaseResult[]) {
  return fnv1a32(cases.map((item) => ({
    id: item.id,
    status: item.status,
    earnedScore: item.earnedScore,
    inputDigest: item.inputDigest,
    outputDigest: item.outputDigest,
    assertions: item.assertions.map((entry) => ({ id: entry.id, passed: entry.passed })),
  })));
}

export function emptyJudgeCaseResult(id: string, status: "blocked" | "not-run", actual: string): JudgeAutomaticCaseResult {
  const fixture = judgeFixtureCase(id);
  const result = caseResult(fixture, { message: actual }, [assertion("execution", status, true, false, false)], 0);
  return { ...result, status, earnedScore: 0, actual };
}

export function deriveAutomaticGates(
  definitions: readonly JudgeGateDefinition[],
  cases: readonly JudgeAutomaticCaseResult[],
  coverageRun: JudgeCoverageCompactResult | null | undefined,
): Record<string, JudgeSafetyGateReview> {
  const byId = new Map(cases.map((item) => [item.id, item]));
  const coverageSuiteByGate: Readonly<Record<string, JudgeCoverageSuite>> = {
    "financial-boundaries": "financial-correctness",
    "evidence-grounding": "evidence-grounding",
    "financial-scam-safety": "financial-safety",
    "privacy-consent-boundary": "privacy-consent",
    "stored-api-contracts": "stored-api-contract",
    reproducibility: "reproducibility",
  };
  const coverageReady = judgeCoverageReadinessPassed(coverageRun);
  return Object.fromEntries(definitions.map((gate) => {
    const required = gate.requiredCaseIds.map((id) => byId.get(id));
    const deepCasesPassed = required.length > 0 && required.every((item) => item?.status === "pass");
    const failedIds = gate.requiredCaseIds.filter((id) => byId.get(id)?.status !== "pass");
    const suite = coverageSuiteByGate[gate.id];
    const coverageSuite = coverageRun?.suiteSummaries.find((item) => item.suite === suite);
    const coverageSuitePassed = Boolean(suite
      && coverageSuite
      && coverageSuite.total === JUDGE_COVERAGE_CASES_PER_SUITE
      && coverageSuite.passed === JUDGE_COVERAGE_CASES_PER_SUITE
      && coverageSuite.failed === 0
      && coverageSuite.errors === 0
      && coverageSuite.gate === "pass");
    const passed = deepCasesPassed && coverageReady && coverageSuitePassed;
    return [gate.id, {
      status: passed ? "pass" : "fail",
      note: passed
        ? `필수 심층 케이스 ${required.length}개와 커버리지 ${coverageSuite?.passed ?? 0}/100 자동 통과`
        : `미통과: 심층 ${failedIds.join(", ") || "없음"}; 커버리지 ${suite ?? "매핑 없음"} ${coverageSuite?.passed ?? 0}/100`,
    } satisfies JudgeSafetyGateReview];
  }));
}

export const READABLE_JUDGE_COVERAGE_PINS: readonly JudgeCoveragePins[] = [
  {
    corpusId: JUDGE_COVERAGE_CORPUS_ID,
    manifestSha256: JUDGE_COVERAGE_MANIFEST_SHA256,
    definitionSha256: JUDGE_COVERAGE_DEFINITION_SHA256,
    caseOrderSha256: JUDGE_COVERAGE_CASE_ORDER_SHA256,
  },
  ...HISTORICAL_JUDGE_COVERAGE_PINS.filter((pins) => pins.corpusId !== JUDGE_COVERAGE_CORPUS_ID),
];

export function validJudgeCoverageRun(
  coverageRun: JudgeCoverageCompactResult | null | undefined,
): coverageRun is JudgeCoverageCompactResult {
  return validJudgeCoverageRunForPins(coverageRun, READABLE_JUDGE_COVERAGE_PINS[0]);
}

export function validStoredJudgeCoverageRun(
  coverageRun: JudgeCoverageCompactResult | null | undefined,
): coverageRun is JudgeCoverageCompactResult {
  return READABLE_JUDGE_COVERAGE_PINS.some((pins) => validJudgeCoverageRunForPins(coverageRun, pins));
}

function validJudgeCoverageRunForPins(
  coverageRun: JudgeCoverageCompactResult | null | undefined,
  pins: JudgeCoveragePins,
): coverageRun is JudgeCoverageCompactResult {
  if (!coverageRun
    || !Array.isArray(coverageRun.suiteSummaries)
    || !Array.isArray(coverageRun.failureDetails)
    || !coverageRun.execution
    || !coverageRun.relationshipToDeepScore
    || coverageRun.suiteSummaries.some((item) => !item || typeof item !== "object")
    || coverageRun.failureDetails.some((item) => !item || typeof item !== "object")) return false;
  const suites = coverageRun.suiteSummaries;
  const suiteById = new Map(suites.map((item) => [item.suite, item]));
  const nonNegativeInteger = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
  const failedOrErrored = coverageRun.failedCases + coverageRun.errorCases;
  const suiteCountsValid = JUDGE_COVERAGE_SUITE_ORDER.every((suite, index) => {
    const summary = suites[index];
    return summary?.suite === suite
      && summary.total === JUDGE_COVERAGE_CASES_PER_SUITE
      && nonNegativeInteger(summary.passed)
      && nonNegativeInteger(summary.failed)
      && nonNegativeInteger(summary.errors)
      && summary.passed + summary.failed + summary.errors === summary.total
      && nonNegativeInteger(summary.criticalTotal)
      && nonNegativeInteger(summary.criticalPassed)
      && summary.criticalPassed <= summary.criticalTotal
      && summary.criticalTotal <= summary.total
      && summary.gate === (summary.criticalTotal > 0 && summary.criticalPassed === summary.criticalTotal ? "pass" : "fail");
  });
  const expectedAllPassed = coverageRun.passedCases === JUDGE_COVERAGE_TOTAL_CASES
    && coverageRun.failedCases === 0
    && coverageRun.errorCases === 0
    && suites.every((suite) => suite.gate === "pass");
  return coverageRun.schemaVersion === "bora-judge-coverage-compact/v1"
    && coverageRun.corpusId === pins.corpusId
    && coverageRun.manifestSha256 === pins.manifestSha256
    && coverageRun.definitionSha256 === pins.definitionSha256
    && coverageRun.caseOrderSha256 === pins.caseOrderSha256
    && coverageRun.execution.mode === "offline-replay"
    && coverageRun.execution.networkCalls === 0
    && coverageRun.execution.modelCalls === 0
    && coverageRun.execution.wallClockInputs === 0
    && coverageRun.execution.randomInputs === 0
    && coverageRun.relationshipToDeepScore.deepDatasetId === JUDGE_DATASET_ID
    && coverageRun.relationshipToDeepScore.deepCasesPreserved === FIXTURE_CASES.length
    && coverageRun.relationshipToDeepScore.deepAutomaticMaxScorePreserved === JUDGE_AUTOMATIC_MAX_SCORE
    && coverageRun.relationshipToDeepScore.coverageScoreContribution === 0
    && coverageRun.totalCases === JUDGE_COVERAGE_TOTAL_CASES
    && nonNegativeInteger(coverageRun.passedCases)
    && nonNegativeInteger(coverageRun.failedCases)
    && nonNegativeInteger(coverageRun.errorCases)
    && coverageRun.passedCases + failedOrErrored === coverageRun.totalCases
    && coverageRun.allPassed === expectedAllPassed
    && suites.length === JUDGE_COVERAGE_SUITE_ORDER.length
    && suiteById.size === JUDGE_COVERAGE_SUITE_ORDER.length
    && suiteCountsValid
    && suites.reduce((sum, suite) => sum + suite.passed, 0) === coverageRun.passedCases
    && suites.reduce((sum, suite) => sum + suite.failed, 0) === coverageRun.failedCases
    && suites.reduce((sum, suite) => sum + suite.errors, 0) === coverageRun.errorCases
    && coverageRun.statusEncoding === "two-bit-status-in-manifest-order"
    && typeof coverageRun.statusBits === "string"
    && /^[A-Za-z0-9+/]{200}$/u.test(coverageRun.statusBits)
    && /^[0-9a-f]{64}$/u.test(coverageRun.resultSha256)
    && coverageRun.failureDetailLimit === JUDGE_COVERAGE_FAILURE_DETAIL_LIMIT
    && coverageRun.failureDetails.length === Math.min(failedOrErrored, JUDGE_COVERAGE_FAILURE_DETAIL_LIMIT)
    && coverageRun.failureDetails.every((item) => item.status === "fail" || item.status === "error")
    && coverageRun.omittedFailureDetailCount === Math.max(0, failedOrErrored - JUDGE_COVERAGE_FAILURE_DETAIL_LIMIT)
    && coverageRun.provenance?.runtimeModelUse === false
    && coverageRun.compactJsonCharacters === JSON.stringify(coverageRun).length
    && coverageRun.sessionBudgetCharacters === JUDGE_COVERAGE_SESSION_BUDGET_CHARACTERS
    && coverageRun.compactJsonCharacters <= coverageRun.sessionBudgetCharacters;
}

export function judgeCoverageReadinessPassed(
  coverageRun: JudgeCoverageCompactResult | null | undefined,
) {
  return validJudgeCoverageRun(coverageRun)
    && coverageRun.passedCases === JUDGE_COVERAGE_TOTAL_CASES
    && coverageRun.failedCases === 0
    && coverageRun.errorCases === 0
    && coverageRun.allPassed
    && coverageRun.suiteSummaries.every((suite) => (
      suite.total === JUDGE_COVERAGE_CASES_PER_SUITE
      && suite.passed === JUDGE_COVERAGE_CASES_PER_SUITE
      && suite.failed === 0
      && suite.errors === 0
      && suite.gate === "pass"
    ));
}

function validAutomaticRunCases(
  definitions: readonly JudgeCaseDefinition[],
  cases: readonly JudgeAutomaticCaseResult[],
) {
  if (cases.length !== definitions.length) return false;
  const byId = new Map(cases.map((item) => [item.id, item]));
  if (byId.size !== cases.length) return false;
  return definitions.every((definition) => {
    const result = byId.get(definition.id);
    if (!result
      || result.suite !== definition.suite
      || result.label !== definition.label
      || result.adapter !== definition.adapter
      || result.execution !== definition.execution
      || result.riskClass !== definition.riskClass
      || result.weight !== definition.weight
      || result.expected !== definition.expected
      || result.digestAlgorithm !== "fnv1a-32"
      || result.durationMs !== 0
      || !/^[0-9a-f]{8}$/u.test(result.inputDigest)
      || !/^[0-9a-f]{8}$/u.test(result.outputDigest)
      || stableStringify(result.evidence) !== stableStringify(definition.sourceRefs)
      || result.assertions.length === 0
      || new Set(result.assertions.map((item) => item.id)).size !== result.assertions.length) return false;
    const assertionsPassed = result.assertions.every((item) => item.passed);
    const expectedStatus: JudgeCaseStatus = result.errorCode
      ? "error"
      : assertionsPassed
        ? "pass"
        : "fail";
    return result.status === expectedStatus
      && result.earnedScore === (expectedStatus === "pass" ? definition.weight : 0);
  });
}

export function judgeSessionSummary(session: Pick<JudgeSession, "definitions" | "gateReviews" | "automaticRun" | "coverageRun">): JudgeSessionSummary {
  const automaticCases = session.automaticRun?.cases ?? [];
  const automaticScore = automaticCases.reduce((sum, item) => sum + item.earnedScore, 0);
  const automaticMaxScore = session.definitions.automaticCases.reduce((sum, definition) => sum + definition.weight, 0);
  const counts: Record<JudgeCaseStatus, number> = { pass: 0, fail: 0, error: 0, blocked: 0, "not-run": 0, skipped: 0 };
  for (const result of automaticCases) counts[result.status] += 1;
  const gateValues = session.definitions.safetyGates.map((gate) => session.gateReviews[gate.id]?.status ?? "not-reviewed");
  const expectedIds = new Set(session.definitions.automaticCases.map((item) => item.id));
  const resultIds = new Set(automaticCases.map((item) => item.id));
  const allCasesPresent = automaticCases.length === session.definitions.automaticCases.length
    && resultIds.size === automaticCases.length
    && resultIds.size === expectedIds.size
    && [...expectedIds].every((id) => resultIds.has(id));
  const allGatesPassed = gateValues.length > 0 && gateValues.every((status) => status === "pass");
  const anyGateFailed = gateValues.includes("fail");
  const coverageReady = judgeCoverageReadinessPassed(session.coverageRun);
  const readinessGate: JudgeReadinessGate = !session.automaticRun
    ? "review"
    : anyGateFailed || !allCasesPresent || automaticScore < automaticMaxScore || !coverageReady
      ? "fail"
      : allGatesPassed
        ? "pass"
        : "review";
  return {
    automaticScore,
    automaticMaxScore,
    humanScore: 0,
    humanMaxScore: 0,
    totalScore: automaticScore,
    totalMaxScore: automaticMaxScore,
    readinessGate,
    counts,
    manualReviewed: 0,
    manualTotal: 0,
    gatesReviewed: gateValues.filter((status) => status !== "not-reviewed").length,
    gatesTotal: gateValues.length,
  };
}

export function createJudgeSession(input: {
  id: string;
  title: string;
  reviewer: { displayName: string; provider: string };
  now?: Date;
}): JudgeSession {
  const now = (input.now ?? new Date()).toISOString();
  const gateReviews = Object.fromEntries(JUDGE_SAFETY_GATES.map((item) => [
    item.id,
    { status: "not-reviewed", note: "자동평가 실행 전" } satisfies JudgeSafetyGateReview,
  ]));
  const draft: JudgeSession = {
    schemaVersion: JUDGE_SESSION_SCHEMA_VERSION,
    id: input.id,
    title: sanitizeJudgeText(input.title, 80) || "자동평가 세션",
    status: "draft",
    runnerVersion: JUDGE_RUNNER_VERSION,
    rubricVersion: JUDGE_RUBRIC_VERSION,
    datasetId: JUDGE_DATASET_ID,
    datasetHash: JUDGE_DATASET_HASH,
    artifactHashes: { ...JUDGE_ARTIFACT_HASHES },
    datasetPrivacy: { syntheticOnly: DATASET.privacy.syntheticOnly, containsPersonalData: DATASET.privacy.containsPersonalData },
    definitions: currentJudgeDefinitions(),
    reviewer: {
      displayName: sanitizeJudgeText(input.reviewer.displayName, 80) || "승인된 개발자",
      provider: sanitizeJudgeText(input.reviewer.provider, 40),
    },
    manualReviews: {},
    gateReviews,
    reviewerNotes: "",
    automaticRun: null,
    coverageRun: null,
    diagnosticRun: null,
    summary: {} as JudgeSessionSummary,
    createdAt: now,
    updatedAt: now,
    sealedAt: null,
  };
  draft.summary = judgeSessionSummary(draft);
  return draft;
}

export type JudgeReviewUpdate = {
  title?: unknown;
  reviewerNotes?: unknown;
  manualReviews?: unknown;
  gateReviews?: unknown;
};

export function applyJudgeReviewUpdate(
  session: JudgeSession,
  input: JudgeReviewUpdate,
  nextStatus: JudgeSessionStatus,
  now = new Date(),
): JudgeSession {
  if (session.status === "sealed") throw new Error("judge_session_sealed");
  if (session.coverageRun && !validJudgeCoverageRun(session.coverageRun)) throw new Error("judge_session_version_mismatch");
  const updated: JudgeSession = {
    ...session,
    title: sanitizeJudgeText(input.title, 80) || session.title,
    reviewerNotes: sanitizeJudgeText(input.reviewerNotes, 3_000),
    status: nextStatus,
    updatedAt: now.toISOString(),
    sealedAt: nextStatus === "sealed" ? now.toISOString() : null,
  };
  if (nextStatus === "sealed" && !updated.automaticRun) throw new Error("judge_automatic_run_required");
  if (nextStatus === "sealed" && !validJudgeCoverageRun(updated.coverageRun)) {
    throw new Error("judge_coverage_run_required");
  }
  updated.summary = judgeSessionSummary(updated);
  return updated;
}

export async function attachAutomaticRun(
  session: JudgeSession,
  run: JudgeAutomaticRun,
  coverageRun: JudgeCoverageCompactResult | null | undefined,
  now = new Date(),
): Promise<JudgeSession> {
  if (session.status === "sealed") throw new Error("judge_session_sealed");
  if (session.automaticRun || session.coverageRun) throw new Error("judge_core_run_already_exists");
  const canonicalCases = runOfflineJudgeCases();
  const canonicalCoverage = await compactJudgeCoverageCorpusResult(runJudgeCoverageCorpusCases());
  let coverageContractValid = false;
  try {
    coverageContractValid = Boolean(coverageRun
      && judgeCoverageSessionPatch(coverageRun)
      && validJudgeCoverageRun(coverageRun));
  } catch {
    coverageContractValid = false;
  }
  if (session.schemaVersion !== JUDGE_SESSION_SCHEMA_VERSION
    || session.runnerVersion !== JUDGE_RUNNER_VERSION
    || session.datasetId !== JUDGE_DATASET_ID
    || session.datasetHash !== JUDGE_DATASET_HASH
    || !sameArtifactHashes(session.artifactHashes, JUDGE_ARTIFACT_HASHES)
    || session.rubricVersion !== JUDGE_RUBRIC_VERSION
    || run.runnerVersion !== session.runnerVersion
    || run.datasetId !== session.datasetId
    || run.datasetHash !== session.datasetHash
    || !sameArtifactHashes(run.snapshot.artifactHashes, JUDGE_ARTIFACT_HASHES)
    || stableStringify(run.snapshot) !== stableStringify(judgeCoreSnapshot())
    || !validAutomaticRunCases(session.definitions.automaticCases, run.cases)
    || stableStringify(run.cases) !== stableStringify(canonicalCases)
    || run.resultDigest !== canonicalJudgeRunDigest(run.cases)
    || !coverageContractValid
    || stableStringify(coverageRun) !== stableStringify(canonicalCoverage)) {
    throw new Error("judge_session_version_mismatch");
  }
  const updated: JudgeSession = {
    ...session,
    status: "review",
    automaticRun: run,
    ...judgeCoverageSessionPatch(canonicalCoverage),
    gateReviews: deriveAutomaticGates(session.definitions.safetyGates, run.cases, canonicalCoverage),
    updatedAt: now.toISOString(),
    sealedAt: null,
  };
  updated.summary = judgeSessionSummary(updated);
  return updated;
}

export function attachDiagnosticRun(
  session: JudgeSession,
  run: JudgeDiagnosticRun,
  now = new Date(),
): JudgeSession {
  if (session.status === "sealed") throw new Error("judge_session_sealed");
  if (session.coverageRun && !validJudgeCoverageRun(session.coverageRun)) throw new Error("judge_session_version_mismatch");
  if (session.diagnosticRun) throw new Error("judge_diagnostic_run_already_exists");
  if (run.version !== JUDGE_DIAGNOSTIC_VERSION) throw new Error("judge_diagnostic_version_mismatch");
  const updated: JudgeSession = { ...session, diagnosticRun: run, updatedAt: now.toISOString() };
  updated.summary = judgeSessionSummary(updated);
  return updated;
}

export function judgeCoreSnapshot(): JudgeCoreSnapshot {
  return {
    mode: "offline-dataset-replay",
    networkCalls: 0,
    modelCalls: 0,
    apiSnapshotSetId: (apiSnapshots as { snapshotSetId: string }).snapshotSetId,
    evidenceManifestId: (evidenceManifest as { manifestId: string }).manifestId,
    artifactHashes: { ...JUDGE_ARTIFACT_HASHES },
    authorship: { ...DATASET.authorship },
    limitations: [...DATASET.limitations],
  };
}

export function diagnosticCounts(checks: readonly JudgeDiagnosticCheckResult[]): Record<JudgeDiagnosticStatus, number> {
  const counts: Record<JudgeDiagnosticStatus, number> = { pass: 0, warn: 0, fail: 0, error: 0, "not-run": 0 };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

export function judgeDatasetMetadata() {
  const coverage = judgeCoverageCorpusSummaryMetadata();
  return {
    id: JUDGE_DATASET_ID,
    hash: JUDGE_DATASET_HASH,
    runnerVersion: JUDGE_RUNNER_VERSION,
    caseCount: JUDGE_CASE_CATALOG.length,
    automaticMaxScore: JUDGE_AUTOMATIC_MAX_SCORE,
    syntheticOnly: DATASET.privacy.syntheticOnly,
    containsPersonalData: DATASET.privacy.containsPersonalData,
    containsLiveMaliciousUrls: DATASET.privacy.containsLiveMaliciousUrls,
    networkCallsDuringCoreEvaluation: DATASET.privacy.networkCallsDuringCoreEvaluation,
    authorship: DATASET.authorship,
    methodology: DATASET.methodology,
    limitations: DATASET.limitations,
    gates: JUDGE_SAFETY_GATES,
    apiSnapshotSet: {
      id: (apiSnapshots as { snapshotSetId: string }).snapshotSetId,
      liveCapture: (apiSnapshots as { liveCapture: boolean }).liveCapture,
      externalCallsDuringEvaluation: (apiSnapshots as { externalCallsDuringEvaluation: boolean }).externalCallsDuringEvaluation,
      count: (apiSnapshots as { snapshots: unknown[] }).snapshots.length,
    },
    evidenceManifestId: (evidenceManifest as { manifestId: string }).manifestId,
    artifactHashes: { ...JUDGE_ARTIFACT_HASHES },
    coverageCorpus: {
      corpusId: coverage.corpusId,
      manifestSha256: coverage.manifestSha256,
      definitionSha256: coverage.definitionSha256,
      caseOrderSha256: coverage.caseOrderSha256,
      suiteOrder: coverage.suiteOrder,
      casesPerSuite: coverage.casesPerSuite,
      totalCases: coverage.totalCases,
      relationshipToDeepScore: coverage.relationshipToDeepScore,
      provenance: coverage.provenance,
      artifacts: coverage.artifacts,
      runtimeNetworkCalls: 0,
      runtimeModelCalls: 0,
    },
    cases: JUDGE_CASE_CATALOG,
  };
}
