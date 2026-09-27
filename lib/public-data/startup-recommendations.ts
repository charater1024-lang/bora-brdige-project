import type { StoredAuthUser } from "@/lib/auth/types";
import { publicItemRecency } from "./dates";
import { publicItemFreshness } from "./retention";
import {
  EMPTY_YOUTH_POLICY_PROFILE,
  type YouthPolicyProfile,
} from "@/lib/auth/youth-policy-profile";

import { startupAnnouncementRegionScope } from "./startup-region-view";
import type {
  PublicDataDashboard,
  PublicInformationItem,
  PublicStartupAnnouncementMatch,
  StartupAnnouncementPersonalizationSummary,
  StartupRecommendationSignal,
  YouthPolicyProfileField,
} from "./types";

const PROSPECTIVE_STATUSES = new Set<YouthPolicyProfile["status"]>([
  "high_school",
  "university",
  "graduate_school",
  "job_seeker",
  "not_working",
]);

const ACTIVE_BUSINESS_STATUSES = new Set<YouthPolicyProfile["status"]>([
  "self_employed",
]);

const PROSPECTIVE_PATTERN = /예비\s*창업|창업\s*예정|pre[- ]?startup|prospective founder/iu;
const ACTIVE_BUSINESS_PATTERN = /초기\s*창업|창업\s*기업|소상공인|자영업|startup company|small business/iu;
const YOUTH_PATTERN = /청년|youth/iu;

function announcement(item: PublicInformationItem) {
  return item.category === "startup"
    && !item.commercialArea
    && !item.id.startsWith("commercial-")
    && (
      item.id.startsWith("bizinfo-")
      || item.id.startsWith("kstartup-")
      || item.tags.some((tag) => /창업|기업마당|K-Startup/iu.test(tag))
    );
}

function itemText(item: PublicInformationItem) {
  return [
    item.title,
    item.summary,
    item.location?.label,
    item.location?.province,
    ...item.tags,
  ].filter(Boolean).join(" ");
}

function publicationTimestamp(item: PublicInformationItem, now: Date) {
  return publicItemRecency(item, now.getTime());
}

function birthYear(user: StoredAuthUser) {
  const profileYear = user.youthPolicyProfile?.birthYear;
  if (profileYear) return profileYear;
  const value = Number(user.birthYear);
  return Number.isInteger(value) && value >= 1900 ? value : null;
}

function summary(
  status: StartupAnnouncementPersonalizationSummary["status"],
  sourceCount: number,
  values: Partial<Pick<
    StartupAnnouncementPersonalizationSummary,
    "recommendedCount" | "missingProfileFields"
  >> = {},
): StartupAnnouncementPersonalizationSummary {
  return {
    status,
    sourceCount,
    recommendedCount: values.recommendedCount ?? 0,
    missingProfileFields: values.missingProfileFields ?? [],
    profilePath: "/mypage",
    methodology: "privacy-safe-hybrid",
  };
}

type ScoredAnnouncement = {
  item: PublicInformationItem;
  score: number;
  signals: StartupRecommendationSignal[];
};

function scoreAnnouncement(
  item: PublicInformationItem,
  user: StoredAuthUser,
  profile: YouthPolicyProfile,
  now: Date,
): ScoredAnnouncement {
  const text = itemText(item);
  const signals: StartupRecommendationSignal[] = [];
  let score = 0;

  if (profile.region) {
    const regionScope = startupAnnouncementRegionScope(item);
    if (regionScope.kind === "regional" && regionScope.regions.includes(profile.region)) {
      score += 32;
      signals.push("preferred_region");
    } else if (regionScope.kind === "nationwide") {
      score += 22;
      signals.push("nationwide");
    }
  }

  if (profile.interests.includes("startup")) {
    score += 25;
    signals.push("startup_interest");
  }

  if (profile.status && PROSPECTIVE_STATUSES.has(profile.status) && PROSPECTIVE_PATTERN.test(text)) {
    score += 24;
    signals.push("prospective_founder");
  }
  if (profile.status && ACTIVE_BUSINESS_STATUSES.has(profile.status) && ACTIVE_BUSINESS_PATTERN.test(text)) {
    score += 24;
    signals.push("active_business");
  }

  const year = birthYear(user);
  const approximateAge = year ? now.getUTCFullYear() - year : null;
  if (approximateAge !== null && approximateAge >= 18 && approximateAge <= 39 && YOUTH_PATTERN.test(text)) {
    score += 16;
    signals.push("youth_focus");
  }

  const publishedAt = publicationTimestamp(item, now);
  const ageDays = publishedAt > 0 ? Math.max(0, (now.getTime() - publishedAt) / 86_400_000) : 365;
  if (ageDays <= 45) {
    score += Math.max(2, Math.round(10 - ageDays / 6));
    signals.push("recent_notice");
  }

  return { item, score, signals: [...new Set(signals)] };
}

/**
 * Adds a privacy-safe startup shortlist to the viewer response.
 *
 * The shared official-data cache is never mutated. Matching uses only coarse,
 * allow-listed profile fields and structured provider tags. The selected AI
 * runtime is used later, on demand, to explain an opened announcement; paid
 * providers still require the existing explicit developer approval flow.
 */
export function startupAnnouncementsForViewer(
  dashboard: PublicDataDashboard,
  user: StoredAuthUser | null,
  now = new Date(),
): PublicDataDashboard {
  const startupGroup = dashboard.categories.find((group) => group.id === "startup");
  const sourceItems = startupGroup?.items ?? [];
  const announcements = sourceItems.filter((item) => (
    announcement(item) && publicItemFreshness(item, now.getTime()).active
  ));

  const replaceStartupItems = (
    matches: ReadonlyMap<string, PublicStartupAnnouncementMatch>,
    personalization: StartupAnnouncementPersonalizationSummary,
  ): PublicDataDashboard => ({
    ...dashboard,
    categories: dashboard.categories.map((group) => group.id === "startup"
      ? {
        ...group,
        items: group.items.map((item) => {
          const viewerItem = { ...item };
          delete viewerItem.startupMatch;
          const match = matches.get(item.id);
          return match ? { ...viewerItem, startupMatch: match } : viewerItem;
        }),
      }
      : group),
    startupAnnouncementPersonalization: personalization,
  });

  if (!user) {
    return replaceStartupItems(new Map(), summary("sign_in_required", announcements.length));
  }
  const profile = user.youthPolicyProfile ?? EMPTY_YOUTH_POLICY_PROFILE;
  if (!profile.enabled) {
    return replaceStartupItems(new Map(), summary("personalization_disabled", announcements.length));
  }

  const missingProfileFields = ([
    !profile.region ? "region" : null,
    !profile.status ? "status" : null,
    !profile.interests.length ? "interests" : null,
  ] as Array<YouthPolicyProfileField | null>).filter(
    (field): field is YouthPolicyProfileField => field !== null,
  );
  if (missingProfileFields.length === 3) {
    return replaceStartupItems(new Map(), summary("profile_incomplete", announcements.length, {
      missingProfileFields,
    }));
  }

  const ranked = announcements
    .map((item) => scoreAnnouncement(item, user, profile, now))
    .filter((candidate) => candidate.score > 0 && candidate.signals.length > 0)
    .sort((left, right) =>
      right.score - left.score
      || publicationTimestamp(right.item, now) - publicationTimestamp(left.item, now)
      || left.item.title.localeCompare(right.item.title, "ko"))
    .slice(0, 5);
  const matches = new Map<string, PublicStartupAnnouncementMatch>(
    ranked.map((candidate, index) => [candidate.item.id, {
      rank: index + 1,
      signals: candidate.signals,
      requiresOfficialConfirmation: true,
    }]),
  );

  return replaceStartupItems(matches, summary(
    ranked.length ? "ready" : "no_matches",
    announcements.length,
    {
      recommendedCount: ranked.length,
      missingProfileFields,
    },
  ));
}
