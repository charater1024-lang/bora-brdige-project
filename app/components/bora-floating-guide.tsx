"use client";

import { ArrowRight, RefreshCw, SkipForward, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";

import type { DailyFinanceGuide, DailyFinanceGuideTask } from "@/lib/daily-finance-guide";
import styles from "./bora-floating-guide.module.css";

type Locale = "ko" | "en" | "ja" | "zh";

const localeValues = new Set<Locale>(["ko", "en", "ja", "zh"]);

const copy = {
  ko: {
    guide: "BORA GUIDE · 보리",
    close: "보리 안내 접기",
    open: "보리 안내 열기",
    loadingTitle: "오늘의 금융 과정을 확인하고 있어요",
    loadingBody: "잠시만 기다리면 놓치기 쉬운 한 가지를 먼저 알려드릴게요.",
    errorTitle: "오늘의 추천을 불러오지 못했어요",
    errorBody: "연결 상태를 확인한 뒤 다시 시도해 주세요. 다른 기능은 계속 이용할 수 있어요.",
    retry: "다시 시도",
    position: (current: number, total: number) => `추천 ${current}/${total}`,
    signedOutTitle: "맞춤 안내는 로그인부터 시작해요",
    signedOutBody: "로그인하면 자산 장부, 정책 조건, 새 공식 정보의 확인 상태가 계정에 저장돼요.",
    signedOutAction: "로그인하기",
    completedTitle: "오늘의 금융 확인을 모두 마쳤어요",
    completedBody: "새 공식 정보가 도착하면 보리가 다시 알려드릴게요.",
    completedAction: "정책 정보 둘러보기",
    tasks: {
      "finance-review": ["자산 장부를 확인할 시간이에요", "자산과 월 현금흐름에 달라진 값이 있는지 확인해 보세요.", "자산 장부 열기"],
      "profile-setup": ["내게 맞는 정책 조건을 완성해요", "출생연도·지역·현재 상태를 입력하면 무관한 정책을 줄일 수 있어요.", "맞춤 정보 설정"],
      "official-updates": ["새 정책·금융 정보를 확인해요", "읽지 않은 공식 정보가 있는지 정책 정보 페이지에서 확인해 보세요.", "정책 정보 보기"],
    },
  },
  en: {
    guide: "BORA GUIDE · BORI",
    close: "Collapse Bori guide",
    open: "Open Bori guide",
    loadingTitle: "Checking today’s finance tasks",
    loadingBody: "Bori will highlight one useful next step in a moment.",
    errorTitle: "Today’s recommendations could not be loaded",
    errorBody: "Check your connection and try again. You can keep using the rest of BORA Bridge.",
    retry: "Try again",
    position: (current: number, total: number) => `Suggestion ${current}/${total}`,
    signedOutTitle: "Sign in for a personal checklist",
    signedOutBody: "Your money book, matching preferences and unread official updates can follow your account.",
    signedOutAction: "Sign in",
    completedTitle: "Today’s finance checks are complete",
    completedBody: "Bori will let you know when new official information arrives.",
    completedAction: "Browse policy information",
    tasks: {
      "finance-review": ["Time to review your money book", "Check whether your assets or monthly cash flow changed.", "Open money book"],
      "profile-setup": ["Complete your matching preferences", "Add your birth year, region and current status to reduce unrelated policies.", "Manage preferences"],
      "official-updates": ["Review new policy and finance updates", "Open the information portal to see unread official records.", "Open policy information"],
    },
  },
  ja: {
    guide: "BORA GUIDE · ボリ",
    close: "ボリの案内を閉じる",
    open: "ボリの案内を開く",
    loadingTitle: "今日の金融チェックを確認中です",
    loadingBody: "見落としやすい次の行動をまもなくお知らせします。",
    errorTitle: "今日のおすすめを読み込めませんでした",
    errorBody: "接続を確認して再試行してください。他の機能は引き続き利用できます。",
    retry: "再試行",
    position: (current: number, total: number) => `おすすめ ${current}/${total}`,
    signedOutTitle: "ログインして個別案内を始めましょう",
    signedOutBody: "資産台帳・おすすめ条件・未読の公式情報をアカウントに保存できます。",
    signedOutAction: "ログイン",
    completedTitle: "今日の金融チェックは完了です",
    completedBody: "新しい公式情報が届いたら、ボリがお知らせします。",
    completedAction: "政策情報を見る",
    tasks: {
      "finance-review": ["資産台帳を確認しましょう", "資産や月間キャッシュフローの変化を確認してください。", "資産台帳を開く"],
      "profile-setup": ["おすすめ条件を完成しましょう", "生年・地域・現在の状態を追加すると、無関係な政策を減らせます。", "条件を設定"],
      "official-updates": ["新しい政策・金融情報を確認", "公式情報ポータルで未読情報を確認してください。", "政策情報を見る"],
    },
  },
  zh: {
    guide: "BORA GUIDE · BORI",
    close: "收起Bori提示",
    open: "打开Bori提示",
    loadingTitle: "正在检查今天的金融任务",
    loadingBody: "Bori马上会优先提醒一个容易遗漏的步骤。",
    errorTitle: "无法加载今天的推荐",
    errorBody: "请检查连接后重试。其他功能仍可继续使用。",
    retry: "重试",
    position: (current: number, total: number) => `推荐 ${current}/${total}`,
    signedOutTitle: "登录后开始个性化提醒",
    signedOutBody: "资产账本、匹配条件和未读官方信息可随账户保存。",
    signedOutAction: "登录",
    completedTitle: "今天的金融检查已完成",
    completedBody: "有新的官方信息时，Bori会再次提醒。",
    completedAction: "浏览政策信息",
    tasks: {
      "finance-review": ["该检查资产账本了", "请确认资产或每月现金流是否有变化。", "打开资产账本"],
      "profile-setup": ["完善政策匹配条件", "补充出生年份、地区和当前状态，以减少无关政策。", "设置匹配信息"],
      "official-updates": ["查看新的政策与金融信息", "请在官方信息页面确认未读内容。", "查看政策信息"],
    },
  },
} as const;

const skipCopy: Record<Locale, string> = {
  ko: "다음 추천",
  en: "Next",
  ja: "次のおすすめ",
  zh: "下一项",
};

function readLocale(): Locale {
  const saved = window.localStorage.getItem("bora-locale");
  return localeValues.has(saved as Locale) ? saved as Locale : "ko";
}

function taskHref(task: DailyFinanceGuideTask) {
  if (task.id === "finance-review") return "/assets";
  if (task.id === "profile-setup") return "/mypage";
  return "/information/youth";
}

function isFormOrConsentTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest("[data-bora-floating-guide]")) return false;
  return Boolean(target.closest(
    "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='dialog'], [aria-modal='true'], fieldset",
  ));
}

export type BoraGuideVisibilityState = {
  desktopCollapsed: boolean;
  mobileViewport: boolean;
  mobileExplicitOpen: boolean;
};

type BoraGuideVisibilityAction =
  | { type: "viewport"; mobile: boolean }
  | { type: "route"; protectsSensitiveContent: boolean }
  | { type: "focus" }
  | { type: "openMobile" }
  | { type: "closeMobile" }
  | { type: "closeDesktop" }
  | { type: "toggleDesktop" };

export function initialBoraGuideVisibility(
  protectsSensitiveContent: boolean,
): BoraGuideVisibilityState {
  return {
    desktopCollapsed: protectsSensitiveContent,
    mobileViewport: false,
    mobileExplicitOpen: false,
  };
}

export function reduceBoraGuideVisibility(
  state: BoraGuideVisibilityState,
  action: BoraGuideVisibilityAction,
): BoraGuideVisibilityState {
  switch (action.type) {
    case "viewport":
      return {
        ...state,
        mobileViewport: action.mobile,
        // A mobile message is intentionally opt-in on every mobile entry.
        // The desktop preference is kept separately and is never reset here.
        mobileExplicitOpen: false,
      };
    case "route":
      return {
        ...state,
        desktopCollapsed: action.protectsSensitiveContent
          ? true
          : state.desktopCollapsed,
        // Do not carry an expanded fixed card onto a different mobile page.
        mobileExplicitOpen: false,
      };
    case "focus":
      return state.mobileViewport
        ? { ...state, mobileExplicitOpen: false }
        : { ...state, desktopCollapsed: true, mobileExplicitOpen: false };
    case "openMobile":
      return { ...state, mobileExplicitOpen: true };
    case "closeMobile":
      return { ...state, mobileExplicitOpen: false };
    case "closeDesktop":
      return { ...state, desktopCollapsed: true };
    case "toggleDesktop":
      return { ...state, desktopCollapsed: !state.desktopCollapsed };
  }
}

export function isBoraGuideCollapsed(state: BoraGuideVisibilityState) {
  return state.mobileViewport ? !state.mobileExplicitOpen : state.desktopCollapsed;
}

export function BoraFloatingGuide() {
  const pathname = usePathname();
  const messageId = useId();
  const mascotButtonRef = useRef<HTMLButtonElement>(null);
  const isPolicyPage = pathname === "/privacy" || pathname === "/terms";
  const isJudgePage = pathname === "/challenge" || pathname.startsWith("/challenge/");
  const protectsSensitiveContent = [
    "/assets",
    "/safety",
    "/ai-guide",
    "/mypage",
    "/exchange",
    "/information/finance",
    "/information/settlement",
  ]
    .some((route) => pathname === route || pathname.startsWith(`${route}/`));
  // Keep the server and first client render identical. The saved browser
  // language is synchronized immediately after hydration below.
  const [locale, setLocale] = useState<Locale>("ko");
  const [guide, setGuide] = useState<DailyFinanceGuide | null>(null);
  const [guideState, setGuideState] = useState<"loading" | "ready" | "error">("loading");
  const [guidePath, setGuidePath] = useState<string | null>(null);
  const [retryRequest, setRetryRequest] = useState(0);
  // The calculator should never start underneath an expanded fixed message,
  // including its server-rendered first frame. Other desktop pages keep theirs.
  const [visibility, dispatchVisibility] = useReducer(
    reduceBoraGuideVisibility,
    protectsSensitiveContent,
    initialBoraGuideVisibility,
  );
  const [interactionSafe, setInteractionSafe] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const handleStorage = () => setLocale(readLocale());
    handleStorage();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("bora-locale-change", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("bora-locale-change", handleStorage);
    };
  }, []);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 640px)");
    const syncViewport = () => dispatchVisibility({ type: "viewport", mobile: mobileQuery.matches });
    syncViewport();
    mobileQuery.addEventListener("change", syncViewport);
    return () => mobileQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    dispatchVisibility({ type: "route", protectsSensitiveContent });
  }, [pathname, protectsSensitiveContent]);

  useEffect(() => {
    let focusFrame = 0;

    const handleFocusIn = (event: FocusEvent) => {
      if (!isFormOrConsentTarget(event.target)) return;
      setInteractionSafe(true);
      dispatchVisibility({ type: "focus" });
    };
    const handleFocusOut = () => {
      window.cancelAnimationFrame(focusFrame);
      focusFrame = window.requestAnimationFrame(() => {
        setInteractionSafe(isFormOrConsentTarget(document.activeElement));
      });
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, []);

  useEffect(() => {
    // The home already renders BoraDailyGuide. A hidden floating guide must
    // not repeat its authenticated dashboard and finance-snapshot queries.
    if (pathname === "/" || pathname.startsWith("/developer") || isPolicyPage || isJudgePage) return;
    const controller = new AbortController();
    fetch("/api/daily-guide", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("daily_guide_unavailable");
        const result = await response.json() as DailyFinanceGuide;
        if (!result || !Array.isArray(result.tasks)) throw new Error("daily_guide_invalid");
        return result;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setGuide(result);
        setGuidePath(pathname);
        setGuideState("ready");
        setActiveIndex(0);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setGuide(null);
        setGuidePath(pathname);
        setGuideState("error");
        setActiveIndex(0);
      });
    return () => controller.abort();
  }, [isJudgePage, isPolicyPage, pathname, retryRequest]);

  const activeGuide = guidePath === pathname ? guide : null;
  const activeGuideState = guidePath === pathname ? guideState : "loading";
  const pendingTasks = useMemo(
    () => activeGuide?.tasks.filter((task) => task.state !== "complete") ?? [],
    [activeGuide],
  );

  if (pathname === "/" || pathname.startsWith("/developer") || isPolicyPage || isJudgePage) return null;

  const t = copy[locale];
  const task = pendingTasks[activeIndex % Math.max(pendingTasks.length, 1)];
  const recommendationPosition = task && pendingTasks.length > 0
    ? (activeIndex % pendingTasks.length) + 1
    : null;
  const signedOut = activeGuide?.authenticated === false;
  const completed = Boolean(activeGuide && activeGuide.completedCount === activeGuide.totalCount);
  const [title, body, action] = activeGuideState === "error"
    ? [t.errorTitle, t.errorBody, ""]
    : task
      ? t.tasks[task.id]
      : signedOut
        ? [t.signedOutTitle, t.signedOutBody, t.signedOutAction]
        : completed
          ? [t.completedTitle, t.completedBody, t.completedAction]
          : [t.loadingTitle, t.loadingBody, ""];
  const href = task
    ? taskHref(task)
    : signedOut
      ? "/mypage"
      : "/information";
  const hasBottomNavigation = ["/assets", "/opportunities", "/safety", "/ai-guide"]
    .some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const guideCollapsed = isBoraGuideCollapsed(visibility);
  const closeGuide = () => {
    dispatchVisibility({ type: visibility.mobileViewport ? "closeMobile" : "closeDesktop" });
    mascotButtonRef.current?.focus();
  };

  return <aside
    className={`${styles.shell} ${hasBottomNavigation ? styles.withBottomNavigation : ""} ${protectsSensitiveContent ? styles.protectedContent : ""} ${interactionSafe ? styles.interactionSafe : ""} ${guideCollapsed ? styles.collapsed : ""} ${!visibility.mobileExplicitOpen ? styles.mobileDefaultClosed : ""}`}
    aria-label={t.guide}
    data-bora-floating-guide
    onKeyDown={(event) => {
      if (event.key === "Escape" && !guideCollapsed) {
        event.preventDefault();
        event.stopPropagation();
        closeGuide();
      }
    }}
  >
    <div id={messageId} className={styles.message} hidden={guideCollapsed} key={task?.id ?? (activeGuideState === "error" ? "error" : signedOut ? "signed-out" : completed ? "complete" : "loading")} aria-live="polite">
      <div className={styles.messageHeader}>
        <span>{t.guide}</span>
        <button type="button" onClick={closeGuide} aria-label={t.close}><X size={15} /></button>
      </div>
      <strong>{title}</strong>
      <p>{body}</p>
      <div className={styles.messageActions}>
        {action && <Link className={styles.action} href={href}><span>{action}</span><ArrowRight size={15} /></Link>}
        {activeGuideState === "error" && <button
          type="button"
          className={styles.retry}
          onClick={() => {
            setGuide(null);
            setGuidePath(null);
            setGuideState("loading");
            setActiveIndex(0);
            setRetryRequest((current) => current + 1);
          }}
        >
          <span>{t.retry}</span><RefreshCw size={14} />
        </button>}
        {pendingTasks.length > 1 && <button
          type="button"
          className={styles.skip}
          onClick={() => setActiveIndex((current) => (current + 1) % pendingTasks.length)}
        >
          <span>{skipCopy[locale]}</span><SkipForward size={14} />
        </button>}
        {recommendationPosition !== null && (
          <span className={styles.progress} aria-live="polite">
            {t.position(recommendationPosition, pendingTasks.length)}
          </span>
        )}
        {recommendationPosition === null && activeGuide && (
          <span className={styles.progress}>{activeGuide.completedCount}/{activeGuide.totalCount}</span>
        )}
      </div>
    </div>
    <button
      type="button"
      ref={mascotButtonRef}
      className={styles.mascotButton}
      onClick={() => {
        if (window.matchMedia("(max-width: 640px)").matches) {
          if (visibility.mobileExplicitOpen) {
            dispatchVisibility({ type: "closeMobile" });
            mascotButtonRef.current?.focus();
          } else {
            dispatchVisibility({ type: "openMobile" });
          }
          return;
        }
        dispatchVisibility({ type: "toggleDesktop" });
      }}
      aria-label={guideCollapsed ? t.open : t.close}
      aria-expanded={!guideCollapsed}
      aria-controls={messageId}
    >
      <Image src="/bora-mascot.webp" width={92} height={92} sizes="92px" alt="" aria-hidden="true" unoptimized />
    </button>
  </aside>;
}
