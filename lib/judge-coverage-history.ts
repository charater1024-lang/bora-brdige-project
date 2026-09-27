import v11Manifest from "../evaluation/datasets/bora-judge-coverage-v11/manifest.json";
import v11Integrity from "../evaluation/datasets/bora-judge-coverage-v11/integrity.json";
import v12Manifest from "../evaluation/datasets/bora-judge-coverage-v12/manifest.json";
import v12Integrity from "../evaluation/datasets/bora-judge-coverage-v12/integrity.json";
import v13Manifest from "../evaluation/datasets/bora-judge-coverage-v13/manifest.json";
import v13Integrity from "../evaluation/datasets/bora-judge-coverage-v13/integrity.json";
import v14Manifest from "../evaluation/datasets/bora-judge-coverage-v14/manifest.json";
import v14Integrity from "../evaluation/datasets/bora-judge-coverage-v14/integrity.json";
import v15Manifest from "../evaluation/datasets/bora-judge-coverage-v15/manifest.json";
import v15Integrity from "../evaluation/datasets/bora-judge-coverage-v15/integrity.json";
import v16Manifest from "../evaluation/datasets/bora-judge-coverage-v16/manifest.json";
import v16Integrity from "../evaluation/datasets/bora-judge-coverage-v16/integrity.json";

export type JudgeCoveragePins = {
  corpusId: string;
  manifestSha256: string;
  definitionSha256: string;
  caseOrderSha256: string;
};

// Read-only release registry. Never rewrite sealed artifacts or relabel a saved
// run to the current corpus. Adding a release permits reading, not re-scoring.
export const HISTORICAL_JUDGE_COVERAGE_PINS: readonly JudgeCoveragePins[] = [
  { ...v11Manifest, manifestSha256: v11Integrity.manifestSha256 },
  { ...v12Manifest, manifestSha256: v12Integrity.manifestSha256 },
  { ...v13Manifest, manifestSha256: v13Integrity.manifestSha256 },
  { ...v14Manifest, manifestSha256: v14Integrity.manifestSha256 },
  { ...v15Manifest, manifestSha256: v15Integrity.manifestSha256 },
  { ...v16Manifest, manifestSha256: v16Integrity.manifestSha256 },
].map(({ corpusId, manifestSha256, definitionSha256, caseOrderSha256 }) => ({
  corpusId, manifestSha256, definitionSha256, caseOrderSha256,
}));
