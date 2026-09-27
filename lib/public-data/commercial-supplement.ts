import {
  type PublicCommercialAnalyticsSupplement,
  type PublicCommercialAnalyticsSupplementLocationRow,
  type PublicCommercialAnalyticsSupplementRow,
  type PublicDataDashboard,
  type PublicInformationItem,
} from "./types";
import { safePublicHttpUrl } from "./urls";

const MAX_ROWS = 1_800;
const MAX_DICTIONARY_ENTRIES = 20_000;
const MAX_STRING_LENGTH = 2_048;
const MAX_INDUSTRIES = 24;
const MAX_TIME_BANDS = 24;

function finiteNullable(value: unknown) {
  return value === null || value === undefined
    ? null
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : null;
}

function nonNegativeNullable(value: unknown) {
  const normalized = finiteNullable(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
}

/**
 * Encode Seoul analytics for transport without repeating long JSON keys and
 * provider strings 1,650 times. This never changes the durable cache format.
 */
export function encodeCommercialAnalyticsSupplement(
  items: readonly PublicInformationItem[],
): PublicCommercialAnalyticsSupplement | null {
  if (!items.length || items.length > MAX_ROWS) return null;
  const dictionary: string[] = [];
  const indexes = new Map<string, number>();
  const intern = (value: string) => {
    const normalized = value.slice(0, MAX_STRING_LENGTH);
    const existing = indexes.get(normalized);
    if (existing !== undefined) return existing;
    if (dictionary.length >= MAX_DICTIONARY_ENTRIES) throw new Error("commercial_supplement_dictionary_full");
    const index = dictionary.length;
    dictionary.push(normalized);
    indexes.set(normalized, index);
    return index;
  };
  const optional = (value: string | null | undefined) => (
    typeof value === "string" && value.length ? intern(value) : null
  );

  try {
    const rows = items.map((item): PublicCommercialAnalyticsSupplementRow => {
      const analytics = item.commercialArea?.analytics;
      if (!analytics || item.category !== "startup") throw new Error("commercial_supplement_invalid_item");
      const location = item.location;
      const locationRow: PublicCommercialAnalyticsSupplementLocationRow | null = location
        ? [
            intern(location.label),
            optional(location.province),
            optional(location.city),
            optional(location.neighborhood),
            finiteNullable(location.latitude),
            finiteNullable(location.longitude),
            intern(location.precision),
          ]
        : null;
      return [
        intern(item.id),
        intern(item.title),
        intern(item.source),
        intern(item.sourceUrl),
        optional(item.publishedAt),
        intern(item.discoveredAt),
        locationRow,
        nonNegativeNullable(item.commercialArea?.areaSquareMeters),
        optional(item.commercialArea?.referenceDate),
        intern(analytics.officialCode),
        intern(analytics.referenceQuarter),
        optional(analytics.areaType),
        nonNegativeNullable(analytics.estimatedTotalSales),
        analytics.industrySalesComposition.slice(0, MAX_INDUSTRIES)
          .map((entry) => [intern(entry.name), entry.sharePercent]),
        analytics.salesByHour.slice(0, MAX_TIME_BANDS)
          .map((entry) => [entry.hour, entry.amount]),
        analytics.footfallByHour.slice(0, MAX_TIME_BANDS)
          .map((entry) => [entry.hour, entry.people]),
        intern(analytics.sourceUrl),
      ];
    });
    return { version: 1, dictionary, rows };
  } catch {
    return null;
  }
}

function validIndex(value: unknown, dictionary: readonly string[]) {
  return Number.isSafeInteger(value)
    && Number(value) >= 0
    && Number(value) < dictionary.length;
}

function validOptionalIndex(value: unknown, dictionary: readonly string[]) {
  return value === null || validIndex(value, dictionary);
}

function validLocation(
  value: unknown,
  dictionary: readonly string[],
): value is PublicCommercialAnalyticsSupplementLocationRow {
  if (!Array.isArray(value) || value.length !== 7) return false;
  const [label, province, city, neighborhood, latitude, longitude, precision] = value;
  return validIndex(label, dictionary)
    && validOptionalIndex(province, dictionary)
    && validOptionalIndex(city, dictionary)
    && validOptionalIndex(neighborhood, dictionary)
    && (latitude === null || (typeof latitude === "number" && Number.isFinite(latitude) && latitude >= 32 && latitude <= 40))
    && (longitude === null || (typeof longitude === "number" && Number.isFinite(longitude) && longitude >= 124 && longitude <= 132))
    && validIndex(precision, dictionary)
    && ["point", "road-address", "administrative"].includes(dictionary[Number(precision)]);
}

function validMetricRows(
  rows: unknown,
  valueName: "amount" | "people",
) {
  if (!Array.isArray(rows) || rows.length > MAX_TIME_BANDS) return null;
  const seen = new Set<number>();
  const normalized: Array<{ hour: number; amount?: number; people?: number }> = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 2) return null;
    const [hour, value] = row;
    if (!Number.isSafeInteger(hour) || Number(hour) < 0 || Number(hour) > 23 || seen.has(Number(hour))
      || typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    seen.add(Number(hour));
    normalized.push(valueName === "amount"
      ? { hour: Number(hour), amount: value }
      : { hour: Number(hour), people: value });
  }
  return normalized;
}

/** Expand the response-only wire projection into the established UI model. */
export function decodeCommercialAnalyticsSupplement(
  supplement: PublicCommercialAnalyticsSupplement | null | undefined,
): PublicInformationItem[] {
  if (!supplement || supplement.version !== 1
    || !Array.isArray(supplement.dictionary)
    || !Array.isArray(supplement.rows)
    || supplement.dictionary.length > MAX_DICTIONARY_ENTRIES
    || supplement.rows.length > MAX_ROWS) return [];
  const dictionary = supplement.dictionary;
  if (dictionary.some((value) => typeof value !== "string" || value.length > MAX_STRING_LENGTH)
    || new Set(dictionary).size !== dictionary.length) return [];
  const text = (index: number) => dictionary[index];
  const items: PublicInformationItem[] = [];
  const ids = new Set<string>();
  for (const row of supplement.rows) {
    if (!Array.isArray(row) || row.length !== 17) return [];
    const [
      idIndex, titleIndex, sourceIndex, sourceUrlIndex, publishedIndex,
      discoveredIndex, locationRow, areaSquareMeters, referenceDateIndex,
      codeIndex, quarterIndex, areaTypeIndex, estimatedTotalSales,
      industryRows, salesRows, footfallRows, analyticsUrlIndex,
    ] = row;
    const requiredIndexes = [
      idIndex, titleIndex, sourceIndex, sourceUrlIndex, discoveredIndex,
      codeIndex, quarterIndex, analyticsUrlIndex,
    ];
    if (requiredIndexes.some((value) => !validIndex(value, dictionary))
      || !validOptionalIndex(publishedIndex, dictionary)
      || !validOptionalIndex(referenceDateIndex, dictionary)
      || !validOptionalIndex(areaTypeIndex, dictionary)
      || (locationRow !== null && !validLocation(locationRow, dictionary))
      || (areaSquareMeters !== null && nonNegativeNullable(areaSquareMeters) === null)
      || (estimatedTotalSales !== null && nonNegativeNullable(estimatedTotalSales) === null)
      || !Array.isArray(industryRows) || industryRows.length > MAX_INDUSTRIES) return [];
    const id = text(idIndex);
    const officialCode = text(codeIndex);
    const sourceUrl = safePublicHttpUrl(text(sourceUrlIndex));
    const analyticsSourceUrl = safePublicHttpUrl(text(analyticsUrlIndex));
    const discoveredAt = text(discoveredIndex);
    if (!/^\d{7,10}$/u.test(officialCode) || id !== `seoul-commercial-${officialCode}` || ids.has(id)
      || !sourceUrl || !analyticsSourceUrl || !Number.isFinite(Date.parse(discoveredAt))) return [];
    const composition = industryRows.flatMap((entry) => {
      if (!Array.isArray(entry) || entry.length !== 2 || !validIndex(entry[0], dictionary)
        || typeof entry[1] !== "number" || !Number.isFinite(entry[1]) || entry[1] < 0 || entry[1] > 100) return [];
      return [{ name: text(entry[0]), sharePercent: entry[1], storeCount: null as null }];
    });
    if (composition.length !== industryRows.length) return [];
    const sales = validMetricRows(salesRows, "amount");
    const footfall = validMetricRows(footfallRows, "people");
    if (!sales || !footfall) return [];
    ids.add(id);
    const location = locationRow === null ? undefined : {
      label: text(locationRow[0]),
      ...(locationRow[1] === null ? {} : { province: text(locationRow[1]) }),
      ...(locationRow[2] === null ? {} : { city: text(locationRow[2]) }),
      ...(locationRow[3] === null ? {} : { neighborhood: text(locationRow[3]) }),
      ...(locationRow[4] === null ? {} : { latitude: locationRow[4] }),
      ...(locationRow[5] === null ? {} : { longitude: locationRow[5] }),
      precision: text(locationRow[6]) as "point" | "road-address" | "administrative",
    };
    items.push({
      id,
      category: "startup",
      title: text(titleIndex),
      summary: "",
      source: text(sourceIndex),
      sourceUrl,
      publishedAt: publishedIndex === null ? null : text(publishedIndex),
      discoveredAt,
      tags: [],
      ...(location ? { location } : {}),
      commercialArea: {
        areaSquareMeters: areaSquareMeters as number | null,
        referenceDate: referenceDateIndex === null ? null : text(referenceDateIndex),
        coordinateCount: null,
        analytics: {
          officialCode,
          referenceQuarter: text(quarterIndex),
          areaType: areaTypeIndex === null ? null : text(areaTypeIndex),
          estimatedTotalSales: estimatedTotalSales as number | null,
          industrySalesComposition: composition,
          salesByHour: sales as Array<{ hour: number; amount: number }>,
          footfallByHour: footfall as Array<{ hour: number; people: number }>,
          sourceUrl: analyticsSourceUrl,
        },
      },
    });
  }
  return items;
}

/**
 * Convert only the response projection. If an unexpected item cannot be
 * encoded, retain the existing self-describing payload as a safe fallback.
 */
export function compactCommercialAnalyticsDashboard(
  dashboard: PublicDataDashboard,
): PublicDataDashboard {
  return {
    ...dashboard,
    categories: dashboard.categories.map((group) => {
      if (group.id !== "startup" || !group.supplementalItems?.length) return group;
      const commercialAnalyticsSupplement = encodeCommercialAnalyticsSupplement(group.supplementalItems);
      if (!commercialAnalyticsSupplement) return group;
      const compactGroup = { ...group };
      delete compactGroup.supplementalItems;
      return { ...compactGroup, commercialAnalyticsSupplement };
    }),
  };
}
