const KST_OFFSET = 9 * 60 * 60 * 1_000;

export type PublicSourceDateMetadata = {
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

type SourceDatedItem = {
  id?: string; publishedAt?: string | null; sourceUpdatedAt?: string | null;
  discoveredAt?: string | null; lastVerifiedAt?: string | null;
  sourceDateMetadata?: PublicSourceDateMetadata;
};

/** Never retain arbitrary provider text in date provenance. */
function rawDate(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text.length > 0 && text.length <= 80 && /\d/u.test(text)
    && /^[\d\sTtZz:+./년월일-]+$/u.test(text) ? text : undefined;
}

/** Date-only values are KST days, not UTC-midnight timestamps. */
export function publicDateInstant(value: unknown): number | null {
  const normalized = normalizePublicDateTime(value);
  if (!normalized) return null;
  return Date.parse(/^\d{4}-\d{2}-\d{2}$/u.test(normalized) ? `${normalized}T00:00:00+09:00` : normalized);
}

function safeAnchor(item: SourceDatedItem, field: "discoveredAt" | "lastVerifiedAt", now: number) {
  const value = item[field];
  if (value && item.sourceDateMetadata?.rejectedAnchors?.[field] === value) return null;
  const parsed = publicDateInstant(value);
  return parsed !== null && parsed <= now ? parsed : null;
}

/**
 * Shared sort/recent-filter semantics.
 *
 * `discoveredAt` and `lastVerifiedAt` are collector bookkeeping timestamps.
 * They prove when BORA saw a row, not when the provider published or changed
 * it, so they must never make an old/undated notice appear in a "recent"
 * viewer filter. Provider modified dates remain opt-in because their field
 * provenance is recorded by the youth-policy adapter.
 */
export function publicItemRecency(item: SourceDatedItem, now = Date.now()): number {
  const meta = item.sourceDateMetadata;
  const published = meta?.publishedAtStatus === "future" || meta?.publishedAtStatus === "invalid"
    ? null : publicDateInstant(item.publishedAt);
  const modified = meta?.sourceUpdatedAtStatus === "valid" && meta.sourceUpdatedAtField ? publicDateInstant(item.sourceUpdatedAt) : null;
  return Math.max(0,
    published !== null && published <= now ? published : 0,
    modified !== null && modified <= now ? modified : 0);
}

export function publicItemVerificationInstant(item: SourceDatedItem, now = Date.now()): number | null {
  return safeAnchor(item, "lastVerifiedAt", now) ?? safeAnchor(item, "discoveredAt", now);
}

function checkedSourceDate(value: unknown, upper: number) {
  const normalized = normalizePublicDateTime(value);
  if (value == null || value === "") return { value: null, status: "missing" as const };
  if (!normalized) return { value: null, status: "invalid" as const };
  return publicDateInstant(normalized)! > upper
    ? { value: null, status: "future" as const } : { value: normalized, status: "valid" as const };
}

/** Portal DATE has ambiguous semantics: preserve it, but do not invent publication. */
export function normalizeYouthPortalSourceDates(record: Record<string, unknown>, nowIso: string, previous?: SourceDatedItem) {
  const upper = publicDateInstant(nowIso) ?? 0;
  const xml = "frstRgstDt" in record || "lastUpdtDt" in record || "lastCntcUpdtDt" in record;
  const pubField = xml ? "frstRgstDt" : "FRST_REG_DT";
  const updateField = xml ? record.lastUpdtDt ? "lastUpdtDt" : "lastCntcUpdtDt" : "LAST_MDFCN_DT";
  const publication = checkedSourceDate(record[pubField], upper);
  const update = checkedSourceDate(record[updateField], upper);
  const sourceDateMetadata: PublicSourceDateMetadata = {
    version: 1, publishedAtField: pubField, sourceUpdatedAtField: updateField,
    ...(rawDate(record[pubField]) ? { rawPublishedAt: rawDate(record[pubField]) } : {}),
    ...(rawDate(record[updateField]) ? { rawSourceUpdatedAt: rawDate(record[updateField]) } : {}),
    ...(rawDate(record.DATE) ? { rawPortalDate: rawDate(record.DATE) } : {}),
    publishedAtStatus: publication.status, sourceUpdatedAtStatus: update.status,
  };
  const prior = previous?.sourceDateMetadata;
  if (prior?.rejectedAnchors) sourceDateMetadata.rejectedAnchors = { ...prior.rejectedAnchors };
  const sameRejectedPublication = prior?.rawPublishedAt && prior.rawPublishedAt === sourceDateMetadata.rawPublishedAt
    && (prior.publishedAtStatus === "future" || prior.publishedAtStatus === "invalid");
  const sameRejectedUpdate = prior?.rawSourceUpdatedAt && prior.rawSourceUpdatedAt === sourceDateMetadata.rawSourceUpdatedAt
    && (prior.sourceUpdatedAtStatus === "future" || prior.sourceUpdatedAtStatus === "invalid");
  if (sameRejectedPublication) sourceDateMetadata.publishedAtStatus = prior.publishedAtStatus;
  if (sameRejectedUpdate) sourceDateMetadata.sourceUpdatedAtStatus = prior.sourceUpdatedAtStatus;
  return { publishedAt: sameRejectedPublication ? null : publication.value,
    sourceUpdatedAt: sameRejectedUpdate ? null : update.value, sourceDateMetadata };
}

/** Quarantine invalid/future legacy values once; never infer a timezone shift. */
export function repairYouthPolicySourceDates<T extends SourceDatedItem>(item: T, now = Date.now()): T {
  if (!item.id?.startsWith("youth-center-")) return item;
  const meta: PublicSourceDateMetadata = { ...item.sourceDateMetadata, version: 1 };
  for (const key of ["rawPublishedAt", "rawSourceUpdatedAt", "rawPortalDate"] as const) {
    const safe = rawDate(meta[key]);
    if (safe) meta[key] = safe;
    else delete meta[key];
  }
  const rejected = { ...meta.rejectedAnchors };
  for (const field of ["discoveredAt", "lastVerifiedAt"] as const) {
    if (rejected[field] && !rawDate(rejected[field])) delete rejected[field];
  }
  for (const field of ["discoveredAt", "lastVerifiedAt"] as const) {
    const value = item[field];
    if (value && rawDate(value) && (publicDateInstant(value) === null || publicDateInstant(value)! > now)) rejected[field] = value;
  }
  if (Object.keys(rejected).length) meta.rejectedAnchors = rejected;
  else delete meta.rejectedAnchors;
  const verified = safeAnchor({ ...item, sourceDateMetadata: meta }, "lastVerifiedAt", now);
  const upper = Math.min(now, verified ?? now);
  const publication = checkedSourceDate(item.publishedAt, upper);
  const quarantined = meta.publishedAtStatus === "invalid" || meta.publishedAtStatus === "future";
  if (!meta.rawPublishedAt && rawDate(item.publishedAt)) meta.rawPublishedAt = rawDate(item.publishedAt);
  meta.publishedAtField ??= "legacy";
  if (!quarantined) meta.publishedAtStatus = publication.status === "valid" && meta.publishedAtField === "legacy"
    ? "legacy-unverified" : publication.status;
  let sourceUpdatedAt = item.sourceUpdatedAt;
  if (sourceUpdatedAt != null) {
    const updated = checkedSourceDate(sourceUpdatedAt, upper);
    if (!meta.rawSourceUpdatedAt && rawDate(sourceUpdatedAt)) meta.rawSourceUpdatedAt = rawDate(sourceUpdatedAt);
    if (meta.sourceUpdatedAtStatus === "future" || meta.sourceUpdatedAtStatus === "invalid") sourceUpdatedAt = null;
    else { sourceUpdatedAt = updated.value; meta.sourceUpdatedAtStatus = updated.status; }
  }
  return { ...item, publishedAt: quarantined ? null : publication.status === "valid" && meta.publishedAtField === "legacy"
    ? item.publishedAt : publication.value,
    ...(sourceUpdatedAt !== undefined ? { sourceUpdatedAt } : {}), sourceDateMetadata: meta };
}

function calendarDate(year: number, month: number, day: number) {
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateInput(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim();
}

/** Parse a whole provider date, never a number/sentinel or a date guessed from prose. */
export function normalizePublicDateTime(value: unknown): string | null {
  const input = dateInput(value);
  const date = input.match(/^(\d{4})(?:[-./](\d{1,2})[-./](\d{1,2})|(\d{2})(\d{2}))$/u);
  if (date) return calendarDate(Number(date[1]), Number(date[2] ?? date[4]), Number(date[3] ?? date[5]));
  const korean = input.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/u);
  if (korean) return calendarDate(Number(korean[1]), Number(korean[2]), Number(korean[3]));
  const compactTimestamp = input.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/u);
  if (compactTimestamp) return normalizePublicDateTime(`${compactTimestamp[1]}-${compactTimestamp[2]}-${compactTimestamp[3]}T${compactTimestamp[4]}:${compactTimestamp[5]}:${compactTimestamp[6]}+09:00`);
  const timestamp = input.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/iu);
  if (timestamp) {
    if (!calendarDate(Number(timestamp[1]), Number(timestamp[2]), Number(timestamp[3]))
      || Number(timestamp[4]) > 23 || Number(timestamp[5]) > 59 || Number(timestamp[6] ?? 0) > 59) return null;
    const zone = timestamp[8] ?? "+09:00";
    const canonical = `${timestamp[1]}-${timestamp[2].padStart(2, "0")}-${timestamp[3].padStart(2, "0")}T${timestamp[4]}:${timestamp[5]}:${timestamp[6] ?? "00"}.${(timestamp[7] ?? "0").padEnd(3, "0")}${zone}`;
    const instant = Date.parse(canonical);
    return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
  }
  // RSS publication dates are not application dates; support their explicit
  // RFC-2822 form without re-enabling Date.parse("0") or ambiguous short dates.
  const rfc = input.match(/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+((?:19|20|21)\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(?:GMT|UTC|[+-]\d{4})$/iu);
  if (rfc) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(rfc[2].toLowerCase()) + 1;
    if (!calendarDate(Number(rfc[3]), month, Number(rfc[1]))
      || Number(rfc[4]) > 23 || Number(rfc[5]) > 59 || Number(rfc[6] ?? 0) > 59) return null;
    const instant = Date.parse(input);
    if (Number.isFinite(instant)) return new Date(instant).toISOString();
  }
  return null;
}

/** Application dates are stored as valid KST calendar dates, including ISO input. */
export function normalizePublicDate(value: unknown): string | null {
  const normalized = normalizePublicDateTime(value);
  if (!normalized) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) return normalized;
  const day = new Date(Date.parse(normalized) + KST_OFFSET);
  return calendarDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
}

export function publicDateEnd(value: unknown): number | null {
  const date = normalizePublicDate(value);
  return date ? Date.parse(`${date}T23:59:59.999+09:00`) : null;
}

export type PublicNoticeOperationalPeriod = {
  endsAt: string | null;
  evidence: "explicit-operational-date" | "event-title-month" | "kstartup-title-year" | null;
};

const OPERATIONAL_EVENT = /(?:행사|교육|운영|프로그램|캠프|박람회|설명회|상담|세미나|특강|면접|강의|개최|진행)/iu;
const OPERATIONAL_LABEL = /(?:(?:행사|교육|운영|프로그램|캠프|박람회|설명회|상담|세미나|특강|면접|강의|개최|진행)\s*(?:일시|일정|기간|날짜)|(?:행사일|교육일|개최일|진행일|운영일|일시))\s*[:：]?/giu;

function explicitCalendarDates(value: string) {
  const dates: string[] = [];
  let yearContext: number | null = null;
  const pattern = /(?:^|[^\d])(?:(20\d{2})\s*(?:년|[-./])\s*)?(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})\s*일?/gu;
  for (const match of value.matchAll(pattern)) {
    if (match[1]) yearContext = Number(match[1]);
    if (yearContext === null) continue;
    const date = calendarDate(yearContext, Number(match[2]), Number(match[3]));
    if (date) dates.push(date);
  }
  return [...new Set(dates)].sort();
}

/**
 * Extract only an explicitly labelled event/operation date. This is a stale
 * notice signal, never an inferred application deadline or eligibility fact.
 * A month in an event-like title is bounded to that calendar month's end.
 */
export function publicNoticeOperationalPeriod(input: {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  publishedAt?: unknown;
  sourceUpdatedAt?: unknown;
  applicationStartsAt?: unknown;
  expiresAt?: unknown;
}): PublicNoticeOperationalPeriod {
  const title = typeof input.title === "string" ? input.title.slice(0, 800) : "";
  const summary = typeof input.summary === "string" ? input.summary.slice(0, 12_000) : "";
  const text = `${title}\n${summary}`;
  const segments: string[] = [];
  for (const match of text.matchAll(OPERATIONAL_LABEL)) {
    const start = match.index ?? 0;
    const remainder = text.slice(start, start + 240);
    const boundary = remainder.search(/(?:\n|\s[·•]\s)/u);
    segments.push(boundary > 0 ? remainder.slice(0, boundary) : remainder);
  }
  const explicitDates = segments.flatMap(explicitCalendarDates).sort();
  if (explicitDates.length) {
    return { endsAt: explicitDates.at(-1)!, evidence: "explicit-operational-date" };
  }

  if (OPERATIONAL_EVENT.test(title)) {
    const month = title.match(/(?:^|[^\d])(20\d{2})년\s*(\d{1,2})월(?:[^\d]|$)/u);
    if (month) {
      const year = Number(month[1]);
      const monthNumber = Number(month[2]);
      const lastDay = monthNumber >= 1 && monthNumber <= 12
        ? new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
        : 0;
      const endsAt = calendarDate(year, monthNumber, lastDay);
      if (endsAt) return { endsAt, evidence: "event-title-month" };
    }
  }

  // Some historical K-Startup catalogue rows omit every provider date while
  // keeping an annual edition in the beginning of the title. A recent crawl of
  // such a row proves only that the archive still returns it, not that the old
  // edition is currently operating. Keep this deliberately source-specific and
  // anchored so incidental years and unrelated providers are never classified.
  const id = typeof input.id === "string" ? input.id : "";
  const hasProviderDate = [
    input.publishedAt,
    input.sourceUpdatedAt,
    input.applicationStartsAt,
    input.expiresAt,
  ].some((value) => normalizePublicDate(value) !== null);
  if (id.startsWith("kstartup-") && !hasProviderDate) {
    const edition = title.normalize("NFKC").match(
      /^\s*(?:\[[^\]\r\n]{1,40}\]\s*)?(20\d{2})(?:년(?:도)?(?=\s|[·:：()\-–—]|$)|(?=\s))/u,
    );
    const year = Number(edition?.[1]);
    const endsAt = Number.isInteger(year) ? calendarDate(year, 12, 31) : null;
    if (endsAt) return { endsAt, evidence: "kstartup-title-year" };
  }
  return { endsAt: null, evidence: null };
}

export type PublicApplicationPeriod = {
  status: "upcoming" | "within-period" | "deadline-known" | "expired" | "unknown";
  startsAt: string | null;
  expiresAt: string | null;
};

/** A stated date range is not a guarantee that an application is still accepted. */
export function publicApplicationPeriod(
  item: { applicationStartsAt?: unknown; expiresAt?: unknown },
  now = Date.now(),
): PublicApplicationPeriod {
  const startsAt = normalizePublicDate(item.applicationStartsAt);
  const expiresAt = normalizePublicDate(item.expiresAt);
  if (startsAt && expiresAt && startsAt > expiresAt) return { status: "unknown", startsAt, expiresAt };
  if (expiresAt && publicDateEnd(expiresAt)! < now) return { status: "expired", startsAt, expiresAt };
  if (startsAt && Date.parse(`${startsAt}T00:00:00+09:00`) > now) return { status: "upcoming", startsAt, expiresAt };
  return { status: startsAt && expiresAt ? "within-period" : expiresAt ? "deadline-known" : "unknown", startsAt, expiresAt };
}

export function publicApplicationPeriodLabel(startsAt: unknown, expiresAt: unknown) {
  const period = publicApplicationPeriod({ applicationStartsAt: startsAt, expiresAt });
  if (period.startsAt && period.expiresAt) {
    return period.startsAt <= period.expiresAt
      ? `신청기간 ${period.startsAt} ~ ${period.expiresAt}`
      : "신청기간 미확인 (제공 날짜의 순서가 맞지 않아 원문 확인 필요)";
  }
  if (period.expiresAt) return `신청마감 ${period.expiresAt} (시작일 미확인)`;
  if (period.startsAt) return `신청시작 ${period.startsAt} (마감일 미확인)`;
  return "신청기간 미확인 (원문 확인 필요)";
}

/** Repair only the known YouthCenter zero-sentinel conversion; never erase an
 * old date merely because it is old. Caller persists the returned copy. */
export function repairYouthPolicyApplicationDates<T extends {
  id: string; summary: string; applicationStartsAt?: string | null; expiresAt?: string | null;
}>(item: T): T {
  if (!item.id.startsWith("youth-center-")) return item;
  const zeroPeriod = /(?:^| · )신청기간\s+0\s*[~～]\s*0(?=\s*(?:·|$))/u;
  const hasZeroPeriod = zeroPeriod.test(item.summary);
  const legacyZero = /^(?:1999-12-31T15:00:00(?:\.000)?Z|2000-01-01(?:T00:00:00(?:\.000)?Z)?)$/u;
  // Recover only the explicit, whole-date range appended by the adapter, not
  // incidental event dates or month/day mentions inside the policy prose.
  const explicitRange = item.summary.match(/(?:^| · )신청기간\s+([^~～·]+?)\s*[~～]\s*([^·]+?)\s*$/u);
  const rangeStart = normalizePublicDate(explicitRange?.[1]);
  const rangeEnd = normalizePublicDate(explicitRange?.[2]);
  const expiresAt = hasZeroPeriod && legacyZero.test(item.expiresAt ?? "") ? null
    : normalizePublicDate(item.expiresAt) ?? (rangeStart && rangeEnd ? rangeEnd : null);
  const startsAt = hasZeroPeriod && legacyZero.test(item.applicationStartsAt ?? "") ? null
    : normalizePublicDate(item.applicationStartsAt) ?? (rangeStart && rangeEnd ? rangeStart : null);
  const summary = hasZeroPeriod
    ? item.summary.replace(zeroPeriod, (match) => `${match.startsWith(" · ") ? " · " : ""}${publicApplicationPeriodLabel(startsAt, expiresAt)}`)
    : item.summary;
  return { ...item, summary,
    ...("applicationStartsAt" in item || startsAt ? { applicationStartsAt: startsAt } : {}),
    ...("expiresAt" in item || expiresAt ? { expiresAt } : {}),
  };
}
