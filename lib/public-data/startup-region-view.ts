import {
  YOUTH_POLICY_REGIONS,
  type YouthPolicyRegion,
} from "@/lib/auth/youth-policy-profile";

import type { PublicInformationItem } from "./types";

/** Keep boundaries and commercial analytics out of announcement paging/counts. */
export function isStartupAnnouncementItem(item: PublicInformationItem) {
  return !item.commercialArea
    && !item.id.startsWith("commercial-")
    && !item.id.startsWith("seoul-commercial-");
}

export const STARTUP_PROVINCE_BY_REGION: Record<YouthPolicyRegion, string> = {
  seoul: "서울특별시",
  busan: "부산광역시",
  daegu: "대구광역시",
  incheon: "인천광역시",
  gwangju: "광주광역시",
  daejeon: "대전광역시",
  ulsan: "울산광역시",
  sejong: "세종특별자치시",
  gyeonggi: "경기도",
  gangwon: "강원특별자치도",
  chungbuk: "충청북도",
  chungnam: "충청남도",
  jeonbuk: "전북특별자치도",
  jeonnam: "전라남도",
  gyeongbuk: "경상북도",
  gyeongnam: "경상남도",
  jeju: "제주특별자치도",
};

const STARTUP_REGION_ALIASES: Record<YouthPolicyRegion, readonly string[]> = {
  seoul: ["서울", "서울특별시"],
  busan: ["부산", "부산광역시"],
  daegu: ["대구", "대구광역시"],
  incheon: ["인천", "인천광역시"],
  gwangju: ["광주", "광주광역시"],
  daejeon: ["대전", "대전광역시"],
  ulsan: ["울산", "울산광역시"],
  sejong: ["세종", "세종특별자치시"],
  gyeonggi: ["경기", "경기도"],
  gangwon: ["강원", "강원도", "강원특별자치도"],
  chungbuk: ["충북", "충청북도"],
  chungnam: ["충남", "충청남도"],
  jeonbuk: ["전북", "전라북도", "전북특별자치도"],
  jeonnam: ["전남", "전라남도"],
  gyeongbuk: ["경북", "경상북도"],
  gyeongnam: ["경남", "경상남도"],
  jeju: ["제주", "제주도", "제주특별자치도"],
};

export type StartupAnnouncementRegionScope =
  | { kind: "nationwide"; regions: [] }
  | { kind: "regional"; regions: YouthPolicyRegion[] }
  | { kind: "unknown"; regions: [] };

export type StartupAnnouncementRegionSelection =
  | { mode: "all" }
  | { mode: "nationwide" }
  | { mode: "region"; region: YouthPolicyRegion };

function compactRegionText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, "").trim();
}

function exactStructuredTokens(item: PublicInformationItem) {
  return item.tags
    .flatMap((tag) => tag.split(/[,/|·;\n]+/gu))
    .map(compactRegionText)
    .filter(Boolean);
}

function structuredLocations(item: PublicInformationItem) {
  return [
    item.location?.province,
    item.location?.label,
  ].filter((value): value is string => Boolean(value))
    .map(compactRegionText);
}

/**
 * Uses only adapter-normalized tags and structured location fields. Titles and
 * summaries are deliberately excluded so incidental place names do not change
 * an announcement's official scope.
 */
export function startupAnnouncementRegionScope(
  item: PublicInformationItem,
): StartupAnnouncementRegionScope {
  const officialScope = item.youthPolicyEligibility?.regionScope;
  const officialRegions = item.youthPolicyEligibility?.regions ?? [];
  if (officialScope === "regional" && officialRegions.length) {
    return {
      kind: "regional",
      regions: YOUTH_POLICY_REGIONS.filter((region) => officialRegions.includes(region)),
    };
  }
  if (officialScope === "nationwide") return { kind: "nationwide", regions: [] };

  const tokens = exactStructuredTokens(item);
  const locations = structuredLocations(item);
  const locationRegions = YOUTH_POLICY_REGIONS.filter((region) => {
    const aliases = STARTUP_REGION_ALIASES[region].map(compactRegionText);
    return aliases.some((alias) => locations.some(
      (location) => location === alias || location.startsWith(alias),
    ));
  });
  if (locationRegions.length) return { kind: "regional", regions: locationRegions };

  if (tokens.some((token) => token === "전국" || token === "전국대상")) {
    return { kind: "nationwide", regions: [] };
  }

  const tagRegions = YOUTH_POLICY_REGIONS.filter((region) => {
    const aliases = STARTUP_REGION_ALIASES[region].map(compactRegionText);
    return aliases.some((alias) => tokens.includes(alias));
  });
  // Some providers attach their complete province taxonomy to a notice. It is
  // not evidence that a district-only notice applies to every province.
  if (tagRegions.length === YOUTH_POLICY_REGIONS.length) {
    return { kind: "unknown", regions: [] };
  }
  if (tagRegions.length) return { kind: "regional", regions: tagRegions };
  return { kind: "unknown", regions: [] };
}

export function startupAnnouncementRegionCounts(
  items: readonly PublicInformationItem[],
) {
  const regions = Object.fromEntries(
    YOUTH_POLICY_REGIONS.map((region) => [region, 0]),
  ) as Record<YouthPolicyRegion, number>;
  let nationwide = 0;
  let unknown = 0;
  for (const item of items) {
    const scope = startupAnnouncementRegionScope(item);
    if (scope.kind === "nationwide") {
      nationwide += 1;
      continue;
    }
    if (scope.kind === "unknown") {
      unknown += 1;
      continue;
    }
    for (const region of scope.regions) regions[region] += 1;
  }
  return { regions, nationwide, unknown, total: items.length };
}

export function startupAnnouncementsForRegion(
  items: readonly PublicInformationItem[],
  selection: StartupAnnouncementRegionSelection,
) {
  if (selection.mode === "all") return [...items];
  return items.filter((item) => {
    const scope = startupAnnouncementRegionScope(item);
    if (selection.mode === "nationwide") return scope.kind === "nationwide";
    return scope.kind === "regional" && scope.regions.includes(selection.region);
  });
}
