"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Code2,
  Database,
  FileCheck2,
  LogOut,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@/lib/auth/consent-policy";
import { fetchAuthJson, localLogoutCompleted } from "@/lib/auth/client-requests";
import styles from "./mypage.module.css";

type DisplayNameMode = "nickname" | "name" | "bora";
type Provider = "kakao" | "naver" | "google";
type YouthPolicyRegion = "seoul" | "busan" | "daegu" | "incheon" | "gwangju" | "daejeon" | "ulsan" | "sejong" | "gyeonggi" | "gangwon" | "chungbuk" | "chungnam" | "jeonbuk" | "jeonnam" | "gyeongbuk" | "gyeongnam" | "jeju";
type YouthPolicyStatus = "high_school" | "university" | "graduate_school" | "job_seeker" | "employed" | "self_employed" | "not_working" | "other";
type YouthPolicyInterest = "asset_building" | "education" | "employment" | "housing" | "startup" | "finance" | "welfare";
type YouthPolicyProfile = {
  enabled: boolean;
  birthYear: number | null;
  region: YouthPolicyRegion | null;
  status: YouthPolicyStatus | null;
  interests: YouthPolicyInterest[];
};
type ProfileUser = {
  id: string;
  provider: Provider;
  displayName: string;
  name: string | null;
  nickname: string | null;
  displayNameMode: DisplayNameMode;
  boraAlias: string | null;
  email: string | null;
  emailVerified: boolean | null;
  gender: string | null;
  birthday: string | null;
  birthYear: string | null;
  ageRange: string | null;
  youthPolicyProfile: YouthPolicyProfile;
};
type SessionResponse = {
  authenticated?: boolean;
  isDeveloper?: boolean;
  expiresAt?: number | string | null;
  user?: ProfileUser | null;
  providers?: Partial<Record<Provider, boolean>>;
  signInPaths?: Partial<Record<Provider, string>>;
};
type AccountInventory = {
  accountIdentity: number;
  displayProfiles: number;
  opportunityProfiles: number;
  financeSnapshots: number;
  aiChatEvents: number;
  aiMemories: number;
  aiContextPreferences: number;
  aiConversationContexts: number;
  recentActivities: number;
  categoryReadMarkers: number;
  activeSessions: number;
  consentRecords: number;
  serviceUsageCounters: number;
};
type AccountLifecycleResponse = {
  authenticated?: boolean;
  consent: {
    accepted: boolean;
    requiresAcceptance: boolean;
    termsVersion: string;
    privacyVersion: string;
    acceptedAt: string | null;
  };
  inventory: AccountInventory;
  error?: string;
};

const providerName: Record<Provider, string> = { kakao: "카카오", naver: "네이버", google: "Google" };
const emptyYouthPolicyProfile: YouthPolicyProfile = { enabled: false, birthYear: null, region: null, status: null, interests: [] };
const regionLabels: Record<YouthPolicyRegion, string> = {
  seoul: "서울", busan: "부산", daegu: "대구", incheon: "인천", gwangju: "광주", daejeon: "대전", ulsan: "울산", sejong: "세종",
  gyeonggi: "경기", gangwon: "강원", chungbuk: "충북", chungnam: "충남", jeonbuk: "전북", jeonnam: "전남", gyeongbuk: "경북", gyeongnam: "경남", jeju: "제주",
};
const statusLabels: Record<YouthPolicyStatus, string> = {
  high_school: "고등학생", university: "대학생", graduate_school: "대학원생", job_seeker: "구직·취업준비", employed: "재직 중", self_employed: "창업·자영업", not_working: "현재 미취업", other: "기타",
};
const interestLabels: Record<YouthPolicyInterest, string> = {
  asset_building: "자산형성", education: "교육·장학", employment: "취업", housing: "주거", startup: "창업", finance: "금융지원", welfare: "생활·복지",
};
const inventoryLabels: Array<{ key: keyof AccountInventory; label: string }> = [
  { key: "accountIdentity", label: "로그인 계정" },
  { key: "displayProfiles", label: "표시 이름 설정" },
  { key: "opportunityProfiles", label: "정책·창업 맞춤 프로필" },
  { key: "financeSnapshots", label: "직접 입력 자산 장부" },
  { key: "aiChatEvents", label: "AI 상담 주제 기록" },
  { key: "aiMemories", label: "AI가 기억하는 핵심 메모" },
  { key: "aiContextPreferences", label: "AI 개인화 선택 설정" },
  { key: "aiConversationContexts", label: "최근 대화 발췌(최대 30일)" },
  { key: "recentActivities", label: "최근 메뉴·공공정보 활동(최대 30일)" },
  { key: "categoryReadMarkers", label: "공공정보 읽음 표시" },
  { key: "activeSessions", label: "로그인 세션" },
  { key: "consentRecords", label: "필수 동의 이력" },
  { key: "serviceUsageCounters", label: "보안용 사용량 기록" },
];
const ACCOUNT_DELETION_CONFIRMATION = "회원탈퇴";
const MY_PAGE_REQUEST_TIMEOUT_MS = 12_000;
type RecoverableRequestFailure = "timeout" | "request";

function fetchMyPageRequest<T>(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetchAuthJson<T>(input, init, MY_PAGE_REQUEST_TIMEOUT_MS);
}

export default function MyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionStatus, setSessionStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sessionFailure, setSessionFailure] = useState<RecoverableRequestFailure | null>(null);
  const [sessionRetry, setSessionRetry] = useState(0);
  const [mode, setMode] = useState<DisplayNameMode>("nickname");
  const [alias, setAlias] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [policyProfile, setPolicyProfile] = useState<YouthPolicyProfile>(emptyYouthPolicyProfile);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyNotice, setPolicyNotice] = useState("");
  const [storedAccount, setAccount] = useState<AccountLifecycleResponse | null>(null);
  const [accountOwner, setAccountOwner] = useState<{ id: string | null; epoch: number } | null>(null);
  const [principalEpoch, setPrincipalEpoch] = useState(0);
  const [accountLoading, setAccountLoading] = useState(true);
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [privacyAgreed, setPrivacyAgreed] = useState(false);
  const [preLoginConsent, setPreLoginConsent] = useState(false);
  const [loginProviderPending, setLoginProviderPending] = useState<Provider | null>(null);
  const [preLoginConsentError, setPreLoginConsentError] = useState("");
  const [savingConsent, setSavingConsent] = useState(false);
  const [accountNotice, setAccountNotice] = useState("");
  const [deletionText, setDeletionText] = useState("");
  const [deletionAcknowledged, setDeletionAcknowledged] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutFailure, setLogoutFailure] = useState<RecoverableRequestFailure | null>(null);
  const logoutAbortRef = useRef<AbortController | null>(null);
  const sessionAbortRef = useRef<AbortController | null>(null);
  const lastSessionRefreshRef = useRef(0);
  const authenticatedUserId = session?.authenticated ? session.user?.id ?? null : null;
  const currentPrincipalRef = useRef<string | null>(null);
  const principalEpochRef = useRef(0);
  const principalRequestRef = useRef<{ id: string | null; epoch: number; controller: AbortController } | null>(null);
  const account = accountOwner?.id === authenticatedUserId && accountOwner?.epoch === principalEpoch
    ? storedAccount : null;
  const onboardingRequired = searchParams.get("onboarding") === "required"
    && Boolean(account && !account.consent.accepted);
  const preLoginConsentRequired = searchParams.get("login_consent") === "required";
  const requestedReturnTo = searchParams.get("returnTo");
  const authResult = searchParams.get("auth");
  const loginRetryRequired = authResult === "failed" && searchParams.get("auth_reason") === "login_retry_required";

  const ownsRequest = useCallback((scope: NonNullable<typeof principalRequestRef.current>): boolean => {
    return principalRequestRef.current === scope && currentPrincipalRef.current === scope.id
      && principalEpochRef.current === scope.epoch
      && !scope.controller.signal.aborted;
  }, []);

  const synchronizePrincipal = useCallback((nextId: string | null) => {
    if (currentPrincipalRef.current === nextId) return;
    // Invalidate immediately, before React commits the next account's view.
    principalRequestRef.current?.controller.abort();
    currentPrincipalRef.current = nextId;
    principalEpochRef.current += 1;
    setPrincipalEpoch(principalEpochRef.current);
  }, []);

  useEffect(() => {
    const scope = { id: authenticatedUserId, epoch: principalEpoch, controller: new AbortController() };
    principalRequestRef.current = scope;
    window.queueMicrotask(() => {
      if (!ownsRequest(scope)) return;
      setAccount(null);
      setAccountOwner(null);
      setAccountLoading(Boolean(scope.id));
      setTermsAgreed(false);
      setPrivacyAgreed(false);
      setSaving(false);
      setSavingPolicy(false);
      setSavingConsent(false);
      setDeletingAccount(false);
      setNotice("");
      setPolicyNotice("");
      setAccountNotice("");
      setDeletionText("");
      setDeletionAcknowledged(false);
      setLoginProviderPending(null);
    });
    return () => {
      scope.controller.abort();
      if (principalRequestRef.current === scope) principalRequestRef.current = null;
    };
  }, [authenticatedUserId, principalEpoch, ownsRequest]);

  useEffect(() => {
    const controller = new AbortController();
    sessionAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MY_PAGE_REQUEST_TIMEOUT_MS);
    void (async () => {
      try {
        const { response, data } = await fetchMyPageRequest<SessionResponse>("/api/session", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (controller.signal.aborted && !timedOut) return;
        if (timedOut || !response.ok) throw new Error(timedOut ? "session_timeout" : "session_unavailable");
        synchronizePrincipal(data.authenticated ? data.user?.id ?? null : null);
        setSession(data);
        setSessionStatus("ready");
        setSessionFailure(null);
        if (data.user) {
          setMode(data.user.displayNameMode ?? "nickname");
          setAlias(data.user.boraAlias ?? "");
          setPolicyProfile(data.user.youthPolicyProfile ?? emptyYouthPolicyProfile);
        }
      } catch (error) {
        if (controller.signal.aborted && !timedOut) return;
        timedOut ||= error instanceof DOMException && error.name === "TimeoutError";
        setSessionFailure(timedOut ? "timeout" : "request");
        setSessionStatus("error");
      } finally {
        window.clearTimeout(timeoutId);
        if (sessionAbortRef.current === controller) sessionAbortRef.current = null;
      }
    })();
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
      if (sessionAbortRef.current === controller) sessionAbortRef.current = null;
    };
  }, [sessionRetry, synchronizePrincipal]);

  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (now - lastSessionRefreshRef.current < 1_000) return;
      lastSessionRefreshRef.current = now;
      setSessionRetry((current) => current + 1);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (!session?.authenticated || session.expiresAt === undefined || session.expiresAt === null) return;
    const expiresAt = typeof session.expiresAt === "number"
      ? session.expiresAt
      : Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAt)) return;
    const clearExpiredPrincipal = () => {
      if (currentPrincipalRef.current !== authenticatedUserId || principalEpochRef.current !== principalEpoch) return;
      sessionAbortRef.current?.abort();
      synchronizePrincipal(null);
      setSession((current) => current ? { ...current, authenticated: false, user: null } : current);
      setAccount(null);
      setMode("nickname");
      setAlias("");
      setPolicyProfile(emptyYouthPolicyProfile);
    };
    let timeoutId = 0;
    const scheduleExpiry = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        clearExpiredPrincipal();
        return;
      }
      timeoutId = window.setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647));
    };
    scheduleExpiry();
    return () => window.clearTimeout(timeoutId);
  }, [session?.authenticated, session?.expiresAt, authenticatedUserId, principalEpoch, synchronizePrincipal]);

  useEffect(() => {
    if (authenticatedUserId) return;
    let cancelled = false;
    window.queueMicrotask(() => {
      if (cancelled) return;
      setAccount(null);
      setTermsAgreed(false);
      setPrivacyAgreed(false);
      setMode("nickname");
      setAlias("");
      setPolicyProfile(emptyYouthPolicyProfile);
    });
    return () => { cancelled = true; };
  }, [authenticatedUserId]);

  useEffect(() => () => {
    logoutAbortRef.current?.abort();
    logoutAbortRef.current = null;
  }, []);

  useEffect(() => {
    if (!authenticatedUserId) return;
    const scope = principalRequestRef.current;
    if (!scope || !ownsRequest(scope)) return;
    const controller = new AbortController();
    fetchMyPageRequest<AccountLifecycleResponse>("/api/account", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(({ response, data: result }) => {
        if (!response.ok) throw new Error(result.error ?? "account_unavailable");
        return result;
      })
      .then((result) => {
        if (controller.signal.aborted || !ownsRequest(scope)) return;
        setAccount(result);
        setAccountOwner({ id: scope.id, epoch: scope.epoch });
        setTermsAgreed(result.consent.accepted);
        setPrivacyAgreed(result.consent.accepted);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && ownsRequest(scope)
          && !(error instanceof DOMException && error.name === "AbortError")) {
          setAccountNotice("동의 및 저장 데이터 현황을 불러오지 못했습니다.");
        }
      })
      .finally(() => { if (!controller.signal.aborted && ownsRequest(scope)) setAccountLoading(false); });
    return () => controller.abort();
  }, [authenticatedUserId, principalEpoch, ownsRequest]);

  useEffect(() => {
    if (!onboardingRequired) return;
    const target = document.getElementById("privacy-consent");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.focus({ preventScroll: true });
  }, [onboardingRequired]);

  async function saveProfile() {
    const scope = principalRequestRef.current;
    if (!scope?.id || !ownsRequest(scope) || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const { response, data: result } = await fetchMyPageRequest<{ user?: ProfileUser; error?: string }>("/api/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayNameMode: mode, boraAlias: alias }),
        signal: scope.controller.signal,
      });
      if (!ownsRequest(scope)) return;
      if (!response.ok || !result.user) throw new Error(result.error ?? "save_failed");
      if (result.user.id !== scope.id) throw new Error("profile_owner_mismatch");
      setSession((current) => current?.user?.id === scope.id ? { ...current, user: result.user } : current);
      setNotice("표시 이름 설정을 저장했습니다.");
    } catch (error) {
      if (!ownsRequest(scope)) return;
      setNotice(error instanceof Error && error.message === "bora_alias_required" ? "BORA Bridge 별명을 2자 이상 입력해 주세요." : "설정을 저장하지 못했습니다.");
    } finally {
      if (ownsRequest(scope)) setSaving(false);
    }
  }

  async function beginOAuth(provider: Provider) {
    const scope = principalRequestRef.current;
    if (!scope || !ownsRequest(scope)) return;
    if (!preLoginConsent || loginProviderPending) {
      if (!preLoginConsent) setPreLoginConsentError("필수 이용약관과 개인정보 처리방침에 동의해 주세요.");
      return;
    }
    setLoginProviderPending(provider);
    setPreLoginConsentError("");
    try {
      const { response, data: result } = await fetchMyPageRequest<{ authorizationUrl?: string; error?: string }>(`/api/auth/${provider}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termsAccepted: true,
          privacyAccepted: true,
          termsVersion: CURRENT_TERMS_VERSION,
          privacyVersion: CURRENT_PRIVACY_VERSION,
          returnTo: requestedReturnTo,
        }),
        signal: scope.controller.signal,
      });
      if (!ownsRequest(scope)) return;
      if (!response.ok || !result.authorizationUrl) {
        throw new Error(result.error ?? "oauth_start_failed");
      }
      const authorization = new URL(result.authorizationUrl);
      if (authorization.protocol !== "https:") throw new Error("invalid_authorization_url");
      window.location.assign(authorization.toString());
    } catch {
      if (!ownsRequest(scope)) return;
      setLoginProviderPending(null);
      setPreLoginConsentError("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  }

  async function signOut() {
    if (logoutPending) return;
    logoutAbortRef.current?.abort();
    const controller = new AbortController();
    logoutAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, MY_PAGE_REQUEST_TIMEOUT_MS);
    setLogoutPending(true);
    setLogoutFailure(null);
    try {
      const { response, data } = await fetchMyPageRequest<unknown>("/api/auth/logout", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (controller.signal.aborted && !timedOut) return;
      if (timedOut || !localLogoutCompleted(response, data)) throw new Error(timedOut ? "logout_timeout" : "logout_failed");
      sessionAbortRef.current?.abort();
      synchronizePrincipal(null);
      setSession((current) => current ? { ...current, authenticated: false, user: null } : current);
      setAccount(null);
      window.location.assign("/");
    } catch (error) {
      if (controller.signal.aborted && !timedOut) return;
      timedOut ||= error instanceof DOMException && error.name === "TimeoutError";
      setLogoutFailure(timedOut ? "timeout" : "request");
      setLogoutPending(false);
    } finally {
      window.clearTimeout(timeoutId);
      if (logoutAbortRef.current === controller) logoutAbortRef.current = null;
    }
  }

  async function saveYouthPolicyProfile(
    profileToSave: YouthPolicyProfile = policyProfile,
    deleting = false,
  ) {
    const scope = principalRequestRef.current;
    if (!scope?.id || !ownsRequest(scope) || savingPolicy) return;
    setSavingPolicy(true);
    setPolicyNotice("");
    try {
      const { response, data: result } = await fetchMyPageRequest<{ user?: ProfileUser; error?: string }>("/api/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ youthPolicyProfile: profileToSave }),
        signal: scope.controller.signal,
      });
      if (!ownsRequest(scope)) return;
      if (!response.ok || !result.user) throw new Error(result.error ?? "save_failed");
      if (result.user.id !== scope.id) throw new Error("profile_owner_mismatch");
      setSession((current) => current?.user?.id === scope.id ? { ...current, user: result.user } : current);
      setPolicyProfile(result.user.youthPolicyProfile);
      setPolicyNotice(deleting ? "저장된 정책·창업 기회 맞춤 정보를 삭제했습니다." : profileToSave.enabled ? "정책·창업 기회 맞춤 프로필을 저장했습니다." : "정책·창업 기회 개인화를 껐습니다. 입력값은 삭제 버튼을 누르기 전까지 보관됩니다.");
    } catch {
      if (!ownsRequest(scope)) return;
      setPolicyNotice("정책·창업 기회 맞춤 프로필을 저장하지 못했습니다.");
    } finally {
      if (ownsRequest(scope)) setSavingPolicy(false);
    }
  }

  async function deleteYouthPolicyProfile() {
    const cleared = { ...emptyYouthPolicyProfile, interests: [] };
    await saveYouthPolicyProfile(cleared, true);
  }

  function toggleInterest(interest: YouthPolicyInterest) {
    setPolicyProfile((current) => ({
      ...current,
      interests: current.interests.includes(interest)
        ? current.interests.filter((value) => value !== interest)
        : [...current.interests, interest],
    }));
  }

  async function saveRequiredConsents() {
    const scope = principalRequestRef.current;
    if (!scope?.id || !ownsRequest(scope) || savingConsent) return;
    if (!account || !termsAgreed || !privacyAgreed) {
      setAccountNotice("필수 이용약관과 개인정보 처리방침에 모두 동의해 주세요.");
      return;
    }
    setSavingConsent(true);
    setAccountNotice("");
    try {
      const { response, data: result } = await fetchMyPageRequest<Pick<AccountLifecycleResponse, "consent" | "error">>("/api/account", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termsAccepted: true,
          privacyAccepted: true,
          termsVersion: account.consent.termsVersion,
          privacyVersion: account.consent.privacyVersion,
        }),
        signal: scope.controller.signal,
      });
      if (!ownsRequest(scope)) return;
      if (!response.ok || !result.consent) throw new Error(result.error ?? "consent_save_failed");
      setAccount((current) => current ? {
        ...current,
        consent: result.consent,
        inventory: {
          ...current.inventory,
          consentRecords: Math.max(1, current.inventory.consentRecords),
        },
      } : current);
      router.replace("/mypage", { scroll: false });
      setAccountNotice("현재 버전의 필수 동의를 저장했습니다.");
    } catch {
      if (!ownsRequest(scope)) return;
      setAccountNotice("필수 동의를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (ownsRequest(scope)) setSavingConsent(false);
    }
  }

  async function deleteAccount() {
    const scope = principalRequestRef.current;
    if (!scope?.id || !ownsRequest(scope)) return;
    if (
      deletionText !== ACCOUNT_DELETION_CONFIRMATION
      || !deletionAcknowledged
      || deletingAccount
    ) return;
    const confirmed = window.confirm(
      "계정과 직접 입력 자산, 맞춤 프로필, AI 기록을 모두 삭제합니다. 이 작업은 되돌릴 수 없습니다. 계속할까요?",
    );
    if (!confirmed) return;
    setDeletingAccount(true);
    setAccountNotice("");
    try {
      const { response, data: result } = await fetchMyPageRequest<{ deleted?: boolean; error?: string }>("/api/account", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation: deletionText,
          acknowledgePermanentDeletion: true,
        }),
        signal: scope.controller.signal,
      });
      if (!ownsRequest(scope)) return;
      if (!response.ok || !result.deleted) {
        throw new Error(result.error ?? "account_delete_failed");
      }
      window.location.assign("/?account=deleted");
    } catch (error) {
      if (!ownsRequest(scope)) return;
      setAccountNotice(
        error instanceof Error && error.message === "account_service_ownership_conflict"
          ? "개발자 운영 권한이 연결된 계정은 운영 소유권을 이전한 뒤 삭제할 수 있습니다."
          : "삭제 완료 여부를 확인하지 못했습니다. 마이페이지를 다시 열어 로그인 및 계정 상태를 확인해 주세요.",
      );
      setDeletingAccount(false);
    }
  }

  const user = session?.authenticated ? session.user ?? null : null;

  return (
    <main id="mypage-main" className={styles.shell} tabIndex={-1}>
      <a className="skip-link" href="#mypage-content">본문으로 바로가기</a>
      <header className={styles.header}>
        <Link href="/"><ArrowLeft size={18} />홈으로</Link>
        <span>BORA Bridge · MY PAGE</span>
        {session?.isDeveloper ? <Link href="/developer"><Code2 size={17} />개발자 모드</Link> : <span />}
      </header>

      <section id="mypage-content" className={styles.hero} tabIndex={-1}>
        <div className={styles.avatar}>{user?.displayName.trim().charAt(0).toUpperCase() || <UserRound size={30} />}</div>
        <div><span>MY FINANCIAL IDENTITY</span><h1>{user ? `${user.displayName}님의 마이페이지` : "내 계정과 표시 이름을 관리하세요"}</h1><p>로그인 정보와 BORA Bridge에서 사용할 이름을 한곳에서 관리합니다.</p></div>
      </section>

      {(authResult === "failed" || authResult === "cancelled") && (
        <div className={styles.loginConsentNotice} role="alert">
          <p>{loginRetryRequired
            ? "로그인 요청이 만료되었거나 이미 사용되었습니다. 계정은 변경되지 않았습니다. 아래에서 다시 로그인해 주세요."
            : authResult === "cancelled"
              ? "로그인이 취소되었습니다. 원하면 아래에서 다시 시작할 수 있습니다."
              : "로그인을 완료하지 못했습니다. 잠시 후 아래 로그인 버튼으로 다시 시도해 주세요."}</p>
          <a href={user ? "#connected-profile" : "#login-required-consent"}>{user ? "현재 로그인된 계정 확인" : "로그인 다시 시작하기"}</a>
        </div>
      )}

      {sessionStatus === "loading" ? (
        <p className={styles.loading}>로그인 상태를 확인하고 있어요…</p>
      ) : sessionStatus === "error" ? (
        <section className={styles.loginCard} role="alert">
          <AlertTriangle size={28} />
          <h2>{sessionFailure === "timeout" ? "로그인 확인 시간이 초과되었습니다" : "로그인 상태를 확인하지 못했습니다"}</h2>
          <p>{sessionFailure === "timeout" ? "서버 응답이 늦어 확인을 중단했습니다. 로그인 정보는 변경하지 않았습니다." : "연결이 일시적으로 불안정할 수 있습니다. 로그인 정보는 변경하지 않았습니다."}</p>
          <div><button type="button" onClick={() => { setSessionStatus("loading"); setSessionFailure(null); setNotice(""); setSessionRetry((current) => current + 1); }}>다시 확인</button></div>
        </section>
      ) : !session || !user ? (
        <section className={styles.loginCard}>
          <ShieldCheck size={28} />
          <h2>마이페이지를 사용하려면 로그인해 주세요</h2>
          <p>현재 카카오와 네이버 로그인을 지원합니다.</p>
          {preLoginConsentRequired && (
            <p className={styles.loginConsentNotice} role="alert">로그인 전에 필수 약관을 확인하고 동의해 주세요.</p>
          )}
          <label className={styles.loginConsent} id="login-required-consent">
            <input
              type="checkbox"
              checked={preLoginConsent}
              disabled={loginProviderPending !== null}
              onChange={(event) => {
                setPreLoginConsent(event.target.checked);
                setPreLoginConsentError("");
              }}
            />
            <span>
              <strong>필수 이용약관 및 개인정보 처리방침에 동의합니다.</strong>
              <small>
                <Link href="/terms" target="_blank">이용약관</Link>
                {" · "}
                <Link href="/privacy" target="_blank">개인정보 처리방침</Link>
              </small>
            </span>
          </label>
          {preLoginConsentError && <p className={styles.loginConsentNotice} role="alert">{preLoginConsentError}</p>}
          <div>
            {(["kakao", "naver"] as Provider[]).map((provider) => {
              const signInPath = session?.signInPaths?.[provider];
              return session?.providers?.[provider] && signInPath ? (
                <a
                  key={provider}
                  className={styles[provider]}
                  href={preLoginConsent ? signInPath : "#login-required-consent"}
                  aria-disabled={!preLoginConsent || loginProviderPending !== null}
                  aria-busy={loginProviderPending === provider}
                  onClick={(event) => {
                    event.preventDefault();
                    void beginOAuth(provider);
                  }}
                >{loginProviderPending === provider ? "로그인 연결 중…" : `${providerName[provider]}로 계속하기`}</a>
              ) : null;
            })}
          </div>
        </section>
      ) : (
        <div className={styles.grid}>
          <section id="connected-profile" className={styles.card}>
            <div className={styles.cardTitle}><div><span>CONNECTED PROFILE</span><h2>로그인 정보</h2></div><em>{providerName[user.provider]} 연결됨</em></div>
            <dl className={styles.details}>
              <div><dt>이메일</dt><dd>{user.email ?? "제공되지 않음"}</dd></div>
              <div><dt>이름</dt><dd>{user.name ?? "제공되지 않음"}</dd></div>
              <div><dt>별명</dt><dd>{user.nickname ?? "제공되지 않음"}</dd></div>
              <div><dt>생년월일</dt><dd>{user.birthday ?? user.birthYear ?? "제공되지 않음"}</dd></div>
              <div><dt>연령대</dt><dd>{user.ageRange ?? "제공되지 않음"}</dd></div>
              <div><dt>성별</dt><dd>{user.gender ?? "제공되지 않음"}</dd></div>
            </dl>
            <p className={styles.dataNote}><ShieldCheck size={15} />제공 동의한 정보만 저장하며, 표시 이름 외 정보는 이 화면에서 변경하지 않습니다.</p>
          </section>

          <section className={styles.card}>
            <div className={styles.cardTitle}><div><span>DISPLAY NAME</span><h2>웹에서 사용할 이름</h2></div><em>현재: {user.displayName}</em></div>
            <div className={styles.options}>
              <label className={!user.nickname ? styles.disabled : undefined}><input type="radio" name="display-name" value="nickname" checked={mode === "nickname"} disabled={!user.nickname} onChange={() => setMode("nickname")} /><span><strong>별명으로 하기</strong><small>{user.nickname ?? "제공된 별명이 없습니다"}</small></span>{mode === "nickname" && <Check size={18} />}</label>
              <label className={!user.name ? styles.disabled : undefined}><input type="radio" name="display-name" value="name" checked={mode === "name"} disabled={!user.name} onChange={() => setMode("name")} /><span><strong>이름으로 하기</strong><small>{user.name ?? "제공된 이름이 없습니다"}</small></span>{mode === "name" && <Check size={18} />}</label>
              <label><input type="radio" name="display-name" value="bora" checked={mode === "bora"} onChange={() => setMode("bora")} /><span><strong>BORA Bridge 별명 사용</strong><small>금융 서비스 안에서만 사용할 별도 별명</small></span>{mode === "bora" && <Check size={18} />}</label>
            </div>
            <label className={styles.aliasField}>BORA Bridge 별명<input value={alias} onChange={(event) => setAlias(event.target.value.slice(0, 30))} disabled={mode !== "bora"} placeholder="2~30자로 입력" /><small>{alias.length}/30</small></label>
            {notice && <p className={styles.notice} role="status">{notice}</p>}
            <div className={styles.actions}><button type="button" onClick={saveProfile} disabled={saving || (mode === "bora" && alias.trim().length < 2)}><Save size={17} />{saving ? "저장 중…" : "설정 저장"}</button><button type="button" className={styles.logout} onClick={signOut} disabled={logoutPending}><LogOut size={17} />{logoutPending ? "로그아웃 중…" : "로그아웃"}</button></div>
            {logoutFailure && <p className={styles.notice} role="alert">{logoutFailure === "timeout" ? "로그아웃 요청 시간이 초과되었습니다." : "로그아웃 결과를 확인하지 못했습니다."} 마이페이지를 다시 열어 로그인 상태를 확인해 주세요.</p>}
          </section>

          <section className={`${styles.card} ${styles.policyCard}`}>
            <div className={styles.cardTitle}><div><span>OPPORTUNITY PROFILE</span><h2>정책·창업 기회 맞춤 정보</h2></div><em>{policyProfile.enabled ? "개인화 ON" : "개인화 OFF"}</em></div>
            <label className={styles.policyToggle}>
              <input type="checkbox" checked={policyProfile.enabled} onChange={(event) => setPolicyProfile((current) => ({ ...current, enabled: event.target.checked }))} />
              <span><strong>내가 입력한 정보로 정책·창업 공고 후보 선별</strong><small>청년정책은 조건이 확인된 후보만 보여주고, 창업 공고는 우선 검토 순서를 따로 안내합니다.</small></span>
            </label>
            <div className={styles.policyFields} aria-disabled={!policyProfile.enabled}>
              <label><span>출생연도 <small>연령 조건이 있는 경우에만 사용</small></span><input type="number" min="1900" max={new Date().getFullYear()} inputMode="numeric" disabled={!policyProfile.enabled} value={policyProfile.birthYear ?? ""} onChange={(event) => setPolicyProfile((current) => ({ ...current, birthYear: event.target.value ? Number(event.target.value) : null }))} placeholder={user.birthYear ?? "예: 1998"} /></label>
              <label><span>거주 광역지역 <small>상세주소는 받지 않음</small></span><select disabled={!policyProfile.enabled} value={policyProfile.region ?? ""} onChange={(event) => setPolicyProfile((current) => ({ ...current, region: (event.target.value || null) as YouthPolicyRegion | null }))}><option value="">선택 안 함</option>{(Object.keys(regionLabels) as YouthPolicyRegion[]).map((region) => <option key={region} value={region}>{regionLabels[region]}</option>)}</select></label>
              <label><span>현재 상태 <small>가장 가까운 한 가지</small></span><select disabled={!policyProfile.enabled} value={policyProfile.status ?? ""} onChange={(event) => setPolicyProfile((current) => ({ ...current, status: (event.target.value || null) as YouthPolicyStatus | null }))}><option value="">선택 안 함</option>{(Object.keys(statusLabels) as YouthPolicyStatus[]).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></label>
            </div>
            <fieldset className={styles.interests} disabled={!policyProfile.enabled}><legend>관심분야 <small>여러 개 선택 가능</small></legend><div>{(Object.keys(interestLabels) as YouthPolicyInterest[]).map((interest) => <label key={interest}><input type="checkbox" checked={policyProfile.interests.includes(interest)} onChange={() => toggleInterest(interest)} /><span>{interestLabels[interest]}</span></label>)}</div></fieldset>
            <p className={styles.dataNote}><ShieldCheck size={15} />정확한 소득, 상세주소, 자유서술 내용은 수집하지 않습니다. 입력값은 정책·창업 공고 후보를 좁히는 데만 쓰며 최종 자격은 공식 공고에서 확인해야 합니다.</p>
            {policyNotice && <p className={styles.notice} role="status">{policyNotice}</p>}
            <div className={styles.actions}><button type="button" onClick={() => void saveYouthPolicyProfile()} disabled={savingPolicy}><Sparkles size={17} />{savingPolicy ? "저장 중…" : "맞춤 정보 저장"}</button><button type="button" className={styles.clearPolicy} onClick={() => void deleteYouthPolicyProfile()} disabled={savingPolicy}><ShieldCheck size={17} />저장된 맞춤 정보 삭제</button></div>
          </section>

          <section
            id="privacy-consent"
            tabIndex={-1}
            className={`${styles.card} ${styles.accountCard} ${onboardingRequired ? styles.onboardingRequired : ""}`}
          >
            <div className={styles.cardTitle}>
              <div><span>PRIVACY &amp; CONSENT</span><h2>필수 동의와 저장 데이터</h2></div>
              <em>{account?.consent.accepted ? "동의 완료" : "동의 필요"}</em>
            </div>
            {onboardingRequired && (
              <p className={styles.onboardingNotice} role="alert">
                BORA Bridge를 계속 사용하려면 현재 이용약관과 개인정보 처리방침을 확인하고 동의해 주세요.
              </p>
            )}
            {accountLoading ? (
              <p className={styles.accountLoading}>계정 데이터 현황을 확인하고 있어요…</p>
            ) : account ? (
              <div className={styles.accountColumns}>
                <div className={styles.consentPanel}>
                  <div className={styles.consentHeading}>
                    <FileCheck2 size={20} />
                    <div>
                      <strong>현재 필수 동의 버전</strong>
                      <small>
                        이용약관 {account.consent.termsVersion} · 개인정보 {account.consent.privacyVersion}
                      </small>
                    </div>
                  </div>
                  <details className={styles.policyDisclosure}>
                    <summary>이용약관 주요 내용 확인</summary>
                    <ul>
                      <li>BORA Bridge는 금융 의사결정을 돕는 정보 서비스이며 금융계약·투자판단을 대신하지 않습니다.</li>
                      <li>정책, 금리, 자격, 마감일은 신청 전에 연결된 공식 출처에서 최신 조건을 다시 확인해야 합니다.</li>
                      <li>서비스 또는 다른 이용자의 안전을 해치는 자동화·침해 행위를 할 수 없습니다.</li>
                    </ul>
                  </details>
                  <details className={styles.policyDisclosure}>
                    <summary>개인정보 처리 주요 내용 확인</summary>
                    <ul>
                      <li>OAuth 제공 정보, 표시 이름, 선택한 맞춤 프로필, 자산 항목별 합계와 AI 이용 기록을 기능 제공에 필요한 범위에서 저장합니다.</li>
                      <li>계좌번호·카드번호·주민등록번호는 요청하거나 저장하지 않으며 입력해서도 안 됩니다.</li>
                      <li>아래 계정 삭제를 완료하면 서비스 DB의 사용자 소유 데이터와 로그인 세션을 함께 삭제합니다.</li>
                    </ul>
                  </details>
                  <div className={styles.consentChecks}>
                    <label>
                      <input
                        type="checkbox"
                        checked={termsAgreed}
                        disabled={account.consent.accepted}
                        onChange={(event) => setTermsAgreed(event.target.checked)}
                      />
                      <span><strong>필수 이용약관에 동의합니다.</strong><small>{account.consent.termsVersion}</small></span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={privacyAgreed}
                        disabled={account.consent.accepted}
                        onChange={(event) => setPrivacyAgreed(event.target.checked)}
                      />
                      <span><strong>필수 개인정보 처리방침에 동의합니다.</strong><small>{account.consent.privacyVersion}</small></span>
                    </label>
                  </div>
                  {account.consent.accepted ? (
                    <p className={styles.acceptedAt}>
                      <Check size={16} />
                      {account.consent.acceptedAt
                        ? `${new Date(account.consent.acceptedAt).toLocaleString("ko-KR")} 동의`
                        : "현재 버전 동의 완료"}
                    </p>
                  ) : (
                    <button
                      type="button"
                      className={styles.consentButton}
                      disabled={!termsAgreed || !privacyAgreed || savingConsent}
                      onClick={() => void saveRequiredConsents()}
                    >
                      <FileCheck2 size={17} />{savingConsent ? "저장 중…" : "필수 동의 저장"}
                    </button>
                  )}
                </div>

                <div className={styles.inventoryPanel}>
                  <div className={styles.consentHeading}>
                    <Database size={20} />
                    <div><strong>내 계정에 저장된 항목</strong><small>내용이 아닌 레코드 수만 표시합니다.</small></div>
                  </div>
                  <dl className={styles.inventoryList}>
                    {inventoryLabels.map(({ key, label }) => (
                      <div key={key}><dt>{label}</dt><dd>{account.inventory[key].toLocaleString("ko-KR")}건</dd></div>
                    ))}
                  </dl>
                </div>
              </div>
            ) : (
              <p className={styles.accountLoading}>계정 데이터 현황을 불러오지 못했습니다.</p>
            )}
            {accountNotice && <p className={styles.notice} role="status">{accountNotice}</p>}
          </section>

          <section className={`${styles.card} ${styles.dangerCard}`}>
            <div className={styles.dangerHeading}>
              <AlertTriangle size={21} />
              <div><span>DELETE ACCOUNT</span><h2>계정과 사용자 데이터 삭제</h2></div>
            </div>
            <p>
              로그인 계정, 직접 입력한 자산 장부, 맞춤 프로필, AI 상담 주제·핵심 메모,
              읽음 표시와 모든 로그인 세션을 삭제합니다. 삭제 후에는 되돌릴 수 없습니다.
            </p>
            <label className={styles.deleteAcknowledge}>
              <input
                type="checkbox"
                checked={deletionAcknowledged}
                onChange={(event) => setDeletionAcknowledged(event.target.checked)}
              />
              <span>삭제 대상과 복구할 수 없다는 점을 확인했습니다.</span>
            </label>
            <label className={styles.deleteField}>
              계속하려면 <strong>{ACCOUNT_DELETION_CONFIRMATION}</strong>를 정확히 입력하세요.
              <input
                value={deletionText}
                onChange={(event) => setDeletionText(event.target.value.slice(0, 20))}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="account-delete-help"
              />
              <small id="account-delete-help">버튼을 누른 뒤 마지막 확인 창이 한 번 더 표시됩니다.</small>
            </label>
            <button
              type="button"
              className={styles.deleteButton}
              disabled={
                deletionText !== ACCOUNT_DELETION_CONFIRMATION
                || !deletionAcknowledged
                || deletingAccount
              }
              onClick={() => void deleteAccount()}
            >
              <Trash2 size={17} />{deletingAccount ? "삭제 중…" : "계정과 모든 사용자 데이터 삭제"}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
