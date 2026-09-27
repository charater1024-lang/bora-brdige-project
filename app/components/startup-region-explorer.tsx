"use client";

import {
  ArrowDown,
  ExternalLink,
  Globe2,
  MapPinned,
  Search,
} from "lucide-react";
import {
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  YOUTH_POLICY_REGIONS,
  type YouthPolicyRegion,
} from "@/lib/auth/youth-policy-profile";
import {
  STARTUP_PROVINCE_BY_REGION,
  type StartupAnnouncementRegionSelection,
} from "@/lib/public-data/startup-region-view";
import type { PublicInformationItem, PublicInformationGroup } from "@/lib/public-data/types";

import {
  KOREA_REGION_MAP_POSITIONS,
  MOBILE_REGION_ORDER,
} from "./korea-region-map-positions";
import type { PublicInformationLocale } from "./public-information-layout";
import styles from "./startup-region-explorer.module.css";

const KOREA_MAP_URL =
  "https://raw.githubusercontent.com/statgarten/maps/main/svg/simple/%EC%A0%84%EA%B5%AD_%EC%8B%9C%EB%8F%84_%EA%B2%BD%EA%B3%84.svg";
const KOREA_MAP_SOURCE = "https://github.com/statgarten/maps";

const shortRegionLabels: Record<YouthPolicyRegion, string> = {
  seoul: "서울",
  busan: "부산",
  daegu: "대구",
  incheon: "인천",
  gwangju: "광주",
  daejeon: "대전",
  ulsan: "울산",
  sejong: "세종",
  gyeonggi: "경기",
  gangwon: "강원",
  chungbuk: "충북",
  chungnam: "충남",
  jeonbuk: "전북",
  jeonnam: "전남",
  gyeongbuk: "경북",
  gyeongnam: "경남",
  jeju: "제주",
};

const localizedRegionLabels: Record<
  PublicInformationLocale,
  Record<YouthPolicyRegion, string>
> = {
  ko: STARTUP_PROVINCE_BY_REGION,
  en: {
    seoul: "Seoul",
    busan: "Busan",
    daegu: "Daegu",
    incheon: "Incheon",
    gwangju: "Gwangju",
    daejeon: "Daejeon",
    ulsan: "Ulsan",
    sejong: "Sejong",
    gyeonggi: "Gyeonggi",
    gangwon: "Gangwon",
    chungbuk: "North Chungcheong",
    chungnam: "South Chungcheong",
    jeonbuk: "North Jeolla",
    jeonnam: "South Jeolla",
    gyeongbuk: "North Gyeongsang",
    gyeongnam: "South Gyeongsang",
    jeju: "Jeju",
  },
  ja: {
    seoul: "ソウル",
    busan: "釜山",
    daegu: "大邱",
    incheon: "仁川",
    gwangju: "光州",
    daejeon: "大田",
    ulsan: "蔚山",
    sejong: "世宗",
    gyeonggi: "京畿",
    gangwon: "江原",
    chungbuk: "忠清北道",
    chungnam: "忠清南道",
    jeonbuk: "全北",
    jeonnam: "全羅南道",
    gyeongbuk: "慶尚北道",
    gyeongnam: "慶尚南道",
    jeju: "済州",
  },
  zh: {
    seoul: "首尔",
    busan: "釜山",
    daegu: "大邱",
    incheon: "仁川",
    gwangju: "光州",
    daejeon: "大田",
    ulsan: "蔚山",
    sejong: "世宗",
    gyeonggi: "京畿道",
    gangwon: "江原道",
    chungbuk: "忠清北道",
    chungnam: "忠清南道",
    jeonbuk: "全北特别自治道",
    jeonnam: "全罗南道",
    gyeongbuk: "庆尚北道",
    gyeongnam: "庆尚南道",
    jeju: "济州特别自治道",
  },
};

function mapRegionLabel(locale: PublicInformationLocale, region: YouthPolicyRegion) {
  if (locale === "ko") return shortRegionLabels[region];
  return localizedRegionLabels[locale][region]
    .replace("North Chungcheong", "N.Chung")
    .replace("South Chungcheong", "S.Chung")
    .replace("North Gyeongsang", "N.Gyeong")
    .replace("South Gyeongsang", "S.Gyeong")
    .replace("North Jeolla", "N.Jeolla")
    .replace("South Jeolla", "S.Jeolla")
    .replace("特別自治道", "")
    .replace("特别自治道", "");
}

const copy = {
  ko: {
    eyebrow: "STEP 1 · 창업 공고",
    title: "지역별 창업 지원 공고 찾기",
    lead: "지도에서 사업 예정 지역을 선택하면 그 지역을 공식 대상에 포함한 공고만 모아봅니다.",
    all: "전체 공고",
    nationwide: "전국 공고",
    region: "지역 선택",
    mapLabel: "대한민국 광역지역별 창업 공고 지도",
    selectLabel: "목록에서 지역 선택",
    searchLabel: "현재 선택 결과에서 검색",
    searchPlaceholder: "사업명·기관·대상 검색",
    allSummary: (count: number) => `전체 창업 공고 ${count}건`,
    nationwideSummary: (count: number) => `전체 전국 대상 공고 ${count}건`,
    regionSummary: (region: string, count: number) => `전체 ${region} 대상 공고 ${count}건`,
    resultCount: (shown: number, scoped: number) => `검색 결과 ${shown}건 · 선택 범위 ${scoped}건`,
    pageScope: (loaded: number, total: number) => `전체 검색 결과 ${total.toLocaleString("ko-KR")}건 중 현재 페이지 ${loaded.toLocaleString("ko-KR")}건을 표시합니다.`,
    countRule: "지도 숫자는 전체 검색 결과의 해당 지역 공고를 집계하며 전국 공고는 포함하지 않습니다.",
    unknown: (count: number) => `공식 지역 조건을 확인할 수 없는 공고 ${count}건은 전체 공고에서만 확인할 수 있습니다.`,
    commercial: (region: string) => `${region} 상권 분석으로 이어보기`,
    showMore: (count: number) => `공고 ${count}건 더 보기`,
    empty: "현재 선택한 범위의 창업 공고는 0건입니다.",
    emptyHelp: "다른 지역 또는 전국 공고를 선택하거나 공식 데이터가 갱신된 뒤 다시 확인해 주세요.",
    mapUnavailable: "지도 이미지를 불러오지 못했습니다. 지역 버튼이나 목록을 이용해 주세요.",
    source: "지도 경계 출처: KOSTAT SGIS 기반 statgarten/maps · 행정·측량용 아님",
  },
  en: {
    eyebrow: "STEP 1 · STARTUP NOTICES",
    title: "Find startup support by region",
    lead: "Choose a planned business region to see notices that officially include it.",
    all: "All notices",
    nationwide: "Nationwide",
    region: "Choose region",
    mapLabel: "Startup announcement map by Korean province",
    selectLabel: "Choose a region from the list",
    searchLabel: "Search within this selection",
    searchPlaceholder: "Search program, provider or audience",
    allSummary: (count: number) => `${count} notices in total`,
    nationwideSummary: (count: number) => `${count} nationwide notices in total`,
    regionSummary: (region: string, count: number) => `${count} ${region} notices in total`,
    resultCount: (shown: number, scoped: number) => `${shown} search results · ${scoped} in this scope`,
    pageScope: (loaded: number, total: number) => `Showing ${loaded.toLocaleString("en-US")} records on this page out of ${total.toLocaleString("en-US")} search results.`,
    countRule: "Map counts use all search results and exclude nationwide notices.",
    unknown: (count: number) => `${count} notices without a confirmed official region appear only under All notices.`,
    commercial: (region: string) => `Continue to commercial-area analysis for ${region}`,
    showMore: (count: number) => `Show ${count} more notices`,
    empty: "There are 0 startup notices in the selected scope.",
    emptyHelp: "Choose another region or Nationwide, or check again after official data is refreshed.",
    mapUnavailable: "The map image is unavailable. Use the region buttons or list instead.",
    source: "Boundary source: statgarten/maps based on KOSTAT SGIS · not for surveying",
  },
  ja: {
    eyebrow: "STEP 1 · 創業公募",
    title: "地域別の創業支援公募を探す",
    lead: "事業予定地域を選ぶと、公式の対象地域に含まれる公募だけを表示します。",
    all: "すべての公募",
    nationwide: "全国対象",
    region: "地域を選択",
    mapLabel: "韓国の広域地域別創業公募マップ",
    selectLabel: "一覧から地域を選択",
    searchLabel: "選択結果内を検索",
    searchPlaceholder: "事業名・機関・対象を検索",
    allSummary: (count: number) => `創業公募 合計 ${count}件`,
    nationwideSummary: (count: number) => `全国対象公募 合計 ${count}件`,
    regionSummary: (region: string, count: number) => `${region}対象公募 合計 ${count}件`,
    resultCount: (shown: number, scoped: number) => `検索結果 ${shown}件 · 選択範囲 ${scoped}件`,
    pageScope: (loaded: number, total: number) => `検索結果${total.toLocaleString("ja-JP")}件のうち、現在のページ${loaded.toLocaleString("ja-JP")}件を表示しています。`,
    countRule: "地図の件数は検索結果全体を対象とし、全国対象の公募は含めません。",
    unknown: (count: number) => `公式の地域条件を確認できない公募 ${count}件は「すべて」でのみ表示します。`,
    commercial: (region: string) => `${region}の商圏分析へ進む`,
    showMore: (count: number) => `公募をさらに${count}件表示`,
    empty: "選択した範囲の創業公募は0件です。",
    emptyHelp: "別の地域または全国対象を選ぶか、公式データ更新後に再確認してください。",
    mapUnavailable: "地図画像を読み込めません。地域ボタンまたは一覧をご利用ください。",
    source: "境界出典: KOSTAT SGISに基づくstatgarten/maps · 測量用ではありません",
  },
  zh: {
    eyebrow: "STEP 1 · 创业公告",
    title: "按地区查找创业扶持公告",
    lead: "选择计划经营的地区，仅查看官方对象地区包含该地区的公告。",
    all: "全部公告",
    nationwide: "全国公告",
    region: "选择地区",
    mapLabel: "韩国各广域地区创业公告地图",
    selectLabel: "从列表中选择地区",
    searchLabel: "在当前结果中搜索",
    searchPlaceholder: "搜索项目、机构或对象",
    allSummary: (count: number) => `创业公告共 ${count}条`,
    nationwideSummary: (count: number) => `全国公告共 ${count}条`,
    regionSummary: (region: string, count: number) => `${region}公告共 ${count}条`,
    resultCount: (shown: number, scoped: number) => `搜索结果 ${shown}条 · 当前范围 ${scoped}条`,
    pageScope: (loaded: number, total: number) => `显示全部${total.toLocaleString("zh-CN")}条搜索结果中的当前页面${loaded.toLocaleString("zh-CN")}条。`,
    countRule: "地图数字统计全部搜索结果，且不包含全国公告。",
    unknown: (count: number) => `无法确认官方地区条件的 ${count}条公告仅在“全部公告”中显示。`,
    commercial: (region: string) => `继续查看${region}商圈分析`,
    showMore: (count: number) => `再显示${count}条公告`,
    empty: "当前选择范围内的创业公告为0条。",
    emptyHelp: "请选择其他地区或全国公告，或在官方数据更新后再次查看。",
    mapUnavailable: "地图图片无法加载，请使用地区按钮或列表。",
    source: "边界来源: 基于KOSTAT SGIS的statgarten/maps · 不用于测绘",
  },
} satisfies Record<PublicInformationLocale, {
  eyebrow: string;
  title: string;
  lead: string;
  all: string;
  nationwide: string;
  region: string;
  mapLabel: string;
  selectLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  allSummary: (count: number) => string;
  nationwideSummary: (count: number) => string;
  regionSummary: (region: string, count: number) => string;
  resultCount: (shown: number, scoped: number) => string;
  pageScope: (loaded: number, total: number) => string;
  countRule: string;
  unknown: (count: number) => string;
  commercial: (region: string) => string;
  showMore: (count: number) => string;
  empty: string;
  emptyHelp: string;
  mapUnavailable: string;
  source: string;
}>;

export function StartupRegionExplorer({
  items,
  catalogTotalCount,
  loading,
  locale,
  renderItems,
  onCommercialRegionChange,
  facets,
  selection,
  query,
  onSelectionChange,
  onQueryChange,
}: {
  items: PublicInformationItem[];
  catalogTotalCount: number;
  loading: boolean;
  locale: PublicInformationLocale;
  renderItems: (items: PublicInformationItem[]) => ReactNode;
  onCommercialRegionChange?: (province: string | null) => void;
  facets?: PublicInformationGroup["startupFacets"];
  selection: StartupAnnouncementRegionSelection;
  query: string;
  onSelectionChange: (selection: StartupAnnouncementRegionSelection) => void;
  onQueryChange: (query: string) => void;
}) {
  const t = copy[locale];
  const selectedRegion = selection.mode === "region" ? selection.region : "seoul";
  const [mapImageAvailable, setMapImageAvailable] = useState(true);
  const counts = { total: facets?.allRegionCount ?? 0, nationwide: facets?.nationwideCount ?? 0,
    unknown: facets?.unknownRegionCount ?? 0, regions: facets?.regionCounts ?? {} };
  const visibleItems = items;
  const countLabel = (value: number | undefined) => loading || !facets ? "…" : value ?? 0;
  const regionLabel = localizedRegionLabels[locale][selectedRegion];
  const summary = selection.mode === "all"
    ? t.allSummary(counts.total)
    : selection.mode === "nationwide"
      ? t.nationwideSummary(counts.nationwide)
      : t.regionSummary(regionLabel, counts.regions[selectedRegion] ?? 0);

  function selectAll() {
    onSelectionChange({ mode: "all" });
    onCommercialRegionChange?.(null);
  }

  function selectNationwide() {
    onSelectionChange({ mode: "nationwide" });
    onCommercialRegionChange?.(null);
  }

  function selectRegion(region: YouthPolicyRegion) {
    onSelectionChange({ mode: "region", region });
    onCommercialRegionChange?.(STARTUP_PROVINCE_BY_REGION[region]);
  }

  function openCommercialAnalysis() {
    onCommercialRegionChange?.(STARTUP_PROVINCE_BY_REGION[selectedRegion]);
    window.requestAnimationFrame(() => {
      document.getElementById("commercial-district-title")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  return <section className={styles.explorer} aria-labelledby="startup-support-title">
    <header className={styles.heading}>
      <span className={styles.headingIcon}><MapPinned size={22} /></span>
      <div>
        <small>{t.eyebrow}</small>
        <h2 id="startup-support-title">{t.title}</h2>
        <p>{t.lead}</p>
        <span className={styles.catalogScope}>{loading ? "…" : t.pageScope(items.length, catalogTotalCount)}</span>
      </div>
      <div className={styles.scopeSwitch} aria-label={t.title}>
        <button type="button" aria-pressed={selection.mode === "all"} onClick={selectAll}>
          {t.all}<small>{countLabel(counts.total)}</small>
        </button>
        <button type="button" aria-pressed={selection.mode === "nationwide"} onClick={selectNationwide}>
          <Globe2 size={14} />{t.nationwide}<small>{countLabel(counts.nationwide)}</small>
        </button>
      </div>
    </header>

    <div className={styles.mapLayout}>
      <div className={styles.koreaMap} role="group" aria-label={t.mapLabel}>
        {/* Reuses the same SGIS-derived boundary asset as the youth-policy map. */}
          {mapImageAvailable
            ? <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={KOREA_MAP_URL} alt="" aria-hidden="true" loading="lazy" onError={() => setMapImageAvailable(false)} />
            </>
          : <p className={styles.mapFallback} role="status"><MapPinned size={22} aria-hidden="true" />{t.mapUnavailable}</p>}
        {MOBILE_REGION_ORDER.map((region) => {
          const position = KOREA_REGION_MAP_POSITIONS[region];
          const count = countLabel(counts.regions[region]);
          const selected = selection.mode === "region" && selection.region === region;
          return <button
            key={region}
            type="button"
            data-region={region}
            className={selected ? styles.selectedRegion : undefined}
            style={{
              "--region-x": `${position.x}%`,
              "--region-y": `${position.y}%`,
            } as CSSProperties}
            aria-label={`${localizedRegionLabels[locale][region]} · ${count}`}
            aria-pressed={selected}
            onClick={() => selectRegion(region)}
          >
            <span>{mapRegionLabel(locale, region)}</span>
            <small>{count}</small>
          </button>;
        })}
      </div>

      <aside className={styles.regionControls}>
        <label>
          <span>{t.selectLabel}</span>
          <select
            value={selection.mode === "region" ? selectedRegion : ""}
            onChange={(event) => selectRegion(event.target.value as YouthPolicyRegion)}
          >
            <option value="" disabled>{t.selectLabel}</option>
            {YOUTH_POLICY_REGIONS.map((region) => <option key={region} value={region}>
              {localizedRegionLabels[locale][region]} · {countLabel(counts.regions[region])}
            </option>)}
          </select>
        </label>
        <div className={styles.regionList}>
          {YOUTH_POLICY_REGIONS.map((region) => <button
            key={region}
            type="button"
            aria-pressed={selection.mode === "region" && selection.region === region}
            onClick={() => selectRegion(region)}
          >
            <span>{localizedRegionLabels[locale][region]}</span>
            <small>{countLabel(counts.regions[region])}</small>
          </button>)}
        </div>
        <p>{t.countRule}</p>
        <a href={KOREA_MAP_SOURCE} target="_blank" rel="noreferrer noopener">
          {t.source}<ExternalLink size={12} />
        </a>
      </aside>
    </div>

    <div className={styles.resultHeader}>
      <div aria-live="polite">
        <strong>{loading || !facets ? "…" : summary}</strong>
        <span>{loading ? "…" : t.resultCount(visibleItems.length, catalogTotalCount)}</span>
        {!loading && facets && selection.mode === "all" && <small>{t.unknown(counts.unknown)}</small>}
      </div>
      {selection.mode === "region" && onCommercialRegionChange && <button type="button" onClick={openCommercialAnalysis}>
        {t.commercial(regionLabel)}<ArrowDown size={15} />
      </button>}
      <label className={styles.search}>
        <span>{t.searchLabel}</span>
        <span><Search size={16} /><input
          type="search"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
          placeholder={t.searchPlaceholder}
        /></span>
      </label>
    </div>

    {loading
      ? <div className={styles.empty} role="status"><strong>…</strong></div>
      : visibleItems.length
        ? <>
          {renderItems(visibleItems)}
        </>
        : <div className={styles.empty} role="status">
          <MapPinned size={25} />
          <strong>{t.empty}</strong>
          <p>{t.emptyHelp}</p>
        </div>}
  </section>;
}
