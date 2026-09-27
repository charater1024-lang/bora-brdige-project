"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  ExternalLink,
  KeyRound,
  Power,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import styles from "./developer.module.css";

type Health = {
  auth?: {
    ready?: boolean;
    storage?: string;
    providers?: Record<string, { available?: boolean }>;
  };
};

type ServiceSetting = {
  key: string;
  label: string;
  category: string;
  description: string;
  configured: boolean;
  source: "developer" | "environment" | "none";
  masked: string | null;
  updatedAt: string | null;
  disabledByPolicy: boolean;
  billingRisk: boolean;
  adapterReady: boolean;
  integrationSurface: string;
  credentialRequired: boolean;
  activationManaged: boolean;
  enabled: boolean;
  requestedEnabled: boolean;
  /** Present on newer backends after the stored secret has been decrypted. */
  runtimeUsable?: boolean;
  /** Safe diagnostic only. The secret itself is never returned to the browser. */
  runtimeIssue?: string | null;
};

type AiProviderSetting = {
  id: "openai" | "gemini" | "claude" | "local";
  keyName: string;
  label: string;
  billingRisk: boolean;
  enabled: boolean;
  requestedEnabled: boolean;
  globallyDisabled: boolean;
  modelId: string;
  defaultModel: string;
  configured: boolean;
  endpointConfigured?: boolean;
  updatedAt: string | null;
  models: Array<{ id: string; label: string; hint: string }>;
  runtimeUsable?: boolean;
  runtimeIssue?: string | null;
};

type ProviderDraft = { enabled: boolean; modelId: string };

type PublicDataAdminView = {
  status?: string;
  lastSuccessfulAt?: string | null;
  canRefresh?: boolean;
  refreshInSeconds?: number;
  refreshResult?: string;
  sources?: Array<{
    id: string;
    label: string;
    status: "live" | "partial" | "truncated" | "not-configured" | "authorization-pending" | "unavailable";
    itemCount: number;
    sourceUrl: string;
    errorCode?: string | null;
    providerTotalCount?: number | null;
    fetchedCount?: number;
    completeness?: "complete" | "partial" | "truncated";
  }>;
  sourceSchedules?: Array<{
    sourceId: string;
    serviceKey: string | null;
    nextDueAt: string | null;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    dailyLimit: number;
    usedCalls: number;
    reservedCalls: number;
    quotaVerified: boolean;
    quotaBasis: "official" | "user-confirmed" | "conservative-default";
    refreshInSeconds: number;
    canRefresh: boolean;
    lastError: string | null;
  }>;
};

type ExplanationCacheAdminView = {
  currentRuntime?: { provider: string; model: string } | null;
  entryCount?: number;
  currentRuntimeEntryCount?: number;
  generatingCount?: number;
  hitCount?: number;
  lastGeneratedAt?: string | null;
  lastClearedAt?: string | null;
  models?: Array<{ provider: string; model: string; entryCount: number }>;
  error?: string;
};

type PublicSourceView = NonNullable<PublicDataAdminView["sources"]>[number];

type SettingsResponse = {
  authorized?: boolean;
  administrator?: { displayName?: string; provider?: string };
  storageReady?: boolean;
  billableApisDisabled?: boolean;
  aiProviders?: AiProviderSetting[];
  localRuntime?: {
    state?: string;
    selectedModel?: string;
    loadedModel?: string | null;
    resolvedRepository?: string | null;
    fallbackReason?: string | null;
  } | null;
  services?: ServiceSetting[];
  error?: string;
};

const loginProviders = [
  {
    id: "naver",
    name: "네이버",
    callbackPath: "/api/auth/callback/naver",
    consoleUrl: "https://developers.naver.com/apps/#/myapps/pZenAPnNGnZQSprNV6fn/member",
  },
  {
    id: "kakao",
    name: "카카오",
    callbackPath: "/api/auth/callback/kakao",
    consoleUrl: "https://developers.kakao.com/console/app/1520106/team",
  },
] as const;

function publicSourceErrorMessage(code: string | null) {
  if (!code) return null;
  if (code === "manual-budget-exhausted" || code === "automatic-budget-exhausted") {
    return "내부 일일 보호 한도에 도달해 다음 할당량까지 대기합니다.";
  }
  if (code === "reservation-conflict") return "다른 갱신 작업을 정리한 뒤 다시 시도합니다.";
  if (code === "stale-reservation-recovered") return "중단된 요청 예약을 안전하게 정리했습니다.";
  if (code === "snapshot_persistence_failed") return "수집 결과 저장에 실패해 기존 정상 데이터를 유지합니다.";
  if (code.includes("authorization") || code.includes("forbidden")) {
    return "제공기관의 키 또는 이용 승인을 확인해 주세요.";
  }
  if (code.includes("quota") || code.includes("rate")) {
    return "제공기관 호출 한도 때문에 재시도를 보호하고 있습니다.";
  }
  if (code.includes("network") || code.includes("timeout")) {
    return "제공기관 연결에 실패했습니다. 보호된 일정에 따라 다시 시도합니다.";
  }
  if (code.includes("credential") || code.includes("decrypt") || code.includes("unreadable")) {
    return "저장된 인증 정보를 런타임에서 사용할 수 없습니다. 키를 다시 입력한 뒤 ON으로 적용해 주세요.";
  }
  if (code === "not-configured") return "이전 키 미설정 기록입니다. 현재 스위치 상태를 우선 적용합니다.";
  return "최근 갱신을 완료하지 못했습니다. 기존 정상 데이터는 유지됩니다.";
}

function publicSourceWarningMessage(code: string | null) {
  if (code?.includes("backfill_in_progress")) {
    return "최신 정보는 먼저 반영했고, 남은 페이지는 호출 한도를 지키며 다음 예약에서 이어서 저장합니다.";
  }
  if (code?.includes("seoul_secure_file_import_required")) {
    return "안전한 HTTPS 파일 가져오기가 필요한 출처입니다. 저장된 기존 상권 데이터는 계속 제공합니다.";
  }
  if (code?.includes("truncated")) {
    return "제공기관 또는 사이트 보호 한도까지 정상 수집했습니다. 전체 제공 건수보다 적을 수 있습니다.";
  }
  return "사용 가능한 항목은 정상 저장했지만 일부 페이지 또는 항목은 이번 수집에서 제외됐습니다.";
}

function isSuccessfulSourceWarning(source: PublicSourceView | null, code: string | null) {
  return source?.status === "partial"
    || source?.status === "truncated"
    || Boolean(code?.startsWith("warning_"));
}

function runtimeCredentialState(setting: Pick<ServiceSetting, "configured" | "runtimeUsable" | "runtimeIssue">) {
  const hasStoredIssue = Boolean(setting.runtimeIssue);
  const unreadable = setting.configured && (
    setting.runtimeUsable === false
    || (setting.runtimeUsable === undefined && hasStoredIssue)
  );
  return {
    unreadable,
    fallbackActive: setting.runtimeUsable === true && hasStoredIssue,
  };
}

function publicCollectionStatus(source: PublicSourceView | null) {
  if (!source) return { label: "수집 기록 없음", state: "idle" };
  if (source.errorCode?.includes("backfill_in_progress")) {
    return { label: "초기 전체 수집 중", state: "active" };
  }
  if (source.status === "live") return { label: "정상 수집", state: "ready" };
  if (source.status === "partial") return { label: "일부 수집", state: "protected" };
  if (source.status === "truncated") return { label: "수집 성공 · 안전 상한", state: "protected" };
  if (source.status === "not-configured") return { label: "키 미설정", state: "inactive" };
  if (source.status === "authorization-pending") return { label: "이용 승인 확인", state: "error" };
  return { label: "수집 실패", state: "error" };
}

function publicCompletenessLabel(source: PublicSourceView | null) {
  if (!source) return "기록 없음";
  const fetched = source.fetchedCount ?? source.itemCount;
  if (typeof source.providerTotalCount === "number") {
    const percentage = source.providerTotalCount > 0
      ? Math.min(100, Math.round((fetched / source.providerTotalCount) * 100))
      : 100;
    return `${fetched.toLocaleString("ko-KR")} / ${source.providerTotalCount.toLocaleString("ko-KR")}건 (${percentage}%)`;
  }
  if (source.completeness === "partial") return `${fetched.toLocaleString("ko-KR")}건 · 일부 수집`;
  if (source.completeness === "truncated") return `${fetched.toLocaleString("ko-KR")}건 · 보호 한도까지`;
  if (source.completeness === "complete") return `${fetched.toLocaleString("ko-KR")}건 · 전체 수집`;
  return `${source.itemCount.toLocaleString("ko-KR")}건`;
}

function durationLabel(totalSeconds: number) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  if (seconds < 60) return `${seconds}초`;
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.ceil((seconds % 3_600) / 60);
  if (hours === 0) return `${minutes}분`;
  return minutes === 0 ? `${hours}시간` : `${hours}시간 ${minutes}분`;
}

function publicSourceState(
  schedule: NonNullable<PublicDataAdminView["sourceSchedules"]>[number],
  service: ServiceSetting | null,
) {
  if (schedule.serviceKey && !service) {
    return { label: "설정 확인 중", state: "idle", detail: "API 스위치 상태를 불러오고 있습니다." };
  }
  if (service && !service.configured) {
    return { label: "키 필요", state: "inactive", detail: "키가 없어 외부 호출을 만들지 않습니다." };
  }
  if (service && runtimeCredentialState(service).unreadable) {
    return { label: "키 다시 입력", state: "error", detail: "저장 기록은 있지만 서버에서 해독할 수 없어 외부 호출을 만들지 않습니다." };
  }
  if (service && !service.enabled) {
    return { label: "사용 OFF", state: "inactive", detail: "OFF 상태에서는 외부 호출이 없습니다." };
  }
  if (schedule.lastError === "not-configured") {
    return { label: "갱신 대기", state: "ready", detail: "이전 키 미설정 기록은 다음 보호 갱신에서 정리됩니다." };
  }
  if (schedule.lastError?.startsWith("warning_")) {
    const backfillInProgress = schedule.lastError.includes("backfill_in_progress");
    return {
      label: backfillInProgress ? "초기 전체 수집 중" : "일부 수집 완료",
      state: backfillInProgress ? "active" : "protected",
      detail: publicSourceWarningMessage(schedule.lastError),
    };
  }
  const error = publicSourceErrorMessage(schedule.lastError);
  if (schedule.lastError === "manual-budget-exhausted"
    || schedule.lastError === "automatic-budget-exhausted"
    || schedule.lastError === "reservation-conflict") {
    return { label: "호출 보호 중", state: "protected", detail: error! };
  }
  if (error) return { label: "점검 필요", state: "error", detail: error };
  if (schedule.reservedCalls > 0) {
    return { label: "갱신 중", state: "active", detail: "예약된 호출을 처리하고 있습니다." };
  }
  if (schedule.canRefresh) {
    return { label: "갱신 가능", state: "ready", detail: "인증된 개발자 요청으로 지금 갱신할 수 있습니다." };
  }
  if (schedule.refreshInSeconds === 0) {
    return { label: "갱신 대기", state: "ready", detail: "보호된 수집 순서를 기다리고 있습니다." };
  }
  return { label: "보호 중", state: "protected", detail: "예정 시각 전에는 외부 호출을 만들지 않습니다." };
}

export default function DeveloperPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [publicData, setPublicData] = useState<PublicDataAdminView | null>(null);
  const [explanationCache, setExplanationCache] = useState<ExplanationCacheAdminView | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [providerDrafts, setProviderDrafts] = useState<Partial<Record<AiProviderSetting["id"], ProviderDraft>>>({});
  const [serviceDrafts, setServiceDrafts] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState("");
  const [publicRefreshPending, setPublicRefreshPending] = useState(false);
  const [publicRefreshNotice, setPublicRefreshNotice] = useState("");
  const [publicRefreshCooldown, setPublicRefreshCooldown] = useState(0);
  const [currentOrigin, setCurrentOrigin] = useState("");

  const refresh = useCallback(async () => {
    const loadJson = async <T,>(url: string) => {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      return await response.json() as T;
    };
    const [healthResult, settingsResult, publicDataResult, explanationCacheResult] = await Promise.allSettled([
      loadJson<Health>("/api/health"),
      loadJson<SettingsResponse>("/api/developer/settings"),
      loadJson<PublicDataAdminView>("/api/public-data/dashboard"),
      loadJson<ExplanationCacheAdminView>("/api/developer/explanation-cache"),
    ]);
    if (healthResult.status === "fulfilled") setHealth(healthResult.value);
    if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
    else setSettings((current) => current ?? { error: "developer_settings_unavailable" });
    if (publicDataResult.status === "fulfilled") {
      setPublicData(publicDataResult.value);
      setPublicRefreshCooldown(publicDataResult.value.canRefresh
        ? 0
        : Math.max(0, publicDataResult.value.refreshInSeconds ?? 0));
    }
    if (explanationCacheResult.status === "fulfilled") setExplanationCache(explanationCacheResult.value);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCurrentOrigin(window.location.origin);
      refresh().catch(() => setSettings({ error: "developer_settings_unavailable" }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (publicRefreshCooldown <= 0) return;
    const timer = window.setTimeout(() => {
      setPublicRefreshCooldown((current) => Math.max(0, current - 1));
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [publicRefreshCooldown]);

  const groupedServices = useMemo(() => {
    const groups = new Map<string, ServiceSetting[]>();
    for (const service of settings?.services ?? []) {
      groups.set(service.category, [...(groups.get(service.category) ?? []), service]);
    }
    return [...groups.entries()];
  }, [settings?.services]);

  const managedServices = useMemo(
    () => (settings?.services ?? []).filter((service) => service.activationManaged),
    [settings?.services],
  );
  const serviceByKey = useMemo(
    () => new Map((settings?.services ?? []).map((service) => [service.key, service])),
    [settings?.services],
  );
  const sourceById = useMemo(
    () => new Map((publicData?.sources ?? []).map((source) => [source.id, source])),
    [publicData?.sources],
  );

  function serviceDraft(service: ServiceSetting) {
    return serviceDrafts[service.key] ?? service.enabled;
  }

  async function refreshPublicData() {
    setPublicRefreshPending(true);
    setPublicRefreshNotice("");
    try {
      const response = await fetch("/api/public-data/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const result = await response.json() as PublicDataAdminView & { error?: string };
      const retryAfter = Number(response.headers.get("Retry-After"));
      const cooldown = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.ceil(retryAfter)
        : Math.max(0, result.refreshInSeconds ?? 0);

      if (response.status === 401) throw new Error("authentication_required");
      if (response.status === 429) {
        setPublicData(result);
        setPublicRefreshCooldown(cooldown);
        setPublicRefreshNotice(`호출 한도를 보호하고 있습니다. ${durationLabel(cooldown)} 후 다시 갱신할 수 있습니다.`);
        return;
      }
      if (!response.ok) throw new Error(result.error ?? "public_data_refresh_failed");

      setPublicData(result);
      setPublicRefreshCooldown(result.canRefresh
        ? 0
        : Math.max(0, result.refreshInSeconds ?? 0));
      setPublicRefreshNotice(result.refreshResult === "unavailable"
        ? "일부 제공기관의 응답을 받지 못했습니다. 아래 출처별 오류를 확인해 주세요."
        : "무료 공용 API 갱신을 마쳤습니다. 저장된 수집 결과와 출처별 상태를 최신 값으로 반영했습니다.");
    } catch (error) {
      const code = error instanceof Error ? error.message : "public_data_refresh_failed";
      setPublicRefreshNotice(code === "authentication_required"
        ? "로그인 세션이 만료되었습니다. 다시 로그인한 뒤 시도해 주세요."
        : "무료 공용데이터 운영 갱신에 실패했습니다. 서버 연결과 아래 출처별 상태를 확인해 주세요.");
    } finally {
      setPublicRefreshPending(false);
    }
  }

  async function saveService(service: ServiceSetting) {
    const value = values[service.key]?.trim() ?? "";
    const enabled = serviceDraft(service);
    setPendingKey(service.key);
    setNotice("");
    try {
      const response = await fetch("/api/developer/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "service_api",
          key: service.key,
          enabled,
          ...(value ? { value } : {}),
        }),
      });
      const result = await response.json() as {
        error?: string;
        sourceSynchronization?: "applied" | "pending";
      };
      if (!response.ok) throw new Error(result.error ?? "save_failed");
      setValues((current) => ({ ...current, [service.key]: "" }));
      setServiceDrafts((current) => {
        const next = { ...current };
        delete next[service.key];
        return next;
      });
      setNotice(result.sourceSynchronization === "pending"
        ? `${service.label} 설정은 저장했습니다. 수집 일정 동기화는 일시 지연되어 다음 진단 갱신에서 다시 확인합니다.`
        : enabled
          ? `${service.label}을 ON으로 저장했습니다. 이후 서비스 요청부터 실제 연동에 사용됩니다.`
          : `${service.label}을 OFF로 저장했습니다. 키는 보관되지만 서비스에서 사용하지 않습니다.`);
      await refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "save_failed";
      setNotice(code === "service_key_required"
        ? "ON으로 적용하려면 먼저 해당 API 키를 입력하거나 저장해 주세요."
        : code === "service_key_unreadable" || code === "service_key_unusable"
        ? "저장 기록은 있지만 서버에서 키를 해독할 수 없습니다. 새 API 키를 다시 입력한 뒤 ON으로 적용해 주세요."
        : code === "service_adapter_not_ready"
        ? "이 키는 안전하게 보관할 수 있지만, 실행 어댑터가 준비될 때까지 ON으로 전환할 수 없습니다."
        : code === "settings_encryption_unavailable"
        ? "보안 저장소 마스터 키가 준비되지 않았습니다. 서버 환경 설정을 확인해 주세요."
        : "API 키를 저장하지 못했습니다.");
    } finally {
      setPendingKey(null);
    }
  }

  async function saveAllServices(enabled: boolean) {
    const message = enabled
      ? "사용 가능한 공개 데이터 연동을 모두 ON으로 적용할까요? API 키가 필요한 출처는 키가 등록된 경우에만 켜지고, 서울 공식 파일처럼 키가 필요 없는 출처도 함께 켜집니다."
      : "금융·정책·보안 공개 데이터 연동을 모두 OFF로 적용할까요? 저장된 키와 이미 수집한 데이터는 삭제되지 않습니다.";
    if (!window.confirm(message)) return;
    setPendingKey("service_api_bulk");
    setNotice("");
    try {
      const response = await fetch("/api/developer/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "service_api_bulk", enabled }),
      });
      const result = await response.json() as {
        error?: string;
        enabledCount?: number;
        sourceSynchronization?: "applied" | "pending";
      };
      if (!response.ok) throw new Error(result.error ?? "save_failed");
      setServiceDrafts({});
      setNotice(result.sourceSynchronization === "pending"
        ? "공개 API 설정은 저장했습니다. 수집 일정 동기화는 일시 지연되어 다음 진단 갱신에서 다시 확인합니다."
        : enabled
          ? `사용 가능한 공개 데이터 연동 ${result.enabledCount ?? 0}개를 모두 ON으로 적용했습니다.`
          : "공개 데이터 연동을 모두 OFF로 적용했습니다. 저장된 키와 수집 데이터는 그대로 보관됩니다.");
      await refresh();
    } catch {
      setNotice("공개 API 일괄 상태를 저장하지 못했습니다.");
    } finally {
      setPendingKey(null);
    }
  }

  function providerDraft(provider: AiProviderSetting): ProviderDraft {
    return providerDrafts[provider.id] ?? { enabled: provider.enabled, modelId: provider.modelId };
  }

  function toggleProvider(provider: AiProviderSetting) {
    const current = providerDraft(provider);
    const nextEnabled = !current.enabled;
    if (nextEnabled && provider.billingRisk && !window.confirm(`${provider.label} API를 켜면 선택한 모델의 사용량에 따라 실제 요금이 청구될 수 있습니다. 다른 AI는 자동으로 꺼집니다. 사용 설정을 준비할까요?`)) return;
    setProviderDrafts((drafts) => {
      const next = { ...drafts };
      if (nextEnabled) {
        for (const candidate of settings?.aiProviders ?? []) {
          const candidateDraft = next[candidate.id] ?? { enabled: candidate.enabled, modelId: candidate.modelId };
          next[candidate.id] = { ...candidateDraft, enabled: false };
        }
      }
      next[provider.id] = { ...current, enabled: nextEnabled };
      return next;
    });
  }

  async function saveProvider(provider: AiProviderSetting) {
    const draft = providerDraft(provider);
    const value = values[provider.keyName]?.trim() ?? "";
    setPendingKey(provider.keyName);
    setNotice("");
    try {
      const response = await fetch("/api/developer/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ai_provider",
          provider: provider.id,
          enabled: draft.enabled,
          modelId: draft.modelId,
          ...(value ? { value } : {}),
        }),
      });
      const result = await response.json() as {
        error?: string;
        localActivation?: { state?: string; resolvedRepository?: string | null; fallbackReason?: string | null } | null;
      };
      if (!response.ok) throw new Error(result.error ?? "save_failed");
      setValues((current) => ({ ...current, [provider.keyName]: "" }));
      setProviderDrafts((current) => {
        const next = { ...current };
        delete next[provider.id];
        return next;
      });
      setNotice(draft.enabled
        ? provider.billingRisk
          ? `${provider.label}만 사용하도록 설정했습니다. 이후 AI 요청부터 과금될 수 있습니다.`
          : `${provider.label} 모델 전환을 요청했습니다. Ollama가 기존 모델을 내리고 선택한 Q4 모델 하나만 준비합니다. 최초 선택 시 무료 모델 다운로드가 먼저 진행됩니다.`
        : `${provider.label}의 키와 모델을 저장했습니다. 사용은 OFF 상태라 API를 호출하지 않습니다.`);
      await refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "save_failed";
      setNotice(code === "provider_key_required"
          ? "사용을 켜려면 먼저 해당 제공사의 API 키를 함께 입력하거나 저장해 주세요."
        : code === "provider_key_unreadable" || code === "provider_key_unusable"
          ? "저장 기록은 있지만 서버에서 AI 제공사 키를 해독할 수 없습니다. 새 키를 다시 입력해 주세요."
        : code === "local_endpoint_required"
          ? "Local AI를 켜려면 서버에 LOCAL_LLM_BASE_URL을 먼저 설정해 주세요."
        : code === "local_admin_token_required"
          ? "Local AI 모델 제어용 관리자 토큰이 서버에 설정되지 않았습니다."
        : code === "local_model_control_unavailable" || code === "local_model_activation_failed"
          ? "Local AI 서버에 모델 전환을 요청하지 못했습니다. 로컬 추론 서비스를 확인해 주세요."
        : code === "billable_api_globally_disabled"
          ? "서버의 긴급 과금 차단이 켜져 있어 사용을 활성화할 수 없습니다."
          : code === "settings_encryption_unavailable"
            ? "보안 저장소 마스터 키가 준비되지 않았습니다."
            : "AI 제공사 설정을 저장하지 못했습니다.");
    } finally {
      setPendingKey(null);
    }
  }

  async function deleteKey(key: string) {
    if (!window.confirm("개발자 모드에서 저장한 이 API 키를 삭제할까요? 환경 변수 값은 변경되지 않습니다.")) return;
    setPendingKey(key);
    setNotice("");
    try {
      const response = await fetch("/api/developer/settings", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      const result = await response.json() as {
        error?: string;
        sourceSynchronization?: "applied" | "pending";
      };
      if (!response.ok) throw new Error("delete_failed");
      setNotice(result.sourceSynchronization === "pending"
        ? "API 키는 삭제했습니다. 수집 일정 동기화는 일시 지연되어 다음 진단 갱신에서 다시 확인합니다."
        : "개발자 모드에 저장된 API 키를 삭제했습니다.");
      await refresh();
    } catch {
      setNotice("API 키를 삭제하지 못했습니다.");
    } finally {
      setPendingKey(null);
    }
  }

  async function clearExplanationCache() {
    if (!window.confirm("저장된 공공정보 AI 설명을 모두 초기화할까요? API 키, 원본 공공데이터, AI 상담 기록과 기억은 삭제되지 않습니다. 무료·로컬 AI는 다음 열람 때 다시 생성할 수 있고, 유료 AI는 항목별 1회 승인이 다시 필요합니다.")) return;
    setPendingKey("explanation_cache");
    setNotice("");
    try {
      const response = await fetch("/api/developer/explanation-cache", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "public-item-explanations" }),
      });
      const result = await response.json() as { error?: string; deletedCount?: number };
      if (!response.ok) throw new Error(result.error ?? "explanation_cache_reset_failed");
      setNotice(`저장된 공공정보 AI 설명 ${result.deletedCount ?? 0}건을 초기화했습니다. 원본 데이터와 상담 기록은 유지됩니다.`);
      await refresh();
    } catch {
      setNotice("AI 설명 저장소를 초기화하지 못했습니다.");
    } finally {
      setPendingKey(null);
    }
  }

  if (settings?.error === "authentication_required") {
    return <AccessMessage title="로그인이 필요합니다" body="승인된 개발자 계정으로 로그인한 뒤 개발자 모드를 다시 열어 주세요." />;
  }
  if (settings?.error === "developer_access_denied") {
    return <AccessMessage title="접근 권한이 없습니다" body="개발자 모드는 서버에 등록된 불변 소셜 계정에만 허용됩니다." />;
  }

  return (
    <main id="developer-main" className={styles.shell} tabIndex={-1}>
      <a className="skip-link" href="#developer-content">본문으로 바로가기</a>
      <header className={styles.header}>
        <Link href="/"><ArrowLeft size={18} />홈으로</Link>
        <span>BORA Bridge · DEVELOPER MODE</span>
        <Link href="/mypage"><Users size={17} />마이페이지</Link>
      </header>

      <section id="developer-content" className={styles.hero} tabIndex={-1}>
        <span>SECURE INTEGRATION CONSOLE</span>
        <h1>서비스 API 키 관리</h1>
        <p>승인된 개발자 계정만 접근할 수 있습니다. OpenAI·Gemini·Claude·Local AI 중 하나만 사용할 수 있으며, 새 AI를 켜면 기존 AI는 자동으로 꺼집니다. 기본값은 모두 OFF입니다.</p>
      </section>

      <section className={styles.productNav} aria-label="개발자 도구">
        <div>
          <span><ClipboardCheck size={20} /></span>
          <div>
            <small>AUTOMATED EVALUATION · SEPARATE PAGE</small>
            <strong>이 화면에서는 평가를 실행하지 않습니다</strong>
            <p>독립 자동평가 센터에서 저장형 100점 평가와 별도 API 진단을 실행하고 JSON·CSV·PDF 보고서를 만듭니다.</p>
          </div>
        </div>
        <Link href="/developer/evaluation">자동평가 센터 열기<ExternalLink size={16} /></Link>
      </section>

      <section className={styles.health} aria-live="polite">
        <div>
          <span className={settings?.storageReady ? styles.ok : styles.warn}>{settings?.storageReady ? <CheckCircle2 size={22} /> : <ShieldAlert size={22} />}</span>
          <div>
            <strong>{settings?.storageReady ? "암호화 API 키 저장소 준비 완료" : settings ? "보안 저장소 점검 필요" : "권한과 저장소 확인 중"}</strong>
            <small>관리자: {settings?.administrator?.displayName ?? "확인 중"} · 로그인 세션: {health?.auth?.storage ?? "확인 중"} · 긴급 과금 차단: {settings?.billableApisDisabled ? "ON" : "OFF"}</small>
          </div>
        </div>
        <button type="button" onClick={() => refresh().catch(() => undefined)}><RefreshCw size={16} />새로고침</button>
      </section>

      {notice && <p className={styles.notice} role="status">{notice}</p>}

      <section className={styles.summary} aria-label="API 연동 요약">
        <div><Database size={20} /><span>등록된 연동</span><strong>{settings?.services?.filter((service) => service.configured).length ?? 0}</strong></div>
        <div><KeyRound size={20} /><span>등록 가능한 키</span><strong>{settings?.services?.length ?? 0}</strong></div>
        <div><CircleDollarSign size={20} /><span>현재 활성 AI</span><strong>{settings?.aiProviders?.find((provider) => provider.enabled)?.label ?? "없음"}</strong></div>
      </section>

      <section className={styles.cacheSection} aria-labelledby="explanation-cache-title">
        <div className={styles.cacheHeading}>
          <span><Sparkles size={20} /></span>
          <div>
            <small>AI EXPLANATION CACHE</small>
            <h2 id="explanation-cache-title">공공정보 AI 설명 저장소</h2>
            <p>동일한 공식 정보의 설명을 AI 모델·언어별로 보존해, 다른 모델을 쓰다가 돌아와도 기존 결과를 재사용합니다. 원문이 바뀌면 새 설명이 필요하며, 유료 AI의 캐시 미스는 개발자가 항목별로 1회 승인해야만 호출합니다.</p>
          </div>
        </div>
        <div className={styles.cacheMetrics}>
          <div><span>현재 모델</span><strong>{explanationCache?.currentRuntime ? `${explanationCache.currentRuntime.provider} · ${explanationCache.currentRuntime.model}` : "활성 모델 없음"}</strong></div>
          <div><span>현재 모델 저장</span><strong>{explanationCache?.currentRuntimeEntryCount ?? 0}건</strong></div>
          <div><span>전체 저장</span><strong>{explanationCache?.entryCount ?? 0}건</strong></div>
          <div><span>중복 호출 절약</span><strong>{explanationCache?.hitCount ?? 0}회</strong></div>
        </div>
        <div className={styles.cacheFooter}>
          <small>최근 생성 {explanationCache?.lastGeneratedAt ? new Date(explanationCache.lastGeneratedAt).toLocaleString("ko-KR") : "없음"} · 최근 초기화 {explanationCache?.lastClearedAt ? new Date(explanationCache.lastClearedAt).toLocaleString("ko-KR") : "없음"}{(explanationCache?.generatingCount ?? 0) > 0 ? ` · 생성 중 ${explanationCache?.generatingCount}건` : ""}</small>
          <button type="button" onClick={() => void clearExplanationCache()} disabled={pendingKey !== null}><Trash2 size={15} />{pendingKey === "explanation_cache" ? "초기화 중" : "저장된 설명 초기화"}</button>
        </div>
      </section>

      <section className={styles.scheduleSection} aria-labelledby="public-api-operations-title">
        <div className={styles.sectionHeading}>
          <span>PUBLIC API OPERATIONS</span>
          <h2 id="public-api-operations-title">공용 API 호출 보호·갱신 상태</h2>
          <p>이 운영 정보는 개발자에게만 표시됩니다. 사용량은 전 사용자에게 공유되며, 예정 시각 전에는 새 호출을 만들지 않습니다.</p>
        </div>
        <div className={styles.scheduleActions}>
          <div>
            <strong>무료 공용데이터 운영 갱신</strong>
            <small>평가가 아닌 운영 작업입니다. 활성화된 무료 출처만 호출하며 AI 모델과 유료 API는 호출하지 않습니다. 일일 한도와 제공기관별 대기 시간을 그대로 적용합니다.</small>
          </div>
          <button
            type="button"
            onClick={() => void refreshPublicData()}
            disabled={publicRefreshPending || publicRefreshCooldown > 0}
          >
            <RefreshCw size={16} className={publicRefreshPending ? styles.spinning : undefined} />
            {publicRefreshPending
              ? "운영 갱신 중"
              : publicRefreshCooldown > 0
                ? `${durationLabel(publicRefreshCooldown)} 후 가능`
                : "공용데이터 지금 갱신"}
          </button>
        </div>
        {publicRefreshNotice && <p className={styles.scheduleNotice} role="status">{publicRefreshNotice}</p>}
        <div className={styles.scheduleGrid}>
          {(publicData?.sourceSchedules ?? []).map((schedule) => {
            const committedCalls = schedule.usedCalls + schedule.reservedCalls;
            const ratio = schedule.dailyLimit > 0
              ? Math.min(100, Math.round((committedCalls / schedule.dailyLimit) * 100))
              : 0;
            const service = schedule.serviceKey
              ? serviceByKey.get(schedule.serviceKey) ?? null
              : null;
            const source = sourceById.get(schedule.sourceId) ?? null;
            const operation = publicSourceState(schedule, service);
            const collection = publicCollectionStatus(source);
            const sourceErrorCode = source?.errorCode ?? schedule.lastError;
            const sourceWarning = isSuccessfulSourceWarning(source, sourceErrorCode);
            const sourceDiagnostic = sourceWarning
              ? publicSourceWarningMessage(sourceErrorCode)
              : publicSourceErrorMessage(sourceErrorCode);
            const active = schedule.serviceKey ? Boolean(service?.enabled) : true;
            const quotaLabel = schedule.quotaBasis === "official"
              ? "제공기관 확인 한도"
              : schedule.quotaBasis === "user-confirmed"
                ? "관리자 확인 한도"
                : "내부 보수적 보호 예산";
            return <article key={schedule.sourceId} className={styles.scheduleCard}>
              <div>
                <div className={styles.scheduleTitle}>
                  <strong>{source?.label ?? schedule.sourceId}</strong>
                  <code>{schedule.sourceId}</code>
                </div>
                <div className={styles.scheduleBadges}>
                  <em data-state={collection.state}>{collection.label}</em>
                  <em data-state={operation.state}>{operation.label}</em>
                </div>
              </div>
              <dl>
                <div><dt>저장 항목</dt><dd>{(source?.itemCount ?? 0).toLocaleString("ko-KR")}건</dd></div>
                <div><dt>수집 완성도</dt><dd>{publicCompletenessLabel(source)}</dd></div>
                <div><dt>오늘 사용·예약</dt><dd>{committedCalls.toLocaleString("ko-KR")} / {schedule.dailyLimit.toLocaleString("ko-KR")}</dd></div>
                <div><dt>다음 갱신</dt><dd>{active ? schedule.nextDueAt ? new Date(schedule.nextDueAt).toLocaleString("ko-KR") : "미정" : "활성화 후"}</dd></div>
                <div><dt>최근 성공</dt><dd>{schedule.lastSuccessAt ? new Date(schedule.lastSuccessAt).toLocaleString("ko-KR") : "없음"}</dd></div>
                <div><dt>최근 시도</dt><dd>{schedule.lastAttemptAt ? new Date(schedule.lastAttemptAt).toLocaleString("ko-KR") : "없음"}</dd></div>
              </dl>
              <div className={styles.scheduleTrack} role="progressbar" aria-label={`${schedule.sourceId} 일일 호출 사용률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio}><span style={{ width: `${ratio}%` }} /></div>
              <small><Clock3 size={13} /><span>{quotaLabel} · {operation.detail}</span></small>
              {sourceErrorCode && <p className={sourceWarning ? styles.scheduleWarning : styles.scheduleError}><ShieldAlert size={13} /><span>{sourceDiagnostic}<code>{sourceErrorCode}</code></span></p>}
            </article>;
          })}
          {publicData && (publicData.sourceSchedules?.length ?? 0) === 0 && <p className={styles.scheduleEmpty}>등록된 공용 API 일정이 없습니다.</p>}
        </div>
      </section>

      <section className={styles.bulkControls} aria-label="공개 데이터 연동 일괄 설정">
        <div>
          <strong>금융·정책·보안 공개 데이터</strong>
          <small>현재 ON {managedServices.filter((service) => service.enabled).length} / {managedServices.length} · OFF 상태에서는 키를 읽거나 공식 파일을 새로 수집하지 않습니다.</small>
        </div>
        <div>
          <button type="button" onClick={() => saveAllServices(true)} disabled={pendingKey !== null}><Power size={15} />전체 선택·ON</button>
          <button type="button" onClick={() => saveAllServices(false)} disabled={pendingKey !== null}>전체 해제·OFF</button>
        </div>
      </section>

      {groupedServices.map(([category, services]) => (
        <section className={styles.serviceSection} key={category}>
          <div className={styles.sectionHeading}><span>API REGISTRY</span><h2>{category}</h2></div>
          <div className={styles.apiGrid}>
            {services.map((service) => {
              const aiProvider = settings?.aiProviders?.find((provider) => provider.keyName === service.key);
              const draft = aiProvider ? providerDraft(aiProvider) : null;
              const enabledDraft = service.activationManaged ? serviceDraft(service) : false;
              const credentialRequired = service.credentialRequired !== false;
              const configured = aiProvider?.configured ?? service.configured;
              const serviceRuntime = runtimeCredentialState(service);
              const providerRuntime = aiProvider
                ? runtimeCredentialState({
                    configured: aiProvider.configured,
                    runtimeUsable: aiProvider.runtimeUsable,
                    runtimeIssue: aiProvider.runtimeIssue,
                  })
                : null;
              const providerUnreadable = providerRuntime?.unreadable ?? false;
              const runtimeUnreadable = providerUnreadable || serviceRuntime.unreadable;
              const runtimeFallbackActive = providerRuntime?.fallbackActive || serviceRuntime.fallbackActive;
              const runtimeConfirmedUsable = aiProvider
                ? aiProvider.runtimeUsable === true
                : service.runtimeUsable === true;
              const effectiveEnabled = (aiProvider ? Boolean(draft?.enabled) : enabledDraft) && !runtimeUnreadable;
              const statusLabel = runtimeUnreadable
                ? "저장됨 · 다시 입력 필요"
                : runtimeFallbackActive
                  ? "환경 키 사용 중 · 저장 키 점검"
                : aiProvider
                  ? aiProvider.globallyDisabled
                    ? "전체 차단"
                    : draft?.enabled
                      ? "단독 사용 중"
                      : aiProvider.configured
                        ? runtimeConfirmedUsable ? "키 사용 가능 · OFF" : "준비됨 · OFF"
                        : "미설정"
                  : !credentialRequired
                    ? effectiveEnabled ? "수집 ON" : "수집 OFF"
                  : !service.adapterReady
                    ? service.configured
                      ? "키 저장됨 · 어댑터 준비 중"
                      : "어댑터 준비 중"
                    : effectiveEnabled
                      ? "사용 ON"
                      : service.configured
                        ? runtimeConfirmedUsable ? "키 사용 가능 · OFF" : "저장됨 · OFF"
                        : "미설정";
              return <article className={styles.apiCard} key={service.key} data-ai-provider={aiProvider ? "true" : undefined}>
                <div className={styles.apiHead}>
                  <div><h3>{service.label}</h3><p>{service.description}</p></div>
                  <em
                    data-configured={configured ? "true" : undefined}
                    data-enabled={effectiveEnabled ? "true" : undefined}
                    data-policy={service.disabledByPolicy ? "blocked" : undefined}
                    data-runtime-issue={runtimeUnreadable ? "true" : undefined}
                  >
                    {statusLabel}
                  </em>
                </div>
                <code>{service.key}</code>
                {!aiProvider && <small className={styles.integrationNote} data-ready={service.adapterReady ? "true" : undefined}>{service.adapterReady ? `적용 위치: ${service.integrationSurface}` : "현재는 암호화 보관만 지원하며 서비스 호출에는 사용하지 않습니다."}</small>}
                {aiProvider && draft && <div className={styles.providerControls}>
                  <label>
                    사용할 모델
                    <select
                      value={draft.modelId}
                      onChange={(event) => setProviderDrafts((current) => ({ ...current, [aiProvider.id]: { ...draft, modelId: event.target.value } }))}
                      disabled={pendingKey === service.key}
                    >
                      {aiProvider.models.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.hint}</option>)}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={styles.providerToggle}
                    role="switch"
                    aria-checked={draft.enabled}
                    data-enabled={draft.enabled ? "true" : undefined}
                    onClick={() => toggleProvider(aiProvider)}
                    disabled={aiProvider.globallyDisabled || pendingKey !== null}
                  >
                    <Power size={17} />
                    <span>{draft.enabled ? "사용 ON" : "사용 OFF"}</span>
                  </button>
                  <small>{aiProvider.globallyDisabled ? "서버 긴급 차단이 활성화되어 있습니다." : draft.enabled ? aiProvider.billingRisk ? "저장하면 이 AI만 호출되며 실제 요금이 발생할 수 있습니다." : "저장하면 이 Local AI만 호출되고 다른 공급자는 꺼집니다." : "OFF 상태에서는 호출하지 않습니다. ON 저장 시 다른 AI가 자동으로 꺼집니다."}</small>
                  {aiProvider.id === "local" && <small className={styles.localRuntime} data-state={settings?.localRuntime?.state ?? "offline"}>
                    Ollama: {settings?.localRuntime
                      ? settings.localRuntime.state === "ready"
                        ? `준비됨 · ${settings.localRuntime.loadedModel ?? settings.localRuntime.selectedModel}`
                        : settings.localRuntime.state === "pulling"
                          ? "모델 다운로드 중"
                          : settings.localRuntime.state === "loading"
                            ? "GPU 메모리에 로딩 중"
                            : settings.localRuntime.state === "error"
                              ? "준비 실패 · 서버 로그 확인 필요"
                              : `대기 · ${settings.localRuntime.selectedModel ?? "모델 미선택"}`
                      : "연결 안 됨 · 원격 서버 배포에서만 사용 가능"}
                  </small>}
                </div>}
                {service.activationManaged && <div className={styles.serviceControls}>
                  <button
                    type="button"
                    className={styles.providerToggle}
                    role="switch"
                    aria-checked={enabledDraft}
                    data-enabled={enabledDraft ? "true" : undefined}
                    onClick={() => setServiceDrafts((current) => ({ ...current, [service.key]: !enabledDraft }))}
                    disabled={pendingKey !== null}
                  >
                    <Power size={17} />
                    <span>{enabledDraft ? "사용 ON" : "사용 OFF"}</span>
                  </button>
                  <small>{runtimeUnreadable
                    ? "저장 기록만 남아 있고 현재 런타임에서는 사용할 수 없습니다. 새 키를 입력해 다시 적용해 주세요."
                    : enabledDraft
                      ? credentialRequired
                        ? "저장·적용 후 실제 서비스 데이터 요청에 사용됩니다."
                        : "저장·적용 후 서울시 공식 HTTPS 전체 CSV 수집 일정에 사용됩니다. API 키는 읽거나 전송하지 않습니다."
                      : service.configured
                        ? credentialRequired
                          ? "키는 안전하게 저장되어 있지만 OFF 상태이므로 서버가 호출하지 않습니다."
                          : "OFF 상태에서는 새 파일을 수집하지 않으며, 이미 저장된 서울 상권 데이터는 유지됩니다."
                        : "OFF 상태에서는 외부 API를 호출하지 않습니다."}</small>
                </div>}
                {credentialRequired && <>
                  <label>
                    {aiProvider?.id === "local" ? "Local AI API 키 (선택)" : "새 API 키"}
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={values[service.key] ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, [service.key]: event.target.value }))}
                      placeholder={runtimeUnreadable ? "키를 다시 입력해 복구" : service.configured ? "새 값으로 교체" : "키 입력"}
                      disabled={!settings?.storageReady || pendingKey === service.key}
                    />
                  </label>
                  <div className={styles.keyMeta}>
                    <span>{service.masked ?? "등록된 값 없음"}</span>
                    <small>{runtimeUnreadable
                      ? "런타임 사용 불가 · 다시 입력 필요"
                      : runtimeFallbackActive
                        ? "환경 키 사용 가능 · 저장 키 다시 입력 권장"
                      : runtimeConfirmedUsable
                        ? "런타임 사용 가능"
                        : service.source === "developer"
                          ? "개발자 모드 저장"
                          : service.source === "environment"
                            ? "서버 환경 변수"
                            : "미연결"}</small>
                  </div>
                </>}
                <div className={styles.keyActions}>
                  <button type="button" onClick={() => aiProvider ? saveProvider(aiProvider) : saveService(service)} disabled={(credentialRequired && !settings?.storageReady) || pendingKey !== null}><Save size={15} />{pendingKey === service.key ? "처리 중" : "저장·적용"}</button>
                  {credentialRequired && service.source === "developer" && <button type="button" className={styles.deleteButton} onClick={() => deleteKey(service.key)} disabled={pendingKey !== null}><Trash2 size={15} />삭제</button>}
                </div>
              </article>
            })}
          </div>
        </section>
      ))}

      <section className={styles.loginSection}>
        <div className={styles.sectionHeading}><span>LOGIN OPERATIONS</span><h2>소셜 로그인 콘솔</h2></div>
        <div className={styles.loginGrid}>
          {loginProviders.map((provider) => <article key={provider.id}>
            <div className={`${styles.logo} ${styles[provider.id]}`}>{provider.id === "naver" ? "N" : "K"}</div>
            <div><h3>{provider.name} 로그인</h3><code>{`${currentOrigin}${provider.callbackPath}`}</code></div>
            <em>{health?.auth?.providers?.[provider.id]?.available ? "사용 가능" : "점검 필요"}</em>
            <a href={provider.consoleUrl} target="_blank" rel="noreferrer">테스트 멤버 관리<ExternalLink size={15} /></a>
          </article>)}
        </div>
        <p><ShieldAlert size={16} />OAuth 앱 키는 로그인 자체를 복구하는 데 필요하므로 이 화면에서 변경하지 않습니다. 네이버·카카오 개발자 콘솔과 서버 환경 변수에서 별도로 관리합니다. 출품 버전의 자산 분석은 사용자가 직접 입력하고 동의한 값만 사용하며 외부 계좌 연결은 제공하지 않습니다.</p>
      </section>
    </main>
  );
}

function AccessMessage({ title, body }: { title: string; body: string }) {
  return <main className={styles.accessShell}><section><ShieldAlert size={34} /><span>DEVELOPER MODE</span><h1>{title}</h1><p>{body}</p><div><Link href="/">홈으로</Link><Link href="/mypage">마이페이지</Link></div></section></main>;
}
