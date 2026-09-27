import type { PublicInformationItem } from "./types";
import { safePublicHttpUrl } from "./urls";

export type CommercialDataStatus =
  | "available"
  | "not-provided"
  | "not-configured"
  | "temporarily-unavailable"
  | "stale";

export interface CommercialMetricSource {
  name: string;
  url: string | null;
  referenceDate: string | null;
}

export interface CommercialObservation<T> {
  value: T | null;
  unit: string;
  status: CommercialDataStatus;
  source: CommercialMetricSource;
  note: string | null;
}

export interface CommercialBoundaryPoint {
  longitude: number;
  latitude: number;
}

export interface CommercialIndustryShare {
  name: string;
  sharePercent: number;
  storeCount: number | null;
}

export interface CommercialHourlyAmount {
  hour: number;
  amount: number;
}

export interface CommercialHourlyFootfall {
  hour: number;
  people: number;
}

export interface CommercialAreaInsight {
  id: string;
  name: string;
  locationLabel: string;
  rankByConsumption: number | null;
  totalConsumption: CommercialObservation<number>;
  boundaryArea: CommercialObservation<number>;
  boundary: CommercialObservation<CommercialBoundaryPoint[]>;
  areaType: CommercialObservation<string>;
  industryComposition: CommercialObservation<CommercialIndustryShare[]>;
  paymentsByHour: CommercialObservation<CommercialHourlyAmount[]>;
  footfallByHour: CommercialObservation<CommercialHourlyFootfall[]>;
  rent: CommercialObservation<number>;
}

export interface CommercialObservationInput<T> {
  value: T | null;
  unit: string;
  status: CommercialDataStatus;
  sourceName: string;
  sourceUrl: string | null;
  referenceDate: string | null;
  note?: string | null;
}

/**
 * Optional, separately sourced analytics joined only by the exact official
 * commercial-area item id. The national area API currently does not supply
 * these fields, so callers must never construct a record from area or rank.
 */
export interface CommercialAreaAnalyticsRecord {
  itemId: string;
  totalConsumption?: CommercialObservationInput<number>;
  areaType?: CommercialObservationInput<string>;
  industryComposition?: CommercialObservationInput<CommercialIndustryShare[]>;
  paymentsByHour?: CommercialObservationInput<CommercialHourlyAmount[]>;
  footfallByHour?: CommercialObservationInput<CommercialHourlyFootfall[]>;
  rent?: CommercialObservationInput<number>;
}

const CURRENT_AREA_NOTE = "The official national commercial-area API supplies boundary and location data, not sales analytics.";
const SEOUL_ANALYTICS_NOTE = "Official quarterly estimates in the source's six unequal time bands (00–06, 06–11, 11–14, 14–17, 17–21, 21–24), not individual hourly observations.";
const SEOUL_RENT_NOTE = "The Seoul source does not provide a compatible commercial-rent metric.";

function sourceOf(input: {
  sourceName: string;
  sourceUrl: string | null;
  referenceDate: string | null;
}): CommercialMetricSource {
  return {
    name: input.sourceName.trim().slice(0, 180) || "출처 미제공",
    url: safePublicHttpUrl(input.sourceUrl),
    referenceDate: typeof input.referenceDate === "string" && input.referenceDate.trim()
      ? input.referenceDate.trim().slice(0, 40)
      : null,
  };
}

function observation<T>(
  input: CommercialObservationInput<T>,
  normalize: (value: T) => T | null,
): CommercialObservation<T> {
  const value = input.value === null ? null : normalize(input.value);
  const status = value === null && input.status === "available"
    ? "temporarily-unavailable"
    : input.status;
  return {
    value,
    unit: input.unit.trim().slice(0, 80),
    status,
    source: sourceOf(input),
    note: typeof input.note === "string" && input.note.trim()
      ? input.note.trim().slice(0, 400)
      : null,
  };
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function nonEmptyText(value: string) {
  const normalized = value.trim().slice(0, 120);
  return normalized || null;
}

function industryShares(value: CommercialIndustryShare[]) {
  const normalized = value.flatMap((entry) => {
    const name = nonEmptyText(entry.name);
    const sharePercent = Number(entry.sharePercent);
    const storeCount = entry.storeCount === null ? null : Number(entry.storeCount);
    if (!name || !Number.isFinite(sharePercent) || sharePercent < 0 || sharePercent > 100) return [];
    if (storeCount !== null && (!Number.isSafeInteger(storeCount) || storeCount < 0)) return [];
    return [{ name, sharePercent, storeCount }];
  }).slice(0, 24);
  if (!normalized.length) return null;
  const totalShare = normalized.reduce((sum, entry) => sum + entry.sharePercent, 0);
  return totalShare > 0 && totalShare <= 100.5 ? normalized : null;
}

function hourlyAmounts(value: CommercialHourlyAmount[]) {
  const seen = new Set<number>();
  const normalized = value.flatMap((entry) => {
    const hour = Number(entry.hour);
    const amount = Number(entry.amount);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || seen.has(hour)) return [];
    if (!Number.isFinite(amount) || amount < 0) return [];
    seen.add(hour);
    return [{ hour, amount }];
  }).sort((left, right) => left.hour - right.hour);
  return normalized.length ? normalized : null;
}

function hourlyFootfall(value: CommercialHourlyFootfall[]) {
  const seen = new Set<number>();
  const normalized = value.flatMap((entry) => {
    const hour = Number(entry.hour);
    const people = Number(entry.people);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || seen.has(hour)) return [];
    if (!Number.isFinite(people) || people < 0) return [];
    seen.add(hour);
    return [{ hour, people }];
  }).sort((left, right) => left.hour - right.hour);
  return normalized.length ? normalized : null;
}

function missingObservation<T>(
  item: PublicInformationItem,
  unit: string,
  note = CURRENT_AREA_NOTE,
): CommercialObservation<T> {
  return {
    value: null,
    unit,
    status: "not-provided",
    source: sourceOf({
      sourceName: item.source,
      sourceUrl: item.sourceUrl,
      referenceDate: item.commercialArea?.referenceDate ?? item.publishedAt,
    }),
    note,
  };
}

function boundaryObservation(item: PublicInformationItem): CommercialObservation<CommercialBoundaryPoint[]> {
  const displayBoundary = item.commercialArea?.displayBoundary;
  const points = displayBoundary?.points.flatMap(([longitude, latitude]) => (
    Number.isFinite(longitude) && longitude >= 124 && longitude <= 132
    && Number.isFinite(latitude) && latitude >= 32 && latitude <= 40
      ? [{ longitude, latitude }]
      : []
  )) ?? [];
  const valid = points.length >= 4 ? points : null;
  return {
    value: valid,
    unit: "WGS84",
    status: valid ? "available" : "not-provided",
    source: sourceOf({
      sourceName: item.source,
      sourceUrl: displayBoundary?.sourceUrl ?? item.sourceUrl,
      referenceDate: displayBoundary?.referenceDate
        ?? item.commercialArea?.referenceDate
        ?? item.publishedAt,
    }),
    note: valid && displayBoundary?.simplified
      ? "공식 경계 좌표를 화면 표시용으로 단순화했습니다. 법적 측량 자료로 사용할 수 없습니다."
      : valid
        ? "공식 경계 좌표입니다. 법적 측량 자료로 사용할 수 없습니다."
        : "현재 응답에 표시 가능한 공식 경계 좌표가 없습니다.",
  };
}

function areaObservation(item: PublicInformationItem): CommercialObservation<number> {
  const area = item.commercialArea?.areaSquareMeters;
  const value = typeof area === "number" && Number.isFinite(area) && area > 0 ? area : null;
  return {
    value,
    unit: "㎡",
    status: value === null ? "not-provided" : "available",
    source: sourceOf({
      sourceName: item.source,
      sourceUrl: item.sourceUrl,
      referenceDate: item.commercialArea?.referenceDate ?? item.publishedAt,
    }),
    note: value === null ? "현재 응답에 공식 상권 면적이 없습니다." : null,
  };
}

function seoulDisplayText(item: PublicInformationItem, value: string) {
  if (!item.id.startsWith("seoul-commercial-")) return value.trim();
  // The legacy CP949 sheet occasionally exposed its middle-dot separator as
  // `?` (for example 종로1?2?3?4가동). Restrict repair to Seoul official names
  // and only between letters/digits so genuine punctuation elsewhere stays.
  return value.trim().replace(/([\p{L}\d])\?(?=[\p{L}\d])/gu, "$1·");
}

function locationLabel(item: PublicInformationItem) {
  const location = item.location;
  const output: string[] = [];
  for (const raw of [location?.province, location?.city, location?.neighborhood]) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    let value = seoulDisplayText(item, raw);
    for (const prefix of output) {
      if (value === prefix) value = "";
      else if (value.startsWith(`${prefix} `)) value = value.slice(prefix.length).trim();
    }
    if (value && !output.includes(value)) output.push(value);
  }
  if (!output.length && location?.label) output.push(seoulDisplayText(item, location.label));
  return output.join(" ") || "대한민국";
}

function embeddedAnalyticsRecord(
  item: PublicInformationItem,
): CommercialAreaAnalyticsRecord | null {
  const analytics = item.commercialArea?.analytics;
  if (!analytics) return null;
  const source = {
    sourceName: item.source,
    sourceUrl: analytics.sourceUrl,
    referenceDate: item.commercialArea?.referenceDate ?? analytics.referenceQuarter,
    note: SEOUL_ANALYTICS_NOTE,
  };
  return {
    itemId: item.id,
    totalConsumption: {
      ...source,
      value: analytics.estimatedTotalSales,
      unit: "KRW",
      status: analytics.estimatedTotalSales === null ? "not-provided" : "available",
    },
    areaType: {
      ...source,
      value: analytics.areaType,
      unit: "classification",
      status: analytics.areaType === null ? "not-provided" : "available",
    },
    industryComposition: {
      ...source,
      value: analytics.industrySalesComposition,
      unit: "%",
      status: analytics.industrySalesComposition.length ? "available" : "not-provided",
    },
    paymentsByHour: {
      ...source,
      value: analytics.salesByHour,
      unit: "KRW",
      status: analytics.salesByHour.length ? "available" : "not-provided",
    },
    footfallByHour: {
      ...source,
      value: analytics.footfallByHour,
      unit: "people",
      status: analytics.footfallByHour.length ? "available" : "not-provided",
    },
  };
}

export function buildCommercialAreaInsights(
  items: PublicInformationItem[],
  analytics: CommercialAreaAnalyticsRecord[] = [],
): CommercialAreaInsight[] {
  const analyticsById = new Map(analytics.map((record) => [record.itemId, record]));
  const insights = items
    .filter((item) => item.id.startsWith("commercial-") || Boolean(item.commercialArea))
    .map((item): CommercialAreaInsight => {
      const embeddedRecord = embeddedAnalyticsRecord(item);
      const explicitRecord = analyticsById.get(item.id);
      const record = explicitRecord
        ? { ...embeddedRecord, ...explicitRecord, itemId: item.id }
        : embeddedRecord;
      const totalConsumption = record?.totalConsumption
        ? observation(record.totalConsumption, finiteNonNegative)
        : missingObservation<number>(item, "KRW");
      return {
        id: item.id,
        name: seoulDisplayText(item, item.title).slice(0, 180) || "공식 상권명 미제공",
        locationLabel: locationLabel(item),
        rankByConsumption: null,
        totalConsumption,
        boundaryArea: areaObservation(item),
        boundary: boundaryObservation(item),
        areaType: record?.areaType
          ? observation(record.areaType, nonEmptyText)
          : missingObservation<string>(item, "classification"),
        industryComposition: record?.industryComposition
          ? observation(record.industryComposition, industryShares)
          : missingObservation<CommercialIndustryShare[]>(item, "%"),
        paymentsByHour: record?.paymentsByHour
          ? observation(record.paymentsByHour, hourlyAmounts)
          : missingObservation<CommercialHourlyAmount[]>(item, "KRW"),
        footfallByHour: record?.footfallByHour
          ? observation(record.footfallByHour, hourlyFootfall)
          : missingObservation<CommercialHourlyFootfall[]>(item, "people"),
        rent: record?.rent
          ? observation(record.rent, finiteNonNegative)
          : missingObservation<number>(
            item,
            "KRW",
            item.commercialArea?.analytics ? SEOUL_RENT_NOTE : CURRENT_AREA_NOTE,
          ),
      };
    });

  const ranked = insights
    .filter((insight) => insight.totalConsumption.status === "available"
      && insight.totalConsumption.value !== null)
    .sort((left, right) => (right.totalConsumption.value ?? 0) - (left.totalConsumption.value ?? 0));
  const rankById = new Map(ranked.map((insight, index) => [insight.id, index + 1]));
  return insights
    .map((insight) => ({ ...insight, rankByConsumption: rankById.get(insight.id) ?? null }))
    .sort((left, right) => {
      if (left.rankByConsumption !== null && right.rankByConsumption !== null) {
        return left.rankByConsumption - right.rankByConsumption;
      }
      if (left.rankByConsumption !== null) return -1;
      if (right.rankByConsumption !== null) return 1;
      return left.name.localeCompare(right.name, "ko-KR");
    });
}

export function topCommercialAreasByConsumption(
  insights: CommercialAreaInsight[],
  limit = 10,
) {
  return insights
    .filter((insight) => insight.rankByConsumption !== null)
    .slice(0, Math.min(10, Math.max(0, Math.floor(limit))));
}
