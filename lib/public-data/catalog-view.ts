import { filterPublicInformationItems } from "./retention";
import { publicItemRecency } from "./dates";
import { normalizePublicInformationItemText } from "./text";
import { safePublicHttpUrl } from "./urls";
import {
  isStartupAnnouncementItem,
  startupAnnouncementRegionCounts,
  startupAnnouncementRegionScope,
} from "./startup-region-view";
import {
  YOUTH_POLICY_REGIONS,
  type YouthPolicyRegion,
} from "../auth/youth-policy-profile";
import {
  YOUTH_POLICY_SECTION_IDS,
  youthPolicyMatchesRegionSelection,
  youthPolicyRegionScope,
  youthPolicySectionForItem,
  type YouthPolicyRegionSelection,
  type YouthPolicySectionId,
} from "./youth-policy-sections";
import {
  supportsPublicTemporalFilter,
  type PublicDataDashboard,
  type PublicDataFreshnessFilter,
  type PublicInformationCategory,
  type PublicInformationItem,
  type PublicSourceResult,
} from "./types";

const BIZINFO_DATA_GO_PREFIX = "bizinfo-data-go-";
const BIZINFO_DIRECT_PREFIX = "bizinfo-";
/** Seoul currently publishes 1,650 analytics areas; keep a modest ceiling for response safety. */
export const STARTUP_SUPPLEMENTAL_COMMERCIAL_LIMIT = 1_800;
/** Finance currently retains roughly 400 Finlife/loan rows; keep search bounded. */
export const FINANCE_SUPPLEMENTAL_PRODUCT_LIMIT = 1_000;

/**
 * Per-viewer read state is request-local metadata. A symbol keeps it available
 * while server projections clone category groups, but JSON responses cannot
 * expose the viewer's last-read timestamp.
 */
export const PUBLIC_NEW_ITEM_CUTOFF = Symbol("public-new-item-cutoff");

type PublicNewItemScope = {
  [PUBLIC_NEW_ITEM_CUTOFF]?: number | null;
};

export function publicNewItemCutoff(value: object): number | null | undefined {
  return (value as PublicNewItemScope)[PUBLIC_NEW_ITEM_CUTOFF];
}

export function countPublicNewItems(
  items: readonly PublicInformationItem[],
  cutoff: number | null,
) {
  if (cutoff === null) return 0;
  return items.filter((item) => {
    const discoveredAt = Date.parse(item.discoveredAt);
    return Number.isFinite(discoveredAt) && discoveredAt > cutoff;
  }).length;
}

export function withPublicNewItemScope<
  Group extends { items: readonly PublicInformationItem[]; newCount: number },
>(group: Group, cutoff: number | null): Group & PublicNewItemScope {
  return {
    ...group,
    newCount: countPublicNewItems(group.items, cutoff),
    [PUBLIC_NEW_ITEM_CUTOFF]: cutoff,
  };
}

export function selectPublicCatalogSummaryCounts(
  preview: { totalCount: number; newCount: number },
  catalog: { totalCount: number; newCount: number } | null,
) {
  // The compact snapshot may temporarily be more complete while a provider is
  // migrating to chunk storage. Select both counters from one winning scope;
  // never combine a full total with a preview-only new count.
  return catalog && catalog.totalCount > preview.totalCount ? catalog : preview;
}

export type PublicYouthCatalogFilters = {
  section?: YouthPolicySectionId | null;
  region?: YouthPolicyRegion | "nationwide" | null;
  includeNationwide?: boolean;
  /** Bounded full-catalogue search, currently used for startup announcements. */
  query?: string;
  financeSection?: "products" | "indicators" | "market" | null;
};

function bizinfoOfficialId(item: PublicInformationItem) {
  if (item.id.startsWith(BIZINFO_DATA_GO_PREFIX)) {
    return item.id.slice(BIZINFO_DATA_GO_PREFIX.length) || null;
  }
  if (item.id.startsWith(BIZINFO_DIRECT_PREFIX)) {
    return item.id.slice(BIZINFO_DIRECT_PREFIX.length) || null;
  }
  return null;
}

const CATALOG_TRACKING_PARAMETER = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|ref|source)$/iu;

function normalizedCatalogText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR")
    .replace(/[^0-9a-z가-힣]+/giu, " ").trim();
}

/**
 * A detail URL is provider-issued identity evidence. Dataset/home URLs are not:
 * hundreds of unrelated announcements legitimately share those URLs.
 */
function canonicalStartupDetailUrl(item: PublicInformationItem) {
  if (item.sourceLinkKind !== "detail") return null;
  const safe = safePublicHttpUrl(item.sourceUrl);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./u, "");
    for (const key of [...url.searchParams.keys()]) {
      if (CATALOG_TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
    if (url.pathname === "/" && !url.search) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function catalogIdentityKeys(item: PublicInformationItem) {
  const keys: string[] = [];
  const officialId = bizinfoOfficialId(item);
  if (officialId) keys.push(`bizinfo:${officialId.toLocaleLowerCase("en-US")}`);
  if (item.category === "startup" && !item.commercialArea) {
    const detailUrl = canonicalStartupDetailUrl(item);
    if (detailUrl) keys.push(`startup-detail:${detailUrl}`);
    const expiresAt = item.expiresAt?.slice(0, 10);
    const title = normalizedCatalogText(item.title);
    const provider = normalizedCatalogText(item.source);
    if (provider.length >= 2 && expiresAt && /^\d{4}-\d{2}-\d{2}$/u.test(expiresAt) && title.length >= 8) {
      const scope = startupAnnouncementRegionScope(item);
      const regionKey = scope.kind === "regional" ? scope.regions.join(",") : scope.kind;
      // Same-provider catalogue replays can omit a stable record id. Source is
      // therefore part of the fallback identity: an equally named programme
      // from another agency remains a distinct announcement.
      keys.push(`startup-provider:${provider}:${title}:${expiresAt}:${regionKey}`);
    }
  }
  keys.push(`item:${item.id}`);
  return keys;
}

function preferredCatalogItem(
  current: PublicInformationItem,
  candidate: PublicInformationItem,
) {
  const currentDataGo = current.id.startsWith(BIZINFO_DATA_GO_PREFIX);
  const candidateDataGo = candidate.id.startsWith(BIZINFO_DATA_GO_PREFIX);
  if (currentDataGo !== candidateDataGo) return candidateDataGo ? candidate : current;
  const score = (item: PublicInformationItem) => (
    (item.sourceLinkKind === "detail" ? 1_000 : 0)
    + Math.min(500, item.summary.length)
    + Math.min(100, item.tags.length * 5)
  );
  const scoreDelta = score(candidate) - score(current);
  if (scoreDelta) return scoreDelta > 0 ? candidate : current;
  // Snapshot migration passes the refreshed catalogue after the compact
  // snapshot. When the exact local item id is present in both and richness is
  // otherwise equal, the later catalogue row is authoritative.
  if (candidate.id === current.id) return candidate;
  return candidate.id.localeCompare(current.id, "ko-KR") < 0 ? candidate : current;
}

/**
 * The direct 기업마당 feed and its data.go.kr mirror expose the same official
 * announcement identifiers with different local prefixes. Stable official
 * ids, canonical detail URLs, or a same-provider replay signature may merge;
 * title/date/region similarity alone never merges different institutions.
 */
export function deduplicatePublicCatalogItems(
  items: readonly PublicInformationItem[],
) {
  type IdentityGroup = { item: PublicInformationItem; keys: Set<string> };
  const activeGroups = new Set<IdentityGroup>();
  const groupByIdentity = new Map<string, IdentityGroup>();
  for (const rawItem of items) {
    const item = normalizePublicInformationItemText(rawItem);
    const keys = catalogIdentityKeys(item);
    const matchingGroups = [...new Set(keys
      .map((key) => groupByIdentity.get(key))
      .filter((group): group is IdentityGroup => Boolean(group)))];
    const target = matchingGroups[0] ?? { item, keys: new Set<string>() };
    if (!matchingGroups.length) activeGroups.add(target);
    for (const group of matchingGroups.slice(1)) {
      target.item = preferredCatalogItem(target.item, group.item);
      for (const key of group.keys) target.keys.add(key);
      activeGroups.delete(group);
    }
    target.item = preferredCatalogItem(target.item, item);
    for (const key of keys) target.keys.add(key);
    for (const key of target.keys) groupByIdentity.set(key, target);
  }
  return [...activeGroups].map((group) => group.item);
}

/**
 * A complete provider response can still exceed the deliberately bounded
 * server catalogue. Expose that storage boundary as truncated coverage rather
 * than claiming the entire provider catalogue is live.
 */
export function projectCatalogRetentionCoverage(
  source: PublicSourceResult,
  maximumItems: number,
  offeredItems?: number,
  retainedItems?: number,
): PublicSourceResult {
  const retentionDroppedItems = Number.isSafeInteger(offeredItems)
    && Number.isSafeInteger(retainedItems)
    && Number(offeredItems) > Number(retainedItems);
  // Provider totals describe upstream rows, which can contain historical
  // versions and can already be truncated by a paging limit. Only an observed
  // local offered→retained drop proves that server retention omitted records.
  if (!retentionDroppedItems) return source;
  if (source.status !== "live" && source.status !== "truncated") return source;
  return {
    ...source,
    status: "truncated",
    completeness: "truncated",
    errorCode: source.errorCode === "provider_page_window_limit_reached"
      ? "provider_page_window_and_catalog_retention_limit_reached"
      : source.errorCode ?? "catalog_retention_limit_reached",
  };
}

/**
 * A provider catalogue is populated only after that provider's first refresh
 * on the chunked-storage schema. Preserve valid compact-snapshot records until
 * every source has completed that migration cycle.
 */
export function mergeCatalogWithSnapshot(
  snapshotItems: readonly PublicInformationItem[],
  catalogItems: readonly PublicInformationItem[],
) {
  return deduplicatePublicCatalogItems([...snapshotItems, ...catalogItems]);
}

export function filterAndPaginatePublicDashboard(
  dashboard: PublicDataDashboard,
  category: PublicInformationCategory,
  freshnessFilter: PublicDataFreshnessFilter,
  page: number,
  pageSize: number,
  now = Date.now(),
  youthFilters: PublicYouthCatalogFilters = {},
  includeSupplemental = false,
) {
  const effectiveFilter = supportsPublicTemporalFilter(category)
    ? freshnessFilter
    : "active";
  const queryWords = (youthFilters.query ?? "").slice(0, 200).normalize("NFKC").toLocaleLowerCase()
    .trim().split(/\s+/u).filter(Boolean).slice(0, 8);
  return {
    ...dashboard,
    categories: dashboard.categories.map((group) => {
      if (group.id !== category) return group;
      const deduplicatedItems = deduplicatePublicCatalogItems(group.items);
      const viewerItems = category === "finance" && youthFilters.financeSection
        ? deduplicatedItems.filter((item) => {
          if (youthFilters.financeSection === "products") return isFinanceProduct(item);
          if (youthFilters.financeSection === "indicators") return item.id.startsWith("ecos-");
          return !isFinanceProduct(item) && !item.id.startsWith("ecos-");
        })
        : deduplicatedItems;
      const freshnessFiltered = filterPublicInformationItems(
        viewerItems,
        effectiveFilter,
        now,
      );
      // Seoul commercial analytics are a quarterly snapshot, not an
      // announcement. Keep the latest active snapshot available while the
      // user changes the independent 7/30-day announcement filter.
      const startupCommercialSnapshot = category === "startup" && includeSupplemental
        ? filterPublicInformationItems(viewerItems, "active", now)
          .filter((item) => Boolean(item.commercialArea?.analytics))
        : [];
      const primaryFreshnessFiltered = category === "startup"
        ? freshnessFiltered.filter((item) => (
          isStartupAnnouncementItem(item)
          && startupMatchesQuery(item, queryWords)
        ))
        : category === "finance" ? freshnessFiltered.filter((item) => startupMatchesQuery(item, queryWords))
          : freshnessFiltered;
      const youthSectionFiltered = category === "youth" && youthFilters.section
        ? primaryFreshnessFiltered.filter((item) => youthPolicySectionForItem(item) === youthFilters.section)
        : primaryFreshnessFiltered;
      const youthRegionSelection = category === "youth"
        ? youthRegionSelectionFromFilters(youthFilters)
        : { mode: "all" as const };
      const youthRegionFiltered = category === "youth"
        ? primaryFreshnessFiltered.filter((item) => youthPolicyMatchesRegionSelection(item, youthRegionSelection))
        : primaryFreshnessFiltered;
      const youthFacets = category === "youth"
        ? buildYouthFacets(youthSectionFiltered, youthRegionFiltered)
        : undefined;
      const startupFacets = category === "startup"
        ? buildStartupFacets(primaryFreshnessFiltered)
        : undefined;
      // Parse each timestamp once, not on every comparison of a large catalogue.
      const recency = new Map(primaryFreshnessFiltered.map((item) => [item, publicItemRecency(item, now)]));
      const filtered = (category === "youth"
        ? youthSectionFiltered.filter((item) => youthPolicyMatchesRegionSelection(item, youthRegionSelection))
        : category === "startup"
          ? primaryFreshnessFiltered.filter((item) => startupMatchesRegion(item, youthFilters))
        : primaryFreshnessFiltered)
        .sort((left, right) => compareCatalogItems(category, left, right, recency));
      const cutoff = publicNewItemCutoff(group);
      const offset = (page - 1) * pageSize;
      const items = filtered.slice(offset, offset + pageSize);
      const pageItemIds = new Set(items.map((item) => item.id));
      const supplementalItems = includeSupplemental && page === 1 && category === "startup"
        ? startupCommercialSnapshot
          .filter((item) => !pageItemIds.has(item.id))
          .sort(compareStartupCommercialAnalytics)
          .slice(0, STARTUP_SUPPLEMENTAL_COMMERCIAL_LIMIT)
        : includeSupplemental && page === 1 && category === "finance" && !youthFilters.financeSection
          ? filtered
            .filter((item) => isFinanceProduct(item) && !pageItemIds.has(item.id))
            .slice(0, FINANCE_SUPPLEMENTAL_PRODUCT_LIMIT)
          : undefined;
      return {
        ...group,
        items,
        ...(supplementalItems ? { supplementalItems } : {}),
        youthFacets,
        startupFacets,
        totalCount: viewerItems.length,
        // New means new within the same viewer-visible result scope. It is
        // intentionally stable across pages and follows date/region/search and
        // personalization filters instead of the unfiltered catalogue.
        newCount: cutoff === undefined
          ? Math.min(group.newCount, filtered.length)
          : countPublicNewItems(filtered, cutoff),
        filteredTotalCount: filtered.length,
        page,
        pageSize,
        hasMore: offset + items.length < filtered.length,
        freshnessFilter: effectiveFilter,
      };
    }),
  };
}

function isFinanceProduct(item: PublicInformationItem) {
  return item.id.startsWith("finlife-") || item.id.startsWith("loan-");
}

function startupMatchesQuery(item: PublicInformationItem, words: readonly string[]) {
  if (!words.length) return true;
  const text = [item.title, item.summary, item.source, ...item.tags]
    .join(" ").normalize("NFKC").toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

function startupMatchesRegion(item: PublicInformationItem, filters: PublicYouthCatalogFilters) {
  if (!filters.region) return true;
  const scope = startupAnnouncementRegionScope(item);
  if (filters.region === "nationwide") return scope.kind === "nationwide";
  if (scope.kind === "nationwide") return filters.includeNationwide === true;
  return scope.kind === "regional" && scope.regions.includes(filters.region);
}

function buildStartupFacets(items: readonly PublicInformationItem[]) {
  const counts = startupAnnouncementRegionCounts(items);
  return {
    allRegionCount: counts.total,
    nationwideCount: counts.nationwide,
    unknownRegionCount: counts.unknown,
    regionCounts: counts.regions,
  };
}

function youthRegionSelectionFromFilters(
  filters: PublicYouthCatalogFilters,
): YouthPolicyRegionSelection {
  if (filters.region === "nationwide") return { mode: "nationwide" };
  if (filters.region) {
    return {
      mode: "region",
      region: filters.region,
      includeNationwide: filters.includeNationwide ?? true,
    };
  }
  return { mode: "all" };
}

function buildYouthFacets(
  sectionFiltered: readonly PublicInformationItem[],
  regionFiltered: readonly PublicInformationItem[],
) {
  const sectionCounts = Object.fromEntries(YOUTH_POLICY_SECTION_IDS.map((section) => [
    section, 0,
  ])) as Record<YouthPolicySectionId, number>;
  // Section counts follow the region selection, but not the selected section.
  // Classify each row once instead of scanning the catalogue per section.
  for (const item of regionFiltered) {
    sectionCounts[youthPolicySectionForItem(item)] += 1;
  }
  const regionCounts = Object.fromEntries(YOUTH_POLICY_REGIONS.map((region) => [
    region, 0,
  ]));
  let nationwideCount = 0;
  // Region counts follow the section selection, but not the selected region.
  // Nationwide rows never inflate regional counts; repeated provider region
  // values still count only once, matching the former includes() projection.
  for (const item of sectionFiltered) {
    const scope = youthPolicyRegionScope(item);
    if (scope === "nationwide") {
      nationwideCount += 1;
    } else if (scope === "regional") {
      for (const region of new Set(item.youthPolicyEligibility?.regions ?? [])) {
        if (Object.prototype.hasOwnProperty.call(regionCounts, region)) regionCounts[region] += 1;
      }
    }
  }
  return {
    sectionCounts,
    allRegionCount: sectionFiltered.length,
    nationwideCount,
    regionCounts,
  };
}

function compareCatalogItems(
  category: PublicInformationCategory,
  left: PublicInformationItem,
  right: PublicInformationItem,
  recency: ReadonlyMap<PublicInformationItem, number>,
) {
  if (category === "youth") {
    const fitDelta = (right.youthPolicyMatch?.fitScore ?? 0) - (left.youthPolicyMatch?.fitScore ?? 0);
    if (fitDelta) return fitDelta;
  }
  if (category === "startup") {
    const priorityDelta = itemDisplayPriority(category, left) - itemDisplayPriority(category, right);
    if (priorityDelta) return priorityDelta;
    const leftRank = left.startupMatch?.rank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.startupMatch?.rank ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
  }
  return itemDisplayPriority(category, left) - itemDisplayPriority(category, right)
    || (recency.get(right) ?? 0) - (recency.get(left) ?? 0)
    || left.id.localeCompare(right.id, "ko-KR");
}

function compareStartupCommercialAnalytics(
  left: PublicInformationItem,
  right: PublicInformationItem,
) {
  const leftSales = left.commercialArea?.analytics?.estimatedTotalSales;
  const rightSales = right.commercialArea?.analytics?.estimatedTotalSales;
  const leftHasSales = typeof leftSales === "number" && Number.isFinite(leftSales);
  const rightHasSales = typeof rightSales === "number" && Number.isFinite(rightSales);
  if (leftHasSales !== rightHasSales) return leftHasSales ? -1 : 1;
  if (leftHasSales && rightHasSales && leftSales !== rightSales) {
    return Number(rightSales) - Number(leftSales);
  }
  return left.id.localeCompare(right.id, "ko-KR");
}

function itemDisplayPriority(
  category: PublicInformationCategory,
  item: PublicInformationItem,
) {
  if (category === "finance") {
    if (item.id.startsWith("ecos-")) return 0;
    if (item.id.startsWith("finlife-") || item.id.startsWith("loan-")) return 1;
    if (item.id.startsWith("stock-")) return 2;
    if (item.id.startsWith("company-")) return 3;
    if (item.id.startsWith("dart-")) return 4;
  }
  if (category === "startup") {
    return item.commercialArea || item.id.startsWith("commercial-") || item.id.startsWith("seoul-commercial-")
      ? 1
      : 0;
  }
  if (category === "employment" && item.employmentStatistic) return 0;
  return 1;
}
