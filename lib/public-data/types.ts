import type {
  YouthPolicyInterest,
  YouthPolicyRegion,
  YouthPolicyStatus,
} from "@/lib/auth/youth-policy-profile";

export type PublicInformationCategory = "youth" | "finance" | "startup" | "employment";

export type YouthPolicyProfileField = "birthYear" | "region" | "status" | "interests";

export interface PublicYouthPolicyEligibility {
  minAge?: number;
  maxAge?: number;
  /** Official geographic scope. Unknown is kept distinct from nationwide. */
  regionScope?: "nationwide" | "regional" | "unknown";
  regions?: YouthPolicyRegion[];
  statuses?: YouthPolicyStatus[];
  interests?: YouthPolicyInterest[];
}

export interface PublicYouthPolicyMatch {
  fitScore: number;
  matchedFields: YouthPolicyProfileField[];
  /** Conditions that overlap the coarse profile and need an official date-level check. */
  officialConfirmationFields?: YouthPolicyProfileField[];
  /** A shortlist is still not a final eligibility decision. */
  requiresOfficialConfirmation: true;
}

export type StartupRecommendationSignal =
  | "preferred_region"
  | "nationwide"
  | "startup_interest"
  | "prospective_founder"
  | "active_business"
  | "youth_focus"
  | "recent_notice";

export interface PublicStartupAnnouncementMatch {
  /** Position within this viewer's privacy-safe shortlist, not a probability. */
  rank: number;
  signals: StartupRecommendationSignal[];
  requiresOfficialConfirmation: true;
}

export interface StartupAnnouncementPersonalizationSummary {
  status:
    | "sign_in_required"
    | "personalization_disabled"
    | "profile_incomplete"
    | "ready"
    | "no_matches";
  sourceCount: number;
  recommendedCount: number;
  missingProfileFields: YouthPolicyProfileField[];
  profilePath: "/mypage";
  methodology: "privacy-safe-hybrid";
}

export interface YouthPolicyPersonalizationSummary {
  status:
    | "sign_in_required"
    | "personalization_disabled"
    | "profile_incomplete"
    | "ready"
    | "no_matches";
  sourceCount: number;
  recommendedCount: number;
  hiddenCount: number;
  excludedCount: number;
  missingInformationCount: number;
  unassessedCount: number;
  missingProfileFields: YouthPolicyProfileField[];
  profilePath: "/mypage";
  methodology: "structured-criteria-only";
}

export type PublicSourceStatus =
  | "live"
  | "partial"
  | "truncated"
  | "not-configured"
  | "authorization-pending"
  | "unavailable";

export type PublicCollectionCompleteness = "complete" | "partial" | "truncated";

export type PublicDataFreshnessFilter =
  | "active"
  | "recent-7d"
  | "recent-30d"
  | "expired"
  | "review-needed"
  | "all";

export interface PublicInformationLocation {
  label: string;
  roadAddress?: string;
  province?: string;
  city?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
  precision: "point" | "road-address" | "administrative";
}

export interface PublicCommercialAreaAnalytics {
  /** Official Seoul commercial-area code (`TRDAR_CD`). */
  officialCode: string;
  /** Official reference quarter in `YYYYQ` form, for example `20261`. */
  referenceQuarter: string;
  areaType: string | null;
  /** Sum of the official estimated-sales rows for the commercial area. */
  estimatedTotalSales: number | null;
  industrySalesComposition: Array<{
    name: string;
    sharePercent: number;
    /** The sales dataset does not provide a compatible store count. */
    storeCount: null;
  }>;
  salesByHour: Array<{ hour: number; amount: number }>;
  footfallByHour: Array<{ hour: number; people: number }>;
  /** Public HTTPS dataset page; the server-only API key is never stored here. */
  sourceUrl: string;
}

export interface PublicCommercialArea {
  /** Official `trarArea` value, expressed in square metres. */
  areaSquareMeters: number | null;
  /** Official `stdrDt` reference date. */
  referenceDate: string | null;
  /** Official `coordNum` polygon-coordinate count. */
  coordinateCount: number | null;
  /**
   * Compact WGS84 rendering boundary derived from the official `coords` field.
   * It may be point-sampled for snapshot size and is not a surveying geometry.
   */
  displayBoundary?: {
    points: Array<[longitude: number, latitude: number]>;
    simplified: boolean;
    /** Public dataset page for this boundary geometry, when distinct from the item source. */
    sourceUrl?: string;
    /** Publication/update date of the boundary asset. */
    referenceDate?: string;
  };
  /** Normalized Seoul commercial analytics joined by the exact official code. */
  analytics?: PublicCommercialAreaAnalytics;
}

export interface PublicFinancialProductTerm {
  termMonths: number | null;
  baseRate: number | null;
  maximumRate: number | null;
  rateType: string | null;
}

export interface PublicFinancialProduct {
  kind: "deposit" | "saving";
  provider: string;
  productName: string;
  productCode: string;
  joinMethods: string[];
  eligibility: string | null;
  specialConditions: string | null;
  terms: PublicFinancialProductTerm[];
}

export type PublicEmploymentGroup = "youth" | "older-adult" | "foreigner";

export interface PublicEmploymentStatistic {
  group: PublicEmploymentGroup;
  groupLabel: string;
  /** Official KOSIS reference period, such as `2026.06` or `2025`. */
  period: string;
  metrics: Array<{
    name: string;
    value: number;
    unit: string;
  }>;
  /** Official KOSIS statistical table identifier. */
  tableId: string;
}

export interface PublicInformationItem {
  id: string;
  category: PublicInformationCategory;
  title: string;
  summary: string;
  source: string;
  sourceUrl: string;
  /** Whether the URL opens this exact record or the provider's dataset page. */
  sourceLinkKind?: "detail" | "dataset";
  publishedAt: string | null;
  /** Explicit upstream modification date, never relabelled as publication. */
  sourceUpdatedAt?: string | null;
  /** Date-only provenance; no upstream records, credentials or personal data. */
  sourceDateMetadata?: {
    version: 1;
    publishedAtField?: "FRST_REG_DT" | "frstRgstDt" | "legacy";
    sourceUpdatedAtField?: "LAST_MDFCN_DT" | "lastUpdtDt" | "lastCntcUpdtDt";
    rawPublishedAt?: string;
    rawSourceUpdatedAt?: string;
    rawPortalDate?: string;
    publishedAtStatus?: "valid" | "legacy-unverified" | "invalid" | "future" | "missing";
    sourceUpdatedAtStatus?: "valid" | "invalid" | "future" | "missing";
    rejectedAnchors?: { discoveredAt?: string; lastVerifiedAt?: string };
  };
  discoveredAt: string;
  /** Explicit provider deadline, when the upstream source supplies one. */
  expiresAt?: string | null;
  /** Explicit application opening date; absence never implies applications are open. */
  applicationStartsAt?: string | null;
  /** Last time this exact item was returned by its upstream source. */
  lastVerifiedAt?: string;
  tags: string[];
  location?: PublicInformationLocation;
  commercialArea?: PublicCommercialArea;
  financialProduct?: PublicFinancialProduct;
  employmentStatistic?: PublicEmploymentStatistic;
  /** Machine-readable conditions copied from an official adapter. */
  youthPolicyEligibility?: PublicYouthPolicyEligibility;
  /** Added only to the authenticated viewer response, never to the shared cache. */
  youthPolicyMatch?: PublicYouthPolicyMatch;
  /** Added only to the authenticated viewer response, never to the shared cache. */
  startupMatch?: PublicStartupAnnouncementMatch;
}

export type PublicCommercialAnalyticsSupplementLocationRow = [
  labelIndex: number,
  provinceIndex: number | null,
  cityIndex: number | null,
  neighborhoodIndex: number | null,
  latitude: number | null,
  longitude: number | null,
  precisionIndex: number,
];

export type PublicCommercialAnalyticsSupplementRow = [
  idIndex: number,
  titleIndex: number,
  sourceIndex: number,
  sourceUrlIndex: number,
  publishedAtIndex: number | null,
  discoveredAtIndex: number,
  location: PublicCommercialAnalyticsSupplementLocationRow | null,
  areaSquareMeters: number | null,
  referenceDateIndex: number | null,
  officialCodeIndex: number,
  referenceQuarterIndex: number,
  areaTypeIndex: number | null,
  estimatedTotalSales: number | null,
  industrySalesComposition: Array<[nameIndex: number, sharePercent: number]>,
  salesByHour: Array<[hour: number, amount: number]>,
  footfallByHour: Array<[hour: number, people: number]>,
  analyticsSourceUrlIndex: number,
];

/**
 * Compact response-only representation of the complete Seoul analytics set.
 * It is expanded in the browser before entering the existing insight model;
 * the durable D1 catalogue remains self-describing and unchanged.
 */
export interface PublicCommercialAnalyticsSupplement {
  version: 1;
  dictionary: string[];
  rows: PublicCommercialAnalyticsSupplementRow[];
}

export interface PublicInformationGroup {
  id: PublicInformationCategory;
  items: PublicInformationItem[];
  /**
   * A bounded, non-paginated viewer projection used by category tools that
   * need a stable reference set. Supplemental records are still counted once
   * in `totalCount` and must not be rendered again as catalogue rows.
   */
  supplementalItems?: PublicInformationItem[];
  /** Dictionary/tuple wire projection used only for the large Seoul set. */
  commercialAnalyticsSupplement?: PublicCommercialAnalyticsSupplement;
  /** Facets are computed from the full filtered viewer catalogue before slicing. */
  youthFacets?: {
    sectionCounts: Record<
      "scholarship" | "financial_support" | "employment" | "policy_news",
      number
    >;
    /** Records in the selected section before any geographic filter. */
    allRegionCount: number;
    nationwideCount: number;
    regionCounts: Record<string, number>;
  };
  /** Announcement-only facets across all pages, after text/date filtering. */
  startupFacets?: {
    allRegionCount: number;
    nationwideCount: number;
    unknownRegionCount: number;
    /** Nationwide announcements are not counted again in individual regions. */
    regionCounts: Record<string, number>;
  };
  totalCount: number;
  newCount: number;
  /** Total number before response pagination. */
  filteredTotalCount?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  freshnessFilter?: PublicDataFreshnessFilter;
}

export interface ExchangeRate {
  currency: string;
  name: string;
  baseCurrency: "KRW";
  unit: 1;
  baseRate: number;
  quotedUnit: number;
  quotedRate: number;
  sourceUnit: string;
}

export interface MarketPoint {
  id: string;
  name: string;
  value: number;
  change: number;
  changeRate: number;
  asOf: string | null;
  sourceUrl: string;
}

export interface PublicSourceResult {
  id: string;
  label: string;
  status: PublicSourceStatus;
  itemCount: number;
  sourceUrl: string;
  errorCode?: string | null;
  /** Count advertised by the provider for the same request window, when supplied. */
  providerTotalCount?: number | null;
  /** Rows actually fetched before normalization and de-duplication. */
  fetchedCount?: number;
  completeness?: PublicCollectionCompleteness;
  /** Current collector health is separate from the saved generation's coverage. */
  collectionStatus?: "current" | "delayed" | "unavailable" | "disabled" | "unknown";
  lastCollectedAt?: string | null;
  lastCollectionAttemptAt?: string | null;
}

export interface PublicDataPayload {
  exchange: {
    source: string;
    sourceUrl: string;
    asOf: string | null;
    rates: ExchangeRate[];
  };
  market: MarketPoint[];
  categories: PublicInformationGroup[];
  sources: PublicSourceResult[];
}

export interface PublicDataDashboard extends PublicDataPayload {
  status: "empty" | "live" | "partial" | "stale";
  cached: boolean;
  stale: boolean;
  lastSuccessfulAt: string | null;
  nextRefreshAt: string | null;
  canRefresh: boolean;
  refreshInSeconds: number;
  authenticated: boolean;
  sourceSchedules: PublicSourceSchedule[];
  youthPolicyPersonalization?: YouthPolicyPersonalizationSummary;
  startupAnnouncementPersonalization?: StartupAnnouncementPersonalizationSummary;
  /** Opaque version of the public catalogue; never contains viewer data. */
  catalogVersion?: string;
}

/**
 * Durable progress for an upstream catalogue backfill. The latest-page refresh
 * remains independent: it may run on every normal source cadence while this
 * cursor advances through older pages over multiple protected runs.
 */
export interface PublicBackfillCheckpoint {
  sourceId: string;
  querySignature: string;
  queryState: string;
  nextPage: number;
  pageSize: number;
  providerTotalCount: number | null;
  fetchedCount: number;
  completed: boolean;
  latestRefreshAt: number | null;
  completedAt: number | null;
  updatedAt: number;
}

export interface PublicBackfillPageCommit {
  checkpoint: PublicBackfillCheckpoint;
  /** Page zero is reserved for the replaceable latest-data window. */
  pageNumber: number;
  items: PublicInformationItem[];
  /** A successful new first page restarts staging and cursor in one DB batch. */
  resetGeneration?: boolean;
  /** Youth Open API sections have independent page ranges and may restart alone. */
  resetSection?: number;
}

export interface PublicBackfillRuntime {
  checkpoint: PublicBackfillCheckpoint | null;
  stagedItems: readonly PublicInformationItem[];
  maxBackfillPagesPerRun: number;
  commitPage: (input: PublicBackfillPageCommit) => Promise<void>;
  /** Read the committed page generation after section resets, never a merged old view. */
  readCommittedItems?: (checkpoint: PublicBackfillCheckpoint) => Promise<PublicInformationItem[]>;
}

export interface PublicSourceSchedule {
  sourceId: string;
  /** Developer-only mapping to the API switch that controls this source. */
  serviceKey: string | null;
  nextDueAt: string | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  dailyLimit: number;
  usedCalls: number;
  reservedCalls: number;
  quotaVerified: boolean;
  quotaBasis: "official" | "user-confirmed" | "conservative-default";
  refreshInSeconds: number;
  canRefresh: boolean;
  lastError: string | null;
}

export const PUBLIC_CATEGORIES: PublicInformationCategory[] = [
  "youth",
  "finance",
  "startup",
  "employment",
];

/**
 * Publication-window filters are meaningful for notices, policies and news.
 * Point-in-time indicators instead keep their latest active observation.
 */
export const PUBLIC_TEMPORAL_FILTER_CATEGORIES: PublicInformationCategory[] = [
  "youth",
  "startup",
];

export function supportsPublicTemporalFilter(
  category: PublicInformationCategory,
) {
  return PUBLIC_TEMPORAL_FILTER_CATEGORIES.includes(category);
}

export function emptyPublicDataPayload(): PublicDataPayload {
  return {
    exchange: {
      source: "한국수출입은행 환율 API",
      sourceUrl: "https://www.koreaexim.go.kr/ir/HPHKIR020M01?apino=2&viewtype=C",
      asOf: null,
      rates: [],
    },
    market: [],
    categories: PUBLIC_CATEGORIES.map((id) => ({
      id,
      items: [],
      totalCount: 0,
      newCount: 0,
    })),
    sources: [],
  };
}
