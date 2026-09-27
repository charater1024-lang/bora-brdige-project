"use client";

import { ExternalLink, MapPinned, Search, Store } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import {
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PublicInformationItem } from "@/lib/public-data/types";
import {
  buildCommercialAreaInsights,
  topCommercialAreasByConsumption,
  type CommercialAreaAnalyticsRecord,
  type CommercialAreaInsight,
  type CommercialBoundaryPoint,
  type CommercialDataStatus,
  type CommercialObservation,
} from "@/lib/public-data/commercial-area-insights";
import {
  applySeoulCommercialBoundaries,
  normalizeSeoulCommercialBoundaryAsset,
  type SeoulCommercialBoundaryAsset,
} from "@/lib/public-data/seoul-commercial-boundaries";
import type { PublicInformationLocale } from "./public-information-layout";
import styles from "./commercial-area-insights.module.css";
import { resolveCommercialInsightSelection } from "./commercial-selection";

const copy = {
  ko: {
    top: "추정 총매출 기준 상위 상권",
    topLead: "서울시 공식 추정매출을 업종별로 합산해 순위를 매깁니다. 면적이나 점포 수로 매출을 추정하지 않습니다.",
    unavailableRanking: "연결된 공식 API에서 상권별 추정매출을 받지 못해 순위를 표시하지 않았습니다.",
    search: "상권명·자치구·동 검색",
    all: "전체 상권 검색",
    searchLead: "상권명이나 지역을 입력하면 일치하는 상권을 최대 60개까지 보여드립니다.",
    rank: "위",
    consumption: "추정 총매출",
    areaType: "상권 유형",
    industry: "매출 기준 주요 업종 구성",
    payments: "시간대별 추정매출",
    footfall: "시간대별 유동인구",
    rent: "임대료",
    boundary: "공식 상권 경계",
    boundaryNote: "연붉은 면은 연결된 공식 상권 경계 좌표를 화면용으로 단순화한 것이며 법적 행정경계·측량 자료가 아닙니다.",
    focusedRegion: "공고 대상 지역과 연결된 상권",
    clearRegion: "전국 상권 보기",
    noBoundary: "표시 가능한 공식 경계 좌표가 없습니다.",
    noResult: "검색 결과가 없습니다.",
    noData: "현재 연결된 공식 데이터에서 제공하지 않습니다.",
    source: "출처",
    asOf: "기준",
    unknownDate: "기준시점 미제공",
    people: "명",
    won: "원",
    openMap: "OpenStreetMap에서 위치 열기",
    peakLead: "가장 큰 값",
    noChartValue: "수치가 있는 시간대가 없어 그래프 추세를 요약할 수 없습니다.",
    tableToggle: "시간대별 수치 표로 보기",
    timeBand: "시간대",
    metricValue: "값",
  },
  en: {
    top: "Top districts by estimated sales",
    topLead: "Official Seoul estimated sales are summed across industries. Area and store counts are never used as a sales estimate.",
    unavailableRanking: "No district-level estimated sales were received from the connected official API, so no ranking is shown.",
    search: "Search district, ward or neighborhood",
    all: "Search all commercial areas",
    searchLead: "Enter a district or location to show up to 60 matching official areas.",
    rank: "",
    consumption: "Estimated total sales",
    areaType: "District type",
    industry: "Sales mix by industry",
    payments: "Estimated sales by time band",
    footfall: "Footfall by time band",
    rent: "Rent",
    boundary: "Official boundary",
    boundaryNote: "The pale-red area is a display simplification of the official commercial boundary, not a legal administrative boundary or survey.",
    focusedRegion: "Commercial areas linked to the announcement region",
    clearRegion: "Show all regions",
    noBoundary: "No usable official boundary coordinates are available.",
    noResult: "No matching commercial area.",
    noData: "Not supplied by the connected official data.",
    source: "Source",
    asOf: "As of",
    unknownDate: "Reference date not supplied",
    people: "people",
    won: "KRW",
    openMap: "Open location in OpenStreetMap",
    peakLead: "Highest value",
    noChartValue: "No time band has a numeric value to summarize.",
    tableToggle: "View time-band data table",
    timeBand: "Time band",
    metricValue: "Value",
  },
  ja: {
    top: "推定総売上による上位商圏",
    topLead: "ソウル市の公式推定売上を業種別に合算します。面積や店舗数から売上を推定しません。",
    unavailableRanking: "接続中の公式APIから商圏別推定売上を取得できないため、順位を表示していません。",
    search: "商圏名・区・地域を検索",
    all: "全商圏を検索",
    searchLead: "商圏名や地域を入力すると、一致する公式商圏を最大60件表示します。",
    rank: "位",
    consumption: "推定総売上",
    areaType: "商圏タイプ",
    industry: "売上基準の主要業種構成",
    payments: "時間帯別推定売上",
    footfall: "時間帯別流動人口",
    rent: "賃料",
    boundary: "公式商圏境界",
    boundaryNote: "薄赤色の面は公式商圏境界を表示用に簡略化したもので、法的な行政境界・測量資料ではありません。",
    focusedRegion: "公募対象地域に関連する商圏",
    clearRegion: "全国の商圏を表示",
    noBoundary: "表示できる公式境界座標がありません。",
    noResult: "検索結果がありません。",
    noData: "現在接続中の公式データでは提供されていません。",
    source: "出典",
    asOf: "基準",
    unknownDate: "基準時点なし",
    people: "人",
    won: "ウォン",
    openMap: "OpenStreetMapで位置を開く",
    peakLead: "最大値",
    noChartValue: "数値のある時間帯がないため、傾向を要約できません。",
    tableToggle: "時間帯別の数値表を表示",
    timeBand: "時間帯",
    metricValue: "値",
  },
  zh: {
    top: "按估算总销售额排名的商圈",
    topLead: "汇总首尔市官方各行业估算销售额，不使用面积或店铺数推算销售额。",
    unavailableRanking: "未从当前官方API收到各商圈估算销售额，因此不显示排名。",
    search: "搜索商圈、行政区或街道",
    all: "搜索全部商圈",
    searchLead: "输入商圈或地区后，最多显示60个匹配的官方商圈。",
    rank: "名",
    consumption: "估算总销售额",
    areaType: "商圈类型",
    industry: "按销售额计算的行业构成",
    payments: "分时段估算销售额",
    footfall: "分时段流动人口",
    rent: "租金",
    boundary: "官方商圈边界",
    boundaryNote: "浅红色区域是官方商圈边界的简化展示，并非法定行政边界或测量资料。",
    focusedRegion: "与公告对象地区关联的商圈",
    clearRegion: "查看全国商圈",
    noBoundary: "没有可显示的官方边界坐标。",
    noResult: "没有搜索结果。",
    noData: "当前连接的官方数据未提供。",
    source: "来源",
    asOf: "基准",
    unknownDate: "未提供基准时间",
    people: "人",
    won: "韩元",
    openMap: "在OpenStreetMap中打开位置",
    peakLead: "最高值",
    noChartValue: "没有包含数值的时段，无法概括趋势。",
    tableToggle: "查看分时段数据表",
    timeBand: "时段",
    metricValue: "数值",
  },
} satisfies Record<PublicInformationLocale, Record<string, string>>;

const pieColors = ["#6850c9", "#8b72df", "#ae98ee", "#d0c3f8", "#4d3a9e", "#b85b74"];

function formatNumber(value: number, locale: PublicInformationLocale) {
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : locale === "zh" ? "zh-CN" : "en-US";
  return new Intl.NumberFormat(localeTag, { maximumFractionDigits: 1 }).format(value);
}

function formatWon(value: number, locale: PublicInformationLocale) {
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : locale === "zh" ? "zh-CN" : "en-US";
  return new Intl.NumberFormat(localeTag, {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
    notation: value >= 100_000_000 ? "compact" : "standard",
  }).format(value);
}

function statusLabel(status: CommercialDataStatus, locale: PublicInformationLocale) {
  const labels: Record<PublicInformationLocale, Record<CommercialDataStatus, string>> = {
    ko: { available: "공식 데이터", "not-provided": "미제공", "not-configured": "연결 필요", "temporarily-unavailable": "일시 미수신", stale: "갱신 필요" },
    en: { available: "Official data", "not-provided": "Not supplied", "not-configured": "Connection required", "temporarily-unavailable": "Temporarily unavailable", stale: "Update required" },
    ja: { available: "公式データ", "not-provided": "未提供", "not-configured": "接続が必要", "temporarily-unavailable": "一時未取得", stale: "更新が必要" },
    zh: { available: "官方数据", "not-provided": "未提供", "not-configured": "需要连接", "temporarily-unavailable": "暂时不可用", stale: "需要更新" },
  };
  return labels[locale][status];
}

function SourceLine<T>({ metric, locale }: { metric: CommercialObservation<T>; locale: PublicInformationLocale }) {
  const t = copy[locale];
  return <footer className={styles.sourceLine}>
    <span data-status={metric.status}>{statusLabel(metric.status, locale)}</span>
    <small>{t.source}: {metric.source.name} · {t.asOf}: {metric.source.referenceDate ?? t.unknownDate}</small>
    {metric.source.url && <a href={metric.source.url} target="_blank" rel="noreferrer" aria-label={`${t.source}: ${metric.source.name}`}><ExternalLink size={13} /></a>}
  </footer>;
}

function EmptyMetric<T>({ metric, locale }: { metric: CommercialObservation<T>; locale: PublicInformationLocale }) {
  return <div className={styles.emptyMetric}>
    <p>{copy[locale].noData}</p>
    {metric.note && <small>{metric.note}</small>}
    <SourceLine metric={metric} locale={locale} />
  </div>;
}

function projectedBoundary(points: CommercialBoundaryPoint[]) {
  const longitudes = points.map((point) => point.longitude);
  const latitudes = points.map((point) => point.latitude);
  const longitudeRange = Math.max(...longitudes) - Math.min(...longitudes);
  const latitudeRange = Math.max(...latitudes) - Math.min(...latitudes);
  const longitudePadding = Math.max(0.0015, longitudeRange * 0.16);
  const latitudePadding = Math.max(0.0015, latitudeRange * 0.16);
  const west = Math.min(...longitudes) - longitudePadding;
  const east = Math.max(...longitudes) + longitudePadding;
  const south = Math.min(...latitudes) - latitudePadding;
  const north = Math.max(...latitudes) + latitudePadding;
  const mercatorY = (latitude: number) => {
    const radians = Math.max(-85, Math.min(85, latitude)) * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + radians / 2));
  };
  const projectedNorth = mercatorY(north);
  const projectedSouth = mercatorY(south);
  const svgPoints = points.map((point) => {
    const x = (point.longitude - west) / (east - west) * 1000;
    const y = (projectedNorth - mercatorY(point.latitude))
      / (projectedNorth - projectedSouth) * 600;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(`${west},${south},${east},${north}`)}&layer=mapnik`;
  const center = {
    latitude: (north + south) / 2,
    longitude: (east + west) / 2,
  };
  return { svgPoints, mapUrl, center };
}

function BoundaryMap({ district, locale }: { district: CommercialAreaInsight; locale: PublicInformationLocale }) {
  const t = copy[locale];
  const points = district.boundary.value;
  if (!points) return <section className={styles.metricCard}><h4>{t.boundary}</h4><EmptyMetric metric={district.boundary} locale={locale} /></section>;
  const projection = projectedBoundary(points);
  const externalMap = `https://www.openstreetmap.org/?mlat=${projection.center.latitude}&mlon=${projection.center.longitude}#map=16/${projection.center.latitude}/${projection.center.longitude}`;
  return <section className={`${styles.metricCard} ${styles.mapCard}`}>
    <header><div><h4>{t.boundary}</h4><p>{t.boundaryNote}</p></div><a href={externalMap} target="_blank" rel="noreferrer">{t.openMap}<ExternalLink size={13} /></a></header>
    <div className={styles.mapCanvas}>
      <iframe
        src={projection.mapUrl}
        title={`${district.name} ${t.boundary}`}
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups"
        tabIndex={-1}
      />
      <svg viewBox="0 0 1000 600" role="img" aria-label={`${district.name} ${t.boundary}`} preserveAspectRatio="none">
        <polygon points={projection.svgPoints} />
      </svg>
    </div>
    <SourceLine metric={district.boundary} locale={locale} />
  </section>;
}

function IndustryChart({ district, locale }: { district: CommercialAreaInsight; locale: PublicInformationLocale }) {
  const metric = district.industryComposition;
  const t = copy[locale];
  return <section className={styles.metricCard}>
    <h4>{t.industry}</h4>
    {!metric.value ? <EmptyMetric metric={metric} locale={locale} /> : <>
      <div className={styles.pieWrap}>
        <ResponsiveContainer width="100%" height={230}>
          <PieChart>
            <Pie data={metric.value} dataKey="sharePercent" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={2}>
              {metric.value.map((entry, index) => <Cell key={entry.name} fill={pieColors[index % pieColors.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
        <ul>{metric.value.map((entry, index) => <li key={entry.name}><i style={{ background: pieColors[index % pieColors.length] }} /><span>{entry.name}</span><strong>{formatNumber(entry.sharePercent, locale)}%</strong></li>)}</ul>
      </div>
      <SourceLine metric={metric} locale={locale} />
    </>}
  </section>;
}

function TimeChart({
  title,
  metric,
  locale,
  valueKey,
}: {
  title: string;
  metric: CommercialObservation<Array<{ hour: number; amount?: number; people?: number }>>;
  locale: PublicInformationLocale;
  valueKey: "amount" | "people";
}) {
  const chartId = useId();
  const t = copy[locale];
  const timeBands: Record<number, string> = {
    0: "00–06",
    6: "06–11",
    11: "11–14",
    14: "14–17",
    17: "17–21",
    21: "21–24",
  };
  const chartData = metric.value?.map((entry) => ({
    ...entry,
    timeBand: timeBands[entry.hour] ?? `${entry.hour}:00`,
  })) ?? null;
  const numericEntries = chartData?.flatMap((entry) => {
    const value = entry[valueKey];
    return typeof value === "number" && Number.isFinite(value)
      ? [{ timeBand: entry.timeBand, value }]
      : [];
  }) ?? [];
  const peak = numericEntries.reduce<{ timeBand: string; value: number } | null>(
    (current, entry) => current === null || entry.value > current.value ? entry : current,
    null,
  );
  const formatValue = (value: number) => valueKey === "amount"
    ? formatWon(value, locale)
    : `${formatNumber(value, locale)}${locale === "en" ? ` ${t.people}` : t.people}`;
  const summary = peak
    ? `${t.peakLead}: ${peak.timeBand} · ${formatValue(peak.value)}`
    : t.noChartValue;

  return <section className={styles.metricCard} aria-labelledby={`${chartId}-title`}>
    <h4 id={`${chartId}-title`}>{title}</h4>
    {!chartData?.length ? <EmptyMetric metric={metric} locale={locale} /> : <>
      <p className={styles.chartSummary} id={`${chartId}-summary`}>{summary}</p>
      <div className={styles.chartVisual} aria-hidden="true">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 12, right: 12, bottom: 0, left: 4 }}>
            <XAxis dataKey="timeBand" tick={{ fontSize: 12 }} />
            <YAxis width={58} tickFormatter={(value) => new Intl.NumberFormat("ko-KR", { notation: "compact" }).format(Number(value))} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Line type="monotone" dataKey={valueKey} stroke="#6551c3" strokeWidth={3} dot={{ r: 3, fill: "#fff" }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className={styles.chartDataDetails}>
        <summary>{t.tableToggle}</summary>
        <div className={styles.chartTableWrap}>
          <table>
            <caption className={styles.srOnly}>{title} · {summary}</caption>
            <thead><tr><th scope="col">{t.timeBand}</th><th scope="col">{t.metricValue}</th></tr></thead>
            <tbody>
              {chartData.map((entry) => {
                const value = entry[valueKey];
                return <tr key={entry.timeBand}>
                  <th scope="row">{entry.timeBand}</th>
                  <td>{typeof value === "number" && Number.isFinite(value) ? formatValue(value) : t.noData}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </details>
      <SourceLine metric={metric} locale={locale} />
    </>}
  </section>;
}

function Facts({ district, locale }: { district: CommercialAreaInsight; locale: PublicInformationLocale }) {
  const t = copy[locale];
  return <section className={`${styles.metricCard} ${styles.facts}`}>
    <div><span>{t.areaType}</span><strong>{district.areaType.value ?? t.noData}</strong><SourceLine metric={district.areaType} locale={locale} /></div>
    <div><span>{t.consumption}</span><strong>{district.totalConsumption.value === null ? t.noData : formatWon(district.totalConsumption.value, locale)}</strong><SourceLine metric={district.totalConsumption} locale={locale} /></div>
    <div><span>{t.rent}</span><strong>{district.rent.value === null ? t.noData : `${formatWon(district.rent.value, locale)} / ${district.rent.unit}`}</strong><SourceLine metric={district.rent} locale={locale} /></div>
  </section>;
}

export function CommercialAreaInsights({
  items,
  analytics = [],
  locale = "ko",
  preferredRegion = null,
  onClearPreferredRegion,
}: {
  items: PublicInformationItem[];
  analytics?: CommercialAreaAnalyticsRecord[];
  locale?: PublicInformationLocale;
  preferredRegion?: string | null;
  onClearPreferredRegion?: () => void;
}) {
  const t = copy[locale];
  const [query, setQuery] = useState("");
  const [seoulBoundaries, setSeoulBoundaries] = useState<SeoulCommercialBoundaryAsset | null>(null);
  const hasSeoulCommercialArea = items.some((item) => /^(?:seoul-commercial|commercial-seoul)-\d{7,10}$/u.test(item.id));
  useEffect(() => {
    if (!hasSeoulCommercialArea) return;
    const controller = new AbortController();
    void fetch("/data/seoul-commercial-boundaries.min.json", {
      cache: "force-cache",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("seoul_boundary_unavailable");
      const normalized = normalizeSeoulCommercialBoundaryAsset(await response.json());
      if (!normalized) throw new Error("seoul_boundary_invalid");
      setSeoulBoundaries(normalized);
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSeoulBoundaries(null);
    });
    return () => controller.abort();
  }, [hasSeoulCommercialArea]);
  const boundaryAwareItems = useMemo(
    () => applySeoulCommercialBoundaries(items, seoulBoundaries),
    [items, seoulBoundaries],
  );
  const insights = useMemo(
    () => buildCommercialAreaInsights(boundaryAwareItems, analytics),
    [analytics, boundaryAwareItems],
  );
  const regionInsights = useMemo(() => {
    const normalizedRegion = preferredRegion?.trim().toLocaleLowerCase();
    return normalizedRegion
      ? insights.filter((district) => district.locationLabel.toLocaleLowerCase().includes(normalizedRegion))
      : insights;
  }, [insights, preferredRegion]);
  const top = useMemo(() => topCommercialAreasByConsumption(regionInsights), [regionInsights]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? regionInsights
        .filter((district) => `${district.name} ${district.locationLabel}`.toLocaleLowerCase().includes(normalized))
        .slice(0, 60)
      : [];
  }, [query, regionInsights]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchActive = query.trim().length > 0;
  const selected = resolveCommercialInsightSelection(
    regionInsights,
    filtered,
    top,
    selectedId,
    searchActive,
  );
  const changeQuery = (nextQuery: string) => {
    setQuery(nextQuery);
    setSelectedId(null);
  };
  const selectRankedDistrict = (districtId: string) => {
    setQuery("");
    setSelectedId(districtId);
  };

  return <div className={styles.explorer}>
    {preferredRegion && <aside className={styles.regionFocus} aria-live="polite">
      <span><MapPinned size={16} />{t.focusedRegion}</span>
      <strong>{preferredRegion}</strong>
      {onClearPreferredRegion && <button type="button" onClick={onClearPreferredRegion}>{t.clearRegion}</button>}
    </aside>}
    <section className={styles.ranking} aria-labelledby="commercial-consumption-ranking-title">
      <header><div><span><Store size={18} /></span><div><h3 id="commercial-consumption-ranking-title">{t.top}</h3><p>{t.topLead}</p></div></div></header>
      {!top.length ? <p className={styles.rankingUnavailable}>{t.unavailableRanking}</p> : <ol>{top.map((district) => <li key={district.id}><button type="button" onClick={() => selectRankedDistrict(district.id)} aria-pressed={selected?.id === district.id}><b>{district.rankByConsumption}{t.rank}</b><span><strong>{district.name}</strong><small>{district.locationLabel}</small></span><em>{formatWon(district.totalConsumption.value ?? 0, locale)}</em></button></li>)}</ol>}
    </section>

    <section className={styles.directory} aria-labelledby="commercial-area-directory-title">
      <header><h3 id="commercial-area-directory-title">{t.all}</h3><label><span className={styles.srOnly}>{t.search}</span><Search size={16} /><input type="search" value={query} onChange={(event) => changeQuery(event.target.value)} placeholder={t.search} /></label></header>
      {!query.trim() ? <p className={styles.rankingUnavailable}>{t.searchLead}</p>
        : !filtered.length ? <p className={styles.noResult}>{t.noResult}</p>
          : <div className={styles.areaButtons}>{filtered.map((district) => <button key={district.id} type="button" aria-pressed={selected?.id === district.id} onClick={() => setSelectedId(district.id)}><MapPinned size={15} /><span><strong>{district.name}</strong><small>{district.locationLabel}</small></span>{district.rankByConsumption !== null && <b>#{district.rankByConsumption}</b>}</button>)}</div>}
    </section>

    {selected && <section key={selected.id} className={styles.detail} aria-live="polite" aria-labelledby="commercial-area-insight-title">
      <header className={styles.detailHeader}><div><span>{selected.rankByConsumption === null ? t.all : `#${selected.rankByConsumption}`}</span><h3 id="commercial-area-insight-title">{selected.name}</h3><p>{selected.locationLabel}</p></div></header>
      <Facts district={selected} locale={locale} />
      <div className={styles.detailGrid}>
        <BoundaryMap district={selected} locale={locale} />
        <IndustryChart district={selected} locale={locale} />
        <TimeChart title={t.payments} metric={selected.paymentsByHour} locale={locale} valueKey="amount" />
        <TimeChart title={t.footfall} metric={selected.footfallByHour} locale={locale} valueKey="people" />
      </div>
    </section>}
  </div>;
}
