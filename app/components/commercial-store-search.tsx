"use client";

import {
  Building2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LocateFixed,
  MapPinned,
  Search,
  Store,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import {
  COMMERCIAL_SEARCH_PROVINCES,
  COMMERCIAL_SEARCH_SOURCE_URL,
} from "@/lib/public-data/commercial-search-config";
import type {
  CommercialAreaSearchItem,
  CommercialAreaSearchResponse,
  CommercialIndustryOption,
  CommercialIndustrySearchResponse,
  CommercialStoreSearchItem,
  CommercialStoreSearchResponse,
} from "@/lib/public-data/commercial-search-types";

import type { PublicInformationLocale } from "./public-information-layout";
import styles from "./commercial-store-search.module.css";

const colors = ["#6047bf", "#8269d7", "#a48ee7", "#c3b3f1", "#e0d6fa", "#8b6cab"];

const copy = {
  ko: {
    eyebrow: "전국 공식 상가 데이터",
    title: "전국 점포·상권 찾기",
    lead: "시·도와 업종으로 공식 API에 등록된 점포를 찾거나, 상권명을 검색한 뒤 그 안의 점포를 확인하세요.",
    storesTab: "지역·업종 점포",
    areasTab: "상권명 검색",
    province: "시·도",
    provincePlaceholder: "지역 선택",
    industry: "업종 대분류",
    allIndustries: "전체 업종",
    searchStores: "점포 보기",
    areaKeyword: "상권명 또는 시·군·구",
    areaPlaceholder: "예: 서면, 전주, 중앙로",
    searchAreas: "상권 찾기",
    signIn: "전국 점포 검색은 공용 API 호출량 보호를 위해 로그인 후 이용할 수 있어요.",
    notConfigured: "개발자 모드에서 공공데이터포털 키를 저장하고 활성화해 주세요.",
    quota: "공용 API 보호 한도에 도달했어요. 잠시 후 다시 시도해 주세요.",
    unavailable: "공식 상가 정보를 지금 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
    noAreas: "조건에 맞는 공식 상권이 없습니다.",
    noStores: "이 페이지에서 확인된 점포가 없습니다.",
    useArea: "이 상권 점포 보기",
    activeArea: "선택 상권",
    clearArea: "지역 기준으로 돌아가기",
    providerTotal: "공식 조회 결과",
    storesUnit: "개 점포",
    areasUnit: "개 상권",
    pageBasis: "현재 공식 응답 페이지",
    composition: "점포 수 기준 업종 구성",
    compositionLead: "아래 비율은 현재 페이지에 반환된 점포 수를 기준으로 계산합니다.",
    filterCurrent: "현재 페이지에서 상호·주소 찾기",
    filterPlaceholder: "상호, 업종, 주소",
    previous: "이전",
    next: "다음",
    page: "페이지",
    official: "공식 점포 정보",
    road: "도로명",
    lot: "지번",
    coordinate: "좌표",
    map: "지도에서 위치 보기",
    selectStore: "점포를 선택하면 주소와 좌표를 지도에서 확인할 수 있어요.",
    source: "공식 데이터셋",
    fetchedAt: "서버 확인",
    cached: "저장된 응답 재사용",
    live: "공식 API 새 응답",
    partial: "공급자 전체 건수가 2,000건을 넘어 현재 범위는 일부 결과입니다.",
    storePartial: "공식 응답의 일부 행이 안전한 형식 검증을 통과하지 못해 제외되었습니다.",
    limitation: "이 화면은 공식 사업체 위치·주소·업종·점포 수 자료입니다. 추정매출·유동인구·임대료는 제공하지 않으며, 점포 수는 수요나 수익성을 의미하지 않습니다.",
    areaLimit: "상권명 검색은 선택한 시·도의 공식 상권 목록을 서버에서 조회하며, 최대 2,000건 범위에서 검색합니다.",
    loading: "공식 데이터를 불러오는 중이에요.",
    industryLoading: "공식 업종 목록을 불러오는 중이에요.",
    industryUnavailable: "업종 목록을 불러오지 못했어요. 전체 업종 검색은 계속 이용할 수 있습니다.",
    other: "기타",
  },
  en: {
    eyebrow: "OFFICIAL NATIONWIDE STORE DATA",
    title: "Find stores and commercial areas",
    lead: "Browse stores listed by the official API by province and industry, or find a commercial area first.",
    storesTab: "Stores by region",
    areasTab: "Search areas",
    province: "Province",
    provincePlaceholder: "Choose a province",
    industry: "Industry group",
    allIndustries: "All industries",
    searchStores: "Find stores",
    areaKeyword: "Area, city or district",
    areaPlaceholder: "e.g. Seomyeon",
    searchAreas: "Find areas",
    signIn: "Sign in to protect the shared public-API allowance.",
    notConfigured: "Enable a valid data.go.kr key in Developer mode.",
    quota: "The protected shared API allowance is temporarily unavailable.",
    unavailable: "Official store data is temporarily unavailable.",
    noAreas: "No official commercial area matched.",
    noStores: "No store was returned on this page.",
    useArea: "Browse stores here",
    activeArea: "Selected area",
    clearArea: "Return to province search",
    providerTotal: "Official results",
    storesUnit: " stores",
    areasUnit: " areas",
    pageBasis: "Current official response page",
    composition: "Industry mix by store count",
    compositionLead: "Percentages use only stores returned on the current page.",
    filterCurrent: "Filter the current page",
    filterPlaceholder: "Name, industry or address",
    previous: "Previous",
    next: "Next",
    page: "Page",
    official: "Official store record",
    road: "Road",
    lot: "Lot",
    coordinate: "Coordinates",
    map: "Open map",
    selectStore: "Select a store to inspect its address and coordinates.",
    source: "Official dataset",
    fetchedAt: "Checked",
    cached: "Reused server cache",
    live: "New official API response",
    partial: "The provider reported more than 2,000 areas, so this is a partial directory.",
    storePartial: "Some provider rows failed safe format validation and were omitted.",
    limitation: "This view contains official business location, address, industry and store-count data. It does not provide estimated sales, footfall or rent, and store count is not a measure of demand or profitability.",
    areaLimit: "Area-name search covers up to 2,000 official areas within the selected province.",
    loading: "Loading official data.",
    industryLoading: "Loading the official industry list.",
    industryUnavailable: "The industry list is unavailable. You can still search all industries.",
    other: "Other",
  },
  ja: {
    eyebrow: "全国の公式店舗データ",
    title: "全国の店舗・商圏を探す",
    lead: "地域と業種から公式APIに登録された店舗を探すか、商圏名を先に検索できます。",
    storesTab: "地域・業種別店舗",
    areasTab: "商圏名検索",
    province: "都道府県",
    provincePlaceholder: "地域を選択",
    industry: "業種大分類",
    allIndustries: "全業種",
    searchStores: "店舗を見る",
    areaKeyword: "商圏名・市区郡",
    areaPlaceholder: "例：西面",
    searchAreas: "商圏を探す",
    signIn: "共有APIの利用枠を保護するため、ログイン後に利用できます。",
    notConfigured: "開発者モードで公共データポータルのキーを有効にしてください。",
    quota: "共有APIの保護上限に達しました。しばらくしてからお試しください。",
    unavailable: "公式店舗情報を取得できませんでした。",
    noAreas: "一致する公式商圏がありません。",
    noStores: "このページに店舗がありません。",
    useArea: "この商圏の店舗を見る",
    activeArea: "選択した商圏",
    clearArea: "地域検索に戻る",
    providerTotal: "公式検索結果",
    storesUnit: "店舗",
    areasUnit: "商圏",
    pageBasis: "現在の公式応答ページ",
    composition: "店舗数基準の業種構成",
    compositionLead: "現在のページで返された店舗数から計算します。",
    filterCurrent: "現在のページ内を検索",
    filterPlaceholder: "店名・業種・住所",
    previous: "前へ",
    next: "次へ",
    page: "ページ",
    official: "公式店舗情報",
    road: "道路名",
    lot: "地番",
    coordinate: "座標",
    map: "地図で見る",
    selectStore: "店舗を選ぶと住所と座標を確認できます。",
    source: "公式データセット",
    fetchedAt: "サーバー確認",
    cached: "保存済み応答を再利用",
    live: "公式APIの新しい応答",
    partial: "提供件数が2,000件を超えたため、一部の商圏のみ表示しています。",
    storePartial: "公式応答の一部が安全な形式検証を通過せず、除外されました。",
    limitation: "この画面は公式の店舗位置・住所・業種・店舗数データです。推定売上・流動人口・賃料は提供されず、店舗数は需要や収益性を意味しません。",
    areaLimit: "商圏名検索は選択地域の公式商圏を最大2,000件まで検索します。",
    loading: "公式データを読み込んでいます。",
    industryLoading: "公式業種一覧を読み込んでいます。",
    industryUnavailable: "業種一覧を取得できませんでした。全業種の検索は引き続き利用できます。",
    other: "その他",
  },
  zh: {
    eyebrow: "全国官方商户数据",
    title: "查找全国商户与商圈",
    lead: "可按地区和行业查看官方 API 登记的商户，也可先搜索商圈名称。",
    storesTab: "地区·行业商户",
    areasTab: "搜索商圈",
    province: "省级地区",
    provincePlaceholder: "选择地区",
    industry: "行业大类",
    allIndustries: "全部行业",
    searchStores: "查看商户",
    areaKeyword: "商圈名或市区",
    areaPlaceholder: "例如：西面",
    searchAreas: "查找商圈",
    signIn: "为保护共享公共 API 配额，请登录后使用。",
    notConfigured: "请在开发者模式中启用公共数据门户密钥。",
    quota: "共享 API 已达到保护上限，请稍后重试。",
    unavailable: "暂时无法获取官方商户信息。",
    noAreas: "没有匹配的官方商圈。",
    noStores: "当前页面没有商户。",
    useArea: "查看该商圈商户",
    activeArea: "已选商圈",
    clearArea: "返回地区搜索",
    providerTotal: "官方查询结果",
    storesUnit: "家商户",
    areasUnit: "个商圈",
    pageBasis: "当前官方响应页",
    composition: "按商户数量计算的行业构成",
    compositionLead: "比例仅基于当前页面返回的商户数量。",
    filterCurrent: "在当前页面查找",
    filterPlaceholder: "名称、行业或地址",
    previous: "上一页",
    next: "下一页",
    page: "页",
    official: "官方商户信息",
    road: "道路名",
    lot: "地号",
    coordinate: "坐标",
    map: "在地图中查看",
    selectStore: "选择商户后可查看地址和坐标。",
    source: "官方数据集",
    fetchedAt: "服务器确认",
    cached: "复用服务器缓存",
    live: "官方 API 新响应",
    partial: "提供方结果超过2,000条，因此当前目录不完整。",
    storePartial: "部分官方响应未通过安全格式校验，已被省略。",
    limitation: "本页面提供官方商户位置、地址、行业和商户数量数据，不包含预估销售额、流动人口或租金；商户数量也不代表需求或盈利能力。",
    areaLimit: "商圈名称搜索最多覆盖所选地区的2,000个官方商圈。",
    loading: "正在加载官方数据。",
    industryLoading: "正在加载官方行业列表。",
    industryUnavailable: "无法加载行业列表，仍可搜索全部行业。",
    other: "其他",
  },
} satisfies Record<PublicInformationLocale, Record<string, string>>;

type SearchMode = "stores" | "areas";
type IndustryLoadState = "loading" | "ready" | "error";

type AppliedAreaRequest = {
  provinceCode: string;
  query: string;
};

type AppliedStoreRequest = {
  area: CommercialAreaSearchItem | null;
  provinceCode: string;
  industryCode: string;
};

function errorMessage(code: string, locale: PublicInformationLocale) {
  const t = copy[locale];
  if (code === "authentication_required") return t.signIn;
  if (code === "commercial_search_not_configured"
    || code === "commercial_search_authorization_pending") return t.notConfigured;
  if (code.includes("quota") || code.includes("rate_limited")) return t.quota;
  return t.unavailable;
}

async function requestJson(body: Record<string, string | number>, signal: AbortSignal) {
  const response = await fetch("/api/public-data/commercial-search", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    cache: "no-store",
    signal,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "commercial_search_unavailable");
  return payload;
}

function matchingProvinceCode(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/gu, "").trim() ?? "";
  if (!normalized) return "";
  const aliases: Record<string, string> = {
    서울: "11", 부산: "26", 대구: "27", 인천: "28", 광주: "29",
    대전: "30", 울산: "31", 세종: "36", 경기: "41", 강원: "51",
    충북: "43", 충남: "44", 전북: "52", 전남: "46", 경북: "47",
    경남: "48", 제주: "50",
  };
  const alias = Object.entries(aliases).find(([name]) => normalized.includes(name));
  return alias?.[1]
    ?? COMMERCIAL_SEARCH_PROVINCES.find((province) => normalized.includes(province.name))?.code
    ?? "";
}

function formatDate(value: string, locale: PublicInformationLocale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : locale === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(localeTag, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function visibleComposition(result: CommercialStoreSearchResponse | null, otherLabel: string) {
  if (!result) return [];
  const main = result.composition.items.slice(0, 5);
  const remaining = result.composition.items.slice(5);
  if (!remaining.length) return main;
  const count = remaining.reduce((sum, item) => sum + item.count, 0);
  const sharePercent = remaining.reduce((sum, item) => sum + item.sharePercent, 0);
  return [...main, {
    code: null,
    name: otherLabel,
    count,
    sharePercent: Number(sharePercent.toFixed(1)),
  }];
}

function storeSearchText(item: CommercialStoreSearchItem) {
  return [
    item.name,
    item.branchName,
    item.industry.majorName,
    item.industry.middleName,
    item.industry.minorName,
    item.address.road,
    item.address.lot,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

export function CommercialStoreSearch({
  locale = "ko",
  preferredProvince = null,
}: {
  locale?: PublicInformationLocale;
  preferredProvince?: string | null;
}) {
  const t = copy[locale];
  const [mode, setMode] = useState<SearchMode>("stores");
  const [provinceCode, setProvinceCode] = useState(() => matchingProvinceCode(preferredProvince));
  const [industryCode, setIndustryCode] = useState("");
  const [industries, setIndustries] = useState<CommercialIndustryOption[]>([]);
  const [industryLoadState, setIndustryLoadState] = useState<IndustryLoadState>("loading");
  const [industryLoadError, setIndustryLoadError] = useState<string | null>(null);
  const [areaQuery, setAreaQuery] = useState("");
  const [areas, setAreas] = useState<CommercialAreaSearchResponse | null>(null);
  const [appliedAreaRequest, setAppliedAreaRequest] = useState<AppliedAreaRequest | null>(null);
  const [stores, setStores] = useState<CommercialStoreSearchResponse | null>(null);
  const [appliedStoreRequest, setAppliedStoreRequest] = useState<AppliedStoreRequest | null>(null);
  const [selectedArea, setSelectedArea] = useState<CommercialAreaSearchItem | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void requestJson({ kind: "industries" }, controller.signal)
      .then((payload) => {
        const result = payload as CommercialIndustrySearchResponse;
        if (result.kind !== "industries" || !Array.isArray(result.items)) {
          throw new Error("commercial_search_unavailable");
        }
        setIndustries(result.items);
        setIndustryLoadState("ready");
        setIndustryLoadError(null);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setIndustries([]);
        setIndustryCode("");
        setIndustryLoadState("error");
        setIndustryLoadError(cause instanceof Error ? cause.message : "");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => () => requestController.current?.abort(), []);

  const displayedStores = useMemo(() => {
    const normalized = storeFilter.trim().toLocaleLowerCase();
    return stores?.items.filter((item) => !normalized || storeSearchText(item).includes(normalized)) ?? [];
  }, [storeFilter, stores]);
  const selectedStore = displayedStores.find((item) => item.id === selectedStoreId)
    ?? null;
  const chartData = useMemo(() => visibleComposition(stores, t.other), [stores, t.other]);

  function beginRequest() {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError(null);
    return controller;
  }

  function cancelActiveRequest() {
    requestController.current?.abort();
    requestController.current = null;
    setLoading(false);
  }

  function clearStoreResults({ clearArea = false } = {}) {
    setStores(null);
    setAppliedStoreRequest(null);
    setSelectedStoreId(null);
    setStoreFilter("");
    if (clearArea) setSelectedArea(null);
  }

  function changeProvince(nextProvinceCode: string) {
    cancelActiveRequest();
    setProvinceCode(nextProvinceCode);
    setAreas(null);
    setAppliedAreaRequest(null);
    clearStoreResults({ clearArea: true });
    setError(null);
  }

  function changeIndustry(nextIndustryCode: string) {
    cancelActiveRequest();
    setIndustryCode(nextIndustryCode);
    clearStoreResults();
    setError(null);
  }

  function changeAreaQuery(nextQuery: string) {
    cancelActiveRequest();
    setAreaQuery(nextQuery);
    setAreas(null);
    setAppliedAreaRequest(null);
    setError(null);
  }

  function switchMode(nextMode: SearchMode) {
    cancelActiveRequest();
    setMode(nextMode);
    setError(null);
  }

  function changeStoreFilter(nextFilter: string) {
    setStoreFilter(nextFilter);
    const normalized = nextFilter.trim().toLocaleLowerCase();
    const nextItems = stores?.items.filter((item) =>
      !normalized || storeSearchText(item).includes(normalized)) ?? [];
    setSelectedStoreId((current) =>
      nextItems.some((item) => item.id === current) ? current : nextItems[0]?.id ?? null);
  }

  async function loadAreas(request: AppliedAreaRequest, page = 1) {
    if (!request.provinceCode) {
      setError(t.provincePlaceholder);
      return;
    }
    const controller = beginRequest();
    setAreas(null);
    setAppliedAreaRequest(null);
    const params = {
      kind: "areas",
      provinceCode: request.provinceCode,
      query: request.query,
      page,
      pageSize: 20,
    };
    try {
      const payload = await requestJson(params, controller.signal);
      const result = payload as CommercialAreaSearchResponse;
      if (result.kind !== "areas" || !Array.isArray(result.items)) throw new Error("commercial_search_unavailable");
      if (requestController.current !== controller) return;
      setAreas(result);
      setAppliedAreaRequest(request);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (requestController.current === controller) {
        setError(errorMessage(cause instanceof Error ? cause.message : "", locale));
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setLoading(false);
      }
    }
  }

  async function loadStores(request: AppliedStoreRequest, page = 1) {
    if (!request.area && !request.provinceCode) {
      setError(t.provincePlaceholder);
      return;
    }
    const controller = beginRequest();
    clearStoreResults();
    setSelectedArea(request.area);
    const params: Record<string, string | number> = {
      kind: "stores",
      provinceCode: request.provinceCode,
      page,
      pageSize: 24,
    };
    if (request.area) {
      params.areaCode = request.area.areaCode;
    }
    if (request.industryCode) {
      params.industryCode = request.industryCode;
    }
    try {
      const payload = await requestJson(params, controller.signal);
      const result = payload as CommercialStoreSearchResponse;
      if (result.kind !== "stores" || !Array.isArray(result.items)) throw new Error("commercial_search_unavailable");
      if (requestController.current !== controller) return;
      setStores(result);
      setAppliedStoreRequest(request);
      setSelectedArea(request.area);
      setSelectedStoreId(result.items[0]?.id ?? null);
      setStoreFilter("");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (requestController.current === controller) {
        setError(errorMessage(cause instanceof Error ? cause.message : "", locale));
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null;
        setLoading(false);
      }
    }
  }

  function submitStores(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadStores({
      area: selectedArea,
      provinceCode: selectedArea?.provinceCode || provinceCode,
      industryCode,
    });
  }

  function submitAreas(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadAreas({ provinceCode, query: areaQuery.trim() });
  }

  function selectArea(area: CommercialAreaSearchItem) {
    const nextProvinceCode = area.provinceCode || provinceCode;
    switchMode("stores");
    setProvinceCode(nextProvinceCode);
    void loadStores({
      area,
      provinceCode: nextProvinceCode,
      industryCode,
    });
  }

  return <section className={styles.shell} aria-labelledby="commercial-store-search-title">
    <header className={styles.hero}>
      <div>
        <small>{t.eyebrow}</small>
        <h3 id="commercial-store-search-title">{t.title}</h3>
        <p>{t.lead}</p>
      </div>
      <a href={COMMERCIAL_SEARCH_SOURCE_URL} target="_blank" rel="noreferrer">
        {t.source}<ExternalLink size={14} />
      </a>
    </header>

    <div className={styles.limitNotice}>
      <Store size={20} aria-hidden="true" />
      <p>{t.limitation}</p>
    </div>

    <div className={styles.modeTabs} role="group" aria-label={t.title}>
      <button type="button" aria-pressed={mode === "stores"} onClick={() => switchMode("stores")}>
        <Building2 size={17} />{t.storesTab}
      </button>
      <button type="button" aria-pressed={mode === "areas"} onClick={() => switchMode("areas")}>
        <MapPinned size={17} />{t.areasTab}
      </button>
    </div>

    {mode === "stores" ? <form className={styles.searchForm} role="search" onSubmit={submitStores}>
      <label>
        <span>{t.province}</span>
        <select value={provinceCode} onChange={(event) => changeProvince(event.target.value)}>
          <option value="">{t.provincePlaceholder}</option>
          {COMMERCIAL_SEARCH_PROVINCES.map((province) => <option key={province.code} value={province.code}>{province.name}</option>)}
        </select>
      </label>
      <label>
        <span>{t.industry}</span>
        <select
          value={industryCode}
          disabled={industryLoadState !== "ready"}
          aria-busy={industryLoadState === "loading"}
          onChange={(event) => changeIndustry(event.target.value)}
          aria-describedby="commercial-industry-status"
        >
          <option value="">
            {industryLoadState === "loading"
              ? t.industryLoading
              : t.allIndustries}
          </option>
          {industries.map((industry) => <option key={industry.code} value={industry.code}>{industry.name}</option>)}
        </select>
        <small
          id="commercial-industry-status"
          className={styles.fieldHint}
          data-state={industryLoadState}
          role={industryLoadState === "error" ? "status" : undefined}
        >
          {industryLoadState === "loading"
            ? t.industryLoading
            : industryLoadState === "error"
              ? `${t.industryUnavailable}${industryLoadError
                && errorMessage(industryLoadError, locale) !== t.unavailable
                ? ` ${errorMessage(industryLoadError, locale)}`
                : ""}`
              : t.allIndustries}
        </small>
      </label>
      <button type="submit" disabled={loading}><Search size={17} />{t.searchStores}</button>
    </form> : <form className={styles.searchForm} role="search" onSubmit={submitAreas}>
      <label>
        <span>{t.province}</span>
        <select value={provinceCode} onChange={(event) => changeProvince(event.target.value)}>
          <option value="">{t.provincePlaceholder}</option>
          {COMMERCIAL_SEARCH_PROVINCES.map((province) => <option key={province.code} value={province.code}>{province.name}</option>)}
        </select>
      </label>
      <label>
        <span>{t.areaKeyword}</span>
        <input value={areaQuery} onChange={(event) => changeAreaQuery(event.target.value)} placeholder={t.areaPlaceholder} maxLength={80} />
      </label>
      <button type="submit" disabled={loading}><Search size={17} />{t.searchAreas}</button>
    </form>}

    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading && <p className={styles.loading} aria-live="polite">{t.loading}</p>}

    {mode === "areas" && areas && <div className={styles.areaResults}>
      <div className={styles.resultHeader}>
        <div><strong>{t.providerTotal}</strong><span>{areas.total.toLocaleString()} {t.areasUnit}</span></div>
        <small>{areas.meta.cached ? t.cached : t.live} · {formatDate(areas.meta.fetchedAt, locale)}</small>
      </div>
      {areas.meta.partial && <p className={styles.partial}>{t.partial}</p>}
      <p className={styles.scopeNote}>{t.areaLimit}</p>
      {areas.items.length ? <ul>
        {areas.items.map((area) => <li key={area.id}>
          <div>
            <strong>{area.name}</strong>
            <span>{[area.province, area.district].filter(Boolean).join(" ")}</span>
            <small>
              {area.areaSquareMeters ? `${Math.round(area.areaSquareMeters).toLocaleString()}㎡` : ""}
              {area.referenceDate ? ` · ${area.referenceDate}` : ""}
            </small>
          </div>
          <button type="button" onClick={() => selectArea(area)}>{t.useArea}<ChevronRight size={15} /></button>
        </li>)}
      </ul> : <p className={styles.empty}>{t.noAreas}</p>}
      <div className={styles.pagination}>
        <button type="button" disabled={loading || !appliedAreaRequest || areas.page <= 1} onClick={() => {
          if (appliedAreaRequest) void loadAreas(appliedAreaRequest, areas.page - 1);
        }}><ChevronLeft size={16} />{t.previous}</button>
        <span>{t.page} {areas.page}</span>
        <button type="button" disabled={loading || !appliedAreaRequest || !areas.hasMore} onClick={() => {
          if (appliedAreaRequest) void loadAreas(appliedAreaRequest, areas.page + 1);
        }}>{t.next}<ChevronRight size={16} /></button>
      </div>
    </div>}

    {mode === "stores" && selectedArea && <div className={styles.activeScope}>
      <MapPinned size={17} />
      <span>{t.activeArea}: <strong>{selectedArea.name}</strong></span>
      <button type="button" onClick={() => {
        cancelActiveRequest();
        clearStoreResults({ clearArea: true });
        setError(null);
      }}>{t.clearArea}</button>
    </div>}

    {mode === "stores" && stores && <div className={styles.storeWorkspace} aria-busy={loading}>
      <div className={styles.storeListPanel}>
        <div className={styles.resultHeader}>
          <div><strong>{t.providerTotal}</strong><span>{stores.providerTotalCount.toLocaleString()} {t.storesUnit}</span></div>
          <small>{stores.meta.cached ? t.cached : t.live} · {formatDate(stores.meta.fetchedAt, locale)}</small>
        </div>
        {stores.meta.partial && <p className={styles.partial}>{t.storePartial}</p>}
        <label className={styles.localFilter}>
          <span>{t.filterCurrent}</span>
          <div><Search size={16} /><input type="search" value={storeFilter} onChange={(event) => changeStoreFilter(event.target.value)} placeholder={t.filterPlaceholder} /></div>
        </label>
        {displayedStores.length ? <ul className={styles.storeList}>
          {displayedStores.map((store) => <li key={store.id}>
            <button type="button" aria-pressed={selectedStoreId === store.id} onClick={() => setSelectedStoreId(store.id)}>
              <span className={styles.storeIcon}><Store size={17} /></span>
              <span>
                <strong>{store.name}{store.branchName ? ` · ${store.branchName}` : ""}</strong>
                <em>{[store.industry.majorName, store.industry.middleName, store.industry.minorName].filter(Boolean).join(" › ") || t.official}</em>
                <small>{store.address.road || store.address.lot || "-"}</small>
              </span>
            </button>
          </li>)}
        </ul> : <p className={styles.empty}>{t.noStores}</p>}
        <div className={styles.pagination}>
          <button type="button" disabled={loading || !appliedStoreRequest || stores.page <= 1} onClick={() => {
            if (appliedStoreRequest) void loadStores(appliedStoreRequest, stores.page - 1);
          }}><ChevronLeft size={16} />{t.previous}</button>
          <span>{t.page} {stores.page}</span>
          <button type="button" disabled={loading || !appliedStoreRequest || !stores.hasMore} onClick={() => {
            if (appliedStoreRequest) void loadStores(appliedStoreRequest, stores.page + 1);
          }}>{t.next}<ChevronRight size={16} /></button>
        </div>
      </div>

      <aside className={styles.insights}>
        <section className={styles.chartCard}>
          <header><div><small>{t.pageBasis}</small><h4>{t.composition}</h4><p>{t.compositionLead}</p></div><strong>{stores.composition.total}</strong></header>
          {chartData.length ? <div className={styles.chartWrap}>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={chartData} dataKey="count" nameKey="name" innerRadius={52} outerRadius={83} paddingAngle={2}>
                  {chartData.map((entry, index) => <Cell key={`${entry.code ?? "other"}-${entry.name}`} fill={colors[index % colors.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => [`${Number(value).toLocaleString()} ${t.storesUnit}`, t.composition]} />
              </PieChart>
            </ResponsiveContainer>
            <ul>{chartData.map((entry, index) => <li key={`${entry.code ?? "other"}-${entry.name}`}><i style={{ background: colors[index % colors.length] }} /><span>{entry.name}</span><strong>{entry.count} · {entry.sharePercent}%</strong></li>)}</ul>
          </div> : <p className={styles.empty}>{t.noStores}</p>}
        </section>

        <section className={styles.detailCard}>
          {!selectedStore ? <p className={styles.empty}>{t.selectStore}</p> : <>
            <header><span><LocateFixed size={18} /></span><div><small>{t.official}</small><h4>{selectedStore.name}</h4></div></header>
            <dl>
              <div><dt>{t.road}</dt><dd>{selectedStore.address.road || "-"}</dd></div>
              <div><dt>{t.lot}</dt><dd>{selectedStore.address.lot || "-"}</dd></div>
              <div><dt>{t.coordinate}</dt><dd>{selectedStore.location ? `${selectedStore.location.latitude.toFixed(5)}, ${selectedStore.location.longitude.toFixed(5)}` : "-"}</dd></div>
            </dl>
            {selectedStore.location && <iframe
              title={`${selectedStore.name} ${t.map}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-popups"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${selectedStore.location.longitude - 0.008},${selectedStore.location.latitude - 0.005},${selectedStore.location.longitude + 0.008},${selectedStore.location.latitude + 0.005}&layer=mapnik&marker=${selectedStore.location.latitude},${selectedStore.location.longitude}`}
            />}
            <div className={styles.detailLinks}>
              {selectedStore.location && <a href={`https://www.openstreetmap.org/?mlat=${selectedStore.location.latitude}&mlon=${selectedStore.location.longitude}#map=17/${selectedStore.location.latitude}/${selectedStore.location.longitude}`} target="_blank" rel="noreferrer">{t.map}<ExternalLink size={13} /></a>}
              <a href={stores.meta.sourceUrl} target="_blank" rel="noreferrer">{t.source}<ExternalLink size={13} /></a>
            </div>
          </>}
        </section>
      </aside>
    </div>}
  </section>;
}
