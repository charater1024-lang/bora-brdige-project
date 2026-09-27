import { evaluatePhishingRuleText } from "@/app/api/phishing/route";
import { parseAiContextPreferenceUpdate, sanitizeConversationContext } from "./ai/context-policy";
import { AccountLifecycleError, parseRequiredConsentAcceptance } from "./auth/consent-policy";
import { foreignSettlementBudgetSummary } from "./foreign-settlement";
import {
  evaluateReproducibilityCoverageContract,
  evaluateStoredApiCoverageContract,
} from "./judge-coverage-policies";
import { detectFinancialLegalIntent } from "./legal/financial-law";
import { manualFinanceSummary, normalizeManualFinanceAmounts } from "./manual-finance";
import { canonicalWonFromMoneyInput, formatCanonicalWonInput } from "./money-input";
import { searchKnowledge } from "./rag/knowledge";
import { evaluateSecurityTriage } from "./security-triage";
import evidenceSuite from "../evaluation/datasets/bora-judge-coverage-v17/evidence-grounding.json";
import financialSuite from "../evaluation/datasets/bora-judge-coverage-v17/financial-correctness.json";
import safetySuite from "../evaluation/datasets/bora-judge-coverage-v17/financial-safety.json";
import integrity from "../evaluation/datasets/bora-judge-coverage-v17/integrity.json";
import manifest from "../evaluation/datasets/bora-judge-coverage-v17/manifest.json";
import privacySuite from "../evaluation/datasets/bora-judge-coverage-v17/privacy-consent.json";
import provenance from "../evaluation/datasets/bora-judge-coverage-v17/provenance.json";
import reproducibilitySuite from "../evaluation/datasets/bora-judge-coverage-v17/reproducibility.json";
import apiSuite from "../evaluation/datasets/bora-judge-coverage-v17/stored-api-contract.json";

export const JUDGE_COVERAGE_CORPUS_ID = "bora-judge-coverage-2026-09-23-v17";
export const JUDGE_COVERAGE_MANIFEST_SHA256 = integrity.manifestSha256;
export const JUDGE_COVERAGE_DEFINITION_SHA256 = manifest.definitionSha256;
export const JUDGE_COVERAGE_CASE_ORDER_SHA256 = manifest.caseOrderSha256;
export const JUDGE_COVERAGE_CASES_PER_SUITE = 100;
export const JUDGE_COVERAGE_TOTAL_CASES = 600;
export const JUDGE_COVERAGE_FAILURE_DETAIL_LIMIT = 24;
export const JUDGE_COVERAGE_SESSION_BUDGET_CHARACTERS = 81_920;

export const JUDGE_COVERAGE_SUITE_ORDER = [
  "financial-correctness",
  "evidence-grounding",
  "financial-safety",
  "privacy-consent",
  "stored-api-contract",
  "reproducibility",
] as const;

export type JudgeCoverageSuite = (typeof JUDGE_COVERAGE_SUITE_ORDER)[number];
export type JudgeCoverageRiskClass = "typical" | "boundary" | "high-risk-finance" | "adversarial";
export type JudgeCoverageCaseStatus = "pass" | "fail" | "error";

type JsonRecord = Record<string, unknown>;

type CoverageCase = {
  id: string;
  suite: JudgeCoverageSuite;
  label: string;
  operation: string;
  riskClass: JudgeCoverageRiskClass;
  critical: boolean;
  oracleStrategy: string;
  input: unknown;
  expected: unknown;
  grader: string;
  sourceRefs: string[];
};

type CoverageSuiteArtifact = {
  schemaVersion: string;
  corpusId: string;
  suite: JudgeCoverageSuite;
  caseCount: number;
  execution: "offline-replay";
  syntheticOnly: boolean;
  cases: CoverageCase[];
};

export type JudgeCoverageAssertion = {
  id: string;
  operator: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
};

export type JudgeCoverageCaseResult = {
  id: string;
  suite: JudgeCoverageSuite;
  label: string;
  operation: string;
  riskClass: JudgeCoverageRiskClass;
  critical: boolean;
  status: JudgeCoverageCaseStatus;
  inputDigest: string;
  outputDigest: string;
  digestAlgorithm: "fnv1a-32";
  assertions: JudgeCoverageAssertion[];
  actual: unknown;
  expected: unknown;
  evidence: string[];
  errorCode: string | null;
};

export type JudgeCoverageSuiteSummary = {
  suite: JudgeCoverageSuite;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  criticalTotal: number;
  criticalPassed: number;
  gate: "pass" | "fail";
};

export type JudgeCoverageFailureDetail = {
  id: string;
  suite: JudgeCoverageSuite;
  status: "fail" | "error";
  failedAssertionIds: string[];
  expected: string;
  actual: string;
  errorCode: string | null;
};

export type JudgeCoverageCompactResult = {
  schemaVersion: "bora-judge-coverage-compact/v1";
  // Stored results may belong to a pinned historical release. Validators keep
  // historical reads separate from current-release execution and mutation.
  corpusId: string;
  manifestSha256: string;
  definitionSha256: string;
  caseOrderSha256: string;
  execution: {
    mode: "offline-replay";
    networkCalls: 0;
    modelCalls: 0;
    wallClockInputs: 0;
    randomInputs: 0;
  };
  relationshipToDeepScore: {
    deepDatasetId: string;
    deepCasesPreserved: number;
    deepAutomaticMaxScorePreserved: number;
    coverageScoreContribution: 0;
  };
  totalCases: number;
  passedCases: number;
  failedCases: number;
  errorCases: number;
  allPassed: boolean;
  suiteSummaries: JudgeCoverageSuiteSummary[];
  statusEncoding: "two-bit-status-in-manifest-order";
  statusBits: string;
  resultSha256: string;
  failureDetails: JudgeCoverageFailureDetail[];
  omittedFailureDetailCount: number;
  failureDetailLimit: number;
  provenance: {
    model: string;
    officialModelReference: string;
    codexSessionAuthorshipUsedModel: true;
    runtimeModelUse: false;
    independentExpertReview: string;
    qualityClaim: string;
  };
  compactJsonCharacters: number;
  sessionBudgetCharacters: number;
};

const SUITE_ARTIFACTS = [
  financialSuite,
  evidenceSuite,
  safetySuite,
  privacySuite,
  apiSuite,
  reproducibilitySuite,
] as unknown as CoverageSuiteArtifact[];

const CASES = SUITE_ARTIFACTS.flatMap((artifact) => artifact.cases);

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const item = value as JsonRecord;
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(item[key])}`).join(",")}}`;
}

function serializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function fnv1a32(value: unknown) {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function compactJson(value: unknown, maximum = 500) {
  const text = stableStringify(value);
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`;
}

function rounded(value: number | null, digits = 6) {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function exactAssertion(expected: unknown, actual: unknown): JudgeCoverageAssertion {
  return {
    id: "exact-result",
    operator: "deep-equal",
    expected,
    actual,
    passed: stableStringify(expected) === stableStringify(actual),
  };
}

function executeCase(item: CoverageCase): JudgeCoverageCaseResult {
  let actual: unknown;
  let assertions: JudgeCoverageAssertion[];
  let errorCode: string | null = null;
  try {
    const input = record(item.input);
    switch (item.operation) {
      case "manual-finance-summary": {
        const result = manualFinanceSummary(item.input);
        actual = {
          totalAssets: result.totalAssets,
          netAssets: result.netAssets,
          monthlyOutflow: result.monthlyOutflow,
          monthlyBalance: result.monthlyBalance,
          debtPaymentRatio: rounded(result.debtPaymentRatio),
          completedFields: result.completedFields,
        };
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      case "manual-finance-normalize": {
        actual = normalizeManualFinanceAmounts(item.input);
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      case "foreign-settlement-summary": {
        const result = foreignSettlementBudgetSummary(item.input);
        actual = {
          totalExpenses: result.totalExpenses,
          remaining: result.remaining,
          expenseRatio: rounded(result.expenseRatio),
          completedFields: result.completedFields,
          hasExpenseInput: result.hasExpenseInput,
        };
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      case "money-unit-conversion": {
        const unit = input.unit === "won" ? "won" : "manwon";
        const canonicalWon = canonicalWonFromMoneyInput(stringValue(input.value), unit);
        actual = { canonicalWon, formatted: formatCanonicalWonInput(canonicalWon, unit) };
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      case "knowledge-top-document": {
        const result = searchKnowledge(stringValue(input.query), 4);
        const expected = record(item.expected);
        actual = { topDocumentId: result[0]?.document.id ?? null, sourceCount: result.length };
        assertions = [
          {
            id: "top-document",
            operator: "eq",
            expected: expected.topDocumentId,
            actual: record(actual).topDocumentId,
            passed: record(actual).topDocumentId === expected.topDocumentId,
          },
          {
            id: "minimum-source-count",
            operator: "gte",
            expected: expected.minimumSourceCount,
            actual: result.length,
            passed: result.length >= Number(expected.minimumSourceCount ?? 0),
          },
        ];
        break;
      }
      case "financial-law-intent": {
        actual = { topic: detectFinancialLegalIntent(stringValue(input.query)) };
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      case "security-triage": {
        const domain = input.domain === "insurance_document" || input.domain === "ai_agent" ? input.domain : "transaction";
        const result = evaluateSecurityTriage(domain, stringList(input.signalIds));
        actual = {
          score: result.score,
          priority: result.priority,
          selectedCount: result.selectedCount,
          allowedCount: result.allowedCount,
          selectedSignalIds: result.selectedSignalIds,
        };
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      case "phishing-rule-core": {
        const locale = input.locale === "en" || input.locale === "ja" || input.locale === "zh" ? input.locale : "ko";
        const result = evaluatePhishingRuleText(stringValue(input.text), locale);
        actual = {
          riskLevel: result.riskLevel,
          score: result.score,
          signals: result.signals.map((signal) => signal.id),
          disclaimerPresent: Boolean(result.disclaimer),
        };
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      case "required-consent": {
        try {
          actual = { accepted: true, ...parseRequiredConsentAcceptance(item.input) };
        } catch (error) {
          actual = {
            accepted: false,
            errorCode: error instanceof AccountLifecycleError ? error.code : error instanceof Error ? error.message : "unknown",
          };
        }
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      case "context-preference": {
        try {
          actual = serializable({ accepted: true, ...parseAiContextPreferenceUpdate(item.input) });
        } catch (error) {
          actual = { accepted: false, errorCode: error instanceof Error ? error.message : "unknown" };
        }
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      case "context-sanitizer": {
        const result = sanitizeConversationContext({
          question: stringValue(input.question),
          answer: stringValue(input.answer),
        });
        actual = result ? { resultPresent: true, ...result } : { resultPresent: false };
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      case "stored-api-policy": {
        actual = evaluateStoredApiCoverageContract(item.input);
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      case "reproducibility-policy": {
        actual = evaluateReproducibilityCoverageContract(item.input);
        assertions = [exactAssertion(item.expected, actual)];
        break;
      }
      default:
        throw new Error(`judge_coverage_operation_missing:${item.operation}`);
    }
  } catch (error) {
    errorCode = error instanceof Error ? error.message.slice(0, 160) : "judge_coverage_execution_error";
    actual = { error: "coverage execution failed" };
    assertions = [{ id: "execution", operator: "no-error", expected: true, actual: false, passed: false }];
  }
  actual = serializable(actual);
  const status: JudgeCoverageCaseStatus = errorCode
    ? "error"
    : assertions.every((assertion) => assertion.passed)
      ? "pass"
      : "fail";
  return {
    id: item.id,
    suite: item.suite,
    label: item.label,
    operation: item.operation,
    riskClass: item.riskClass,
    critical: item.critical,
    status,
    inputDigest: fnv1a32(item.input),
    outputDigest: fnv1a32(actual),
    digestAlgorithm: "fnv1a-32",
    assertions,
    actual,
    expected: item.expected,
    evidence: [...item.sourceRefs],
    errorCode,
  };
}

function validateCorpusDefinition() {
  if (manifest.corpusId !== JUDGE_COVERAGE_CORPUS_ID
    || integrity.corpusId !== JUDGE_COVERAGE_CORPUS_ID
    || provenance.corpusId !== JUDGE_COVERAGE_CORPUS_ID
    || manifest.totalCases !== JUDGE_COVERAGE_TOTAL_CASES
    || manifest.casesPerSuite !== JUDGE_COVERAGE_CASES_PER_SUITE
    || manifest.suiteCount !== JUDGE_COVERAGE_SUITE_ORDER.length
    || manifest.resultStorage.maximumSessionCharacters !== JUDGE_COVERAGE_SESSION_BUDGET_CHARACTERS
    || manifest.resultStorage.failureDetailLimit !== JUDGE_COVERAGE_FAILURE_DETAIL_LIMIT
    || CASES.length !== JUDGE_COVERAGE_TOTAL_CASES
    || new Set(CASES.map((item) => item.id)).size !== CASES.length) {
    throw new Error("judge_coverage_definition_invalid");
  }
  for (const suite of JUDGE_COVERAGE_SUITE_ORDER) {
    const artifact = SUITE_ARTIFACTS.find((item) => item.suite === suite);
    if (!artifact
      || artifact.corpusId !== JUDGE_COVERAGE_CORPUS_ID
      || artifact.execution !== "offline-replay"
      || artifact.syntheticOnly !== true
      || artifact.caseCount !== JUDGE_COVERAGE_CASES_PER_SUITE
      || artifact.cases.length !== JUDGE_COVERAGE_CASES_PER_SUITE
      || artifact.cases.some((item) => item.suite !== suite)) {
      throw new Error(`judge_coverage_suite_invalid:${suite}`);
    }
  }
}

validateCorpusDefinition();

export function judgeCoverageCorpusSummaryMetadata() {
  return {
    corpusId: JUDGE_COVERAGE_CORPUS_ID as typeof JUDGE_COVERAGE_CORPUS_ID,
    manifestSha256: integrity.manifestSha256,
    definitionSha256: manifest.definitionSha256,
    caseOrderSha256: manifest.caseOrderSha256,
    suiteOrder: [...JUDGE_COVERAGE_SUITE_ORDER],
    casesPerSuite: JUDGE_COVERAGE_CASES_PER_SUITE,
    totalCases: JUDGE_COVERAGE_TOTAL_CASES,
    artifacts: manifest.artifacts,
    relationshipToDeepScore: manifest.relationshipToDeepScore,
    provenance,
  };
}

export function judgeCoverageCorpusMetadata() {
  return {
    ...judgeCoverageCorpusSummaryMetadata(),
    cases: CASES.map((item) => ({
      id: item.id,
      suite: item.suite,
      label: item.label,
      operation: item.operation,
      riskClass: item.riskClass,
      critical: item.critical,
      oracleStrategy: item.oracleStrategy,
      grader: item.grader,
      sourceRefs: [...item.sourceRefs],
    })),
  };
}

export function runJudgeCoverageCorpusCases(): JudgeCoverageCaseResult[] {
  return CASES.map(executeCase);
}

function base64(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const value = (a << 16) | (b << 8) | c;
    output += alphabet[(value >>> 18) & 63];
    output += alphabet[(value >>> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[value & 63] : "=";
  }
  return output;
}

function encodeStatuses(cases: readonly JudgeCoverageCaseResult[]) {
  const values: Record<JudgeCoverageCaseStatus, number> = { pass: 0, fail: 1, error: 2 };
  const output = new Uint8Array(Math.ceil(cases.length * 2 / 8));
  for (let index = 0; index < cases.length; index += 1) {
    const bitOffset = index * 2;
    output[Math.floor(bitOffset / 8)] |= values[cases[index].status] << (bitOffset % 8);
  }
  return base64(output);
}

export async function compactJudgeCoverageCorpusResult(
  cases: readonly JudgeCoverageCaseResult[],
): Promise<JudgeCoverageCompactResult> {
  if (cases.length !== JUDGE_COVERAGE_TOTAL_CASES
    || cases.some((item, index) => item.id !== CASES[index].id)) {
    throw new Error("judge_coverage_result_order_invalid");
  }
  const suiteSummaries = JUDGE_COVERAGE_SUITE_ORDER.map((suite): JudgeCoverageSuiteSummary => {
    const selected = cases.filter((item) => item.suite === suite);
    const critical = selected.filter((item) => item.critical);
    const passed = selected.filter((item) => item.status === "pass").length;
    const failed = selected.filter((item) => item.status === "fail").length;
    const errors = selected.filter((item) => item.status === "error").length;
    const criticalPassed = critical.filter((item) => item.status === "pass").length;
    return {
      suite,
      total: selected.length,
      passed,
      failed,
      errors,
      criticalTotal: critical.length,
      criticalPassed,
      gate: critical.length > 0 && criticalPassed === critical.length ? "pass" : "fail",
    };
  });
  const failures = cases.filter((item) => item.status !== "pass");
  const canonicalResults = cases.map((item) => ({
    id: item.id,
    status: item.status,
    inputDigest: item.inputDigest,
    outputDigest: item.outputDigest,
    assertions: item.assertions.map((assertion) => ({ id: assertion.id, passed: assertion.passed })),
    errorCode: item.errorCode,
  }));
  const resultSha256 = await sha256Hex(stableStringify(canonicalResults));
  const compactWithoutSize = {
    schemaVersion: "bora-judge-coverage-compact/v1" as const,
    corpusId: JUDGE_COVERAGE_CORPUS_ID as typeof JUDGE_COVERAGE_CORPUS_ID,
    manifestSha256: integrity.manifestSha256,
    definitionSha256: manifest.definitionSha256,
    caseOrderSha256: manifest.caseOrderSha256,
    execution: { mode: "offline-replay" as const, networkCalls: 0 as const, modelCalls: 0 as const, wallClockInputs: 0 as const, randomInputs: 0 as const },
    relationshipToDeepScore: { ...manifest.relationshipToDeepScore, coverageScoreContribution: 0 as const },
    totalCases: cases.length,
    passedCases: cases.length - failures.length,
    failedCases: failures.filter((item) => item.status === "fail").length,
    errorCases: failures.filter((item) => item.status === "error").length,
    allPassed: failures.length === 0 && suiteSummaries.every((item) => item.gate === "pass"),
    suiteSummaries,
    statusEncoding: "two-bit-status-in-manifest-order" as const,
    statusBits: encodeStatuses(cases),
    resultSha256,
    failureDetails: failures.slice(0, JUDGE_COVERAGE_FAILURE_DETAIL_LIMIT).map((item): JudgeCoverageFailureDetail => ({
      id: item.id,
      suite: item.suite,
      status: item.status === "error" ? "error" : "fail",
      failedAssertionIds: item.assertions.filter((assertion) => !assertion.passed).map((assertion) => assertion.id),
      expected: compactJson(item.expected),
      actual: compactJson(item.actual),
      errorCode: item.errorCode,
    })),
    omittedFailureDetailCount: Math.max(0, failures.length - JUDGE_COVERAGE_FAILURE_DETAIL_LIMIT),
    failureDetailLimit: JUDGE_COVERAGE_FAILURE_DETAIL_LIMIT,
    provenance: {
      model: provenance.authorship.model,
      officialModelReference: provenance.authorship.officialModelReference,
      codexSessionAuthorshipUsedModel: true as const,
      runtimeModelUse: false as const,
      independentExpertReview: provenance.authorship.independentExpertReview,
      qualityClaim: provenance.claimBoundary.qualityClaim,
    },
    sessionBudgetCharacters: JUDGE_COVERAGE_SESSION_BUDGET_CHARACTERS,
  };
  const compactJsonCharacters = JSON.stringify({ ...compactWithoutSize, compactJsonCharacters: 0 }).length;
  const compact: JudgeCoverageCompactResult = { ...compactWithoutSize, compactJsonCharacters };
  const exactCharacters = JSON.stringify(compact).length;
  compact.compactJsonCharacters = exactCharacters;
  if (exactCharacters > JUDGE_COVERAGE_SESSION_BUDGET_CHARACTERS) {
    throw new Error("judge_coverage_compact_result_too_large");
  }
  return compact;
}

export async function runJudgeCoverageCorpus() {
  const cases = runJudgeCoverageCorpusCases();
  const compact = await compactJudgeCoverageCorpusResult(cases);
  return { cases, compact };
}
