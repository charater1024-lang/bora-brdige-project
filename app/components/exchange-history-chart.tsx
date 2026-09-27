"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Banknote, Clock3, ExternalLink, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { safePublicHttpUrl } from "@/lib/public-data/urls";
import { recordRecentActivity } from "@/lib/ai/context-client";
import { usePublicInformationLocale, type PublicInformationLocale } from "./public-information-layout";
import { ExchangeConverter } from "./exchange-converter";
import styles from "./public-information-pages.module.css";

type HistoryPoint = {
  date: string;
  rate: number;
  quotedUnit: number;
  quotedRate: number;
};

type ChartDirection = "foreign-to-krw" | "krw-to-foreign";

type ExchangeHistoryResponse = {
  currency: string;
  baseCurrency: "KRW";
  rangeDays: number;
  hasData: boolean;
  points: HistoryPoint[];
  summary: { latest: number; change: number; changeRate: number; high: number; low: number };
  source: string;
  sourceUrl: string;
  backfill: {
    phase: "not-started" | "gap" | "history" | "complete";
    targetStartDate: string | null;
    targetEndDate: string | null;
    nextDate: string | null;
    progressPercent: number;
    completedAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
  };
};

const emptyHistory: ExchangeHistoryResponse = {
  currency: "USD",
  baseCurrency: "KRW",
  rangeDays: 30,
  hasData: false,
  points: [],
  summary: { latest: 0, change: 0, changeRate: 0, high: 0, low: 0 },
  source: "",
  sourceUrl: "",
  backfill: {
    phase: "not-started",
    targetStartDate: null,
    targetEndDate: null,
    nextDate: null,
    progressPercent: 0,
    completedAt: null,
    lastAttemptAt: null,
    lastError: null,
  },
};

const localeTags: Record<PublicInformationLocale, string> = { ko: "ko-KR", en: "en-US", ja: "ja-JP", zh: "zh-CN" };
const currencies = ["USD", "JPY", "CNY", "EUR", "GBP", "CAD", "AUD", "SGD"] as const;
type ExchangeCurrency = (typeof currencies)[number];

function isExchangeCurrency(value: string): value is ExchangeCurrency {
  return currencies.some((currency) => currency === value);
}
const ranges = [7, 30, 90, 365] as const;
const REVERSE_CHART_KRW_BASIS = 1_000;

const copy = {
  ko: {
    eyebrow: "EXCHANGE HISTORY", title: "공식 환율 시계열", lead: "한국수출입은행에서 실제 수집된 환율만 날짜별로 보여줍니다.",
    disclaimer: "일별 공식 환율 · 장중 실시간 시세 아님", currency: "통화", range: "조회 기간", day7: "7일", day30: "1개월", day90: "3개월", day365: "1년",
    direction: "그래프 방향", foreignToKrw: "외화 1 → 원화", krwToForeign: "1천원 → 외화",
    loading: "환율 이력을 확인하고 있어요.", failed: "환율 이력을 불러오지 못했습니다.", empty: "선택한 기간에 수집된 환율 이력이 0건입니다.", retry: "다시 확인",
    latest: "최근 환율", change: "기간 변동", high: "기간 최고", low: "기간 최저", points: "수집 일수", per: "외화 1단위 기준", perReverse: "원화 1,000원 기준", source: "공식 출처", table: "날짜별 환율 표", date: "날짜", rate: "환산 환율",
    historyBuilding: "1년 이력 저장 중", historyComplete: "1년 범위 확인 완료", historyWaiting: "이력 수집 대기", historyProgress: "영업일을 소량씩 저장해 API 일일 한도를 보호합니다.",
  },
  en: {
    eyebrow: "EXCHANGE HISTORY", title: "Official exchange-rate history", lead: "Only rates actually collected from the Export-Import Bank of Korea are plotted by date.",
    disclaimer: "Daily official rate · not a live intraday market quote", currency: "Currency", range: "Range", day7: "7 days", day30: "1 month", day90: "3 months", day365: "1 year",
    direction: "Chart direction", foreignToKrw: "1 foreign → KRW", krwToForeign: "₩1,000 → foreign",
    loading: "Checking exchange-rate history.", failed: "Exchange-rate history could not be loaded.", empty: "There are 0 collected rates in this period.", retry: "Try again",
    latest: "Latest rate", change: "Period change", high: "Period high", low: "Period low", points: "Collected days", per: "per foreign unit", perReverse: "per KRW 1,000", source: "Official source", table: "Daily exchange-rate table", date: "Date", rate: "Converted rate",
    historyBuilding: "Saving one-year history", historyComplete: "One-year range checked", historyWaiting: "History collection pending", historyProgress: "Business days are saved in small batches to protect the daily API quota.",
  },
  ja: {
    eyebrow: "EXCHANGE HISTORY", title: "公式為替レート推移", lead: "韓国輸出入銀行から実際に収集したレートのみを日付別に表示します。",
    disclaimer: "日次公式レート · 場中リアルタイム相場ではありません", currency: "通貨", range: "期間", day7: "7日", day30: "1か月", day90: "3か月", day365: "1年",
    direction: "グラフ方向", foreignToKrw: "外貨1 → ウォン", krwToForeign: "₩1,000 → 外貨",
    loading: "為替履歴を確認しています。", failed: "為替履歴を読み込めませんでした。", empty: "選択期間に収集された為替履歴は0件です。", retry: "再確認",
    latest: "最新レート", change: "期間変動", high: "期間最高", low: "期間最低", points: "収集日数", per: "外貨1単位基準", perReverse: "1,000ウォン基準", source: "公式出典", table: "日付別為替表", date: "日付", rate: "換算レート",
    historyBuilding: "1年分の履歴を保存中", historyComplete: "1年範囲の確認完了", historyWaiting: "履歴収集待ち", historyProgress: "APIの日次上限を守るため、営業日を少量ずつ保存します。",
  },
  zh: {
    eyebrow: "EXCHANGE HISTORY", title: "官方汇率走势", lead: "仅按日期显示从韩国进出口银行实际采集的汇率。",
    disclaimer: "每日官方汇率 · 非盘中实时行情", currency: "货币", range: "时间范围", day7: "7天", day30: "1个月", day90: "3个月", day365: "1年",
    direction: "图表方向", foreignToKrw: "1外币 → 韩元", krwToForeign: "₩1,000 → 外币",
    loading: "正在检查汇率历史。", failed: "无法加载汇率历史。", empty: "所选期间采集的汇率记录为0条。", retry: "重新检查",
    latest: "最新汇率", change: "期间变动", high: "期间最高", low: "期间最低", points: "采集天数", per: "每1单位外币", perReverse: "每1,000韩元", source: "官方来源", table: "每日汇率表", date: "日期", rate: "换算汇率",
    historyBuilding: "正在保存一年历史", historyComplete: "一年范围检查完成", historyWaiting: "等待采集历史", historyProgress: "按小批量保存工作日数据，以保护 API 每日限额。",
  },
};

function formatRate(value: number, locale: PublicInformationLocale) {
  return new Intl.NumberFormat(localeTags[locale], { style: "currency", currency: "KRW", maximumFractionDigits: 2 }).format(value);
}

function formatForeignRate(value: number, currency: string, locale: PublicInformationLocale) {
  return `${new Intl.NumberFormat(localeTags[locale], { maximumFractionDigits: 6 }).format(value)} ${currency}`;
}

function formatAxisRate(
  value: number,
  direction: ChartDirection,
  locale: PublicInformationLocale,
) {
  const maximumFractionDigits = direction === "krw-to-foreign"
    ? 4
    : Math.abs(value) < 100 ? 2 : 0;
  return value.toLocaleString(localeTags[locale], { maximumFractionDigits });
}

function shortDate(value: string, locale: PublicInformationLocale) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(localeTags[locale], { month: "short", day: "numeric" }).format(parsed);
}

export default function ExchangeHistoryChart() {
  const locale = usePublicInformationLocale();
  const t = copy[locale];
  const [currency, setCurrency] = useState<ExchangeCurrency>("USD");
  const [preferenceReady, setPreferenceReady] = useState(false);
  useEffect(() => {
    const saved = window.localStorage.getItem("bora-home-currency");
    const timer = window.setTimeout(() => {
       if (saved && isExchangeCurrency(saved)) setCurrency(saved);
      setPreferenceReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [rangeDays, setRangeDays] = useState<(typeof ranges)[number]>(30);
  const [chartDirection, setChartDirection] = useState<ChartDirection>("foreign-to-krw");
  const [history, setHistory] = useState<ExchangeHistoryResponse>(emptyHistory);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!preferenceReady) return;
    const controller = new AbortController();
    fetch(`/api/public-data/exchange-history?currency=${encodeURIComponent(currency)}&range=${rangeDays}`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("exchange_history_unavailable");
      return await response.json() as ExchangeHistoryResponse;
    }).then((data) => {
      setHistory({
        ...emptyHistory,
        ...data,
        points: Array.isArray(data.points) ? data.points.filter((point) => typeof point.date === "string" && Number.isFinite(point.rate) && point.rate > 0) : [],
        summary: { ...emptyHistory.summary, ...data.summary },
        backfill: { ...emptyHistory.backfill, ...data.backfill },
      });
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setHistory({ ...emptyHistory, currency, rangeDays });
        setFailed(true);
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [currency, preferenceReady, rangeDays, reloadKey]);

  const points = useMemo(() => [...history.points].sort((left, right) => left.date.localeCompare(right.date)), [history.points]);
  const chartPoints = useMemo(() => points.map((point) => ({
    ...point,
    rate: chartDirection === "foreign-to-krw"
      ? point.rate
      : REVERSE_CHART_KRW_BASIS / point.rate,
  })), [chartDirection, points]);
  const hasData = history.hasData && points.length > 0;
  const chartSummary = useMemo(() => {
    const rates = chartPoints.map((point) => point.rate);
    const first = rates[0] ?? 0;
    const latest = rates.at(-1) ?? 0;
    const change = rates.length > 1 ? latest - first : 0;
    return {
      latest,
      change,
      changeRate: rates.length > 1 && first > 0 ? (change / first) * 100 : 0,
      high: rates.length ? Math.max(...rates) : 0,
      low: rates.length ? Math.min(...rates) : 0,
    };
  }, [chartPoints]);
  const rangeLabels = { 7: t.day7, 30: t.day30, 90: t.day90, 365: t.day365 } as const;
  const trend = chartSummary.change > 0 ? "up" : chartSummary.change < 0 ? "down" : "flat";
  const sourceUrl = safePublicHttpUrl(history.sourceUrl);
  const chartUnit = chartDirection === "foreign-to-krw" ? t.per : t.perReverse;
  const chartPair = chartDirection === "foreign-to-krw"
    ? `1 ${currency} → KRW`
    : `₩${REVERSE_CHART_KRW_BASIS.toLocaleString(localeTags[locale])} → ${currency}`;
  const formatChartRate = (value: number) => chartDirection === "foreign-to-krw"
    ? formatRate(value, locale)
    : formatForeignRate(value, currency, locale);

  function changeCurrency(value: string) {
    if (!isExchangeCurrency(value)) return;
    setLoading(true);
    setFailed(false);
    setCurrency(value);
    window.localStorage.setItem("bora-home-currency", value);
    void recordRecentActivity({ activityType: "exchange", targetCode: value });
  }

  function changeRange(range: (typeof ranges)[number]) {
    setLoading(true);
    setFailed(false);
    setRangeDays(range);
  }

  function retry() {
    setLoading(true);
    setFailed(false);
    setReloadKey((current) => current + 1);
  }

  return <>
    <section className={styles.exchangeHero}>
      <div><span><Banknote size={15} />{t.eyebrow}</span><h1>{t.title}</h1><p>{t.lead}</p></div>
      <strong><Clock3 size={16} />{t.disclaimer}</strong>
    </section>
    <section className={styles.exchangeControls} aria-label={t.title}>
      <label><span>{t.currency}</span><select value={currency} onChange={(event) => changeCurrency(event.target.value)}>{currencies.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <fieldset><legend>{t.range}</legend><div>{ranges.map((range) => <button key={range} type="button" className={rangeDays === range ? styles.activeRange : undefined} aria-pressed={rangeDays === range} onClick={() => changeRange(range)}>{rangeLabels[range]}</button>)}</div></fieldset>
      <fieldset className={styles.exchangeDirectionSwitch}><legend>{t.direction}</legend><div>
        <button type="button" className={chartDirection === "foreign-to-krw" ? styles.activeRange : undefined} aria-pressed={chartDirection === "foreign-to-krw"} onClick={() => setChartDirection("foreign-to-krw")}>{t.foreignToKrw}</button>
        <button type="button" className={chartDirection === "krw-to-foreign" ? styles.activeRange : undefined} aria-pressed={chartDirection === "krw-to-foreign"} onClick={() => setChartDirection("krw-to-foreign")}>{t.krwToForeign}</button>
      </div></fieldset>
    </section>
    <div className={styles.portalStatus} role="status">
      <span data-state={history.backfill.phase === "complete" ? "live" : history.backfill.lastError ? "warning" : undefined}>
        {history.backfill.phase === "complete"
          ? t.historyComplete
          : history.backfill.phase === "not-started"
            ? t.historyWaiting
            : `${t.historyBuilding} · ${history.backfill.progressPercent}%`}
      </span>
      <p><Clock3 size={15} />{t.historyProgress}</p>
    </div>
    <section className={styles.exchangeConverterPanel}>
      <ExchangeConverter
        locale={locale}
        currency={currency}
        baseRate={
          hasData && !loading && history.currency === currency
            ? history.summary.latest
            : null
        }
      />
    </section>
    <section className={styles.exchangeSummary} aria-label={t.title}>
      <article><span>{t.latest}</span><strong>{formatChartRate(hasData ? chartSummary.latest : 0)}</strong><small>{chartUnit}</small></article>
      <article data-trend={trend}><span>{t.change}</span><strong>{hasData ? `${chartSummary.change >= 0 ? "+" : ""}${chartSummary.change.toLocaleString(localeTags[locale], { maximumFractionDigits: 6 })}` : "0"}</strong><small>{hasData ? `${chartSummary.changeRate >= 0 ? "+" : ""}${chartSummary.changeRate.toLocaleString(localeTags[locale], { maximumFractionDigits: 2 })}%` : "0%"}{trend === "up" ? <TrendingUp size={14} /> : trend === "down" ? <TrendingDown size={14} /> : null}</small></article>
      <article><span>{t.high}</span><strong>{formatChartRate(hasData ? chartSummary.high : 0)}</strong><small>{rangeLabels[rangeDays]}</small></article>
      <article><span>{t.low}</span><strong>{formatChartRate(hasData ? chartSummary.low : 0)}</strong><small>{t.points} {points.length}</small></article>
    </section>
    <section className={styles.exchangeChartPanel} aria-labelledby="exchange-chart-title">
      <div className={styles.chartHeading}><div><span>{chartPair}</span><h2 id="exchange-chart-title">{t.title}</h2></div>{sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{t.source} · {history.source}<ExternalLink size={14} /></a>}</div>
      {loading ? <div className={styles.chartEmpty}><RefreshCw className={styles.spin} size={28} /><p>{t.loading}</p></div> : failed ? <div className={styles.chartEmpty}><Banknote size={28} /><p>{t.failed}</p><button type="button" onClick={retry}>{t.retry}</button></div> : !hasData ? <div className={styles.chartEmpty}><Banknote size={28} /><p>{t.empty}</p><strong>0</strong></div> : <>
        <div className={styles.chartCanvas} role="img" aria-label={`${chartPair} ${t.title}, ${points.length} ${t.points}`}>
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={chartPoints} margin={{ top: 12, right: 14, bottom: 0, left: 2 }}><defs><linearGradient id="exchangeHistoryGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6d5bd0" stopOpacity={0.34}/><stop offset="100%" stopColor="#6d5bd0" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#ece7f5"/><XAxis dataKey="date" tickFormatter={(value) => shortDate(String(value), locale)} tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: "#777084", fontSize: 11 }}/><YAxis domain={["auto", "auto"]} tickFormatter={(value) => formatAxisRate(Number(value), chartDirection, locale)} tickLine={false} axisLine={false} width={64} tick={{ fill: "#777084", fontSize: 10 }}/><Tooltip labelFormatter={(value) => shortDate(String(value), locale)} formatter={(value) => [formatChartRate(Number(value)), chartPair]} contentStyle={{ border: "1px solid #ded7f1", borderRadius: 12, boxShadow: "0 12px 28px rgba(58,39,110,.13)" }}/><Area type="monotone" dataKey="rate" stroke="#6551c3" strokeWidth={3} fill="url(#exchangeHistoryGradient)" activeDot={{ r: 5, fill: "#6551c3", stroke: "#fff", strokeWidth: 3 }}/></AreaChart></ResponsiveContainer>
        </div>
        <details className={styles.historyTable}><summary>{t.table} · {points.length}</summary><div><table><thead><tr><th>{t.date}</th><th>{t.rate}</th></tr></thead><tbody>{chartPoints.map((point) => <tr key={`${point.date}-${point.rate}`}><td>{point.date}</td><td>{formatChartRate(point.rate)}</td></tr>)}</tbody></table></div></details>
      </>}
    </section>
  </>;
}
