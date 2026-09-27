import {
  emptyPublicDataPayload,
  PUBLIC_CATEGORIES,
  type PublicCommercialArea,
  type PublicCommercialAreaAnalytics,
  type PublicDataPayload,
  type PublicBackfillCheckpoint,
  type PublicBackfillPageCommit,
  type PublicEmploymentStatistic,
  type PublicInformationCategory,
  type PublicInformationItem,
} from "./types";
import { isPublicQuotaDay, kstQuotaDay, type PublicSourcePolicy } from "./policies";
import { safePublicHttpUrl } from "./urls";
import { publicDateInstant, publicItemRecency, publicItemVerificationInstant, repairYouthPolicySourceDates } from "./dates";

const SNAPSHOT_KEY = "home-overview-v1";
export const PUBLIC_REFRESH_LOCK_MS = 5 * 60_000;
export const PUBLIC_SOURCE_RESERVATION_RECOVERY_BACKOFF_MS = 15 * 60_000;
export const PUBLIC_SNAPSHOT_MAX_BYTES = 1_900_000;
export const PUBLIC_SNAPSHOT_MAX_COMPACT_SEOUL_AREAS = 2_000;
const COMPACT_PAYLOAD_KEY = "__boraCompact";
const COMPACT_SEOUL_VERSION = 1;
const COMPACT_STRING_LIMIT = 20_000;
const OFFICIAL_HOURS = [0, 6, 11, 14, 17, 21] as const;
const YOUTH_CATALOG_KEY = "current";
const YOUTH_CATALOG_CHUNK_SIZE = 100;
export const YOUTH_CATALOG_MAX_ITEMS = 3_000;
const SOURCE_CATALOG_CHUNK_SIZE = 100;
// Full official catalogues currently peak below 30k items. Keep them outside
// the compact home snapshot, but do not silently discard them at the old 10k
// boundary. 50k remains below the existing 100k per-category validation cap.
export const SOURCE_CATALOG_MAX_ITEMS = 50_000;
export const CATEGORY_CATALOG_MAX_ITEMS = 100_000;
const BACKFILL_PAGE_MAX_ITEMS = 1_000;
const BACKFILL_PAGE_MAX_BYTES = 1_500_000;

type SnapshotRow = {
  payload: string;
  status: string;
  itemCount: number;
  lastSuccessfulAt: number | null;
  nextRefreshAt: number;
  lastAttemptAt: number;
  lockUntil: number;
  lastError: string | null;
};

type PublicApiSourceStateRow = {
  sourceId: string;
  quotaDay: string;
  usedCalls: number;
  reservedCalls: number;
  dailyLimit: number;
  quotaVerified: number;
  nextDueAt: number;
  lastSuccessAt: number | null;
  lastAttemptAt: number;
  backoffUntil: number;
  consecutiveFailures: number;
  lastError: string | null;
  updatedAt: number;
};

export type PublicApiInteractiveReservation = {
  token: string;
  sourceId: string;
  quotaDay: string;
  reservedCalls: number;
  attemptAt: number;
};

let schemaReady: Promise<D1Database> | null = null;

async function database() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const { env } = await import("cloudflare:workers");
      if (!env.DB) throw new Error("public_data_storage_unavailable");
      const db = env.DB;
      const existing = await db.prepare(`SELECT COUNT(*) AS tableCount FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'public_data_snapshots', 'public_data_user_reads', 'public_api_source_state',
          'public_api_backfill_checkpoints', 'public_api_backfill_pages',
          'public_api_interactive_reservations'
        )`).first<{ tableCount: number }>();
      if (Number(existing?.tableCount) === 6) return db;
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS public_data_snapshots (
          cache_key TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'empty',
          item_count INTEGER NOT NULL DEFAULT 0,
          last_successful_at INTEGER,
          next_refresh_at INTEGER NOT NULL DEFAULT 0,
          last_attempt_at INTEGER NOT NULL DEFAULT 0,
          lock_until INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          updated_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS public_data_user_reads (
          user_id TEXT NOT NULL REFERENCES oauth_users(id) ON DELETE CASCADE,
          category TEXT NOT NULL,
          seen_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, category)
        )`),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS public_data_user_reads_seen_idx ON public_data_user_reads (user_id, seen_at)",
        ),
        db.prepare(`CREATE TABLE IF NOT EXISTS public_api_source_state (
          source_id TEXT PRIMARY KEY NOT NULL,
          quota_day TEXT NOT NULL DEFAULT '',
          used_calls INTEGER NOT NULL DEFAULT 0,
          reserved_calls INTEGER NOT NULL DEFAULT 0,
          daily_limit INTEGER NOT NULL DEFAULT 0,
          quota_verified INTEGER NOT NULL DEFAULT 0,
          next_due_at INTEGER NOT NULL DEFAULT 0,
          last_success_at INTEGER,
          last_attempt_at INTEGER NOT NULL DEFAULT 0,
          backoff_until INTEGER NOT NULL DEFAULT 0,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          updated_at INTEGER NOT NULL
        )`),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS public_api_source_state_due_idx ON public_api_source_state (next_due_at, backoff_until)",
        ),
        db.prepare(`CREATE TABLE IF NOT EXISTS public_api_interactive_reservations (
          reservation_token TEXT PRIMARY KEY NOT NULL,
          source_id TEXT NOT NULL,
          quota_day TEXT NOT NULL,
          reserved_calls INTEGER NOT NULL CHECK (reserved_calls > 0),
          attempt_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS public_api_interactive_reservations_source_idx
          ON public_api_interactive_reservations (source_id, quota_day, created_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS public_api_backfill_checkpoints (
          source_id TEXT PRIMARY KEY NOT NULL,
          query_signature TEXT NOT NULL,
          query_state TEXT NOT NULL DEFAULT '{}',
          next_page INTEGER NOT NULL DEFAULT 1 CHECK (next_page >= 1),
          page_size INTEGER NOT NULL CHECK (page_size >= 1),
          provider_total_count INTEGER,
          fetched_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
          completed INTEGER NOT NULL DEFAULT 0,
          latest_refresh_at INTEGER,
          completed_at INTEGER,
          updated_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS public_api_backfill_checkpoint_status_idx
          ON public_api_backfill_checkpoints (completed, updated_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS public_api_backfill_pages (
          source_id TEXT NOT NULL,
          query_signature TEXT NOT NULL,
          page_number INTEGER NOT NULL CHECK (page_number >= 0),
          payload TEXT NOT NULL,
          item_count INTEGER NOT NULL CHECK (item_count >= 0),
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (source_id, query_signature, page_number)
        )`),
      ]);
      return db;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function rowQuery() {
  return `SELECT payload, status, item_count AS itemCount,
    last_successful_at AS lastSuccessfulAt, next_refresh_at AS nextRefreshAt,
    last_attempt_at AS lastAttemptAt, lock_until AS lockUntil,
    last_error AS lastError
    FROM public_data_snapshots WHERE cache_key = ?`;
}

export async function readPublicSnapshot(): Promise<SnapshotRow | null> {
  const db = await database();
  return db.prepare(rowQuery()).bind(SNAPSHOT_KEY).first<SnapshotRow>();
}

export function parseSnapshotPayload(row: SnapshotRow | null): PublicDataPayload | null {
  if (!row?.lastSuccessfulAt) return null;
  return parseStoredPayload(row.payload);
}

export function parseSnapshotViewPayload(row: SnapshotRow | null): PublicDataPayload | null {
  if (!row) return null;
  return parseStoredPayload(row.payload);
}

const MAX_COMMERCIAL_INDUSTRIES = 24;
const MAX_COMMERCIAL_HOURLY_BUCKETS = 6;

function normalizedBoundedText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().slice(0, maximumLength);
  return normalized || null;
}

function normalizedSafeCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function normalizeStoredEmploymentStatistic(
  value: unknown,
): PublicEmploymentStatistic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.group !== "youth" && row.group !== "older-adult" && row.group !== "foreigner") {
    return null;
  }
  const groupLabel = normalizedBoundedText(row.groupLabel, 80);
  const period = normalizedBoundedText(row.period, 30);
  const tableId = typeof row.tableId === "string" && /^DT_[A-Z0-9]{4,30}$/u.test(row.tableId)
    ? row.tableId
    : null;
  if (!groupLabel || !period || !tableId || !Array.isArray(row.metrics)
    || row.metrics.length < 1 || row.metrics.length > 8) return null;
  const names = new Set<string>();
  const metrics = row.metrics.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const metric = candidate as Record<string, unknown>;
    const name = normalizedBoundedText(metric.name, 100);
    const unit = normalizedBoundedText(metric.unit, 30);
    const value = metric.value;
    if (!name || !unit || names.has(name) || typeof value !== "number"
      || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) return [];
    names.add(name);
    return [{ name, value, unit }];
  });
  if (metrics.length !== row.metrics.length) return null;
  return { group: row.group, groupLabel, period, metrics, tableId };
}

function isOfficialKosisEmploymentUrl(value: string, tableId: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "kosis.kr"
      && url.pathname === "/statHtml/statHtml.do"
      && url.searchParams.get("tblId") === tableId;
  } catch {
    return false;
  }
}

function normalizeStoredCommercialAnalytics(value: unknown): PublicCommercialAreaAnalytics | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const officialCode = typeof row.officialCode === "string" && /^\d{7,10}$/u.test(row.officialCode)
    ? row.officialCode
    : null;
  const referenceQuarter = typeof row.referenceQuarter === "string"
    && /^20\d{2}[1-4]$/u.test(row.referenceQuarter)
    ? row.referenceQuarter
    : null;
  const sourceUrlInput = typeof row.sourceUrl === "string" && row.sourceUrl.length <= 2_048
    ? row.sourceUrl
    : null;
  const sourceUrl = safePublicHttpUrl(sourceUrlInput);
  let sourceOrigin: URL | null = null;
  try {
    sourceOrigin = sourceUrl ? new URL(sourceUrl) : null;
  } catch {
    sourceOrigin = null;
  }
  if (!officialCode || !referenceQuarter || !sourceUrl || sourceOrigin?.protocol !== "https:"
    || sourceOrigin.hostname !== "data.seoul.go.kr") return null;

  const areaType = row.areaType === null
    ? null
    : normalizedBoundedText(row.areaType, 120);
  if (row.areaType !== null && areaType === null) return null;

  const estimatedTotalSales = row.estimatedTotalSales === null
    ? null
    : normalizedSafeCount(row.estimatedTotalSales);
  if (row.estimatedTotalSales !== null && estimatedTotalSales === null) return null;

  if (!Array.isArray(row.industrySalesComposition)
    || row.industrySalesComposition.length > MAX_COMMERCIAL_INDUSTRIES) return null;
  const industryNames = new Set<string>();
  const industrySalesComposition = row.industrySalesComposition.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const entry = value as Record<string, unknown>;
    const name = normalizedBoundedText(entry.name, 120);
    const sharePercent = entry.sharePercent;
    if (!name || industryNames.has(name) || entry.storeCount !== null
      || typeof sharePercent !== "number" || !Number.isFinite(sharePercent)
      || sharePercent < 0 || sharePercent > 100) return [];
    industryNames.add(name);
    return [{ name, sharePercent, storeCount: null as null }];
  });
  const industryShareTotal = industrySalesComposition.reduce(
    (sum, entry) => sum + entry.sharePercent,
    0,
  );
  if (industrySalesComposition.length !== row.industrySalesComposition.length
    || industryShareTotal > 100.5) return null;

  function normalizeHourlySeries(
    value: unknown,
    field: "amount" | "people",
  ): Array<{ hour: number; value: number }> | null {
    if (!Array.isArray(value)
      || (value.length !== 0 && value.length !== MAX_COMMERCIAL_HOURLY_BUCKETS)) return null;
    const seen = new Set<number>();
    const normalized = value.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
      const entry = candidate as Record<string, unknown>;
      const hour = entry.hour;
      const count = normalizedSafeCount(entry[field]);
      if (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23
        || seen.has(hour) || count === null) return [];
      seen.add(hour);
      return [{ hour, value: count }];
    }).sort((left, right) => left.hour - right.hour);
    if (normalized.length !== value.length) return null;
    const officialHours = [0, 6, 11, 14, 17, 21];
    return normalized.length === 0
      || normalized.every((entry, index) => entry.hour === officialHours[index])
      ? normalized
      : null;
  }

  const normalizedSales = normalizeHourlySeries(row.salesByHour, "amount");
  const normalizedFootfall = normalizeHourlySeries(row.footfallByHour, "people");
  if (!normalizedSales || !normalizedFootfall) return null;

  return {
    officialCode,
    referenceQuarter,
    areaType,
    estimatedTotalSales,
    industrySalesComposition,
    salesByHour: normalizedSales.map(({ hour, value }) => ({ hour, amount: value })),
    footfallByHour: normalizedFootfall.map(({ hour, value }) => ({ hour, people: value })),
    sourceUrl,
  };
}

function isOfficialSeoulDataUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "data.seoul.go.kr";
  } catch {
    return false;
  }
}

function hasStoredCommercialAnalytics(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const commercialArea = (value as Record<string, unknown>).commercialArea;
  if (!commercialArea || typeof commercialArea !== "object" || Array.isArray(commercialArea)) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(commercialArea, "analytics")
    && (commercialArea as Record<string, unknown>).analytics != null;
}

function isValidStoredSeoulAnalyticsItem(
  item: PublicInformationItem,
  groupId: PublicInformationCategory,
) {
  const analytics = item.commercialArea?.analytics;
  if (!analytics) return true;
  const code = /^seoul-commercial-(\d{7,10})$/u.exec(item.id)?.[1] ?? null;
  return code !== null
    && code === analytics.officialCode
    && groupId === "startup"
    && item.category === "startup"
    && isOfficialSeoulDataUrl(item.sourceUrl)
    && isOfficialSeoulDataUrl(analytics.sourceUrl);
}

export function normalizeStoredCommercialArea(value: unknown): PublicCommercialArea | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const rawArea = typeof row.areaSquareMeters === "number"
    || (typeof row.areaSquareMeters === "string" && row.areaSquareMeters.trim().length > 0)
    ? Number(row.areaSquareMeters)
    : Number.NaN;
  const areaSquareMeters = Number.isFinite(rawArea) && rawArea > 0 ? rawArea : null;
  const referenceDate = typeof row.referenceDate === "string"
    && /^\d{4}-\d{2}-\d{2}$/u.test(row.referenceDate)
    ? row.referenceDate
    : null;
  const rawCoordinateCount = typeof row.coordinateCount === "number"
    || (typeof row.coordinateCount === "string" && row.coordinateCount.trim().length > 0)
    ? Number(row.coordinateCount)
    : Number.NaN;
  const coordinateCount = Number.isSafeInteger(rawCoordinateCount) && rawCoordinateCount >= 0
    ? rawCoordinateCount
    : null;
  const storedBoundary = row.displayBoundary && typeof row.displayBoundary === "object"
    && !Array.isArray(row.displayBoundary)
    ? row.displayBoundary as Record<string, unknown>
    : null;
  const boundaryPoints = Array.isArray(storedBoundary?.points)
    ? storedBoundary.points.flatMap((point) => {
      if (!Array.isArray(point) || point.length < 2) return [];
      const longitude = Number(point[0]);
      const latitude = Number(point[1]);
      return Number.isFinite(longitude) && longitude >= 124 && longitude <= 132
        && Number.isFinite(latitude) && latitude >= 32 && latitude <= 40
        ? [[longitude, latitude] as [number, number]]
        : [];
    }).slice(0, 96)
    : [];
  const displayBoundary = boundaryPoints.length >= 4
    ? { points: boundaryPoints, simplified: storedBoundary?.simplified === true }
    : null;
  const analytics = normalizeStoredCommercialAnalytics(row.analytics);
  if (areaSquareMeters === null && referenceDate === null && coordinateCount === null
    && !displayBoundary && !analytics) return null;
  return {
    areaSquareMeters,
    referenceDate,
    coordinateCount,
    ...(displayBoundary ? { displayBoundary } : {}),
    ...(analytics ? { analytics } : {}),
  };
}

function compactStringTable() {
  const values: string[] = [];
  const indexes = new Map<string, number>();
  return {
    values,
    intern(value: string) {
      if (typeof value !== "string" || value.length > 2_048) {
        throw new Error("public_snapshot_invalid_compact_string");
      }
      const existing = indexes.get(value);
      if (existing !== undefined) return existing;
      if (values.length >= COMPACT_STRING_LIMIT) throw new Error("public_snapshot_compact_dictionary_full");
      const index = values.length;
      values.push(value);
      indexes.set(value, index);
      return index;
    },
  };
}

function compactSeoulItem(
  item: PublicInformationItem,
  intern: (value: string) => number,
) {
  if (!item.commercialArea?.analytics) return null;
  const code = /^seoul-commercial-(\d{7,10})$/u.exec(item.id)?.[1] ?? null;
  if (!code || item.category !== "startup" || !isOfficialSeoulDataUrl(item.sourceUrl)
    || !isOfficialSeoulDataUrl(item.commercialArea.analytics.sourceUrl)) {
    throw new Error("public_snapshot_invalid_seoul_analytics");
  }
  const commercialArea = normalizeStoredCommercialArea(item.commercialArea);
  const analytics = commercialArea?.analytics;
  if (!commercialArea || !analytics || analytics.officialCode !== code) {
    throw new Error("public_snapshot_invalid_seoul_analytics");
  }
  const nullable = (value: string | null | undefined) => value == null ? null : intern(value);
  const location = item.location
    ? [
      intern(item.location.label),
      nullable(item.location.roadAddress),
      nullable(item.location.province),
      nullable(item.location.city),
      nullable(item.location.neighborhood),
      item.location.latitude ?? null,
      item.location.longitude ?? null,
      intern(item.location.precision),
    ]
    : null;
  const boundary = commercialArea.displayBoundary
    ? [commercialArea.displayBoundary.points, commercialArea.displayBoundary.simplified ? 1 : 0]
    : null;
  return [
    intern(code),
    intern(item.title),
    intern(item.summary),
    intern(item.source),
    intern(item.sourceUrl),
    nullable(item.sourceLinkKind),
    nullable(item.publishedAt),
    intern(item.discoveredAt),
    nullable(item.expiresAt),
    nullable(item.lastVerifiedAt),
    item.tags.map(intern),
    location,
    [
      commercialArea.areaSquareMeters,
      nullable(commercialArea.referenceDate),
      commercialArea.coordinateCount,
      boundary,
    ],
    [
      intern(analytics.referenceQuarter),
      nullable(analytics.areaType),
      analytics.estimatedTotalSales,
      analytics.industrySalesComposition.map((entry) => [intern(entry.name), entry.sharePercent]),
      analytics.salesByHour.map((entry) => entry.amount),
      analytics.footfallByHour.map((entry) => entry.people),
      intern(analytics.sourceUrl),
    ],
  ];
}

export function serializePublicDataPayload(payload: PublicDataPayload) {
  const seoulAnalyticsCount = payload.categories.reduce((total, group) => (
    total + group.items.filter((item) => Boolean(item.commercialArea?.analytics)).length
  ), 0);
  if (seoulAnalyticsCount > PUBLIC_SNAPSHOT_MAX_COMPACT_SEOUL_AREAS) {
    throw new Error("public_snapshot_too_many_seoul_areas");
  }
  const strings = compactStringTable();
  const compactRows: unknown[] = [];
  const categories = payload.categories.map((group) => ({
    ...group,
    items: group.items.flatMap((item) => {
      const row = compactSeoulItem(item, strings.intern);
      if (!row) return [item];
      compactRows.push(row);
      return [];
    }),
  }));
  if (compactRows.length > PUBLIC_SNAPSHOT_MAX_COMPACT_SEOUL_AREAS) {
    throw new Error("public_snapshot_too_many_seoul_areas");
  }
  const stored = {
    ...payload,
    categories,
    ...(compactRows.length ? {
      [COMPACT_PAYLOAD_KEY]: {
        v: COMPACT_SEOUL_VERSION,
        d: strings.values,
        r: compactRows,
      },
    } : {}),
  };
  const serialized = JSON.stringify(stored);
  if (new TextEncoder().encode(serialized).byteLength >= PUBLIC_SNAPSHOT_MAX_BYTES) {
    throw new Error("public_snapshot_too_large");
  }
  return serialized;
}

function decodeCompactSeoulItems(value: unknown): PublicInformationItem[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const compact = value as Record<string, unknown>;
  if (compact.v !== COMPACT_SEOUL_VERSION || !Array.isArray(compact.d) || !Array.isArray(compact.r)
    || compact.d.length > COMPACT_STRING_LIMIT
    || compact.r.length > PUBLIC_SNAPSHOT_MAX_COMPACT_SEOUL_AREAS) return null;
  const dictionary = compact.d;
  if (dictionary.some((entry) => typeof entry !== "string" || entry.length > 2_048)
    || new Set(dictionary).size !== dictionary.length) return null;
  const decode = (index: unknown, maximumLength = 2_048) => {
    if (!Number.isSafeInteger(index) || Number(index) < 0 || Number(index) >= dictionary.length) return null;
    const value = dictionary[Number(index)];
    return typeof value === "string" && value.length <= maximumLength ? value : null;
  };
  const nullableDecode = (index: unknown, maximumLength = 2_048): string | null | undefined => {
    if (index === null) return null;
    return decode(index, maximumLength) ?? undefined;
  };
  const safeCount = (value: unknown) => (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
  );

  const items: PublicInformationItem[] = [];
  const ids = new Set<string>();
  for (const candidate of compact.r) {
    if (!Array.isArray(candidate) || candidate.length !== 14) return null;
    const [
      codeIndex, titleIndex, summaryIndex, sourceIndex, sourceUrlIndex,
      linkKindIndex, publishedIndex, discoveredIndex, expiresIndex,
      verifiedIndex, tagIndexes, locationTuple, areaTuple, analyticsTuple,
    ] = candidate;
    const code = decode(codeIndex, 10);
    const title = decode(titleIndex, 180);
    const summary = decode(summaryIndex, 500);
    const source = decode(sourceIndex, 180);
    const sourceUrl = safePublicHttpUrl(decode(sourceUrlIndex));
    const linkKind = nullableDecode(linkKindIndex, 20);
    const publishedAt = nullableDecode(publishedIndex, 20);
    const discoveredAt = decode(discoveredIndex, 40);
    const expiresAt = nullableDecode(expiresIndex, 20);
    const lastVerifiedAt = nullableDecode(verifiedIndex, 40);
    if (!code || !/^\d{7,10}$/u.test(code) || !title || !summary || !source || !sourceUrl
      || linkKind === undefined || publishedAt === undefined || expiresAt === undefined
      || lastVerifiedAt === undefined
      || (linkKind !== null && linkKind !== "detail" && linkKind !== "dataset")
      || (publishedAt !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(publishedAt))
      || !discoveredAt || !Number.isFinite(Date.parse(discoveredAt))
      || (expiresAt !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(expiresAt))
      || (lastVerifiedAt !== null && !Number.isFinite(Date.parse(lastVerifiedAt)))) return null;

    if (!Array.isArray(tagIndexes) || tagIndexes.length > 32) return null;
    const tags = tagIndexes.map((index) => decode(index, 120));
    if (tags.some((tag) => tag === null)) return null;

    let location: PublicInformationItem["location"];
    if (locationTuple !== null) {
      if (!Array.isArray(locationTuple) || locationTuple.length !== 8) return null;
      const [labelIndex, roadIndex, provinceIndex, cityIndex, neighborhoodIndex, latitude, longitude, precisionIndex] = locationTuple;
      const label = decode(labelIndex, 180);
      const roadAddress = nullableDecode(roadIndex, 240);
      const province = nullableDecode(provinceIndex, 120);
      const city = nullableDecode(cityIndex, 120);
      const neighborhood = nullableDecode(neighborhoodIndex, 120);
      const precision = decode(precisionIndex, 30);
      if (!label || !precision || !["point", "road-address", "administrative"].includes(precision)
        || roadAddress === undefined || province === undefined || city === undefined
        || neighborhood === undefined
        || (latitude !== null && (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < 32 || latitude > 40))
        || (longitude !== null && (typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < 124 || longitude > 132))) return null;
      location = {
        label,
        ...(roadAddress ? { roadAddress } : {}),
        ...(province ? { province } : {}),
        ...(city ? { city } : {}),
        ...(neighborhood ? { neighborhood } : {}),
        ...(latitude !== null ? { latitude } : {}),
        ...(longitude !== null ? { longitude } : {}),
        precision: precision as "point" | "road-address" | "administrative",
      };
    }

    if (!Array.isArray(areaTuple) || areaTuple.length !== 4
      || !Array.isArray(analyticsTuple) || analyticsTuple.length !== 7) return null;
    const [areaSquareMeters, referenceDateIndex, coordinateCount, boundaryTuple] = areaTuple;
    const [quarterIndex, areaTypeIndex, estimatedTotalSales, industryTuples, salesAmounts, footfallCounts, analyticsUrlIndex] = analyticsTuple;
    const referenceDate = nullableDecode(referenceDateIndex, 20);
    const referenceQuarter = decode(quarterIndex, 8);
    const areaType = nullableDecode(areaTypeIndex, 120);
    const analyticsSourceUrl = decode(analyticsUrlIndex);
    if (referenceDate === undefined || areaType === undefined
      || !referenceQuarter || !analyticsSourceUrl || !Array.isArray(industryTuples)
      || industryTuples.length > MAX_COMMERCIAL_INDUSTRIES
      || !Array.isArray(salesAmounts)
      || (salesAmounts.length !== 0 && salesAmounts.length !== OFFICIAL_HOURS.length)
      || !Array.isArray(footfallCounts)
      || (footfallCounts.length !== 0 && footfallCounts.length !== OFFICIAL_HOURS.length)) return null;
    const industrySalesComposition = industryTuples.map((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2) return null;
      const name = decode(entry[0], 120);
      const sharePercent = entry[1];
      return name && typeof sharePercent === "number" && Number.isFinite(sharePercent)
        ? { name, sharePercent, storeCount: null as null }
        : null;
    });
    if (industrySalesComposition.some((entry) => entry === null)) return null;
    const normalizedSales = salesAmounts.map(safeCount);
    const normalizedFootfall = footfallCounts.map(safeCount);
    if (normalizedSales.some((amount) => amount === null)
      || normalizedFootfall.some((people) => people === null)) return null;
    let displayBoundary: unknown;
    if (boundaryTuple !== null) {
      if (!Array.isArray(boundaryTuple) || boundaryTuple.length !== 2
        || !Array.isArray(boundaryTuple[0]) || (boundaryTuple[1] !== 0 && boundaryTuple[1] !== 1)) return null;
      displayBoundary = { points: boundaryTuple[0], simplified: boundaryTuple[1] === 1 };
    }
    const commercialArea = normalizeStoredCommercialArea({
      areaSquareMeters,
      referenceDate,
      coordinateCount,
      ...(displayBoundary ? { displayBoundary } : {}),
      analytics: {
        officialCode: code,
        referenceQuarter,
        areaType,
        estimatedTotalSales,
        industrySalesComposition,
        salesByHour: normalizedSales.length
          ? OFFICIAL_HOURS.map((hour, index) => ({ hour, amount: normalizedSales[index] }))
          : [],
        footfallByHour: normalizedFootfall.length
          ? OFFICIAL_HOURS.map((hour, index) => ({ hour, people: normalizedFootfall[index] }))
          : [],
        sourceUrl: analyticsSourceUrl,
      },
    });
    if (!commercialArea?.analytics || commercialArea.analytics.officialCode !== code) return null;
    const id = `seoul-commercial-${code}`;
    if (ids.has(id)) return null;
    ids.add(id);
    items.push({
      id,
      category: "startup",
      title,
      summary,
      source,
      sourceUrl,
      ...(linkKind ? { sourceLinkKind: linkKind } : {}),
      publishedAt,
      discoveredAt,
      ...(expiresAt ? { expiresAt } : {}),
      ...(lastVerifiedAt ? { lastVerifiedAt } : {}),
      tags: tags as string[],
      ...(location ? { location } : {}),
      commercialArea,
    });
  }
  return items;
}

export function parseStoredPayload(payload: string, now = Date.now()): PublicDataPayload | null {
  try {
    const parsed = JSON.parse(payload) as Partial<PublicDataPayload> & Record<string, unknown>;
    if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.sources)) return null;
    const compactItems = parsed[COMPACT_PAYLOAD_KEY] === undefined
      ? []
      : decodeCompactSeoulItems(parsed[COMPACT_PAYLOAD_KEY]);
    if (compactItems === null) return null;
    if (compactItems.length) {
      const startup = parsed.categories.find((group) => group?.id === "startup");
      if (!startup) return null;
      startup.items = [...(Array.isArray(startup.items) ? startup.items : []), ...compactItems];
    }
    delete parsed[COMPACT_PAYLOAD_KEY];
    const data = parsed as PublicDataPayload;
    data.categories = data.categories.map((group) => {
      const items = Array.isArray(group.items)
        ? group.items.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const hadAnalytics = hasStoredCommercialAnalytics(item);
          const sourceUrl = safePublicHttpUrl(item.sourceUrl);
          if (!sourceUrl) {
            if (hadAnalytics) throw new Error("public_snapshot_invalid_seoul_analytics");
            return [];
          }
          const commercialArea = normalizeStoredCommercialArea(item.commercialArea);
          const hadEmploymentStatistic = Object.prototype.hasOwnProperty.call(item, "employmentStatistic")
            && item.employmentStatistic != null;
          const employmentStatistic = normalizeStoredEmploymentStatistic(item.employmentStatistic);
          const storedItem = { ...item };
          delete storedItem.commercialArea;
          delete storedItem.employmentStatistic;
          const normalizedItem = {
            ...storedItem,
            sourceUrl,
            ...(commercialArea ? { commercialArea } : {}),
            ...(employmentStatistic ? { employmentStatistic } : {}),
          } as PublicInformationItem;
          if ((hadAnalytics && !commercialArea?.analytics)
            || !isValidStoredSeoulAnalyticsItem(normalizedItem, group.id)) {
            throw new Error("public_snapshot_invalid_seoul_analytics");
          }
          if (hadEmploymentStatistic && (
            !employmentStatistic
            || group.id !== "employment"
            || normalizedItem.category !== "employment"
            || !normalizedItem.id.startsWith("kosis-employment-")
            || !isOfficialKosisEmploymentUrl(sourceUrl, employmentStatistic.tableId)
          )) {
            return [];
          }
          return [repairYouthPolicySourceDates(normalizedItem, now)];
        })
        : [];
      return {
        ...group,
        items,
        totalCount: items.length,
        newCount: Math.min(Number(group.newCount) || 0, items.length),
      };
    });
    const storedIds = data.categories.flatMap((group) => group.items.map((item) => item.id));
    if (new Set(storedIds).size !== storedIds.length) return null;
    const storedSeoulAnalyticsCount = data.categories.reduce((total, group) => (
      total + group.items.filter((item) => Boolean(item.commercialArea?.analytics)).length
    ), 0);
    if (storedSeoulAnalyticsCount > PUBLIC_SNAPSHOT_MAX_COMPACT_SEOUL_AREAS) return null;
    if (data.exchange) {
      data.exchange.sourceUrl = safePublicHttpUrl(data.exchange.sourceUrl) ?? "";
    }
    data.market = Array.isArray(data.market)
      ? data.market.map((item) => ({ ...item, sourceUrl: safePublicHttpUrl(item.sourceUrl) ?? "" }))
      : [];
    data.sources = data.sources.map((item) => ({
      ...item,
      sourceUrl: safePublicHttpUrl(item.sourceUrl) ?? "",
    }));
    return data;
  } catch {
    return null;
  }
}

const youthCatalogTableReady = new WeakMap<D1Database, Promise<void>>();
const publicCatalogTablesReady = new WeakMap<D1Database, Promise<void>>();

async function ensureYouthPolicyCatalogTable(db: D1Database) {
  const existing = youthCatalogTableReady.get(db);
  if (existing) return existing;
  const initialization = db.prepare(`CREATE TABLE IF NOT EXISTS public_youth_policy_catalog_chunks (
    catalog_key TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    payload TEXT NOT NULL,
    item_count INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (catalog_key, chunk_index)
  )`).run().then(() => undefined).catch((error: unknown) => {
    if (youthCatalogTableReady.get(db) === initialization) youthCatalogTableReady.delete(db);
    throw error;
  });
  youthCatalogTableReady.set(db, initialization);
  return initialization;
}

async function ensurePublicSourceCatalogTable(db: D1Database) {
  const existing = publicCatalogTablesReady.get(db);
  if (existing) return existing;
  const initialization = (async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS public_data_catalog_chunks (
      source_id TEXT NOT NULL,
      category TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      payload TEXT NOT NULL,
      item_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (source_id, category, chunk_index)
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS public_data_catalog_chunks_category_idx
      ON public_data_catalog_chunks (category, source_id, chunk_index)`).run();
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS public_data_catalog_generations (
        source_id TEXT NOT NULL, generation_id TEXT NOT NULL, category TEXT NOT NULL,
        chunk_index INTEGER NOT NULL, payload TEXT NOT NULL,
        item_count INTEGER NOT NULL CHECK(item_count BETWEEN 1 AND ${SOURCE_CATALOG_CHUNK_SIZE}),
        created_at INTEGER NOT NULL,
        PRIMARY KEY(source_id, generation_id, category, chunk_index)) WITHOUT ROWID`),
      db.prepare(`CREATE INDEX IF NOT EXISTS public_data_catalog_generations_created_idx
        ON public_data_catalog_generations(source_id, created_at, generation_id)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS public_data_catalog_generation_pointers (
        source_id TEXT PRIMARY KEY NOT NULL, generation_id TEXT NOT NULL,
        item_count INTEGER NOT NULL CHECK(item_count >= 0), published_at INTEGER NOT NULL) WITHOUT ROWID`),
    ]);
  })().catch((error: unknown) => {
    if (publicCatalogTablesReady.get(db) === initialization) publicCatalogTablesReady.delete(db);
    throw error;
  });
  publicCatalogTablesReady.set(db, initialization);
  return initialization;
}

function validatedCatalogItems(
  items: readonly PublicInformationItem[],
  expectedCategory?: PublicInformationCategory,
  maximumItems = SOURCE_CATALOG_MAX_ITEMS,
) {
  if (items.length > maximumItems) {
    throw new Error("public_source_catalog_too_large");
  }
  const ids = new Set<string>();
  for (const item of items) {
    if (
      ids.has(item.id)
      || !PUBLIC_CATEGORIES.includes(item.category)
      || (expectedCategory && item.category !== expectedCategory)
    ) {
      throw new Error("public_source_catalog_invalid");
    }
    ids.add(item.id);
  }
  return [...items];
}

/**
 * Provider catalogues are bounded by newest verified records so an unusually
 * large upstream archive cannot make every later refresh fail permanently.
 * The provider's total/fetched counters remain separate and continue to expose
 * that the locally retained catalogue is a bounded view.
 */
export function boundPublicCatalogItems(
  items: readonly PublicInformationItem[],
  maximumItems = SOURCE_CATALOG_MAX_ITEMS,
  now = Date.now(),
) {
  const safeMaximum = Number.isSafeInteger(maximumItems) && maximumItems > 0
    ? Math.min(maximumItems, SOURCE_CATALOG_MAX_ITEMS)
    : SOURCE_CATALOG_MAX_ITEMS;
  const recency = new Map(items.map((item) => [item, publicItemRecency(item, now)]));
  const verification = new Map(items.map((item) => [item, publicItemVerificationInstant(item, now) ?? 0]));
  const bounded = [...items]
    .sort((left, right) => (
      (recency.get(right) ?? 0) - (recency.get(left) ?? 0)
      || (verification.get(right) ?? 0) - (verification.get(left) ?? 0)
      || left.id.localeCompare(right.id, "ko-KR")
    ))
    .slice(0, safeMaximum);
  return validatedCatalogItems(bounded);
}

/**
 * Stores one provider catalogue separately from the compact dashboard
 * snapshot. Readers validate the complete contiguous chunk sequence and fail
 * closed if they observe a refresh between bounded write batches.
 */
export async function savePublicSourceCatalog(
  sourceId: string,
  items: readonly PublicInformationItem[],
  now: number,
) {
  if (!/^[a-z0-9-]{2,80}$/u.test(sourceId)) return;
  const validated = validatedCatalogItems(items);
  const chunks: Array<{
    category: PublicInformationCategory;
    chunkIndex: number;
    items: PublicInformationItem[];
  }> = [];
  for (const category of PUBLIC_CATEGORIES) {
    const categoryItems = validated.filter((item) => item.category === category);
    for (let index = 0; index < categoryItems.length; index += SOURCE_CATALOG_CHUNK_SIZE) {
      chunks.push({
        category,
        chunkIndex: Math.trunc(index / SOURCE_CATALOG_CHUNK_SIZE),
        items: categoryItems.slice(index, index + SOURCE_CATALOG_CHUNK_SIZE),
      });
    }
  }
  const db = await database();
  await ensurePublicSourceCatalogTable(db);
  const generationId = `${now}-${crypto.randomUUID()}`;
  // A failed multi-batch staging attempt never reaches the pointer switch. On
  // retry, retain only the currently published generation (if one exists) and
  // discard every abandoned partial generation for this source. This cleanup
  // deliberately does not touch the live chunks table.
  await db.prepare(`DELETE FROM public_data_catalog_generations
    WHERE source_id = ? AND generation_id <> COALESCE((
      SELECT generation_id FROM public_data_catalog_generation_pointers
      WHERE source_id = ?
    ), '')`).bind(sourceId, sourceId).run();
  const statements = chunks.map(({ category, chunkIndex, items: chunk }) => {
    const payload = emptyPublicDataPayload();
    payload.categories = payload.categories.map((group) => group.id === category
      ? { ...group, items: chunk, totalCount: chunk.length }
      : group);
    return db.prepare(`INSERT INTO public_data_catalog_generations
      (source_id, generation_id, category, chunk_index, payload, item_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        sourceId,
        generationId,
        category,
        chunkIndex,
        serializePublicDataPayload(payload),
        chunk.length,
        now,
      );
  });
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
  // D1 batch is transactional. Readers and RAG triggers see either the entire
  // previous live generation or the entire replacement, never staged chunks.
  await db.batch([
    db.prepare("DELETE FROM public_data_catalog_chunks WHERE source_id = ?").bind(sourceId),
    db.prepare(`INSERT INTO public_data_catalog_chunks
      (source_id, category, chunk_index, payload, item_count, updated_at)
      SELECT source_id, category, chunk_index, payload, item_count, ?
      FROM public_data_catalog_generations
      WHERE source_id = ? AND generation_id = ?
      ORDER BY category, chunk_index`).bind(now, sourceId, generationId),
    db.prepare(`INSERT INTO public_data_catalog_generation_pointers
      (source_id, generation_id, item_count, published_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET generation_id=excluded.generation_id,
        item_count=excluded.item_count, published_at=excluded.published_at`)
      .bind(sourceId, generationId, validated.length, now),
  ]);
  await db.prepare(`DELETE FROM public_data_catalog_generations
    WHERE source_id = ? AND generation_id <> ?`).bind(sourceId, generationId).run();
}

async function readCatalogRows(
  whereSql: "source_id = ?" | "category = ?",
  value: string,
) {
  const db = await database();
  await ensurePublicSourceCatalogTable(db);
  const categoryRead = whereSql === "category = ?";
  const result = await db.prepare(`SELECT source_id AS sourceId, category,
    chunk_index AS chunkIndex, payload, item_count AS itemCount
    FROM public_data_catalog_chunks
    WHERE ${whereSql}
    ORDER BY ${categoryRead ? "chunk_index, source_id" : "source_id, chunk_index"}
    ${categoryRead ? `LIMIT ${Math.ceil(CATEGORY_CATALOG_MAX_ITEMS / SOURCE_CATALOG_CHUNK_SIZE)}` : ""}`).bind(value).all<{
      sourceId: string;
      category: string;
      chunkIndex: number;
      payload: string;
      itemCount: number;
    }>();
  return result.results ?? [];
}

function parseCatalogRows(
  rows: Array<{
    sourceId: string;
    category: string;
    chunkIndex: number;
    payload: string;
    itemCount: number;
  }>,
  expectedCategory?: PublicInformationCategory,
  maximumItems = SOURCE_CATALOG_MAX_ITEMS,
) {
  const items: PublicInformationItem[] = [];
  const nextIndex = new Map<string, number>();
  for (const row of rows) {
    const category = row.category as PublicInformationCategory;
    const sequenceKey = `${row.sourceId}:${category}`;
    const expected = nextIndex.get(sequenceKey) ?? 0;
    if (
      !PUBLIC_CATEGORIES.includes(category)
      || row.chunkIndex !== expected
      || !Number.isSafeInteger(row.itemCount)
      || row.itemCount < 1
      || row.itemCount > SOURCE_CATALOG_CHUNK_SIZE
    ) {
      throw new Error("public_source_catalog_invalid");
    }
    const payload = parseStoredPayload(row.payload);
    const chunk = payload?.categories.find((group) => group.id === category)?.items;
    if (!chunk || chunk.length !== row.itemCount) {
      throw new Error("public_source_catalog_invalid");
    }
    items.push(...chunk);
    nextIndex.set(sequenceKey, expected + 1);
  }
  return validatedCatalogItems(items, expectedCategory, maximumItems);
}

export async function readPublicSourceCatalog(sourceId: string) {
  if (!/^[a-z0-9-]{2,80}$/u.test(sourceId)) return [];
  return parseCatalogRows(await readCatalogRows("source_id = ?", sourceId));
}

const CATALOG_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const CATALOG_CACHE_TTL_MS = 60_000;
type CatalogCacheEntry = {
  revision: string;
  items: PublicInformationItem[];
  bytes: number;
  expiresAt: number;
};
const categoryCatalogCache = new WeakMap<D1Database, Map<string, CatalogCacheEntry>>();
const categoryCatalogLoads = new WeakMap<D1Database, Map<string, { revision: string; promise: Promise<PublicInformationItem[]> }>>();

async function categoryCatalogRevision(db: D1Database, category: PublicInformationCategory) {
  const result = await db.prepare(`SELECT c.source_id AS sourceId,
    COUNT(*) AS chunks, SUM(c.item_count) AS items,
    SUM(length(CAST(c.payload AS BLOB))) AS bytes,
    MIN(c.chunk_index) AS firstChunk, MAX(c.chunk_index) AS lastChunk,
    MAX(c.updated_at) AS updatedAt, p.generation_id AS generation
    FROM public_data_catalog_chunks c
    LEFT JOIN public_data_catalog_generation_pointers p ON p.source_id = c.source_id
    WHERE c.category = ? GROUP BY c.source_id ORDER BY c.source_id`).bind(category).all<{
      sourceId: string; chunks: number; items: number; bytes: number;
      firstChunk: number; lastChunk: number; updatedAt: number; generation: string | null;
    }>();
  const rows = result.results ?? [];
  return { revision: JSON.stringify(rows), bytes: rows.reduce((sum, row) => sum + row.bytes, 0) };
}

function freezeCatalogValue(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freezeCatalogValue(child);
}

/** Opaque public revision for page consistency, with no account or profile data. */
export async function readPublicCatalogVersion(
  category: PublicInformationCategory,
  snapshotVersion: string | null,
  now = Date.now(),
) {
  const db = await database();
  await ensurePublicSourceCatalogTable(db);
  const current = await categoryCatalogRevision(db, category);
  let legacy: unknown = null;
  if (category === "youth") {
    await ensureYouthPolicyCatalogTable(db);
    legacy = await db.prepare(`SELECT COUNT(*) AS chunks, SUM(item_count) AS items,
      MAX(updated_at) AS updatedAt, SUM(length(CAST(payload AS BLOB))) AS bytes
      FROM public_youth_policy_catalog_chunks WHERE catalog_key = ?`).bind(YOUTH_CATALOG_KEY).first();
  }
  const serialized = JSON.stringify([category, current.revision, legacy, snapshotVersion, kstQuotaDay(now)]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
  return `v1-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function readPublicCategoryCatalog(category: PublicInformationCategory) {
  const db = await database();
  await ensurePublicSourceCatalogTable(db);
  const entries = categoryCatalogCache.get(db) ?? new Map<string, CatalogCacheEntry>();
  categoryCatalogCache.set(db, entries);
  const now = Date.now();
  for (const [key, entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
  const before = await categoryCatalogRevision(db, category);
  const cached = entries.get(category);
  if (cached?.revision === before.revision) {
    entries.delete(category);
    entries.set(category, cached);
    return [...cached.items];
  }
  entries.delete(category);
  const loads = categoryCatalogLoads.get(db) ?? new Map();
  categoryCatalogLoads.set(db, loads);
  const existingLoad = loads.get(category);
  if (existingLoad?.revision === before.revision) return [...await existingLoad.promise];
  const promise = (async () => {
    const items = parseCatalogRows(await readCatalogRows("category = ?", category), category, CATEGORY_CATALOG_MAX_ITEMS);
    const after = await categoryCatalogRevision(db, category);
    if (before.revision !== after.revision) throw new Error("public_catalog_changed");
    // Cache only viewer-neutral validated rows. Per-user scoring/filtering and
    // response bodies remain request-local. The byte limit is serialized input,
    // not a claim about the larger JavaScript heap occupied by these objects.
    freezeCatalogValue(items);
    if (before.bytes <= CATALOG_CACHE_MAX_BYTES) {
      while (entries.size && (entries.size >= 2
        || [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0) + before.bytes > CATALOG_CACHE_MAX_BYTES)) {
        entries.delete(entries.keys().next().value!);
      }
      entries.set(category, { revision: before.revision, items, bytes: before.bytes, expiresAt: now + CATALOG_CACHE_TTL_MS });
    }
    return items;
  })();
  const load = { revision: before.revision, promise };
  loads.set(category, load);
  try {
    return [...await promise];
  } finally {
    if (loads.get(category) === load) loads.delete(category);
  }
}

/**
 * Reads catalogue sizes without loading every chunk payload. The compact home
 * snapshot intentionally keeps only a preview, so these counts let the
 * information hub report the complete server-side catalogue truthfully.
 */
export async function readPublicCategoryCatalogCounts(category?: PublicInformationCategory) {
  const db = await database();
  await ensurePublicSourceCatalogTable(db);
  // Dedicated pages only need their own count. In particular, do not parse the
  // financial-company JSON/date projection while opening an unrelated page.
  // The summary caller omits category and retains the complete aggregate.
  const statement = db.prepare(`SELECT c.category,
    SUM(CASE
      WHEN c.source_id <> 'financial-company' THEN c.item_count
      ELSE COALESCE((SELECT COUNT(*)
        FROM json_each(c.payload, '$.categories') g,
          json_each(g.value, '$.items') i
        WHERE json_valid(c.payload)
          AND json_extract(g.value, '$.id') = c.category
          AND json_extract(i.value, '$.id') LIKE 'company-%'
          AND substr(json_extract(i.value, '$.publishedAt'), 1, 10)
            GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'
          AND date(substr(json_extract(i.value, '$.publishedAt'), 1, 10), '+0 days')
            = substr(json_extract(i.value, '$.publishedAt'), 1, 10)
          AND date(substr(json_extract(i.value, '$.publishedAt'), 1, 10))
            BETWEEN date('now', '+9 hours', '-30 days') AND date('now', '+9 hours', '+1 day')), 0)
    END) AS itemCount
    FROM public_data_catalog_chunks c
    ${category ? "WHERE c.category = ?" : ""}
    GROUP BY c.category`);
  const result = await (category ? statement.bind(category) : statement).all<{
      category: string;
      itemCount: number;
    }>();
  const counts = new Map<PublicInformationCategory, number>();
  for (const row of result.results ?? []) {
    const category = row.category as PublicInformationCategory;
    if (
      PUBLIC_CATEGORIES.includes(category)
      && Number.isSafeInteger(row.itemCount)
      && row.itemCount >= 0
    ) {
      counts.set(category, row.itemCount);
    }
  }
  return counts;
}

/**
 * Counts unique catalogue rows discovered after each viewer's category
 * cutoff without transferring every chunk payload into the Worker. Keep the
 * financial-company age projection identical to the total-count query above,
 * and include Seoul rows stored in the compact dictionary representation.
 */
export async function readPublicCategoryCatalogNewCounts(
  cutoffs: ReadonlyMap<PublicInformationCategory, number>,
) {
  const entries = PUBLIC_CATEGORIES.flatMap((category) => {
    const cutoff = cutoffs.get(category);
    return Number.isFinite(cutoff) && Number(cutoff) >= 0
      ? [[category, new Date(Number(cutoff)).toISOString()] as const]
      : [];
  });
  const counts = new Map<PublicInformationCategory, number>();
  if (!entries.length) return counts;
  const db = await database();
  await ensurePublicSourceCatalogTable(db);
  const values = entries.map(() => "(?, ?)").join(", ");
  const result = await db.prepare(`WITH seen(category, seen_after) AS (VALUES ${values}),
    normal_items AS (
      SELECT c.category,
        json_extract(i.value, '$.id') AS itemId
      FROM public_data_catalog_chunks c
      JOIN seen s ON s.category = c.category,
        json_each(c.payload, '$.categories') g,
        json_each(g.value, '$.items') i
      WHERE json_valid(c.payload)
        AND json_extract(g.value, '$.id') = c.category
        AND julianday(json_extract(i.value, '$.discoveredAt')) > julianday(s.seen_after)
        AND (c.source_id <> 'financial-company' OR (
          json_extract(i.value, '$.id') LIKE 'company-%'
          AND substr(json_extract(i.value, '$.publishedAt'), 1, 10)
            GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'
          AND date(substr(json_extract(i.value, '$.publishedAt'), 1, 10), '+0 days')
            = substr(json_extract(i.value, '$.publishedAt'), 1, 10)
          AND date(substr(json_extract(i.value, '$.publishedAt'), 1, 10))
            BETWEEN date('now', '+9 hours', '-30 days') AND date('now', '+9 hours', '+1 day')
        ))
    ),
    compact_items AS (
      SELECT c.category,
        'seoul-commercial-' || json_extract(
          c.payload,
          '$.__boraCompact.d[' || CAST(json_extract(r.value, '$[0]') AS INTEGER) || ']'
        ) AS itemId
      FROM public_data_catalog_chunks c
      JOIN seen s ON s.category = c.category,
        json_each(c.payload, '$.__boraCompact.r') r
      WHERE json_valid(c.payload)
        AND c.category = 'startup'
        AND julianday(json_extract(
          c.payload,
          '$.__boraCompact.d[' || CAST(json_extract(r.value, '$[7]') AS INTEGER) || ']'
        )) > julianday(s.seen_after)
    )
    SELECT category, COUNT(DISTINCT itemId) AS itemCount
    FROM (
      SELECT category, itemId FROM normal_items
      UNION ALL
      SELECT category, itemId FROM compact_items
    )
    WHERE typeof(itemId) = 'text' AND length(itemId) > 0
    GROUP BY category`)
    .bind(...entries.flatMap(([category, cutoff]) => [category, cutoff]))
    .all<{ category: string; itemCount: number }>();
  for (const row of result.results ?? []) {
    const category = row.category as PublicInformationCategory;
    if (PUBLIC_CATEGORIES.includes(category)
      && Number.isSafeInteger(row.itemCount)
      && row.itemCount >= 0) {
      counts.set(category, row.itemCount);
    }
  }
  return counts;
}

/**
 * The shared home snapshot intentionally stays below the D1 single-value
 * safety ceiling. The larger youth-policy catalogue is therefore stored in
 * independently validated chunks and loaded only on the dedicated page.
 */
export async function saveYouthPolicyCatalog(
  items: readonly PublicInformationItem[],
  now: number,
) {
  if (items.length > YOUTH_CATALOG_MAX_ITEMS) {
    throw new Error("youth_policy_catalog_too_large");
  }
  const ids = new Set<string>();
  for (const item of items) {
    if (item.category !== "youth" || ids.has(item.id)) {
      throw new Error("youth_policy_catalog_invalid");
    }
    ids.add(item.id);
  }
  const chunks: PublicInformationItem[][] = [];
  for (let index = 0; index < items.length; index += YOUTH_CATALOG_CHUNK_SIZE) {
    chunks.push(items.slice(index, index + YOUTH_CATALOG_CHUNK_SIZE));
  }
  const db = await database();
  await ensureYouthPolicyCatalogTable(db);
  const statements = [
    db.prepare("DELETE FROM public_youth_policy_catalog_chunks WHERE catalog_key = ?")
      .bind(YOUTH_CATALOG_KEY),
    ...chunks.map((chunk, chunkIndex) => {
      const payload = emptyPublicDataPayload();
      payload.categories = payload.categories.map((group) => group.id === "youth"
        ? { ...group, items: chunk, totalCount: chunk.length }
        : group);
      return db.prepare(`INSERT INTO public_youth_policy_catalog_chunks
        (catalog_key, chunk_index, payload, item_count, updated_at)
        VALUES (?, ?, ?, ?, ?)`)
        .bind(
          YOUTH_CATALOG_KEY,
          chunkIndex,
          serializePublicDataPayload(payload),
          chunk.length,
          now,
        );
    }),
  ];
  await db.batch(statements);
}

export async function readYouthPolicyCatalog(): Promise<PublicInformationItem[]> {
  const db = await database();
  await ensureYouthPolicyCatalogTable(db);
  const result = await db.prepare(`SELECT chunk_index AS chunkIndex,
    payload, item_count AS itemCount
    FROM public_youth_policy_catalog_chunks
    WHERE catalog_key = ?
    ORDER BY chunk_index`).bind(YOUTH_CATALOG_KEY).all<{
      chunkIndex: number;
      payload: string;
      itemCount: number;
    }>();
  const rows = result.results ?? [];
  if (rows.length > Math.ceil(YOUTH_CATALOG_MAX_ITEMS / YOUTH_CATALOG_CHUNK_SIZE)) {
    throw new Error("youth_policy_catalog_invalid");
  }
  const items: PublicInformationItem[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (
      row.chunkIndex !== index
      || !Number.isSafeInteger(row.itemCount)
      || row.itemCount < 0
      || row.itemCount > YOUTH_CATALOG_CHUNK_SIZE
      || typeof row.payload !== "string"
    ) {
      throw new Error("youth_policy_catalog_invalid");
    }
    const payload = parseStoredPayload(row.payload);
    const chunk = payload?.categories.find((group) => group.id === "youth")?.items;
    if (!chunk || chunk.length !== row.itemCount) {
      throw new Error("youth_policy_catalog_invalid");
    }
    items.push(...chunk);
  }
  if (items.length > YOUTH_CATALOG_MAX_ITEMS
    || new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("youth_policy_catalog_invalid");
  }
  return items;
}

export async function ensurePublicSnapshot(now: number) {
  const db = await database();
  await insertPublicSnapshot(db, now);
  return readPublicSnapshot();
}

function insertPublicSnapshot(db: D1Database, now: number) {
  return db.prepare(`INSERT OR IGNORE INTO public_data_snapshots
    (cache_key, payload, status, item_count, next_refresh_at, last_attempt_at, lock_until, updated_at)
    VALUES (?, '{}', 'empty', 0, 0, 0, 0, ?)`)
    .bind(SNAPSHOT_KEY, now)
    .run();
}

export async function claimPublicRefresh(now: number) {
  const db = await database();
  const leaseUntil = now + PUBLIC_REFRESH_LOCK_MS;
  const result = await db.prepare(`UPDATE public_data_snapshots
    SET lock_until = ?, last_attempt_at = ?, status = CASE WHEN last_successful_at IS NULL THEN 'loading' ELSE status END,
      updated_at = ?
    WHERE cache_key = ? AND lock_until <= ?`)
    .bind(leaseUntil, now, now, SNAPSHOT_KEY, now)
    .run();
  return Number(result.meta.changes ?? 0) === 1 ? leaseUntil : null;
}

export async function releasePublicRefresh(input: {
  now: number;
  nextRefreshAt: number;
  leaseUntil: number;
  errorCode?: string | null;
}) {
  const db = await database();
  const result = await db.prepare(`UPDATE public_data_snapshots
    SET next_refresh_at = ?, lock_until = 0, last_error = ?, updated_at = ?
    WHERE cache_key = ? AND lock_until = ?`)
    .bind(input.nextRefreshAt, input.errorCode?.slice(0, 80) ?? null, input.now, SNAPSHOT_KEY, input.leaseUntil)
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function savePublicSnapshot(input: {
  payload: PublicDataPayload;
  status: "live" | "partial";
  now: number;
  nextRefreshAt: number;
  leaseUntil: number;
}) {
  const itemCount = input.payload.categories.reduce((sum, group) => sum + group.items.length, 0);
  const serializedPayload = serializePublicDataPayload(input.payload);
  const db = await database();
  const result = await db.prepare(`UPDATE public_data_snapshots SET payload = ?, status = ?, item_count = ?,
    last_successful_at = ?, next_refresh_at = ?, lock_until = 0, last_error = NULL, updated_at = ?
    WHERE cache_key = ? AND lock_until = ?`)
    .bind(
      serializedPayload,
      input.status,
      itemCount,
      input.now,
      input.nextRefreshAt,
      input.now,
      SNAPSHOT_KEY,
      input.leaseUntil,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

export async function failPublicRefresh(input: {
  now: number;
  nextRefreshAt: number;
  errorCode: string;
  leaseUntil: number;
  attemptedPayload?: PublicDataPayload;
}) {
  const serializedAttempt = input.attemptedPayload
    ? serializePublicDataPayload(input.attemptedPayload)
    : null;
  const db = await database();
  const attemptedItemCount = input.attemptedPayload?.categories.reduce(
    (sum, group) => sum + group.items.length,
    0,
  ) ?? 0;
  const result = await db.prepare(`UPDATE public_data_snapshots
    SET status = CASE WHEN last_successful_at IS NULL THEN 'empty' ELSE 'stale' END,
      payload = CASE WHEN ? IS NOT NULL THEN ? ELSE payload END,
      item_count = CASE WHEN ? IS NOT NULL THEN ? ELSE item_count END,
      next_refresh_at = ?, lock_until = 0, last_error = ?, updated_at = ?
    WHERE cache_key = ? AND lock_until = ?`)
    .bind(
      input.attemptedPayload ? 1 : null,
      serializedAttempt,
      input.attemptedPayload ? 1 : null,
      attemptedItemCount,
      input.nextRefreshAt,
      input.errorCode.slice(0, 80),
      input.now,
      SNAPSHOT_KEY,
      input.leaseUntil,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

function validBackfillCheckpoint(checkpoint: PublicBackfillCheckpoint) {
  return /^[a-z0-9-]{2,80}$/u.test(checkpoint.sourceId)
    && checkpoint.querySignature.length >= 8
    && checkpoint.querySignature.length <= 512
    && checkpoint.queryState.length <= 2_000
    && Number.isSafeInteger(checkpoint.nextPage)
    && checkpoint.nextPage >= 1
    && checkpoint.nextPage <= 1_000_000
    && Number.isSafeInteger(checkpoint.pageSize)
    && checkpoint.pageSize >= 1
    && checkpoint.pageSize <= BACKFILL_PAGE_MAX_ITEMS
    && (checkpoint.providerTotalCount === null
      || (Number.isSafeInteger(checkpoint.providerTotalCount)
        && checkpoint.providerTotalCount >= 0))
    && Number.isSafeInteger(checkpoint.fetchedCount)
    && checkpoint.fetchedCount >= 0
    && Number.isSafeInteger(checkpoint.updatedAt)
    && checkpoint.updatedAt > 0;
}

export function buildPublicBackfillCheckpointUpsert(
  checkpoint: PublicBackfillCheckpoint,
) {
  if (!validBackfillCheckpoint(checkpoint)) {
    throw new Error("public_backfill_checkpoint_invalid");
  }
  return {
    sql: `INSERT INTO public_api_backfill_checkpoints
      (source_id, query_signature, query_state, next_page, page_size,
        provider_total_count, fetched_count, completed, latest_refresh_at,
        completed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        query_signature = excluded.query_signature,
        query_state = excluded.query_state,
        next_page = excluded.next_page,
        page_size = excluded.page_size,
        provider_total_count = excluded.provider_total_count,
        fetched_count = excluded.fetched_count,
        completed = excluded.completed,
        latest_refresh_at = excluded.latest_refresh_at,
        completed_at = excluded.completed_at,
        updated_at = excluded.updated_at`,
    values: [
      checkpoint.sourceId,
      checkpoint.querySignature,
      checkpoint.queryState,
      checkpoint.nextPage,
      checkpoint.pageSize,
      checkpoint.providerTotalCount,
      checkpoint.fetchedCount,
      checkpoint.completed ? 1 : 0,
      checkpoint.latestRefreshAt,
      checkpoint.completedAt,
      checkpoint.updatedAt,
    ],
  };
}

export async function readPublicBackfillCheckpoints(
  sourceIds: readonly string[],
) {
  const unique = [...new Set(sourceIds.filter((sourceId) => (
    /^[a-z0-9-]{2,80}$/u.test(sourceId)
  )))].slice(0, 20);
  const checkpoints = new Map<string, PublicBackfillCheckpoint>();
  if (!unique.length) return checkpoints;
  const db = await database();
  const placeholders = unique.map(() => "?").join(", ");
  const rows = await db.prepare(`SELECT source_id AS sourceId,
    query_signature AS querySignature, query_state AS queryState,
    next_page AS nextPage, page_size AS pageSize,
    provider_total_count AS providerTotalCount, fetched_count AS fetchedCount,
    completed, latest_refresh_at AS latestRefreshAt,
    completed_at AS completedAt, updated_at AS updatedAt
    FROM public_api_backfill_checkpoints
    WHERE source_id IN (${placeholders})`)
    .bind(...unique)
    .all<Omit<PublicBackfillCheckpoint, "completed"> & { completed: number }>();
  for (const row of rows.results ?? []) {
    const checkpoint: PublicBackfillCheckpoint = {
      ...row,
      completed: row.completed === 1,
    };
    if (validBackfillCheckpoint(checkpoint)) {
      checkpoints.set(checkpoint.sourceId, checkpoint);
    }
  }
  return checkpoints;
}

/** Skip only obsolete *completed* daily generations that adapters reject too.
 * This does not delete staging or change any cursor. A fresh provider response
 * must be committed before the existing normal generation replacement occurs.
 * Incomplete/current/unknown checkpoints still undergo strict validation.
 */
export function shouldReadPublicBackfillStaging(checkpoint: PublicBackfillCheckpoint, now = Date.now()) {
  if (!checkpoint.completed) return true;
  let state: Record<string, unknown>;
  try { state = JSON.parse(checkpoint.queryState) as Record<string, unknown>; } catch { return true; }
  if (!state || typeof state !== "object" || Array.isArray(state)) return true;
  const supported = checkpoint.sourceId === "bizinfo" && state.version === 2
    && checkpoint.querySignature.startsWith("bizinfo-v1-")
    || ["kstartup", "bizinfo-data-go"].includes(checkpoint.sourceId) && state.version === 2
      && checkpoint.querySignature.startsWith(`startup-v1-${checkpoint.sourceId}-`)
    || checkpoint.sourceId === "youth-center" && state.version === 2
      && (state.mode === "portal" || state.mode === "open-api")
      && /^youth-center-(?:portal|open)-v2-/u.test(checkpoint.querySignature)
    || checkpoint.sourceId === "work24" && (state.version === 2 || state.version === 3)
      && /^work24-v[34]-/u.test(checkpoint.querySignature);
  if (!supported) return true;
  const generation = state.generation ?? state.reconciliationDay;
  if (typeof generation !== "string") return true;
  const compact = generation.replaceAll("-", "");
  const current = kstQuotaDay(now).replaceAll("-", "");
  return !/^\d{8}$/u.test(compact) || publicDateInstant(compact) === null || compact >= current;
}

export async function readPublicBackfillStagedItems(
  checkpoint: PublicBackfillCheckpoint,
) {
  if (!validBackfillCheckpoint(checkpoint)) return [];
  const db = await database();
  const rows = await db.prepare(`SELECT page_number AS pageNumber,
    payload, item_count AS itemCount
    FROM public_api_backfill_pages
    WHERE source_id = ? AND query_signature = ?
    ORDER BY page_number DESC`)
    .bind(checkpoint.sourceId, checkpoint.querySignature)
    .all<{ pageNumber: number; payload: string; itemCount: number }>();
  const byId = new Map<string, PublicInformationItem>();
  const stagedPages = new Set<number>();
  const stagedItemCounts = new Map<number, number>();
  for (const row of rows.results ?? []) {
    if (
      !Number.isSafeInteger(row.pageNumber)
      || row.pageNumber < 0
      || !Number.isSafeInteger(row.itemCount)
      || row.itemCount < 0
      || row.itemCount > BACKFILL_PAGE_MAX_ITEMS
      || typeof row.payload !== "string"
      || new TextEncoder().encode(row.payload).byteLength > BACKFILL_PAGE_MAX_BYTES
    ) {
      throw new Error("public_backfill_page_invalid");
    }
    const parsed = JSON.parse(row.payload) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== row.itemCount) {
      throw new Error("public_backfill_page_invalid");
    }
    const items = validatedCatalogItems(parsed as PublicInformationItem[]);
    stagedPages.add(row.pageNumber);
    stagedItemCounts.set(row.pageNumber, items.length);
    for (const item of items) byId.set(item.id, item);
  }
  validateCompleteBackfillPages(checkpoint, stagedPages, stagedItemCounts, byId.size);
  // Do not apply the per-source retention cap while reconstructing a completed
  // generation. The service must observe offeredItems > retainedItems so it can
  // label a real local omission truthfully. The separate category ceiling still
  // prevents an unbounded in-memory reconstruction.
  return validatedCatalogItems([...byId.values()], undefined, CATEGORY_CATALOG_MAX_ITEMS);
}

/** A completion bit is not sufficient if a copied/corrupt cache lost a page. */
export function validateCompleteBackfillPages(
  checkpoint: PublicBackfillCheckpoint,
  stagedPages: ReadonlySet<number>,
  stagedItemCounts?: ReadonlyMap<number, number>,
  stagedUniqueItems?: number,
) {
  if (!checkpoint.completed) return;
  if (checkpoint.providerTotalCount === null
    || checkpoint.fetchedCount < checkpoint.providerTotalCount) {
    throw new Error("public_backfill_complete_invalid");
  }
  // The first generation page historically used slot 0 in these adapters;
  // generic providers (notably K-Startup/DART) still require immutable slot 1.
  // Recognize only the explicit provider/version contract, never guess from a
  // missing page. Newly written generations preserve slot 1 and use 0 only
  // for the independent latest-page refresh.
  let state: Record<string, unknown> = {};
  try { state = JSON.parse(checkpoint.queryState) as Record<string, unknown>; } catch { /* strict default */ }
  if (!state || typeof state !== "object" || Array.isArray(state)) state = {};
  const legacyZeroFirst = checkpoint.sourceId === "bizinfo"
    && checkpoint.querySignature.startsWith("bizinfo-v1-") && state.version === 2
    || checkpoint.sourceId === "work24"
      && /^work24-v[34]-/u.test(checkpoint.querySignature) && (state.version === 2 || state.version === 3)
    || checkpoint.sourceId === "youth-center"
      && checkpoint.querySignature.startsWith("youth-center-portal-v2-") && state.version === 2 && state.mode === "portal";
  if (checkpoint.sourceId === "youth-center" && state.version === 2 && state.mode === "open-api"
    && checkpoint.querySignature.startsWith("youth-center-open-v2-")) {
    const expectedSections = ["employment", "scholarship", "financial_support", "policy_news"];
    if (!Array.isArray(state.sections) || state.sections.length !== expectedSections.length) {
      throw new Error("public_backfill_complete_invalid");
    }
    let total = 0;
    let greatestSectionTotal = 0;
    let refreshCount = 0;
    for (const [index, raw] of state.sections.entries()) {
      const section = raw as { section?: string; initialized?: boolean; completed?: boolean; total?: number };
      if (!section || section.section !== expectedSections[index] || section.initialized !== true
        || section.completed !== true || !Number.isSafeInteger(section.total) || Number(section.total) < 0) {
        throw new Error("public_backfill_complete_invalid");
      }
      const sectionTotal = Number(section.total);
      total += sectionTotal;
      greatestSectionTotal = Math.max(greatestSectionTotal, sectionTotal);
      const pages = Math.max(1, Math.ceil(sectionTotal / checkpoint.pageSize));
      const firstSlot = (index + 1) * 100_000 + 1;
      const historicalFirst = stagedPages.has(firstSlot) ? firstSlot : index;
      for (let page = 1; page <= pages; page += 1) {
        const slot = page === 1 ? historicalFirst : (index + 1) * 100_000 + page;
        if (!stagedPages.has(slot)) throw new Error("public_backfill_complete_missing_page");
        const expected = page < pages ? checkpoint.pageSize : sectionTotal - (page - 1) * checkpoint.pageSize;
        if (stagedItemCounts && stagedItemCounts.get(slot) !== expected) {
          throw new Error("public_backfill_complete_cardinality_invalid");
        }
      }
      if (historicalFirst !== index) refreshCount += stagedItemCounts?.get(index) ?? 0;
    }
    // Policies may legitimately occur in more than one official section.
    if (total !== checkpoint.providerTotalCount || stagedUniqueItems !== undefined
      && (stagedUniqueItems < greatestSectionTotal || stagedUniqueItems > total + refreshCount)) {
      throw new Error("public_backfill_complete_cardinality_invalid");
    }
    return;
  }
  const requiredPages = Math.max(1, Math.ceil(checkpoint.providerTotalCount / checkpoint.pageSize));
  const firstSlot = legacyZeroFirst && !stagedPages.has(1) ? 0 : 1;
  for (let page = 1; page <= requiredPages; page += 1) {
    const slot = page === 1 ? firstSlot : page;
    if (!stagedPages.has(slot)) throw new Error("public_backfill_complete_missing_page");
    if (stagedItemCounts) {
      const expected = page < requiredPages
        ? checkpoint.pageSize
        : checkpoint.providerTotalCount - ((page - 1) * checkpoint.pageSize);
      if (stagedItemCounts.get(slot) !== expected) {
        throw new Error("public_backfill_complete_cardinality_invalid");
      }
    }
  }
  if (stagedItemCounts && stagedUniqueItems !== undefined) {
    const refreshItems = firstSlot === 0 ? 0 : stagedItemCounts.get(0) ?? 0;
    if (
      stagedUniqueItems < checkpoint.providerTotalCount
      || stagedUniqueItems > checkpoint.providerTotalCount + refreshItems
    ) {
      throw new Error("public_backfill_complete_cardinality_invalid");
    }
  }
}

/**
 * D1 batch is transactional. The normalized page is durable before the same
 * transaction exposes its advanced cursor, so a crash can only cause a safe
 * page replay, never a skipped page.
 */
export async function commitPublicBackfillPage(
  input: PublicBackfillPageCommit,
) {
  if (
    !validBackfillCheckpoint(input.checkpoint)
    || !Number.isSafeInteger(input.pageNumber)
    || input.pageNumber < 0
    || input.pageNumber > 1_000_000
    || input.items.length > BACKFILL_PAGE_MAX_ITEMS
  ) {
    throw new Error("public_backfill_page_invalid");
  }
  if (input.resetGeneration && input.pageNumber !== 1
    || input.resetGeneration && input.resetSection !== undefined
    || input.resetSection !== undefined && (
      input.checkpoint.sourceId !== "youth-center"
      || !input.checkpoint.querySignature.startsWith("youth-center-open-v2-")
      || !Number.isInteger(input.resetSection) || input.resetSection < 0 || input.resetSection > 3
      || input.pageNumber !== (input.resetSection + 1) * 100_000 + 1
    )) throw new Error("public_backfill_page_invalid");
  const items = validatedCatalogItems(input.items);
  const payload = JSON.stringify(items);
  if (new TextEncoder().encode(payload).byteLength > BACKFILL_PAGE_MAX_BYTES) {
    throw new Error("public_backfill_page_too_large");
  }
  const checkpoint = buildPublicBackfillCheckpointUpsert(input.checkpoint);
  const db = await database();
  await db.batch([
    db.prepare(`DELETE FROM public_api_backfill_pages
      WHERE source_id = ? AND (query_signature <> ? OR ? = 1
        OR (? >= 0 AND (page_number = ? OR page_number BETWEEN ? AND ?)))`)
      .bind(input.checkpoint.sourceId, input.checkpoint.querySignature,
        input.resetGeneration === true ? 1 : 0, input.resetSection ?? -1, input.resetSection ?? -1,
        ((input.resetSection ?? -2) + 1) * 100_000 + 1,
        ((input.resetSection ?? -2) + 2) * 100_000 - 1),
    db.prepare(`INSERT OR REPLACE INTO public_api_backfill_pages
      (source_id, query_signature, page_number, payload, item_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        input.checkpoint.sourceId,
        input.checkpoint.querySignature,
        input.pageNumber,
        payload,
        items.length,
        input.checkpoint.updatedAt,
      ),
    db.prepare(checkpoint.sql).bind(...checkpoint.values),
  ]);
}

function sourceStateQuery() {
  return `SELECT source_id AS sourceId, quota_day AS quotaDay,
    used_calls AS usedCalls, reserved_calls AS reservedCalls,
    daily_limit AS dailyLimit, quota_verified AS quotaVerified,
    next_due_at AS nextDueAt, last_success_at AS lastSuccessAt,
    last_attempt_at AS lastAttemptAt, backoff_until AS backoffUntil,
    consecutive_failures AS consecutiveFailures, last_error AS lastError,
    updated_at AS updatedAt FROM public_api_source_state`;
}

export function buildPublicSourceStateUpsert(
  policies: readonly PublicSourcePolicy[],
  quotaDay: string,
  now: number,
) {
  if (!policies.length || policies.length > 20) {
    throw new Error("public_source_state_upsert_size_invalid");
  }
  const placeholders = policies
    .map(() => "(?, ?, 0, 0, ?, ?, 0, NULL, 0, 0, 0, NULL, ?)")
    .join(", ");
  const values = policies.flatMap((policy) => [
    policy.sourceId,
    quotaDay,
    policy.dailyLimit,
    policy.quotaVerified ? 1 : 0,
    now,
  ]);
  const staleReservation = `public_api_source_state.quota_day = excluded.quota_day
    AND public_api_source_state.reserved_calls > 0
    AND public_api_source_state.last_attempt_at <= excluded.updated_at - ${PUBLIC_REFRESH_LOCK_MS}`;
  const recoveryAt = `excluded.updated_at + ${PUBLIC_SOURCE_RESERVATION_RECOVERY_BACKOFF_MS}`;
  return {
    sql: `INSERT INTO public_api_source_state
      (source_id, quota_day, used_calls, reserved_calls, daily_limit, quota_verified,
        next_due_at, last_success_at, last_attempt_at, backoff_until,
        consecutive_failures, last_error, updated_at)
      VALUES ${placeholders}
      ON CONFLICT(source_id) DO UPDATE SET
        quota_day = excluded.quota_day,
        used_calls = CASE
          WHEN public_api_source_state.quota_day <> excluded.quota_day THEN 0
          WHEN ${staleReservation} THEN MAX(
            public_api_source_state.used_calls,
            MIN(excluded.daily_limit,
              public_api_source_state.used_calls + public_api_source_state.reserved_calls)
          )
          ELSE public_api_source_state.used_calls
        END,
        reserved_calls = CASE
          WHEN public_api_source_state.quota_day <> excluded.quota_day THEN 0
          WHEN ${staleReservation} THEN 0
          ELSE public_api_source_state.reserved_calls
        END,
        daily_limit = excluded.daily_limit,
        quota_verified = excluded.quota_verified,
        next_due_at = CASE WHEN ${staleReservation}
          THEN MAX(public_api_source_state.next_due_at, ${recoveryAt})
          ELSE public_api_source_state.next_due_at END,
        backoff_until = CASE WHEN ${staleReservation}
          THEN MAX(public_api_source_state.backoff_until, ${recoveryAt})
          ELSE public_api_source_state.backoff_until END,
        consecutive_failures = CASE WHEN ${staleReservation}
          THEN public_api_source_state.consecutive_failures + 1
          ELSE public_api_source_state.consecutive_failures END,
        last_error = CASE WHEN ${staleReservation}
          THEN 'stale-reservation-recovered'
          ELSE public_api_source_state.last_error END,
        updated_at = excluded.updated_at`,
    values,
  };
}

export async function ensurePublicSourceStates(
  policies: readonly PublicSourcePolicy[],
  quotaDay: string,
  now: number,
) {
  const db = await database();
  // D1 allows at most 100 bound parameters. Five values per policy means the
  // current 18 sources fit in one query, while the chunking remains safe if a
  // few more adapters are added later.
  for (let offset = 0; offset < policies.length; offset += 20) {
    const chunk = policies.slice(offset, offset + 20);
    const upsert = buildPublicSourceStateUpsert(chunk, quotaDay, now);
    await db.batch([
      db.prepare(upsert.sql).bind(...upsert.values),
      db.prepare(`DELETE FROM public_api_interactive_reservations
        WHERE quota_day <> ? OR created_at <= ?`)
        .bind(quotaDay, now - PUBLIC_REFRESH_LOCK_MS),
    ]);
  }
}

export async function readPublicSourceStates(): Promise<PublicApiSourceStateRow[]> {
  const db = await database();
  const rows = await db.prepare(`${sourceStateQuery()} ORDER BY source_id`).all<PublicApiSourceStateRow>();
  return rows.results ?? [];
}

export async function readPublicSourceState(sourceId: string): Promise<PublicApiSourceStateRow | null> {
  if (!sourceId) return null;
  const db = await database();
  return db.prepare(`${sourceStateQuery()} WHERE source_id = ?`)
    .bind(sourceId)
    .first<PublicApiSourceStateRow>();
}

export async function reservePublicSourceCalls(input: {
  sourceId: string;
  estimatedCalls: number;
  allowedCalls: number;
  now: number;
}) {
  const db = await database();
  const result = await db.prepare(`UPDATE public_api_source_state
    SET reserved_calls = reserved_calls + ?, last_attempt_at = ?, updated_at = ?
    WHERE source_id = ?
      AND next_due_at <= ?
      AND backoff_until <= ?
      AND reserved_calls = 0
      AND used_calls + reserved_calls + ? <= ?`)
    .bind(
      input.estimatedCalls,
      input.now,
      input.now,
      input.sourceId,
      input.now,
      input.now,
      input.estimatedCalls,
      input.allowedCalls,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

/**
 * Interactive lookups share the same provider quota ledger as scheduled
 * collection, but must not change the catalogue refresh cadence. Each lookup
 * receives an opaque reservation token so different users and pages can run
 * concurrently while the aggregate reserved call count remains bounded.
 */
export async function reserveInteractivePublicSourceCalls(input: {
  sourceId: string;
  quotaDay: string;
  estimatedCalls: number;
  allowedCalls: number;
  now: number;
}): Promise<PublicApiInteractiveReservation | null> {
  if (
    !input.sourceId
    || !isPublicQuotaDay(input.quotaDay)
    || !Number.isSafeInteger(input.now)
    || input.now < 0
    || input.quotaDay !== kstQuotaDay(input.now)
    || !Number.isSafeInteger(input.estimatedCalls)
    || input.estimatedCalls < 1
    || !Number.isSafeInteger(input.allowedCalls)
    || input.allowedCalls < 0
  ) {
    throw new Error("public_interactive_reservation_invalid");
  }
  const db = await database();
  const token = crypto.randomUUID();
  const [claimed, recorded] = await db.batch([
    db.prepare(`UPDATE public_api_source_state
      SET reserved_calls = reserved_calls + ?, last_attempt_at = ?, updated_at = ?
      WHERE source_id = ?
        AND quota_day = ?
        AND backoff_until <= ?
        AND used_calls + reserved_calls + ? <= ?`)
      .bind(
        input.estimatedCalls,
        input.now,
        input.now,
        input.sourceId,
        input.quotaDay,
        input.now,
        input.estimatedCalls,
        input.allowedCalls,
      ),
    db.prepare(`INSERT INTO public_api_interactive_reservations
      (reservation_token, source_id, quota_day, reserved_calls, attempt_at, created_at)
      SELECT ?, source_id, quota_day, ?, ?, ?
      FROM public_api_source_state
      WHERE source_id = ? AND quota_day = ?
        AND reserved_calls >= ? AND last_attempt_at = ?`)
      .bind(
        token,
        input.estimatedCalls,
        input.now,
        input.now,
        input.sourceId,
        input.quotaDay,
        input.estimatedCalls,
        input.now,
      ),
  ]);
  if (
    Number(claimed.meta.changes ?? 0) !== 1
    || Number(recorded.meta.changes ?? 0) !== 1
  ) {
    if (Number(recorded.meta.changes ?? 0) === 1) {
      await db.prepare(`DELETE FROM public_api_interactive_reservations
        WHERE reservation_token = ?`)
        .bind(token)
        .run()
        .catch(() => undefined);
    }
    if (Number(claimed.meta.changes ?? 0) === 1) {
      await db.prepare(`UPDATE public_api_source_state SET
        reserved_calls = MAX(0, reserved_calls - ?), updated_at = ?
        WHERE source_id = ? AND quota_day = ?
          AND reserved_calls >= ? AND last_attempt_at = ?`)
        .bind(
          input.estimatedCalls,
          input.now,
          input.sourceId,
          input.quotaDay,
          input.estimatedCalls,
          input.now,
        )
        .run()
        .catch(() => undefined);
    }
    return null;
  }
  return {
    token,
    sourceId: input.sourceId,
    quotaDay: input.quotaDay,
    reservedCalls: input.estimatedCalls,
    attemptAt: input.now,
  };
}

export async function completeInteractivePublicSourceCalls(input: {
  reservation: PublicApiInteractiveReservation;
  actualCalls: number;
  now: number;
  successful: boolean;
  backoffUntil?: number;
  errorCode?: string | null;
}) {
  if (
    !Number.isSafeInteger(input.actualCalls)
    || input.actualCalls < 0
    || input.actualCalls > input.reservation.reservedCalls
  ) {
    throw new Error("public_interactive_completion_invalid");
  }
  const db = await database();
  const [completed] = await db.batch([
    db.prepare(`UPDATE public_api_source_state SET
      reserved_calls = reserved_calls - ?,
      used_calls = used_calls + ?,
      backoff_until = CASE
        WHEN ? = 1 THEN backoff_until
        ELSE MAX(backoff_until, ?)
      END,
      last_error = CASE
        WHEN ? = 1 THEN last_error
        ELSE ?
      END,
      updated_at = ?
      WHERE source_id = ? AND quota_day = ?
        AND reserved_calls >= ?
        AND EXISTS (
          SELECT 1 FROM public_api_interactive_reservations
          WHERE reservation_token = ? AND source_id = ? AND quota_day = ?
            AND reserved_calls = ? AND attempt_at = ?
        )`)
      .bind(
        input.reservation.reservedCalls,
        input.actualCalls,
        input.successful ? 1 : 0,
        input.backoffUntil ?? input.now,
        input.successful ? 1 : 0,
        input.errorCode?.slice(0, 80) ?? "interactive_upstream_unavailable",
        input.now,
        input.reservation.sourceId,
        input.reservation.quotaDay,
        input.reservation.reservedCalls,
        input.reservation.token,
        input.reservation.sourceId,
        input.reservation.quotaDay,
        input.reservation.reservedCalls,
        input.reservation.attemptAt,
      ),
    db.prepare(`DELETE FROM public_api_interactive_reservations
      WHERE reservation_token = ?`)
      .bind(input.reservation.token),
  ]);
  return Number(completed.meta.changes ?? 0) === 1;
}

export async function completePublicSourceRun(input: {
  sourceId: string;
  reservedCalls: number;
  actualCalls: number;
  now: number;
  nextDueAt: number;
  successful: boolean;
  backoffUntil?: number;
  errorCode?: string | null;
}) {
  const db = await database();
  const result = await db.prepare(`UPDATE public_api_source_state SET
    reserved_calls = MAX(0, reserved_calls - ?),
    used_calls = used_calls + ?,
    next_due_at = ?,
    last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END,
    backoff_until = CASE WHEN ? = 1 THEN 0 ELSE ? END,
    consecutive_failures = CASE WHEN ? = 1 THEN 0 ELSE consecutive_failures + 1 END,
    last_error = CASE WHEN ? = 1 THEN ? ELSE ? END,
    updated_at = ?
    WHERE source_id = ? AND reserved_calls >= ?`)
    .bind(
      input.reservedCalls,
      Math.max(0, input.actualCalls),
      input.nextDueAt,
      input.successful ? 1 : 0,
      input.now,
      input.successful ? 1 : 0,
      input.backoffUntil ?? input.nextDueAt,
      input.successful ? 1 : 0,
      input.successful ? 1 : 0,
      input.successful ? input.errorCode?.slice(0, 80) ?? null : null,
      input.errorCode?.slice(0, 80) ?? "upstream_unavailable",
      input.now,
      input.sourceId,
      input.reservedCalls,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}

type PublicSourceSnapshotRecovery = {
  sourceId: string;
  previousLastSuccessAt: number | null;
  expectedLastSuccessAt: number;
  nextDueAt: number;
};

export function buildPublicSourceSnapshotRecovery(
  inputs: readonly PublicSourceSnapshotRecovery[],
  now: number,
) {
  const uniqueInputs = [...new Map(inputs.map((input) => [input.sourceId, input])).values()];
  if (!uniqueInputs.length || uniqueInputs.length > 11) {
    throw new Error("public_source_snapshot_recovery_size_invalid");
  }
  const lastSuccessCases = uniqueInputs.map(() => "WHEN ? THEN ?").join(" ");
  const nextDueCases = uniqueInputs.map(() => "WHEN ? THEN ?").join(" ");
  const backoffCases = uniqueInputs.map(() => "WHEN ? THEN ?").join(" ");
  const expectedSuccessCases = uniqueInputs.map(() => "WHEN ? THEN ?").join(" ");
  const sourcePlaceholders = uniqueInputs.map(() => "?").join(", ");
  return {
    sql: `UPDATE public_api_source_state SET
    last_success_at = CASE source_id ${lastSuccessCases} ELSE last_success_at END,
    next_due_at = CASE source_id ${nextDueCases} ELSE next_due_at END,
    backoff_until = CASE source_id ${backoffCases} ELSE backoff_until END,
    consecutive_failures = consecutive_failures + 1,
    last_error = 'snapshot_persistence_failed', updated_at = ?
    WHERE reserved_calls = 0
      AND source_id IN (${sourcePlaceholders})
      AND last_success_at = CASE source_id ${expectedSuccessCases} ELSE last_success_at END`,
    values: [
      ...uniqueInputs.flatMap((input) => [input.sourceId, input.previousLastSuccessAt]),
      ...uniqueInputs.flatMap((input) => [input.sourceId, input.nextDueAt]),
      ...uniqueInputs.flatMap((input) => [input.sourceId, input.nextDueAt]),
      now,
      ...uniqueInputs.map((input) => input.sourceId),
      ...uniqueInputs.flatMap((input) => [input.sourceId, input.expectedLastSuccessAt]),
    ],
  };
}

export async function recoverPublicSourcesAfterSnapshotFailure(
  inputs: readonly PublicSourceSnapshotRecovery[],
  now: number,
) {
  const uniqueInputs = [...new Map(inputs.map((input) => [input.sourceId, input])).values()];
  if (!uniqueInputs.length) return 0;
  const db = await database();
  let changed = 0;
  // Nine bindings per source plus updated_at: eleven rows use D1's 100-bind ceiling.
  for (let offset = 0; offset < uniqueInputs.length; offset += 11) {
    const update = buildPublicSourceSnapshotRecovery(uniqueInputs.slice(offset, offset + 11), now);
    const result = await db.prepare(update.sql)
      .bind(...update.values)
      .run();
    changed += Number(result.meta.changes ?? 0);
  }
  return changed;
}

type PublicSourceDeferral = {
  sourceId: string;
  nextDueAt: number;
  errorCode: string | null;
};

export function buildPublicSourceDeferral(
  inputs: readonly PublicSourceDeferral[],
  now: number,
) {
  const uniqueInputs = [...new Map(inputs.map((input) => [input.sourceId, input])).values()];
  if (!uniqueInputs.length || uniqueInputs.length > 19) {
    throw new Error("public_source_deferral_size_invalid");
  }
  const nextDueCases = uniqueInputs.map(() => "WHEN ? THEN ?").join(" ");
  const errorCases = uniqueInputs.map(() => "WHEN ? THEN ?").join(" ");
  const sourcePlaceholders = uniqueInputs.map(() => "?").join(", ");
  return {
    sql: `UPDATE public_api_source_state SET
      next_due_at = CASE source_id ${nextDueCases} ELSE next_due_at END,
      last_error = CASE source_id ${errorCases} ELSE last_error END,
      updated_at = ?
      WHERE reserved_calls = 0 AND source_id IN (${sourcePlaceholders})`,
    values: [
      ...uniqueInputs.flatMap((input) => [input.sourceId, input.nextDueAt]),
      ...uniqueInputs.flatMap((input) => [input.sourceId, input.errorCode?.slice(0, 80) ?? null]),
      now,
      ...uniqueInputs.map((input) => input.sourceId),
    ],
  };
}

export async function deferPublicSources(
  inputs: readonly PublicSourceDeferral[],
  now: number,
) {
  const uniqueInputs = [...new Map(inputs.map((input) => [input.sourceId, input])).values()];
  if (!uniqueInputs.length) return 0;
  const db = await database();
  let changed = 0;
  // Each row uses five bindings across the two CASE expressions and IN list.
  // Nineteen rows plus updated_at remain below D1's 100-parameter ceiling.
  for (let offset = 0; offset < uniqueInputs.length; offset += 19) {
    const update = buildPublicSourceDeferral(uniqueInputs.slice(offset, offset + 19), now);
    const result = await db.prepare(update.sql)
      .bind(...update.values)
      .run();
    changed += Number(result.meta.changes ?? 0);
  }
  return changed;
}

export function buildPublicSourceActivationUpdate(input: {
  sourceIds: readonly string[];
  enabled: boolean;
  now: number;
  inactiveUntil: number;
}) {
  const sourceIds = [...new Set(input.sourceIds.filter(Boolean))];
  if (!sourceIds.length || sourceIds.length > 96) {
    throw new Error("public_source_activation_size_invalid");
  }
  const placeholders = sourceIds.map(() => "?").join(", ");
  return {
    sql: `UPDATE public_api_source_state SET
      next_due_at = ?,
      backoff_until = 0,
      consecutive_failures = 0,
      last_error = NULL,
      updated_at = ?
      WHERE reserved_calls = 0 AND source_id IN (${placeholders})`,
    values: [
      input.enabled ? 0 : input.inactiveUntil,
      input.now,
      ...sourceIds,
    ],
  };
}

/**
 * Keep an intentionally disabled source dormant without treating that state as
 * an upstream failure. Turning a credential back on wakes every source that
 * shares it so the next protected refresh can run immediately.
 */
export async function setPublicSourceActivation(input: {
  sourceIds: readonly string[];
  enabled: boolean;
  now: number;
  inactiveUntil: number;
}) {
  const sourceIds = [...new Set(input.sourceIds.filter(Boolean))];
  if (!sourceIds.length) return 0;
  const db = await database();
  let changed = 0;
  for (let offset = 0; offset < sourceIds.length; offset += 96) {
    const update = buildPublicSourceActivationUpdate({
      ...input,
      sourceIds: sourceIds.slice(offset, offset + 96),
    });
    const result = await db.prepare(update.sql)
      .bind(...update.values)
      .run();
    changed += Number(result.meta.changes ?? 0);
  }
  return changed;
}

export async function readCategorySeenAt(userId: string) {
  const db = await database();
  const rows = await db.prepare(
    "SELECT category, seen_at AS seenAt FROM public_data_user_reads WHERE user_id = ?",
  ).bind(userId).all<{ category: string; seenAt: number }>();
  return new Map((rows.results ?? []).map((row) => [row.category, row.seenAt]));
}

export async function markCategorySeen(
  userId: string,
  category: PublicInformationCategory,
  now: number,
) {
  const db = await database();
  await db.prepare(`INSERT INTO public_data_user_reads (user_id, category, seen_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, category) DO UPDATE SET seen_at = excluded.seen_at`)
    .bind(userId, category, now)
    .run();
}

export type { PublicApiSourceStateRow, SnapshotRow };
