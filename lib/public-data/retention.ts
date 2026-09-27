import type {
  PublicDataFreshnessFilter,
  PublicDataPayload,
  PublicInformationItem,
} from "./types";
import { publicApplicationPeriod, publicDateEnd, publicNoticeOperationalPeriod, repairYouthPolicyApplicationDates,
  publicItemRecency, publicItemVerificationInstant } from "./dates";

const DAY_MS = 24 * 60 * 60 * 1_000;

type RetentionPolicy = {
  prefix: string;
  verifiedGraceDays: number;
  publishedMaxAgeDays?: number;
};

/**
 * Retention never guesses an application deadline from prose. Explicit
 * application dates always win. A narrowly-scoped operational signal may still
 * keep a clearly historical provider edition out of the current-opportunity
 * view; that signal is not copied into the item's application deadline.
 */
export const PUBLIC_ITEM_RETENTION_POLICIES: readonly RetentionPolicy[] = [
  { prefix: "stock-", verifiedGraceDays: 7, publishedMaxAgeDays: 14 },
  { prefix: "dart-", verifiedGraceDays: 45, publishedMaxAgeDays: 60 },
  { prefix: "finlife-", verifiedGraceDays: 90, publishedMaxAgeDays: 240 },
  { prefix: "bizinfo-", verifiedGraceDays: 60, publishedMaxAgeDays: 365 },
  { prefix: "kstartup-", verifiedGraceDays: 60, publishedMaxAgeDays: 365 },
  { prefix: "ecos-", verifiedGraceDays: 14 },
  { prefix: "financial-company-", verifiedGraceDays: 90 },
  { prefix: "company-", verifiedGraceDays: 90 },
  { prefix: "loan-", verifiedGraceDays: 90 },
  { prefix: "seoul-commercial-", verifiedGraceDays: 90 },
  { prefix: "commercial-", verifiedGraceDays: 90 },
  { prefix: "kosaf-", verifiedGraceDays: 90 },
  { prefix: "kosis-employment-", verifiedGraceDays: 45 },
  { prefix: "moel-news-", verifiedGraceDays: 30, publishedMaxAgeDays: 120 },
  { prefix: "moel-report-", verifiedGraceDays: 14, publishedMaxAgeDays: 90 },
] as const;

const DEFAULT_POLICY: RetentionPolicy = { prefix: "", verifiedGraceDays: 90 };

function policyFor(item: PublicInformationItem) {
  return PUBLIC_ITEM_RETENTION_POLICIES.find((policy) => item.id.startsWith(policy.prefix))
    ?? DEFAULT_POLICY;
}

function dateAtEndOfKstDay(value: string | null | undefined) {
  return publicDateEnd(value);
}

export type PublicItemFreshness = {
  active: boolean;
  reason: "active" | "explicitly-expired" | "published-too-old" | "operationally-ended" | "not-reverified" | "legacy-record-shape";
  expiresAt: string | null;
};

export function publicItemFreshness(
  item: PublicInformationItem,
  now = Date.now(),
): PublicItemFreshness {
  if (item.id.startsWith("commercial-") && !item.source.includes("주요상권")) {
    return { active: false, reason: "legacy-record-shape", expiresAt: null };
  }
  const period = publicApplicationPeriod(repairYouthPolicyApplicationDates(item), now);
  if (period.status === "expired") {
    return { active: false, reason: "explicitly-expired", expiresAt: period.expiresAt };
  }

  const policy = policyFor(item);
  const publishedAt = dateAtEndOfKstDay(item.publishedAt);
  if (policy.publishedMaxAgeDays && publishedAt !== null
    && publishedAt + policy.publishedMaxAgeDays * DAY_MS < now) {
    return {
      active: false,
      reason: "published-too-old",
      expiresAt: new Date(publishedAt + policy.publishedMaxAgeDays * DAY_MS).toISOString(),
    };
  }

  // An explicitly current/future application period takes precedence. Only an
  // otherwise unknown application can be retired by a separate event/edition
  // end signal, and the latter never becomes an application deadline.
  if (period.status === "unknown") {
    const operational = publicNoticeOperationalPeriod(item);
    const operationalEnd = publicDateEnd(operational.endsAt);
    if (operationalEnd !== null && operationalEnd < now) {
      return { active: false, reason: "operationally-ended", expiresAt: null };
    }
  }

  const verifiedAt = publicItemVerificationInstant(item, now);
  if (verifiedAt !== null && verifiedAt + policy.verifiedGraceDays * DAY_MS < now) {
    return {
      active: false,
      reason: "not-reverified",
      expiresAt: new Date(verifiedAt + policy.verifiedGraceDays * DAY_MS).toISOString(),
    };
  }

  // "active" is a catalogue-retention bucket, not verified open applications:
  // upcoming and unknown periods remain discoverable with an explicit UI label.
  return { active: true, reason: "active", expiresAt: period.expiresAt };
}

export function prunePublicInformationItems(
  items: readonly PublicInformationItem[],
  now = Date.now(),
) {
  return items.filter((item) => publicItemFreshness(item, now).active);
}

const ARCHIVE_MAX_AGE_DAYS = 730;

/**
 * Shared catalogues keep expired records for a bounded archive window. The
 * default dashboard still hides them, while the dedicated page can explicitly
 * request expired/all records.
 */
export function prunePublicInformationArchive(
  items: readonly PublicInformationItem[],
  now = Date.now(),
) {
  const oldest = now - ARCHIVE_MAX_AGE_DAYS * DAY_MS;
  return items.filter((item) => {
    const repaired = repairYouthPolicyApplicationDates(item);
    const application = publicApplicationPeriod(repaired, now);
    const operational = publicNoticeOperationalPeriod(repaired);
    // Re-verification proves that a provider still returns a record; it does
    // not make an old closing/event date recent. Bound those historical rows by
    // their explicit schedule so a full archive feed cannot grow forever.
    const endedAt = application.status === "expired"
      ? publicDateEnd(application.expiresAt)
      : publicDateEnd(operational.endsAt);
    if (endedAt !== null && endedAt < now) return endedAt >= oldest;
    const recent = publicItemRecency(item, now);
    return recent === 0 || recent >= oldest;
  });
}

export function filterPublicInformationItems(
  items: readonly PublicInformationItem[],
  filter: PublicDataFreshnessFilter,
  now = Date.now(),
) {
  const active = (item: PublicInformationItem) => publicItemFreshness(item, now).active;
  if (filter === "active") return items.filter(active);
  if (filter === "expired" || filter === "review-needed") return items.filter((item) => {
    const freshness = publicItemFreshness(item, now);
    const ended = freshness.reason === "explicitly-expired" || freshness.reason === "operationally-ended";
    return filter === "expired" ? ended : !freshness.active && !ended;
  });
  if (filter === "all") return [...items];
  const days = filter === "recent-7d" ? 7 : 30;
  const boundary = now - days * DAY_MS;
  // Recent means a provider-supplied publication/modification date. A fresh
  // crawl or re-verification is deliberately not a publication event.
  return items.filter((item) => active(item) && publicItemRecency(item, now) >= boundary);
}

export function prunePublicDataPayload(payload: PublicDataPayload, now = Date.now()): PublicDataPayload {
  return {
    ...payload,
    categories: payload.categories.map((group) => {
      const items = prunePublicInformationItems(group.items, now);
      return { ...group, items, totalCount: items.length };
    }),
  };
}
