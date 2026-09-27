import type { StoredAuthUser } from "@/lib/auth/types";
import { publicItemRecency } from "./dates";
import { EMPTY_YOUTH_POLICY_PROFILE } from "../auth/youth-policy-profile";
import type {
  PublicDataDashboard,
  PublicInformationItem,
  PublicYouthPolicyEligibility,
  PublicYouthPolicyMatch,
  YouthPolicyPersonalizationSummary,
  YouthPolicyProfileField,
} from "./types";

type KnownAge = {
  minimum: number;
  maximum: number;
  exact: boolean;
};

type PolicyEvaluation =
  | { kind: "recommended"; item: PublicInformationItem }
  | { kind: "excluded" }
  | { kind: "missing"; fields: YouthPolicyProfileField[] }
  | { kind: "unassessed" };

const SEOUL_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function seoulDateParts(value: Date) {
  const parts = Object.fromEntries(
    SEOUL_DATE_FORMATTER.formatToParts(value).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function parsedYear(value: string | null | undefined) {
  const match = value?.trim().match(/^(19|20)\d{2}$/u);
  return match ? Number(match[0]) : null;
}

function parsedMonthDay(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/gu, "");
  const monthDay = digits.length === 8 ? digits.slice(4) : digits.length === 4 ? digits : "";
  if (!monthDay) return null;
  const month = Number(monthDay.slice(0, 2));
  const day = Number(monthDay.slice(2, 4));
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { month, day };
}

function explicitAgeRange(value: string | null | undefined) {
  const match = value?.trim().match(/^(\d{1,3})\s*(?:~|-|–|—)\s*(\d{1,3})$/u);
  if (!match) return null;
  const minimum = Number(match[1]);
  const maximum = Number(match[2]);
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 0 || maximum > 120 || minimum > maximum) {
    return null;
  }
  return { minimum, maximum, exact: minimum === maximum } satisfies KnownAge;
}

function knownAge(user: StoredAuthUser, now: Date): KnownAge | null {
  const current = seoulDateParts(now);
  const profileYear = user.youthPolicyProfile?.birthYear ?? null;
  const year = profileYear ?? parsedYear(user.birthYear);
  if (year !== null) {
    const monthDay = profileYear === null ? parsedMonthDay(user.birthday) : null;
    if (monthDay) {
      const beforeBirthday = current.month < monthDay.month
        || (current.month === monthDay.month && current.day < monthDay.day);
      const age = current.year - year - (beforeBirthday ? 1 : 0);
      return age >= 0 && age <= 120
        ? { minimum: age, maximum: age, exact: true }
        : null;
    }
    const maximum = current.year - year;
    const minimum = maximum - 1;
    return minimum >= 0 && maximum <= 120
      ? { minimum, maximum, exact: false }
      : null;
  }
  return explicitAgeRange(user.ageRange);
}

function hasScreenableCriterion(eligibility: PublicYouthPolicyEligibility) {
  return Number.isFinite(eligibility.minAge)
    || Number.isFinite(eligibility.maxAge)
    || Boolean(eligibility.regions?.length)
    || Boolean(eligibility.statuses?.length)
    || Boolean(eligibility.interests?.length);
}

function evaluatePolicy(
  item: PublicInformationItem,
  user: StoredAuthUser,
  now: Date,
): PolicyEvaluation {
  // Official policy-news feeds are informational records, not benefit
  // eligibility decisions. Keep verified youth-news items visible in the
  // signed-in youth guide without inventing personal eligibility conditions.
  if (item.tags.includes("section:policy-news")) {
    return { kind: "recommended", item };
  }
  const eligibility = item.youthPolicyEligibility;
  if (!eligibility || !hasScreenableCriterion(eligibility)) return { kind: "unassessed" };

  const missing = new Set<YouthPolicyProfileField>();
  const matched = new Set<YouthPolicyProfileField>();
  const officialConfirmation = new Set<YouthPolicyProfileField>();
  let score = 55;

  if (Number.isFinite(eligibility.minAge) || Number.isFinite(eligibility.maxAge)) {
    const age = knownAge(user, now);
    if (!age) {
      missing.add("birthYear");
    } else {
      const minimum = Number.isFinite(eligibility.minAge) ? eligibility.minAge! : 0;
      const maximum = Number.isFinite(eligibility.maxAge) ? eligibility.maxAge! : 120;
      if (age.maximum < minimum || age.minimum > maximum) return { kind: "excluded" };
      // A coarse birth-year range crossing the policy boundary remains a
      // candidate, but the exact birthday must be checked in the official notice.
      if (age.minimum < minimum || age.maximum > maximum) {
        officialConfirmation.add("birthYear");
        score += 5;
      } else {
        matched.add("birthYear");
        score += age.exact ? 15 : 10;
      }
    }
  }

  if (eligibility.regions?.length) {
    const region = (user.youthPolicyProfile ?? EMPTY_YOUTH_POLICY_PROFILE).region;
    if (!region) missing.add("region");
    else if (!eligibility.regions.includes(region)) return { kind: "excluded" };
    else {
      matched.add("region");
      score += 15;
    }
  }

  if (eligibility.statuses?.length) {
    const status = (user.youthPolicyProfile ?? EMPTY_YOUTH_POLICY_PROFILE).status;
    if (!status) missing.add("status");
    else if (!eligibility.statuses.includes(status)) return { kind: "excluded" };
    else {
      matched.add("status");
      score += 15;
    }
  }

  const policyInterests = eligibility.interests ?? [];
  if (policyInterests.length) {
    const interests = (user.youthPolicyProfile ?? EMPTY_YOUTH_POLICY_PROFILE).interests;
    if (!interests.length) missing.add("interests");
    else if (!policyInterests.some((interest) => interests.includes(interest))) {
      return { kind: "excluded" };
    } else {
      matched.add("interests");
      score += 10;
    }
  }

  if (missing.size) return { kind: "missing", fields: [...missing] };

  const match: PublicYouthPolicyMatch = {
    fitScore: Math.min(100, score),
    matchedFields: [...matched],
    officialConfirmationFields: [...officialConfirmation],
    requiresOfficialConfirmation: true,
  };
  return { kind: "recommended", item: { ...item, youthPolicyMatch: match } };
}

function timestamp(item: PublicInformationItem) {
  return publicItemRecency(item);
}

function summary(
  status: YouthPolicyPersonalizationSummary["status"],
  sourceCount: number,
  values: Partial<Omit<YouthPolicyPersonalizationSummary,
    "status" | "sourceCount" | "profilePath" | "methodology">> = {},
): YouthPolicyPersonalizationSummary {
  const recommendedCount = values.recommendedCount ?? 0;
  return {
    status,
    sourceCount,
    recommendedCount,
    hiddenCount: values.hiddenCount ?? Math.max(0, sourceCount - recommendedCount),
    excludedCount: values.excludedCount ?? 0,
    missingInformationCount: values.missingInformationCount ?? 0,
    unassessedCount: values.unassessedCount ?? 0,
    missingProfileFields: values.missingProfileFields ?? [],
    profilePath: "/mypage",
    methodology: "structured-criteria-only",
  };
}

/**
 * Personalize only the viewer response. The shared official-data snapshot is
 * never mutated, and titles/summaries are never mined for personal attributes.
 */
export function youthPolicyDashboardForViewer(
  dashboard: PublicDataDashboard,
  user: StoredAuthUser | null,
  now = new Date(),
): PublicDataDashboard {
  const youthGroup = dashboard.categories.find((group) => group.id === "youth");
  const sourceItems = youthGroup?.items ?? [];
  const sourceCount = sourceItems.length;

  const replaceYouthItems = (
    items: PublicInformationItem[],
    personalization: YouthPolicyPersonalizationSummary,
  ): PublicDataDashboard => ({
    ...dashboard,
    categories: dashboard.categories.map((group) => group.id === "youth"
      ? {
        ...group,
        items,
        totalCount: items.length,
        newCount: Math.min(group.newCount, items.length),
      }
      : group),
    youthPolicyPersonalization: personalization,
  });

  if (!user) {
    return replaceYouthItems([], summary("sign_in_required", sourceCount));
  }
  if (!(user.youthPolicyProfile ?? EMPTY_YOUTH_POLICY_PROFILE).enabled) {
    return replaceYouthItems([], summary("personalization_disabled", sourceCount));
  }

  const recommended: PublicInformationItem[] = [];
  const missingProfileFields = new Set<YouthPolicyProfileField>();
  let excludedCount = 0;
  let missingInformationCount = 0;
  let unassessedCount = 0;
  for (const item of sourceItems) {
    const evaluation = evaluatePolicy(item, user, now);
    if (evaluation.kind === "recommended") recommended.push(evaluation.item);
    else if (evaluation.kind === "excluded") excludedCount += 1;
    else if (evaluation.kind === "unassessed") unassessedCount += 1;
    else {
      missingInformationCount += 1;
      evaluation.fields.forEach((field) => missingProfileFields.add(field));
    }
  }

  recommended.sort((left, right) =>
    (right.youthPolicyMatch?.fitScore ?? 0) - (left.youthPolicyMatch?.fitScore ?? 0)
    || timestamp(right) - timestamp(left)
    || left.title.localeCompare(right.title, "ko"));
  const personalizationStatus = missingProfileFields.size
    ? "profile_incomplete"
    : recommended.length
      ? "ready"
      : "no_matches";
  return replaceYouthItems(recommended, summary(personalizationStatus, sourceCount, {
    recommendedCount: recommended.length,
    excludedCount,
    missingInformationCount,
    unassessedCount,
    missingProfileFields: [...missingProfileFields],
  }));
}

/**
 * Return the complete viewer-neutral official youth-policy list. Public
 * reference records never include match evidence; an authenticated viewer's
 * personalization summary is retained only to distinguish the separate
 * screened view from this unscreened catalogue.
 */
export function allYouthPoliciesDashboardForViewer(
  dashboard: PublicDataDashboard,
  user: StoredAuthUser | null,
  now = new Date(),
): PublicDataDashboard {
  const personalized = youthPolicyDashboardForViewer(dashboard, user, now);
  const sourceYouthGroup = dashboard.categories.find((group) => group.id === "youth");
  const viewerNeutralItems = (sourceYouthGroup?.items ?? []).map((item) => {
    const viewerNeutralItem = { ...item };
    delete viewerNeutralItem.youthPolicyMatch;
    return viewerNeutralItem;
  });
  const totalCount = sourceYouthGroup?.totalCount ?? viewerNeutralItems.length;
  return {
    ...personalized,
    categories: personalized.categories.map((group) => group.id === "youth"
      ? {
        ...(sourceYouthGroup ?? group),
        items: viewerNeutralItems,
        totalCount,
        newCount: Math.min(sourceYouthGroup?.newCount ?? 0, totalCount),
      }
      : group),
  };
}
