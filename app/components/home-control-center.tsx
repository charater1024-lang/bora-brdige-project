"use client";

import {
  Accessibility,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  Eye,
  EyeOff,
  LayoutDashboard,
  LogIn,
  RotateCcw,
  Settings2,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./home-control-center.module.css";

export type HomeControlCenterLocale = "ko" | "en" | "ja" | "zh";

export type HomeControlCenterProps = {
  locale: HomeControlCenterLocale;
  easyMode: boolean;
  widgetOrder: string[];
  hiddenWidgets: string[];
  onWidgetOrderChange: (widgetOrder: string[]) => void;
  onHiddenWidgetsChange: (hiddenWidgets: string[]) => void;
  onResetLayout: () => void;
  onSessionChange?: (user: HomeSessionUser | null) => void;
  /** The page shell is the only owner of the session request. */
  controlledSession?: HomeSessionSnapshot | null;
  controlledSessionLoading?: boolean;
  controlledSessionUnavailable?: boolean;
  onSessionRetry?: () => void;
  /** Keeps the account dialog aligned with the page-shell session owner. */
  controlledSessionUser?: HomeSessionUser | null;
  accountDialogRequest?: number;
  accountDialogTriggerRef?: React.RefObject<HTMLButtonElement | null>;
  launchersHidden?: boolean;
  layoutDialogRequest?: number;
};

type PanelTab = "layout" | "account";
type WidgetId = "today" | "summary" | "exchange" | "insights";
type LoginProvider = "google" | "kakao" | "naver";
type SessionProvider = LoginProvider;
export type HomeSessionUser = { id: string; displayName: string; email: string; provider: SessionProvider; isDeveloper: boolean };
type ProviderFlags = Record<LoginProvider, boolean>;
type SignInPaths = Partial<Record<LoginProvider, string>>;
export type HomeSessionSnapshot = {
  authenticated?: boolean;
  isDeveloper?: boolean;
  expiresAt?: number | string | null;
  provider?: SessionProvider;
  providers?: Partial<ProviderFlags>;
  signInPaths?: SignInPaths;
  /** Kept for compatibility with the first Sites-only session endpoint. */
  signInPath?: string;
  user?: { id?: string; displayName?: string; email?: string };
};

const WIDGET_IDS: WidgetId[] = [
  "today",
  "summary",
  "exchange",
  "insights",
];

// Google remains a valid legacy session provider, but the current member-facing
// sign-in surface intentionally exposes only the two supported providers.
const LOGIN_PROVIDERS: LoginProvider[] = ["kakao", "naver"];
const copy = {
  ko: {
    easyTitle: "쉬운 화면을 사용하고 있어요",
    easyDescription: "복잡한 정보는 줄이고 꼭 필요한 내용을 차근차근 보여드려요.",
    easyLargeText: "큰 글씨",
    easyOneStep: "한 번에 한 단계",
    easyChartSummary: "차트 핵심 요약",
    customizeHome: "홈 편집",
    signIn: "로그인",
    account: "내 계정",
    dialogTitle: "홈 및 계정 설정",
    close: "닫기",
    layoutTab: "홈 구성",
    accountTab: "로그인",
    layoutTitle: "홈에서 볼 정보를 선택하세요",
    layoutDescription: "항목을 숨기거나 순서를 바꿀 수 있어요. 변경 사항은 바로 적용됩니다.",
    reset: "기본값으로 되돌리기",
    showWidget: "표시",
    hideWidget: "숨김",
    moveUp: "위로 이동",
    moveDown: "아래로 이동",
    widgets: {
      today: "오늘 할 일",
      summary: "내 금융 상태",
      exchange: "환율·공식 정보",
      insights: "분야별 정보 바로가기",
    },
    accountTitle: "원하는 계정으로 BORA를 시작하세요",
    accountDescription: "설정된 로그인만 사용할 수 있으며, 연결되지 않은 서비스는 명확하게 구분됩니다.",
    providers: {
      google: "Google로 계속하기",
      kakao: "카카오로 계속하기",
      naver: "네이버로 계속하기",
    },
    providerNames: {
      google: "Google",
      kakao: "카카오",
      naver: "네이버",
    },
    available: "사용 가능",
    unavailable: "현재 사용할 수 없음",
    comingSoon: "향후 지원 예정",
    checkingSession: "로그인 상태 확인 중",
    signedInWith: "로그인 제공자",
    signOut: "로그아웃",
    signingOut: "로그아웃 중…",
    signOutFailed: "로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    sessionUnavailable: "로그인 상태를 확인하지 못했습니다. 기존 로그인 정보는 변경하지 않았습니다.",
    retrySession: "다시 확인",
    privacyNote: "로그인은 계정 장부 저장에 사용되며, 계좌·카드 번호는 요청하지 않습니다.",
  },
  en: {
    easyTitle: "Easy view is on",
    easyDescription: "We reduce complexity and show the most important information first.",
    easyLargeText: "Larger text",
    easyOneStep: "One step at a time",
    easyChartSummary: "Chart summaries",
    customizeHome: "Customize home",
    signIn: "Sign in",
    account: "My account",
    dialogTitle: "Home and account settings",
    close: "Close",
    layoutTab: "Home layout",
    accountTab: "Sign in",
    layoutTitle: "Choose what appears on your home",
    layoutDescription: "Hide items or change their order. Changes apply immediately.",
    reset: "Restore defaults",
    showWidget: "Shown",
    hideWidget: "Hidden",
    moveUp: "Move up",
    moveDown: "Move down",
    widgets: {
      today: "Today's actions",
      summary: "My money status",
      exchange: "Rates & official data",
      insights: "Information shortcuts",
    },
    accountTitle: "Start BORA with your preferred account",
    accountDescription: "Only configured sign-in methods are available. Unavailable services are clearly marked.",
    providers: {
      google: "Continue with Google",
      kakao: "Continue with Kakao",
      naver: "Continue with Naver",
    },
    providerNames: {
      google: "Google",
      kakao: "Kakao",
      naver: "Naver",
    },
    available: "Available",
    unavailable: "Currently unavailable",
    comingSoon: "Coming soon",
    checkingSession: "Checking sign-in status",
    signedInWith: "Signed in with",
    signOut: "Sign out",
    signingOut: "Signing out…",
    signOutFailed: "We couldn't sign you out. Please try again shortly.",
    sessionUnavailable: "We could not verify the session. Existing sign-in information was left unchanged.",
    retrySession: "Check again",
    privacyNote: "Sign-in saves your workbook to your account; account and card numbers are never requested.",
  },
  ja: {
    easyTitle: "かんたん表示を使用中です",
    easyDescription: "複雑な情報を減らし、必要な内容から順番に表示します。",
    easyLargeText: "大きな文字",
    easyOneStep: "一度に一つの操作",
    easyChartSummary: "グラフの要点を表示",
    customizeHome: "ホームを編集",
    signIn: "ログイン",
    account: "マイアカウント",
    dialogTitle: "ホームとアカウントの設定",
    close: "閉じる",
    layoutTab: "ホーム構成",
    accountTab: "ログイン",
    layoutTitle: "ホームに表示する情報を選択してください",
    layoutDescription: "項目を非表示にしたり、順番を変更したりできます。変更はすぐに反映されます。",
    reset: "初期設定に戻す",
    showWidget: "表示",
    hideWidget: "非表示",
    moveUp: "上へ移動",
    moveDown: "下へ移動",
    widgets: {
      today: "今日の予定",
      summary: "私のお金の状態",
      exchange: "為替・公式情報",
      insights: "分野別ショートカット",
    },
    accountTitle: "お好みのアカウントでBORAを始めましょう",
    accountDescription: "設定済みのログイン方法のみ使用できます。利用できないサービスは明確に表示されます。",
    providers: {
      google: "Googleで続ける",
      kakao: "Kakaoで続ける",
      naver: "NAVERで続ける",
    },
    providerNames: {
      google: "Google",
      kakao: "Kakao",
      naver: "NAVER",
    },
    available: "利用可能",
    unavailable: "現在利用できません",
    comingSoon: "今後対応予定",
    checkingSession: "ログイン状態を確認中",
    signedInWith: "ログイン方法",
    signOut: "ログアウト",
    signingOut: "ログアウト中…",
    signOutFailed: "ログアウトできませんでした。しばらくしてからもう一度お試しください。",
    sessionUnavailable: "ログイン状態を確認できませんでした。既存のログイン情報は変更していません。",
    retrySession: "再確認",
    privacyNote: "ログインは口座簿をアカウントに保存するために使い、口座番号やカード番号は求めません。",
  },
  zh: {
    easyTitle: "正在使用简易模式",
    easyDescription: "减少复杂信息，并优先显示最重要的内容。",
    easyLargeText: "更大的文字",
    easyOneStep: "一次完成一个步骤",
    easyChartSummary: "图表重点摘要",
    customizeHome: "编辑首页",
    signIn: "登录",
    account: "我的账户",
    dialogTitle: "首页和账户设置",
    close: "关闭",
    layoutTab: "首页布局",
    accountTab: "登录",
    layoutTitle: "请选择首页显示的信息",
    layoutDescription: "您可以隐藏项目或调整顺序，更改会立即生效。",
    reset: "恢复默认设置",
    showWidget: "显示",
    hideWidget: "隐藏",
    moveUp: "向上移动",
    moveDown: "向下移动",
    widgets: {
      today: "今日事项",
      summary: "我的金融状态",
      exchange: "汇率与官方信息",
      insights: "分类信息入口",
    },
    accountTitle: "使用您喜欢的账户开始体验BORA",
    accountDescription: "仅可使用已配置的登录方式，暂不可用的服务会清楚标注。",
    providers: {
      google: "使用Google继续",
      kakao: "使用Kakao继续",
      naver: "使用NAVER继续",
    },
    providerNames: {
      google: "Google",
      kakao: "Kakao",
      naver: "NAVER",
    },
    available: "可用",
    unavailable: "当前不可用",
    comingSoon: "即将支持",
    checkingSession: "正在检查登录状态",
    signedInWith: "登录方式",
    signOut: "退出登录",
    signingOut: "正在退出…",
    signOutFailed: "无法退出登录，请稍后重试。",
    sessionUnavailable: "无法确认登录状态，现有登录信息未被更改。",
    retrySession: "重新检查",
    privacyNote: "登录仅用于把账本保存到账户中，不会要求输入银行账号或银行卡号。",
  },
} as const;

function isWidgetId(value: string): value is WidgetId {
  return WIDGET_IDS.includes(value as WidgetId);
}

function isSafeSignInPath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//");
}

function normalizeSessionProvider(value: HomeSessionSnapshot["provider"]): SessionProvider | null {
  if (value === "google" || value === "kakao" || value === "naver") {
    return value;
  }
  return null;
}

function providerKey(value: SessionProvider | null): LoginProvider | null {
  return value;
}

export function HomeControlCenterActions({ locale, easyMode, user, onPanelOpen }: {
  locale: HomeControlCenterLocale;
  easyMode: boolean;
  user: HomeSessionUser | null;
  onPanelOpen: (tab: "layout" | "account", trigger: HTMLButtonElement) => void;
}) {
  const t = copy[locale];
  return <div className={styles.controlCenter} data-easy-mode={easyMode ? "true" : undefined}>
      {easyMode && (
        <div className={styles.easyBanner} role="status" aria-live="polite">
          <span className={styles.easyIcon} aria-hidden="true">
            <Accessibility size={24} />
          </span>
          <div className={styles.easyCopy}>
            <strong>{t.easyTitle}</strong>
            <p>{t.easyDescription}</p>
            <ul aria-label={t.easyTitle}>
              <li><Check size={15} aria-hidden="true" />{t.easyLargeText}</li>
              <li><Check size={15} aria-hidden="true" />{t.easyOneStep}</li>
              <li><BarChart3 size={15} aria-hidden="true" />{t.easyChartSummary}</li>
            </ul>
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.controlButton}
          onClick={(event) => onPanelOpen("layout", event.currentTarget)}
        >
          <Settings2 size={18} aria-hidden="true" />
          {t.customizeHome}
        </button>
        <button
          type="button"
          className={styles.accountButton}
          onClick={(event) => onPanelOpen("account", event.currentTarget)}
        >
          <UserRound size={18} aria-hidden="true" />
          {user ? t.account : t.signIn}
        </button>
      </div>
    </div>;
}

export default function HomeControlCenter({
  locale,
  easyMode,
  widgetOrder,
  hiddenWidgets,
  onWidgetOrderChange,
  onHiddenWidgetsChange,
  onResetLayout,
  onSessionChange,
  controlledSession,
  controlledSessionLoading = true,
  controlledSessionUnavailable = false,
  onSessionRetry,
  controlledSessionUser,
  accountDialogRequest = 0,
  accountDialogTriggerRef,
  launchersHidden = false,
  layoutDialogRequest = 0,
}: HomeControlCenterProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>("layout");
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const layoutTabRef = useRef<HTMLButtonElement>(null);
  const accountTabRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  // These counters are edge-triggered. Seeding them from the current props
  // prevents a dialog that the user already closed from reopening on remount.
  const consumedAccountRequest = useRef(accountDialogRequest);
  const consumedLayoutRequest = useRef(layoutDialogRequest);
  const t = copy[locale];
  const displayedSessionUser = controlledSessionUser ?? null;
  const displayedProvider = controlledSessionUser?.provider
    ?? normalizeSessionProvider(controlledSession?.provider);
  const providerFlags: ProviderFlags = {
    google: controlledSession?.providers?.google === true,
    kakao: controlledSession?.providers?.kakao === true,
    naver: controlledSession?.providers?.naver === true,
  };
  const signInPaths = useMemo(() => {
    const paths: SignInPaths = {};
    for (const provider of LOGIN_PROVIDERS) {
      const path = controlledSession?.signInPaths?.[provider];
      if (isSafeSignInPath(path)) paths[provider] = path;
    }
    return paths;
  }, [controlledSession]);
  const sessionLoading = controlledSessionLoading;

  const orderedWidgets = useMemo(() => {
    const provided = widgetOrder.filter(isWidgetId);
    const unique = provided.filter((id, index) => provided.indexOf(id) === index);
    return [...unique, ...WIDGET_IDS.filter((id) => !unique.includes(id))];
  }, [widgetOrder]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (dialogOpen && !dialog.open) {
      dialog.showModal();
      window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    } else if (!dialogOpen && dialog.open) {
      dialog.close();
    }
  }, [dialogOpen]);

  useEffect(() => {
    if (accountDialogRequest <= consumedAccountRequest.current) return;
    lastTriggerRef.current = accountDialogTriggerRef?.current ?? null;
    const frame = window.requestAnimationFrame(() => {
      consumedAccountRequest.current = accountDialogRequest;
      setActiveTab("account");
      setDialogOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [accountDialogRequest, accountDialogTriggerRef]);

  useEffect(() => {
    if (layoutDialogRequest <= consumedLayoutRequest.current) return;
    lastTriggerRef.current = accountDialogTriggerRef?.current ?? null;
    const frame = window.requestAnimationFrame(() => {
      consumedLayoutRequest.current = layoutDialogRequest;
      setActiveTab("layout");
      setDialogOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [layoutDialogRequest, accountDialogTriggerRef]);

  useEffect(() => {
    window.localStorage.removeItem("bora-demo-account");
  }, []);

  function openDialog(tab: PanelTab, trigger: HTMLButtonElement) {
    lastTriggerRef.current = trigger;
    setActiveTab(tab);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    window.requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }

  function selectTab(tab: PanelTab, focus = false) {
    setActiveTab(tab);
    if (focus) {
      window.requestAnimationFrame(() => {
        (tab === "layout" ? layoutTabRef.current : accountTabRef.current)?.focus();
      });
    }
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    selectTab(activeTab === "layout" ? "account" : "layout", true);
  }

  function toggleWidget(widgetId: WidgetId) {
    const isHidden = hiddenWidgets.includes(widgetId);
    const nextHidden = isHidden
      ? hiddenWidgets.filter((id) => id !== widgetId)
      : [...new Set([...hiddenWidgets, widgetId])];
    onHiddenWidgetsChange(nextHidden);
  }

  function moveWidget(widgetId: WidgetId, direction: -1 | 1) {
    const currentIndex = orderedWidgets.indexOf(widgetId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedWidgets.length) return;

    const nextOrder = [...orderedWidgets];
    [nextOrder[currentIndex], nextOrder[targetIndex]] = [
      nextOrder[targetIndex],
      nextOrder[currentIndex],
    ];
    onWidgetOrderChange(nextOrder);
  }

  async function signOutExternalSession() {
    if (logoutPending) return;
    setLogoutPending(true);
    setLogoutError(false);

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("Logout failed");
      onSessionChange?.(null);
      window.location.assign("/");
    } catch {
      setLogoutError(true);
      setLogoutPending(false);
    }
  }

  const currentProviderKey = providerKey(displayedProvider);

  return (
    <section
      className={launchersHidden ? styles.dialogOnly : styles.controlCenter}
      aria-label={t.dialogTitle}
    >
      {!launchersHidden && <HomeControlCenterActions locale={locale} easyMode={easyMode} user={displayedSessionUser} onPanelOpen={openDialog} />}

      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="home-control-center-title"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClose={() => setDialogOpen(false)}
      >
        <div className={styles.dialogHeader}>
          <div>
            <span className={styles.dialogEyebrow}>BORA PERSONALIZATION</span>
            <h2 id="home-control-center-title">{t.dialogTitle}</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.iconButton}
            onClick={closeDialog}
            aria-label={t.close}
          >
            <X size={21} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.tabs} role="tablist" aria-label={t.dialogTitle}>
          <button
            ref={layoutTabRef}
            type="button"
            role="tab"
            id="home-layout-tab"
            aria-controls="home-layout-panel"
            aria-selected={activeTab === "layout"}
            tabIndex={activeTab === "layout" ? 0 : -1}
            className={activeTab === "layout" ? styles.activeTab : undefined}
            onClick={() => selectTab("layout")}
            onKeyDown={handleTabKeyDown}
          >
            <LayoutDashboard size={17} aria-hidden="true" />
            {t.layoutTab}
          </button>
          <button
            ref={accountTabRef}
            type="button"
            role="tab"
            id="home-account-tab"
            aria-controls="home-account-panel"
            aria-selected={activeTab === "account"}
            tabIndex={activeTab === "account" ? 0 : -1}
            className={activeTab === "account" ? styles.activeTab : undefined}
            onClick={() => selectTab("account")}
            onKeyDown={handleTabKeyDown}
          >
            <LogIn size={17} aria-hidden="true" />
            {t.accountTab}
          </button>
        </div>

        {activeTab === "layout" ? (
          <div
            className={styles.tabPanel}
            id="home-layout-panel"
            role="tabpanel"
            aria-labelledby="home-layout-tab"
          >
            <div className={styles.sectionHeading}>
              <div>
                <h3>{t.layoutTitle}</h3>
                <p>{t.layoutDescription}</p>
              </div>
              <button type="button" className={styles.resetButton} onClick={onResetLayout}>
                <RotateCcw size={16} aria-hidden="true" />
                {t.reset}
              </button>
            </div>

            <ol className={styles.widgetList}>
              {orderedWidgets.map((widgetId, index) => {
                const visible = !hiddenWidgets.includes(widgetId);
                return (
                  <li key={widgetId} className={!visible ? styles.hiddenWidget : undefined}>
                    <label className={styles.visibilityToggle}>
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => toggleWidget(widgetId)}
                      />
                      <span className={styles.checkbox} aria-hidden="true">
                        {visible && <Check size={14} />}
                      </span>
                      <span className={styles.widgetName}>{t.widgets[widgetId]}</span>
                      <span className={styles.visibilityState}>
                        {visible ? <Eye size={15} aria-hidden="true" /> : <EyeOff size={15} aria-hidden="true" />}
                        {visible ? t.showWidget : t.hideWidget}
                      </span>
                    </label>
                    <div className={styles.orderButtons}>
                      <button
                        type="button"
                        onClick={() => moveWidget(widgetId, -1)}
                        disabled={index === 0}
                        aria-label={`${t.widgets[widgetId]}: ${t.moveUp}`}
                      >
                        <ArrowUp size={18} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveWidget(widgetId, 1)}
                        disabled={index === orderedWidgets.length - 1}
                        aria-label={`${t.widgets[widgetId]}: ${t.moveDown}`}
                      >
                        <ArrowDown size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <div
            className={styles.tabPanel}
            id="home-account-panel"
            role="tabpanel"
            aria-labelledby="home-account-tab"
          >
            <div className={styles.accountIntro}>
              <span className={styles.accountIcon} aria-hidden="true"><Sparkles size={22} /></span>
              <div>
                <h3>{t.accountTitle}</h3>
                <p>{t.accountDescription}</p>
              </div>
            </div>

            {displayedSessionUser ? (
              <div className={styles.sessionCard} aria-live="polite">
                <span className={styles.sessionAvatar} aria-hidden="true">
                  {displayedSessionUser.displayName.trim().charAt(0).toUpperCase() || "B"}
                </span>
                <div>
                  <small>
                    {t.signedInWith}: {currentProviderKey ? t.providerNames[currentProviderKey] : "BORA"}
                  </small>
                  <strong>{displayedSessionUser.displayName}</strong>
                  {displayedSessionUser.email && <span>{displayedSessionUser.email}</span>}
                </div>
                <button
                  type="button"
                  onClick={signOutExternalSession}
                  disabled={logoutPending}
                >
                  {logoutPending ? t.signingOut : t.signOut}
                </button>
              </div>
            ) : sessionLoading ? (
              <p className={styles.sessionLoading} role="status">{t.checkingSession}</p>
            ) : null}

            {logoutError && (
              <p className={styles.authError} role="alert">{t.signOutFailed}</p>
            )}

            {controlledSessionUnavailable && (
              <div className={styles.authError} role="alert">
                <p>{t.sessionUnavailable}</p>
                {onSessionRetry && <button type="button" onClick={onSessionRetry}>{t.retrySession}</button>}
              </div>
            )}

            {displayedSessionUser && (
              <div className={styles.accountLinks}>
                <a href="/mypage">
                  {locale === "ko" ? "마이페이지" : locale === "ja" ? "マイページ" : locale === "zh" ? "个人中心" : "My page"}
                </a>
                {displayedSessionUser.isDeveloper && <a href="/developer">
                  {locale === "ko" ? "개발자 모드" : locale === "ja" ? "開発者モード" : locale === "zh" ? "开发者模式" : "Developer mode"}
                </a>}
              </div>
            )}

            {!displayedSessionUser && !sessionLoading && (
              <div className={styles.providerList}>
                {LOGIN_PROVIDERS.map((provider) => {
                  const signInPath = signInPaths[provider];
                  const available = providerFlags[provider] && Boolean(signInPath);
                  const providerClass = styles[provider];
                  const mark = provider === "google" ? "G" : provider === "kakao" ? "K" : "N";

                  if (available && signInPath) {
                    return (
                      <a
                        key={provider}
                        className={`${styles.providerButton} ${providerClass}`}
                        href={signInPath}
                      >
                        <span className={styles.providerMark} aria-hidden="true">{mark}</span>
                        <span>{t.providers[provider]}</span>
                        <small>{t.available}</small>
                      </a>
                    );
                  }

                  return (
                    <button
                      key={provider}
                      type="button"
                      className={`${styles.providerButton} ${providerClass} ${styles.providerUnavailable}`}
                      disabled
                    >
                      <span className={styles.providerMark} aria-hidden="true">{mark}</span>
                      <span>{t.providers[provider]}</span>
                      <small>{provider === "google" ? t.comingSoon : t.unavailable}</small>
                    </button>
                  );
                })}
              </div>
            )}

            <p className={styles.privacyNote}>{t.privacyNote}</p>
          </div>
        )}
      </dialog>
    </section>
  );
}
