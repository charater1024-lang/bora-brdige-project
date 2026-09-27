import type {
  JudgeCaseDefinition,
  JudgeGateDefinition,
  JudgeRubricDefinition,
  JudgeSession,
} from "./judge-evaluation";
import { JUDGE_EXPORT_SCHEMA_VERSION, sanitizeJudgeText } from "./judge-shared";

export type JudgeExportDefinitions = {
  rubric: readonly JudgeRubricDefinition[];
  gates: readonly JudgeGateDefinition[];
  cases: readonly JudgeCaseDefinition[];
};

function safeUnknown(value: unknown): unknown {
  if (typeof value === "string") return sanitizeJudgeText(value, 1_000);
  if (Array.isArray(value)) return value.map(safeUnknown);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeUnknown(item)]));
  }
  return value;
}

export function judgeCanonicalExport(
  session: JudgeSession,
  definitions: JudgeExportDefinitions,
  generatedAt = new Date().toISOString(),
) {
  const safeSession = judgeExportSafeSession(session);
  return {
    schemaVersion: JUDGE_EXPORT_SCHEMA_VERSION,
    generatedAt,
    evaluationMode: "offline-dataset-replay",
    scoringNotice: "BORA Bridge 내부 자동 제출 준비도이며 2026 금융 AI Challenge의 공식 심사 점수 또는 배점이 아닙니다.",
    scoreBoundary: "저장형 데이터셋 재생 결과만 100점에 포함합니다. API handler·운영 설정 진단은 별도 결과이며 점수에 합산하지 않고, 공개 배포 URL E2E를 의미하지 않습니다.",
    reproductionBoundary: "현재 빌드의 반복 실행은 byte-identical입니다. 완전한 외부 재현에는 세 artifact SHA-256·평가기 버전과 함께 동일한 source commit 및 dependency lockfile이 필요하며, source commit과 lockfile은 이 세션에 봉인되지 않습니다.",
    privacyNotice: "합성 평가 입력만 사용하며 명백한 비밀·이메일·전화·식별번호 패턴은 내보내기 직전 다시 마스킹합니다.",
    datasetProvenance: safeSession.automaticRun?.snapshot.authorship ?? null,
    datasetLimitations: safeSession.automaticRun?.snapshot.limitations ?? [],
    coverageCorpus: safeSession.coverageRun,
    resultFingerprint: safeSession.automaticRun
      ? {
          value: safeSession.automaticRun.resultDigest,
          algorithm: "fnv1a-32",
          cryptographic: false,
          purpose: "동일 빌드에서의 반복 실행 결과 비교",
        }
      : null,
    session: safeSession,
    definitions: {
      rubric: safeSession.definitions?.rubric ?? definitions.rubric,
      safetyGates: safeSession.definitions?.safetyGates ?? definitions.gates,
      automaticCases: safeSession.definitions?.automaticCases ?? definitions.cases,
    },
  };
}

export function judgeExportSafeSession(session: JudgeSession): JudgeSession {
  const gateReviews = Object.fromEntries(Object.entries(session.gateReviews).map(([id, review]) => [id, {
    ...review,
    note: sanitizeJudgeText(review.note, 1_000),
  }]));
  const automaticRun = session.automaticRun
    ? {
        ...session.automaticRun,
        cases: session.automaticRun.cases.map((item) => ({
          ...item,
          expected: sanitizeJudgeText(item.expected, 1_000),
          actual: sanitizeJudgeText(item.actual, 1_000),
          assertions: item.assertions.map((entry) => ({
            ...entry,
            expected: safeUnknown(entry.expected),
            actual: safeUnknown(entry.actual),
          })),
          evidence: item.evidence.map((entry) => sanitizeJudgeText(entry, 500)),
          errorCode: item.errorCode ? sanitizeJudgeText(item.errorCode, 120) : null,
        })),
        snapshot: {
          ...session.automaticRun.snapshot,
          authorship: safeUnknown(session.automaticRun.snapshot.authorship) as typeof session.automaticRun.snapshot.authorship,
          limitations: session.automaticRun.snapshot.limitations.map((item) => sanitizeJudgeText(item, 500)),
        },
      }
    : null;
  const diagnosticRun = session.diagnosticRun
    ? {
        ...session.diagnosticRun,
        checks: session.diagnosticRun.checks.map((item) => ({
          ...item,
          actual: sanitizeJudgeText(item.actual, 1_000),
          evidence: item.evidence.map((entry) => sanitizeJudgeText(entry, 500)),
          errorCode: item.errorCode ? sanitizeJudgeText(item.errorCode, 120) : null,
        })),
        snapshot: {
          ...session.diagnosticRun.snapshot,
          origin: sanitizeJudgeText(session.diagnosticRun.snapshot.origin, 200),
          buildCommit: session.diagnosticRun.snapshot.buildCommit
            ? sanitizeJudgeText(session.diagnosticRun.snapshot.buildCommit, 64)
            : null,
          ai: session.diagnosticRun.snapshot.ai
            ? {
                provider: sanitizeJudgeText(session.diagnosticRun.snapshot.ai.provider, 60),
                model: sanitizeJudgeText(session.diagnosticRun.snapshot.ai.model, 120),
                runtimeUsable: session.diagnosticRun.snapshot.ai.runtimeUsable,
                issue: session.diagnosticRun.snapshot.ai.issue
                  ? sanitizeJudgeText(session.diagnosticRun.snapshot.ai.issue, 200)
                  : null,
              }
            : null,
        },
      }
    : null;
  const coverageRun = session.coverageRun
    ? {
        ...session.coverageRun,
        failureDetails: session.coverageRun.failureDetails.map((item) => ({
          ...item,
          expected: sanitizeJudgeText(item.expected, 1_000),
          actual: sanitizeJudgeText(item.actual, 1_000),
          errorCode: item.errorCode ? sanitizeJudgeText(item.errorCode, 120) : null,
        })),
        provenance: safeUnknown(session.coverageRun.provenance) as typeof session.coverageRun.provenance,
      }
    : null;
  return {
    ...session,
    title: sanitizeJudgeText(session.title, 80) || "자동평가 세션",
    reviewer: {
      displayName: "승인된 개발자",
      provider: sanitizeJudgeText(session.reviewer.provider, 40),
    },
    reviewerNotes: sanitizeJudgeText(session.reviewerNotes, 3_000),
    manualReviews: {},
    gateReviews,
    automaticRun,
    coverageRun,
    diagnosticRun,
  };
}

/** Neutralize spreadsheet formulas before RFC 4180 escaping. */
export function neutralizeCsvFormula(value: unknown) {
  const text = value == null
    ? ""
    : typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  return /^[\s\uFEFF]*[=+\-@]/u.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown) {
  const safe = neutralizeCsvFormula(value).replace(/\r\n?/gu, "\n");
  return `"${safe.replaceAll('"', '""')}"`;
}

export function judgeSessionCsv(
  session: JudgeSession,
  definitions: JudgeExportDefinitions,
) {
  const safeSession = judgeExportSafeSession(session);
  const pinnedDefinitions = {
    gates: safeSession.definitions?.safetyGates ?? definitions.gates,
  };
  const header = [
    "record_type",
    "run_type",
    "session_id",
    "run_id",
    "record_id",
    "assertion_id",
    "group",
    "label",
    "status",
    "score",
    "max_score",
    "adapter",
    "risk_class",
    "grader_or_operator",
    "expected",
    "actual",
    "input_digest",
    "output_digest",
    "evidence",
    "duration_ms",
    "dataset_id",
    "dataset_sha256",
    "runner_version",
    "dataset_authoring_model",
    "result_digest",
    "core_readiness_gate",
    "session_status",
    "created_at",
    "updated_at",
    "sealed_at",
    "api_snapshot_sha256",
    "evidence_manifest_sha256",
    "independent_expert_review",
    "network_call_boundary",
    "result_fingerprint_algorithm",
    "summary_total_score",
    "summary_total_max_score",
  ];
  const rows: unknown[][] = [];
  const coreRun = safeSession.automaticRun;
  const artifactHashes = coreRun?.snapshot.artifactHashes ?? safeSession.artifactHashes;
  const reviewState = coreRun?.snapshot.authorship.independentExpertReview ?? "not_recorded";
  const coreTail = [
    artifactHashes?.apiSnapshots ?? "",
    artifactHashes?.evidenceManifest ?? "",
    reviewState,
    "offline core: external network 0, model calls 0",
    "fnv1a-32 (non-cryptographic)",
  ];
  const diagnosticTail = [
    artifactHashes?.apiSnapshots ?? "",
    artifactHashes?.evidenceManifest ?? "",
    reviewState,
    "separate in-process/runtime diagnostic; public URL E2E not claimed",
    "not-applicable",
  ];
  const coverageRun = safeSession.coverageRun;
  const coverageTail = [
    "",
    "",
    coverageRun?.provenance.independentExpertReview ?? "not_recorded",
    "offline coverage: external network 0, model calls 0",
    "sha-256",
  ];
  rows.push([
    "session_summary",
    "core",
    safeSession.id,
    coreRun?.id ?? "",
    safeSession.id,
    "",
    "저장형 자동평가",
    safeSession.title,
    safeSession.status,
    "",
    "",
    "offline-dataset-replay",
    "",
    "weighted-pass-fail",
    "비공식 내부 자동 제출 준비도",
    `통과 ${safeSession.summary.counts.pass} · 실패 ${safeSession.summary.counts.fail} · 오류 ${safeSession.summary.counts.error}`,
    "",
    "",
    coreRun?.snapshot.evidenceManifestId ?? "",
    "",
    safeSession.datasetId,
    safeSession.datasetHash,
    safeSession.runnerVersion,
    coreRun?.snapshot.authorship.model ?? "",
    coreRun?.resultDigest ?? "",
    safeSession.summary.readinessGate,
    safeSession.status,
    safeSession.createdAt,
    safeSession.updatedAt,
    safeSession.sealedAt ?? "",
    ...coreTail,
    safeSession.summary.totalScore,
    safeSession.summary.totalMaxScore,
  ]);
  rows.push([
    "dataset_provenance", "core", safeSession.id, coreRun?.id ?? "", safeSession.datasetId, "",
    "데이터셋 생성·검수 이력", coreRun?.snapshot.authorship.role ?? "기록 없음", "disclosed", "", "",
    "provenance", "", "claim-boundary", "GPT-5.6 Sol 기반 에이전트의 합성 케이스 작성·코드 근거 검토 지원",
    `${coreRun?.snapshot.authorship.disclosure ?? "기록 없음"} · 완전한 외부 재현에는 동일 source commit과 lockfile이 추가로 필요하며 세션에는 봉인되지 않음`, "", "", (coreRun?.snapshot.limitations ?? []).join(" | "), "",
    safeSession.datasetId, safeSession.datasetHash, safeSession.runnerVersion,
    coreRun?.snapshot.authorship.model ?? "", coreRun?.resultDigest ?? "", safeSession.summary.readinessGate,
    safeSession.status, safeSession.createdAt, safeSession.updatedAt, safeSession.sealedAt ?? "", ...coreTail, "", "",
  ]);
  for (const result of coreRun?.cases ?? []) {
    rows.push([
      "core_case", "core", safeSession.id, coreRun?.id ?? "", result.id, "", result.suite,
      result.label, result.status, result.earnedScore, result.weight, result.adapter, result.riskClass,
      result.assertions.length > 0 ? "all-assertions-pass" : "no-assertions", result.expected, result.actual,
      result.inputDigest, result.outputDigest, result.evidence.join(" | "), result.durationMs,
      safeSession.datasetId, safeSession.datasetHash, safeSession.runnerVersion,
      coreRun?.snapshot.authorship.model ?? "", coreRun?.resultDigest ?? "", safeSession.summary.readinessGate,
      safeSession.status, safeSession.createdAt, safeSession.updatedAt, safeSession.sealedAt ?? "",
      ...coreTail,
      "", "",
    ]);
    for (const detail of result.assertions) {
      rows.push([
        "core_assertion", "core", safeSession.id, coreRun?.id ?? "", result.id, detail.id, result.suite,
        `${result.label} · ${detail.label}`, detail.passed ? "pass" : "fail", "",
        "", result.adapter, result.riskClass, detail.operator, detail.expected, detail.actual,
        result.inputDigest, result.outputDigest, result.evidence.join(" | "), result.durationMs,
        safeSession.datasetId, safeSession.datasetHash, safeSession.runnerVersion,
        coreRun?.snapshot.authorship.model ?? "", coreRun?.resultDigest ?? "", safeSession.summary.readinessGate,
        safeSession.status, safeSession.createdAt, safeSession.updatedAt, safeSession.sealedAt ?? "",
        ...coreTail,
        "", "",
      ]);
    }
  }
  if (coverageRun) {
    rows.push([
      "coverage_summary", "coverage", safeSession.id, coverageRun.resultSha256,
      coverageRun.corpusId, "", "6 suites × 100", "600-case deterministic coverage",
      coverageRun.allPassed ? "pass" : "fail", "", "", "offline-replay", "",
      "all-cases-and-critical-pass", "600 synthetic stored cases",
      `pass ${coverageRun.passedCases} · fail ${coverageRun.failedCases} · error ${coverageRun.errorCases}`,
      coverageRun.definitionSha256, coverageRun.caseOrderSha256,
      `manifest=${coverageRun.manifestSha256}`, "", coverageRun.corpusId,
      coverageRun.manifestSha256, coverageRun.schemaVersion, coverageRun.provenance.model,
      coverageRun.resultSha256, safeSession.summary.readinessGate, safeSession.status,
      safeSession.createdAt, safeSession.updatedAt, safeSession.sealedAt ?? "",
      ...coverageTail, "", "",
    ]);
    for (const suite of coverageRun.suiteSummaries) {
      rows.push([
        "coverage_suite", "coverage", safeSession.id, coverageRun.resultSha256,
        suite.suite, "", suite.suite, `${suite.suite} · 100 stored cases`, suite.gate,
        "", "", "offline-replay", "", "all-cases-and-critical-pass",
        `pass 100/100 · critical ${suite.criticalTotal}/${suite.criticalTotal}`,
        `pass ${suite.passed}/${suite.total} · fail ${suite.failed} · error ${suite.errors} · critical ${suite.criticalPassed}/${suite.criticalTotal}`,
        "", "", `manifest=${coverageRun.manifestSha256}`, "", coverageRun.corpusId,
        coverageRun.manifestSha256, coverageRun.schemaVersion, coverageRun.provenance.model,
        coverageRun.resultSha256, safeSession.summary.readinessGate, safeSession.status,
        safeSession.createdAt, safeSession.updatedAt, safeSession.sealedAt ?? "",
        ...coverageTail, "", "",
      ]);
    }
    for (const failure of coverageRun.failureDetails) {
      rows.push([
        "coverage_failure", "coverage", safeSession.id, coverageRun.resultSha256,
        failure.id, "", failure.suite, failure.id, failure.status, "", "",
        "offline-replay", "", "failed-assertions", failure.expected, failure.actual,
        "", "", failure.failedAssertionIds.join(" | "), "", coverageRun.corpusId,
        coverageRun.manifestSha256, coverageRun.schemaVersion, coverageRun.provenance.model,
        coverageRun.resultSha256, safeSession.summary.readinessGate, safeSession.status,
        safeSession.createdAt, safeSession.updatedAt, safeSession.sealedAt ?? "",
        ...coverageTail, "", "",
      ]);
    }
  }
  for (const definition of pinnedDefinitions.gates) {
    const review = safeSession.gateReviews[definition.id];
    rows.push([
      "automatic_gate", "core", safeSession.id, coreRun?.id ?? "", definition.id, "", "자동 안전 게이트",
      definition.label, review?.status ?? "not-reviewed", "", "", "case-map", "", "all-required-pass",
      definition.requiredCaseIds.join(" | "), review?.note ?? "", "", "", definition.requiredCaseIds.join(" | "),
      "", safeSession.datasetId, safeSession.datasetHash, safeSession.runnerVersion,
      coreRun?.snapshot.authorship.model ?? "", coreRun?.resultDigest ?? "", safeSession.summary.readinessGate,
      safeSession.status, safeSession.createdAt, safeSession.updatedAt, safeSession.sealedAt ?? "",
      ...coreTail,
      "", "",
    ]);
  }
  if (safeSession.diagnosticRun) {
    rows.push([
      "diagnostic_summary", "diagnostic", safeSession.id, safeSession.diagnosticRun.id,
      safeSession.diagnosticRun.id, "", "API·운영 진단", "점수 미포함 진단 snapshot", "recorded", "", "",
      "runtime-snapshot", "", "separate-not-scored", "현재 서버 내부 handler·설정의 1회 관찰",
      safeSession.diagnosticRun.snapshot, "", "", `capturedAt=${safeSession.diagnosticRun.snapshot.capturedAt}`, "",
      safeSession.datasetId, safeSession.datasetHash, safeSession.diagnosticRun.version,
      "", "", safeSession.summary.readinessGate, safeSession.status, safeSession.createdAt,
      safeSession.updatedAt, safeSession.sealedAt ?? "", ...diagnosticTail,
      "", "",
    ]);
  }
  for (const check of safeSession.diagnosticRun?.checks ?? []) {
    rows.push([
      "api_diagnostic", "diagnostic", safeSession.id, safeSession.diagnosticRun?.id ?? "", check.id, "",
      "API·운영 진단", check.label, check.status, "", "", check.kind, "", "separate-not-scored",
      check.expected, check.actual, "", "", `${check.target} | ${check.evidence.join(" | ")}`, check.durationMs,
      safeSession.datasetId, safeSession.datasetHash, safeSession.diagnosticRun?.version ?? "",
      "", "", safeSession.summary.readinessGate, safeSession.status, safeSession.createdAt,
      safeSession.updatedAt, safeSession.sealedAt ?? "",
      ...diagnosticTail,
      "", "",
    ]);
  }

  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function safeJudgeFilename(title: string) {
  const normalized = title
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return normalized || "bora-judge";
}
