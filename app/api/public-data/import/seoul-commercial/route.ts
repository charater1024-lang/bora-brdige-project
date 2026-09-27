import {
  environmentValue,
  runtimeServiceSecrets,
} from "@/lib/runtime-settings";
import {
  ensurePublicSourceStates,
  readPublicSourceCatalog,
  savePublicSourceCatalog,
  setPublicSourceActivation,
} from "@/lib/public-data/cache";
import {
  kstQuotaDay,
  PUBLIC_SOURCE_POLICIES,
} from "@/lib/public-data/policies";
import type { PublicInformationItem } from "@/lib/public-data/types";
import { readBoundedRequestText, requestBodyErrorResponse } from "@/lib/http/request-body";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const SOURCE_ID = "seoul-commercial";
const SERVICE_KEY = "SEOUL_OPEN_DATA_API_KEY";
const MAX_ITEMS = 2_000;
const MAX_BODY_BYTES = 8_000_000;
const MIN_AREA_ITEMS = 1_500;
const OFFICIAL_HOURS = [0, 6, 11, 14, 17, 21] as const;
const DATASET_IDS = {
  sales: "OA-15572",
  footfall: "OA-15568",
  area: "OA-15560",
} as const;
const DATASET_ROW_LIMITS = {
  sales: 1_000_000,
  footfall: 100_000,
  area: 10_000,
} as const;
const DATASET_BYTE_LIMITS = {
  sales: 150_000_000,
  footfall: 40_000_000,
  area: 10_000_000,
} as const;

type DatasetManifest = {
  infId: string;
  providerRowCount: number;
  fetchedRowCount: number;
  providerAreaCount: number;
  fetchedAreaCount: number;
  contentBytes: number;
  sha256: string;
};

export type SeoulCommercialImportManifest = {
  schemaVersion: 1;
  fullSnapshot: true;
  quarter: string;
  collectedAt: string;
  unionAreaCount: number;
  itemCount: number;
  datasets: {
    sales: DatasetManifest;
    footfall: DatasetManifest;
    area: DatasetManifest;
  };
  coverage: {
    salesAreaCount: number;
    footfallAreaCount: number;
    areaCount: number;
    salesRatio: number;
    footfallRatio: number;
  };
};

type SeoulCommercialImportPayload = {
  sourceId: typeof SOURCE_ID;
  manifest: SeoulCommercialImportManifest;
  items: PublicInformationItem[];
};

function constantTimeEqual(left: string, right: string) {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

function safeInteger(value: unknown, minimum: number, maximum: number) {
  return Number.isSafeInteger(value)
    && Number(value) >= minimum
    && Number(value) <= maximum;
}

function validIso(value: unknown) {
  if (typeof value !== "string" || value.length < 20 || value.length > 40) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && value.endsWith("Z");
}

function officialSeoulUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "data.seoul.go.kr"
      && url.username === ""
      && url.password === "";
  } catch {
    return false;
  }
}

function quarterEndDate(quarter: string) {
  const year = quarter.slice(0, 4);
  const endings = ["03-31", "06-30", "09-30", "12-31"];
  return `${year}-${endings[Number(quarter[4]) - 1]}`;
}

function validHourlySeries(
  value: unknown,
  key: "amount" | "people",
) {
  if (!Array.isArray(value) || (value.length !== 0 && value.length !== OFFICIAL_HOURS.length)) {
    return false;
  }
  return value.every((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    return record.hour === OFFICIAL_HOURS[index]
      && safeInteger(record[key], 0, Number.MAX_SAFE_INTEGER);
  });
}

function validComposition(value: unknown) {
  if (!Array.isArray(value) || value.length > 24) return false;
  let total = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.name !== "string"
      || !record.name.trim()
      || record.name.length > 120
      || typeof record.sharePercent !== "number"
      || !Number.isFinite(record.sharePercent)
      || record.sharePercent < 0
      || record.sharePercent > 100
      || record.storeCount !== null
    ) {
      return false;
    }
    total += record.sharePercent;
  }
  return value.length === 0 || Math.abs(total - 100) <= 0.05;
}

function validIncomingItem(
  value: unknown,
  quarter: string,
): value is PublicInformationItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<PublicInformationItem>;
  const code = typeof item.id === "string"
    ? /^seoul-commercial-(\d{7,10})$/u.exec(item.id)?.[1]
    : null;
  const area = item.commercialArea;
  const analytics = area?.analytics;
  if (
    !code
    || item.category !== "startup"
    || typeof item.title !== "string"
    || !item.title.trim()
    || item.title.length > 180
    || typeof item.summary !== "string"
    || !item.summary.trim()
    || typeof item.source !== "string"
    || !item.source.trim()
    || !officialSeoulUrl(item.sourceUrl)
    || item.sourceLinkKind !== "dataset"
    || item.publishedAt !== quarterEndDate(quarter)
    || !validIso(item.discoveredAt)
    || !validIso(item.lastVerifiedAt)
    || !area
    || (area.areaSquareMeters !== null && (
      typeof area.areaSquareMeters !== "number"
      || !Number.isFinite(area.areaSquareMeters)
      || area.areaSquareMeters <= 0
    ))
    || area.referenceDate !== quarterEndDate(quarter)
    || !analytics
    || analytics.officialCode !== code
    || analytics.referenceQuarter !== quarter
    || !officialSeoulUrl(analytics.sourceUrl)
    || !validComposition(analytics.industrySalesComposition)
    || !validHourlySeries(analytics.salesByHour, "amount")
    || !validHourlySeries(analytics.footfallByHour, "people")
  ) {
    return false;
  }
  const hasSales = analytics.estimatedTotalSales !== null;
  if (
    hasSales
      ? !safeInteger(analytics.estimatedTotalSales, 0, Number.MAX_SAFE_INTEGER)
        || analytics.salesByHour.length !== OFFICIAL_HOURS.length
      : analytics.salesByHour.length !== 0
        || analytics.industrySalesComposition.length !== 0
  ) {
    return false;
  }
  return true;
}

function validDatasetManifest(
  value: unknown,
  dataset: keyof typeof DATASET_IDS,
): value is DatasetManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Partial<DatasetManifest>;
  const maximumRows = DATASET_ROW_LIMITS[dataset];
  return manifest.infId === DATASET_IDS[dataset]
    && safeInteger(manifest.providerRowCount, 1, maximumRows)
    && safeInteger(manifest.fetchedRowCount, 1, maximumRows)
    && Number(manifest.fetchedRowCount) <= Number(manifest.providerRowCount)
    && safeInteger(manifest.providerAreaCount, 1, MAX_ITEMS)
    && safeInteger(manifest.fetchedAreaCount, 1, MAX_ITEMS)
    && Number(manifest.fetchedAreaCount) <= Number(manifest.providerAreaCount)
    && safeInteger(manifest.contentBytes, 1, DATASET_BYTE_LIMITS[dataset])
    && typeof manifest.sha256 === "string"
    && /^[a-f0-9]{64}$/u.test(manifest.sha256);
}

function ratiosMatch(numerator: number, denominator: number, ratio: number) {
  return Number.isFinite(ratio)
    && ratio >= 0
    && ratio <= 1
    && Math.abs(ratio - numerator / denominator) <= 0.000001;
}

export function validateSeoulCommercialImportPayload(
  value: unknown,
): SeoulCommercialImportPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as {
    sourceId?: unknown;
    manifest?: unknown;
    items?: unknown;
  };
  if (
    payload.sourceId !== SOURCE_ID
    || !payload.manifest
    || typeof payload.manifest !== "object"
    || Array.isArray(payload.manifest)
    || !Array.isArray(payload.items)
  ) {
    return null;
  }
  const manifest = payload.manifest as Partial<SeoulCommercialImportManifest>;
  const datasets = manifest.datasets;
  const coverage = manifest.coverage;
  if (
    manifest.schemaVersion !== 1
    || manifest.fullSnapshot !== true
    || typeof manifest.quarter !== "string"
    || !/^20\d{2}[1-4]$/u.test(manifest.quarter)
    || !validIso(manifest.collectedAt)
    || !safeInteger(manifest.unionAreaCount, MIN_AREA_ITEMS, MAX_ITEMS)
    || !safeInteger(manifest.itemCount, MIN_AREA_ITEMS, MAX_ITEMS)
    || !datasets
    || !validDatasetManifest(datasets.sales, "sales")
    || !validDatasetManifest(datasets.footfall, "footfall")
    || !validDatasetManifest(datasets.area, "area")
    || !coverage
    || !safeInteger(coverage.salesAreaCount, 1, MAX_ITEMS)
    || !safeInteger(coverage.footfallAreaCount, 1, MAX_ITEMS)
    || !safeInteger(coverage.areaCount, MIN_AREA_ITEMS, MAX_ITEMS)
    || manifest.itemCount !== payload.items.length
    || manifest.unionAreaCount !== manifest.itemCount
    || coverage.areaCount !== manifest.unionAreaCount
    || datasets.area.fetchedAreaCount !== coverage.areaCount
    || datasets.sales.fetchedAreaCount !== coverage.salesAreaCount
    || datasets.footfall.fetchedAreaCount !== coverage.footfallAreaCount
    || !ratiosMatch(coverage.salesAreaCount, coverage.areaCount, coverage.salesRatio)
    || !ratiosMatch(coverage.footfallAreaCount, coverage.areaCount, coverage.footfallRatio)
  ) {
    return null;
  }
  const quarter = manifest.quarter;
  const items = payload.items as unknown[];
  if (!items.every((item) => validIncomingItem(item, quarter))) return null;
  const typedItems = items as PublicInformationItem[];
  const uniqueIds = new Set(typedItems.map((item) => item.id));
  if (uniqueIds.size !== typedItems.length) return null;
  const salesAreaCount = typedItems.filter(
    (item) => item.commercialArea!.analytics!.estimatedTotalSales !== null,
  ).length;
  const footfallAreaCount = typedItems.filter(
    (item) => item.commercialArea!.analytics!.footfallByHour.length === OFFICIAL_HOURS.length,
  ).length;
  if (
    salesAreaCount !== coverage.salesAreaCount
    || footfallAreaCount !== coverage.footfallAreaCount
  ) {
    return null;
  }
  return {
    sourceId: SOURCE_ID,
    manifest: manifest as SeoulCommercialImportManifest,
    items: typedItems,
  };
}

export function seoulManifestCompleteness(manifest: SeoulCommercialImportManifest) {
  const datasets = Object.values(manifest.datasets);
  return datasets.every((dataset) => (
    dataset.fetchedRowCount === dataset.providerRowCount
    && dataset.fetchedAreaCount === dataset.providerAreaCount
  ))
    ? "complete" as const
    : "partial" as const;
}

async function schedulerSecret(request: Request) {
  const secret = await environmentValue("SCHEDULER_SECRET");
  if (!secret || secret.length < 32) {
    return { error: Response.json({ error: "scheduler_secret_missing" }, { status: 503 }) } as const;
  }
  if (!constantTimeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return { error: Response.json({ error: "invalid_scheduler_secret" }, { status: 401 }) } as const;
  }
  return { secret } as const;
}

async function sourceEnabled() {
  const services = await runtimeServiceSecrets([SERVICE_KEY]);
  return Boolean(services[SERVICE_KEY]);
}

function noStore(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: {
      ...init?.headers,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function boundedRequestText(request: Request) {
  return readBoundedRequestText(request, { maxBytes: MAX_BODY_BYTES });
}

export async function GET(request: Request) {
  try {
    const access = await schedulerSecret(request);
    if ("error" in access) return access.error;
    return noStore({ enabled: await sourceEnabled(), sourceId: SOURCE_ID });
  } catch {
    return noStore({ error: "source_status_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const access = await schedulerSecret(request);
  if ("error" in access) return access.error;
  if (!(await sourceEnabled())) {
    return noStore({ error: "source_disabled" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = JSON.parse(await boundedRequestText(request));
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return noStore({ error: "invalid_import_payload" }, { status: 400 });
  }
  const candidate = validateSeoulCommercialImportPayload(body);
  if (!candidate) {
    return noStore({ error: "invalid_import_catalog" }, { status: 400 });
  }
  const completeness = seoulManifestCompleteness(candidate.manifest);
  if (completeness !== "complete") {
    return noStore({
      error: "incomplete_import_catalog",
      sourceId: SOURCE_ID,
      completeness,
      manifest: candidate.manifest,
    }, { status: 422 });
  }

  const previous = new Map(
    (await readPublicSourceCatalog(SOURCE_ID).catch(() => []))
      .map((item) => [item.id, item]),
  );
  const items = candidate.items.map((item) => {
    const prior = previous.get(item.id);
    const incomingArea = item.commercialArea!;
    const priorArea = prior?.commercialArea;
    return {
      ...item,
      discoveredAt: prior?.discoveredAt ?? item.discoveredAt,
      ...(item.location
        ? { location: item.location }
        : prior?.location
          ? { location: prior.location }
          : {}),
      commercialArea: {
        areaSquareMeters: incomingArea.areaSquareMeters,
        referenceDate: incomingArea.referenceDate,
        coordinateCount: incomingArea.coordinateCount,
        ...(incomingArea.displayBoundary
          ? { displayBoundary: incomingArea.displayBoundary }
          : priorArea?.displayBoundary
            ? { displayBoundary: priorArea.displayBoundary }
            : {}),
        analytics: incomingArea.analytics!,
      },
    } satisfies PublicInformationItem;
  });
  // The importer has already performed all official HTTPS downloads, but the
  // setting may have changed while the bounded payload was being parsed.
  // Re-check immediately before the only persistent mutation.
  if (!(await sourceEnabled())) {
    return noStore({ error: "source_disabled" }, { status: 409 });
  }
  const now = Date.now();
  await savePublicSourceCatalog(SOURCE_ID, items, now);
  await ensurePublicSourceStates(PUBLIC_SOURCE_POLICIES, kstQuotaDay(now), now);
  await setPublicSourceActivation({
    sourceIds: [SOURCE_ID],
    enabled: true,
    now,
    inactiveUntil: now,
  });
  return noStore({
    ok: true,
    sourceId: SOURCE_ID,
    itemCount: items.length,
    quarter: candidate.manifest.quarter,
    fullSnapshot: true,
    completeness,
    manifest: candidate.manifest,
    updatedAt: new Date(now).toISOString(),
  });
}
