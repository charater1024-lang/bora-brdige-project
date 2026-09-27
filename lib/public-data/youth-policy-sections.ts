import type {
  PublicDataDashboard,
  PublicInformationItem,
} from "./types";
import type { YouthPolicyRegion } from "@/lib/auth/youth-policy-profile";
import { publicItemRecency } from "./dates";

export const YOUTH_POLICY_SECTION_IDS = [
  "scholarship",
  "financial_support",
  "employment",
  "policy_news",
] as const;

export type YouthPolicySectionId = (typeof YOUTH_POLICY_SECTION_IDS)[number];

export type YouthOfficialResourceAccess =
  | "configured-public-api"
  | "api-ready"
  | "enterprise-api-only"
  | "external-directory";

export type YouthOfficialResourceDetail =
  | "work24-recruitment"
  | "work24-job-events"
  | "work24-training"
  | "work24-career-support"
  | "work24-government-jobs"
  | "work24-wage-arrears";

export interface YouthOfficialResource {
  id: string;
  section: YouthPolicySectionId;
  name: string;
  url: string;
  access: YouthOfficialResourceAccess;
  provider: string;
  detail?: YouthOfficialResourceDetail;
}

export interface YouthPolicySection {
  id: YouthPolicySectionId;
  items: PublicInformationItem[];
  count: number;
  resources: YouthOfficialResource[];
}

export type YouthPolicyRegionSelection =
  | { mode: "all" }
  | { mode: "nationwide" }
  | {
    mode: "region";
    region: YouthPolicyRegion;
    includeNationwide: boolean;
  };

const ALL_REGIONS: YouthPolicyRegionSelection = { mode: "all" };

/**
 * These are navigation/integration records, not copied listings. JobKorea and
 * Incruit stay external-only until an API agreement and its display terms are
 * explicitly confirmed. No page scraping or third-party branding is used.
 */
export const YOUTH_OFFICIAL_RESOURCES: readonly YouthOfficialResource[] = [
  {
    id: "kosaf",
    section: "scholarship",
    name: "한국장학재단",
    url: "https://www.kosaf.go.kr/ko/main.do",
    access: "configured-public-api",
    provider: "한국장학재단",
  },
  {
    id: "kinfa-youth-finance",
    section: "financial_support",
    name: "서민금융진흥원 청년 금융지원",
    url: "https://www.kinfa.or.kr/fill4young/financeCommercial/youthLongAsset.do",
    access: "external-directory",
    provider: "서민금융진흥원",
  },
  {
    id: "work24-recruitment",
    section: "employment",
    name: "고용24 채용정보",
    url: "https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchList.do",
    access: "external-directory",
    provider: "고용노동부·한국고용정보원",
    detail: "work24-recruitment",
  },
  {
    id: "work24-job-events",
    section: "employment",
    name: "고용24 채용행사·박람회",
    url: "https://www.work24.go.kr/cm/main.do?searchGubun=1",
    access: "external-directory",
    provider: "고용노동부·한국고용정보원",
    detail: "work24-job-events",
  },
  {
    id: "work24-training-card",
    section: "employment",
    name: "고용24 국민내일배움카드",
    url: "https://www.work24.go.kr/hr/h/a/1100/selectIssuGudn.do",
    access: "external-directory",
    provider: "고용노동부·한국고용정보원",
    detail: "work24-training",
  },
  {
    id: "work24-career-support",
    section: "employment",
    name: "고용24 취업지원·직업정보",
    url: "https://www.work24.go.kr/cm/main.do?subNaviMenuCd=50300",
    access: "external-directory",
    provider: "고용노동부·한국고용정보원",
    detail: "work24-career-support",
  },
  {
    id: "work24-government-jobs-api",
    section: "employment",
    name: "고용24 정부지원일자리 API 범위",
    url: "https://www.work24.go.kr/cm/e/a/0110/selectOpenApiSvcInfo.do?apiSvcId=000000000000000000000000000047&fullApiSvcId=000000000000000000000000000045%5E000000000000000000000000000047&upprApiSvcId=000000000000000000000000000045",
    access: "enterprise-api-only",
    provider: "고용노동부·한국고용정보원",
    detail: "work24-government-jobs",
  },
  {
    id: "work24-wage-arrears-api",
    section: "employment",
    name: "고용24 임금체불 사업주 확인 API 범위",
    url: "https://www.work24.go.kr/cm/e/a/0110/selectOpenApiSvcInfo.do?fullApiSvcId=000000000000000000000000000100%5E000000000000000000000000000104",
    access: "enterprise-api-only",
    provider: "고용노동부·한국고용정보원",
    detail: "work24-wage-arrears",
  },
  {
    id: "kosis-youth-employment",
    section: "employment",
    name: "KOSIS 청년 고용통계",
    url: "https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_1DE9046S&conn_path=I2",
    access: "configured-public-api",
    provider: "통계청 국가통계포털",
  },
  {
    id: "jobkorea-recruitment",
    section: "employment",
    name: "잡코리아 채용정보",
    url: "https://www.jobkorea.co.kr/",
    access: "external-directory",
    provider: "잡코리아",
  },
  {
    id: "incruit-recruitment",
    section: "employment",
    name: "인크루트 채용정보",
    url: "https://www.incruit.com/",
    access: "external-directory",
    provider: "인크루트",
  },
  {
    id: "youth-center-policy-news",
    section: "policy_news",
    name: "온통청년 정책·청년소식",
    url: "https://www.youthcenter.go.kr/",
    access: "configured-public-api",
    provider: "국무조정실 청년정책조정실·한국고용정보원",
  },
  {
    id: "moel-policy-materials",
    section: "policy_news",
    name: "고용노동부 정책자료 RSS",
    url: "https://www.moel.go.kr/site/rss/rssList.do",
    access: "external-directory",
    provider: "고용노동부",
  },
  {
    id: "moel-press-releases",
    section: "policy_news",
    name: "고용노동부 보도자료",
    url: "https://www.moel.go.kr/news/enews/report/enewsList.do",
    access: "external-directory",
    provider: "고용노동부",
  },
] as const;

const SECTION_TAGS: Record<YouthPolicySectionId, string> = {
  scholarship: "section:scholarship",
  financial_support: "section:financial-support",
  employment: "section:employment",
  policy_news: "section:policy-news",
};

function explicitlyTaggedSection(item: PublicInformationItem) {
  return YOUTH_POLICY_SECTION_IDS.find((section) => item.tags.includes(SECTION_TAGS[section])) ?? null;
}

/**
 * Classify with adapter-provided structure only. Free-form titles and summaries
 * are intentionally ignored so a suggestive phrase cannot change the section.
 */
export function youthPolicySectionForItem(item: PublicInformationItem): YouthPolicySectionId {
  const explicit = explicitlyTaggedSection(item);
  if (explicit) return explicit;
  if (item.id.startsWith("kosaf-")) return "scholarship";
  if (item.id.startsWith("loan-")) return "financial_support";
  if (item.id.startsWith("work24-")) return "employment";
  if (item.id.startsWith("youth-policy-news-") || item.id.startsWith("moel-news-")) {
    return "policy_news";
  }

  const interests = item.youthPolicyEligibility?.interests ?? [];
  if (interests.includes("employment")) return "employment";
  if (interests.includes("education")) return "scholarship";
  if (interests.some((interest) => [
    "asset_building",
    "finance",
    "housing",
    "welfare",
  ].includes(interest))) return "financial_support";
  return "policy_news";
}

export function youthPolicyRegionScope(
  item: PublicInformationItem,
): "nationwide" | "regional" | "unknown" {
  const structuredScope = item.youthPolicyEligibility?.regionScope;
  if (structuredScope) return structuredScope;
  if (item.youthPolicyEligibility?.regions?.length) return "regional";
  if (
    item.id.startsWith("kosaf-")
    || item.id.startsWith("loan-")
    || item.id.startsWith("moel-news-")
    || item.id.startsWith("moel-report-")
    || item.id.startsWith("youth-policy-news-")
  ) return "nationwide";
  return "unknown";
}

export function youthPolicyMatchesRegionSelection(
  item: PublicInformationItem,
  selection: YouthPolicyRegionSelection,
) {
  if (selection.mode === "all") return true;
  const scope = youthPolicyRegionScope(item);
  if (selection.mode === "nationwide") return scope === "nationwide";
  if (scope === "nationwide") return selection.includeNationwide;
  return scope === "regional"
    && Boolean(item.youthPolicyEligibility?.regions?.includes(selection.region));
}

function itemTimestamp(item: PublicInformationItem) {
  return publicItemRecency(item);
}

function orderedItems(items: readonly PublicInformationItem[]) {
  return [...items].sort((left, right) =>
    (right.youthPolicyMatch?.fitScore ?? 0) - (left.youthPolicyMatch?.fitScore ?? 0)
    || itemTimestamp(right) - itemTimestamp(left)
    || left.title.localeCompare(right.title, "ko"));
}

function emptySections(): YouthPolicySection[] {
  return YOUTH_POLICY_SECTION_IDS.map((id) => ({
    id,
    items: [],
    count: 0,
    resources: YOUTH_OFFICIAL_RESOURCES.filter((resource) => resource.section === id),
  }));
}

function groupedYouthPolicySections(
  items: readonly PublicInformationItem[],
  regionSelection: YouthPolicyRegionSelection = ALL_REGIONS,
): YouthPolicySection[] {
  const grouped = new Map<YouthPolicySectionId, PublicInformationItem[]>(
    YOUTH_POLICY_SECTION_IDS.map((id) => [id, []]),
  );
  for (const item of items) {
    if (!youthPolicyMatchesRegionSelection(item, regionSelection)) continue;
    grouped.get(youthPolicySectionForItem(item))?.push(item);
  }
  return YOUTH_POLICY_SECTION_IDS.map((id) => {
    const sectionItems = orderedItems(grouped.get(id) ?? []);
    return {
      id,
      items: sectionItems,
      count: sectionItems.length,
      resources: YOUTH_OFFICIAL_RESOURCES.filter((resource) => resource.section === id),
    };
  });
}

/**
 * Accept only the already personalized dashboard returned by
 * `publicDashboardForViewer`. A raw shared snapshot has no personalization
 * summary and therefore yields zero policy items instead of leaking an
 * indiscriminate list.
 */
export function personalizedYouthPolicySections(
  dashboard: Pick<PublicDataDashboard, "categories" | "youthPolicyPersonalization">,
  regionSelection: YouthPolicyRegionSelection = ALL_REGIONS,
): YouthPolicySection[] {
  const status = dashboard.youthPolicyPersonalization?.status;
  if (status !== "ready" && status !== "profile_incomplete") return emptySections();
  const youthItems = dashboard.categories
    .find((category) => category.id === "youth")
    ?.items.filter((item) => item.category === "youth") ?? [];
  return groupedYouthPolicySections(youthItems, regionSelection);
}

/**
 * Group the complete list returned by the authenticated `view=all` endpoint.
 * This helper is presentation-only; the server route remains the authorization
 * boundary and never sends this list to an anonymous viewer.
 */
export function allYouthPolicySections(
  dashboard: Pick<PublicDataDashboard, "categories">,
  regionSelection: YouthPolicyRegionSelection = ALL_REGIONS,
): YouthPolicySection[] {
  const youthItems = dashboard.categories
    .find((category) => category.id === "youth")
    ?.items.filter((item) => item.category === "youth") ?? [];
  return groupedYouthPolicySections(youthItems, regionSelection);
}
