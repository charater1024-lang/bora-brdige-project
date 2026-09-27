"use client";

import {
  Activity,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Database,
  FileJson,
  FileSpreadsheet,
  Fingerprint,
  FlaskConical,
  LockKeyhole,
  Play,
  Plus,
  Printer,
  ServerCog,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  judgeCanonicalExport,
  judgeExportSafeSession,
  judgeSessionCsv,
  safeJudgeFilename,
} from "@/lib/judge-export";
import type {
  JudgeCaseDefinition,
  JudgeGateDefinition,
  JudgeSession,
  JudgeSessionStatus,
} from "@/lib/judge-evaluation";

import styles from "./evaluation.module.css";

type CoverageCorpusView = {
  corpusId: string;
  manifestSha256: string;
  definitionSha256: string;
  caseOrderSha256: string;
  suiteOrder: string[];
  casesPerSuite: number;
  totalCases: number;
  relationshipToDeepScore: {
    deepDatasetId: string;
    deepCasesPreserved: number;
    deepAutomaticMaxScorePreserved: number;
    coverageScoreContribution: number;
  };
  artifacts: {
    suites: Array<{ suite: string; filename: string; caseCount: number; sha256: string }>;
    provenance: { filename: string; sha256: string };
    generator: { path: string; sha256: string };
  };
  provenance: {
    authorship: {
      provider: string;
      model: string;
      officialModelReference: string;
      environment: string;
      role: string;
      runtimeModelUse: boolean;
      independentExpertReview: string;
      confidence: string;
    };
    generation: { methodology: string[]; runtimeGeneratorReplayCalls: { networkCalls: number; modelCalls: number; wallClockInputs: number; randomInputs: number } };
    claimBoundary: { qualityClaim: string; officialHackathonScore: boolean; deepScoreContribution: number; disclosure: string };
    limitations: string[];
  };
  runtimeNetworkCalls: number;
  runtimeModelCalls: number;
};

type DatasetView = {
  id: string;
  hash: string;
  artifactHashes: { coreDataset: string; apiSnapshots: string; evidenceManifest: string };
  caseCount: number;
  automaticMaxScore: number;
  runnerVersion: string;
  syntheticOnly: boolean;
  containsPersonalData: boolean;
  containsLiveMaliciousUrls: boolean;
  networkCallsDuringCoreEvaluation: boolean;
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
  methodology: { steps: string[]; designPrinciples: string[]; officialGuidance: string[] };
  limitations: string[];
  gates: JudgeGateDefinition[];
  apiSnapshotSet: { id: string; liveCapture: boolean; externalCallsDuringEvaluation: boolean; count: number };
  evidenceManifestId: string;
  coverageCorpus?: CoverageCorpusView;
  cases: JudgeCaseDefinition[];
};

type JudgeApiResponse = {
  administrator?: { displayName?: string; provider?: string };
  safetyGates?: JudgeGateDefinition[];
  dataset?: DatasetView;
  sessions?: JudgeSession[];
  session?: JudgeSession;
  legacySessionCount?: number;
  currentSessionCount?: number;
  nextCursor?: string | null;
  error?: string;
};

type ViewId = "overview" | "replay" | "diagnostics" | "dataset" | "provenance" | "exports";

const views: Array<{ id: ViewId; label: string; icon: typeof BarChart3 }> = [
  { id: "overview", label: "평가 요약", icon: BarChart3 },
  { id: "replay", label: "저장형 자동평가", icon: Play },
  { id: "diagnostics", label: "API 진단", icon: ServerCog },
  { id: "dataset", label: "데이터셋", icon: Database },
  { id: "provenance", label: "생성 방법", icon: Fingerprint },
  { id: "exports", label: "결과 파일", icon: FileJson },
];

const statusCopy: Record<JudgeSessionStatus, string> = {
  draft: "실행 전",
  review: "결과 확인",
  sealed: "확정",
};

const caseStatusCopy = {
  pass: "통과",
  fail: "실패",
  error: "오류",
  blocked: "차단",
  "not-run": "미실행",
  skipped: "제외",
} as const;

const coverageSuiteCopy: Record<string, string> = {
  "financial-correctness": "금융 계산 정확성",
  "evidence-grounding": "공식 근거·출처",
  "financial-safety": "금융 안전",
  "privacy-consent": "개인정보·동의",
  "stored-api-contract": "저장형 API 계약",
  reproducibility: "재현성·무결성",
};

function displayDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "기록 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function errorMessage(code: string) {
  const messages: Record<string, string> = {
    authentication_required: "승인된 개발자 계정으로 로그인해 주세요.",
    developer_access_denied: "이 계정에는 자동평가 권한이 없습니다.",
    judge_sessions_unavailable: "평가 세션 저장소에 연결하지 못했습니다.",
    judge_session_conflict: "다른 화면에서 세션이 변경되었습니다. 다시 불러와 주세요.",
    judge_session_sealed: "확정된 세션은 변경할 수 없습니다. 새 세션을 만들어 주세요.",
    judge_automatic_run_required: "결과 확정 전에 저장형 자동평가를 실행해 주세요.",
    judge_core_run_already_exists: "같은 세션의 결과를 덮어쓰지 않습니다. 재평가하려면 새 세션을 만들어 주세요.",
    judge_coverage_run_required: "결과 확정 전에 600건 전수 회귀검사를 포함한 자동평가를 실행해 주세요.",
    judge_diagnostic_run_already_exists: "API 진단은 세션당 한 번만 기록합니다. 다시 진단하려면 새 세션을 만들어 주세요.",
    judge_session_version_mismatch: "이 세션은 이전 평가기 버전입니다. 새 세션에서 실행해 주세요.",
    origin_mismatch: "보안을 위해 같은 출처에서 다시 시도해 주세요.",
  };
  return messages[code] ?? "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", ...init });
  const body = await response.json() as JudgeApiResponse;
  if (!response.ok) throw new Error(body.error ?? "judge_request_failed");
  return body;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function DeveloperEvaluationPage() {
  const [sessions, setSessions] = useState<JudgeSession[]>([]);
  const [dataset, setDataset] = useState<DatasetView | null>(null);
  const [administrator, setAdministrator] = useState<{ displayName?: string; provider?: string } | null>(null);
  const [legacySessionCount, setLegacySessionCount] = useState(0);
  const [currentSessionCount, setCurrentSessionCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("overview");
  const [newTitle, setNewTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"create" | "run" | "diagnostics" | "seal" | null>(null);
  const [notice, setNotice] = useState("");
  const [accessError, setAccessError] = useState<string | null>(null);

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0] ?? null,
    [selectedId, sessions],
  );
  const historicalCoverage = Boolean(selected?.coverageRun && dataset?.coverageCorpus
    && (selected.coverageRun.corpusId !== dataset.coverageCorpus.corpusId
      || selected.coverageRun.manifestSha256 !== dataset.coverageCorpus.manifestSha256));

  const loadSessions = useCallback(async (preferredId?: string) => {
    setLoading(true);
    try {
      const response = await requestJson("/api/developer/judge-sessions");
      const nextSessions = response.sessions ?? [];
      setSessions(nextSessions);
      setDataset(response.dataset ?? null);
      setAdministrator(response.administrator ?? null);
      setLegacySessionCount(response.legacySessionCount ?? 0);
      setCurrentSessionCount(response.currentSessionCount ?? nextSessions.length);
      setNextCursor(response.nextCursor ?? null);
      setSelectedId((current) => {
        if (preferredId && nextSessions.some((session) => session.id === preferredId)) return preferredId;
        return nextSessions.some((session) => session.id === current) ? current : nextSessions[0]?.id ?? null;
      });
      setAccessError(null);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "judge_sessions_unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  async function loadMoreSessions() {
    if (nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await requestJson(`/api/developer/judge-sessions?cursor=${encodeURIComponent(nextCursor)}`);
      const nextSessions = response.sessions ?? [];
      const serverCount = response.currentSessionCount ?? currentSessionCount;
      if (serverCount !== currentSessionCount) {
        await loadSessions(selectedId ?? undefined);
        setNotice("다른 화면에서 세션 수가 변경되어 최신 첫 페이지부터 다시 동기화했습니다.");
        return;
      }
      const known = new Set(sessions.map((session) => session.id));
      const uniqueSessions = [...sessions, ...nextSessions.filter((session) => !known.has(session.id))];
      setSessions(uniqueSessions);
      setCurrentSessionCount(serverCount);
      setNextCursor(response.nextCursor ?? null);
      if (response.nextCursor == null && uniqueSessions.length < serverCount) {
        setNotice("일부 보존 세션을 안전하게 읽지 못했습니다. 목록을 새로 고친 뒤에도 계속되면 저장소 상태를 확인해 주세요.");
      }
    } catch (error) {
      setNotice(errorMessage(error instanceof Error ? error.message : "judge_sessions_unavailable"));
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => { void loadSessions(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadSessions]);

  function replaceSession(session: JudgeSession) {
    setSessions((current) => current.map((item) => item.id === session.id ? session : item));
    setSelectedId(session.id);
  }

  async function createSession() {
    setPending("create");
    setNotice("");
    try {
      const response = await requestJson("/api/developer/judge-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", title: newTitle }),
      });
      if (!response.session) throw new Error("judge_session_operation_failed");
      await loadSessions(response.session.id);
      setNewTitle("");
      setView("overview");
      setNotice("새 자동평가 세션을 만들었습니다.");
    } catch (error) {
      setNotice(errorMessage(error instanceof Error ? error.message : "judge_session_operation_failed"));
    } finally {
      setPending(null);
    }
  }

  async function runAction(action: "run" | "diagnostics") {
    if (!selected || historicalCoverage) return;
    setPending(action);
    setNotice("");
    try {
      const response = await requestJson("/api/developer/judge-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sessionId: selected.id, expectedUpdatedAt: selected.updatedAt }),
      });
      if (!response.session) throw new Error("judge_session_operation_failed");
      replaceSession(response.session);
      setView(action === "run" ? "replay" : "diagnostics");
      setNotice(action === "run"
        ? `저장형 자동평가가 ${response.session.summary.totalScore}/${response.session.summary.totalMaxScore}점으로 완료됐습니다.`
        : "현재 서버와 API 상태 진단을 별도 기록했습니다. 이 결과는 100점에 합산되지 않습니다.");
    } catch (error) {
      setNotice(errorMessage(error instanceof Error ? error.message : "judge_session_operation_failed"));
    } finally {
      setPending(null);
    }
  }

  async function sealSession() {
    if (!selected || historicalCoverage) return;
    setPending("seal");
    setNotice("");
    try {
      const response = await requestJson("/api/developer/judge-sessions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: selected.id, expectedUpdatedAt: selected.updatedAt, status: "sealed", title: selected.title }),
      });
      if (!response.session) throw new Error("judge_session_operation_failed");
      replaceSession(response.session);
      setNotice("결과를 확정했습니다. 이제 JSON·CSV·PDF 보고서를 만들 수 있습니다.");
    } catch (error) {
      setNotice(errorMessage(error instanceof Error ? error.message : "judge_session_save_failed"));
    } finally {
      setPending(null);
    }
  }

  function definitionsFor(session: JudgeSession) {
    return { rubric: [], gates: session.definitions.safetyGates, cases: session.definitions.automaticCases };
  }

  function exportJson() {
    if (!selected || (selected.status !== "sealed" && !historicalCoverage)) return;
    const content = JSON.stringify(judgeCanonicalExport(selected, definitionsFor(selected)), null, 2);
    downloadFile(`${safeJudgeFilename(selected.title)}-${selected.id}.json`, `${content}\n`, "application/json;charset=utf-8");
  }

  function exportCsv() {
    if (!selected || (selected.status !== "sealed" && !historicalCoverage)) return;
    downloadFile(`${safeJudgeFilename(selected.title)}-${selected.id}.csv`, judgeSessionCsv(selected, definitionsFor(selected)), "text/csv;charset=utf-8");
  }

  const selectedDataset = useMemo<DatasetView | null>(() => {
    if (!selected) return dataset;
    return {
      ...(dataset ?? {
        id: selected.datasetId,
        hash: selected.datasetHash,
        artifactHashes: selected.artifactHashes ?? {
          coreDataset: selected.datasetHash,
          apiSnapshots: "기록 없음",
          evidenceManifest: "기록 없음",
        },
        caseCount: selected.definitions.automaticCases.length,
        automaticMaxScore: selected.summary.automaticMaxScore,
        runnerVersion: selected.runnerVersion,
        syntheticOnly: selected.datasetPrivacy.syntheticOnly,
        containsPersonalData: selected.datasetPrivacy.containsPersonalData,
        containsLiveMaliciousUrls: false,
        networkCallsDuringCoreEvaluation: false,
        authorship: selected.automaticRun?.snapshot.authorship ?? {
          provider: "기록 없음", model: "기록 없음", environment: "기록 없음", role: "기록 없음",
          creationMode: "기록 없음", promptSummary: "기록 없음", runtimeJudgeUse: false,
          disclosure: "이전 세션", independentExpertReview: "not_recorded", provenanceConfidence: "not_recorded",
        },
        methodology: { steps: [], designPrinciples: [], officialGuidance: [] },
        limitations: [],
        gates: selected.definitions.safetyGates,
        apiSnapshotSet: { id: "기록 없음", liveCapture: false, externalCallsDuringEvaluation: false, count: 0 },
        evidenceManifestId: "기록 없음",
        cases: selected.definitions.automaticCases,
      }),
      id: selected.datasetId,
      hash: selected.datasetHash,
      artifactHashes: selected.automaticRun?.snapshot.artifactHashes
        ?? selected.artifactHashes
        ?? dataset?.artifactHashes
        ?? { coreDataset: selected.datasetHash, apiSnapshots: "기록 없음", evidenceManifest: "기록 없음" },
      runnerVersion: selected.runnerVersion,
      caseCount: selected.definitions.automaticCases.length,
      automaticMaxScore: selected.summary.automaticMaxScore,
      cases: selected.definitions.automaticCases,
      gates: selected.definitions.safetyGates,
      authorship: selected.automaticRun?.snapshot.authorship ?? dataset?.authorship ?? ({} as DatasetView["authorship"]),
      // Do not show the current release's source/provenance as if it belonged
      // to a saved historical run. Its own pins remain visible in replay/export.
      coverageCorpus: historicalCoverage ? undefined : dataset?.coverageCorpus,
    };
  }, [dataset, selected, historicalCoverage]);
  const totalAutomaticCases = (selectedDataset?.caseCount ?? 0) + (selectedDataset?.coverageCorpus?.totalCases ?? 0);

  if (loading) return <main className={styles.statePage}><Activity className={styles.spin} /><h1>자동평가 센터를 불러오는 중입니다</h1></main>;
  if (accessError) return <main className={styles.statePage}><ShieldCheck /><h1>개발자 전용 자동평가</h1><p>{errorMessage(accessError)}</p><Link href="/developer"><ArrowLeft />개발자 홈으로</Link></main>;

  return <main className={styles.page}>
    <header className={styles.masthead}>
      <div>
        <Link href="/developer"><ArrowLeft size={17} />개발자 홈</Link>
        <span>DEVELOPER · AUTOMATED EVALUATION</span>
      </div>
      <div className={styles.identity}><span>승인된 개발자</span><strong>{administrator?.displayName ?? "인증됨"}</strong></div>
    </header>

    <section className={styles.hero}>
      <div>
        <span>BORA EVIDENCE LAB · 비공식 내부 평가</span>
        <h1>저장된 증거로,<br />한 번에 재현하는 자동평가</h1>
        <p>이 Codex 작업에서 GPT‑5.6 Sol 기반 에이전트가 합성 케이스 작성과 코드 근거 반복 검토를 지원했습니다. 28건 상세 채점과 6개 영역별 100건 전수검사는 외부 네트워크·모델 호출 없이 함께 실행되고, API handler·운영 설정 진단은 별도입니다.</p>
      </div>
      <div className={styles.heroFacts}>
        <div><strong>100</strong><span>자동 점수</span></div>
        <div><strong>{totalAutomaticCases}</strong><span>자동 케이스 · 28+600</span></div>
        <div><strong>0</strong><span>저장형 실행 외부·모델 호출</span></div>
      </div>
    </section>

    <section className={styles.workspace}>
      <aside className={styles.sidebar}>
        <div className={styles.newSession}>
          <label htmlFor="evaluation-title">새 평가 세션</label>
          <input id="evaluation-title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={80} placeholder="예: 최종 제출 전 자동점검" />
          <button type="button" onClick={createSession} disabled={pending !== null}><Plus size={17} />{pending === "create" ? "생성 중…" : "세션 만들기"}</button>
        </div>
        <div className={styles.sessionList} aria-label="평가 세션 목록">
          {sessions.length === 0 && <p>아직 평가 세션이 없습니다.</p>}
          {legacySessionCount > 0 && <p>{legacySessionCount}개의 이전 평가 세션은 새 100점 기준으로 재해석하지 않고 보존했습니다.</p>}
          {sessions.map((session) => <button key={session.id} type="button" data-active={session.id === selected?.id} onClick={() => { setSelectedId(session.id); setView("overview"); }}>
            <span>{statusCopy[session.status]}</span>
            <strong>{session.title}</strong>
            <small>{session.summary.totalScore}/{session.summary.totalMaxScore} · {displayDate(session.updatedAt)}</small>
          </button>)}
          {nextCursor !== null && <button type="button" onClick={() => { void loadMoreSessions(); }} disabled={loadingMore}>
            <span>보존 세션</span>
            <strong>{loadingMore ? "불러오는 중…" : "이전 평가 더 보기"}</strong>
            <small>{sessions.length}/{currentSessionCount}개 표시</small>
          </button>}
        </div>
      </aside>

      <div className={styles.content}>
        {!selected ? <section className={styles.empty}><FlaskConical /><h2>첫 자동평가 세션을 만드세요</h2><p>세션을 만들면 저장형 평가와 별도 API 진단을 시작할 수 있습니다.</p></section> : <>
          <section className={styles.sessionHeader}>
            <div><span>{statusCopy[selected.status]}</span><h2>{selected.title}</h2><small>{selected.id} · SHA-256 {selected.datasetHash.slice(0, 12)}…</small></div>
            <div className={styles.headerActions}>
              <button type="button" onClick={() => runAction("run")} disabled={historicalCoverage || pending !== null || selected.status === "sealed" || Boolean(selected.automaticRun)}><Play size={17} />{pending === "run" ? "평가 중…" : selected.automaticRun ? "자동평가 완료" : "자동평가 시작"}</button>
              <button type="button" onClick={sealSession} disabled={historicalCoverage || pending !== null || selected.status === "sealed" || !selected.automaticRun || !selected.coverageRun}><LockKeyhole size={17} />결과 확정</button>
            </div>
          </section>

          {notice && <p className={styles.notice} role="status">{notice}</p>}
          {historicalCoverage && <p className={styles.notice} role="status">이전 버전 평가 기록 · 읽기 전용입니다. 당시 점수·확정 상태·해시는 그대로 보존하며 JSON·CSV로 내보낼 수 있습니다. 현재 버전 검증은 새 세션에서 실행해 주세요.</p>}

          <nav className={styles.tabs} aria-label="자동평가 화면">
            {views.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}><Icon size={17} />{item.label}</button>; })}
          </nav>

          {view === "overview" && <Overview session={selected} />}
          {view === "replay" && <ReplayView session={selected} onRun={() => runAction("run")} running={pending === "run"} readOnly={historicalCoverage} />}
          {view === "diagnostics" && <DiagnosticsView session={selected} onRun={() => runAction("diagnostics")} running={pending === "diagnostics"} readOnly={historicalCoverage} />}
          {view === "dataset" && <DatasetViewPanel dataset={selectedDataset} />}
          {view === "provenance" && <ProvenanceView dataset={selectedDataset} />}
          {view === "exports" && <ExportView session={selected} onJson={exportJson} onCsv={exportCsv} historical={historicalCoverage} />}
        </>}
      </div>
    </section>

    {selected?.status === "sealed" && <PrintReport session={judgeExportSafeSession(selected)} />}
  </main>;
}

function Overview({ session }: { session: JudgeSession }) {
  const percentage = session.summary.totalMaxScore > 0 ? Math.round((session.summary.totalScore / session.summary.totalMaxScore) * 100) : 0;
  const diagnostic = session.diagnosticRun;
  const diagnosticPassed = diagnostic?.counts.pass ?? 0;
  const diagnosticTotal = diagnostic?.checks.length ?? 0;
  const coverage = session.coverageRun;
  return <>
    <section className={styles.scoreHero} data-gate={session.summary.readinessGate}>
      <div><span>OFFLINE DEEP SCORE · 비공식</span><strong>{session.summary.totalScore}<small>/{session.summary.totalMaxScore}</small></strong><p>28건 상세 채점 · 600건 전수검사는 안전 게이트로 반영</p></div>
      <div className={styles.scoreRing} style={{ "--score": `${percentage}%` } as React.CSSProperties}><span>{percentage}%</span></div>
      <div><em>{session.summary.readinessGate === "pass" ? "자동 게이트 통과" : session.summary.readinessGate === "fail" ? "자동 게이트 실패" : "평가 실행 전"}</em><p>상세 또는 600건 전수검사에서 하나라도 실패하면 관련 게이트가 실패합니다. API 진단은 점수와 게이트를 바꾸지 않습니다.</p></div>
    </section>
    <section className={styles.metrics}>
      <article><CheckCircle2 /><span>상세 채점</span><strong>{session.summary.counts.pass}<small>/{session.definitions.automaticCases.length}</small></strong></article>
      <article><Database /><span>전수 회귀검사</span><strong>{coverage?.passedCases ?? 0}<small>/{coverage?.totalCases ?? 600}</small></strong></article>
      <article><ShieldCheck /><span>자동 게이트</span><strong>{session.summary.gatesReviewed}<small>/{session.summary.gatesTotal}</small></strong></article>
      <article><ServerCog /><span>API 진단</span><strong>{diagnostic ? diagnosticPassed : "—"}<small>/{diagnosticTotal || "별도"}</small></strong></article>
    </section>
    <section className={styles.boundaryNote}><TriangleAlert /><div><strong>자동평가가 말하는 것과 말하지 않는 것</strong><p>구현된 계산·보안·근거·동의·계약·증거 추적성을 자동 검사합니다. 혁신성, 사업성, 발표 설득력을 공식 점수처럼 단정하지 않습니다.</p></div></section>
    <section className={styles.gateGrid}>{session.definitions.safetyGates.map((gate) => {
      const result = session.gateReviews[gate.id];
      return <article key={gate.id} data-status={result?.status ?? "not-reviewed"}>{result?.status === "pass" ? <CheckCircle2 /> : result?.status === "fail" ? <XCircle /> : <ShieldCheck />}<span>{gate.label}</span><p>{result?.note ?? "자동평가 실행 전"}</p><small>{gate.requiredCaseIds.length}개 필수 케이스</small></article>;
    })}</section>
  </>;
}

function ReplayView({ session, onRun, running, readOnly }: { session: JudgeSession; onRun: () => void; running: boolean; readOnly: boolean }) {
  const results = session.automaticRun?.cases;
  const coverage = session.coverageRun;
  return <>
    <section className={styles.sectionTitle}><div><span>OFFLINE DATASET REPLAY · 28 DEEP + 600 COVERAGE</span><h2>외부 호출 없는 전자동 평가</h2><p>28건은 assertion·점수까지 깊게 검증하고, 별도 저장된 6개 영역별 100건은 전수 회귀검사로 실행합니다. 600건은 점수를 부풀리지 않고 관련 안전 게이트를 fail-closed로 제어합니다. 외부 재현에는 artifact SHA-256, 평가기 버전, 동일 source commit과 lockfile이 필요합니다.</p></div><button type="button" onClick={onRun} disabled={readOnly || running || session.status === "sealed" || Boolean(results)}><Play size={18} />{running ? "628건 실행 중…" : results ? "실행 완료" : "628건 자동검증"}</button></section>
    <section className={styles.coverageSummary} aria-label="600건 전수 회귀검사 결과">
      <div><span>Coverage corpus</span><strong>{coverage?.corpusId ?? "실행 전"}</strong></div>
      <div><span>전체 통과</span><strong>{coverage ? `${coverage.passedCases}/${coverage.totalCases}` : "0/600"}</strong></div>
      <div><span>영역 게이트</span><strong>{coverage ? `${coverage.suiteSummaries.filter((item) => item.gate === "pass").length}/6` : "0/6"}</strong></div>
      <div><span>결과 SHA-256</span><strong className={styles.digest}>{coverage?.resultSha256 ?? "실행 후 기록"}</strong></div>
    </section>
    {coverage && <section className={styles.coverageSuites}>{coverage.suiteSummaries.map((suite) => <article key={suite.suite} data-status={suite.gate}><span>{coverageSuiteCopy[suite.suite] ?? suite.suite}</span><strong>{suite.passed}/{suite.total}</strong><small>critical {suite.criticalPassed}/{suite.criticalTotal} · 실패 {suite.failed} · 오류 {suite.errors}</small></article>)}</section>}
    <div className={styles.caseList}>
      {(results ?? session.definitions.automaticCases).map((item) => {
        const result = "status" in item ? item : null;
        return <details key={item.id} className={styles.caseCard} data-status={result?.status ?? "not-run"}>
          <summary><span>{result?.status === "pass" ? <CheckCircle2 /> : result?.status === "fail" || result?.status === "error" ? <XCircle /> : <Activity />}{caseStatusCopy[result?.status ?? "not-run"]}</span><div><code>{item.id}</code><strong>{item.label}</strong><small>{item.suite} · {"adapter" in item ? item.adapter : ""} · {"riskClass" in item ? item.riskClass : ""}</small></div><em>{result?.earnedScore ?? 0}/{item.weight}</em><ChevronRight /></summary>
          <div className={styles.caseDetail}><dl><div><dt>채점기</dt><dd>{"grader" in item ? item.grader : ""}</dd></div><div><dt>기대값</dt><dd><code>{item.expected}</code></dd></div><div><dt>실제값</dt><dd><code>{result?.actual ?? "실행 전"}</code></dd></div><div><dt>입력 / 출력 fingerprint</dt><dd><code>{result ? `FNV‑1a‑32 ${result.inputDigest} / ${result.outputDigest}` : "실행 후 기록"}</code></dd></div></dl>{result && <table><thead><tr><th>Assertion</th><th>연산</th><th>기대</th><th>실제</th><th>판정</th></tr></thead><tbody>{result.assertions.map((check) => <tr key={check.id}><td>{check.label}</td><td>{check.operator}</td><td><code>{JSON.stringify(check.expected)}</code></td><td><code>{JSON.stringify(check.actual)}</code></td><td>{check.passed ? "통과" : "실패"}</td></tr>)}</tbody></table>}<p>근거 · {(result?.evidence ?? ("sourceRefs" in item ? item.sourceRefs : [])).join(" · ")}</p></div>
        </details>;
      })}
    </div>
  </>;
}

function DiagnosticsView({ session, onRun, running, readOnly }: { session: JudgeSession; onRun: () => void; running: boolean; readOnly: boolean }) {
  const run = session.diagnosticRun;
  return <>
    <section className={styles.sectionTitle}><div><span>SEPARATE API DIAGNOSTICS · NOT SCORED</span><h2>현재 서버의 API 계약과 운영 설정을 별도 확인</h2><p>헬스·공공데이터·피싱 handler와 AI 설정을 한 번 진단합니다. 동일 서버 내부 점검이며 외부 배포 URL E2E 검증으로 과장하지 않고, 저장형 100점과 자동 게이트에도 합산하지 않습니다.</p></div><button type="button" onClick={onRun} disabled={readOnly || running || session.status === "sealed" || Boolean(run)}><ServerCog size={18} />{running ? "진단 중…" : run ? "진단 완료" : "API 진단 실행"}</button></section>
    {!run ? <section className={styles.emptyInline}><ServerCog /><p>필요할 때만 한 번 실행합니다. 저장형 자동평가 자체는 API나 AI 모델을 호출하지 않습니다.</p></section> : <>
      <section className={styles.diagnosticSummary}><div><strong>{run.counts.pass}</strong><span>통과</span></div><div><strong>{run.counts.warn}</strong><span>주의</span></div><div><strong>{run.counts.fail + run.counts.error}</strong><span>실패·오류</span></div><p>{displayDate(run.completedAt)} · {run.version}</p></section>
      <div className={styles.diagnosticList}>{run.checks.map((check) => <article key={check.id} data-status={check.status}>{check.status === "pass" ? <CheckCircle2 /> : check.status === "warn" ? <TriangleAlert /> : <XCircle />}<div><code>{check.id}</code><h3>{check.label}</h3><p>{check.actual}</p><small>{check.kind} · {check.target}<br />기대: {check.expected} · 외부 네트워크 {check.externalNetworkCalls}회 · {check.evidence.join(" · ")} · {check.durationMs}ms</small></div><strong>{check.status}</strong></article>)}</div>
    </>}
  </>;
}

function DatasetViewPanel({ dataset }: { dataset: DatasetView | null }) {
  if (!dataset) return <p className={styles.emptyInline}>데이터셋 메타데이터를 불러오지 못했습니다.</p>;
  const suites = Array.from(new Set(dataset.cases.map((item) => item.suite)));
  return <>
    <section className={styles.datasetHero}><div><span>VERSIONED · SYNTHETIC · OFFLINE</span><h2>{dataset.id}</h2><p>28건 상세 채점과 별도 불변 파일로 보관한 600건 전수 회귀검사를 결합합니다. 실제 개인정보·악성 URL·라이브 API 응답은 포함하지 않습니다.</p></div><div><strong>{dataset.caseCount + (dataset.coverageCorpus?.totalCases ?? 0)}</strong><span>28 deep · 600 coverage</span></div></section>
    <dl className={styles.datasetMeta}><div><dt>Core SHA-256</dt><dd><code>{dataset.artifactHashes.coreDataset}</code></dd></div><div><dt>API snapshot SHA-256</dt><dd><code>{dataset.artifactHashes.apiSnapshots}</code></dd></div><div><dt>Evidence SHA-256</dt><dd><code>{dataset.artifactHashes.evidenceManifest}</code></dd></div><div><dt>평가기</dt><dd><code>{dataset.runnerVersion}</code></dd></div><div><dt>생성 모델</dt><dd><code>{dataset.authorship?.model ?? "기록 없음"}</code></dd></div><div><dt>네트워크 호출</dt><dd>{dataset.networkCallsDuringCoreEvaluation ? "사용" : "없음"}</dd></div><div><dt>API 계약 스냅샷</dt><dd>{dataset.apiSnapshotSet.id} · {dataset.apiSnapshotSet.count}개</dd></div><div><dt>평가 영역</dt><dd>{suites.length}개 suite</dd></div></dl>
    {dataset.coverageCorpus && <section className={styles.coverageDataset}>
      <header><div><span>600-CASE COVERAGE CORPUS</span><h3>{dataset.coverageCorpus.corpusId}</h3><p>각 영역 100건 · 점수 기여 0 · 한 건 실패 시 해당 안전 게이트 실패</p></div><code>manifest SHA-256<br />{dataset.coverageCorpus.manifestSha256}</code></header>
      <div>{dataset.coverageCorpus.artifacts.suites.map((suite) => <article key={suite.suite}><span>{coverageSuiteCopy[suite.suite] ?? suite.suite}</span><strong>{suite.caseCount}건</strong><small>{suite.filename}<br />{suite.sha256}</small></article>)}</div>
    </section>}
    <section className={styles.catalogGrid}>{dataset.cases.map((item) => <article key={item.id}><div><em>{item.riskClass}</em><span>{item.weight}점</span></div><code>{item.id}</code><h3>{item.label}</h3><p>{item.expected}</p><small>{item.adapter} · {item.sourceRefs.join(" · ")}</small></article>)}</section>
  </>;
}

function ProvenanceView({ dataset }: { dataset: DatasetView | null }) {
  if (!dataset) return <p className={styles.emptyInline}>생성 이력을 불러오지 못했습니다.</p>;
  return <>
    <section className={styles.provenanceHero}><Fingerprint /><div><span>DATASET PROVENANCE</span><h2>{dataset.authorship.model} 기반 합성 평가 데이터</h2><p>{dataset.authorship.disclosure}</p></div></section>
    <section className={styles.provenanceGrid}>
      <article><span>생성 주체</span><strong>{dataset.authorship.provider} · {dataset.authorship.model}</strong><p>{dataset.authorship.environment}</p></article>
      <article><span>역할</span><strong>케이스 작성·코드 근거 검토</strong><p>실행 중 판정 모델 호출 없음</p></article>
      <article><span>독립 전문가 검수</span><strong>{dataset.authorship.independentExpertReview === "not_performed" ? "아직 수행하지 않음" : dataset.authorship.independentExpertReview}</strong><p>이 한계를 보고서에도 유지</p></article>
    </section>
    {dataset.coverageCorpus && <section className={styles.method}><h3>600건 데이터셋을 어떻게 만들었나</h3><ol>{dataset.coverageCorpus.provenance.generation.methodology.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p></li>)}</ol><p className={styles.provenanceDisclosure}>{dataset.coverageCorpus.provenance.claimBoundary.disclosure}</p></section>}
    <section className={styles.method}><h3>어떻게 만들었나</h3><ol>{dataset.methodology.steps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p></li>)}</ol></section>
    <section className={styles.limits}><h3>해석 한계</h3>{[...dataset.limitations, ...(dataset.coverageCorpus?.provenance.limitations ?? [])].map((item) => <p key={item}><TriangleAlert size={16} />{item}</p>)}</section>
    {dataset.coverageCorpus && <section className={styles.references}><h3>공식 모델 정보</h3><a href={dataset.coverageCorpus.provenance.authorship.officialModelReference} target="_blank" rel="noreferrer">{dataset.coverageCorpus.provenance.authorship.officialModelReference}<ChevronRight size={15} /></a></section>}
    <section className={styles.references}><h3>참고한 공식 평가 원칙</h3>{dataset.methodology.officialGuidance.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">{url}<ChevronRight size={15} /></a>)}</section>
  </>;
}

function ExportView({ session, onJson, onCsv, historical }: { session: JudgeSession; onJson: () => void; onCsv: () => void; historical: boolean }) {
  const ready = session.status === "sealed";
  return <>
    <section className={styles.sectionTitle}><div><span>EXPLAINABLE RESULT FILES</span><h2>같은 근거를 세 형식으로</h2><p>모든 형식에 28건 상세 assertion, 600건 영역별 요약·hash, 생성 모델, 점수 경계, API 진단 분리를 유지합니다.</p></div></section>
    {!ready && <section className={styles.boundaryNote}><LockKeyhole /><div><strong>{historical ? "이전 버전의 미확정 기록" : "결과 확정 후 내보낼 수 있습니다"}</strong><p>{historical ? "미확정 상태를 유지한 원본 JSON·CSV를 내보냅니다. 현재 버전에서 과거 기록을 새로 확정하지 않습니다." : "저장형 자동평가를 실행하고 상단의 결과 확정을 눌러 주세요."}</p></div></section>}
    <section className={styles.exportGrid}>
      <button type="button" onClick={onJson} disabled={!ready && !historical}><FileJson /><strong>Canonical JSON</strong><span>상세 결과·600건 요약·provenance</span></button>
      <button type="button" onClick={onCsv} disabled={!ready && !historical}><FileSpreadsheet /><strong>UTF‑8 CSV</strong><span>상세 assertion·coverage suite·수식 주입 방어</span></button>
      <button type="button" onClick={() => window.print()} disabled={!ready}><Printer /><strong>PDF 보고서</strong><span>브라우저에서 PDF로 저장</span></button>
    </section>
  </>;
}

function PrintReport({ session }: { session: JudgeSession }) {
  return <article className={styles.printReport}>
    <header><span>BORA BRIDGE · AUTOMATED EVALUATION REPORT</span><h1>{session.title}</h1><p>비공식 내부 자동 제출 준비도 · 28건 상세 채점 + 600건 전수 회귀검사 · API 진단은 점수 미포함</p></header>
    <section className={styles.printFacts}><div><span>세션</span><strong>{session.id}</strong></div><div><span>상세 점수</span><strong>{session.summary.totalScore}/{session.summary.totalMaxScore}</strong></div><div><span>자동 게이트</span><strong>{session.summary.readinessGate}</strong></div><div><span>상세 데이터셋</span><strong>{session.datasetId}</strong></div><div><span>전수검사</span><strong>{session.coverageRun ? `${session.coverageRun.passedCases}/${session.coverageRun.totalCases}` : "미실행"}</strong></div><div><span>생성 모델</span><strong>{session.coverageRun?.provenance.model ?? session.automaticRun?.snapshot.authorship.model ?? "기록 없음"}</strong></div><div><span>Core SHA-256</span><strong>{session.artifactHashes?.coreDataset ?? session.datasetHash}</strong></div><div><span>Coverage manifest</span><strong>{session.coverageRun?.manifestSha256 ?? "기록 없음"}</strong></div><div><span>Coverage result</span><strong>{session.coverageRun?.resultSha256 ?? "기록 없음"}</strong></div><div><span>API snapshot SHA-256</span><strong>{session.artifactHashes?.apiSnapshots ?? "기록 없음"}</strong></div><div><span>Evidence SHA-256</span><strong>{session.artifactHashes?.evidenceManifest ?? "기록 없음"}</strong></div><div><span>재현 fingerprint</span><strong>FNV‑1a‑32 · {session.automaticRun?.resultDigest ?? "없음"}</strong></div><div><span>확정 시각</span><strong>{displayDate(session.sealedAt)}</strong></div></section>
    <h2>600건 전수 회귀검사 <small>각 영역 100건 · 추가 점수 0 · 게이트 반영</small></h2><table><thead><tr><th>영역</th><th>통과</th><th>Critical</th><th>판정</th></tr></thead><tbody>{session.coverageRun?.suiteSummaries.map((suite) => <tr key={suite.suite}><td>{coverageSuiteCopy[suite.suite] ?? suite.suite}</td><td>{suite.passed}/{suite.total} · 실패 {suite.failed} · 오류 {suite.errors}</td><td>{suite.criticalPassed}/{suite.criticalTotal}</td><td>{suite.gate}</td></tr>) ?? <tr><td colSpan={4}>전수검사 미실행</td></tr>}</tbody></table>
    {session.coverageRun && session.coverageRun.failureDetails.length > 0 && <><h2>전수검사 실패 증거</h2><table><thead><tr><th>ID / 영역</th><th>판정</th><th>실패 assertion</th><th>기대 / 실제</th></tr></thead><tbody>{session.coverageRun.failureDetails.map((failure) => <tr key={failure.id}><td>{failure.id}<br />{coverageSuiteCopy[failure.suite] ?? failure.suite}</td><td>{failure.status}</td><td>{failure.failedAssertionIds.join(" · ")}</td><td>{failure.expected}<br />{failure.actual}</td></tr>)}</tbody></table></>}
    <h2>자동 게이트</h2><table><thead><tr><th>항목</th><th>판정</th><th>근거</th></tr></thead><tbody>{session.definitions.safetyGates.map((gate) => <tr key={gate.id}><td>{gate.label}</td><td>{session.gateReviews[gate.id]?.status ?? "not-reviewed"}</td><td>{session.gateReviews[gate.id]?.note ?? "—"}</td></tr>)}</tbody></table>
    <h2>저장형 자동평가</h2><table><thead><tr><th>ID / 항목</th><th>판정</th><th>점수</th><th>기대 / 실제</th></tr></thead><tbody>{session.automaticRun?.cases.map((item) => <tr key={item.id}><td>{item.id}<br />{item.label}</td><td>{caseStatusCopy[item.status]}</td><td>{item.earnedScore}/{item.weight}</td><td>{item.expected}<br />{item.actual}</td></tr>)}</tbody></table>
    <h2>Assertion 부록</h2><table><thead><tr><th>케이스 / Assertion</th><th>연산</th><th>기대</th><th>실제</th><th>판정·근거</th></tr></thead><tbody>{session.automaticRun?.cases.flatMap((item) => item.assertions.map((assertion) => <tr key={`${item.id}:${assertion.id}`}><td>{item.id}<br />{assertion.label}</td><td>{assertion.operator}</td><td>{JSON.stringify(assertion.expected)}</td><td>{JSON.stringify(assertion.actual)}</td><td>{assertion.passed ? "통과" : "실패"}<br />{item.adapter} · {item.riskClass}<br />{item.evidence.join(" · ")}</td></tr>))}</tbody></table>
    <h2>API·운영 진단 <small>점수 미포함·공개 URL E2E 아님</small></h2><table><thead><tr><th>항목</th><th>방식·대상</th><th>기대</th><th>판정·관찰값</th></tr></thead><tbody>{session.diagnosticRun?.checks.map((item) => <tr key={item.id}><td>{item.label}</td><td>{item.kind}<br />{item.target}</td><td>{item.expected}</td><td>{item.status}<br />{item.actual}</td></tr>) ?? <tr><td colSpan={4}>진단 미실행</td></tr>}</tbody></table>
    <h2>한계와 검수 경계</h2><ul>{session.automaticRun?.snapshot.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
    <footer>상세 평가의 세 artifact SHA-256과 600건 corpus manifest/result SHA-256을 함께 고정했습니다. FNV‑1a‑32 값은 반복 비교용 비암호학적 fingerprint입니다. 완전한 외부 재현에는 동일 source commit과 lockfile도 필요합니다. GPT‑5.6 Sol 기반 Codex 에이전트는 합성 케이스 작성·코드 근거 검토를 지원했으며, 저장형 실행 중 모델·외부 API 호출은 0회입니다. 독립 금융·법률·보안 전문가 검수는 아직 수행하지 않았습니다.</footer>
  </article>;
}
