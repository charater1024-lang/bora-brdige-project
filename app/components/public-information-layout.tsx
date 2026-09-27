"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Accessibility, ArrowLeft, Banknote, BarChart3, BriefcaseBusiness, ChevronDown, Globe2, Landmark, LogIn, LogOut, RefreshCw, Sparkles, UserRound } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { fetchAuthJson, localLogoutCompleted } from "@/lib/auth/client-requests";
import styles from "./public-information-pages.module.css";

export type PublicInformationLocale = "ko" | "en" | "ja" | "zh";

const localeContext = createContext<PublicInformationLocale>("ko");

const navigationCopy: Record<PublicInformationLocale, {
  skip: string;
  back: string;
  hub: string;
  youth: string;
  finance: string;
  startup: string;
  employment: string;
  exchange: string;
  easy: string;
  language: string;
  mypage: string;
  accountMenu: string;
  signedIn: string;
  signIn: string;
  signOut: string;
  signingOut: string;
  signOutFailed: string;
  sessionChecking: string;
  sessionCheckFailed: string;
  retrySession: string;
  privacy: string;
  terms: string;
  provenance: string;
  footer: string;
}> = {
  ko: { skip: "본문으로 건너뛰기", back: "BORA 홈", hub: "정보 홈", youth: "청년 정책", finance: "금융 정보", startup: "창업·상권", employment: "취업 통계", exchange: "환율", easy: "쉬운 모드", language: "언어 선택", mypage: "마이페이지", accountMenu: "계정 메뉴", signedIn: "로그인됨", signIn: "로그인", signOut: "로그아웃", signingOut: "로그아웃 중…", signOutFailed: "로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.", sessionChecking: "로그인 상태 확인 중…", sessionCheckFailed: "로그인 상태를 확인하지 못했습니다.", retrySession: "다시 확인", privacy: "개인정보 처리방침", terms: "이용약관", provenance: "공식 출처 · 갱신 시각 제공", footer: "공식 데이터는 참고 자료이며 신청·계약 전 제공기관 원문을 확인해 주세요." },
  en: { skip: "Skip to content", back: "BORA home", hub: "Data home", youth: "Youth policy", finance: "Finance", startup: "Startup & districts", employment: "Employment stats", exchange: "Exchange", easy: "Easy mode", language: "Choose language", mypage: "My page", accountMenu: "Account menu", signedIn: "Signed in", signIn: "Sign in", signOut: "Sign out", signingOut: "Signing out…", signOutFailed: "We could not sign you out. Please try again.", sessionChecking: "Checking sign-in status…", sessionCheckFailed: "We could not confirm your sign-in status.", retrySession: "Check again", privacy: "Privacy", terms: "Terms", provenance: "Official sources · Updated-at details", footer: "Official data is for reference. Check the provider's original notice before applying or signing." },
  ja: { skip: "本文へ移動", back: "BORAホーム", hub: "情報ホーム", youth: "若者政策", finance: "金融情報", startup: "創業・商圏", employment: "就業統計", exchange: "為替", easy: "かんたんモード", language: "言語を選択", mypage: "マイページ", accountMenu: "アカウントメニュー", signedIn: "ログイン中", signIn: "ログイン", signOut: "ログアウト", signingOut: "ログアウト中…", signOutFailed: "ログアウトできませんでした。時間をおいて再試行してください。", sessionChecking: "ログイン状態を確認中…", sessionCheckFailed: "ログイン状態を確認できませんでした。", retrySession: "再確認", privacy: "プライバシー", terms: "利用規約", provenance: "公式出典・更新日時を表示", footer: "公式データは参考情報です。申請・契約前に提供機関の原文をご確認ください。" },
  zh: { skip: "跳至正文", back: "BORA首页", hub: "信息首页", youth: "青年政策", finance: "金融信息", startup: "创业与商圈", employment: "就业统计", exchange: "汇率", easy: "简易模式", language: "选择语言", mypage: "我的页面", accountMenu: "账户菜单", signedIn: "已登录", signIn: "登录", signOut: "退出登录", signingOut: "正在退出…", signOutFailed: "无法退出登录，请稍后重试。", sessionChecking: "正在确认登录状态…", sessionCheckFailed: "无法确认登录状态。", retrySession: "重新确认", privacy: "隐私政策", terms: "使用条款", provenance: "提供官方来源及更新时间", footer: "官方数据仅供参考，申请或签约前请确认提供机构原文。" },
};

type PublicSessionUser = {
  id: string;
  displayName: string;
};

export function usePublicInformationLocale() {
  return useContext(localeContext);
}

export default function PublicInformationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [locale, setLocale] = useState<PublicInformationLocale>("ko");
  const [easyMode, setEasyMode] = useState(false);
  const [sessionUser, setSessionUser] = useState<PublicSessionUser | null>(null);
  const [sessionState, setSessionState] = useState<"checking" | "ready" | "error">("checking");
  const [sessionRetry, setSessionRetry] = useState(0);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const sessionPrincipalRef = useRef<string | null | undefined>(undefined);
  const lastSessionRefreshRef = useRef(0);
  const t = navigationCopy[locale];

  useEffect(() => {
    const savedLocale = window.localStorage.getItem("bora-locale") as PublicInformationLocale | null;
    const savedEasyMode = window.localStorage.getItem("bora-easy") === "true";
    const timer = window.setTimeout(() => {
      if (savedLocale && navigationCopy[savedLocale]) setLocale(savedLocale);
      setEasyMode(savedEasyMode);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-Hans" : locale;
  }, [locale]);

  useEffect(() => {
    const controller = new AbortController();
    let timedOut = false;
    let expiryTimeoutId = 0;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Request timed out", "TimeoutError"));
    }, 12_000);
    fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("session_unavailable");
        return await response.json() as {
          authenticated?: boolean;
          expiresAt?: unknown;
          user?: { id?: unknown; displayName?: unknown; email?: unknown };
        };
      })
      .then((session) => {
        window.clearTimeout(timeoutId);
        if (controller.signal.aborted) return;
        const userId = typeof session.user?.id === "string" ? session.user.id.trim() : "";
        const nextPrincipal = session.authenticated && userId ? userId : null;
        if (sessionPrincipalRef.current !== undefined && sessionPrincipalRef.current !== nextPrincipal) {
          sessionPrincipalRef.current = nextPrincipal;
          // Personalized catalogues belong to the authenticated principal that
          // loaded them. A full same-origin reload clears every child cache on
          // logout, expiry or account switching.
          window.location.reload();
          return;
        }
        sessionPrincipalRef.current = nextPrincipal;
        const displayName = typeof session.user?.displayName === "string"
          ? session.user.displayName.trim()
          : "";
        const email = typeof session.user?.email === "string" ? session.user.email.trim() : "";
        setSessionUser(nextPrincipal ? { id: nextPrincipal, displayName: displayName || email || "BORA Member" } : null);
        setSessionState("ready");

        const expiresAt = typeof session.expiresAt === "number" ? session.expiresAt : Number.NaN;
        if (nextPrincipal && Number.isFinite(expiresAt)) {
          const remaining = expiresAt - Date.now();
          if (remaining <= 0) setSessionRetry((current) => current + 1);
          else expiryTimeoutId = window.setTimeout(
            () => setSessionRetry((current) => current + 1),
            Math.min(remaining + 50, 2_147_483_647),
          );
        }
      })
      .catch((error: unknown) => {
        window.clearTimeout(timeoutId);
        if (controller.signal.aborted && !timedOut) return;
        if (error instanceof DOMException && error.name === "AbortError" && !timedOut) return;
        setSessionState("error");
      });
    return () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(expiryTimeoutId);
      controller.abort();
    };
  }, [sessionRetry]);

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
    const activeLink = navigationRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeLink?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest", inline: "center" });
  }, [pathname, locale]);

  function changeLocale(nextLocale: PublicInformationLocale) {
    setLocale(nextLocale);
    window.localStorage.setItem("bora-locale", nextLocale);
    window.dispatchEvent(new Event("bora-locale-change"));
  }

  function toggleEasyMode() {
    const next = !easyMode;
    setEasyMode(next);
    window.localStorage.setItem("bora-easy", String(next));
  }

  function retrySessionCheck() {
    if (sessionState === "checking") return;
    setSessionState("checking");
    setSessionRetry((current) => current + 1);
  }

  async function signOut() {
    if (logoutPending) return;
    setLogoutPending(true);
    setLogoutError(false);
    try {
      const { response, data } = await fetchAuthJson<unknown>("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!localLogoutCompleted(response, data)) throw new Error("logout_failed");
      setSessionUser(null);
      setSessionState("ready");
      window.location.assign("/");
    } catch {
      setLogoutError(true);
      setLogoutPending(false);
    }
  }

  const links = [
    { href: "/information", label: t.hub, icon: Sparkles },
    { href: "/information/youth", label: t.youth, icon: UserRound },
    { href: "/information/finance", label: t.finance, icon: Landmark },
    { href: "/information/startup", label: t.startup, icon: BriefcaseBusiness },
    { href: "/information/employment", label: t.employment, icon: BarChart3 },
    { href: "/exchange", label: t.exchange, icon: Banknote },
    {
      href: "/information/settlement",
      label: locale === "ko" ? "외국인 정착" : locale === "ja" ? "金融定着" : locale === "zh" ? "金融落地" : "Settlement",
      icon: Globe2,
    },
  ];

  return (
    <localeContext.Provider value={locale}>
      <div className={`${styles.portalShell} ${easyMode ? styles.easyMode : ""}`}>
        <a className={styles.skipLink} href="#public-information-main">{t.skip}</a>
        <header className={styles.portalHeader}>
          <div className={styles.headerTop}>
            <Link className={styles.backHome} href="/" aria-label={t.back}><ArrowLeft size={17} /><span>{t.back}</span></Link>
            <Link className={styles.portalBrand} href="/information" aria-label={t.hub}><span aria-hidden="true">B</span><div><strong>BORA Bridge</strong><small>PUBLIC DATA PORTAL</small></div></Link>
            <div className={styles.portalTools}>
              <label className={styles.localePicker}><Globe2 size={16} /><span className={styles.srOnly}>{t.language}</span><select value={locale} onChange={(event) => changeLocale(event.target.value as PublicInformationLocale)}><option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">简体中文</option></select></label>
              <button type="button" className={styles.easyToggle} aria-label={`${t.easy}: ${easyMode ? "ON" : "OFF"}`} aria-pressed={easyMode} onClick={toggleEasyMode}><Accessibility size={17} /><span>{t.easy}</span><strong>{easyMode ? "ON" : "OFF"}</strong></button>
              <details className={styles.accountMenu}>
                <summary className={styles.myPageLink} aria-label={t.accountMenu}>
                  <span aria-hidden="true">
                    {sessionUser?.displayName.trim().charAt(0).toUpperCase() || <UserRound size={18} />}
                  </span>
                  <ChevronDown size={14} aria-hidden="true" />
                </summary>
                <div className={styles.accountPopover}>
                  <div className={styles.accountIdentity}>
                    <strong>{sessionUser?.displayName ?? "BORA Member"}</strong>
                    <small>{sessionState === "checking" ? t.sessionChecking : sessionState === "error" ? t.sessionCheckFailed : sessionUser ? t.signedIn : t.signIn}</small>
                  </div>
                  {(sessionUser || sessionState === "ready") && <Link href="/mypage">
                    {sessionUser ? <UserRound size={16} /> : <LogIn size={16} />}
                    {sessionUser ? t.mypage : t.signIn}
                  </Link>}
                  {sessionUser && <button
                    type="button"
                    onClick={() => void signOut()}
                    disabled={logoutPending}
                    aria-busy={logoutPending}
                  >
                    <LogOut size={16} />
                    {logoutPending ? t.signingOut : t.signOut}
                  </button>}
                  {sessionState === "error" && <div className={styles.sessionCheckError} role="alert">
                    <p>{t.sessionCheckFailed}</p>
                    <button type="button" onClick={retrySessionCheck}>
                      <RefreshCw size={15} />
                      {t.retrySession}
                    </button>
                  </div>}
                  {logoutError && <p role="alert">{t.signOutFailed}</p>}
                </div>
              </details>
            </div>
          </div>
          <nav ref={navigationRef} className={styles.portalNav} aria-label={t.hub}>
            {links.map(({ href, label, icon: Icon }) => {
              const active = href === "/information" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
              return <Link key={href} href={href} className={active ? styles.activeNav : undefined} aria-current={active ? "page" : undefined}><Icon size={17} /><span>{label}</span></Link>;
            })}
          </nav>
        </header>
        <main id="public-information-main" className={styles.portalMain} tabIndex={-1}>{children}</main>
        <footer className={styles.portalFooter}>
          <strong>BORA Bridge</strong>
          <p>{t.footer}</p>
          <nav aria-label={locale === "ko" ? "법적 고지" : "Legal"}>
            <Link href={`/privacy?lang=${locale}`}>{t.privacy}</Link>
            <Link href={`/terms?lang=${locale}`}>{t.terms}</Link>
          </nav>
          <span>{t.provenance}</span>
        </footer>
      </div>
    </localeContext.Provider>
  );
}
