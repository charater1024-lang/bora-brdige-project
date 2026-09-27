import { runtimeSecret } from "@/lib/runtime-settings";

import { dataGoJson } from "./adapters";
import {
  completeInteractivePublicSourceCalls,
  ensurePublicSourceStates,
  readPublicSourceState,
  reserveInteractivePublicSourceCalls,
} from "./cache";
import type {
  CommercialAreaSearchItem,
  CommercialAreaSearchResponse,
  CommercialIndustryCompositionItem,
  CommercialIndustryOption,
  CommercialIndustrySearchResponse,
  CommercialSearchKind,
  CommercialSearchMeta,
  CommercialSearchProvince,
  CommercialStoreSearchItem,
  CommercialStoreSearchResponse,
} from "./commercial-search-types";
import {
  COMMERCIAL_SEARCH_PROVINCES,
  COMMERCIAL_SEARCH_SOURCE_URL,
} from "./commercial-search-config";
import { centerOfCommercialPolygon } from "./geo";
import {
  failureBackoffMs,
  kstQuotaDay,
  nextKstQuotaDayStart,
  PUBLIC_API_AUTOMATIC_RATIO,
  PUBLIC_API_MANUAL_RATIO,
  publicSourcePolicy,
} from "./policies";

const COMMERCIAL_API_BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const SOURCE_NAME = "소상공인시장진흥공단 상가(상권)정보 API";
const SOURCE_ID = "commercial-area";
const SEARCH_CACHE_VERSION = 1;
const SEARCH_CACHE_MAX_BYTES = 1_500_000;
const SEARCH_RATE_LIMIT_PER_HOUR = 20;
const AREA_CACHE_MS = 6 * 60 * 60_000;
const STORE_CACHE_MS = 6 * 60 * 60_000;
const INDUSTRY_CACHE_MS = 7 * 24 * 60 * 60_000;
const AREA_PROVIDER_PAGE_SIZE = 1_000;
const AREA_PROVIDER_MAX_PAGES = 2;

const provinceByCode = new Map(COMMERCIAL_SEARCH_PROVINCES.map((province) => [province.code, province]));
const inFlight = new Map<string, Promise<ProviderEnvelope>>();
let searchSchemaReady: Promise<D1Database> | null = null;

type ProviderEnvelope = {
  version: 1;
  kind: CommercialSearchKind;
  items: Array<CommercialAreaSearchItem | CommercialIndustryOption | CommercialStoreSearchItem>;
  providerTotalCount: number;
  partial: boolean;
  fetchedAt: string;
  expiresAt: string;
};

type CachedEnvelope = {
  envelope: ProviderEnvelope;
  cached: boolean;
};

type CacheRow = {
  payload: string;
  expiresAt: number;
};

export class CommercialSearchError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(code);
    this.name = "CommercialSearchError";
  }
}

class ProviderFetchError extends Error {
  constructor(
    public readonly requestCount: number,
    public readonly original: unknown,
  ) {
    super("commercial_provider_fetch_failed");
    this.name = "ProviderFetchError";
  }
}

function cleanText(value: unknown, maximum = 180) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(cleanText(value, 40));
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function normalizedDate(value: unknown) {
  const raw = cleanText(value, 16).replace(/[./]/gu, "-");
  const compact = /^(\d{4})(\d{2})(\d{2})$/u.exec(raw);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return /^\d{4}-\d{2}-\d{2}$/u.test(raw) ? raw : null;
}

function validKoreanPoint(longitude: unknown, latitude: unknown) {
  const lon = finiteNumber(longitude);
  const lat = finiteNumber(latitude);
  return lon !== null && lat !== null
    && lon >= 124 && lon <= 132
    && lat >= 32 && lat <= 40
    ? { longitude: lon, latitude: lat }
    : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeCommercialAreaRows(rows: readonly Record<string, unknown>[]) {
  const seen = new Set<string>();
  return rows.flatMap((row): CommercialAreaSearchItem[] => {
    const areaCode = cleanText(row.trarNo, 20);
    const name = cleanText(row.mainTrarNm, 180);
    if (!/^\d{1,20}$/u.test(areaCode) || !name || seen.has(areaCode)) return [];
    seen.add(areaCode);
    const provinceCode = cleanText(row.ctprvnCd, 10);
    const province = cleanText(row.ctprvnNm, 80);
    const districtCode = cleanText(row.signguCd, 10) || null;
    const district = cleanText(row.signguNm, 80) || null;
    const polygonCenter = centerOfCommercialPolygon(row.coords);
    const point = polygonCenter
      ? validKoreanPoint(polygonCenter.longitude, polygonCenter.latitude)
      : null;
    return [{
      id: `commercial-area-${areaCode}`,
      areaCode,
      name,
      provinceCode,
      province,
      districtCode,
      district,
      areaSquareMeters: positiveNumber(row.trarArea),
      center: point,
      referenceDate: normalizedDate(row.stdrDt),
    }];
  });
}

export function normalizeCommercialIndustryRows(rows: readonly Record<string, unknown>[]) {
  const seen = new Set<string>();
  return rows.flatMap((row): CommercialIndustryOption[] => {
    const code = cleanText(row.indsLclsCd ?? row.upjongCd, 12).toUpperCase();
    const name = cleanText(row.indsLclsNm ?? row.upjongNm, 100);
    if (!/^[A-Z0-9]{1,6}$/u.test(code) || !name || seen.has(code)) return [];
    seen.add(code);
    return [{ code, name, level: "large" }];
  }).sort((left, right) => left.name.localeCompare(right.name, "ko-KR"));
}

export function normalizeCommercialStoreRows(rows: readonly Record<string, unknown>[]) {
  const seen = new Set<string>();
  return rows.flatMap((row): CommercialStoreSearchItem[] => {
    const id = cleanText(row.bizesId, 40);
    const name = cleanText(row.bizesNm, 180);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    const point = validKoreanPoint(row.lon, row.lat);
    return [{
      id,
      name,
      branchName: cleanText(row.brchNm, 120) || null,
      industry: {
        majorCode: cleanText(row.indsLclsCd, 12) || null,
        majorName: cleanText(row.indsLclsNm, 100) || null,
        middleCode: cleanText(row.indsMclsCd, 12) || null,
        middleName: cleanText(row.indsMclsNm, 100) || null,
        minorCode: cleanText(row.indsSclsCd, 12) || null,
        minorName: cleanText(row.indsSclsNm, 100) || null,
        standardCode: cleanText(row.ksicCd, 20) || null,
        standardName: cleanText(row.ksicNm, 120) || null,
      },
      address: {
        road: cleanText(row.rdnmAdr, 240) || null,
        lot: cleanText(row.lnoAdr, 240) || null,
        postalCode: cleanText(row.newZipcd, 12) || null,
        provinceCode: cleanText(row.ctprvnCd, 10) || null,
        province: cleanText(row.ctprvnNm, 80) || null,
        districtCode: cleanText(row.signguCd, 10) || null,
        district: cleanText(row.signguNm, 80) || null,
        neighborhood: cleanText(row.adongNm ?? row.ldongNm, 100) || null,
        building: cleanText(row.bldNm, 140) || null,
      },
      location: point ? { ...point, precision: "point" } : null,
    }];
  });
}

export function commercialStoreComposition(items: readonly CommercialStoreSearchItem[]) {
  const counts = new Map<string, { code: string | null; name: string; count: number }>();
  for (const item of items) {
    const code = item.industry.majorCode;
    const name = item.industry.majorName || "업종 미분류";
    const key = `${code ?? ""}:${name}`;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { code, name, count: 1 });
  }
  const total = items.length;
  const composition: CommercialIndustryCompositionItem[] = [...counts.values()]
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "ko-KR"))
    .map((item) => ({
      ...item,
      sharePercent: total ? Number((item.count / total * 100).toFixed(1)) : 0,
    }));
  return { total, items: composition };
}

export function commercialStoreProviderRequest(input: {
  provinceCode?: string | null;
  areaCode?: string | null;
  industryCode?: string | null;
  page: number;
  pageSize: number;
}) {
  const areaCode = input.areaCode?.trim() ?? "";
  const provinceCode = input.provinceCode?.trim() ?? "";
  const industryCode = input.industryCode?.trim().toUpperCase() ?? "";
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 100_000) {
    throw new CommercialSearchError(400, "invalid_commercial_search_page");
  }
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 10 || input.pageSize > 100) {
    throw new CommercialSearchError(400, "invalid_commercial_search_page_size");
  }
  if (areaCode && !/^\d{1,20}$/u.test(areaCode)) {
    throw new CommercialSearchError(400, "invalid_commercial_area_code");
  }
  if (!areaCode && !provinceByCode.has(provinceCode)) {
    throw new CommercialSearchError(400, "commercial_search_province_required");
  }
  if (industryCode && !/^[A-Z0-9]{1,6}$/u.test(industryCode)) {
    throw new CommercialSearchError(400, "invalid_commercial_industry_code");
  }
  return {
    endpoint: `${COMMERCIAL_API_BASE}/${areaCode ? "storeListInArea" : "storeListInDong"}`,
    params: {
      ...(areaCode
        ? { key: areaCode }
        : { divId: "ctprvnCd", key: provinceCode }),
      ...(industryCode ? { indsLclsCd: industryCode } : {}),
      pageNo: String(input.page),
      numOfRows: String(input.pageSize),
      type: "json",
    },
  };
}

async function database() {
  if (!searchSchemaReady) {
    searchSchemaReady = (async () => {
      const { env } = await import("cloudflare:workers");
      if (!env.DB) throw new CommercialSearchError(503, "commercial_search_storage_unavailable");
      await env.DB.batch([
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS commercial_search_cache (
          cache_key TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL CHECK (length(payload) <= ${SEARCH_CACHE_MAX_BYTES}),
          expires_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        )`),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS commercial_search_cache_expiry_idx
          ON commercial_search_cache (expires_at)`),
        env.DB.prepare(`CREATE TABLE IF NOT EXISTS commercial_search_rate_limits (
          user_id TEXT NOT NULL,
          window_start INTEGER NOT NULL,
          request_count INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, window_start)
        )`),
        env.DB.prepare(`CREATE INDEX IF NOT EXISTS commercial_search_rate_limits_window_idx
          ON commercial_search_rate_limits (window_start)`),
      ]);
      return env.DB;
    })().catch((error) => {
      searchSchemaReady = null;
      throw error;
    });
  }
  return searchSchemaReady;
}

async function cacheKey(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validOptionalString(value: unknown, maximum: number) {
  return value === null || (typeof value === "string" && value.length <= maximum);
}

function validCommercialAreaItem(value: unknown) {
  const item = record(value);
  const center = item?.center === null ? null : record(item?.center);
  return Boolean(
    item
    && typeof item.id === "string" && item.id.length <= 60
    && typeof item.areaCode === "string" && /^\d{1,20}$/u.test(item.areaCode)
    && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 180
    && typeof item.provinceCode === "string" && item.provinceCode.length <= 10
    && typeof item.province === "string" && item.province.length <= 80
    && validOptionalString(item.districtCode, 10)
    && validOptionalString(item.district, 80)
    && (item.areaSquareMeters === null
      || (typeof item.areaSquareMeters === "number" && Number.isFinite(item.areaSquareMeters)
        && item.areaSquareMeters > 0))
    && (item.center === null
      || (center !== null && Boolean(validKoreanPoint(center.longitude, center.latitude))))
    && (item.referenceDate === null
      || (typeof item.referenceDate === "string"
        && normalizedDate(item.referenceDate) === item.referenceDate)),
  );
}

function validCommercialIndustryItem(value: unknown) {
  const item = record(value);
  return Boolean(
    item
    && typeof item.code === "string" && /^[A-Z0-9]{1,6}$/u.test(item.code)
    && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 100
    && item.level === "large",
  );
}

function validCommercialStoreItem(value: unknown) {
  const item = record(value);
  const industry = record(item?.industry);
  const address = record(item?.address);
  const location = item?.location === null ? null : record(item?.location);
  return Boolean(
    item
    && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 40
    && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 180
    && validOptionalString(item.branchName, 120)
    && industry
    && validOptionalString(industry.majorCode, 12)
    && validOptionalString(industry.majorName, 100)
    && validOptionalString(industry.middleCode, 12)
    && validOptionalString(industry.middleName, 100)
    && validOptionalString(industry.minorCode, 12)
    && validOptionalString(industry.minorName, 100)
    && validOptionalString(industry.standardCode, 20)
    && validOptionalString(industry.standardName, 120)
    && address
    && validOptionalString(address.road, 240)
    && validOptionalString(address.lot, 240)
    && validOptionalString(address.postalCode, 12)
    && validOptionalString(address.provinceCode, 10)
    && validOptionalString(address.province, 80)
    && validOptionalString(address.districtCode, 10)
    && validOptionalString(address.district, 80)
    && validOptionalString(address.neighborhood, 100)
    && validOptionalString(address.building, 140)
    && (item.location === null || (
      location !== null
      && location.precision === "point"
      && Boolean(validKoreanPoint(location.longitude, location.latitude))
    )),
  );
}

export function parseCommercialSearchEnvelope(
  payload: string,
  expectedKind: CommercialSearchKind,
  expectedExpiry?: number,
): ProviderEnvelope | null {
  if (new TextEncoder().encode(payload).byteLength > SEARCH_CACHE_MAX_BYTES) return null;
  try {
    const parsed = record(JSON.parse(payload));
    const fetchedAt = Date.parse(cleanText(parsed?.fetchedAt, 40));
    const expiresAt = Date.parse(cleanText(parsed?.expiresAt, 40));
    const maximumItems = expectedKind === "areas"
      ? AREA_PROVIDER_PAGE_SIZE * AREA_PROVIDER_MAX_PAGES
      : 100;
    const validItem = expectedKind === "areas"
      ? validCommercialAreaItem
      : expectedKind === "stores" ? validCommercialStoreItem : validCommercialIndustryItem;
    if (
      parsed?.version !== SEARCH_CACHE_VERSION
      || parsed.kind !== expectedKind
      || !Array.isArray(parsed.items)
      || parsed.items.length > maximumItems
      || parsed.items.some((item) => !validItem(item))
      || !Number.isSafeInteger(parsed.providerTotalCount)
      || Number(parsed.providerTotalCount) < parsed.items.length
      || typeof parsed.partial !== "boolean"
      || !Number.isFinite(fetchedAt)
      || !Number.isFinite(expiresAt)
      || fetchedAt > expiresAt
      || (expectedExpiry !== undefined && expectedExpiry !== expiresAt)
    ) return null;
    return parsed as unknown as ProviderEnvelope;
  } catch {
    return null;
  }
}

async function readCache(key: string, kind: CommercialSearchKind, now: number) {
  const db = await database();
  const row = await db.prepare(`SELECT payload, expires_at AS expiresAt
    FROM commercial_search_cache WHERE cache_key = ? AND expires_at > ?`)
    .bind(key, now)
    .first<CacheRow>();
  if (!row) return null;
  const parsed = parseCommercialSearchEnvelope(row.payload, kind, row.expiresAt);
  if (parsed) return parsed;
  await db.prepare("DELETE FROM commercial_search_cache WHERE cache_key = ?")
    .bind(key)
    .run()
    .catch(() => undefined);
  return null;
}

async function saveCache(key: string, envelope: ProviderEnvelope, now: number) {
  const payload = JSON.stringify(envelope);
  if (new TextEncoder().encode(payload).byteLength > SEARCH_CACHE_MAX_BYTES) {
    throw new CommercialSearchError(502, "commercial_search_response_too_large");
  }
  const expiresAt = Date.parse(envelope.expiresAt);
  const db = await database();
  await db.batch([
    db.prepare(`INSERT OR REPLACE INTO commercial_search_cache
      (cache_key, payload, expires_at, updated_at) VALUES (?, ?, ?, ?)`)
      .bind(key, payload, expiresAt, now),
    db.prepare("DELETE FROM commercial_search_cache WHERE expires_at <= ?")
      .bind(now),
  ]);
}

async function consumeUserSearchAllowance(userId: string, now: number) {
  const windowStart = Math.floor(now / 3_600_000) * 3_600_000;
  const db = await database();
  const [result] = await db.batch([
    db.prepare(`INSERT INTO commercial_search_rate_limits
      (user_id, window_start, request_count, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(user_id, window_start) DO UPDATE SET
        request_count = commercial_search_rate_limits.request_count + 1,
        updated_at = excluded.updated_at
      WHERE commercial_search_rate_limits.request_count < ?`)
      .bind(userId, windowStart, now, SEARCH_RATE_LIMIT_PER_HOUR),
    db.prepare("DELETE FROM commercial_search_rate_limits WHERE window_start < ?")
      .bind(windowStart - 24 * 3_600_000),
  ]);
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new CommercialSearchError(
      429,
      "commercial_search_rate_limited",
      Math.max(1, Math.ceil((windowStart + 3_600_000 - now) / 1_000)),
    );
  }
}

function safeProviderError(error: unknown) {
  const source = error instanceof ProviderFetchError ? error.original : error;
  const status = Number(record(source)?.status);
  if (status === 401 || status === 403) {
    return new CommercialSearchError(503, "commercial_search_authorization_pending");
  }
  if (status === 429) {
    const now = Date.now();
    return new CommercialSearchError(
      429,
      "commercial_search_provider_quota",
      Math.max(1, Math.ceil((nextKstQuotaDayStart(now) - now) / 1_000)),
    );
  }
  return new CommercialSearchError(502, "commercial_search_provider_unavailable");
}

async function withProtectedProviderCall(input: {
  userId: string;
  cacheIdentity: string;
  kind: CommercialSearchKind;
  estimatedCalls: number;
  fetcher: (apiKey: string) => Promise<{ envelope: ProviderEnvelope; requestCount: number }>;
}): Promise<CachedEnvelope> {
  const apiKey = await runtimeSecret("DATA_GO_KR_API_KEY");
  if (!apiKey) throw new CommercialSearchError(503, "commercial_search_not_configured");
  const now = Date.now();
  const key = await cacheKey(`${SEARCH_CACHE_VERSION}:${input.cacheIdentity}`);
  const cached = await readCache(key, input.kind, now);
  if (cached) return { envelope: cached, cached: true };

  const existing = inFlight.get(key);
  if (existing) return { envelope: await existing, cached: true };

  const operation = (async () => {
    const policy = publicSourcePolicy(SOURCE_ID);
    if (!policy) throw new CommercialSearchError(503, "commercial_search_quota_unavailable");
    const quotaDay = kstQuotaDay(now);
    await ensurePublicSourceStates([policy], quotaDay, now);
    const state = await readPublicSourceState(SOURCE_ID);
    if (!state) throw new CommercialSearchError(503, "commercial_search_quota_unavailable");
    const allowedCalls = Math.min(
      Math.floor(state.dailyLimit * PUBLIC_API_MANUAL_RATIO),
      Math.max(
        0,
        Math.floor(state.dailyLimit * PUBLIC_API_AUTOMATIC_RATIO) - policy.estimatedCalls,
      ),
    );
    const reservation = await reserveInteractivePublicSourceCalls({
      sourceId: SOURCE_ID,
      quotaDay,
      estimatedCalls: input.estimatedCalls,
      allowedCalls,
      now,
    });
    if (!reservation) {
      const checkedAt = Date.now();
      const currentState = await readPublicSourceState(SOURCE_ID);
      const retryAt = currentState && currentState.backoffUntil > checkedAt
        ? currentState.backoffUntil
        : currentState && currentState.usedCalls + input.estimatedCalls > allowedCalls
          ? nextKstQuotaDayStart(checkedAt)
          : checkedAt + 5_000;
      throw new CommercialSearchError(
        429,
        "commercial_search_quota_protected",
        Math.max(1, Math.ceil((retryAt - checkedAt) / 1_000)),
      );
    }

    // Internal setup/quota failures must not spend a member's search allowance.
    // If the member is already limited, release the unused provider reservation
    // without recording an upstream failure, success, or consumed API call.
    try {
      await consumeUserSearchAllowance(input.userId, now);
    } catch (error) {
      await completeInteractivePublicSourceCalls({
        reservation,
        actualCalls: 0,
        now: Date.now(),
        successful: true,
      }).catch(() => false);
      if (error instanceof CommercialSearchError) throw error;
      throw new CommercialSearchError(503, "commercial_search_storage_unavailable");
    }

    let actualCalls = 0;
    let result: { envelope: ProviderEnvelope; requestCount: number };
    try {
      result = await input.fetcher(apiKey);
      actualCalls = result.requestCount;
    } catch (error) {
      actualCalls = error instanceof ProviderFetchError ? error.requestCount : actualCalls;
      const safeError = safeProviderError(error);
      const kind = safeError.status === 429
        ? "quota" as const
        : safeError.code.includes("authorization")
          ? "authorization" as const
          : "transient" as const;
      const failureAt = Date.now();
      await completeInteractivePublicSourceCalls({
        reservation,
        actualCalls,
        now: failureAt,
        successful: false,
        backoffUntil: kind === "quota" || kind === "authorization"
          ? nextKstQuotaDayStart(failureAt)
          : failureAt + failureBackoffMs(0, kind),
        errorCode: safeError.code,
      }).catch(() => false);
      throw safeError;
    }

    const completed = await completeInteractivePublicSourceCalls({
      reservation,
      actualCalls,
      now: Date.now(),
      successful: true,
    }).catch(() => false);
    if (!completed) {
      throw new CommercialSearchError(503, "commercial_search_quota_completion_failed");
    }
    try {
      await saveCache(key, result.envelope, Date.now());
    } catch {
      throw new CommercialSearchError(503, "commercial_search_storage_unavailable");
    }
    return result.envelope;
  })();

  inFlight.set(key, operation);
  try {
    return { envelope: await operation, cached: false };
  } finally {
    if (inFlight.get(key) === operation) inFlight.delete(key);
  }
}

function metaOf(envelope: ProviderEnvelope, cached: boolean, dataBasis: CommercialSearchMeta["dataBasis"]): CommercialSearchMeta {
  return {
    sourceName: SOURCE_NAME,
    sourceUrl: COMMERCIAL_SEARCH_SOURCE_URL,
    fetchedAt: envelope.fetchedAt,
    expiresAt: envelope.expiresAt,
    cached,
    partial: envelope.partial,
    dataBasis,
  };
}

function providerEnvelope(input: {
  kind: CommercialSearchKind;
  items: ProviderEnvelope["items"];
  providerTotalCount: number;
  partial: boolean;
  cacheMs: number;
}): ProviderEnvelope {
  const now = Date.now();
  return {
    version: SEARCH_CACHE_VERSION,
    kind: input.kind,
    items: input.items,
    providerTotalCount: Math.max(input.items.length, Math.trunc(input.providerTotalCount)),
    partial: input.partial,
    fetchedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + input.cacheMs).toISOString(),
  };
}

async function loadProvinceAreas(province: CommercialSearchProvince, userId: string) {
  return withProtectedProviderCall({
    userId,
    cacheIdentity: `areas:${province.code}`,
    kind: "areas",
    estimatedCalls: AREA_PROVIDER_MAX_PAGES,
    fetcher: async (apiKey) => {
      let requestCount = 0;
      try {
        requestCount += 1;
        const first = await dataGoJson(apiKey, `${COMMERCIAL_API_BASE}/storeZoneInAdmi`, {
          divId: "ctprvnCd",
          key: province.code,
          pageNo: "1",
          numOfRows: String(AREA_PROVIDER_PAGE_SIZE),
          type: "json",
        }, "ServiceKey", 10_000);
        const pages = [first];
        if (
          first.totalCount > AREA_PROVIDER_PAGE_SIZE
          || (!first.totalCountProvided && first.items.length === AREA_PROVIDER_PAGE_SIZE)
        ) {
          requestCount += 1;
          pages.push(await dataGoJson(apiKey, `${COMMERCIAL_API_BASE}/storeZoneInAdmi`, {
            divId: "ctprvnCd",
            key: province.code,
            pageNo: "2",
            numOfRows: String(AREA_PROVIDER_PAGE_SIZE),
            type: "json",
          }, "ServiceKey", 10_000));
        }
        const rows = pages.flatMap((page) => page.items);
        const providerTotalCount = first.totalCountProvided ? first.totalCount : rows.length;
        const items = normalizeCommercialAreaRows(rows);
        return {
          envelope: providerEnvelope({
            kind: "areas",
            items,
            providerTotalCount,
            partial: providerTotalCount > rows.length || items.length !== rows.length,
            cacheMs: AREA_CACHE_MS,
          }),
          requestCount,
        };
      } catch (error) {
        throw new ProviderFetchError(requestCount, error);
      }
    },
  });
}

export async function searchCommercialAreas(input: {
  provinceCode: string;
  query: string;
  page: number;
  pageSize: number;
  userId: string;
}): Promise<CommercialAreaSearchResponse> {
  const province = provinceByCode.get(input.provinceCode);
  if (!province) throw new CommercialSearchError(400, "invalid_commercial_search_province");
  const query = cleanText(input.query, 80);
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 100_000) {
    throw new CommercialSearchError(400, "invalid_commercial_search_page");
  }
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 5 || input.pageSize > 60) {
    throw new CommercialSearchError(400, "invalid_commercial_search_page_size");
  }
  const loaded = await loadProvinceAreas(province, input.userId);
  const areas = (loaded.envelope.items as CommercialAreaSearchItem[])
    .filter((item) => !query || `${item.name} ${item.province} ${item.district ?? ""}`
      .toLocaleLowerCase("ko-KR")
      .includes(query.toLocaleLowerCase("ko-KR")))
    .sort((left, right) => (
      (left.district ?? "").localeCompare(right.district ?? "", "ko-KR")
      || left.name.localeCompare(right.name, "ko-KR")
    ));
  const start = (input.page - 1) * input.pageSize;
  return {
    kind: "areas",
    items: areas.slice(start, start + input.pageSize),
    page: input.page,
    pageSize: input.pageSize,
    total: areas.length,
    providerTotalCount: loaded.envelope.providerTotalCount,
    hasMore: start + input.pageSize < areas.length,
    query,
    province,
    meta: metaOf(loaded.envelope, loaded.cached, "official-commercial-area"),
  };
}

export async function listCommercialIndustries(userId: string): Promise<CommercialIndustrySearchResponse> {
  const loaded = await withProtectedProviderCall({
    userId,
    cacheIdentity: "industries:large",
    kind: "industries",
    estimatedCalls: 1,
    fetcher: async (apiKey) => {
      let requestCount = 0;
      try {
        requestCount += 1;
        const response = await dataGoJson(apiKey, `${COMMERCIAL_API_BASE}/largeUpjongList`, {
          type: "json",
        }, "ServiceKey", 10_000);
        const items = normalizeCommercialIndustryRows(response.items);
        return {
          envelope: providerEnvelope({
            kind: "industries",
            items,
            providerTotalCount: response.totalCountProvided ? response.totalCount : items.length,
            partial: false,
            cacheMs: INDUSTRY_CACHE_MS,
          }),
          requestCount,
        };
      } catch (error) {
        throw new ProviderFetchError(requestCount, error);
      }
    },
  });
  return {
    kind: "industries",
    items: loaded.envelope.items as CommercialIndustryOption[],
    meta: metaOf(loaded.envelope, loaded.cached, "official-industry-classification"),
  };
}

export async function searchCommercialStores(input: {
  provinceCode?: string | null;
  areaCode?: string | null;
  industryCode?: string | null;
  page: number;
  pageSize: number;
  userId: string;
}): Promise<CommercialStoreSearchResponse> {
  const provinceCode = input.provinceCode?.trim() ?? "";
  const areaCode = input.areaCode?.trim() ?? "";
  const industryCode = input.industryCode?.trim().toUpperCase() || null;
  const province = provinceByCode.get(provinceCode);
  if (!province) throw new CommercialSearchError(400, "commercial_search_province_required");

  let officialArea: CommercialAreaSearchItem | null = null;
  if (areaCode) {
    const areas = await loadProvinceAreas(province, input.userId);
    officialArea = (areas.envelope.items as CommercialAreaSearchItem[])
      .find((item) => item.areaCode === areaCode) ?? null;
    if (!officialArea) throw new CommercialSearchError(400, "invalid_commercial_area_code");
  }

  let officialIndustry: CommercialIndustryOption | null = null;
  if (industryCode) {
    const industries = await listCommercialIndustries(input.userId);
    officialIndustry = industries.items.find((item) => item.code === industryCode) ?? null;
    if (!officialIndustry) {
      throw new CommercialSearchError(400, "invalid_commercial_industry_code");
    }
  }

  const request = commercialStoreProviderRequest(input);
  const scopeCode = areaCode || provinceCode;
  const scopeLabel = officialArea?.name ?? province.name;
  const loaded = await withProtectedProviderCall({
    userId: input.userId,
    cacheIdentity: `stores:${request.endpoint}:${JSON.stringify(request.params)}`,
    kind: "stores",
    estimatedCalls: 1,
    fetcher: async (apiKey) => {
      let requestCount = 0;
      try {
        requestCount += 1;
        const response = await dataGoJson(
          apiKey,
          request.endpoint,
          request.params,
          "ServiceKey",
          10_000,
        );
        const items = normalizeCommercialStoreRows(response.items);
        return {
          envelope: providerEnvelope({
            kind: "stores",
            items,
            providerTotalCount: response.totalCountProvided ? response.totalCount : items.length,
            partial: items.length !== response.items.length,
            cacheMs: STORE_CACHE_MS,
          }),
          requestCount,
        };
      } catch (error) {
        throw new ProviderFetchError(requestCount, error);
      }
    },
  });
  const items = loaded.envelope.items as CommercialStoreSearchItem[];
  return {
    kind: "stores",
    items,
    page: input.page,
    pageSize: input.pageSize,
    providerTotalCount: loaded.envelope.providerTotalCount,
    hasMore: input.page * input.pageSize < loaded.envelope.providerTotalCount,
    scope: {
      type: areaCode ? "commercial-area" : "province",
      code: scopeCode,
      label: scopeLabel,
      industryCode,
      industryName: officialIndustry?.name ?? null,
    },
    composition: {
      basis: "current-provider-page",
      ...commercialStoreComposition(items),
    },
    meta: metaOf(loaded.envelope, loaded.cached, "official-store-location"),
  };
}
