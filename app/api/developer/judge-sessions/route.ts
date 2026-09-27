import { GET as healthRouteHandler } from "@/app/api/health/route";
import { runPhishingDiagnosticRequest } from "@/app/api/phishing/route";
import { GET as publicDashboardRouteHandler } from "@/app/api/public-data/dashboard/route";
import { authenticatedUser } from "@/lib/auth/current-user";
import { isDeveloperUser } from "@/lib/auth/developer-access";
import { jsonNoStore, requireSameOrigin } from "@/lib/auth/http";
import { CHALLENGE_PAGE_MARKER, CHALLENGE_ROUTE_PATH } from "@/lib/challenge-contract";
import {
  JUDGE_ARTIFACT_HASHES,
  JUDGE_DATASET_HASH,
  JUDGE_DATASET_ID,
  JUDGE_DIAGNOSTIC_VERSION,
  JUDGE_HUMAN_RUBRIC,
  JUDGE_RUBRIC_VERSION,
  JUDGE_RUNNER_VERSION,
  JUDGE_SESSION_SCHEMA_VERSION,
  JUDGE_SAFETY_GATES,
  applyJudgeReviewUpdate,
  attachAutomaticRun,
  attachDiagnosticRun,
  canonicalJudgeRunDigest,
  createJudgeSession,
  diagnosticCounts,
  judgeCoreSnapshot,
  judgeDatasetMetadata,
  runOfflineJudgeCases,
  validJudgeCoverageRun,
  type JudgeAutomaticRun,
  type JudgeDiagnosticCheckResult,
  type JudgeDiagnosticRun,
  type JudgeDiagnosticStatus,
  type JudgeOperationalSnapshot,
  type JudgeSession,
  type JudgeSessionStatus,
} from "@/lib/judge-evaluation";
import {
  compactJudgeCoverageCorpusResult,
  runJudgeCoverageCorpusCases,
} from "@/lib/judge-coverage-corpus";
import {
  countJudgeSessions,
  countJudgeSessionsForDefinition,
  getJudgeSession,
  insertJudgeSession,
  listJudgeSessionsForDefinition,
  updateJudgeSession,
  type JudgeSessionCursor,
} from "@/lib/judge-session-store";
import { getPublicDashboard } from "@/lib/public-data/service";
import {
  environmentValue,
  runtimeAiProviderSettings,
  runtimeSecretStatuses,
} from "@/lib/runtime-settings";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 64 * 1024;
const SESSION_PAGE_SIZE = 30;

function parseSessionCursor(value: string | null): JudgeSessionCursor | null {
  if (!value) return null;
  const match = /^(\d{1,16})\.(judge_[0-9a-f-]{36})$/iu.exec(value);
  if (!match) throw new Error("judge_cursor_invalid");
  const createdAt = Number(match[1]);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error("judge_cursor_invalid");
  return { createdAt, id: match[2] };
}

function sessionCursor(session: JudgeSession) {
  const createdAt = Date.parse(session.createdAt);
  if (!Number.isSafeInteger(createdAt)) throw new Error("judge_cursor_invalid");
  return `${createdAt}.${session.id}`;
}

async function developer(request: Request) {
  const user = await authenticatedUser(request).catch(() => null);
  if (!user) return { error: jsonNoStore({ error: "authentication_required" }, 401) } as const;
  if (!(await isDeveloperUser(user))) {
    return { error: jsonNoStore({ error: "developer_access_denied" }, 403) } as const;
  }
  return { user } as const;
}

function isJsonRequest(request: Request) {
  return request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() === "application/json";
}

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new Error("judge_request_too_large");
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Error("judge_request_too_large");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error("judge_invalid_json");
  }
}

function safeSessionId(value: unknown) {
  return typeof value === "string" && /^judge_[0-9a-f-]{36}$/u.test(value) ? value : null;
}

function safeExpectedUpdatedAt(value: unknown) {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isSafeInteger(time) ? value : null;
}

function nextTimestamp(previous: string) {
  const minimum = Date.parse(previous) + 1;
  return new Date(Math.max(Date.now(), minimum));
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function operationalSnapshot(request: Request): Promise<JudgeOperationalSnapshot> {
  const [providersResult, servicesResult, dashboardResult, commitResult] = await Promise.allSettled([
    runtimeAiProviderSettings(),
    runtimeSecretStatuses(),
    getPublicDashboard(null),
    environmentValue("CF_PAGES_COMMIT_SHA"),
  ]);
  const providers = providersResult.status === "fulfilled" ? providersResult.value : [];
  const activeProvider = providers.find((provider) => provider.enabled) ?? null;
  const services = servicesResult.status === "fulfilled" ? servicesResult.value : null;
  const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
  const sourceCount = dashboard?.sources.length ?? 0;
  const liveSourceCount = dashboard?.sources.filter((source) => source.status === "live").length ?? 0;
  const itemCount = dashboard?.categories.reduce((total, category) => total + category.items.length, 0) ?? 0;

  return {
    capturedAt: new Date().toISOString(),
    origin: new URL(request.url).origin,
    appVersion: "0.7.0",
    buildCommit: commitResult.status === "fulfilled" && commitResult.value
      ? commitResult.value.slice(0, 64)
      : null,
    ai: activeProvider
      ? {
          provider: activeProvider.id,
          model: activeProvider.modelId,
          runtimeUsable: activeProvider.runtimeUsable !== false,
          issue: activeProvider.runtimeIssue ?? null,
        }
      : null,
    publicData: dashboard
      ? {
          status: dashboard.status,
          lastSuccessfulAt: dashboard.lastSuccessfulAt ?? null,
          sourceCount,
          liveSourceCount,
          itemCount,
        }
      : null,
    serviceIntegrations: services
      ? {
          configured: services.filter((service) => service.configured).length,
          enabled: services.filter((service) => service.enabled).length,
          runtimeUsable: services.filter((service) => service.runtimeUsable).length,
        }
      : null,
  };
}

async function timedDiagnostic(
  id: string,
  label: string,
  evidence: string[],
  metadata: Pick<JudgeDiagnosticCheckResult, "kind" | "target" | "expected" | "externalNetworkCalls">,
  execute: () => Promise<{ status: JudgeDiagnosticStatus; actual: string }>,
): Promise<JudgeDiagnosticCheckResult> {
  const startedAt = performance.now();
  try {
    const result = await execute();
    return {
      id,
      label,
      ...metadata,
      status: result.status,
      actual: result.actual.slice(0, 1_000),
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      evidence,
      errorCode: null,
    };
  } catch (error) {
    return {
      id,
      label,
      ...metadata,
      status: "error",
      actual: "진단 실행 중 오류가 발생했습니다.",
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      evidence,
      errorCode: error instanceof Error ? error.message.slice(0, 120) : "diagnostic_error",
    };
  }
}

async function runApiDiagnostics(request: Request, snapshot: JudgeOperationalSnapshot) {
  const origin = new URL(request.url).origin;
  const endpoint = (path: string) => new URL(path, origin);
  const checks: JudgeDiagnosticCheckResult[] = [];

  checks.push(await timedDiagnostic(
    "challenge-build",
    "심사 화면 빌드 계약",
    ["lib/challenge-contract.ts", "app/challenge/page.tsx"],
    { kind: "build-contract", target: "/challenge 상수 계약", expected: "route=/challenge 및 심사 marker 일치", externalNetworkCalls: 0 },
    async () => {
      const passed = CHALLENGE_ROUTE_PATH === "/challenge"
        && CHALLENGE_PAGE_MARKER === "2026 FINANCE AI CHALLENGE · JUDGE MODE";
      return { status: passed ? "pass" : "fail", actual: `${CHALLENGE_ROUTE_PATH} · ${CHALLENGE_PAGE_MARKER}` };
    },
  ));

  checks.push(await timedDiagnostic(
    "health-handler",
    "헬스 API 핸들러",
    ["app/api/health/route.ts"],
    { kind: "in-process-handler", target: "GET /api/health", expected: "HTTP 200 및 status=ok", externalNetworkCalls: 0 },
    async () => {
      const response = await healthRouteHandler(new Request(endpoint("/api/health"), { method: "GET" }));
      const body = recordValue(await response.json().catch(() => ({})));
      const passed = response.status === 200 && body.status === "ok";
      return { status: passed ? "pass" : "fail", actual: `HTTP ${response.status} · ${String(body.status ?? "unknown")}` };
    },
  ));

  checks.push(await timedDiagnostic(
    "public-data-handler",
    "공공데이터 API 핸들러",
    ["app/api/public-data/dashboard/route.ts"],
    { kind: "in-process-handler", target: "GET /api/public-data/dashboard?category=finance&pageSize=1", expected: "HTTP 200, live/partial, live 출처·항목 1개 이상, 168시간 이내", externalNetworkCalls: 0 },
    async () => {
      const response = await publicDashboardRouteHandler(new Request(endpoint("/api/public-data/dashboard?category=finance&pageSize=1"), { method: "GET" }));
      const body = recordValue(await response.json().catch(() => ({})));
      const sources = Array.isArray(body.sources) ? body.sources.map(recordValue) : [];
      const categories = Array.isArray(body.categories) ? body.categories.map(recordValue) : [];
      const itemCount = categories.reduce((sum, category) => sum + (Array.isArray(category.items) ? category.items.length : 0), 0);
      const liveCount = sources.filter((source) => source.status === "live").length;
      const lastSuccessfulAt = typeof body.lastSuccessfulAt === "string" ? Date.parse(body.lastSuccessfulAt) : Number.NaN;
      const ageHours = Number.isFinite(lastSuccessfulAt) ? Math.max(0, (Date.now() - lastSuccessfulAt) / 3_600_000) : Number.POSITIVE_INFINITY;
      const passed = response.status === 200
        && (body.status === "live" || body.status === "partial")
        && liveCount >= 1
        && itemCount >= 1
        && ageHours <= 168;
      return {
        status: passed ? "pass" : "fail",
        actual: `HTTP ${response.status} · ${String(body.status ?? "unknown")} · live 출처 ${liveCount} · 항목 ${itemCount} · ${Number.isFinite(ageHours) ? `${ageHours.toFixed(1)}시간` : "기준시각 없음"}`,
      };
    },
  ));

  checks.push(await timedDiagnostic(
    "phishing-endpoint",
    "피싱 API 요청·응답 경로",
    ["app/api/phishing/route.ts"],
    { kind: "in-process-handler", target: "POST /api/phishing 공통 처리 경로 · 공개 rate-limit 비부과", expected: "합성 고위험 문장에 HTTP 200 및 riskLevel=high", externalNetworkCalls: 0 },
    async () => {
      const response = await runPhishingDiagnosticRequest(new Request(endpoint("/api/phishing"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: JSON.stringify({
          locale: "en",
          text: "Bank security: urgent, act now. Transfer money to a safe account and send your OTP password. Do not tell anyone.",
        }),
      }));
      const body = recordValue(await response.json().catch(() => ({})));
      const passed = response.status === 200 && body.riskLevel === "high";
      return { status: passed ? "pass" : "fail", actual: `HTTP ${response.status} · ${String(body.riskLevel ?? body.error ?? "unknown")}` };
    },
  ));

  checks.push(await timedDiagnostic(
    "ai-runtime",
    "활성 AI 제공자 설정",
    ["lib/runtime-settings.ts", "app/api/ai/route.ts"],
    { kind: "runtime-snapshot", target: "AI 제공자·모델 설정", expected: "활성 provider/model 및 runtimeUsable=true", externalNetworkCalls: 0 },
    async () => {
      const ai = snapshot.ai;
      const passed = Boolean(ai?.provider && ai.model && ai.runtimeUsable);
      return {
        status: passed ? "pass" : "fail",
        actual: ai ? `${ai.provider} · ${ai.model} · ${ai.runtimeUsable ? "사용 가능" : ai.issue ?? "사용 불가"}` : "활성 제공자 없음",
      };
    },
  ));

  checks.push(await timedDiagnostic(
    "service-integrations",
    "공공 API 연동 준비 상태",
    ["lib/runtime-settings.ts"],
    { kind: "runtime-snapshot", target: "공공데이터 연동 설정", expected: "runtimeUsable 연동 1개 이상", externalNetworkCalls: 0 },
    async () => {
      const services = snapshot.serviceIntegrations;
      if (!services) return { status: "error", actual: "연동 상태를 읽지 못했습니다." };
      const status: JudgeDiagnosticStatus = services.runtimeUsable > 0 ? "pass" : services.configured > 0 ? "warn" : "fail";
      return { status, actual: `설정 ${services.configured} · 활성 ${services.enabled} · 사용 가능 ${services.runtimeUsable}` };
    },
  ));

  return checks;
}

function sessionResponse(session: JudgeSession) {
  return { saved: true, session };
}

export async function GET(request: Request) {
  const access = await developer(request);
  if ("error" in access) return access.error;
  try {
    const cursor = parseSessionCursor(new URL(request.url).searchParams.get("cursor"));
    const definition = {
      schemaVersion: JUDGE_SESSION_SCHEMA_VERSION,
      runnerVersion: JUDGE_RUNNER_VERSION,
      rubricVersion: JUDGE_RUBRIC_VERSION,
      datasetId: JUDGE_DATASET_ID,
      datasetHash: JUDGE_DATASET_HASH,
      artifactHashes: { ...JUDGE_ARTIFACT_HASHES },
    };
    const [page, totalSessionCount, currentSessionCount] = await Promise.all([
      listJudgeSessionsForDefinition(access.user.id, definition, SESSION_PAGE_SIZE + 1, cursor),
      countJudgeSessions(access.user.id),
      countJudgeSessionsForDefinition(access.user.id, definition),
    ]);
    const sessions = page.slice(0, SESSION_PAGE_SIZE);
    const hasMore = page.length > SESSION_PAGE_SIZE;
    return jsonNoStore({
      authorized: true,
      administrator: { displayName: access.user.displayName, provider: access.user.provider },
      rubric: JUDGE_HUMAN_RUBRIC,
      safetyGates: JUDGE_SAFETY_GATES,
      dataset: judgeDatasetMetadata(),
      legacySessionCount: Math.max(0, totalSessionCount - currentSessionCount),
      currentSessionCount,
      nextCursor: hasMore && sessions.length > 0 ? sessionCursor(sessions[sessions.length - 1]) : null,
      sessions,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "judge_sessions_unavailable";
    return jsonNoStore({ error: code }, code === "judge_cursor_invalid" ? 400 : 503);
  }
}

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return jsonNoStore({ error: "origin_mismatch" }, 403);
  if (!isJsonRequest(request)) return jsonNoStore({ error: "application_json_required" }, 415);
  const access = await developer(request);
  if ("error" in access) return access.error;

  try {
    const body = await boundedJson(request);
    if (body.action === "create") {
      const requestedTitle = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
      const title = requestedTitle || `자동평가 세션 ${new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}`;
      const session = createJudgeSession({
        id: `judge_${crypto.randomUUID()}`,
        title,
        reviewer: { displayName: "승인된 개발자", provider: access.user.provider },
      });
      await insertJudgeSession(access.user.id, session);
      return jsonNoStore(sessionResponse(session), 201);
    }

    if (body.action !== "run" && body.action !== "diagnostics") {
      return jsonNoStore({ error: "judge_action_invalid" }, 400);
    }
    const sessionId = safeSessionId(body.sessionId);
    const expectedUpdatedAt = safeExpectedUpdatedAt(body.expectedUpdatedAt);
    if (!sessionId || !expectedUpdatedAt) return jsonNoStore({ error: "judge_request_invalid" }, 400);
    const current = await getJudgeSession(access.user.id, sessionId);
    if (!current) return jsonNoStore({ error: "judge_session_not_found" }, 404);
    if (current.status === "sealed") return jsonNoStore({ error: "judge_session_sealed" }, 409);
    if (current.updatedAt !== expectedUpdatedAt) return jsonNoStore({ error: "judge_session_conflict" }, 409);
    if (current.schemaVersion !== JUDGE_SESSION_SCHEMA_VERSION
      || current.runnerVersion !== JUDGE_RUNNER_VERSION
      || current.rubricVersion !== JUDGE_RUBRIC_VERSION
      || current.datasetId !== JUDGE_DATASET_ID
      || current.datasetHash !== JUDGE_DATASET_HASH
      || current.artifactHashes?.coreDataset !== JUDGE_ARTIFACT_HASHES.coreDataset
      || current.artifactHashes?.apiSnapshots !== JUDGE_ARTIFACT_HASHES.apiSnapshots
      || current.artifactHashes?.evidenceManifest !== JUDGE_ARTIFACT_HASHES.evidenceManifest
      || (current.coverageRun !== null && !validJudgeCoverageRun(current.coverageRun))) {
      return jsonNoStore({ error: "judge_session_version_mismatch" }, 409);
    }

    const startedAt = nextTimestamp(current.updatedAt);
    let updated: JudgeSession;
    if (body.action === "run") {
      if (current.automaticRun || current.coverageRun) return jsonNoStore({ error: "judge_core_run_already_exists" }, 409);
      const cases = runOfflineJudgeCases();
      const coverageRun = await compactJudgeCoverageCorpusResult(runJudgeCoverageCorpusCases());
      const completedAt = nextTimestamp(startedAt.toISOString());
      const run: JudgeAutomaticRun = {
        id: crypto.randomUUID(),
        runnerVersion: current.runnerVersion,
        datasetId: current.datasetId,
        datasetHash: current.datasetHash,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        resultDigest: canonicalJudgeRunDigest(cases),
        cases,
        snapshot: judgeCoreSnapshot(),
      };
      updated = await attachAutomaticRun(current, run, coverageRun, completedAt);
    } else {
      if (current.diagnosticRun) return jsonNoStore({ error: "judge_diagnostic_run_already_exists" }, 409);
      const snapshot = await operationalSnapshot(request);
      const checks = await runApiDiagnostics(request, snapshot);
      const completedAt = nextTimestamp(startedAt.toISOString());
      const run: JudgeDiagnosticRun = {
        id: crypto.randomUUID(),
        version: JUDGE_DIAGNOSTIC_VERSION,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        checks,
        counts: diagnosticCounts(checks),
        snapshot,
      };
      updated = attachDiagnosticRun(current, run, completedAt);
    }
    if (!(await updateJudgeSession(access.user.id, updated, expectedUpdatedAt))) {
      return jsonNoStore({ error: "judge_session_conflict" }, 409);
    }
    return jsonNoStore(sessionResponse(updated));
  } catch (error) {
    const code = error instanceof Error ? error.message : "judge_session_operation_failed";
    const status = code === "judge_request_too_large" || code === "judge_session_too_large"
      ? 413
      : code === "judge_invalid_json" || code === "judge_request_invalid"
        ? 400
        : code === "judge_session_version_mismatch"
          || code === "judge_core_run_already_exists"
          || code === "judge_diagnostic_run_already_exists"
          || code === "judge_session_sealed"
          ? 409
          : 503;
    return jsonNoStore({ error: code }, status);
  }
}

export async function PUT(request: Request) {
  if (!(await requireSameOrigin(request))) return jsonNoStore({ error: "origin_mismatch" }, 403);
  if (!isJsonRequest(request)) return jsonNoStore({ error: "application_json_required" }, 415);
  const access = await developer(request);
  if ("error" in access) return access.error;

  try {
    const body = await boundedJson(request);
    const sessionId = safeSessionId(body.sessionId);
    const expectedUpdatedAt = safeExpectedUpdatedAt(body.expectedUpdatedAt);
    if (!sessionId || !expectedUpdatedAt) return jsonNoStore({ error: "judge_request_invalid" }, 400);
    const current = await getJudgeSession(access.user.id, sessionId);
    if (!current) return jsonNoStore({ error: "judge_session_not_found" }, 404);
    if (current.updatedAt !== expectedUpdatedAt) return jsonNoStore({ error: "judge_session_conflict" }, 409);
    if (current.schemaVersion !== JUDGE_SESSION_SCHEMA_VERSION
      || current.runnerVersion !== JUDGE_RUNNER_VERSION
      || current.rubricVersion !== JUDGE_RUBRIC_VERSION
      || current.datasetId !== JUDGE_DATASET_ID
      || current.datasetHash !== JUDGE_DATASET_HASH
      || current.artifactHashes?.coreDataset !== JUDGE_ARTIFACT_HASHES.coreDataset
      || current.artifactHashes?.apiSnapshots !== JUDGE_ARTIFACT_HASHES.apiSnapshots
      || current.artifactHashes?.evidenceManifest !== JUDGE_ARTIFACT_HASHES.evidenceManifest
      || (current.coverageRun !== null && !validJudgeCoverageRun(current.coverageRun))) {
      return jsonNoStore({ error: "judge_session_version_mismatch" }, 409);
    }
    const requestedStatus: JudgeSessionStatus = body.status === "sealed"
      ? "sealed"
      : current.automaticRun
        ? "review"
        : "draft";
    const updated = applyJudgeReviewUpdate(current, {
      title: body.title,
      reviewerNotes: body.reviewerNotes,
    }, requestedStatus, nextTimestamp(current.updatedAt));
    if (!(await updateJudgeSession(access.user.id, updated, expectedUpdatedAt))) {
      return jsonNoStore({ error: "judge_session_conflict" }, 409);
    }
    return jsonNoStore(sessionResponse(updated));
  } catch (error) {
    const code = error instanceof Error ? error.message : "judge_session_save_failed";
    const status = code === "judge_request_too_large" || code === "judge_session_too_large"
      ? 413
      : code === "judge_invalid_json" || code === "judge_request_invalid"
        ? 400
        : code === "judge_session_sealed" || code === "judge_automatic_run_required" || code === "judge_session_version_mismatch"
          ? 409
          : 503;
    return jsonNoStore({ error: code }, status);
  }
}
