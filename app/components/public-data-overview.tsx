"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  BarChart3,
  BriefcaseBusiness,
  ChevronRight,
  Clock3,
  ExternalLink,
  Landmark,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { PublicDataDashboard } from "@/lib/public-data/types";
import { emptyPublicDataPayload } from "@/lib/public-data/types";
import { safePublicHttpUrl } from "@/lib/public-data/urls";
import { recordRecentActivity } from "@/lib/ai/context-client";
import { ExchangeConverter } from "./exchange-converter";
import styles from "./public-data-overview.module.css";

type Locale = "ko" | "en" | "ja" | "zh";

const localeTags: Record<Locale, string> = {
  ko: "ko-KR", en: "en-US", ja: "ja-JP", zh: "zh-CN",
};

const countries: Record<string, Record<Locale, string>> = {
  USD: { ko: "미국 · 달러", en: "United States · Dollar", ja: "米国 · ドル", zh: "美国 · 美元" },
  JPY: { ko: "일본 · 엔", en: "Japan · Yen", ja: "日本 · 円", zh: "日本 · 日元" },
  CNY: { ko: "중국 · 위안", en: "China · Yuan", ja: "中国 · 元", zh: "中国 · 人民币" },
  EUR: { ko: "유로존 · 유로", en: "Eurozone · Euro", ja: "ユーロ圏 · ユーロ", zh: "欧元区 · 欧元" },
  GBP: { ko: "영국 · 파운드", en: "United Kingdom · Pound", ja: "英国 · ポンド", zh: "英国 · 英镑" },
  CAD: { ko: "캐나다 · 달러", en: "Canada · Dollar", ja: "カナダ · ドル", zh: "加拿大 · 加元" },
  AUD: { ko: "호주 · 달러", en: "Australia · Dollar", ja: "豪州 · ドル", zh: "澳大利亚 · 澳元" },
  SGD: { ko: "싱가포르 · 달러", en: "Singapore · Dollar", ja: "シンガポール · ドル", zh: "新加坡 · 新元" },
};
const trackedCurrencies = ["USD", "JPY", "CNY", "EUR", "GBP", "CAD", "AUD", "SGD"] as const;
type TrackedCurrency = (typeof trackedCurrencies)[number];

function isTrackedCurrency(value: string): value is TrackedCurrency {
  return trackedCurrencies.some((currency) => currency === value);
}

const translations = {
  ko: {
    reload: "저장 정보 다시 불러오기", reading: "저장 정보를 확인하고 있어요.",
    eyebrow: "PUBLIC DATA CENTER", title: "공식 금융·정책 정보", lead: "공식 기관별 서버 저장 원본 건수를 보고, 상세 화면에서 중복 제거된 결과를 확인하세요.",
    refresh: "새로고침", refreshing: "갱신 중", signIn: "로그인하면 필요한 때 최신 정보를 다시 확인할 수 있어요.",
    empty: "아직 불러온 공식 데이터가 없습니다.", unavailable: "공식 정보를 불러오지 못했습니다.", cached: "저장 정보", stale: "마지막 정상 데이터", live: "공식 API", notDue: "현재 최신 정보를 사용하고 있습니다. 잠시 후 다시 시도해 주세요.",
    lastSync: "마지막 업데이트", source: "공식 출처",
    exchange: "관심 국가 환율", choose: "국가·통화", per: "외화 1단위", converted: "100만원 환산", noRate: "환율 데이터 없음",
    youth: "청년 정책 정보", finance: "금융 정보", startup: "창업·상권 정보", employment: "대상별 취업 통계", newItems: "신규", total: "저장 원본", items: "건",
    exchangeDetail: "환율 시계열 보기", informationHub: "전체 정보 보기",
  },
  en: {
    reload: "Reload stored information", reading: "Loading stored information.",
    eyebrow: "PUBLIC DATA CENTER", title: "Official finance and policy data", lead: "Review stored source-row counts here, then open a detail page for deduplicated results.",
    refresh: "Refresh", refreshing: "Refreshing", signIn: "Sign in to check for updated information when needed.", empty: "No official data has been loaded yet.", unavailable: "Official information is unavailable.", cached: "Stored information", stale: "Last valid data", live: "Official API", notDue: "You are viewing the latest available information. Please try again later.",
    lastSync: "Last updated", source: "Official source", exchange: "Exchange rate", choose: "Country & currency", per: "per foreign unit", converted: "₩1M converts to", noRate: "Exchange-rate data unavailable",
    youth: "Youth policy", finance: "Financial information", startup: "Startup & district data", employment: "Employment by group", newItems: "New", total: "Stored source rows", items: "", exchangeDetail: "View exchange history", informationHub: "Open data hub",
  },
  ja: {
    reload: "保存情報を再読込", reading: "保存情報を確認しています。",
    eyebrow: "PUBLIC DATA CENTER", title: "公式金融・政策情報", lead: "公式機関から確認した最新の金融・政策情報を分野別に簡潔に確認できます。",
    refresh: "更新", refreshing: "更新中", signIn: "ログインすると、必要なときに最新情報を再確認できます。", empty: "取得済みの公式データは0件です。", unavailable: "公式情報を読み込めませんでした。", cached: "保存情報", stale: "最終正常データ", live: "公式API", notDue: "現在利用できる最新情報を表示しています。しばらくしてから再度お試しください。",
    lastSync: "最終更新", source: "公式出典", exchange: "関心国の為替", choose: "国・通貨", per: "外貨1単位", converted: "100万ウォン換算", noRate: "為替データなし",
    youth: "若者政策情報", finance: "金融情報", startup: "創業・商圏情報", employment: "対象別就業統計", newItems: "新着", total: "保存元データ", items: "件", exchangeDetail: "為替推移を見る", informationHub: "情報ハブを見る",
  },
  zh: {
    reload: "重新加载已存信息", reading: "正在加载已存信息。",
    eyebrow: "PUBLIC DATA CENTER", title: "官方金融与政策信息", lead: "按领域简要查看由官方机构确认的最新金融与政策信息。",
    refresh: "刷新", refreshing: "刷新中", signIn: "登录后可在需要时重新检查最新信息。", empty: "尚未加载官方数据。", unavailable: "无法加载官方信息。", cached: "已存信息", stale: "最后有效数据", live: "官方API", notDue: "当前显示的是可用的最新信息，请稍后再试。",
    lastSync: "最后更新", source: "官方来源", exchange: "关注国家汇率", choose: "国家与货币", per: "每1单位外币", converted: "100万韩元可兑换", noRate: "暂无汇率数据",
    youth: "青年政策信息", finance: "金融信息", startup: "创业与商圈信息", employment: "分群就业统计", newItems: "新增", total: "保存原始数据", items: "条", exchangeDetail: "查看汇率走势", informationHub: "打开信息中心",
  },
} satisfies Record<Locale, Record<string, string>>;

const emptyDashboard: PublicDataDashboard = {
  ...emptyPublicDataPayload(), status: "empty", cached: false, stale: false,
  lastSuccessfulAt: null, nextRefreshAt: null, canRefresh: false,
  refreshInSeconds: 0, authenticated: false, sourceSchedules: [],
};

const OVERVIEW_READ_TIMEOUT_MS = 10_000;

async function readStoredDashboard(signal: AbortSignal): Promise<PublicDataDashboard> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) controller.abort();
  let timer: number | undefined;
  try {
    // Bound both headers and JSON parsing. The race also protects the UI when
    // a transport does not settle its promise after cancellation.
    return await Promise.race([
      (async () => {
        const response = await fetch("/api/public-data/dashboard", {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        if (!response.ok) throw new Error("dashboard_unavailable");
        return await response.json() as PublicDataDashboard;
      })(),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          controller.abort();
          reject(new Error("dashboard_read_timeout"));
        }, OVERVIEW_READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

function formatDate(value: string | null, locale: Locale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(localeTags[locale], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export default function PublicDataOverview({
  locale,
  userId,
  compact = false,
}: {
  locale: Locale;
  userId?: string | null;
  compact?: boolean;
}) {
  const t = translations[locale];
  const principal = userId ?? null;
  const [storedDashboard, setDashboard] = useState<PublicDataDashboard>(emptyDashboard);
  const [dashboardPrincipal, setDashboardPrincipal] = useState<string | null | undefined>(undefined);
  const dashboard = dashboardPrincipal === principal ? storedDashboard : emptyDashboard;
  const [selectedCurrency, setSelectedCurrency] = useState("USD");
  const [requestPending, setLoading] = useState(true);
  const [refreshPending, setRefreshing] = useState(false);
  const [resolvedPrincipal, setResolvedPrincipal] = useState<string | null | undefined>(undefined);
  const loading = requestPending || resolvedPrincipal !== principal;
  const refreshing = refreshPending && resolvedPrincipal === principal;
  const busy = loading || refreshing;
  const [loadFailed, setLoadFailed] = useState(false);
  const [noticeCode, setNotice] = useState<"" | "notDue" | "empty" | "unavailable" | "signIn">("");
  const notice = noticeCode ? t[noticeCode] : "";
  const requestSequence = useRef(0);
  const requestAbort = useRef<AbortController | null>(null);
  const [cacheReadRequest, setCacheReadRequest] = useState<{ principal: string | null; generation: number } | null>(null);

  const loadCache = useCallback(async (requestId: number, signal: AbortSignal, owner: string | null) => {
    const data = await readStoredDashboard(signal);
    if (requestId !== requestSequence.current) return data;
    if (signal.aborted) return data;
    setDashboard(data);
    setDashboardPrincipal(owner);
    setLoadFailed(false);
    return data;
  }, []);

  const requestRefresh = useCallback(async (trigger: "login" | "manual") => {
    const requestId = ++requestSequence.current;
    requestAbort.current?.abort();
    const controller = new AbortController();
    requestAbort.current = controller;
    // Collection is background work once a stored dashboard is available.
    // Keep its numbers and rates visible while preventing duplicate refreshes.
    setLoading(false);
    setResolvedPrincipal(principal);
    setRefreshing(true);
    setNotice("");
    try {
      const response = await fetch("/api/public-data/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ trigger }),
        signal: controller.signal,
      });
      const data = await response.json() as PublicDataDashboard & { refreshResult?: string };
      if (requestId !== requestSequence.current) return;
      if (controller.signal.aborted) return;
      if (response.status === 401) throw new Error("authentication_required");
      if (response.status === 429) {
        setDashboard(data);
        setDashboardPrincipal(principal);
        setLoadFailed(false);
        setNotice("notDue");
        return;
      }
      if (!response.ok) throw new Error("refresh_unavailable");
      setDashboard(data);
      setDashboardPrincipal(principal);
      setLoadFailed(false);
      if (data.refreshResult === "unavailable") setNotice("empty");
      // Mark completion, not scheduling: an aborted Strict Mode mount or
      // account switch must not suppress the next legitimate login refresh.
      if (trigger === "login" && principal) {
        try { window.sessionStorage.setItem(`bora-public-data-initialized:${principal}`, "true"); } catch { /* Storage may be unavailable. */ }
      }
    } catch {
      if (requestId !== requestSequence.current) return;
      if (controller.signal.aborted) return;
      setNotice(principal ? "unavailable" : "signIn");
      await loadCache(requestId, controller.signal, principal).catch(() => {
        if (requestId === requestSequence.current && !controller.signal.aborted) setLoadFailed(true);
      });
    } finally {
      if (requestId === requestSequence.current && !controller.signal.aborted) {
        requestAbort.current = null;
        setResolvedPrincipal(principal);
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [loadCache, principal]);

  useEffect(() => {
    const requestId = ++requestSequence.current;
    requestAbort.current?.abort();
    const controller = new AbortController();
    requestAbort.current = controller;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setRefreshing(false);
      setLoadFailed(false);
      setNotice("");
      void loadCache(requestId, controller.signal, principal).then(async (data) => {
        if (requestId !== requestSequence.current || controller.signal.aborted) return;
        // Paint the stored dashboard first. Start collection only when the
        // server says it is due; never race it against the initial cache read.
        if (cacheReadRequest?.principal === principal || !principal || !data.authenticated || !data.canRefresh) return;
        try {
          if (window.sessionStorage.getItem(`bora-public-data-initialized:${principal}`) === "true") return;
        } catch { /* A blocked browser storage does not block official data. */ }
        await requestRefresh("login");
      }).catch(() => {
        if (requestId !== requestSequence.current || controller.signal.aborted) return;
        setLoadFailed(true);
        setNotice("unavailable");
      }).finally(() => {
        if (requestId !== requestSequence.current || controller.signal.aborted) return;
        requestAbort.current = null;
        setResolvedPrincipal(principal);
        setLoading(false);
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestSequence.current += 1;
      requestAbort.current?.abort();
      requestAbort.current = null;
    };
  }, [cacheReadRequest, loadCache, principal, requestRefresh]);

  useEffect(() => {
    const savedCurrency = window.localStorage.getItem("bora-home-currency");
    const timer = window.setTimeout(() => {
      if (savedCurrency && countries[savedCurrency]) setSelectedCurrency(savedCurrency);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (dashboard.refreshInSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setDashboard((current) => {
        const refreshInSeconds = Math.max(0, current.refreshInSeconds - 60);
        return {
          ...current,
          refreshInSeconds,
          canRefresh: Boolean(userId) && refreshInSeconds === 0,
        };
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [dashboard.refreshInSeconds, userId]);

  const collectionWarning = dashboard.stale || dashboard.sources.some((source) => source.collectionStatus === "delayed" || source.collectionStatus === "unavailable");
  const rate = dashboard.exchange.rates.find((item) => item.currency === selectedCurrency) ?? null;
  const exchangeSourceUrl = safePublicHttpUrl(dashboard.exchange.sourceUrl);
  const categoryLabels = { youth: t.youth, finance: t.finance, startup: t.startup, employment: t.employment };
  const categoryIcons = { youth: Sparkles, finance: Landmark, startup: BriefcaseBusiness, employment: BarChart3 };
  const categoryLinks = {
    youth: "/information/youth",
    finance: "/information/finance",
    startup: "/information/startup",
    employment: "/information/employment",
  };
  const totalRecords = useMemo(
    () => dashboard.categories.reduce((sum, group) => sum + group.totalCount, 0),
    [dashboard.categories],
  );
  const newRecords = useMemo(
    () => dashboard.categories.reduce((sum, group) => sum + group.newCount, 0),
    [dashboard.categories],
  );

  function changeCurrency(value: string) {
    if (!isTrackedCurrency(value)) return;
    setSelectedCurrency(value);
    window.localStorage.setItem("bora-home-currency", value);
    void recordRecentActivity({ activityType: "exchange", targetCode: value });
  }

  const reloadStored = () => setCacheReadRequest((current) => ({ principal, generation: (current?.generation ?? 0) + 1 }));
  const readFailure = <div className={styles.failure} role="status"><RefreshCw size={24} /><p>{t.unavailable}</p><button className={styles.headerLink} type="button" onClick={reloadStored} disabled={busy}>{t.reload}</button></div>;

  if (compact) {
    return (
      <section className={`${styles.overview} ${styles.compact}`} aria-labelledby="public-data-title" aria-busy={busy}>
        <div className={styles.header}>
          <div>
            <span>{t.eyebrow}</span>
            <h2 id="public-data-title">{t.title}</h2>
            <p>{t.lead}</p>
          </div>
          <Link className={styles.headerLink} href="/information">{t.informationHub}<ChevronRight size={15} /></Link>
        </div>

        {loadFailed ? (
          readFailure
        ) : (
          <div className={styles.compactGrid}>
            <article className={styles.compactExchange}>
              <div className={styles.compactTitle}>
                <span className={styles.categoryIcon}><Banknote size={20} /></span>
                <div><strong>{t.exchange}</strong><small>{dashboard.exchange.asOf ?? "—"} · {dashboard.exchange.source}</small></div>
              </div>
              <label>
                <span>{t.choose}</span>
                <select value={selectedCurrency} onChange={(event) => changeCurrency(event.target.value)}>
                  {Object.keys(countries).map((currency) => <option key={currency} value={currency}>{countries[currency][locale]} ({currency})</option>)}
                </select>
              </label>
              <div className={styles.compactConverter}>
                <ExchangeConverter
                  compact
                  locale={locale}
                  currency={selectedCurrency}
                  baseRate={rate?.baseRate ?? null}
                />
                <Link href="/exchange">{t.exchangeDetail}<ChevronRight size={14} /></Link>
              </div>
            </article>

            <article className={styles.compactUpdates}>
              <div className={styles.compactUpdateHeading}>
                <div>
                  <span>{loading ? t.reading : refreshing ? t.refreshing : collectionWarning ? t.stale : dashboard.cached ? t.cached : t.empty}</span>
                  <strong>{loading ? "—" : newRecords > 0 ? `${t.newItems} ${newRecords}${t.items}` : `${t.total} ${totalRecords}${t.items}`}</strong>
                </div>
                <button type="button" onClick={() => void requestRefresh("manual")} aria-busy={busy} disabled={busy || !dashboard.canRefresh} aria-label={busy ? t.refreshing : t.refresh}>
                  <RefreshCw size={17} className={busy ? styles.spin : undefined} />
                </button>
              </div>
              <div className={styles.compactCategories}>
                {dashboard.categories.slice(0, 4).map((group) => {
                  const Icon = categoryIcons[group.id];
                  return <Link key={group.id} href={categoryLinks[group.id]}>
                    <Icon size={17} />
                    <span>{categoryLabels[group.id]}</span>
                    <strong title={t.total}>{loading ? "—" : group.totalCount.toLocaleString(localeTags[locale])}</strong>
                    {group.newCount > 0 && <em>+{group.newCount}</em>}
                  </Link>;
                })}
              </div>
              <small className={styles.compactUpdated}><Clock3 size={13} />{t.lastSync} {formatDate(dashboard.lastSuccessfulAt, locale)}</small>
            </article>
          </div>
        )}
        {!loading && !dashboard.authenticated && <p className={styles.notice}>{t.signIn}</p>}
        {!loadFailed && <button className={styles.headerLink} type="button" onClick={reloadStored} disabled={busy}>{t.reload}</button>}
        {notice && <p className={styles.notice}>{notice}</p>}
      </section>
    );
  }

  return (
    <section className={styles.overview} aria-labelledby="public-data-title" aria-busy={busy}>
      <div className={styles.header}>
        <div>
          <span>{t.eyebrow}</span>
          <h2 id="public-data-title">{t.title}</h2>
          <p>{t.lead}</p>
        </div>
        <button type="button" onClick={() => void requestRefresh("manual")} aria-busy={busy} disabled={busy || !dashboard.canRefresh} title={!dashboard.authenticated ? t.signIn : undefined}>
          <RefreshCw size={16} className={busy ? styles.spin : undefined} />
          {busy ? t.refreshing : t.refresh}
        </button>
      </div>

      <div className={styles.syncBar} role="status">
        <span className={`${styles.status} ${loadFailed || collectionWarning ? styles.warning : dashboard.cached ? styles.ok : ""}`}>
          {loadFailed ? t.unavailable : busy ? t.refreshing : collectionWarning ? t.stale : dashboard.cached ? t.cached : t.empty}
        </span>
        <span><Clock3 size={14} />{t.lastSync} {formatDate(dashboard.lastSuccessfulAt, locale)}</span>
        <strong>{loadFailed || loading ? "—" : `${totalRecords}${t.items}`}</strong>
      </div>
      {!loading && !dashboard.authenticated && <p className={styles.notice}>{t.signIn}</p>}
      {notice && <p className={styles.notice}>{notice}</p>}
      {!loadFailed && <button className={styles.headerLink} type="button" onClick={reloadStored} disabled={busy}>{t.reload}</button>}

      {loadFailed ? readFailure : <>
      <div className={styles.exchange}>
        <div className={styles.exchangeTitle}><Banknote size={20} /><div><strong>{t.exchange}</strong><span>{dashboard.exchange.asOf ?? "—"} · {dashboard.exchange.source}</span>{exchangeSourceUrl && <a href={exchangeSourceUrl} target="_blank" rel="noopener noreferrer">{t.source}<ExternalLink size={11} /></a>}</div></div>
        <label><span>{t.choose}</span><select value={selectedCurrency} onChange={(event) => changeCurrency(event.target.value)}>{Object.keys(countries).map((currency) => <option key={currency} value={currency}>{countries[currency][locale]} ({currency})</option>)}</select></label>
        <div className={styles.converterSlot}>
          <ExchangeConverter
            locale={locale}
            currency={selectedCurrency}
            baseRate={rate?.baseRate ?? null}
          />
          <Link href="/exchange">{t.exchangeDetail}<ChevronRight size={14} /></Link>
        </div>
      </div>

      <div className={styles.categories}>
        {dashboard.categories.map((group) => {
          const Icon = categoryIcons[group.id];
          return <Link key={group.id} href={categoryLinks[group.id]}>
            <span className={styles.categoryIcon}><Icon size={21} /></span>
            <span><strong>{categoryLabels[group.id]}</strong><small>{t.total} {group.totalCount}{t.items}</small></span>
            <em>{t.newItems} {group.newCount}{t.items}</em>
            <ChevronRight size={18} />
          </Link>;
        })}
      </div>

      <Link className={styles.hubLink} href="/information">{t.informationHub}<ChevronRight size={16} /></Link>
      </>}
    </section>
  );
}
