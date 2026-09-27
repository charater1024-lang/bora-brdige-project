"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Banknote,
  BookOpenCheck,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileSearch,
  Info,
  Landmark,
  ListChecks,
  MapPinned,
  Percent,
  RotateCcw,
  Search,
  ShoppingBasket,
  SlidersHorizontal,
  Sparkles,
  Store,
  UserRound,
  WalletCards,
} from "lucide-react";
import { Activity, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type {
  PublicDataDashboard,
  PublicDataFreshnessFilter,
  PublicInformationCategory,
  PublicInformationGroup,
  PublicInformationItem,
} from "@/lib/public-data/types";
import {
  YOUTH_POLICY_REGIONS,
  type YouthPolicyRegion,
} from "@/lib/auth/youth-policy-profile";
import {
  YOUTH_POLICY_SECTION_IDS,
  type YouthPolicyRegionSelection,
  type YouthPolicySectionId,
} from "@/lib/public-data/youth-policy-sections";
import { normalizeEmploymentStatisticItem } from "@/lib/public-data/employment-statistics-view";
import { decodeCommercialAnalyticsSupplement } from "@/lib/public-data/commercial-supplement";
import { recordRecentActivity } from "@/lib/ai/context-client";
import {
  emptyPublicDataPayload,
  supportsPublicTemporalFilter,
} from "@/lib/public-data/types";
import { officialLinkKind, safePublicHttpUrl } from "@/lib/public-data/urls";
import { BillableItemAnalysisButton } from "./billable-item-analysis-button";
import { CommercialAreaInsights } from "./commercial-area-insights";
import { CommercialStoreSearch } from "./commercial-store-search";
import { ConsumerPriceCard } from "./consumer-price-card";
import { EmploymentStatisticsChart } from "./employment-statistics-chart";
import { FinanceExchangeCard } from "./finance-exchange-card";
import { InclusiveFinanceCheckup } from "./inclusive-finance-checkup";
import { applicationPeriodView } from "./public-application-period";
import {
  StartupAnnouncementRecommendations,
  startupAnnouncementDomId,
} from "./startup-announcement-recommendations";
import { isStartupAnnouncementItem } from "@/lib/public-data/startup-region-view";
import { StartupRegionExplorer } from "./startup-region-explorer";
import { usePublicInformationLocale, type PublicInformationLocale } from "./public-information-layout";
import { YouthPolicyFourSections } from "./youth-policy-four-sections";
import { YouthPolicyMatchEvidence, YouthPolicyPersonalizationBanner } from "./youth-policy-personalization";
import styles from "./public-information-pages.module.css";

type ItemLocation = {
  label?: string;
  roadAddress?: string;
  province?: string;
  city?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  lat?: number;
  lng?: number;
  precision?: "point" | "road-address" | "administrative" | "neighborhood" | "district";
};

type LocatedItem = PublicInformationItem & { location?: ItemLocation };
type FinanceProductKind = "deposit" | "saving";
type FinanceSection = "products" | "indicators" | "market";
const financeSections: FinanceSection[] = ["products", "indicators", "market"];
const financeSectionCopy = {
  ko: { label: "금융 정보 범위", products: "금융상품", indicators: "금융지표", market: "공시·시장자료", scope: "선택한 범위의 중복 제거 결과입니다. 금융상품 수와 공시·시장자료 수는 별도로 계산합니다.", aiRequest: "AI 설명 요청", readMore: "전체 수집 내용 보기", changed: "자료가 갱신되어 첫 페이지부터 다시 보여드립니다." },
  en: { label: "Financial information scope", products: "Products", indicators: "Indicators", market: "Disclosures & markets", scope: "Deduplicated results for this scope. Product and market-record counts are separate.", aiRequest: "Request AI explanation", readMore: "Read full collected text", changed: "The catalogue changed. Showing the first page of the updated results." },
  ja: { label: "金融情報の範囲", products: "金融商品", indicators: "金融指標", market: "開示・市場情報", scope: "選択範囲の重複除去済み結果です。商品と市場情報は別々に数えます。", aiRequest: "AI説明をリクエスト", readMore: "収集した全文を見る", changed: "情報が更新されたため、最初のページから表示します。" },
  zh: { label: "金融信息范围", products: "金融产品", indicators: "金融指标", market: "披露与市场资料", scope: "当前范围去重后的结果。金融产品和市场资料分别计数。", aiRequest: "请求AI说明", readMore: "阅读完整采集内容", changed: "资料已更新，将从第一页重新显示。" },
} as const;
type LiquidityNeed = "low" | "medium" | "high";
type JoinChannel = "any" | "online" | "branch";

type ProductRecommendationInput = {
  productKind: FinanceProductKind | "either";
  targetTermMonths: number;
  availableLumpSum: number;
  monthlyContribution: number;
  liquidityNeed: LiquidityNeed;
  preferredChannel: JoinChannel;
};

type ProductRecommendationEstimate = {
  principal: number;
  grossInterest: number;
  netInterest: number;
  maturityAmount: number;
  annualRate: number;
  rateBasis: "base" | "maximum";
  assumedTaxRate: number;
};

type ItemAnalysis = {
  providerError: "model_warming" | "local_inference_busy" | "local_inference_timeout" | null;
  explanation: string;
  keyPoints: string[];
  cautions: string[];
  sourceUrl: string | null;
  sourceName: string;
  sourceLinkKind: "detail" | "dataset";
  generation: "cached" | "generated" | "rule";
  billableApprovalAvailable: boolean;
  billableApprovalProvider: string | null;
  billableApprovalModel: string | null;
};

type ProductRecommendation = {
  itemId: string;
  title: string;
  provider: string;
  kind: FinanceProductKind;
  score: number;
  termMonths: number | null;
  baseRate: number | null;
  maximumRate: number | null;
  estimate: ProductRecommendationEstimate | null;
  reasons: string[];
  checks: string[];
  sourceUrl: string;
  asOf: string | null;
};

type ProductRecommendationResult = {
  recommendations: ProductRecommendation[];
  input: ProductRecommendationInput | null;
  productCount: number;
  authenticated: boolean;
  asOf: string | null;
  disclaimer: string;
};

type CommercialDistrict = {
  id: string;
  rank: number;
  label: string;
  province: string;
  locationLabel: string;
  areaSquareMeters: number | null;
  referenceDate: string | null;
  coordinateCount: number | null;
  latitude: number | null;
  longitude: number | null;
  sourceUrl: string;
};

const localeTags: Record<PublicInformationLocale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const DESKTOP_CATEGORY_PAGE_SIZE = 24;
const MOBILE_CATEGORY_PAGE_SIZE = 12;
const COMPACT_CATALOG_QUERY = "(max-width: 680px)";
const CATEGORY_QUERY_CHANGE_EVENT = "bora-public-category-query-change";

function subscribeToCompactCatalog(onStoreChange: () => void) {
  const mediaQuery = window.matchMedia(COMPACT_CATALOG_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
}

function compactCatalogSnapshot() {
  return window.matchMedia(COMPACT_CATALOG_QUERY).matches;
}

function useCategoryPageSize() {
  const compact = useSyncExternalStore(
    subscribeToCompactCatalog,
    compactCatalogSnapshot,
    () => false,
  );
  return compact ? MOBILE_CATEGORY_PAGE_SIZE : DESKTOP_CATEGORY_PAGE_SIZE;
}

function subscribeToCategoryQuery(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(CATEGORY_QUERY_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(CATEGORY_QUERY_CHANGE_EVENT, onStoreChange);
  };
}

function categoryQuerySnapshot() {
  return window.location.search;
}

function categoryQueryServerSnapshot() {
  return "";
}

function useCategoryQueryString() {
  return useSyncExternalStore(
    subscribeToCategoryQuery,
    categoryQuerySnapshot,
    categoryQueryServerSnapshot,
  );
}

function categoryPageFromQuery(params: URLSearchParams) {
  const parsed = Number(params.get("page") ?? "1");
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function categoryFreshnessFromQuery(params: URLSearchParams): PublicDataFreshnessFilter {
  const value = params.get("freshness");
  return value === "recent-7d"
    || value === "recent-30d"
    || value === "expired"
    || value === "review-needed"
    || value === "all"
    ? value
    : "active";
}

function youthPolicyViewFromQuery(params: URLSearchParams): YouthPolicyViewMode {
  return params.get("view") === "all" ? "all" : "personalized";
}

function youthPolicySectionFromQuery(params: URLSearchParams): YouthPolicySectionId {
  const value = params.get("section");
  return YOUTH_POLICY_SECTION_IDS.includes(value as YouthPolicySectionId)
    ? value as YouthPolicySectionId
    : "employment";
}

function youthPolicyRegionFromQuery(params: URLSearchParams): YouthPolicyRegionSelection {
  const value = params.get("region");
  if (value === "nationwide") return { mode: "nationwide" };
  if (YOUTH_POLICY_REGIONS.includes(value as YouthPolicyRegion)) {
    return {
      mode: "region",
      region: value as YouthPolicyRegion,
      includeNationwide: params.get("includeNationwide") !== "false",
    };
  }
  return { mode: "all" };
}

function updateCategoryQuery(update: {
  page?: number;
  freshness?: PublicDataFreshnessFilter;
  view?: YouthPolicyViewMode;
  section?: YouthPolicySectionId | FinanceSection;
  regionSelection?: YouthPolicyRegionSelection;
  query?: string;
}, historyMode: "push" | "replace" = "push") {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (update.page !== undefined) {
    if (update.page <= 1) params.delete("page");
    else params.set("page", String(update.page));
  }
  if (update.freshness !== undefined) {
    if (update.freshness === "active") params.delete("freshness");
    else params.set("freshness", update.freshness);
  }
  if (update.view !== undefined) {
    params.set("view", update.view);
  }
  if (update.section !== undefined) {
    if (update.section === "employment") params.delete("section");
    else params.set("section", update.section);
  }
  if (update.regionSelection !== undefined) {
    if (update.regionSelection.mode === "all") {
      params.delete("region");
      params.delete("includeNationwide");
    } else if (update.regionSelection.mode === "nationwide") {
      params.set("region", "nationwide");
      params.delete("includeNationwide");
    } else {
      params.set("region", update.regionSelection.region);
      if (update.regionSelection.includeNationwide) params.delete("includeNationwide");
      else params.set("includeNationwide", "false");
    }
  }
  if (update.query !== undefined) {
    if (update.query.trim()) params.set("query", update.query.slice(0, 200));
    else params.delete("query");
  }
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;
  window.history[historyMode === "replace" ? "replaceState" : "pushState"](
    window.history.state,
    "",
    nextUrl,
  );
  window.dispatchEvent(new Event(CATEGORY_QUERY_CHANGE_EVENT));
}

const emptyDashboard: PublicDataDashboard = {
  ...emptyPublicDataPayload(),
  status: "empty",
  cached: false,
  stale: false,
  lastSuccessfulAt: null,
  nextRefreshAt: null,
  canRefresh: false,
  refreshInSeconds: 0,
  authenticated: false,
  sourceSchedules: [],
};

const portalCopy = {
  ko: {
    hubEyebrow: "OFFICIAL DATA HUB", hubTitle: "필요한 금융·정책 정보를 분야별로 확인하세요", hubLead: "카드의 저장 원본은 공급처별 서버 보관 건수이며, 상세 페이지에서는 중복을 제거한 뒤 선택 조건에 맞는 결과를 보여줍니다.",
    lastSync: "마지막 정보 업데이트", cached: "업데이트 완료", stale: "마지막 정상 데이터", empty: "수집된 데이터 없음", loading: "공식 데이터를 확인하고 있어요.", unavailable: "공식 데이터를 불러오지 못했습니다.", retry: "다시 불러오기",
    collected: "수집", hubStored: "저장 원본", fresh: "신규", open: "페이지 열기", exchange: "환율 정보", exchangeLead: "현재 환율과 실제 수집된 일별 시계열을 확인합니다.", rates: "통화",
    search: "정보 검색", searchPlaceholder: "제목, 기관, 태그로 검색", official: "공식 원문", officialDetail: "공식 상세 원문", officialDataset: "공식 데이터 출처", published: "기준·공고일", noData: "현재 수집된 공식 정보가 0건입니다.", noMatch: "검색 조건과 일치하는 정보가 없습니다.", collectedItems: "현재 수집 항목", loginRead: "새로운 정보는 이 페이지에서 확인할 수 있습니다.", explain: "상세보기", analysisTitle: "이 정보 쉽게 이해하기", analysisLoading: "공식 데이터에 근거해 설명을 준비하고 있어요.", analysisFailed: "설명을 불러오지 못했습니다. 공식 원문은 계속 확인할 수 있습니다.", analysisRetry: "설명 다시 불러오기", analysisPoints: "핵심 포인트", analysisCautions: "확인할 점", analysisCached: "저장된 AI 설명 재사용", analysisGenerated: "현재 AI로 새로 생성", analysisRule: "공식 데이터 규칙 설명",
    youthEyebrow: "YOUTH POLICY", youthTitle: "청년 정책 정보", youthLead: "자산형성·학자금·금융지원 정보를 공식 제공기관별로 확인합니다.",
    financeEyebrow: "FINANCIAL OVERVIEW", financeTitle: "금융 정보", financeLead: "기준금리·대출금리·물가를 먼저 확인하고 필요한 금융상품만 비교해 보세요.", financeExchange: "환율 시계열 보러 가기",
    startupEyebrow: "STARTUP & DISTRICTS", startupTitle: "창업·상권 정보", startupLead: "신청 가능한 창업 지원 공고를 먼저 확인하고 주요 지역별 상권 현황을 살펴보세요.",
    employmentEyebrow: "INCLUSIVE EMPLOYMENT", employmentTitle: "대상별 취업 통계", employmentLead: "KOSIS에서 수집한 청년·고령층·외국인 고용 지표를 기준시점과 함께 확인합니다.",
    snapshotTitle: "먼저 보는 금융 지표", snapshotLead: "한국은행 ECOS에서 수집된 값입니다. 카드를 누르면 지표의 의미와 공식 출처를 확인할 수 있습니다.", noMetric: "수집된 값 없음", metricSource: "지표 원문 보기",
    metrics: {
      base: { label: "기준금리", explanation: "한국은행이 물가와 경기 상황을 고려해 정하는 정책금리로, 예금과 대출금리의 기준이 됩니다." },
      loan: { label: "대출금리", explanation: "금융기관의 대출 금리 수준을 보여줍니다. 실제 적용금리는 신용도와 상품 조건에 따라 달라집니다." },
      cpi: { label: "소비자물가", explanation: "가계가 구매하는 상품과 서비스의 가격 변화를 나타내며, 생활비와 실질 구매력 판단에 활용됩니다." },
    },
    compareTitle: "공식 상품 비교 도우미", compareLead: "금액·기간·자금 계획을 입력하면 현재 수집된 예금·적금 공시를 규칙 기반으로 비교합니다.", productType: "상품 유형", amount: "비교 금액", amountLabels: { deposit: "예치할 목돈", saving: "매월 납입액" }, period: "예상 기간", won: "원", months: "개월", liquidity: "중도 사용 가능성", liquidityOptions: { low: "낮음", medium: "보통", high: "높음" }, channel: "가입 방식", channelOptions: { any: "상관없음", online: "온라인", branch: "영업점" }, compare: "후보 비교하기", compareResult: "비교 후보", compareRule: "AI와 유료 API를 사용하지 않는 규칙 기반 비교입니다. 점수는 입력 조건과 공식 공시의 적합도를 나타내며 가입 권유가 아닙니다.", recommendationLoading: "공식 공시 상품을 비교하고 있어요.", recommendationFailed: "상품 비교 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", score: "조건 일치", recommendationReason: "비교 근거", recommendationCheck: "가입 전 확인", noRecommendation: "현재 조건에 맞춰 비교할 수 있는 공시 상품이 0건입니다.",
    productKinds: { deposit: "예금", saving: "적금" }, showProducts: "전체 금융상품 보기", hideProducts: "금융상품 접기", showUpdates: "공시·시장정보 보기", hideUpdates: "공시·시장정보 접기", productList: "공식 금융상품", updateList: "공시·시장정보", noProduct: "선택한 유형의 수집 상품이 0건입니다.",
    supportTitle: "신청 가능한 창업 지원 공고", supportLead: "기업마당에서 수집한 창업 지원사업을 최신 공고 순으로 확인하세요.", noSupport: "수집된 창업 지원 공고가 0건입니다.",
    districtTitle: "주요 지역별 상권", districtLead: "서울시 공식 추정매출 상위 10개를 먼저 보고, 전체 상권은 검색·지도에서 업종과 시간대별 흐름까지 확인하세요.", districtRecords: "공식 상권", districtUnit: "개 지역", districtSearch: "지역 또는 특징으로 검색", noDistrict: "지역으로 묶을 수 있는 주요상권 정보가 0건입니다.",
    mapTitle: "지역 상권 지도", mapLead: "공식 좌표가 있는 지역만 지도에 표시합니다.", mapEmpty: "위치 좌표가 제공된 지역 상권이 0건입니다.", mapSelect: "지도에서 확인할 지역", mapFrame: "OpenStreetMap에서 확인하는 지역 상권", mapAttribution: "© OpenStreetMap contributors", mapNote: "지도는 위치 이해를 돕는 보조 자료입니다. 실제 출점 판단에는 추가 상권 조사가 필요합니다.",
  },
  en: {
    hubEyebrow: "OFFICIAL DATA HUB", hubTitle: "Explore finance and policy information by topic", hubLead: "Stored source rows are server totals by provider; detail pages remove duplicates before applying your filters.",
    lastSync: "Last information update", cached: "Up to date", stale: "Last valid data", empty: "No collected data", loading: "Checking official data.", unavailable: "Official data could not be loaded.", retry: "Try again",
    collected: "Collected", hubStored: "Stored source rows", fresh: "New", open: "Open page", exchange: "Exchange rates", exchangeLead: "Review current rates and collected daily history.", rates: "currencies",
    search: "Search information", searchPlaceholder: "Search title, institution or tag", official: "Official source", officialDetail: "Official item", officialDataset: "Official data source", published: "As of / published", noData: "There are 0 collected official records.", noMatch: "No information matches these filters.", collectedItems: "Collected records", loginRead: "New information can be reviewed on this page.", explain: "View details", analysisTitle: "Understand this information", analysisLoading: "Preparing an explanation grounded in the official data.", analysisFailed: "The explanation could not be loaded. The official source remains available.", analysisRetry: "Try explanation again", analysisPoints: "Key points", analysisCautions: "Things to check", analysisCached: "Reused saved AI explanation", analysisGenerated: "Generated with the current AI", analysisRule: "Official-data rule explanation",
    youthEyebrow: "YOUTH POLICY", youthTitle: "Youth policy", youthLead: "Review asset-building, scholarship and financial-support information by official provider.",
    financeEyebrow: "FINANCIAL OVERVIEW", financeTitle: "Financial information", financeLead: "Start with the base rate, loan rate and inflation, then compare only the products you need.", financeExchange: "Open exchange-rate history",
    startupEyebrow: "STARTUP & DISTRICTS", startupTitle: "Startup and district information", startupLead: "Review available startup-support announcements first, then explore commercial data by major area.",
    employmentEyebrow: "INCLUSIVE EMPLOYMENT", employmentTitle: "Employment statistics by group", employmentLead: "Review KOSIS employment indicators for youth, older adults and foreign residents with their reference periods.",
    snapshotTitle: "Key financial indicators", snapshotLead: "Values collected from the Bank of Korea ECOS. Open a card to understand the indicator and visit its official source.", noMetric: "No collected value", metricSource: "Open indicator source",
    metrics: {
      base: { label: "Base rate", explanation: "The Bank of Korea policy rate influences deposit and lending rates across the financial system." },
      loan: { label: "Loan rate", explanation: "This shows the general level of bank lending rates. Your actual rate depends on credit and product conditions." },
      cpi: { label: "Consumer prices", explanation: "Consumer prices track changes in household goods and services and help explain living-cost pressure." },
    },
    compareTitle: "Official product comparison", compareLead: "Enter an amount, term and funding plan to compare collected deposit and savings disclosures with deterministic rules.", productType: "Product type", amount: "Comparison amount", amountLabels: { deposit: "Lump sum to deposit", saving: "Monthly contribution" }, period: "Expected term", won: "KRW", months: "months", liquidity: "Need early access", liquidityOptions: { low: "Low", medium: "Medium", high: "High" }, channel: "Join channel", channelOptions: { any: "Any", online: "Online", branch: "Branch" }, compare: "Compare candidates", compareResult: "Candidates to compare", compareRule: "This is a rule-based comparison that uses no AI or paid API. Scores indicate how closely official disclosures match your inputs and are not a recommendation to subscribe.", recommendationLoading: "Comparing official product disclosures.", recommendationFailed: "The comparison could not be loaded. Please try again shortly.", score: "Match", recommendationReason: "Comparison basis", recommendationCheck: "Check before joining", noRecommendation: "There are 0 disclosed products that can be compared for these inputs.",
    productKinds: { deposit: "Deposit", saving: "Installment saving" }, showProducts: "Show all financial products", hideProducts: "Hide financial products", showUpdates: "Show disclosures and markets", hideUpdates: "Hide disclosures and markets", productList: "Official financial products", updateList: "Disclosures and market information", noProduct: "There are 0 collected products of this type.",
    supportTitle: "Startup-support announcements", supportLead: "Review the latest startup programs collected from Bizinfo.", noSupport: "There are 0 collected startup-support announcements.",
    districtTitle: "Commercial areas by major district", districtLead: "Start with Seoul's official top 10 by estimated sales, then search or use the map to inspect industry and time-band activity.", districtRecords: "official zones", districtUnit: "districts", districtSearch: "Search area or feature", noDistrict: "There are 0 official commercial zones that can be grouped by area.",
    mapTitle: "Commercial-area map", mapLead: "Only areas with official coordinates appear on the map.", mapEmpty: "There are 0 commercial areas with coordinates.", mapSelect: "Select an area to view", mapFrame: "Commercial area on OpenStreetMap", mapAttribution: "© OpenStreetMap contributors", mapNote: "The map is a location aid. Additional market research is required before making a business decision.",
  },
  ja: {
    hubEyebrow: "OFFICIAL DATA HUB", hubTitle: "金融・政策情報を分野別に確認", hubLead: "保存元データ数は提供元別のサーバー保存件数です。詳細ページでは重複を除いてから条件を適用します。",
    lastSync: "最終情報更新", cached: "更新済み", stale: "最終正常データ", empty: "収集データなし", loading: "公式データを確認しています。", unavailable: "公式データを読み込めませんでした。", retry: "再読み込み",
    collected: "収集", hubStored: "保存元データ", fresh: "新着", open: "ページを開く", exchange: "為替情報", exchangeLead: "現在レートと収集済みの日次推移を確認します。", rates: "通貨",
    search: "情報検索", searchPlaceholder: "タイトル・機関・タグで検索", official: "公式原文", officialDetail: "公式の詳細原文", officialDataset: "公式データ出典", published: "基準・公表日", noData: "収集済みの公式情報は0件です。", noMatch: "検索条件に一致する情報はありません。", collectedItems: "現在の収集項目", loginRead: "新着情報はこのページで確認できます。", explain: "詳細を見る", analysisTitle: "この情報をやさしく理解", analysisLoading: "公式データに基づく説明を準備しています。", analysisFailed: "説明を読み込めませんでした。公式原文は引き続き確認できます。", analysisRetry: "説明を再読み込み", analysisPoints: "重要ポイント", analysisCautions: "確認事項", analysisCached: "保存済みAI説明を再利用", analysisGenerated: "現在のAIで新規生成", analysisRule: "公式データのルール説明",
    youthEyebrow: "YOUTH POLICY", youthTitle: "若者政策情報", youthLead: "資産形成・奨学金・金融支援を公式提供機関別に確認します。",
    financeEyebrow: "FINANCIAL OVERVIEW", financeTitle: "金融情報", financeLead: "基準金利・貸出金利・物価を先に確認し、必要な金融商品だけを比較できます。", financeExchange: "為替推移を見る",
    startupEyebrow: "STARTUP & DISTRICTS", startupTitle: "創業・商圏情報", startupLead: "応募可能な創業支援を先に確認し、主要地域別の商圏情報を見てみましょう。",
    employmentEyebrow: "INCLUSIVE EMPLOYMENT", employmentTitle: "対象別の就業統計", employmentLead: "KOSISから収集した若者・高齢層・外国人の雇用指標を基準時点とともに確認します。",
    snapshotTitle: "最初に見る金融指標", snapshotLead: "韓国銀行ECOSから収集した値です。カードを開くと意味と公式出典を確認できます。", noMetric: "収集値なし", metricSource: "指標の原文を見る",
    metrics: {
      base: { label: "基準金利", explanation: "韓国銀行の政策金利で、預金・貸出金利の基準になります。" },
      loan: { label: "貸出金利", explanation: "銀行貸出金利の全体的な水準です。実際の適用金利は信用力や商品条件で異なります。" },
      cpi: { label: "消費者物価", explanation: "家計が購入する商品・サービスの価格変化を示し、生活費の判断に使われます。" },
    },
    compareTitle: "公式商品比較サポート", compareLead: "金額・期間・資金計画を入力し、収集済みの預金・積立預金をルールで比較します。", productType: "商品タイプ", amount: "比較金額", amountLabels: { deposit: "預ける一括資金", saving: "毎月の積立額" }, period: "予定期間", won: "ウォン", months: "か月", liquidity: "途中利用の必要性", liquidityOptions: { low: "低い", medium: "普通", high: "高い" }, channel: "加入方法", channelOptions: { any: "指定なし", online: "オンライン", branch: "店舗" }, compare: "候補を比較", compareResult: "比較候補", compareRule: "AIや有料APIを使わないルールベース比較です。点数は入力条件と公式公示の一致度であり、加入推奨ではありません。", recommendationLoading: "公式公示商品を比較しています。", recommendationFailed: "比較結果を読み込めませんでした。しばらくしてからもう一度お試しください。", score: "条件一致", recommendationReason: "比較根拠", recommendationCheck: "加入前の確認", noRecommendation: "この条件で比較できる公示商品は0件です。",
    productKinds: { deposit: "定期預金", saving: "積立預金" }, showProducts: "全金融商品を見る", hideProducts: "金融商品を閉じる", showUpdates: "公示・市場情報を見る", hideUpdates: "公示・市場情報を閉じる", productList: "公式金融商品", updateList: "公示・市場情報", noProduct: "選択タイプの収集商品は0件です。",
    supportTitle: "創業支援の公募情報", supportLead: "企業マダンから収集した創業支援事業を新しい順に確認できます。", noSupport: "収集済みの創業支援公募は0件です。",
    districtTitle: "主要地域別の商圏", districtLead: "ソウル市の公式推定売上上位10商圏を先に表示し、全商圏は検索・地図から業種と時間帯別動向を確認できます。", districtRecords: "公式商圏", districtUnit: "地域", districtSearch: "地域・特徴を検索", noDistrict: "地域別にまとめられる主要商圏情報は0件です。",
    mapTitle: "地域商圏マップ", mapLead: "公式座標がある地域だけを地図に表示します。", mapEmpty: "座標付きの地域商圏は0件です。", mapSelect: "地図で確認する地域", mapFrame: "OpenStreetMapで確認する地域商圏", mapAttribution: "© OpenStreetMap contributors", mapNote: "地図は位置把握の補助資料です。出店判断には追加の商圏調査が必要です。",
  },
  zh: {
    hubEyebrow: "OFFICIAL DATA HUB", hubTitle: "按领域查看金融与政策信息", hubLead: "保存原始数据是服务器按来源保存的记录数；详情页会先去重，再应用筛选条件。",
    lastSync: "最后信息更新", cached: "已更新", stale: "最后有效数据", empty: "暂无采集数据", loading: "正在检查官方数据。", unavailable: "无法加载官方数据。", retry: "重新加载",
    collected: "已采集", hubStored: "保存原始数据", fresh: "新增", open: "打开页面", exchange: "汇率信息", exchangeLead: "查看当前汇率与已采集的每日走势。", rates: "种货币",
    search: "搜索信息", searchPlaceholder: "按标题、机构或标签搜索", official: "官方原文", officialDetail: "官方详细原文", officialDataset: "官方数据来源", published: "基准/公告日", noData: "当前采集的官方信息为0条。", noMatch: "没有符合搜索条件的信息。", collectedItems: "当前采集项目", loginRead: "可在本页查看新增信息。", explain: "查看详情", analysisTitle: "轻松理解此信息", analysisLoading: "正在根据官方数据准备说明。", analysisFailed: "无法加载说明，但仍可查看官方原文。", analysisRetry: "重新加载说明", analysisPoints: "核心要点", analysisCautions: "注意事项", analysisCached: "复用已保存的AI说明", analysisGenerated: "由当前AI新生成", analysisRule: "官方数据规则说明",
    youthEyebrow: "YOUTH POLICY", youthTitle: "青年政策信息", youthLead: "按官方提供机构查看资产形成、奖学金与金融支持信息。",
    financeEyebrow: "FINANCIAL OVERVIEW", financeTitle: "金融信息", financeLead: "先查看基准利率、贷款利率和物价，再比较真正需要的金融产品。", financeExchange: "查看汇率走势",
    startupEyebrow: "STARTUP & DISTRICTS", startupTitle: "创业与商圈信息", startupLead: "优先查看可申请的创业扶持公告，再按主要区域了解商圈情况。",
    employmentEyebrow: "INCLUSIVE EMPLOYMENT", employmentTitle: "分群就业统计", employmentLead: "查看从KOSIS采集的青年、高龄群体及外国居民就业指标与基准时期。",
    snapshotTitle: "关键金融指标", snapshotLead: "数据采集自韩国银行ECOS。展开卡片可了解指标含义并查看官方来源。", noMetric: "暂无采集值", metricSource: "查看指标原文",
    metrics: {
      base: { label: "基准利率", explanation: "韩国银行制定的政策利率，是存款和贷款利率的重要基准。" },
      loan: { label: "贷款利率", explanation: "反映银行贷款利率的总体水平，实际利率会因信用和产品条件而不同。" },
      cpi: { label: "消费者物价", explanation: "反映家庭购买商品和服务的价格变化，可用于判断生活成本压力。" },
    },
    compareTitle: "官方产品比较助手", compareLead: "输入金额、期限与资金计划，使用规则比较已采集的定期存款和分期储蓄披露。", productType: "产品类型", amount: "比较金额", amountLabels: { deposit: "拟存入的一次性资金", saving: "每月缴存额" }, period: "预计期限", won: "韩元", months: "个月", liquidity: "中途使用需求", liquidityOptions: { low: "低", medium: "中", high: "高" }, channel: "办理方式", channelOptions: { any: "不限", online: "线上", branch: "网点" }, compare: "比较候选", compareResult: "比较候选", compareRule: "这是不使用AI或付费API的规则比较。分数仅表示输入条件与官方披露的匹配程度，不构成办理建议。", recommendationLoading: "正在比较官方披露产品。", recommendationFailed: "无法加载比较结果，请稍后重试。", score: "条件匹配", recommendationReason: "比较依据", recommendationCheck: "办理前确认", noRecommendation: "当前条件下可比较的披露产品为0条。",
    productKinds: { deposit: "定期存款", saving: "分期储蓄" }, showProducts: "查看全部金融产品", hideProducts: "收起金融产品", showUpdates: "查看披露与市场信息", hideUpdates: "收起披露与市场信息", productList: "官方金融产品", updateList: "披露与市场信息", noProduct: "所选类型的采集产品为0条。",
    supportTitle: "创业扶持公告", supportLead: "按最新顺序查看从企业信息门户采集的创业扶持项目。", noSupport: "采集的创业扶持公告为0条。",
    districtTitle: "主要区域商圈", districtLead: "优先显示首尔市官方估算销售额前10名，其余商圈可通过搜索或地图查看行业及分时段活动。", districtRecords: "官方商圈", districtUnit: "个区域", districtSearch: "搜索区域或特征", noDistrict: "可按区域汇总的主要商圈信息为0条。",
    mapTitle: "区域商圈地图", mapLead: "仅在地图上显示含官方坐标的区域。", mapEmpty: "含位置坐标的区域商圈为0条。", mapSelect: "选择地图区域", mapFrame: "在OpenStreetMap中查看区域商圈", mapAttribution: "© OpenStreetMap contributors", mapNote: "地图仅用于辅助理解位置，实际选址前仍需进一步开展商圈调查。",
  },
} as const;

const sourcePreviewCopy = {
  ko: {
    guideTitle: "사이트 안에서 먼저 이해하고, 원문은 마지막에 확인하세요",
    guideLead: "외부 페이지를 바로 열지 않아도 핵심 내용과 기준을 먼저 파악할 수 있습니다.",
    guideSteps: [
      ["1. 핵심 요약", "지원 내용·지표 의미·주요 범위를 이 화면에서 먼저 읽습니다."],
      ["2. 기준 확인", "제공기관, 기준·공고일, 지역과 태그가 내 상황에 맞는지 확인합니다."],
      ["3. 공식 원문", "신청·계약 전 최신 자격, 마감, 서류와 변경 사항을 최종 확인합니다."],
    ],
    briefTitle: "이 정보 한눈에 보기",
    summaryTitle: "무엇을 알 수 있나요?",
    provider: "제공기관",
    referenceDate: "기준·공고일",
    deadline: "공식 마감일",
    lastVerified: "마지막 수집 확인",
    scope: "확인된 범위",
    scopeFallback: "제목·제공기관·기준일",
    noSummary: "현재 수집된 항목에는 별도 요약이 없습니다. 제목·제공기관·기준일을 먼저 확인하고, 세부 조건은 공식 원문에서 확인하세요.",
    officialPurpose: "공식 원문은 언제 열까요?",
    officialPurposeBody: "이 화면에서 개요를 이해한 뒤, 최신 자격·정의·마감·제출서류처럼 바뀔 수 있는 조건을 최종 확인하거나 실제 신청·계약을 진행할 때 여세요.",
    latestConditions: "최신 조건·신청 절차 확인",
  },
  en: {
    guideTitle: "Understand it here first, then use the official source last",
    guideLead: "You can review the key meaning and reference details before leaving this site.",
    guideSteps: [
      ["1. Read the summary", "Understand the support, indicator or scope on this page first."],
      ["2. Check the basis", "Compare the provider, reference date, location and tags with your situation."],
      ["3. Verify officially", "Before applying or signing, confirm current eligibility, deadlines, documents and changes."],
    ],
    briefTitle: "Information at a glance",
    summaryTitle: "What does this tell you?",
    provider: "Provider",
    referenceDate: "As of / published",
    deadline: "Official deadline",
    lastVerified: "Last collected",
    scope: "Collected scope",
    scopeFallback: "Title, provider and reference date",
    noSummary: "No separate summary was collected for this item. Review its title, provider and reference date here, then use the official source for detailed terms.",
    officialPurpose: "When should you open the official source?",
    officialPurposeBody: "After understanding the overview here, open it to verify changeable details such as current eligibility, definitions, deadlines and documents, or to complete an application or contract.",
    latestConditions: "Verify current terms and procedure",
  },
  ja: {
    guideTitle: "まずサイト内で理解し、最後に公式原文を確認",
    guideLead: "外部ページへ移動する前に、要点と基準情報をこの画面で確認できます。",
    guideSteps: [
      ["1. 要点を読む", "支援内容・指標の意味・主な範囲をこの画面で先に確認します。"],
      ["2. 基準を確認", "提供機関、基準・公表日、地域、タグが自分の状況に合うか確認します。"],
      ["3. 公式原文", "申請・契約前に最新の資格、締切、書類、変更事項を最終確認します。"],
    ],
    briefTitle: "この情報をひと目で確認",
    summaryTitle: "何が分かりますか？",
    provider: "提供機関",
    referenceDate: "基準・公表日",
    deadline: "公式締切",
    lastVerified: "最終収集確認",
    scope: "確認済みの範囲",
    scopeFallback: "タイトル・提供機関・基準日",
    noSummary: "この項目には個別の要約が収集されていません。タイトル・提供機関・基準日を先に確認し、詳細条件は公式原文でご確認ください。",
    officialPurpose: "公式原文はいつ開きますか？",
    officialPurposeBody: "ここで概要を理解した後、最新の資格・定義・締切・提出書類など変更され得る条件の最終確認や、実際の申請・契約時に開いてください。",
    latestConditions: "最新条件・手続きを確認",
  },
  zh: {
    guideTitle: "先在站内理解，最后再查看官方原文",
    guideLead: "无需立即跳转外部页面，也能先了解核心内容和基准信息。",
    guideSteps: [
      ["1. 阅读摘要", "先在本页了解扶持内容、指标含义或主要范围。"],
      ["2. 核对依据", "确认提供机构、基准/公告日、地区和标签是否符合自身情况。"],
      ["3. 官方核实", "申请或签约前，最终核实最新资格、截止日期、材料及变更。"],
    ],
    briefTitle: "信息一览",
    summaryTitle: "可以了解什么？",
    provider: "提供机构",
    referenceDate: "基准/公告日",
    deadline: "官方截止日期",
    lastVerified: "最后采集确认",
    scope: "已采集范围",
    scopeFallback: "标题、提供机构和基准日期",
    noSummary: "当前采集项目没有单独摘要。请先查看标题、提供机构和基准日期，详细条件请在官方原文中确认。",
    officialPurpose: "何时打开官方原文？",
    officialPurposeBody: "在此了解概要后，如需最终确认最新资格、定义、截止日期、提交材料等可能变化的条件，或实际申请、签约时再打开。",
    latestConditions: "核实最新条件与办理流程",
  },
} satisfies Record<PublicInformationLocale, {
  guideTitle: string;
  guideLead: string;
  guideSteps: readonly [string, string][];
  briefTitle: string;
  summaryTitle: string;
  provider: string;
  referenceDate: string;
  deadline: string;
  lastVerified: string;
  scope: string;
  scopeFallback: string;
  noSummary: string;
  officialPurpose: string;
  officialPurposeBody: string;
  latestConditions: string;
}>;

const categoryMeta = {
  youth: { href: "/information/youth", icon: UserRound, eyebrow: "youthEyebrow", title: "youthTitle", lead: "youthLead" },
  finance: { href: "/information/finance", icon: Landmark, eyebrow: "financeEyebrow", title: "financeTitle", lead: "financeLead" },
  startup: { href: "/information/startup", icon: BriefcaseBusiness, eyebrow: "startupEyebrow", title: "startupTitle", lead: "startupLead" },
  employment: { href: "/information/employment", icon: BarChart3, eyebrow: "employmentEyebrow", title: "employmentTitle", lead: "employmentLead" },
} as const;

function formatDate(value: string | null, locale: PublicInformationLocale) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(localeTags[locale], { year: "numeric", month: "short", day: "numeric" }).format(parsed);
}

function formatDateTime(value: string | null, locale: PublicInformationLocale) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(localeTags[locale], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}

function displayPublicText(value: string) {
  return value
    .replaceAll("&apos;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&#40;", "(")
    .replaceAll("&#41;", ")")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&middot;", "·")
    .replaceAll("&quot;", "\"")
    .replaceAll("&amp;", "&");
}

type YouthPolicyViewMode = "personalized" | "all";

const PUBLIC_DASHBOARD_RETRY_DELAYS_MS = [750, 2_000] as const;
const PUBLIC_DASHBOARD_REQUEST_TIMEOUT_MS = 10_000;
const PRODUCT_RECOMMENDATION_REQUEST_TIMEOUT_MS = 12_000;
const ITEM_ANALYSIS_REQUEST_TIMEOUT_MS = 30_000;
const BILLABLE_ITEM_ANALYSIS_REQUEST_TIMEOUT_MS = 60_000;

class PublicDashboardRequestError extends Error {
  constructor(readonly retryable: boolean) {
    super("public_dashboard_unavailable");
  }
}

function waitForPublicDashboardRetry(delay: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve(true);
    }, delay);
    function cancel() {
      window.clearTimeout(timer);
      resolve(false);
    }
    signal.addEventListener("abort", cancel, { once: true });
  });
}

const youthHeroCountCopy = {
  ko: { collected: "전체 수집", matched: "내 조건 선별", fresh: "신규" },
  en: { collected: "All collected", matched: "Matched to me", fresh: "New" },
  ja: { collected: "全体収集", matched: "自分向け", fresh: "新着" },
  zh: { collected: "全部收集", matched: "符合我的条件", fresh: "新增" },
} as const;

function usePublicDashboard(
  category?: PublicInformationCategory,
  youthPolicyView: YouthPolicyViewMode = "personalized",
  freshness: PublicDataFreshnessFilter = "active",
  page = 1,
  youthSection: YouthPolicySectionId = "employment",
  youthRegionSelection: YouthPolicyRegionSelection = { mode: "all" },
  pageSize = DESKTOP_CATEGORY_PAGE_SIZE,
  startupQuery = "",
  financeSection: FinanceSection = "products",
) {
  const [dashboard, setDashboard] = useState<PublicDataDashboard>(emptyDashboard);
  const youthRegionQuery = youthRegionSelection.mode === "all"
    ? ""
    : youthRegionSelection.mode === "nationwide"
      ? "&region=nationwide"
      : `&region=${encodeURIComponent(youthRegionSelection.region)}&includeNationwide=${youthRegionSelection.includeNationwide}`;
  const youthQuery = category === "youth"
    ? `${youthPolicyView === "all" ? "&view=all" : ""}&section=${encodeURIComponent(youthSection)}${youthRegionQuery}`
    : category === "startup" ? `${youthRegionQuery}&query=${encodeURIComponent(startupQuery)}`
      : category === "finance" ? `&section=${financeSection}&query=${encodeURIComponent(startupQuery)}` : "";
  const supplementalQuery = page === 1 && category === "startup"
    ? "&includeSupplemental=true"
    : "";
  const catalogScope = `${category ?? "all"}:${youthPolicyView}:${freshness}:${pageSize}:${youthSection}:${youthRegionQuery}:${startupQuery}:${financeSection}`;
  const catalogVersionRef = useRef<{ scope: string; version: string } | null>(null);
  const [catalogChanged, setCatalogChanged] = useState(false);
  const requestKey = `${catalogScope}:${page}:${supplementalQuery}`;
  const [retryGeneration, setRetryGeneration] = useState(0);
  const activeRequestKey = `${requestKey}:${retryGeneration}`;
  const [resolvedRequestKey, setResolvedRequestKey] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const loading = resolvedRequestKey !== activeRequestKey;

  useEffect(() => {
    const lifecycleController = new AbortController();
    const baseEndpoint = category
      ? `/api/public-data/dashboard?category=${encodeURIComponent(category)}&freshness=${encodeURIComponent(freshness)}&page=${page}&pageSize=${pageSize}${youthQuery}${supplementalQuery}`
      : "/api/public-data/dashboard";
    const pinnedVersion = catalogVersionRef.current?.scope === catalogScope ? catalogVersionRef.current.version : null;
    const endpoint = category && page > 1 && pinnedVersion
      ? `${baseEndpoint}&catalogVersion=${encodeURIComponent(pinnedVersion)}` : baseEndpoint;
    async function requestDashboard() {
      for (let attempt = 0; attempt <= PUBLIC_DASHBOARD_RETRY_DELAYS_MS.length; attempt += 1) {
        const requestController = new AbortController();
        let timedOut = false;
        const cancelForUnmount = () => requestController.abort();
        lifecycleController.signal.addEventListener("abort", cancelForUnmount, { once: true });
        const timeoutId = window.setTimeout(() => {
          timedOut = true;
          requestController.abort();
        }, PUBLIC_DASHBOARD_REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(endpoint, {
            cache: "no-store",
            credentials: "same-origin",
            signal: requestController.signal,
          });
          if (lifecycleController.signal.aborted) return null;
          if (timedOut) throw new PublicDashboardRequestError(true);
          if (response.status === 409) {
            const changed = await response.json() as { error?: string; catalogVersion?: string };
            if (lifecycleController.signal.aborted) return null;
            if (changed.error === "public_catalog_changed") {
              catalogVersionRef.current = typeof changed.catalogVersion === "string"
                ? { scope: catalogScope, version: changed.catalogVersion } : null;
              setCatalogChanged(true);
              if (page > 1) {
                updateCategoryQuery({ page: 1 }, "replace");
                return null;
              }
              // A collection may finish during the first-page read as well.
              // Reuse the bounded GET retry budget; never spin on repeated 409s.
              throw new PublicDashboardRequestError(true);
            }
          }
          if (!response.ok) {
            throw new PublicDashboardRequestError(response.status === 408 || response.status === 425 || response.status >= 500);
          }
          const payload = await response.json() as PublicDataDashboard;
          if (lifecycleController.signal.aborted) return null;
          if (timedOut) throw new PublicDashboardRequestError(true);
          if (typeof payload.catalogVersion === "string") catalogVersionRef.current = { scope: catalogScope, version: payload.catalogVersion };
          return payload;
        } catch (error) {
          if (lifecycleController.signal.aborted) return null;
          const retryable = timedOut || !(error instanceof PublicDashboardRequestError) || error.retryable;
          const delay = PUBLIC_DASHBOARD_RETRY_DELAYS_MS[attempt];
          if (!retryable || delay === undefined) throw error;
          if (!await waitForPublicDashboardRetry(delay, lifecycleController.signal)) return null;
        } finally {
          window.clearTimeout(timeoutId);
          lifecycleController.signal.removeEventListener("abort", cancelForUnmount);
        }
      }
      return null;
    }
    void requestDashboard()
      .then((data) => {
        if (lifecycleController.signal.aborted || !data) return;
        setDashboard(data);
        setFailed(false);
        setResolvedRequestKey(activeRequestKey);
      })
      .catch(() => {
        if (!lifecycleController.signal.aborted) {
          setFailed(true);
          setResolvedRequestKey(activeRequestKey);
        }
      });
    return () => lifecycleController.abort();
  }, [activeRequestKey, catalogScope, category, freshness, page, pageSize, supplementalQuery, youthQuery]);

  useEffect(() => {
    if (!category || !dashboard.authenticated || !dashboard.lastSuccessfulAt) return;
    const controller = new AbortController();
    const key = `bora-public-read:${category}:${dashboard.lastSuccessfulAt}`;
    if (window.sessionStorage.getItem(key) === "true") return;
    let recorded = false;
    window.sessionStorage.setItem(key, "true");
    const seenThrough = dashboard.lastSuccessfulAt;
    window.queueMicrotask(() => {
      void fetch("/api/public-data/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ category, seenThrough }),
        signal: controller.signal,
      }).then((response) => {
        if (controller.signal.aborted) return;
        if (response.ok) {
          recorded = true;
          setDashboard((current) => ({
            ...current,
            categories: current.categories.map((group) => group.id === category ? { ...group, newCount: 0 } : group),
          }));
        } else {
          window.sessionStorage.removeItem(key);
        }
      }).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) window.sessionStorage.removeItem(key);
      });
    });
    return () => {
      controller.abort();
      if (!recorded) window.sessionStorage.removeItem(key);
    };
  }, [category, dashboard.authenticated, dashboard.lastSuccessfulAt]);

  return {
    dashboard,
    loading,
    catalogChanged,
    failed: failed && resolvedRequestKey === activeRequestKey,
    retry: () => setRetryGeneration((current) => current + 1),
  };
}

const completenessCopy = {
  ko: {
    partial: "현재 일부 공식 정보만 제공됩니다. 최신 전체 내용은 각 공식 원문에서 확인해 주세요.",
    truncated: "현재 화면에는 일부 결과가 표시됩니다. 다음 페이지와 공식 원문에서 나머지를 확인해 주세요.",
  },
  en: {
    partial: "Some official information is currently unavailable. Check each official source for the complete latest details.",
    truncated: "This screen shows part of the available results. Use the next pages and official sources for the rest.",
  },
  ja: {
    partial: "現在、一部の公式情報のみ表示しています。最新の全内容は各公式原文でご確認ください。",
    truncated: "この画面には結果の一部を表示しています。続きは次のページと公式原文でご確認ください。",
  },
  zh: {
    partial: "目前仅提供部分官方信息，完整的最新内容请查看各官方原文。",
    truncated: "当前页面显示部分结果，其余内容请查看后续页面和官方原文。",
  },
} as const;

const collectionHealthCopy = {
  ko: { title: "기관별 수집 상태", current: "최근 수집 정상", delayed: "수집 지연 · 저장 자료 제공", unavailable: "수집 불가 · 원문 확인 필요", disabled: "수집 중지", unknown: "수집 상태 미확인", last: "마지막 수집 성공", help: "저장 자료의 완전성과 현재 수집 상태는 다릅니다. 수집일은 공고일·지표 기준일이 아닙니다." },
  en: { title: "Collection status by source", current: "Collection current", delayed: "Collection delayed · stored data", unavailable: "Collection unavailable · check source", disabled: "Collection disabled", unknown: "Collection status unknown", last: "Last successful collection", help: "Stored-data completeness differs from collection health. Collection time is not a publication or observation date." },
  ja: { title: "機関別の収集状況", current: "最近の収集は正常", delayed: "収集遅延・保存情報を表示", unavailable: "収集不可・原文の確認が必要", disabled: "収集停止", unknown: "収集状況未確認", last: "最終収集成功", help: "保存情報の完全性と収集状況は別です。収集日は公表日や指標の基準日ではありません。" },
  zh: { title: "各来源采集状态", current: "近期采集正常", delayed: "采集延迟·展示已存资料", unavailable: "无法采集·请核实原文", disabled: "采集已停用", unknown: "采集状态未知", last: "上次成功采集", help: "已存资料完整性与采集状态不同。采集时间不是发布或指标基准日期。" },
} as const;

const aiAvailabilityCopy = {
  ko: { model_warming: "AI 모델을 준비하고 있어요. 잠시 후 설명을 다시 요청해 주세요. 지금은 공식 자료 기반 안내를 보여드립니다.", local_inference_busy: "AI가 다른 요청을 처리하고 있어요. 잠시 후 다시 요청할 수 있습니다.", local_inference_timeout: "AI 응답 시간이 초과되어 공식 자료 기반 안내를 보여드립니다. 필요하면 다시 요청해 주세요." },
  en: { model_warming: "The AI model is warming up. Request the explanation again shortly. Official-data guidance is shown meanwhile.", local_inference_busy: "The AI is handling another request. You can try again shortly.", local_inference_timeout: "The AI request timed out. Official-data guidance remains available; retry if needed." },
  ja: { model_warming: "AIモデルを準備中です。しばらくしてから再度ご依頼ください。現在は公式資料の案内を表示します。", local_inference_busy: "AIが別の依頼を処理中です。しばらくしてから再度ご依頼ください。", local_inference_timeout: "AI応答がタイムアウトしました。公式資料の案内を表示しています。必要に応じて再試行してください。" },
  zh: { model_warming: "AI模型正在准备中，请稍后重新请求。当前显示基于官方资料的说明。", local_inference_busy: "AI正在处理其他请求，请稍后重试。", local_inference_timeout: "AI响应超时，当前显示官方资料说明，可按需重试。" },
} as const;

const categorySourceIds: Record<PublicInformationCategory, readonly string[]> = {
  youth: [
    "loan-product",
    "kosaf-high",
    "kosaf-university",
    "work24",
    "youth-center",
    "moel-policy-news",
    "moel-press-releases",
  ],
  finance: [
    "stock",
    "financial-company",
    "loan-product",
    "ecos",
    "finlife",
    "dart",
  ],
  startup: [
    "commercial-area",
    "seoul-commercial",
    "bizinfo",
    "bizinfo-data-go",
    "kstartup",
  ],
  employment: ["kosis-employment"],
};

function StatusStrip({
  dashboard,
  loading,
  failed,
  locale,
  category,
}: {
  dashboard: PublicDataDashboard;
  loading: boolean;
  failed: boolean;
  locale: PublicInformationLocale;
  category?: PublicInformationCategory;
}) {
  const t = portalCopy[locale];
  const categoryIsEmpty = category
    ? (dashboard.categories.find((group) => group.id === category)?.totalCount ?? 0) === 0
    : false;
  const relevantSources = category
    ? dashboard.sources.filter((source) => categorySourceIds[category].includes(source.id))
    : dashboard.sources;
  const collectionState = relevantSources.some((source) => source.status === "partial")
    ? "partial"
    : relevantSources.some((source) => source.status === "truncated")
      ? "truncated"
      : null;
  const health = collectionHealthCopy[locale];
  const collectionWarning = relevantSources.some((source) => source.collectionStatus === "unavailable")
    ? "unavailable" : relevantSources.some((source) => source.collectionStatus === "delayed") ? "delayed" : null;
  const label = loading
    ? t.loading
    : failed
       ? t.unavailable
       : collectionWarning
         ? health[collectionWarning]
       : dashboard.stale
         ? t.stale
         : categoryIsEmpty
           ? t.empty
         : collectionState
           ? completenessCopy[locale][collectionState]
           : dashboard.cached
             ? t.cached
             : t.empty;
  const state = failed || dashboard.stale || collectionWarning
    ? "warning"
    : categoryIsEmpty
      ? "empty"
      : collectionState
        ? "warning"
        : dashboard.cached
          ? "live"
          : "empty";
  return <>
    <div className={styles.portalStatus} role="status"><span data-state={state}>{label}</span><p><Clock3 size={15} />{t.lastSync} <strong>{formatDateTime(dashboard.lastSuccessfulAt, locale)}</strong></p></div>
    {!loading && !failed && relevantSources.length > 0 && <details className={styles.collectionHealth}>
      <summary>{health.title}</summary><p>{health.help}</p>
      <ul>{relevantSources.map((source) => <li key={source.id}><strong>{source.label}</strong><span>{health[source.collectionStatus ?? "unknown"]}</span><small>{health.last} {formatDateTime(source.lastCollectedAt ?? null, locale)}</small></li>)}</ul>
    </details>}
  </>;
}

function DashboardFailure({ locale, onRetry }: { locale: PublicInformationLocale; onRetry: () => void }) {
  const t = portalCopy[locale];
  return <section role="alert" aria-label={t.unavailable}>
    <EmptyState icon={FileSearch} message={t.unavailable} showCount={false} />
    <div className={styles.revealActions}>
      <button type="button" onClick={onRetry}><RotateCcw size={17} />{t.retry}</button>
    </div>
  </section>;
}

export function InformationHubPage() {
  const locale = usePublicInformationLocale();
  const t = portalCopy[locale];
  const { dashboard, loading, failed, retry } = usePublicDashboard();

  return <>
    <section className={styles.portalHero}>
      <span><Sparkles size={15} />{t.hubEyebrow}</span>
      <h1>{t.hubTitle}</h1>
      <p>{t.hubLead}</p>
    </section>
    <StatusStrip dashboard={dashboard} loading={loading} failed={failed} locale={locale} />
    {failed ? <DashboardFailure locale={locale} onRetry={retry} /> : <section className={styles.hubGrid} aria-label={t.hubTitle}>
      {dashboard.categories.map((group) => {
        const meta = categoryMeta[group.id];
        const Icon = meta.icon;
        return <Link key={group.id} href={meta.href} className={styles.hubCard}>
          <span className={styles.hubIcon}><Icon size={24} /></span>
          <div><small>{t[meta.eyebrow]}</small><h2>{t[meta.title]}</h2><p>{t[meta.lead]}</p></div>
          <dl><div><dt>{t.hubStored}</dt><dd>{loading || failed ? "—" : group.totalCount}</dd></div><div><dt>{t.fresh}</dt><dd>{loading || failed ? "—" : group.newCount}</dd></div></dl>
          <strong>{t.open}<ArrowRight size={16} /></strong>
        </Link>;
      })}
      <Link href="/exchange" className={`${styles.hubCard} ${styles.exchangeHubCard}`}>
        <span className={styles.hubIcon}><Banknote size={24} /></span>
        <div><small>EXCHANGE HISTORY</small><h2>{t.exchange}</h2><p>{t.exchangeLead}</p></div>
        <dl><div><dt>{t.collected}</dt><dd>{loading || failed ? "—" : dashboard.exchange.rates.length}</dd></div><div><dt>{t.rates}</dt><dd>{loading || failed ? "—" : dashboard.exchange.rates.length}</dd></div></dl>
        <strong>{t.open}<ArrowRight size={16} /></strong>
      </Link>
    </section>}
  </>;
}

export function PublicCategoryPage({ category }: { category: PublicInformationCategory }) {
  const locale = usePublicInformationLocale();
  const t = portalCopy[locale];
  const meta = categoryMeta[category];
  const Icon = meta.icon;
  const categoryQueryString = useCategoryQueryString();
  const categoryQuery = useMemo(() => new URLSearchParams(categoryQueryString), [categoryQueryString]);
  const youthPolicyView = youthPolicyViewFromQuery(categoryQuery);
  const requestedFinanceSection = categoryQuery.get("section");
  const financeSection: FinanceSection = financeSections.includes(requestedFinanceSection as FinanceSection)
    ? requestedFinanceSection as FinanceSection : "products";
  const youthPolicySection = youthPolicySectionFromQuery(categoryQuery);
  const parsedRegionSelection = youthPolicyRegionFromQuery(categoryQuery);
  const youthPolicyRegionSelection = category === "startup" && parsedRegionSelection.mode === "region"
    ? { ...parsedRegionSelection, includeNationwide: categoryQuery.get("includeNationwide") === "true" }
    : parsedRegionSelection;
  const freshness = categoryFreshnessFromQuery(categoryQuery);
  const page = categoryPageFromQuery(categoryQuery);
  const categoryPageSize = useCategoryPageSize();
  const supportsTemporalFilter = supportsPublicTemporalFilter(category);
  const requestedFreshness = supportsTemporalFilter ? freshness : "active";
  const { dashboard, loading, failed, retry, catalogChanged } = usePublicDashboard(
    category,
    youthPolicyView,
    requestedFreshness,
    page,
    youthPolicySection,
    youthPolicyRegionSelection,
    categoryPageSize,
    categoryQuery.get("query") ?? "",
    financeSection,
  );
  const group = dashboard.categories.find((candidate) => candidate.id === category);
  const items = useMemo(() => group?.items ?? [], [group?.items]);
  const supplementalItems = useMemo(() => [
    ...(group?.supplementalItems ?? []),
    ...decodeCommercialAnalyticsSupplement(group?.commercialAnalyticsSupplement),
  ], [group?.commercialAnalyticsSupplement, group?.supplementalItems]);
  const filteredTotalCount = group?.filteredTotalCount ?? group?.totalCount ?? 0;
  const displayTotalCount = loading || failed ? null : filteredTotalCount;
  const resolvedPageSize = group?.pageSize ?? categoryPageSize;
  const totalPages = Math.max(1, Math.ceil(filteredTotalCount / resolvedPageSize));
  const currentPage = Math.min(page, totalPages);
  const youthDashboard = useMemo(() => ({ ...dashboard, sources: [] }), [dashboard]);
  const effectiveYouthPolicyView: YouthPolicyViewMode = category === "youth" && (!dashboard.authenticated
    || (!categoryQuery.has("view") && dashboard.youthPolicyPersonalization?.status === "personalization_disabled"))
    ? "all"
    : youthPolicyView;
  const youthPersonalization = category === "youth" && effectiveYouthPolicyView === "personalized"
    ? dashboard.youthPolicyPersonalization
    : null;
  const youthCollectedCount = youthPersonalization
    ? youthPersonalization.recommendedCount + youthPersonalization.hiddenCount
    : group?.totalCount ?? 0;
  const catalogResultsRef = useRef<HTMLDivElement>(null);
  const pendingCatalogFocusRef = useRef(false);

  useEffect(() => {
    if (loading || failed || !group || page <= totalPages) return;
    updateCategoryQuery({ page: totalPages }, "replace");
  }, [failed, group, loading, page, totalPages]);

  useEffect(() => {
    if (!pendingCatalogFocusRef.current || loading) return;
    pendingCatalogFocusRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      const target = catalogResultsRef.current;
      target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentPage, loading]);

  function openCatalogPage(nextPage: number) {
    pendingCatalogFocusRef.current = true;
    updateCategoryQuery({ page: Math.min(totalPages, Math.max(1, nextPage)) });
  }

  return <>
    <section className={styles.categoryHero}>
      <div className={styles.categoryHeroIcon}><Icon size={28} /></div>
      <div><span>{t[meta.eyebrow]}</span><h1>{t[meta.title]}</h1><p>{t[meta.lead]}</p></div>
      {youthPersonalization
        ? <dl>
          <div><dt>{youthHeroCountCopy[locale].collected}</dt><dd>{loading || failed ? "—" : youthCollectedCount}</dd></div>
          <div><dt>{youthHeroCountCopy[locale].matched}</dt><dd>{loading || failed ? "—" : group?.totalCount ?? 0}</dd></div>
          <div><dt>{youthHeroCountCopy[locale].fresh}</dt><dd>{loading || failed ? "—" : group?.newCount ?? 0}</dd></div>
        </dl>
        : <dl><div><dt>{t.collected}</dt><dd>{loading || failed ? "—" : group?.totalCount ?? 0}</dd></div><div><dt>{t.fresh}</dt><dd>{loading || failed ? "—" : group?.newCount ?? 0}</dd></div></dl>}
    </section>
    <StatusStrip dashboard={dashboard} loading={loading} failed={failed} locale={locale} category={category} />
    {catalogChanged && <p className={styles.catalogNotice} role="status">{financeSectionCopy[locale].changed}</p>}
    {category === "finance" && <section className={styles.financeScopes} aria-label={financeSectionCopy[locale].label}>
      <div>{financeSections.map((section) => <button key={section} type="button" aria-pressed={financeSection === section} onClick={() => updateCategoryQuery({ section, page: 1 })}>{financeSectionCopy[locale][section]}</button>)}</div>
      <p>{financeSectionCopy[locale].scope}</p>
      <label><Search size={17} /><span className={styles.srOnly}>{t.search}</span><input type="search" maxLength={200} value={categoryQuery.get("query") ?? ""} placeholder={t.searchPlaceholder} onChange={(event) => updateCategoryQuery({ query: event.target.value, page: 1 }, "replace")} /></label>
    </section>}
    {supportsTemporalFilter
      ? <FreshnessFilterBar
          locale={locale}
          value={freshness}
          onChange={(next) => {
            updateCategoryQuery({ freshness: next, page: 1 });
          }}
          totalCount={displayTotalCount}
        />
      : <CurrentSnapshotBar
          locale={locale}
          totalCount={displayTotalCount}
          scopeLabel={category === "finance" ? financeSectionCopy[locale][financeSection] : undefined}
        />}
    <OfficialSourceReadingGuide locale={locale} />
    <div
      ref={catalogResultsRef}
      tabIndex={-1}
      className={styles.catalogFocusTarget}
      aria-label={`${catalogPaginationCopy[locale].label} · ${catalogPaginationCopy[locale].page(currentPage, totalPages)}`}
    >
      <CatalogPagination
        locale={locale}
        category={category}
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={resolvedPageSize}
        itemCount={items.length}
        totalCount={displayTotalCount}
        loading={loading}
        onPageChange={openCatalogPage}
      />
    </div>
    <div aria-label={catalogPaginationCopy[locale].label}>
    {category === "finance" ? <>
      {/* Keep this boundary stable across catalogue pages and failed requests.
          Activity preserves in-memory form/results state, hides its DOM from
          display and focus, and suspends effects without persisting finances. */}
      <Activity mode={!failed && financeSection === "products" ? "visible" : "hidden"}>
        <FinanceInformation
          items={items}
          showTools={currentPage === 1}
          loading={loading}
          locale={locale}
          analysisEnabled={dashboard.authenticated}
        />
      </Activity>
      {failed ? <DashboardFailure locale={locale} onRetry={retry} />
        : financeSection === "indicators"
          ? <FinanceIndicators items={items} loading={loading} locale={locale} showTools={currentPage === 1} analysisEnabled={dashboard.authenticated} />
          : financeSection === "market" && <FinanceCatalogPage items={items} loading={loading} locale={locale} analysisEnabled={dashboard.authenticated} />}
    </>
      : failed ? <DashboardFailure locale={locale} onRetry={retry} />
        : category === "startup" ? <StartupInformation
            items={items}
            supplementalItems={supplementalItems}
            loading={loading}
            locale={locale}
            catalogTotalCount={filteredTotalCount}
            facets={group?.startupFacets}
            regionSelection={youthPolicyRegionSelection}
            query={categoryQuery.get("query") ?? ""}
            showTools={currentPage === 1}
            personalization={dashboard.startupAnnouncementPersonalization}
            analysisEnabled={dashboard.authenticated}
          />
          : category === "employment" ? <EmploymentInformation items={items} loading={loading} locale={locale} />
          : <>
            {effectiveYouthPolicyView === "personalized" && <YouthPolicyPersonalizationBanner summary={dashboard.youthPolicyPersonalization} locale={locale} loading={loading} />}
            <YouthPolicyFourSections
              dashboard={youthDashboard}
              locale={locale}
              loading={loading}
              viewMode={effectiveYouthPolicyView}
              selectedSection={youthPolicySection}
              onSectionChange={(next) => {
                updateCategoryQuery({ section: next, page: 1 });
              }}
              regionSelection={youthPolicyRegionSelection}
              onRegionSelectionChange={(next) => {
                updateCategoryQuery({ regionSelection: next, page: 1 });
              }}
              onViewModeChange={(next) => {
                updateCategoryQuery({ view: next, page: 1 });
              }}
              renderItems={(sectionItems) => <InformationList
                items={sectionItems}
                locale={locale}
                analysisEnabled={dashboard.authenticated && effectiveYouthPolicyView === "personalized"}
              />}
            />
          </>}
    </div>
    {totalPages > 1 && <CatalogPagination
      locale={locale}
      category={category}
      currentPage={currentPage}
      totalPages={totalPages}
      pageSize={resolvedPageSize}
      itemCount={items.length}
      totalCount={displayTotalCount}
      loading={loading}
      onPageChange={openCatalogPage}
      compact
    />}
  </>;
}

const catalogPaginationCopy = {
  ko: {
    label: "공식 정보 페이지",
    page: (current: number, total: number) => `${current} / ${total} 페이지`,
    range: (start: number, end: number, total: number) => `전체 ${total.toLocaleString("ko-KR")}건 중 ${start.toLocaleString("ko-KR")}–${end.toLocaleString("ko-KR")}건`,
    loading: "페이지 정보를 확인하고 있어요.",
    first: "첫 페이지",
    previous: "이전 페이지",
    next: "다음 페이지",
    last: "마지막 페이지",
    youthScope: (count: number) => `4개 분류와 지역 숫자는 현재 선택 조건의 전체 결과에서 계산합니다. 목록은 한 번에 ${count.toLocaleString("ko-KR")}건까지 보여주며 나머지는 다음 페이지에서 확인할 수 있습니다.`,
    financeTitle: "추가 금융 공식 정보",
    financeLead: "현재 페이지의 금융 공시와 시장 자료입니다. 금융상품 비교와 금융지표는 위의 별도 탭에서 확인할 수 있습니다.",
    startupTitle: "추가 창업·상권 공식 정보",
    startupLead: "현재 페이지에 포함된 공고와 상권 자료입니다. 맞춤 공고 탐색과 상권 분석 도구는 첫 페이지에서 확인할 수 있습니다.",
  },
  en: {
    label: "Official information pages",
    page: (current: number, total: number) => `Page ${current} of ${total}`,
    range: (start: number, end: number, total: number) => `${start.toLocaleString("en-US")}–${end.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`,
    loading: "Checking page information.",
    first: "First page",
    previous: "Previous page",
    next: "Next page",
    last: "Last page",
    youthScope: (count: number) => `The four section and regional counts use the full result for the selected filters. Up to ${count.toLocaleString("en-US")} records appear per page; use the next pages for more.`,
    financeTitle: "More official financial information",
    financeLead: "Financial disclosures and market materials on this page. Use the separate tabs above for product comparisons and financial indicators.",
    startupTitle: "More official startup and district information",
    startupLead: "Announcements and district materials on this page. Return to page 1 for personalized notices and the commercial-area tools.",
  },
  ja: {
    label: "公式情報のページ",
    page: (current: number, total: number) => `${current} / ${total}ページ`,
    range: (start: number, end: number, total: number) => `全${total.toLocaleString("ja-JP")}件中${start.toLocaleString("ja-JP")}–${end.toLocaleString("ja-JP")}件`,
    loading: "ページ情報を確認しています。",
    first: "最初のページ",
    previous: "前のページ",
    next: "次のページ",
    last: "最後のページ",
    youthScope: (count: number) => `4分類と地域の件数は、選択条件に一致する全結果から計算しています。リストは1ページ最大${count.toLocaleString("ja-JP")}件で、続きは次ページから確認できます。`,
    financeTitle: "その他の公式金融情報",
    financeLead: "このページの金融公示と市場資料です。商品比較と金融指標は上の専用タブで確認できます。",
    startupTitle: "その他の創業・商圏公式情報",
    startupLead: "このページに含まれる公募・商圏資料です。個別公募の探索と商圏分析ツールは1ページ目で確認できます。",
  },
  zh: {
    label: "官方信息分页",
    page: (current: number, total: number) => `第${current}页，共${total}页`,
    range: (start: number, end: number, total: number) => `共${total.toLocaleString("zh-CN")}条，显示第${start.toLocaleString("zh-CN")}–${end.toLocaleString("zh-CN")}条`,
    loading: "正在检查分页信息。",
    first: "第一页",
    previous: "上一页",
    next: "下一页",
    last: "最后一页",
    youthScope: (count: number) => `四个分类和地区数量按当前筛选条件的完整结果计算。每页最多显示${count.toLocaleString("zh-CN")}条，其余请查看后续页面。`,
    financeTitle: "更多官方金融信息",
    financeLead: "本页为金融披露和市场资料。产品比较和金融指标请查看上方的独立标签页。",
    startupTitle: "更多官方创业与商圈信息",
    startupLead: "本页包含其他扶持公告和商圈资料；个性化公告与商圈分析工具请返回第一页查看。",
  },
} satisfies Record<PublicInformationLocale, {
  label: string;
  page: (current: number, total: number) => string;
  range: (start: number, end: number, total: number) => string;
  loading: string;
  first: string;
  previous: string;
  next: string;
  last: string;
  youthScope: (count: number) => string;
  financeTitle: string;
  financeLead: string;
  startupTitle: string;
  startupLead: string;
}>;

function CatalogPagination({
  locale,
  category,
  currentPage,
  totalPages,
  pageSize,
  itemCount,
  totalCount,
  loading,
  onPageChange,
  compact = false,
}: {
  locale: PublicInformationLocale;
  category: PublicInformationCategory;
  currentPage: number;
  totalPages: number;
  pageSize: number;
  itemCount: number;
  totalCount: number | null;
  loading: boolean;
  onPageChange: (page: number) => void;
  compact?: boolean;
}) {
  const copy = catalogPaginationCopy[locale];
  const start = totalCount !== null && totalCount > 0 ? ((currentPage - 1) * pageSize) + 1 : 0;
  const end = totalCount !== null && totalCount > 0 ? Math.min(totalCount, start + Math.max(0, itemCount - 1)) : 0;
  return <nav className={`${styles.catalogPagination} ${compact ? styles.compactPagination : ""}`} aria-label={copy.label} aria-busy={loading}>
    <div className={styles.catalogPageSummary} id={compact ? undefined : "catalog-page-status"} aria-live="polite">
      <strong>{copy.page(currentPage, totalPages)}</strong>
      <span>{totalCount === null ? copy.loading : copy.range(start, end, totalCount)}</span>
      {!compact && category === "youth" && totalCount !== null && <small>{copy.youthScope(pageSize)}</small>}
    </div>
    {totalPages > 1 && <div className={styles.catalogPageControls}>
      <button type="button" aria-label={copy.first} title={copy.first} disabled={loading || currentPage <= 1} onClick={() => onPageChange(1)}>«</button>
      <button type="button" aria-label={copy.previous} title={copy.previous} disabled={loading || currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>‹</button>
      <span aria-hidden="true">{currentPage} / {totalPages}</span>
      <button type="button" aria-label={copy.next} title={copy.next} disabled={loading || currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>›</button>
      <button type="button" aria-label={copy.last} title={copy.last} disabled={loading || currentPage >= totalPages} onClick={() => onPageChange(totalPages)}>»</button>
    </div>}
  </nav>;
}

function FinanceCatalogPage({
  items,
  loading,
  locale,
  analysisEnabled,
}: {
  items: PublicInformationItem[];
  loading: boolean;
  locale: PublicInformationLocale;
  analysisEnabled: boolean;
}) {
  const copy = catalogPaginationCopy[locale];
  const t = portalCopy[locale];
  return <section className={styles.informationPanel} aria-labelledby="finance-catalog-page-title">
    <div className={styles.listHeader}><div><h2 id="finance-catalog-page-title">{copy.financeTitle}</h2><p>{copy.financeLead}</p></div></div>
    {loading
      ? <LoadingState locale={locale} />
      : items.length
        ? <InformationList items={items} locale={locale} analysisEnabled={analysisEnabled} />
        : <EmptyState icon={FileSearch} message={t.noData} />}
  </section>;
}

const freshnessCopy = {
  ko: {
    active: "마감되지 않은 정보", activeHelp: "모집 예정·마감일 미확인 자료도 포함합니다.", recentHelp: "공식 공고일 또는 공식 수정일이 이 기간 안인 항목만 포함합니다. 수집·재확인 시각은 사용하지 않습니다.", "recent-7d": "최근 7일", "recent-30d": "최근 30일",
    expired: "접수·운영 종료", "review-needed": "재확인 필요", all: "종료·재확인 포함 전체", count: "선택 결과",
  },
  en: {
    active: "Not marked closed", activeHelp: "Includes upcoming records and unknown deadlines.", recentHelp: "Uses only an official publication or source-update date, never the collection or verification time.", "recent-7d": "Last 7 days", "recent-30d": "Last 30 days",
    expired: "Applications / operation closed", "review-needed": "Needs verification", all: "All incl. closed / unverified", count: "Results",
  },
  ja: {
    active: "締切済み以外", activeHelp: "募集予定・締切未確認の情報も含みます。", recentHelp: "公式の公表日または更新日のみを使い、収集・再確認時刻は使いません。", "recent-7d": "直近7日", "recent-30d": "直近30日",
    expired: "受付・運営終了", "review-needed": "再確認が必要", all: "終了・再確認を含む全件", count: "選択結果",
  },
  zh: {
    active: "未标记截止的信息", activeHelp: "包含即将开始及截止日期未知的信息。", recentHelp: "仅使用官方发布日期或来源更新时间，不使用采集或复核时间。", "recent-7d": "最近7天", "recent-30d": "最近30天",
    expired: "申请或运营结束", "review-needed": "需要复核", all: "全部（含结束及待复核）", count: "筛选结果",
  },
} as const;

const currentSnapshotCopy = {
  ko: {
    title: "현재 기준 정보",
    lead: "금융·고용 지표는 게시일 범위가 아니라 현재 이용 가능한 최신 관측값을 보여줍니다.",
    count: "현재 항목",
  },
  en: {
    title: "Current snapshot",
    lead: "Financial and employment indicators show the latest available observation, not a publication-window filter.",
    count: "Current items",
  },
  ja: {
    title: "現在の基準情報",
    lead: "金融・雇用指標は掲載期間ではなく、現在利用できる最新の観測値を表示します。",
    count: "現在の項目",
  },
  zh: {
    title: "当前基准信息",
    lead: "金融和就业指标显示当前可用的最新观测值，而不是按发布日期筛选。",
    count: "当前项目",
  },
} as const;

function CurrentSnapshotBar({
  locale,
  totalCount,
  scopeLabel,
}: {
  locale: PublicInformationLocale;
  totalCount: number | null;
  scopeLabel?: string;
}) {
  const copy = currentSnapshotCopy[locale];
  return <section className={`${styles.freshnessFilters} ${styles.currentSnapshotBar}`} aria-label={copy.title}>
    <div><span><Clock3 size={16} /></span><p><strong>{scopeLabel ?? copy.title}</strong>{scopeLabel ? financeSectionCopy[locale].scope : copy.lead}</p></div>
    <strong>{copy.count} <b>{totalCount === null ? "—" : totalCount.toLocaleString(localeTags[locale])}</b></strong>
  </section>;
}

function FreshnessFilterBar({
  locale,
  value,
  onChange,
  totalCount,
}: {
  locale: PublicInformationLocale;
  value: PublicDataFreshnessFilter;
  onChange: (value: PublicDataFreshnessFilter) => void;
  totalCount: number | null;
}) {
  const copy = freshnessCopy[locale];
  const filters: PublicDataFreshnessFilter[] = [
    "active", "recent-7d", "recent-30d", "expired", "review-needed", "all",
  ];
  return <section className={styles.freshnessFilters} aria-label={copy.count}>
    <div>
      {filters.map((filter) => <button
        type="button"
        key={filter}
        aria-pressed={value === filter}
        title={filter === "active" ? copy.activeHelp : filter.startsWith("recent-") ? copy.recentHelp : undefined}
        onClick={() => onChange(filter)}
      >{copy[filter]}</button>)}
    </div>
    <strong>{copy.count} <b>{totalCount === null ? "—" : totalCount.toLocaleString(localeTags[locale])}</b></strong>
  </section>;
}

function OfficialSourceReadingGuide({ locale }: { locale: PublicInformationLocale }) {
  const t = sourcePreviewCopy[locale];
  const icons = [Info, ListChecks, BookOpenCheck] as const;

  return <details className={styles.sourceReadingGuide}>
    <summary>
      <span><BookOpenCheck size={21} /></span>
      <div>
        <h2 id="source-reading-guide-title">{t.guideTitle}</h2>
        <p>{t.guideLead}</p>
      </div>
      <ChevronDown size={18} aria-hidden="true" />
    </summary>
    <ol>
      {t.guideSteps.map(([title, body], index) => {
        const StepIcon = icons[index] ?? Info;
        return <li key={title}>
          <span aria-hidden="true"><StepIcon size={17} /></span>
          <div><strong>{title}</strong><p>{body}</p></div>
        </li>;
      })}
    </ol>
  </details>;
}

const employmentCopy = {
  ko: {
    title: "청년·고령층·외국인 취업 현황",
    lead: "KOSIS 공식 통계표에서 확인된 최신 유효 기준시점의 고용 현황입니다.",
    period: "기준",
    table: "통계표",
    source: "KOSIS 원문",
    empty: "현재 수집된 대상별 취업 통계가 0건입니다.",
    caution: "청년·고령층 부가조사와 외국인 연간 조사는 기준시점과 모집단이 다릅니다. 대상 간 수치를 같은 기준처럼 직접 비교하지 마세요.",
  },
  en: {
    title: "Employment for youth, older adults and foreign residents",
    lead: "Employment figures from the latest valid reference period confirmed in official KOSIS tables.",
    period: "Period",
    table: "Table",
    source: "KOSIS source",
    empty: "There are 0 collected employment-statistics records.",
    caution: "The youth and older-adult supplementary surveys and the annual foreign-resident survey use different populations and reference periods. Do not compare them as if they shared one basis.",
  },
  ja: {
    title: "若者・高齢層・外国人の就業状況",
    lead: "KOSIS公式統計表で確認された最新の有効な基準時点の就業状況です。",
    period: "基準",
    table: "統計表",
    source: "KOSIS原文",
    empty: "収集済みの対象別就業統計は0件です。",
    caution: "若者・高齢層の付加調査と外国人の年次調査は、基準時点と母集団が異なります。同一基準として直接比較しないでください。",
  },
  zh: {
    title: "青年、高龄群体与外国居民就业情况",
    lead: "这是KOSIS官方统计表中已确认的最新有效基准时期就业情况。",
    period: "基准",
    table: "统计表",
    source: "KOSIS原文",
    empty: "当前采集的分群就业统计为0条。",
    caution: "青年及高龄群体附加调查与外国居民年度调查的基准时期和总体不同，请勿按同一口径直接比较。",
  },
} satisfies Record<PublicInformationLocale, Record<string, string>>;

const EMPLOYMENT_GROUP_ORDER = ["youth", "older-adult", "foreigner"] as const;
type EmploymentGroup = (typeof EMPLOYMENT_GROUP_ORDER)[number];

const employmentGroupLabels: Record<EmploymentGroup, Record<PublicInformationLocale, string>> = {
  youth: { ko: "청년층(15~29세)", en: "Youth (ages 15–29)", ja: "若者（15～29歳）", zh: "青年（15至29岁）" },
  "older-adult": { ko: "고령층(55~79세)", en: "Older adults (ages 55–79)", ja: "高齢層（55～79歳）", zh: "高龄群体（55至79岁）" },
  foreigner: { ko: "외국인(15세 이상)", en: "Foreign residents (age 15+)", ja: "外国人（15歳以上）", zh: "外国居民（15岁以上）" },
};

const employmentMetricLabels: Record<string, Record<PublicInformationLocale, string>> = {
  취업자: { ko: "취업자", en: "Employed persons", ja: "就業者", zh: "就业人数" },
  고용률: { ko: "고용률", en: "Employment rate", ja: "就業率", zh: "就业率" },
  실업률: { ko: "실업률", en: "Unemployment rate", ja: "失業率", zh: "失业率" },
};

function employmentUnitLabel(unit: string, locale: PublicInformationLocale) {
  return unit === "천명"
    ? { ko: "천명", en: "thousand people", ja: "千人", zh: "千人" }[locale]
    : unit;
}

function EmploymentInformation({
  items,
  loading,
  locale,
}: {
  items: PublicInformationItem[];
  loading: boolean;
  locale: PublicInformationLocale;
}) {
  const t = employmentCopy[locale];
  const statistics = useMemo(() => items
    .filter((item) => Boolean(item.employmentStatistic))
    .map(normalizeEmploymentStatisticItem)
    .sort((left, right) => (
      EMPLOYMENT_GROUP_ORDER.indexOf(left.employmentStatistic!.group)
      - EMPLOYMENT_GROUP_ORDER.indexOf(right.employmentStatistic!.group)
    )), [items]);

  return <section className={styles.employmentOverview} aria-labelledby="employment-statistics-title">
    <div className={styles.employmentHeading}>
      <span><BarChart3 size={20} /></span>
      <div>
        <h2 id="employment-statistics-title">{t.title}</h2>
        <p>{t.lead}</p>
      </div>
    </div>
    <p className={styles.employmentCaution}>{t.caution}</p>
    {!loading && statistics.length > 0 && <EmploymentStatisticsChart items={statistics} locale={locale} />}
    {!loading && statistics.length === 0
      ? <div className={styles.employmentEmpty}><FileSearch size={23} /><strong>{t.empty}</strong></div>
      : <div className={styles.employmentGrid}>
        {statistics.map((item) => {
          const statistic = item.employmentStatistic!;
          const sourceUrl = safePublicHttpUrl(item.sourceUrl);
          const groupLabel = employmentGroupLabels[statistic.group as EmploymentGroup]?.[locale]
            ?? statistic.groupLabel;
          return <article className={styles.employmentCard} key={item.id}>
            <header>
              <div><small>{statistic.group.toUpperCase()}</small><h3>{groupLabel}</h3></div>
              <span>{t.period} {statistic.period}</span>
            </header>
            <dl>
              {statistic.metrics.map((metric) => <div key={`${item.id}-${metric.name}`}>
                <dt>{employmentMetricLabels[metric.name]?.[locale] ?? metric.name}</dt>
                <dd>{metric.value.toLocaleString(localeTags[locale], { maximumFractionDigits: 2 })} <small>{employmentUnitLabel(metric.unit, locale)}</small></dd>
              </div>)}
            </dl>
            <footer>
              <code>{t.table} {statistic.tableId}</code>
              {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer noopener">{t.source}<ExternalLink size={13} /></a>}
            </footer>
          </article>;
        })}
      </div>}
  </section>;
}

function metricItem(items: PublicInformationItem[], matcher: RegExp) {
  return items.find((item) => item.id.startsWith("ecos-") && matcher.test(`${item.title} ${item.summary}`)) ?? null;
}

function metricValue(item: PublicInformationItem | null, fallback: string) {
  if (!item) return fallback;
  const firstPart = item.summary.split(" · ")[0]?.trim();
  return firstPart || fallback;
}

function safeHttpUrl(value: unknown) {
  return safePublicHttpUrl(value);
}

const recommendationUiCopy: Record<PublicInformationLocale, {
  applied: string;
  compared: (count: number) => string;
  amount: string;
  desiredTerm: string;
  disclosedTerm: string;
  disclosedRate: string;
  dataAsOf: string;
  unknownDate: string;
  scoreUnit: string;
  unavailable: string;
  estimateTitle: string;
  principal: string;
  grossInterest: string;
  netInterest: string;
  maturityAmount: string;
  estimateBasis: (basis: ProductRecommendationEstimate["rateBasis"], rate: number) => string;
  showing: (start: number, end: number, total: number) => string;
  paginationLabel: string;
  previousPage: string;
  nextPage: string;
  page: (current: number, total: number) => string;
  failure: Record<"catalog" | "request" | "network" | "timeout", string>;
}> = {
  ko: {
    applied: "이번 비교에 적용한 조건",
    compared: (count) => `금융감독원 공시 상품 ${count.toLocaleString("ko-KR")}개 비교`,
    amount: "적용 금액",
    desiredTerm: "희망 기간",
    disclosedTerm: "공시 기간",
    disclosedRate: "상품 공시금리",
    dataAsOf: "상품 데이터 기준",
    unknownDate: "기준일 미제공",
    scoreUnit: "점",
    unavailable: "미제공",
    estimateTitle: "입력 금액 기준 예상 수령액",
    principal: "원금·총 납입액",
    grossInterest: "세전 예상 이자",
    netInterest: "세후 예상 이자",
    maturityAmount: "세후 예상 만기액",
    estimateBasis: (basis, rate) => `공시 ${basis === "base" ? "기본" : "최고"}금리 연 ${rate}% · 일반과세 15.4% 단리 가정`,
    showing: (start, end, total) => `조건에 맞는 추천 ${total}개 중 ${start}–${end}개 표시`,
    paginationLabel: "금융상품 추천 페이지",
    previousPage: "이전",
    nextPage: "다음",
    page: (current, total) => `${current} / ${total} 페이지`,
    failure: {
      catalog: "공식 금융상품 카탈로그를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      request: "입력 조건을 확인한 뒤 다시 비교해 주세요.",
      network: "네트워크 연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.",
      timeout: "상품 비교 응답 시간이 초과되었습니다. 입력값은 유지되므로 다시 시도해 주세요.",
    },
  },
  en: {
    applied: "Conditions applied to this comparison",
    compared: (count) => `${count.toLocaleString("en-US")} FSS-disclosed products compared`,
    amount: "Amount applied",
    desiredTerm: "Target term",
    disclosedTerm: "Disclosed term",
    disclosedRate: "Product rate",
    dataAsOf: "Product data as of",
    unknownDate: "Date not disclosed",
    scoreUnit: "pts",
    unavailable: "Not disclosed",
    estimateTitle: "Estimated return for your amount",
    principal: "Principal / contributions",
    grossInterest: "Estimated pre-tax interest",
    netInterest: "Estimated after-tax interest",
    maturityAmount: "Estimated after-tax maturity",
    estimateBasis: (basis, rate) => `Disclosed ${basis} rate ${rate}% p.a. · simple interest with 15.4% general tax assumed`,
    showing: (start, end, total) => `Showing ${start}–${end} of ${total} matches`,
    paginationLabel: "Financial product recommendation pages",
    previousPage: "Previous",
    nextPage: "Next",
    page: (current, total) => `Page ${current} of ${total}`,
    failure: {
      catalog: "The official product catalogue is temporarily unavailable. Please try again shortly.",
      request: "Review the entered conditions and try the comparison again.",
      network: "The network connection is unavailable. Please try again shortly.",
      timeout: "The product comparison timed out. Your inputs were kept, so you can try again.",
    },
  },
  ja: {
    applied: "今回の比較に適用した条件",
    compared: (count) => `金融監督院の公示商品${count.toLocaleString("ja-JP")}件を比較`,
    amount: "適用金額",
    desiredTerm: "希望期間",
    disclosedTerm: "公示期間",
    disclosedRate: "商品公示金利",
    dataAsOf: "商品データ基準日",
    unknownDate: "基準日未提供",
    scoreUnit: "点",
    unavailable: "未提供",
    estimateTitle: "入力金額に基づく受取額の概算",
    principal: "元金・積立総額",
    grossInterest: "税引前の概算利息",
    netInterest: "税引後の概算利息",
    maturityAmount: "税引後の概算満期額",
    estimateBasis: (basis, rate) => `公示${basis === "base" ? "基本" : "最高"}年利${rate}%・一般課税15.4%の単利を仮定`,
    showing: (start, end, total) => `条件に合う${total}件のうち${start}～${end}件を表示`,
    paginationLabel: "金融商品おすすめページ",
    previousPage: "前へ",
    nextPage: "次へ",
    page: (current, total) => `${current} / ${total}ページ`,
    failure: {
      catalog: "公式商品カタログを読み込めませんでした。しばらくしてから再度お試しください。",
      request: "入力条件を確認して、もう一度比較してください。",
      network: "ネットワーク接続を確認して、しばらくしてから再度お試しください。",
      timeout: "商品比較の応答時間を超過しました。入力内容は保持されているため、再試行できます。",
    },
  },
  zh: {
    applied: "本次比较采用的条件",
    compared: (count) => `已比较${count.toLocaleString("zh-CN")}项金融监督院披露产品`,
    amount: "采用金额",
    desiredTerm: "期望期限",
    disclosedTerm: "披露期限",
    disclosedRate: "产品披露利率",
    dataAsOf: "产品数据基准日",
    unknownDate: "未提供基准日",
    scoreUnit: "分",
    unavailable: "未披露",
    estimateTitle: "按输入金额估算的到期收益",
    principal: "本金／累计缴存额",
    grossInterest: "预计税前利息",
    netInterest: "预计税后利息",
    maturityAmount: "预计税后到期金额",
    estimateBasis: (basis, rate) => `按披露${basis === "base" ? "基础" : "最高"}年利率${rate}%、单利及一般利息税15.4%估算`,
    showing: (start, end, total) => `显示${total}项匹配结果中的第${start}–${end}项`,
    paginationLabel: "金融产品推荐分页",
    previousPage: "上一页",
    nextPage: "下一页",
    page: (current, total) => `第${current}页，共${total}页`,
    failure: {
      catalog: "暂时无法加载官方产品目录，请稍后重试。",
      request: "请检查输入条件后重新比较。",
      network: "网络连接异常，请稍后重试。",
      timeout: "金融产品比较请求超时。输入内容已保留，可直接重试。",
    },
  },
};

function recommendationFailureMessage(
  locale: PublicInformationLocale,
  code: string | null,
) {
  const copy = recommendationUiCopy[locale].failure;
  if (code === "product_catalog_unavailable") return copy.catalog;
  if (code === "request_timeout") return copy.timeout;
  if (code && code !== "network_error") return copy.request;
  return copy.network;
}

function recommendationInput(payload: unknown): ProductRecommendationInput | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  const finite = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
  const productKind = value.productKind;
  const liquidityNeed = value.liquidityNeed;
  const preferredChannel = value.preferredChannel;
  const targetTermMonths = finite(value.targetTermMonths);
  const availableLumpSum = finite(value.availableLumpSum);
  const monthlyContribution = finite(value.monthlyContribution);
  if (
    productKind !== "deposit"
    && productKind !== "saving"
    && productKind !== "either"
  ) return null;
  if (
    liquidityNeed !== "low"
    && liquidityNeed !== "medium"
    && liquidityNeed !== "high"
  ) return null;
  if (
    preferredChannel !== "any"
    && preferredChannel !== "online"
    && preferredChannel !== "branch"
  ) return null;
  if (
    targetTermMonths === null
    || availableLumpSum === null
    || monthlyContribution === null
  ) return null;
  return {
    productKind,
    targetTermMonths,
    availableLumpSum,
    monthlyContribution,
    liquidityNeed,
    preferredChannel,
  };
}

function normalizeRecommendationResult(payload: unknown): ProductRecommendationResult | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (!Array.isArray(value.recommendations)) return null;
  const textList = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())).slice(0, 6).map((entry) => entry.trim().slice(0, 320))
    : [];
  const recommendations = value.recommendations.flatMap((candidate): ProductRecommendation[] => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const item = candidate as Record<string, unknown>;
    const sourceUrl = safeHttpUrl(item.sourceUrl);
    if (typeof item.itemId !== "string" || typeof item.title !== "string" || typeof item.provider !== "string" || !sourceUrl || (item.kind !== "deposit" && item.kind !== "saving")) return [];
    const nullableNumber = (entry: unknown) => typeof entry === "number" && Number.isFinite(entry) ? entry : null;
    const estimateValue = item.estimate && typeof item.estimate === "object" && !Array.isArray(item.estimate)
      ? item.estimate as Record<string, unknown>
      : null;
    const estimateNumbers = estimateValue
      ? {
          principal: nullableNumber(estimateValue.principal),
          grossInterest: nullableNumber(estimateValue.grossInterest),
          netInterest: nullableNumber(estimateValue.netInterest),
          maturityAmount: nullableNumber(estimateValue.maturityAmount),
          annualRate: nullableNumber(estimateValue.annualRate),
          assumedTaxRate: nullableNumber(estimateValue.assumedTaxRate),
        }
      : null;
    const estimateRateBasis = estimateValue?.rateBasis === "base"
      ? "base" as const
      : estimateValue?.rateBasis === "maximum"
        ? "maximum" as const
        : null;
    const estimate = estimateValue
      && estimateNumbers
      && Object.values(estimateNumbers).every((entry) => entry !== null && entry >= 0)
      && estimateRateBasis
      ? {
          principal: estimateNumbers.principal!,
          grossInterest: estimateNumbers.grossInterest!,
          netInterest: estimateNumbers.netInterest!,
          maturityAmount: estimateNumbers.maturityAmount!,
          annualRate: estimateNumbers.annualRate!,
          rateBasis: estimateRateBasis,
          assumedTaxRate: estimateNumbers.assumedTaxRate!,
        }
      : null;
    return [{
      itemId: item.itemId.slice(0, 220),
      title: item.title.trim().slice(0, 500),
      provider: item.provider.trim().slice(0, 220),
      kind: item.kind,
      score: Math.min(100, Math.max(0, nullableNumber(item.score) ?? 0)),
      termMonths: nullableNumber(item.termMonths),
      baseRate: nullableNumber(item.baseRate),
      maximumRate: nullableNumber(item.maximumRate),
      estimate,
      reasons: textList(item.reasons),
      checks: textList(item.checks),
      sourceUrl,
      asOf: typeof item.asOf === "string" ? item.asOf : null,
    }];
  });
  return {
    recommendations,
    input: recommendationInput(value.input),
    productCount: typeof value.productCount === "number" && Number.isFinite(value.productCount)
      ? Math.max(0, Math.round(value.productCount))
      : recommendations.length,
    authenticated: value.authenticated === true,
    asOf: typeof value.asOf === "string" ? value.asOf : null,
    disclaimer: typeof value.disclaimer === "string" ? value.disclaimer.trim().slice(0, 1_000) : "",
  };
}

function normalizedMoneyInput(value: string) {
  return value.replace(/[^0-9]/gu, "").replace(/^0+(?=\d)/u, "").slice(0, 11);
}

function formattedMoneyInput(value: string, locale: PublicInformationLocale) {
  const number = Number(value);
  return value && Number.isFinite(number)
    ? new Intl.NumberFormat(localeTags[locale], { maximumFractionDigits: 0 }).format(number)
    : "";
}

function FinanceIndicators({ items, loading, locale, showTools, analysisEnabled }: { items: PublicInformationItem[]; loading: boolean; locale: PublicInformationLocale; showTools: boolean; analysisEnabled: boolean }) {
  const t = portalCopy[locale];
  const baseRate = metricItem(items, /기준금리|base rate/iu);
  const loanRate = metricItem(items, /대출금리|loan rate|lending rate/iu);
  const cpi = metricItem(items, /소비자물가|consumer price|\bcpi\b/iu);
  const metrics = [
    { key: "base" as const, item: baseRate, icon: Landmark },
    { key: "loan" as const, item: loanRate, icon: Percent },
  ];
  return <>
    {showTools && <>
    <section className={styles.financeSnapshot} aria-labelledby="finance-snapshot-title">
      <div className={styles.sectionHeading}><div><span>FINANCE NOW</span><h2 id="finance-snapshot-title">{t.snapshotTitle}</h2><p>{t.snapshotLead}</p></div><Link href="/exchange">{t.financeExchange}<ArrowRight size={15} /></Link></div>
      <div className={styles.metricGrid}>{metrics.map(({ key, item, icon: MetricIcon }) => <details key={key} className={styles.metricCard} aria-busy={loading}>
        <summary><span><MetricIcon size={21} /></span><div><small>{t.metrics[key].label}</small><strong>{loading ? <span className={styles.metricSkeleton}><span className={styles.srOnly}>{t.loading}</span></span> : metricValue(item, "—")}</strong><em>{loading ? t.loading : item ? formatDate(item.publishedAt, locale) : t.noMetric}</em></div><ChevronDown size={18} /></summary>
        <div><p>{t.metrics[key].explanation}</p>{item && safePublicHttpUrl(item.sourceUrl) && <a href={safePublicHttpUrl(item.sourceUrl)!} target="_blank" rel="noopener noreferrer">{t.metricSource}<ExternalLink size={13} /></a>}</div>
      </details>)}{loading
        ? <div className={styles.metricPlaceholder} role="status" aria-label={t.loading}><span><ShoppingBasket size={21} /></span><div><small>{t.metrics.cpi.label}</small><strong><span className={styles.metricSkeleton}><span className={styles.srOnly}>{t.loading}</span></span></strong><em>{t.loading}</em></div></div>
        : <ConsumerPriceCard item={cpi} locale={locale} />}</div>
    </section>

    <FinanceExchangeCard locale={locale} />

    <InclusiveFinanceCheckup locale={locale} />

    </>}
    <section className={styles.informationPanel} aria-labelledby="finance-indicator-list-title">
      <div className={styles.listHeader}><h2 id="finance-indicator-list-title">{financeSectionCopy[locale].indicators}</h2></div>
      {loading ? <LoadingState locale={locale} /> : items.length
        ? <InformationList items={items} locale={locale} analysisEnabled={analysisEnabled} />
        : <EmptyState icon={Landmark} message={t.noData} />}
    </section>
  </>;
}

function FinanceInformation({
  items,
  showTools,
  loading,
  locale,
  analysisEnabled,
}: {
  items: PublicInformationItem[];
  showTools: boolean;
  loading: boolean;
  locale: PublicInformationLocale;
  analysisEnabled: boolean;
}) {
  const t = portalCopy[locale];
  const [kind, setKind] = useState<FinanceProductKind>("deposit");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("");
  const [liquidityNeed, setLiquidityNeed] = useState<LiquidityNeed>("medium");
  const [preferredChannel, setPreferredChannel] = useState<JoinChannel>("any");
  const [recommendationState, setRecommendationState] = useState<"idle" | "loading" | "failed" | "ready">("idle");
  const [recommendationResult, setRecommendationResult] = useState<ProductRecommendationResult | null>(null);
  const [recommendationFailure, setRecommendationFailure] = useState<string | null>(null);
  const recommendationRequestRef = useRef(0);
  const recommendationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    recommendationRequestRef.current += 1;
    recommendationAbortRef.current?.abort();
    recommendationAbortRef.current = null;
  }, []);

  function resetComparison() {
    recommendationRequestRef.current += 1;
    recommendationAbortRef.current?.abort();
    recommendationAbortRef.current = null;
    setRecommendationState("idle");
    setRecommendationResult(null);
    setRecommendationFailure(null);
  }

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requestId = recommendationRequestRef.current + 1;
    recommendationRequestRef.current = requestId;
    recommendationAbortRef.current?.abort();
    const controller = new AbortController();
    recommendationAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, PRODUCT_RECOMMENDATION_REQUEST_TIMEOUT_MS);
    setRecommendationState("loading");
    setRecommendationResult(null);
    setRecommendationFailure(null);
    const comparisonAmount = Math.max(0, Math.round(Number(amount) || 0));
    try {
      const response = await fetch("/api/public-data/product-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          productKind: kind,
          targetTermMonths: Math.max(1, Math.round(Number(period) || 1)),
          availableLumpSum: kind === "deposit" ? comparisonAmount : 0,
          monthlyContribution: kind === "saving" ? comparisonAmount : 0,
          liquidityNeed,
          preferredChannel,
          locale,
        }),
        signal: controller.signal,
      });
      if ((controller.signal.aborted && !timedOut) || requestId !== recommendationRequestRef.current) return;
      if (timedOut) throw new Error("request_timeout");
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if ((controller.signal.aborted && !timedOut) || requestId !== recommendationRequestRef.current) return;
      if (timedOut) throw new Error("request_timeout");
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "request_failed");
      }
      const normalized = normalizeRecommendationResult(payload);
      if (!normalized) throw new Error("product_recommendation_invalid");
      if ((controller.signal.aborted && !timedOut) || requestId !== recommendationRequestRef.current) return;
      if (timedOut) throw new Error("request_timeout");
      setRecommendationResult(normalized);
      setRecommendationState("ready");
    } catch (error) {
      if ((controller.signal.aborted && !timedOut) || requestId !== recommendationRequestRef.current) return;
      setRecommendationFailure(timedOut ? "request_timeout" : error instanceof Error ? error.message : "network_error");
      setRecommendationState("failed");
    } finally {
      window.clearTimeout(timeoutId);
      if (requestId === recommendationRequestRef.current) recommendationAbortRef.current = null;
    }
  }

  return <>
    <Activity mode={showTools ? "visible" : "hidden"}>
    <section className={styles.recommendationPanel} aria-labelledby="product-comparison-title">
      <div className={styles.sectionHeading}><span className={styles.hubIcon}><SlidersHorizontal size={21} /></span><div><h2 id="product-comparison-title">{t.compareTitle}</h2><p>{t.compareLead}</p></div></div>
      <form className={styles.recommendationForm} onSubmit={compare} aria-busy={recommendationState === "loading"}>
        <label><span>{t.productType}</span><select value={kind} onChange={(event) => { setKind(event.target.value as FinanceProductKind); resetComparison(); }}>{(Object.keys(t.productKinds) as FinanceProductKind[]).map((value) => <option key={value} value={value}>{t.productKinds[value]}</option>)}</select></label>
        <label><span>{t.amountLabels[kind]}</span><div><input type="text" inputMode="numeric" pattern="[0-9,]*" required value={formattedMoneyInput(amount, locale)} onChange={(event) => { setAmount(normalizedMoneyInput(event.target.value)); resetComparison(); }} aria-describedby="comparison-method-note" autoComplete="off" /><small>{t.won}</small></div></label>
        <label><span>{t.period}</span><div><input type="number" min="1" max="120" inputMode="numeric" required value={period} onChange={(event) => { setPeriod(event.target.value); resetComparison(); }} /><small>{t.months}</small></div></label>
        <label><span>{t.liquidity}</span><select value={liquidityNeed} onChange={(event) => { setLiquidityNeed(event.target.value as LiquidityNeed); resetComparison(); }}>{(Object.keys(t.liquidityOptions) as LiquidityNeed[]).map((value) => <option key={value} value={value}>{t.liquidityOptions[value]}</option>)}</select></label>
        <label><span>{t.channel}</span><select value={preferredChannel} onChange={(event) => { setPreferredChannel(event.target.value as JoinChannel); resetComparison(); }}>{(Object.keys(t.channelOptions) as JoinChannel[]).map((value) => <option key={value} value={value}>{t.channelOptions[value]}</option>)}</select></label>
        <button type="submit" disabled={recommendationState === "loading"}>{recommendationState === "loading" ? t.recommendationLoading : recommendationState === "failed" ? t.retry : t.compare}<ArrowRight size={15} /></button>
      </form>
      <p id="comparison-method-note" className={styles.methodNote}>{t.compareRule}</p>
      {recommendationState !== "idle" && <div className={styles.recommendationResults} aria-live="polite"><h3>{t.compareResult} · {t.productKinds[kind]}</h3>{recommendationState === "loading" ? <LoadingState locale={locale} message={t.recommendationLoading} /> : recommendationState === "failed" ? <EmptyState icon={WalletCards} message={recommendationFailureMessage(locale, recommendationFailure)} showCount={false} /> : recommendationResult?.recommendations.length ? <RecommendationList key={`${recommendationResult.asOf}:${recommendationResult.input?.productKind}:${recommendationResult.input?.targetTermMonths}:${recommendationResult.input?.availableLumpSum}:${recommendationResult.input?.monthlyContribution}:${recommendationResult.input?.liquidityNeed}:${recommendationResult.input?.preferredChannel}`} result={recommendationResult} locale={locale} /> : <EmptyState icon={WalletCards} message={t.noRecommendation} />}</div>}
    </section>
    </Activity>
    <section className={styles.informationPanel} aria-labelledby="finance-product-list-title">
      <div className={styles.listHeader}><div><h2 id="finance-product-list-title">{t.productList}</h2><p>{financeSectionCopy[locale].scope}</p></div></div>
      {loading ? <LoadingState locale={locale} /> : items.length
        ? <InformationList items={items} locale={locale} analysisEnabled={analysisEnabled} />
        : <EmptyState icon={WalletCards} message={t.noProduct} />}
    </section>
  </>;
}

function RecommendationList({ result, locale }: { result: ProductRecommendationResult; locale: PublicInformationLocale }) {
  const t = portalCopy[locale];
  const copy = recommendationUiCopy[locale];
  const recommendationsPerPage = 5;
  const [recommendationPage, setRecommendationPage] = useState(1);
  const recommendationListRef = useRef<HTMLOListElement>(null);
  const number = new Intl.NumberFormat(localeTags[locale], { maximumFractionDigits: 2 });
  const money = new Intl.NumberFormat(localeTags[locale], { maximumFractionDigits: 0 });
  const recommendationPageCount = Math.max(1, Math.ceil(result.recommendations.length / recommendationsPerPage));
  const safeRecommendationPage = Math.min(recommendationPage, recommendationPageCount);
  const pageStart = (safeRecommendationPage - 1) * recommendationsPerPage;
  const visibleRecommendations = result.recommendations.slice(pageStart, pageStart + recommendationsPerPage);
  const appliedAmount = result.input
    ? result.input.productKind === "saving"
      ? result.input.monthlyContribution
      : result.input.availableLumpSum
    : null;
  function changeRecommendationPage(nextPage: number) {
    setRecommendationPage(Math.min(recommendationPageCount, Math.max(1, nextPage)));
    window.requestAnimationFrame(() => {
      const target = recommendationListRef.current;
      target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    });
  }
  return <>
    <div className={styles.recommendationApplied}>
      <div><strong>{copy.applied}</strong><span>{copy.compared(result.productCount)}</span></div>
      <dl>
        {appliedAmount !== null && <div><dt>{copy.amount}</dt><dd>{money.format(appliedAmount)} {t.won}</dd></div>}
        {result.input && <div><dt>{copy.desiredTerm}</dt><dd>{number.format(result.input.targetTermMonths)} {t.months}</dd></div>}
        {result.input && <div><dt>{t.liquidity}</dt><dd>{t.liquidityOptions[result.input.liquidityNeed]}</dd></div>}
        {result.input && <div><dt>{t.channel}</dt><dd>{t.channelOptions[result.input.preferredChannel]}</dd></div>}
      </dl>
      <small>{copy.dataAsOf} · {result.asOf ? formatDate(result.asOf, locale) : copy.unknownDate}</small>
    </div>
    <ol ref={recommendationListRef} tabIndex={-1} className={styles.recommendationCards}>{visibleRecommendations.map((recommendation) => {
      const disclosedRate = recommendation.maximumRate ?? recommendation.baseRate;
      return <li key={recommendation.itemId}><details><summary><div><span>{recommendation.provider}</span><h4>{recommendation.title}</h4><small>{t.published} {formatDate(recommendation.asOf, locale)}</small></div><dl><div><dt>{t.score}</dt><dd>{Math.round(recommendation.score)}{copy.scoreUnit}</dd></div><div><dt>{copy.disclosedTerm}</dt><dd>{recommendation.termMonths === null ? copy.unavailable : `${number.format(recommendation.termMonths)} ${t.months}`}</dd></div><div><dt>{copy.disclosedRate}</dt><dd>{disclosedRate === null ? copy.unavailable : `${number.format(disclosedRate)}%`}</dd></div></dl><ChevronDown size={17} /></summary><div className={styles.recommendationDetail}>
        {recommendation.estimate && <section className={styles.recommendationEstimate}><strong>{copy.estimateTitle}</strong><dl><div><dt>{copy.principal}</dt><dd>{money.format(recommendation.estimate.principal)} {t.won}</dd></div><div><dt>{copy.grossInterest}</dt><dd>{money.format(recommendation.estimate.grossInterest)} {t.won}</dd></div><div><dt>{copy.netInterest}</dt><dd>{money.format(recommendation.estimate.netInterest)} {t.won}</dd></div><div><dt>{copy.maturityAmount}</dt><dd>{money.format(recommendation.estimate.maturityAmount)} {t.won}</dd></div></dl><small>{copy.estimateBasis(recommendation.estimate.rateBasis, recommendation.estimate.annualRate)}</small></section>}
        {!!recommendation.reasons.length && <section><strong>{t.recommendationReason}</strong><ul>{recommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section>}
        {!!recommendation.checks.length && <section><strong>{t.recommendationCheck}</strong><ul>{recommendation.checks.map((check) => <li key={check}>{check}</li>)}</ul></section>}
        <a href={recommendation.sourceUrl} target="_blank" rel="noreferrer">{t.official}<ExternalLink size={13} /></a>
      </div></details></li>;
    })}</ol>
    <nav className={styles.recommendationPagination} aria-label={copy.paginationLabel}>
      <span>{copy.showing(pageStart + 1, pageStart + visibleRecommendations.length, result.recommendations.length)}</span>
      <div>
        <button type="button" disabled={safeRecommendationPage <= 1} onClick={() => changeRecommendationPage(safeRecommendationPage - 1)}>{copy.previousPage}</button>
        <strong aria-live="polite">{copy.page(safeRecommendationPage, recommendationPageCount)}</strong>
        <button type="button" disabled={safeRecommendationPage >= recommendationPageCount} onClick={() => changeRecommendationPage(safeRecommendationPage + 1)}>{copy.nextPage}</button>
      </div>
    </nav>
    {result.disclaimer && <p className={styles.recommendationDisclaimer}>{result.disclaimer}</p>}
  </>;
}

const commercialExplorerCopy: Record<PublicInformationLocale, {
  topTitle: string;
  topLead: string;
  searchTitle: string;
  searchLead: string;
  showing: (shown: number, total: number) => string;
  selectDistrict: string;
  selectedDetail: string;
  evidence: string;
  officialZone: string;
  officialLocation: string;
  officialArea: string;
  areaMissing: string;
  coordinateCount: (count: number) => string;
  industries: string;
  noIndustries: string;
  characteristics: string;
  characteristic: (place: string, area: string) => string;
  culture: string;
  cultureCheck: string;
  missing: string;
  missingItems: string[];
  fact: (place: string, area: string) => string;
  evidenceScope: string;
  mapSelectAll: string;
  noCoordinates: string;
  asOf: string;
}> = {
  ko: {
    topTitle: "공식 면적 기준 상위 10개",
    topLead: "공식 API의 trarArea(㎡)를 큰 순서로 정렬했습니다. 면적이 없는 상권은 뒤에 놓이며, 나머지는 검색이나 지도 선택으로 확인할 수 있습니다.",
    searchTitle: "상권 검색 결과",
    searchLead: "검색 결과 중 면적순 최대 10개를 상단에 표시하며, 좌표가 있는 전체 결과는 지도 선택 목록에 유지합니다.",
    showing: (shown, total) => `${total}개 중 ${shown}개 표시`,
    selectDistrict: "상권 상세 선택",
    selectedDetail: "선택 상권 상세",
    evidence: "공식 API 근거",
    officialZone: "공식 상권명",
    officialLocation: "공식 행정구역",
    officialArea: "공식 상권 면적",
    areaMissing: "공식 면적 미제공",
    coordinateCount: (count) => `경계 좌표 ${count}개`,
    industries: "주요 업종",
    noIndustries: "현재 공식 주요상권 API에는 업종 구성 정보가 없습니다.",
    characteristics: "확인 가능한 상권 특징",
    characteristic: (place, area) => `${place}의 공식 경계와 ${area}만 확인할 수 있습니다. 면적은 경계 규모 비교용이며 점포 밀도나 수요를 뜻하지 않습니다.`,
    culture: "판매·소비 문화 확인 포인트",
    cultureCheck: "이 API만으로 판매 문화나 소비 성향을 판단할 수 없습니다. 업종별 점포 수·실매출·시간대별 결제와 유동인구를 공식 자료로 추가 확인하세요.",
    missing: "현재 API 응답 미제공 항목",
    missingItems: ["상권유형", "주요 업종 구성", "실매출", "시간대별 결제·유동인구", "임대료"],
    fact: (place, area) => `${place}에 있는 공식 주요상권이며 API 제공 면적은 ${area}입니다.`,
    evidenceScope: "공식 상권명·행정구역·trarArea 면적·경계 좌표·stdrDt 기준일만 표시하며, 미제공 특성이나 수치는 추정하지 않습니다.",
    mapSelectAll: "지도에서 상권 선택",
    noCoordinates: "선택한 상권에는 표시 가능한 공식 경계 좌표가 없습니다.",
    asOf: "데이터 기준",
  },
  en: {
    topTitle: "Top 10 by official area",
    topLead: "Ranked by the official trarArea value in square metres. Zones without an area appear last; use search or the map selector for all others.",
    searchTitle: "Commercial-area search results",
    searchLead: "Up to 10 matches appear above by area; every matching zone with coordinates remains in the map selector.",
    showing: (shown, total) => `Showing ${shown} of ${total}`,
    selectDistrict: "Select area details",
    selectedDetail: "Selected commercial area",
    evidence: "Official API evidence",
    officialZone: "Official zone name",
    officialLocation: "Official administrative area",
    officialArea: "Official zone area",
    areaMissing: "Official area not supplied",
    coordinateCount: (count) => `${count} boundary coordinates`,
    industries: "Leading industries",
    noIndustries: "The official major-zone API does not include an industry mix.",
    characteristics: "Available zone characteristics",
    characteristic: (place, area) => `Only the official boundary, location in ${place}, and ${area} are available. Area compares boundary size; it does not indicate store density or demand.`,
    culture: "Sales and consumption checks",
    cultureCheck: "This API cannot establish sales or consumption culture. Check official store-mix, actual-sales, time-of-day payment, and footfall data separately.",
    missing: "Not supplied in the current API response",
    missingItems: ["zone type", "industry mix", "actual sales", "payments and footfall by time", "rent"],
    fact: (place, area) => `This is an official major zone in ${place}, with an API area of ${area}.`,
    evidenceScope: "Only official names, administrative areas, trarArea, boundary coordinates, and the stdrDt reference date are shown. Missing characteristics and figures are not inferred.",
    mapSelectAll: "Select an area on the map",
    noCoordinates: "This zone has no usable official boundary coordinates.",
    asOf: "Data as of",
  },
  ja: {
    topTitle: "公式面積上位10商圏",
    topLead: "公式APIのtrarArea（㎡）が大きい順です。面積がない商圏は後ろに並び、その他は検索または地図選択で確認できます。",
    searchTitle: "商圏の検索結果",
    searchLead: "面積順で最大10件を表示し、座標付きの全検索結果は地図選択に残します。",
    showing: (shown, total) => `${total}地域中${shown}地域を表示`,
    selectDistrict: "商圏詳細を選択",
    selectedDetail: "選択した商圏の詳細",
    evidence: "公式APIの根拠",
    officialZone: "公式商圏名",
    officialLocation: "公式行政区域",
    officialArea: "公式商圏面積",
    areaMissing: "公式面積の提供なし",
    coordinateCount: (count) => `境界座標${count}点`,
    industries: "主要業種",
    noIndustries: "公式主要商圏APIには業種構成が含まれていません。",
    characteristics: "確認できる商圏の特徴",
    characteristic: (place, area) => `${place}の公式境界と${area}のみ確認できます。面積は境界規模の比較用で、店舗密度や需要を示しません。`,
    culture: "販売・消費文化の確認ポイント",
    cultureCheck: "このAPIだけでは販売・消費文化を判断できません。業種別店舗数・実売上・時間帯別決済・流動人口の公式資料を別途確認してください。",
    missing: "現在のAPI応答にない項目",
    missingItems: ["商圏タイプ", "主要業種構成", "実売上", "時間帯別決済・流動人口", "賃料"],
    fact: (place, area) => `${place}にある公式主要商圏で、API提供面積は${area}です。`,
    evidenceScope: "公式商圏名・行政区域・trarArea・境界座標・stdrDt基準日のみ表示し、未提供の特徴や数値は推定しません。",
    mapSelectAll: "地図で商圏を選択",
    noCoordinates: "この商圏には表示可能な公式境界座標がありません。",
    asOf: "データ基準日",
  },
  zh: {
    topTitle: "按官方面积排名前10",
    topLead: "按官方API的trarArea（㎡）从大到小排序。无面积数据的商圈排在后面，其余可通过搜索或地图选择查看。",
    searchTitle: "商圈搜索结果",
    searchLead: "顶部按面积最多显示10条；所有含坐标的匹配结果仍保留在地图选择列表中。",
    showing: (shown, total) => `共${total}个，显示${shown}个`,
    selectDistrict: "选择商圈详情",
    selectedDetail: "所选商圈详情",
    evidence: "官方API依据",
    officialZone: "官方商圈名称",
    officialLocation: "官方行政区域",
    officialArea: "官方商圈面积",
    areaMissing: "未提供官方面积",
    coordinateCount: (count) => `${count}个边界坐标`,
    industries: "主要行业",
    noIndustries: "官方主要商圈API不包含行业构成。",
    characteristics: "可确认的商圈特征",
    characteristic: (place, area) => `只能确认${place}的官方边界和${area}。面积仅用于比较边界规模，不代表店铺密度或需求。`,
    culture: "销售与消费文化核查要点",
    cultureCheck: "仅凭此API无法判断销售或消费文化。请另行核查官方行业店铺数、实际销售额、分时支付和客流数据。",
    missing: "当前API响应未提供",
    missingItems: ["商圈类型", "主要行业构成", "实际销售额", "分时段支付与客流", "租金"],
    fact: (place, area) => `这是位于${place}的官方主要商圈，API面积为${area}。`,
    evidenceScope: "仅显示官方商圈名称、行政区、trarArea、边界坐标和stdrDt基准日，不推断未提供的特征或数值。",
    mapSelectAll: "在地图中选择商圈",
    noCoordinates: "该商圈没有可用的官方边界坐标。",
    asOf: "数据基准",
  },
};

function StartupInformation({
  items,
  supplementalItems,
  loading,
  locale,
  catalogTotalCount,
  personalization,
  analysisEnabled,
  facets,
  regionSelection,
  query,
  showTools,
}: {
  items: PublicInformationItem[];
  supplementalItems: PublicInformationItem[];
  loading: boolean;
  locale: PublicInformationLocale;
  catalogTotalCount: number;
  personalization?: PublicDataDashboard["startupAnnouncementPersonalization"];
  analysisEnabled: boolean;
  facets?: PublicInformationGroup["startupFacets"];
  regionSelection: YouthPolicyRegionSelection;
  query: string;
  showTools: boolean;
}) {
  const t = portalCopy[locale];
  const [preferredRegion, setPreferredRegion] = useState<string | null>(null);
  const [commercialView, setCommercialView] = useState<"nationwide" | "analytics">("analytics");
  const supportItems = useMemo(() => items.filter(isStartupAnnouncementItem), [items]);
  const commercialItems = useMemo(() => {
    const byId = new Map<string, PublicInformationItem>();
    for (const item of [...items, ...supplementalItems]) {
      if (item.id.startsWith("commercial-") || item.id.startsWith("seoul-commercial-") || item.commercialArea) {
        byId.set(item.id, item);
      }
    }
    return [...byId.values()];
  }, [items, supplementalItems]);
  const seoulCommercialItems = useMemo(
    () => commercialItems.filter((item) => (
      /^seoul-commercial-\d{7,10}$/u.test(item.id)
      && Boolean(item.commercialArea?.analytics)
    )),
    [commercialItems],
  );
  const regionButtonLabel = {
    ko: "이 지역 상권 분석",
    en: "View this region's districts",
    ja: "この地域の商圏を見る",
    zh: "查看该地区商圈",
  }[locale];
  const flowCopy = {
    ko: {
      label: "창업 탐색 순서",
      notices: "1. 지원 공고 선택",
      districts: "2. 후보 지역 상권 분석",
      districtStep: "STEP 2 · 상권 분석",
    },
    en: {
      label: "Startup exploration steps",
      notices: "1. Choose a support notice",
      districts: "2. Analyze the candidate district",
      districtStep: "STEP 2 · COMMERCIAL AREA",
    },
    ja: {
      label: "創業情報の確認手順",
      notices: "1. 支援公募を選択",
      districts: "2. 候補地域の商圏を分析",
      districtStep: "STEP 2 · 商圏分析",
    },
    zh: {
      label: "创业信息查看顺序",
      notices: "1. 选择扶持公告",
      districts: "2. 分析候选地区商圈",
      districtStep: "STEP 2 · 商圈分析",
    },
  }[locale];
  const commercialViewCopy = {
    ko: {
      nationwide: "전국 점포·상권 검색",
      analytics: "서울 총매출 TOP 10",
      nationwideCount: "전국 17개 시·도",
      tabs: "상권 정보 보기 방식",
    },
    en: {
      nationwide: "Nationwide stores",
      analytics: "Seoul district metrics",
      nationwideCount: "17 provinces nationwide",
      tabs: "Commercial information view",
    },
    ja: {
      nationwide: "全国の店舗・商圏",
      analytics: "ソウル商圏指標",
      nationwideCount: "全国17地域",
      tabs: "商圏情報の表示",
    },
    zh: {
      nationwide: "全国商户与商圈",
      analytics: "首尔商圈指标",
      nationwideCount: "全国17个地区",
      tabs: "商圈信息视图",
    },
  }[locale];

  function focusCommercialRegion(region: string) {
    setPreferredRegion(region);
    setCommercialView(region.includes("서울") ? "analytics" : "nationwide");
    window.requestAnimationFrame(() => {
      document.getElementById("commercial-district-title")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function changeCommercialRegion(region: string | null) {
    setPreferredRegion(region);
    if (region) setCommercialView(region.includes("서울") ? "analytics" : "nationwide");
  }

  return <>
    {showTools && <StartupAnnouncementRecommendations
      items={supportItems}
      summary={personalization}
      locale={locale}
      loading={loading}
    />}
    {showTools && <nav className={styles.startupFlow} aria-label={flowCopy.label}>
      <a href="#startup-support-title">{flowCopy.notices}</a>
      <ArrowRight size={15} aria-hidden="true" />
      <a href="#commercial-district-title">{flowCopy.districts}</a>
    </nav>}
    <StartupRegionExplorer
      items={supportItems}
      catalogTotalCount={catalogTotalCount}
      facets={facets}
      selection={regionSelection}
      query={query}
      onSelectionChange={(selection) => updateCategoryQuery({ regionSelection: selection.mode === "region" ? { ...selection, includeNationwide: false } : selection, page: 1 })}
      onQueryChange={(value) => updateCategoryQuery({ query: value, page: 1 }, "replace")}
      loading={loading}
      locale={locale}
      onCommercialRegionChange={showTools ? changeCommercialRegion : undefined}
      renderItems={(visibleItems) => <InformationList
        items={visibleItems}
        locale={locale}
        analysisEnabled={analysisEnabled}
        onRegionFocus={focusCommercialRegion}
        regionButtonLabel={regionButtonLabel}
      />}
    />
    {showTools && <section className={styles.districtPanel} aria-labelledby="commercial-district-title">
      <div className={styles.districtHeading}><div><span className={styles.hubIcon}><Building2 size={21} /></span><div><small className={styles.startupStep}>{flowCopy.districtStep}</small><h2 id="commercial-district-title">{t.districtTitle}</h2><p>{t.districtLead}</p></div></div><strong>{commercialView === "nationwide" ? commercialViewCopy.nationwideCount : `${seoulCommercialItems.length} ${t.districtUnit}`}</strong></div>
      <div className={styles.commercialViewTabs} role="group" aria-label={commercialViewCopy.tabs}>
        <button type="button" aria-pressed={commercialView === "analytics"} onClick={() => setCommercialView("analytics")}><BarChart3 size={17} />{commercialViewCopy.analytics}</button>
        <button type="button" aria-pressed={commercialView === "nationwide"} onClick={() => setCommercialView("nationwide")}><Store size={17} />{commercialViewCopy.nationwide}</button>
      </div>
      {commercialView === "nationwide"
        ? <CommercialStoreSearch key={preferredRegion ?? "nationwide"} locale={locale} preferredProvince={preferredRegion} />
        : loading
          ? <LoadingState locale={locale} />
          : <CommercialAreaInsights items={seoulCommercialItems} locale={locale} preferredRegion={preferredRegion} onClearPreferredRegion={() => setPreferredRegion(null)} />}
    </section>}
  </>;
}

function InformationList({
  items,
  locale,
  onRegionFocus,
  regionButtonLabel,
  analysisEnabled = false,
}: {
  items: PublicInformationItem[];
  locale: PublicInformationLocale;
  onRegionFocus?: (region: string) => void;
  regionButtonLabel?: string;
  analysisEnabled?: boolean;
}) {
  return <ul className={styles.informationList}>{items.map((item) => <InformationItem key={`${locale}:${item.id}`} item={item} locale={locale} onRegionFocus={onRegionFocus} regionButtonLabel={regionButtonLabel} analysisEnabled={analysisEnabled} />)}</ul>;
}

function normalizeItemAnalysis(payload: unknown): ItemAnalysis | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  const explanationValue = value.explanation ?? value.summary ?? (typeof value.analysis === "string" ? value.analysis : null);
  if (typeof explanationValue !== "string" || !explanationValue.trim()) return null;
  const list = (candidate: unknown) => Array.isArray(candidate)
    ? candidate.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 6).map((item) => item.trim().slice(0, 320))
    : [];
  const caution = typeof value.caution === "string" && value.caution.trim()
    ? [value.caution.trim().slice(0, 320)]
    : list(value.cautions ?? value.notes);
  const cache = value.cache && typeof value.cache === "object" && !Array.isArray(value.cache)
    ? value.cache as Record<string, unknown>
    : {};
  const ai = value.ai && typeof value.ai === "object" && !Array.isArray(value.ai)
    ? value.ai as Record<string, unknown>
    : {};
  return {
    explanation: explanationValue.trim().slice(0, 1_500),
    providerError: value.providerError === "model_warming" || value.providerError === "local_inference_busy" || value.providerError === "local_inference_timeout" ? value.providerError : null,
    keyPoints: list(value.keyPoints ?? value.points),
    cautions: caution,
    sourceUrl: safeHttpUrl(value.sourceUrl),
    sourceName: typeof value.sourceName === "string" ? value.sourceName.trim().slice(0, 220) : "",
    sourceLinkKind: value.sourceLinkKind === "detail" ? "detail" : "dataset",
    generation: cache.hit === true ? "cached" : ai.invoked === true ? "generated" : "rule",
    billableApprovalAvailable: ai.approvalRequired === true && ai.approvalAvailable === true,
    billableApprovalProvider: typeof ai.provider === "string" ? ai.provider.slice(0, 30) : null,
    billableApprovalModel: typeof ai.model === "string" ? ai.model.slice(0, 120) : null,
  };
}

function InformationItem({
  item,
  locale,
  onRegionFocus,
  regionButtonLabel,
  analysisEnabled,
}: {
  item: PublicInformationItem;
  locale: PublicInformationLocale;
  onRegionFocus?: (region: string) => void;
  regionButtonLabel?: string;
  analysisEnabled: boolean;
}) {
  const t = portalCopy[locale];
  const [analysis, setAnalysis] = useState<ItemAnalysis | null>(null);
  const [analysisState, setAnalysisState] = useState<"idle" | "loading" | "failed" | "ready">("idle");
  const analysisRequestRef = useRef(0);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const billableRequestPendingRef = useRef(false);
  const location = (item as LocatedItem).location;
  const locationLabel = [location?.label, location?.roadAddress, location?.neighborhood, location?.city].find((value) => typeof value === "string" && value.trim());
  const officialRegion = location?.province?.trim() || location?.label?.trim() || null;
  const sourceUrl = safePublicHttpUrl(item.sourceUrl);
  const itemLinkKind = officialLinkKind(item);
  const sourceLabel = itemLinkKind === "detail" ? t.officialDetail : t.officialDataset;
  const preview = sourcePreviewCopy[locale];
  const collectedScope = item.tags.slice(0, 4).map(displayPublicText).join(" · ") || preview.scopeFallback;
  const displayTitle = displayPublicText(item.title);
  const displaySummary = item.summary ? displayPublicText(item.summary) : "";
  const displayLocationLabel = locationLabel ? displayPublicText(locationLabel) : "";
  const resolvedSourceUrl = sourceUrl ?? analysis?.sourceUrl ?? null;
  const resolvedSourceLabel = sourceUrl
    ? sourceLabel
    : analysis?.sourceLinkKind === "detail" ? t.officialDetail : t.officialDataset;
  const resolvedSourceName = item.source || analysis?.sourceName || t.official;
  const applicationPeriod = applicationPeriodView(item, locale);

  useEffect(() => () => {
    analysisRequestRef.current += 1;
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    billableRequestPendingRef.current = false;
  }, []);

  async function loadAnalysis() {
    if (analysisState === "loading" || (analysisState === "ready" && !analysis?.providerError)) return;
    const requestId = analysisRequestRef.current + 1;
    analysisRequestRef.current = requestId;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Item analysis request timed out", "TimeoutError"));
    }, ITEM_ANALYSIS_REQUEST_TIMEOUT_MS);
    const clearRequestTimeout = () => window.clearTimeout(timeoutId);
    controller.signal.addEventListener("abort", clearRequestTimeout, { once: true });
    const ownsRequest = () => requestId === analysisRequestRef.current;
    const canCommit = () => ownsRequest() && !controller.signal.aborted;
    setAnalysisState("loading");
    try {
      const maximumPeerRetries = 2;
      for (let attempt = 0; attempt <= maximumPeerRetries; attempt += 1) {
        const response = await fetch("/api/public-data/item-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          signal: controller.signal,
          // Local AI may generate here; paid providers may only return a saved
          // explanation. A paid cache miss cannot spend through this POST.
          body: JSON.stringify({ itemId: item.id, category: item.category, locale, useAi: true }),
        });
        if (!ownsRequest()) return;
        if (timedOut) throw new DOMException("Item analysis request timed out", "TimeoutError");
        if (!canCommit()) return;
        if (!response.ok) throw new Error("item_analysis_unavailable");
        const normalized = normalizeItemAnalysis(await response.json());
        if (!ownsRequest()) return;
        if (timedOut) throw new DOMException("Item analysis request timed out", "TimeoutError");
        if (!canCommit()) return;
        if (!normalized) throw new Error("item_analysis_invalid");
        if (response.status === 202 && attempt < maximumPeerRetries) {
          const requestedDelay = Number(response.headers.get("Retry-After"));
          const delayMs = Number.isFinite(requestedDelay)
            ? Math.min(2_000, Math.max(500, requestedDelay * 1_000))
            : 1_000;
          await new Promise<void>((resolve, reject) => {
            let delayId = 0;
            const cancelDelay = () => {
              window.clearTimeout(delayId);
              reject(controller.signal.reason ?? new DOMException("Item analysis cancelled", "AbortError"));
            };
            const finishDelay = () => {
              controller.signal.removeEventListener("abort", cancelDelay);
              resolve();
            };
            delayId = window.setTimeout(finishDelay, delayMs);
            if (controller.signal.aborted) {
              cancelDelay();
              return;
            }
            controller.signal.addEventListener("abort", cancelDelay, { once: true });
          });
          if (!canCommit()) return;
          continue;
        }
        setAnalysis(normalized);
        // A still-running peer may finish after the two bounded retries. Leave
        // the item retryable through its explicit button instead of pinning the
        // deterministic placeholder for the component's entire lifetime.
        setAnalysisState(response.status === 202 ? "idle" : "ready");
        return;
      }
    } catch {
      if ((timedOut || !controller.signal.aborted) && ownsRequest()) {
        setAnalysis(null);
        setAnalysisState("failed");
      }
    } finally {
      window.clearTimeout(timeoutId);
      controller.signal.removeEventListener("abort", clearRequestTimeout);
      if (ownsRequest()) analysisAbortRef.current = null;
    }
  }

  async function generateBillableAnalysis() {
    if (analysisState === "loading" || billableRequestPendingRef.current) return;
    const expectedProvider = analysis?.billableApprovalProvider;
    const expectedModel = analysis?.billableApprovalModel;
    if (!expectedProvider || !expectedModel) {
      setAnalysisState("failed");
      return;
    }
    const requestId = analysisRequestRef.current + 1;
    analysisRequestRef.current = requestId;
    billableRequestPendingRef.current = true;
    analysisAbortRef.current?.abort();
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Billable item analysis request timed out", "TimeoutError"));
    }, BILLABLE_ITEM_ANALYSIS_REQUEST_TIMEOUT_MS);
    const clearRequestTimeout = () => window.clearTimeout(timeoutId);
    controller.signal.addEventListener("abort", clearRequestTimeout, { once: true });
    const ownsRequest = () => requestId === analysisRequestRef.current;
    const canCommit = () => ownsRequest() && !controller.signal.aborted;
    setAnalysisState("loading");
    try {
      // This is deliberately one request. A 202 response is never retried as
      // PUT, so a confirmation cannot fan out into multiple billable calls.
      const response = await fetch("/api/public-data/item-analysis", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        signal: controller.signal,
        body: JSON.stringify({
          scope: "single-public-item-explanation",
          itemId: item.id,
          category: item.category,
          locale,
          expectedProvider,
          expectedModel,
        }),
      });
      if (!ownsRequest()) return;
      if (timedOut) throw new DOMException("Billable item analysis request timed out", "TimeoutError");
      if (!canCommit()) return;
      if (!response.ok) throw new Error("billable_item_analysis_unavailable");
      const normalized = normalizeItemAnalysis(await response.json());
      if (!ownsRequest()) return;
      if (timedOut) throw new DOMException("Billable item analysis request timed out", "TimeoutError");
      if (!canCommit()) return;
      if (!normalized) throw new Error("billable_item_analysis_invalid");
      setAnalysis(normalized);
      setAnalysisState(response.status === 202 ? "idle" : "ready");
    } catch {
      if ((timedOut || !controller.signal.aborted) && ownsRequest()) setAnalysisState("failed");
    } finally {
      window.clearTimeout(timeoutId);
      controller.signal.removeEventListener("abort", clearRequestTimeout);
      if (ownsRequest()) {
        analysisAbortRef.current = null;
        billableRequestPendingRef.current = false;
      }
    }
  }

  return <li id={item.category === "startup" ? startupAnnouncementDomId(item.id) : undefined}><details onToggle={(event) => { if (event.currentTarget.open) { void recordRecentActivity({ activityType: "information", targetCode: item.category, referenceId: item.id }); } }}><summary><div><span>{item.source}</span><h3>{displayTitle}</h3>{displaySummary && <p className={styles.itemPreview}>{displaySummary}</p>}{applicationPeriod && <p className={styles.itemPreview}>{applicationPeriod.label}</p>}<time dateTime={item.publishedAt ?? undefined}>{t.published} {formatDate(item.publishedAt, locale)}</time></div><small>{t.explain}</small><ChevronDown size={17} /></summary><div className={styles.itemBody}>
    {resolvedSourceUrl && <div className={styles.sourceActions}><a href={resolvedSourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`${displayTitle} · ${resolvedSourceLabel}`}><BookOpenCheck size={17} /><span><small>{preview.latestConditions}</small><strong>{resolvedSourceLabel} · {resolvedSourceName}</strong></span><ExternalLink size={16} /></a></div>}
    <section className={styles.itemBrief} aria-label={preview.briefTitle}>
      <div className={styles.itemBriefSummary}>
        <span aria-hidden="true"><Info size={18} /></span>
        <div><strong>{preview.summaryTitle}</strong><p>{displaySummary.length > 280 ? `${displaySummary.slice(0, 280)}…` : displaySummary || preview.noSummary}</p>{displaySummary.length > 280 && <details className={styles.collectedText}><summary>{financeSectionCopy[locale].readMore}</summary><p>{displaySummary}</p></details>}</div>
      </div>
      <dl className={styles.itemBriefFacts}>
        <div><dt><Building2 size={14} />{preview.provider}</dt><dd>{item.source}</dd></div>
        <div><dt><CalendarDays size={14} />{preview.referenceDate}</dt><dd>{formatDate(item.publishedAt, locale)}</dd></div>
        {applicationPeriod
          ? <div><dt><Clock3 size={14} />{applicationPeriod.heading}</dt><dd>{applicationPeriod.dates}</dd></div>
          : item.expiresAt && <div><dt><Clock3 size={14} />{preview.deadline}</dt><dd>{formatDate(item.expiresAt, locale)}</dd></div>}
        {item.lastVerifiedAt && <div><dt><Clock3 size={14} />{preview.lastVerified}</dt><dd>{formatDateTime(item.lastVerifiedAt, locale)}</dd></div>}
        <div><dt><ListChecks size={14} />{preview.scope}</dt><dd>{collectedScope}</dd></div>
      </dl>
      <aside className={styles.officialPurpose}>
        <BookOpenCheck size={19} />
        <div><strong>{preview.officialPurpose}</strong><p>{preview.officialPurposeBody}</p></div>
      </aside>
    </section>
    {displayLocationLabel && <small className={styles.locationLabel}><MapPinned size={14} />{displayLocationLabel}</small>}{officialRegion && onRegionFocus && regionButtonLabel && <button type="button" className={styles.regionFocusButton} onClick={() => onRegionFocus(officialRegion)}><MapPinned size={14} />{regionButtonLabel}</button>}{!!item.tags.length && <div className={styles.tagList}>{item.tags.map((tag) => <span key={`${item.id}-${tag}`}>{displayPublicText(tag)}</span>)}</div>}<YouthPolicyMatchEvidence match={item.youthPolicyMatch} locale={locale} />
    {analysisEnabled && <section className={styles.analysisPanel} aria-live="polite" aria-label={t.analysisTitle}><div className={styles.analysisHeading}><h4><Sparkles size={15} />{t.analysisTitle}</h4>{analysis && <span data-mode={analysis.generation}>{analysis.generation === "cached" ? t.analysisCached : analysis.generation === "generated" ? t.analysisGenerated : t.analysisRule}</span>}</div>{analysis?.providerError && <p role="status">{aiAvailabilityCopy[locale][analysis.providerError]} <button type="button" disabled={analysisState === "loading"} onClick={() => void loadAnalysis()}>{t.analysisRetry}</button></p>}{analysisState === "idle" && <button type="button" onClick={() => void loadAnalysis()}><Sparkles size={15} />{financeSectionCopy[locale].aiRequest}</button>}{analysisState === "loading" ? <p>{t.analysisLoading}</p> : analysisState === "failed" ? <div><p>{t.analysisFailed}</p><button type="button" onClick={() => void loadAnalysis()}>{t.analysisRetry}</button></div> : analysis ? <><p>{analysis.explanation}</p>{!!analysis.keyPoints.length && <div><strong>{t.analysisPoints}</strong><ul>{analysis.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul></div>}{!!analysis.cautions.length && <div><strong>{t.analysisCautions}</strong><ul>{analysis.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul></div>}{analysis.billableApprovalAvailable && analysis.billableApprovalProvider && analysis.billableApprovalModel && <BillableItemAnalysisButton locale={locale} pending={false} provider={analysis.billableApprovalProvider} model={analysis.billableApprovalModel} onApprove={() => void generateBillableAnalysis()} />}</> : null}</section>}

  </div></details></li>;
}

function LoadingState({ locale, message }: { locale: PublicInformationLocale; message?: string }) {
  return <div className={styles.emptyState} role="status" aria-busy="true"><Clock3 size={28} /><p>{message ?? portalCopy[locale].loading}</p></div>;
}

function EmptyState({ icon: Icon, message, showCount = true }: { icon: typeof Sparkles; message: string; showCount?: boolean }) {
  return <div className={styles.emptyState}><Icon size={28} /><p>{message}</p>{showCount && <strong>0</strong>}</div>;
}

function coordinates(item: PublicInformationItem) {
  const location = (item as LocatedItem).location;
  if (!location) return null;
  const latitude = Number(location.latitude ?? location.lat);
  const longitude = Number(location.longitude ?? location.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/** @deprecated Kept only for compatibility with older embedded consumers. */
export function commercialDistricts(items: PublicInformationItem[]): CommercialDistrict[] {
  return items.map((item) => {
    const location = (item as LocatedItem).location;
    const point = coordinates(item);
    const areaValue = item.commercialArea?.areaSquareMeters;
    const rawArea = typeof areaValue === "number" ? areaValue : Number.NaN;
    const areaSquareMeters = Number.isFinite(rawArea) && rawArea > 0 ? rawArea : null;
    const coordinateCountValue = item.commercialArea?.coordinateCount;
    const rawCoordinateCount = typeof coordinateCountValue === "number"
      ? coordinateCountValue
      : Number.NaN;
    const coordinateCount = Number.isSafeInteger(rawCoordinateCount) && rawCoordinateCount >= 0
      ? rawCoordinateCount
      : null;
    const referenceDate = typeof item.commercialArea?.referenceDate === "string"
      ? item.commercialArea.referenceDate
      : null;
    const province = location?.province?.trim() || "";
    const locationLabel = location?.label?.trim()
      || [province, location?.city?.trim()].filter(Boolean).join(" ")
      || province
      || "—";
    return {
      id: item.id,
      rank: 0,
      label: item.title.trim() || item.id,
      province,
      locationLabel,
      areaSquareMeters,
      referenceDate,
      coordinateCount,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
      sourceUrl: item.sourceUrl,
    };
  }).sort((left, right) => {
    if (left.areaSquareMeters === null && right.areaSquareMeters !== null) return 1;
    if (left.areaSquareMeters !== null && right.areaSquareMeters === null) return -1;
    if (left.areaSquareMeters !== null && right.areaSquareMeters !== null) {
      const areaDifference = right.areaSquareMeters - left.areaSquareMeters;
      if (areaDifference) return areaDifference;
    }
    return left.label.localeCompare(right.label, "ko");
  })
    .map((district, index) => ({ ...district, rank: index + 1 }));
}

function formatCommercialArea(value: number | null, locale: PublicInformationLocale) {
  if (value === null) return commercialExplorerCopy[locale].areaMissing;
  return `${new Intl.NumberFormat(localeTags[locale], { maximumFractionDigits: 2 }).format(value)} ㎡`;
}

function osmEmbedUrl(latitude: number, longitude: number) {
  const latitudeGap = 0.025;
  const longitudeGap = 0.035;
  const params = new URLSearchParams({
    bbox: `${longitude - longitudeGap},${latitude - latitudeGap},${longitude + longitudeGap},${latitude + latitudeGap}`,
    layer: "mapnik",
    marker: `${latitude},${longitude}`,
  });
  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
}

/** @deprecated Use CommercialAreaInsights for source-aware analytics. */
export function CommercialDistrictMap({
  districts,
  visibleDistricts,
  queryActive,
  locale,
}: {
  districts: CommercialDistrict[];
  visibleDistricts: CommercialDistrict[];
  queryActive: boolean;
  locale: PublicInformationLocale;
}) {
  const t = portalCopy[locale];
  const c = commercialExplorerCopy[locale];
  const availableDistricts = queryActive ? visibleDistricts : districts;
  const featuredDistricts = availableDistricts.slice(0, 10);
  const mappedDistricts = availableDistricts.filter((district) => district.latitude !== null && district.longitude !== null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = availableDistricts.find((district) => district.id === selectedId) ?? featuredDistricts[0] ?? null;
  const selectedSourceUrl = selected ? safePublicHttpUrl(selected.sourceUrl) : null;
  const selectedHasCoordinates = Boolean(selected && selected.latitude !== null && selected.longitude !== null);
  const selectedPlace = selected?.locationLabel || selected?.province || "—";
  const selectedArea = selected ? formatCommercialArea(selected.areaSquareMeters, locale) : c.areaMissing;

  return <div className={styles.districtContent}>
    <div className={styles.featuredDistrictHeading}>
      <div><strong>{queryActive ? c.searchTitle : c.topTitle}</strong><p>{queryActive ? c.searchLead : c.topLead}</p></div>
      <span aria-live="polite">{c.showing(featuredDistricts.length, availableDistricts.length)}</span>
    </div>
    <ol className={styles.districtCards} aria-label={c.selectDistrict}>{featuredDistricts.map((district) => <li key={district.id}>
      <button type="button" aria-pressed={district.id === selected?.id} aria-controls="commercial-district-detail" onClick={() => setSelectedId(district.id)} aria-label={`#${district.rank} ${district.label} · ${c.officialArea} ${formatCommercialArea(district.areaSquareMeters, locale)}`}>
        <span><Building2 size={18} /></span><div><small>#{district.rank}</small><h3>{district.label}</h3><p>{district.locationLabel}</p><strong>{formatCommercialArea(district.areaSquareMeters, locale)}</strong></div>
      </button>
    </li>)}</ol>
    <section className={styles.mapPanel} aria-labelledby="commercial-area-map-title">
      <div className={styles.mapHeading}><span className={styles.hubIcon}><MapPinned size={22} /></span><div><h2 id="commercial-area-map-title">{t.mapTitle}</h2><p>{t.mapLead}</p></div><strong>{mappedDistricts.length}</strong></div>
      {!mappedDistricts.length ? <EmptyState icon={MapPinned} message={t.mapEmpty} /> : <div className={styles.mapGrid}>
        <div className={styles.mapSelector}><strong>{c.mapSelectAll}</strong><div>{mappedDistricts.map((district) => <button key={district.id} type="button" aria-pressed={district.id === selected?.id} aria-controls="commercial-district-detail" onClick={() => setSelectedId(district.id)}><Store size={16} /><span><strong>{district.label}</strong><small>#{district.rank} · {formatCommercialArea(district.areaSquareMeters, locale)}</small></span></button>)}</div></div>
        <div className={styles.mapFrameWrap}>{selected && selectedHasCoordinates ? <iframe key={selected.id} src={osmEmbedUrl(selected.latitude!, selected.longitude!)} title={`${t.mapFrame}: ${selected.label}`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups" /> : <div className={styles.mapCoordinateEmpty}><MapPinned size={28} /><p>{c.noCoordinates}</p></div>}<div className={styles.mapFrameFooter}><p>{t.mapNote}</p><span>{selectedSourceUrl && <a href={selectedSourceUrl} target="_blank" rel="noopener noreferrer">{t.officialDataset}<ExternalLink size={12} /></a>}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">{t.mapAttribution}<ExternalLink size={12} /></a></span></div></div>
      </div>}
    </section>
    {selected && <section id="commercial-district-detail" className={styles.districtDetail} aria-labelledby="commercial-district-detail-title" aria-live="polite">
      <header><span>{c.selectedDetail}</span><h3 id="commercial-district-detail-title">{selected.label}</h3><p>{c.fact(selectedPlace, selectedArea)}</p></header>
      <div className={styles.districtEvidence}><strong>{c.evidence}</strong><div className={styles.tagList}><span>{c.officialArea}: {selectedArea}</span>{selected.coordinateCount !== null && <span>{c.coordinateCount(selected.coordinateCount)}</span>}{selected.referenceDate && <time dateTime={selected.referenceDate}>{c.asOf} {formatDate(selected.referenceDate, locale)}</time>}</div></div>
      <div className={styles.districtDetailGrid}>
        <article><strong>{c.officialZone}</strong><p>{selected.label}</p></article>
        <article><strong>{c.officialLocation}</strong><p>{selectedPlace}</p></article>
        <article><strong>{c.officialArea}</strong><p>{selectedArea}</p></article>
        <article><strong>{c.industries}</strong><p>{c.noIndustries}</p></article>
        <article><strong>{c.characteristics}</strong><p>{c.characteristic(selectedPlace, selectedArea)}</p></article>
        <article><strong>{c.culture}</strong><p>{c.cultureCheck}</p></article>
        <article className={styles.missingDataCard}><strong>{c.missing}</strong><div className={styles.tagList}>{c.missingItems.map((item) => <span key={`${selected.id}-missing-${item}`}>{item}</span>)}</div></article>
      </div>
      <footer><p>{c.evidenceScope}</p>{selectedSourceUrl && <a href={selectedSourceUrl} target="_blank" rel="noopener noreferrer">{t.officialDataset}<ExternalLink size={12} /></a>}</footer>
    </section>}
  </div>;
}
