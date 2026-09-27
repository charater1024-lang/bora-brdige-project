export type PublicSourceScheduleKind = "interval" | "business-day-at";

export type PublicSourceQuotaBasis =
  | "official"
  | "user-confirmed"
  | "conservative-default";

export interface PublicSourcePolicy {
  sourceId: string;
  dailyLimit: number;
  quotaVerified: boolean;
  quotaBasis: PublicSourceQuotaBasis;
  estimatedCalls: number;
  minimumFreshnessMs: number;
  scheduleKind: PublicSourceScheduleKind;
  businessDayMinute?: number;
  activeWindow?: {
    startMinute: number;
    endMinute: number;
    weekdaysOnly: boolean;
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const KST_OFFSET_MS = 9 * HOUR;

export const COMMERCIAL_AREA_PAGE_SIZE = 1_000;
export const COMMERCIAL_AREA_MAX_PAGES_PER_PROVINCE = 2;
export const COMMERCIAL_AREA_PROVINCE_COUNT = 17;
export const COMMERCIAL_AREA_MAX_CALLS = COMMERCIAL_AREA_PROVINCE_COUNT * COMMERCIAL_AREA_MAX_PAGES_PER_PROVINCE;
export const PUBLIC_REFRESH_MAX_ESTIMATED_CALLS = 45;
// Reserving and completing one source each consume a D1 statement. Keeping the
// per-refresh source count below this bound leaves headroom for authentication,
// cache/settings schema checks, exchange history, and per-user seen counts.
export const PUBLIC_REFRESH_MAX_SOURCES = 11;

export function commercialAreaPagePlan(totalCount: number) {
  const normalizedTotal = Number.isSafeInteger(totalCount) && totalCount >= 0 ? totalCount : 0;
  const requiredPages = Math.max(1, Math.ceil(normalizedTotal / COMMERCIAL_AREA_PAGE_SIZE));
  return {
    requiredPages,
    complete: requiredPages <= COMMERCIAL_AREA_MAX_PAGES_PER_PROVINCE,
  };
}

/**
 * Quotas marked conservative-default must be confirmed in the provider's
 * developer console before a higher value is configured. The exchange quota
 * is the value confirmed by this site's administrator, not a provider-published
 * value, so it remains deliberately distinguishable in the API response.
 */
export const PUBLIC_SOURCE_POLICIES: readonly PublicSourcePolicy[] = [
  {
    sourceId: "exchange",
    dailyLimit: 1_000,
    quotaVerified: false,
    quotaBasis: "user-confirmed",
    // Up to three requests locate the latest published business day. Four
    // checkpointed historical dates then fill the one-year chart without a
    // large one-off quota spike.
    estimatedCalls: 7,
    minimumFreshnessMs: HOUR,
    scheduleKind: "interval",
    activeWindow: { startMinute: 9 * 60, endMinute: 26 * 60, weekdaysOnly: true },
  },
  {
    sourceId: "stock",
    dailyLimit: 10_000,
    quotaVerified: true,
    quotaBasis: "official",
    estimatedCalls: 12,
    minimumFreshnessMs: DAY,
    scheduleKind: "business-day-at",
    businessDayMinute: 13 * 60 + 10,
  },
  {
    sourceId: "financial-company",
    dailyLimit: 10_000,
    quotaVerified: true,
    quotaBasis: "official",
    // Up to ten recent Seoul business-day probes plus two bounded transient
    // retries identify the latest provider base date; at most twenty pages
    // then collect that current catalogue.
    estimatedCalls: 32,
    minimumFreshnessMs: DAY,
    scheduleKind: "interval",
  },
  {
    sourceId: "loan-product",
    dailyLimit: 10_000,
    quotaVerified: true,
    quotaBasis: "official",
    estimatedCalls: 20,
    minimumFreshnessMs: 7 * DAY,
    scheduleKind: "interval",
  },
  {
    sourceId: "commercial-area",
    dailyLimit: 10_000,
    quotaVerified: true,
    quotaBasis: "official",
    // Every province can use at most two 1,000-row pages. Reserving the full
    // bound prevents a later page from exceeding the provider's daily quota.
    estimatedCalls: COMMERCIAL_AREA_MAX_CALLS,
    minimumFreshnessMs: 6 * HOUR,
    scheduleKind: "interval",
  },
  {
    sourceId: "seoul-commercial",
    // The provider does not publish a quota for its keyless HTTPS Sheet CSV
    // downloads. Keep an internal conservative ceiling for this source.
    dailyLimit: 1_000,
    quotaVerified: false,
    quotaBasis: "conservative-default",
    // Sales, footfall, and area CSVs are downloaded over TLS. The developer
    // activation setting is only an ON/OFF gate; no provider key is transmitted.
    estimatedCalls: 3,
    minimumFreshnessMs: DAY,
    scheduleKind: "interval",
  },
  {
    sourceId: "kosaf-high",
    dailyLimit: 1_000,
    quotaVerified: false,
    quotaBasis: "conservative-default",
    estimatedCalls: 20,
    minimumFreshnessMs: 7 * DAY,
    scheduleKind: "interval",
  },
  {
    sourceId: "kosaf-university",
    dailyLimit: 1_000,
    quotaVerified: false,
    quotaBasis: "conservative-default",
    estimatedCalls: 20,
    minimumFreshnessMs: 7 * DAY,
    scheduleKind: "interval",
  },
  {
    sourceId: "ecos",
    dailyLimit: 1_000,
    quotaVerified: false,
    quotaBasis: "conservative-default",
    estimatedCalls: 1,
    minimumFreshnessMs: DAY,
    scheduleKind: "interval",
  },
  {
    sourceId: "finlife",
    dailyLimit: 1_000,
    quotaVerified: false,
    quotaBasis: "conservative-default",
    estimatedCalls: 40,
    minimumFreshnessMs: DAY,
    scheduleKind: "interval",
  },
  {
    sourceId: "dart",
    dailyLimit: 20_000,
    quotaVerified: true,
    quotaBasis: "official",
    estimatedCalls: 20,
    minimumFreshnessMs: 30 * MINUTE,
    scheduleKind: "interval",
  },
  {
    sourceId: "bizinfo",
    dailyLimit: 1_000,
    quotaVerified: false,
    quotaBasis: "conservative-default",
    estimatedCalls: 10,
    minimumFreshnessMs: HOUR,
    scheduleKind: "interval",
  },
  {
    sourceId: "bizinfo-data-go",
    dailyLimit: 10_000,
    quotaVerified: true,
    quotaBasis: "official",
    estimatedCalls: 20,
    minimumFreshnessMs: DAY,
    scheduleKind: "interval",
  },
  {
    sourceId: "kstartup",
    dailyLimit: 10_000,
    quotaVerified: true,
    quotaBasis: "official",
    estimatedCalls: 20,
    minimumFreshnessMs: 3 * HOUR,
    scheduleKind: "interval",
  },
  {
    sourceId: "work24",
    dailyLimit: 1_000,
    quotaVerified: false,
    quotaBasis: "conservative-default",
    // The adapter reads at most twenty 100-row pages and reports coverage.
    estimatedCalls: 20,
    minimumFreshnessMs: 3 * HOUR,
    scheduleKind: "interval",
  },
  {
    sourceId: "youth-center",
    dailyLimit: 1_000,
    quotaVerified: false,
    quotaBasis: "conservative-default",
    // Four Open API sections require at most 20 requests. If the provider
    // redirects that credentialed HTTPS endpoint to HTTP:8080, the adapter
    // switches to the keyless official portal: one rejected request, one
    // session request, and at most 30 catalogue pages.
    estimatedCalls: 32,
    minimumFreshnessMs: 6 * HOUR,
    scheduleKind: "interval",
  },
  {
    sourceId: "kosis-employment",
    // KOSIS publishes a 200 calls/minute and 40,000 cells/request ceiling,
    // not an official daily quota. The dashboard therefore labels this as an
    // internal conservative protection budget instead of a provider limit.
    dailyLimit: 1_000,
    quotaVerified: false,
    quotaBasis: "conservative-default",
    // One bounded request for each of youth, older adults, and foreigners.
    estimatedCalls: 3,
    minimumFreshnessMs: 7 * DAY,
    scheduleKind: "interval",
  },
  {
    sourceId: "moel-policy-news",
    dailyLimit: 240,
    quotaVerified: false,
    quotaBasis: "conservative-default",
    estimatedCalls: 1,
    minimumFreshnessMs: 3 * HOUR,
    scheduleKind: "interval",
  },
  {
    sourceId: "moel-press-releases",
    dailyLimit: 240,
    quotaVerified: false,
    quotaBasis: "conservative-default",
    // Up to eight official search pages cover the latest 30-day window. At
    // most sixteen uncached youth-related details are hydrated per run, so the
    // three-hour cadence remains below the conservative 240-call daily budget.
    estimatedCalls: 24,
    minimumFreshnessMs: 3 * HOUR,
    scheduleKind: "interval",
  },
] as const;

const POLICY_BY_SOURCE = new Map(PUBLIC_SOURCE_POLICIES.map((policy) => [policy.sourceId, policy]));

export interface PublicRefreshBatchState {
  sourceId: string;
  lastAttemptAt: number;
  nextDueAt: number;
}

/**
 * Keep one Worker refresh below both the external-subrequest ceiling and the
 * D1 statement budget while rotating the oldest attempted source first.
 * Sources that do not fit are skipped, so smaller due sources can use the
 * remaining budget.
 */
export function selectPublicRefreshBatch(
  candidates: readonly PublicSourcePolicy[],
  states: readonly PublicRefreshBatchState[],
  maxEstimatedCalls = PUBLIC_REFRESH_MAX_ESTIMATED_CALLS,
  maxSources = PUBLIC_REFRESH_MAX_SOURCES,
) {
  const safeMaximum = Number.isSafeInteger(maxEstimatedCalls) && maxEstimatedCalls > 0
    ? maxEstimatedCalls
    : PUBLIC_REFRESH_MAX_ESTIMATED_CALLS;
  const safeSourceMaximum = Number.isSafeInteger(maxSources) && maxSources > 0
    ? maxSources
    : PUBLIC_REFRESH_MAX_SOURCES;
  const bySource = new Map(states.map((state) => [state.sourceId, state]));
  const ordered = [...candidates].sort((left, right) => {
    const leftState = bySource.get(left.sourceId);
    const rightState = bySource.get(right.sourceId);
    const attemptDelta = (leftState?.lastAttemptAt ?? 0) - (rightState?.lastAttemptAt ?? 0);
    if (attemptDelta) return attemptDelta;
    const dueDelta = (leftState?.nextDueAt ?? 0) - (rightState?.nextDueAt ?? 0);
    return dueDelta || left.sourceId.localeCompare(right.sourceId);
  });
  let reserved = 0;
  let selected = 0;
  return ordered.filter((policy) => {
    if (selected >= safeSourceMaximum) return false;
    if (!Number.isSafeInteger(policy.estimatedCalls) || policy.estimatedCalls < 1) return false;
    if (reserved + policy.estimatedCalls > safeMaximum) return false;
    reserved += policy.estimatedCalls;
    selected += 1;
    return true;
  });
}

export function publicSourcePolicy(sourceId: string) {
  return POLICY_BY_SOURCE.get(sourceId) ?? null;
}

function kstDateParts(value: number) {
  const shifted = new Date(value + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minute: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function kstLocalTime(parts: { year: number; month: number; date: number }, minute: number) {
  return Date.UTC(parts.year, parts.month, parts.date, 0, minute) - KST_OFFSET_MS;
}

function addKstDays(value: number, days: number) {
  const parts = kstDateParts(value);
  return kstLocalTime(parts, days * 24 * 60);
}

function isWeekday(weekday: number) {
  return weekday >= 1 && weekday <= 5;
}

export function kstQuotaDay(value: number) {
  const parts = kstDateParts(value);
  return `${parts.year}${String(parts.month + 1).padStart(2, "0")}${String(parts.date).padStart(2, "0")}`;
}

export function nextKstQuotaDayStart(value: number) {
  const parts = kstDateParts(value);
  return kstLocalTime(parts, 24 * 60);
}

export function isPolicyActiveAt(policy: PublicSourcePolicy, value: number) {
  const window = policy.activeWindow;
  if (!window) return true;
  const parts = kstDateParts(value);
  if (window.endMinute <= 24 * 60) {
    return (!window.weekdaysOnly || isWeekday(parts.weekday))
      && parts.minute >= window.startMinute
      && parts.minute < window.endMinute;
  }
  if (parts.minute >= window.startMinute) {
    return (!window.weekdaysOnly || isWeekday(parts.weekday))
      && parts.minute < Math.min(window.endMinute, 24 * 60);
  }
  if (parts.minute < window.endMinute - 24 * 60) {
    const previousWeekday = (parts.weekday + 6) % 7;
    return !window.weekdaysOnly || isWeekday(previousWeekday);
  }
  return false;
}

function nextActiveWindow(policy: PublicSourcePolicy, value: number) {
  const window = policy.activeWindow;
  if (!window || isPolicyActiveAt(policy, value)) return value;
  for (let dayOffset = 0; dayOffset < 9; dayOffset += 1) {
    const day = addKstDays(value, dayOffset);
    const parts = kstDateParts(day);
    if (window.weekdaysOnly && !isWeekday(parts.weekday)) continue;
    const candidate = kstLocalTime(parts, window.startMinute);
    if (candidate >= value) return candidate;
  }
  return value + DAY;
}

function nextBusinessDayAt(policy: PublicSourcePolicy, now: number, lastSuccessAt: number | null) {
  const minute = policy.businessDayMinute ?? 0;
  for (let dayOffset = 0; dayOffset < 9; dayOffset += 1) {
    const day = addKstDays(now, dayOffset);
    const parts = kstDateParts(day);
    if (!isWeekday(parts.weekday)) continue;
    const candidate = kstLocalTime(parts, minute);
    const lastSuccessDay = lastSuccessAt ? kstQuotaDay(lastSuccessAt) : null;
    if (candidate > now || (candidate <= now && lastSuccessDay !== kstQuotaDay(candidate))) {
      return candidate <= now ? now : candidate;
    }
  }
  return now + DAY;
}

export function nextPolicyDueAt(
  policy: PublicSourcePolicy,
  now: number,
  lastSuccessAt: number | null,
) {
  if (policy.scheduleKind === "business-day-at") {
    return nextBusinessDayAt(policy, now, lastSuccessAt);
  }
  const intervalDue = lastSuccessAt ? lastSuccessAt + policy.minimumFreshnessMs : now;
  return nextActiveWindow(policy, Math.max(now, intervalDue));
}

export function eligiblePolicyDueAt(
  policy: PublicSourcePolicy,
  now: number,
  storedNextDueAt: number,
  backoffUntil: number,
  lastSuccessAt: number | null,
) {
  const policyDue = nextPolicyDueAt(policy, now, lastSuccessAt);
  const due = Math.max(storedNextDueAt, backoffUntil, policyDue);
  return nextActiveWindow(policy, due);
}

/** The durable quota ledger has always used compact KST dates (YYYYMMDD). */
export function isPublicQuotaDay(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{8}$/u.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const parsed = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  return year >= 1000
    && parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day;
}

export function acceleratedPolicyDueAt(
  policy: PublicSourcePolicy,
  now: number,
  storedNextDueAt: number,
  backoffUntil: number,
) {
  return nextActiveWindow(policy, Math.max(now, storedNextDueAt, backoffUntil));
}

export function isPublicCatalogBackfillInProgress(errorCode: string | null | undefined) {
  const normalized = errorCode?.startsWith("warning_")
    ? errorCode.slice("warning_".length)
    : errorCode;
  return normalized === "startup_backfill_in_progress"
    || normalized === "dart_backfill_in_progress"
    || normalized === "bizinfo_backfill_in_progress"
    || normalized === "work24_backfill_in_progress"
    || normalized === "youth_center_backfill_in_progress"
    || normalized === "moel_press_backfill_in_progress";
}

export function failureBackoffMs(consecutiveFailures: number, kind: "authorization" | "quota" | "transient") {
  if (kind === "authorization") return DAY;
  if (kind === "quota") return DAY;
  const steps = [5 * MINUTE, 15 * MINUTE, HOUR, 6 * HOUR];
  return steps[Math.min(Math.max(0, consecutiveFailures), steps.length - 1)];
}

/**
 * Work24 employment-list access is restricted by provider membership and
 * approval, so retrying the same rejected personal credential every day only
 * spends quota and scheduler capacity. Keep the generic authorization retry
 * for services where a newly issued key may become active quickly, while
 * probing Work24 at a conservative weekly cadence. A developer can still
 * explicitly requeue the source after its provider approval changes.
 */
export function sourceFailureBackoffMs(
  sourceId: string,
  consecutiveFailures: number,
  kind: "authorization" | "quota" | "transient",
) {
  if (sourceId === "work24" && kind === "authorization") return 7 * DAY;
  return failureBackoffMs(consecutiveFailures, kind);
}

export const PUBLIC_API_AUTOMATIC_RATIO = 0.7;
export const PUBLIC_API_MANUAL_RATIO = 0.8;
export const PUBLIC_API_HARD_STOP_RATIO = 0.9;
