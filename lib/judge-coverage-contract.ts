import type {
  JudgeCoverageCompactResult,
  JudgeCoverageSuiteSummary,
} from "./judge-coverage-corpus";

export const JUDGE_COVERAGE_SESSION_FIELD = "coverageRun" as const;
export const JUDGE_COVERAGE_COMPACT_SCHEMA = "bora-judge-coverage-compact/v1" as const;
export const JUDGE_COVERAGE_COMPACT_MAX_CHARACTERS = 81_920;

/**
 * Optional additive field for the existing v2 deep-score session. The 28-case
 * score remains authoritative; this field contributes zero score points.
 */
export type JudgeCoverageSessionExtension = {
  coverageRun: JudgeCoverageCompactResult | null;
};

export type JudgeCoverageApiPayload = {
  coverage: JudgeCoverageCompactResult;
};

export type JudgeCoverageSummaryView = Pick<JudgeCoverageCompactResult,
  | "corpusId"
  | "manifestSha256"
  | "resultSha256"
  | "totalCases"
  | "passedCases"
  | "failedCases"
  | "errorCases"
  | "allPassed"
  | "suiteSummaries"
  | "provenance"
>;

export function judgeCoverageSessionPatch(result: JudgeCoverageCompactResult): JudgeCoverageSessionExtension {
  const characters = JSON.stringify(result).length;
  if (result.schemaVersion !== JUDGE_COVERAGE_COMPACT_SCHEMA
    || result.relationshipToDeepScore.coverageScoreContribution !== 0
    || result.totalCases !== 600
    || result.suiteSummaries.length !== 6
    || result.suiteSummaries.some((suite: JudgeCoverageSuiteSummary) => suite.total !== 100)
    || result.failureDetails.length > result.failureDetailLimit
    || characters !== result.compactJsonCharacters
    || characters > JUDGE_COVERAGE_COMPACT_MAX_CHARACTERS) {
    throw new Error("judge_coverage_compact_contract_invalid");
  }
  return { coverageRun: result };
}

export function judgeCoverageSummaryView(result: JudgeCoverageCompactResult): JudgeCoverageSummaryView {
  return {
    corpusId: result.corpusId,
    manifestSha256: result.manifestSha256,
    resultSha256: result.resultSha256,
    totalCases: result.totalCases,
    passedCases: result.passedCases,
    failedCases: result.failedCases,
    errorCases: result.errorCases,
    allPassed: result.allPassed,
    suiteSummaries: result.suiteSummaries,
    provenance: result.provenance,
  };
}
