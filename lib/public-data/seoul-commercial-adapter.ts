import { safePublicHttpUrl } from "./urls";
import { PublicResponseBodyError, readBoundedResponseText } from "./bounded-response";
import type { PublicInformationItem, PublicInformationLocation } from "./types";

export const SEOUL_COMMERCIAL_SOURCE_ID = "seoul-commercial";
export const SEOUL_COMMERCIAL_MAX_REQUESTS = 40;
export const SEOUL_COMMERCIAL_PAGE_SIZE = 1_000;
export const SEOUL_COMMERCIAL_PAGE_CONCURRENCY = 5;

export const SEOUL_COMMERCIAL_SOURCE_URLS = {
  sales: "https://data.seoul.go.kr/dataList/OA-15572/A/1/datasetView.do",
  footfall: "https://data.seoul.go.kr/dataList/OA-15568/A/1/datasetView.do",
  area: "https://data.seoul.go.kr/dataList/OA-15560/A/1/datasetView.do",
} as const;

const SEOUL_OPEN_API_ORIGIN = "http://openapi.seoul.go.kr:8088";
const SEOUL_SERVICES = {
  sales: "VwsmTrdarSelngQq",
  footfall: "VwsmTrdarFlpopQq",
  area: "TbgisTrdarRelm",
} as const;

const SALES_HOURS = [0, 6, 11, 14, 17, 21] as const;
const SALES_FIELDS = [
  "TMZON_00_06_SELNG_AMT",
  "TMZON_06_11_SELNG_AMT",
  "TMZON_11_14_SELNG_AMT",
  "TMZON_14_17_SELNG_AMT",
  "TMZON_17_21_SELNG_AMT",
  "TMZON_21_24_SELNG_AMT",
] as const;
const FOOTFALL_FIELDS = [
  "TMZON_00_06_FLPOP_CO",
  "TMZON_06_11_FLPOP_CO",
  "TMZON_11_14_FLPOP_CO",
  "TMZON_14_17_FLPOP_CO",
  "TMZON_17_21_FLPOP_CO",
  "TMZON_21_24_FLPOP_CO",
] as const;

export type SeoulCommercialService = (typeof SEOUL_SERVICES)[keyof typeof SEOUL_SERVICES];
export type SeoulCommercialFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type SeoulCommercialBoundary = {
  points: Array<[longitude: number, latitude: number]>;
  simplified: boolean;
};
export type SeoulCommercialBoundaryLookup = (officialCode: string) => SeoulCommercialBoundary | null;

export class SeoulCommercialAdapterError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestCount = 0,
  ) {
    super(message);
  }
}

export class SeoulCommercialRequestBudget {
  private count = 0;

  constructor(readonly limit = SEOUL_COMMERCIAL_MAX_REQUESTS) {}

  consume() {
    if (this.count >= this.limit) {
      throw new SeoulCommercialAdapterError(503, "seoul_request_budget_exceeded");
    }
    this.count += 1;
  }

  get used() {
    return this.count;
  }
}

type SeoulServicePage = {
  totalCount: number;
  rows: Record<string, unknown>[];
  noData: boolean;
};

type CollectSeoulCommercialOptions = {
  apiKey: string;
  nowIso: string;
  previous: Map<string, PublicInformationItem>;
  fetchImpl?: SeoulCommercialFetch;
  boundaryLookup?: SeoulCommercialBoundaryLookup;
};

function cleanText(value: unknown, maxLength = 180) {
  return String(value ?? "")
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/([\p{L}\d])\?(?=[\p{L}\d])/gu, "$1·")
    .slice(0, maxLength);
}

function normalizedNeighborhood(district: string, value: string | null) {
  if (!value) return null;
  let normalized = value.replace(/^서울(?:특별시)?\s+/u, "").trim();
  if (normalized.startsWith(`${district} `)) normalized = normalized.slice(district.length).trim();
  return normalized || null;
}

function requiredText(row: Record<string, unknown>, key: string, maxLength = 180) {
  const value = cleanText(row[key], maxLength);
  if (!value) throw new SeoulCommercialAdapterError(502, `seoul_invalid_${key.toLowerCase()}`);
  return value;
}

function optionalText(row: Record<string, unknown>, key: string, maxLength = 180) {
  return cleanText(row[key], maxLength) || null;
}

function nonNegativeInteger(row: Record<string, unknown>, key: string) {
  const raw = String(row[key] ?? "").replaceAll(",", "").trim();
  if (!raw) throw new SeoulCommercialAdapterError(502, `seoul_invalid_${key.toLowerCase()}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SeoulCommercialAdapterError(502, `seoul_invalid_${key.toLowerCase()}`);
  }
  return value;
}

function positiveArea(row: Record<string, unknown>) {
  const raw = String(row.RELM_AR ?? "").replaceAll(",", "").trim();
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new SeoulCommercialAdapterError(502, "seoul_invalid_relm_ar");
  }
  return value;
}

function safeSum(left: number, right: number) {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SeoulCommercialAdapterError(502, "seoul_numeric_overflow");
  }
  return value;
}

function responseCode(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return cleanText((value as Record<string, unknown>).CODE, 40).toUpperCase();
}

function resultStatus(code: string) {
  if (!code || code === "INFO-000") return;
  if (code === "INFO-200") return "no-data" as const;
  if (code === "INFO-100") {
    throw new SeoulCommercialAdapterError(401, "seoul_authorization_failed");
  }
  if (code === "ERROR-335" || code === "ERROR-336") {
    throw new SeoulCommercialAdapterError(429, "seoul_quota_or_service_limit");
  }
  throw new SeoulCommercialAdapterError(502, `seoul_upstream_${code.toLowerCase().replace(/[^a-z0-9]+/gu, "_")}`);
}

function parseSeoulPage(payload: unknown, service: SeoulCommercialService): SeoulServicePage {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SeoulCommercialAdapterError(502, "seoul_invalid_response");
  }
  const root = payload as Record<string, unknown>;
  const topResult = responseCode(root.RESULT);
  if (topResult && resultStatus(topResult) === "no-data") {
    return { totalCount: 0, rows: [], noData: true };
  }
  const container = root[service];
  if (!container || typeof container !== "object" || Array.isArray(container)) {
    throw new SeoulCommercialAdapterError(502, "seoul_missing_service_container");
  }
  const serviceRoot = container as Record<string, unknown>;
  const code = responseCode(serviceRoot.RESULT);
  if (resultStatus(code) === "no-data") return { totalCount: 0, rows: [], noData: true };
  const totalCount = Number(serviceRoot.list_total_count);
  if (!Number.isSafeInteger(totalCount) || totalCount < 0) {
    throw new SeoulCommercialAdapterError(502, "seoul_invalid_total_count");
  }
  const rows = Array.isArray(serviceRoot.row)
    ? serviceRoot.row.filter((row): row is Record<string, unknown> => (
      Boolean(row) && typeof row === "object" && !Array.isArray(row)
    ))
    : [];
  if (rows.length !== (Array.isArray(serviceRoot.row) ? serviceRoot.row.length : 0)) {
    throw new SeoulCommercialAdapterError(502, "seoul_invalid_row");
  }
  return { totalCount, rows, noData: totalCount === 0 };
}

function endpointFor(
  apiKey: string,
  service: SeoulCommercialService,
  start: number,
  end: number,
  quarter: string | null,
) {
  const safeKey = encodeURIComponent(apiKey.trim());
  if (!safeKey) throw new SeoulCommercialAdapterError(401, "seoul_key_missing");
  const suffix = quarter ? `/${quarter}` : "";
  // Seoul's official upstream currently supports this dataset only over HTTP
  // on port 8088. This URL is built and fetched only on the server; neither it
  // nor the API key is placed in a cached item or browser response.
  return new URL(`${SEOUL_OPEN_API_ORIGIN}/${safeKey}/json/${service}/${start}/${end}${suffix}`);
}

async function fetchSeoulPage(args: {
  apiKey: string;
  service: SeoulCommercialService;
  start: number;
  end: number;
  quarter: string | null;
  fetchImpl: SeoulCommercialFetch;
  budget: SeoulCommercialRequestBudget;
}) {
  args.budget.consume();
  const endpoint = endpointFor(args.apiKey, args.service, args.start, args.end, args.quarter);
  let response: Response;
  try {
    response = await args.fetchImpl(endpoint, {
      // Cloudflare Workers rejects redirect:"error". Manual mode ensures the
      // HTTP-only provider key is never forwarded to a different endpoint.
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new SeoulCommercialAdapterError(502, "seoul_network_error");
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new SeoulCommercialAdapterError(502, "seoul_redirect");
  }
  if (response.url) {
    let responseUrl: URL;
    try {
      responseUrl = new URL(response.url);
    } catch {
      throw new SeoulCommercialAdapterError(502, "seoul_origin");
    }
    if (responseUrl.origin !== new URL(SEOUL_OPEN_API_ORIGIN).origin) {
      throw new SeoulCommercialAdapterError(502, "seoul_origin");
    }
  }
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 || response.status === 429
      ? response.status
      : 502;
    throw new SeoulCommercialAdapterError(status, `seoul_http_${response.status}`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("json")) {
    throw new SeoulCommercialAdapterError(502, "seoul_non_json_response");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await readBoundedResponseText(response, 5_000_000));
  } catch (error) {
    if (error instanceof PublicResponseBodyError) {
      throw new SeoulCommercialAdapterError(502, "seoul_body_too_large");
    }
    throw new SeoulCommercialAdapterError(502, "seoul_non_json_response");
  }
  return parseSeoulPage(payload, args.service);
}

function pageCount(totalCount: number) {
  return Math.max(1, Math.ceil(totalCount / SEOUL_COMMERCIAL_PAGE_SIZE));
}

function maximumPages(service: SeoulCommercialService) {
  if (service === SEOUL_SERVICES.sales) return 30;
  if (service === SEOUL_SERVICES.footfall) return 3;
  return 2;
}

function rowIdentity(service: SeoulCommercialService, row: Record<string, unknown>) {
  const areaCode = requiredText(row, "TRDAR_CD", 20);
  if (!/^\d{7,10}$/u.test(areaCode)) {
    throw new SeoulCommercialAdapterError(502, "seoul_invalid_trdar_cd");
  }
  if (service === SEOUL_SERVICES.sales) {
    return `${requiredText(row, "STDR_YYQU_CD", 8)}:${areaCode}:${requiredText(row, "SVC_INDUTY_CD", 40)}`;
  }
  if (service === SEOUL_SERVICES.footfall) {
    return `${requiredText(row, "STDR_YYQU_CD", 8)}:${areaCode}`;
  }
  return areaCode;
}

function validateQuarter(rows: Record<string, unknown>[], quarter: string, service: SeoulCommercialService) {
  if (service === SEOUL_SERVICES.area) return;
  for (const row of rows) {
    if (requiredText(row, "STDR_YYQU_CD", 8) !== quarter) {
      throw new SeoulCommercialAdapterError(502, "seoul_quarter_mismatch");
    }
  }
}

export async function collectSeoulServicePages(args: {
  apiKey: string;
  service: SeoulCommercialService;
  quarter: string | null;
  fetchImpl: SeoulCommercialFetch;
  budget: SeoulCommercialRequestBudget;
  firstPage?: SeoulServicePage;
}) {
  const first = args.firstPage ?? await fetchSeoulPage({
    ...args,
    start: 1,
    end: SEOUL_COMMERCIAL_PAGE_SIZE,
  });
  if (first.noData) return [];
  const totalPages = pageCount(first.totalCount);
  if (totalPages > maximumPages(args.service)) {
    throw new SeoulCommercialAdapterError(502, "seoul_page_limit_exceeded");
  }
  const expectedFirstCount = Math.min(SEOUL_COMMERCIAL_PAGE_SIZE, first.totalCount);
  if (first.rows.length !== expectedFirstCount) {
    throw new SeoulCommercialAdapterError(502, "seoul_incomplete_first_page");
  }
  const rows = [...first.rows];
  const remainingPages = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2);
  const settled = new Array<PromiseSettledResult<SeoulServicePage>>(remainingPages.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < remainingPages.length) {
      const index = nextIndex;
      nextIndex += 1;
      const page = remainingPages[index];
      const start = (page - 1) * SEOUL_COMMERCIAL_PAGE_SIZE + 1;
      const end = Math.min(page * SEOUL_COMMERCIAL_PAGE_SIZE, first.totalCount);
      try {
        settled[index] = {
          status: "fulfilled",
          value: await fetchSeoulPage({ ...args, start, end }),
        };
      } catch (reason) {
        settled[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(SEOUL_COMMERCIAL_PAGE_CONCURRENCY, remainingPages.length) },
    () => worker(),
  ));
  const failedPage = settled.find((result) => result.status === "rejected");
  if (failedPage?.status === "rejected") throw failedPage.reason;

  for (let index = 0; index < remainingPages.length; index += 1) {
    const page = remainingPages[index];
    const start = (page - 1) * SEOUL_COMMERCIAL_PAGE_SIZE + 1;
    const end = Math.min(page * SEOUL_COMMERCIAL_PAGE_SIZE, first.totalCount);
    const result = settled[index];
    if (!result || result.status !== "fulfilled") {
      throw new SeoulCommercialAdapterError(502, "seoul_incomplete_page_set");
    }
    const next = result.value;
    if (next.noData || next.totalCount !== first.totalCount || next.rows.length !== end - start + 1) {
      throw new SeoulCommercialAdapterError(502, "seoul_incomplete_page_set");
    }
    rows.push(...next.rows);
  }
  if (rows.length !== first.totalCount) {
    throw new SeoulCommercialAdapterError(502, "seoul_incomplete_result_set");
  }
  if (args.quarter) validateQuarter(rows, args.quarter, args.service);
  const identities = new Set(rows.map((row) => rowIdentity(args.service, row)));
  if (identities.size !== rows.length) {
    throw new SeoulCommercialAdapterError(502, "seoul_duplicate_rows");
  }
  return rows;
}

export function recentSeoulQuarterCandidates(nowIso: string, count = 6) {
  const now = new Date(nowIso);
  if (!Number.isFinite(now.getTime())) throw new SeoulCommercialAdapterError(500, "seoul_invalid_now");
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1_000);
  let year = kst.getUTCFullYear();
  let quarter = Math.floor(kst.getUTCMonth() / 3) + 1;
  const output: string[] = [];
  for (let index = 0; index < Math.max(1, Math.min(6, count)); index += 1) {
    output.push(`${year}${quarter}`);
    quarter -= 1;
    if (quarter === 0) {
      year -= 1;
      quarter = 4;
    }
  }
  return output;
}

function quarterEndDate(quarter: string) {
  if (!/^\d{5}$/u.test(quarter)) throw new SeoulCommercialAdapterError(502, "seoul_invalid_quarter");
  const year = Number(quarter.slice(0, 4));
  const value = Number(quarter[4]);
  const endings = ["03-31", "06-30", "09-30", "12-31"];
  if (value < 1 || value > 4) throw new SeoulCommercialAdapterError(502, "seoul_invalid_quarter");
  return `${year}-${endings[value - 1]}`;
}

function safeBoundary(value: SeoulCommercialBoundary | null | undefined) {
  if (!value || !Array.isArray(value.points)) return null;
  const points = value.points.flatMap(([longitude, latitude]) => (
    Number.isFinite(longitude) && longitude >= 124 && longitude <= 132
    && Number.isFinite(latitude) && latitude >= 32 && latitude <= 40
      ? [[longitude, latitude] as [number, number]]
      : []
  )).slice(0, 96);
  return points.length >= 4 ? { points, simplified: value.simplified === true } : null;
}

function industryComposition(industryTotals: Map<string, number>, total: number) {
  if (total <= 0) return [];
  const sorted = [...industryTotals.entries()]
    .filter(([, amount]) => amount > 0)
    .sort((left, right) => right[1] - left[1]);
  const top = sorted.slice(0, 5);
  const remainder = sorted.slice(5).reduce((sum, [, amount]) => safeSum(sum, amount), 0);
  const selected = remainder > 0 ? [...top, ["기타", remainder] as [string, number]] : top;
  const output = selected.map(([name, amount]) => ({
    name,
    sharePercent: Number((amount / total * 100).toFixed(2)),
    storeCount: null,
  }));
  if (output.length) {
    const roundedTotal = output.reduce((sum, entry) => sum + entry.sharePercent, 0);
    output[output.length - 1].sharePercent = Number((output.at(-1)!.sharePercent + 100 - roundedTotal).toFixed(2));
  }
  return output;
}

export function normalizeSeoulCommercialRows(args: {
  salesRows: Record<string, unknown>[];
  footfallRows: Record<string, unknown>[];
  areaRows: Record<string, unknown>[];
  quarter: string;
  nowIso: string;
  previous: Map<string, PublicInformationItem>;
  boundaryLookup?: SeoulCommercialBoundaryLookup;
}) {
  const sales = new Map<string, {
    name: string;
    type: string | null;
    total: number;
    byHour: number[];
    industryTotals: Map<string, number>;
  }>();
  for (const row of args.salesRows) {
    const code = requiredText(row, "TRDAR_CD", 20);
    const amount = nonNegativeInteger(row, "THSMON_SELNG_AMT");
    const entry = sales.get(code) ?? {
      name: requiredText(row, "TRDAR_CD_NM"),
      type: optionalText(row, "TRDAR_SE_CD_NM"),
      total: 0,
      byHour: SALES_HOURS.map(() => 0),
      industryTotals: new Map<string, number>(),
    };
    entry.total = safeSum(entry.total, amount);
    SALES_FIELDS.forEach((field, index) => {
      entry.byHour[index] = safeSum(entry.byHour[index], nonNegativeInteger(row, field));
    });
    const industry = requiredText(row, "SVC_INDUTY_CD_NM");
    entry.industryTotals.set(industry, safeSum(entry.industryTotals.get(industry) ?? 0, amount));
    sales.set(code, entry);
  }

  const footfall = new Map<string, number[]>();
  for (const row of args.footfallRows) {
    const code = requiredText(row, "TRDAR_CD", 20);
    if (footfall.has(code)) throw new SeoulCommercialAdapterError(502, "seoul_duplicate_footfall_area");
    footfall.set(code, FOOTFALL_FIELDS.map((field) => nonNegativeInteger(row, field)));
  }

  const areas = new Map<string, Record<string, unknown>>();
  for (const row of args.areaRows) {
    const code = requiredText(row, "TRDAR_CD", 20);
    if (areas.has(code)) throw new SeoulCommercialAdapterError(502, "seoul_duplicate_area_boundary");
    areas.set(code, row);
  }

  const joinedCodes = [...sales.keys()].filter((code) => footfall.has(code) && areas.has(code));
  const largestSet = Math.max(sales.size, footfall.size, areas.size);
  if (!joinedCodes.length || joinedCodes.length / Math.max(1, largestSet) < 0.9) {
    throw new SeoulCommercialAdapterError(502, "seoul_join_coverage_too_low");
  }
  const referenceDate = quarterEndDate(args.quarter);
  const sourceUrl = safePublicHttpUrl(SEOUL_COMMERCIAL_SOURCE_URLS.sales);
  if (!sourceUrl) throw new SeoulCommercialAdapterError(500, "seoul_invalid_source_url");

  return joinedCodes.map((code): PublicInformationItem => {
    const sale = sales.get(code)!;
    const flow = footfall.get(code)!;
    const area = areas.get(code)!;
    const district = optionalText(area, "SIGNGU_CD_NM") ?? "서울특별시";
    const neighborhood = normalizedNeighborhood(district, optionalText(area, "ADSTRD_CD_NM"));
    const areaType = optionalText(area, "TRDAR_SE_CD_NM") ?? sale.type;
    const officialName = optionalText(area, "TRDAR_CD_NM") ?? sale.name;
    const boundary = safeBoundary(args.boundaryLookup?.(code));
    const id = `seoul-commercial-${code}`;
    const location: PublicInformationLocation = {
      label: [district, neighborhood].filter(Boolean).join(" ") || "서울특별시",
      province: "서울특별시",
      city: district,
      ...(neighborhood ? { neighborhood } : {}),
      precision: "administrative",
    };
    return {
      id,
      category: "startup",
      title: officialName,
      summary: `${referenceDate} 기준 서울시 상권 추정매출·업종 구성·시간대별 유동인구 정보입니다.`,
      source: "서울시 상권분석서비스",
      sourceUrl,
      sourceLinkKind: "dataset",
      publishedAt: referenceDate,
      discoveredAt: args.previous.get(id)?.discoveredAt ?? args.nowIso,
      lastVerifiedAt: args.nowIso,
      tags: ["서울상권", "추정매출", areaType, district, neighborhood].filter((value): value is string => Boolean(value)),
      location,
      commercialArea: {
        areaSquareMeters: positiveArea(area),
        referenceDate,
        coordinateCount: boundary?.points.length ?? null,
        ...(boundary ? { displayBoundary: boundary } : {}),
        analytics: {
          officialCode: code,
          referenceQuarter: args.quarter,
          areaType,
          estimatedTotalSales: sale.total,
          industrySalesComposition: industryComposition(sale.industryTotals, sale.total),
          salesByHour: SALES_HOURS.map((hour, index) => ({ hour, amount: sale.byHour[index] })),
          footfallByHour: SALES_HOURS.map((hour, index) => ({ hour, people: flow[index] })),
          sourceUrl,
        },
      },
    };
  });
}

export async function collectSeoulCommercialData(options: CollectSeoulCommercialOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const budget = new SeoulCommercialRequestBudget();
  try {
    let selected: { quarter: string; sales: SeoulServicePage; footfall: SeoulServicePage } | null = null;

    for (const quarter of recentSeoulQuarterCandidates(options.nowIso)) {
      const sales = await fetchSeoulPage({
        apiKey: options.apiKey,
        service: SEOUL_SERVICES.sales,
        start: 1,
        end: SEOUL_COMMERCIAL_PAGE_SIZE,
        quarter,
        fetchImpl,
        budget,
      });
      if (sales.noData) continue;
      const footfall = await fetchSeoulPage({
        apiKey: options.apiKey,
        service: SEOUL_SERVICES.footfall,
        start: 1,
        end: SEOUL_COMMERCIAL_PAGE_SIZE,
        quarter,
        fetchImpl,
        budget,
      });
      if (!footfall.noData) {
        selected = { quarter, sales, footfall };
        break;
      }
    }
    if (!selected) throw new SeoulCommercialAdapterError(502, "seoul_no_common_quarter");

    const plannedWithoutArea = pageCount(selected.sales.totalCount) - 1
      + pageCount(selected.footfall.totalCount) - 1;
    if (budget.used + plannedWithoutArea + 2 > SEOUL_COMMERCIAL_MAX_REQUESTS) {
      throw new SeoulCommercialAdapterError(503, "seoul_request_budget_exceeded");
    }
    const pageResults = await Promise.allSettled([
      collectSeoulServicePages({
        apiKey: options.apiKey,
        service: SEOUL_SERVICES.sales,
        quarter: selected.quarter,
        fetchImpl,
        budget,
        firstPage: selected.sales,
      }),
      collectSeoulServicePages({
        apiKey: options.apiKey,
        service: SEOUL_SERVICES.footfall,
        quarter: selected.quarter,
        fetchImpl,
        budget,
        firstPage: selected.footfall,
      }),
    ]);
    const failedPages = pageResults.find((result) => result.status === "rejected");
    if (failedPages?.status === "rejected") throw failedPages.reason;
    const salesRows = pageResults[0].status === "fulfilled" ? pageResults[0].value : [];
    const footfallRows = pageResults[1].status === "fulfilled" ? pageResults[1].value : [];
    const areaRows = await collectSeoulServicePages({
      apiKey: options.apiKey,
      service: SEOUL_SERVICES.area,
      quarter: null,
      fetchImpl,
      budget,
    });
    return {
      items: normalizeSeoulCommercialRows({
        salesRows,
        footfallRows,
        areaRows,
        quarter: selected.quarter,
        nowIso: options.nowIso,
        previous: options.previous,
        boundaryLookup: options.boundaryLookup,
      }),
      requestCount: budget.used,
      quarter: selected.quarter,
      sourceUrl: SEOUL_COMMERCIAL_SOURCE_URLS.sales,
    };
  } catch (error) {
    if (error instanceof SeoulCommercialAdapterError) {
      throw new SeoulCommercialAdapterError(error.status, error.message, budget.used);
    }
    throw new SeoulCommercialAdapterError(502, "seoul_adapter_exception", budget.used);
  }
}
