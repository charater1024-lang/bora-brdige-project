import { PublicResponseBodyError, readBoundedResponseText } from "./bounded-response";
import type {
  PublicEmploymentGroup,
  PublicInformationItem,
  PublicSourceResult,
  PublicSourceStatus,
} from "./types";

export const KOSIS_EMPLOYMENT_SOURCE_ID = "kosis-employment";
export const KOSIS_EMPLOYMENT_ENDPOINT =
  "https://kosis.kr/openapi/Param/statisticsParameterData.do";
export const KOSIS_EMPLOYMENT_GUIDE_URL =
  "https://kosis.kr/openapi/devGuide/devGuide_0201List.do";
export const KOSIS_EMPLOYMENT_MAX_REQUESTS = 3;

const KOSIS_RESPONSE_MAX_BYTES = 1_000_000;
const KOSIS_REQUEST_TIMEOUT_MS = 12_000;
const KOSIS_ORIGIN = new URL(KOSIS_EMPLOYMENT_ENDPOINT).origin;

type KosisFrequency = "M" | "Y";
type KosisFailureKind = "authorization" | "quota" | "transient";

interface KosisMetricSpec {
  id: string;
  name: string;
  /**
   * Unit defined by the fixed official item code. Some KOSIS parameter
   * responses repeat the table's head unit ("천명") on rate rows, so UNIT_NM
   * cannot safely determine an individual metric's unit.
   */
  unit: "천명" | "%";
}

interface KosisEmploymentTableSpec {
  group: PublicEmploymentGroup;
  groupLabel: string;
  tableId: string;
  tableName: string;
  frequency: KosisFrequency;
  classifications: readonly string[];
  metrics: readonly KosisMetricSpec[];
  sourceUrl: string;
}

export interface KosisEmploymentAdapterResult {
  source: PublicSourceResult;
  items: PublicInformationItem[];
  market: [];
  exchange: [];
  asOf: string | null;
  requestCount: number;
  failureKind?: KosisFailureKind;
}

export type KosisEmploymentFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface KosisEmploymentAdapterOptions {
  apiKey: string | null;
  nowIso: string;
  previous?: ReadonlyMap<string, PublicInformationItem>;
  fetchImpl?: KosisEmploymentFetch;
}

interface ParsedKosisTable {
  item: PublicInformationItem;
  publishedAt: string | null;
}

class KosisAdapterError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

function tableUrl(tableId: string) {
  const url = new URL("https://kosis.kr/statHtml/statHtml.do");
  url.searchParams.set("orgId", "101");
  url.searchParams.set("tblId", tableId);
  url.searchParams.set("conn_path", "I2");
  return url.toString();
}

/**
 * Fixed official tables and codes verified against the KOSIS table metadata on
 * 2026-07-24. The API returns only published values; this adapter never derives
 * an employment rate or any other statistic.
 */
export const KOSIS_EMPLOYMENT_TABLES: readonly KosisEmploymentTableSpec[] = [
  {
    group: "youth",
    groupLabel: "청년층(15~29세)",
    tableId: "DT_1DE9046S",
    tableName: "연령별 경제활동상태",
    frequency: "M",
    classifications: ["A.20", "B.00"],
    metrics: [
      { id: "T11", name: "취업자", unit: "천명" },
      { id: "T21", name: "고용률", unit: "%" },
      { id: "T22", name: "실업률", unit: "%" },
    ],
    sourceUrl: tableUrl("DT_1DE9046S"),
  },
  {
    group: "older-adult",
    groupLabel: "고령층(55~79세)",
    tableId: "DT_1DE8031S",
    tableName: "연령별 경제활동상태",
    frequency: "M",
    classifications: ["A.00"],
    metrics: [
      { id: "T11", name: "취업자", unit: "천명" },
      { id: "T30", name: "고용률", unit: "%" },
      { id: "T40", name: "실업률", unit: "%" },
    ],
    sourceUrl: tableUrl("DT_1DE8031S"),
  },
  {
    group: "foreigner",
    groupLabel: "외국인(15세 이상)",
    tableId: "DT_2FA002F",
    tableName: "체류자격별 경제활동인구(외국인)",
    frequency: "Y",
    classifications: ["200"],
    metrics: [
      { id: "T111", name: "취업자", unit: "천명" },
      { id: "T220", name: "고용률", unit: "%" },
    ],
    sourceUrl: tableUrl("DT_2FA002F"),
  },
] as const;

function source(
  status: PublicSourceStatus,
  itemCount = 0,
  errorCode?: string,
): PublicSourceResult {
  return {
    id: KOSIS_EMPLOYMENT_SOURCE_ID,
    label: "KOSIS 대상별 취업 통계",
    status,
    itemCount,
    sourceUrl: KOSIS_EMPLOYMENT_GUIDE_URL,
    ...(errorCode ? { errorCode } : {}),
  };
}

function emptyResult(
  status: PublicSourceStatus,
  requestCount = 0,
  error?: unknown,
): KosisEmploymentAdapterResult {
  return {
    source: source(status, 0, error ? safeErrorCode(error) : undefined),
    items: [],
    market: [],
    exchange: [],
    asOf: null,
    requestCount,
    ...(error ? { failureKind: failureKind(error) } : {}),
  };
}

function failureKind(error: unknown): KosisFailureKind {
  if (error instanceof KosisAdapterError) {
    if (error.status === 401 || error.status === 403) return "authorization";
    if (error.status === 429) return "quota";
  }
  return "transient";
}

function sourceStatus(error: unknown): PublicSourceStatus {
  return failureKind(error) === "authorization"
    ? "authorization-pending"
    : "unavailable";
}

function safeErrorCode(error: unknown) {
  return error instanceof KosisAdapterError && /^[a-z0-9_]+$/u.test(error.code)
    ? error.code.slice(0, 80)
    : "kosis_adapter_exception";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, maximumLength = 300) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumLength);
}

function parseNumber(value: unknown) {
  const normalized = cleanText(value, 80).replaceAll(",", "");
  if (!/^-?(?:\d+|\d*\.\d+)$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && Number.isSafeInteger(parsed * 1_000_000)
    ? parsed
    : null;
}

function validPeriod(value: string, frequency: KosisFrequency) {
  return frequency === "M" ? /^\d{6}$/u.test(value) : /^\d{4}$/u.test(value);
}

function displayPeriod(value: string, frequency: KosisFrequency) {
  return frequency === "M"
    ? `${value.slice(0, 4)}.${value.slice(4, 6)}`
    : value;
}

function normalizedPublishedDate(value: unknown) {
  const text = cleanText(value, 20).replace(/[^0-9]/gu, "");
  if (!/^\d{8}$/u.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (
    !Number.isFinite(time)
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function formatMetricValue(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 6,
    useGrouping: true,
  }).format(value);
}

function expectedClassification(
  row: Record<string, unknown>,
  classifications: readonly string[],
) {
  return classifications.every((expected, index) => {
    const actual = cleanText(row[`C${index + 1}`], 60);
    return actual === expected;
  });
}

function parseKosisRows(
  value: unknown,
  spec: KosisEmploymentTableSpec,
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
): ParsedKosisTable {
  if (!Array.isArray(value)) {
    const error = asRecord(value);
    const errorCode = cleanText(error?.err ?? error?.errorCode, 40);
    const errorMessage = cleanText(error?.errMsg ?? error?.message, 300);
    if (errorCode || errorMessage) {
      if (
        ["10", "11", "12", "42"].includes(errorCode)
        || /인증|인증키|api\s*key|invalid\s*key|unauthoriz/iu.test(errorMessage)
      ) throw new KosisAdapterError(403, "kosis_authorization");
      if (
        ["40", "41"].includes(errorCode)
        || /쿼터|트래픽|호출.*(?:제한|초과)|quota|rate\s*limit/iu.test(errorMessage)
      ) {
        throw new KosisAdapterError(429, "kosis_quota");
      }
      throw new KosisAdapterError(502, "kosis_upstream_error");
    }
    throw new KosisAdapterError(502, "kosis_shape");
  }

  const rows = value.flatMap((entry) => {
    const row = asRecord(entry);
    if (!row) return [];
    if (cleanText(row.TBL_ID, 60) !== spec.tableId) return [];
    const responseFrequency = cleanText(row.PRD_SE, 10);
    // KOSIS documents annual requests as Y, while the current parameter API
    // returns A in PRD_SE for annual rows.
    if (
      responseFrequency !== spec.frequency
      && !(spec.frequency === "Y" && responseFrequency === "A")
    ) return [];
    if (!expectedClassification(row, spec.classifications)) return [];
    const period = cleanText(row.PRD_DE, 20);
    if (!validPeriod(period, spec.frequency)) return [];
    return [{ row, period }];
  });
  const latestPeriod = rows.map(({ period }) => period).sort().at(-1);
  if (!latestPeriod) throw new KosisAdapterError(502, "kosis_shape");

  const expectedMetrics = new Map(spec.metrics.map((metric) => [metric.id, metric]));
  const metrics = [];
  const seen = new Set<string>();
  const publishedDates: string[] = [];
  for (const { row, period } of rows) {
    if (period !== latestPeriod) continue;
    const itemId = cleanText(row.ITM_ID, 60);
    const metric = expectedMetrics.get(itemId);
    if (!metric || seen.has(itemId)) continue;
    const numericValue = parseNumber(row.DT);
    if (numericValue === null) continue;
    seen.add(itemId);
    metrics.push({ name: metric.name, value: numericValue, unit: metric.unit });
    const publishedAt = normalizedPublishedDate(row.LST_CHN_DE);
    if (publishedAt) publishedDates.push(publishedAt);
  }
  if (metrics.length !== spec.metrics.length) {
    throw new KosisAdapterError(502, "kosis_shape");
  }

  const period = displayPeriod(latestPeriod, spec.frequency);
  const id = `kosis-employment-${spec.group}-${spec.tableId}-${latestPeriod}`.toLowerCase();
  const publishedAt = publishedDates.sort().at(-1) ?? null;
  const summary = metrics
    .map((metric) => `${metric.name} ${formatMetricValue(metric.value)} ${metric.unit}`)
    .join(" · ");
  return {
    item: {
      id,
      category: "employment",
      title: `${spec.groupLabel} 취업 통계 (${period})`,
      summary,
      source: "KOSIS 국가통계포털",
      sourceUrl: spec.sourceUrl,
      sourceLinkKind: "detail",
      publishedAt,
      discoveredAt: previous.get(id)?.discoveredAt ?? nowIso,
      lastVerifiedAt: nowIso,
      tags: [
        "고용통계",
        "KOSIS",
        spec.groupLabel,
        spec.tableName,
        "공표값",
      ],
      employmentStatistic: {
        group: spec.group,
        groupLabel: spec.groupLabel,
        period,
        metrics,
        tableId: spec.tableId,
      },
    },
    publishedAt,
  };
}

function requestUrl(spec: KosisEmploymentTableSpec, apiKey: string) {
  const url = new URL(KOSIS_EMPLOYMENT_ENDPOINT);
  url.searchParams.set("method", "getList");
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("orgId", "101");
  url.searchParams.set("tblId", spec.tableId);
  spec.classifications.forEach((classification, index) => {
    url.searchParams.set(`objL${index + 1}`, `${classification}+`);
  });
  url.searchParams.set("itmId", `${spec.metrics.map((metric) => metric.id).join("+")}+`);
  url.searchParams.set("prdSe", spec.frequency);
  url.searchParams.set("newEstPrdCnt", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("jsonVD", "Y");
  return url;
}

function retainedItemForFailedTable(
  spec: KosisEmploymentTableSpec,
  previous: ReadonlyMap<string, PublicInformationItem>,
) {
  const candidates = [...previous.values()].filter((item) => {
    const statistic = item.employmentStatistic;
    if (
      item.category !== "employment"
      || !item.id.startsWith(`kosis-employment-${spec.group}-`)
      || statistic?.group !== spec.group
      || statistic.tableId !== spec.tableId
    ) return false;
    try {
      const url = new URL(item.sourceUrl);
      return url.protocol === "https:"
        && url.hostname === "kosis.kr"
        && url.pathname === "/statHtml/statHtml.do"
        && url.searchParams.get("tblId") === spec.tableId;
    } catch {
      return false;
    }
  });
  return candidates.sort((left, right) => {
    const leftTime = Date.parse(left.lastVerifiedAt ?? left.discoveredAt);
    const rightTime = Date.parse(right.lastVerifiedAt ?? right.discoveredAt);
    return (Number.isFinite(rightTime) ? rightTime : 0)
      - (Number.isFinite(leftTime) ? leftTime : 0);
  })[0] ?? null;
}

async function fetchKosisTable(
  spec: KosisEmploymentTableSpec,
  apiKey: string,
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
  fetchImpl: KosisEmploymentFetch,
) {
  const endpoint = requestUrl(spec, apiKey);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      signal: AbortSignal.timeout(KOSIS_REQUEST_TIMEOUT_MS),
      // Workers supports manual redirect handling but rejects "error".
      // Do not follow a response that could carry the API key elsewhere.
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new KosisAdapterError(
      name === "TimeoutError" || name === "AbortError" ? 504 : 502,
      name === "TimeoutError" || name === "AbortError"
        ? "kosis_timeout"
        : "kosis_network",
    );
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new KosisAdapterError(502, "kosis_redirect");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new KosisAdapterError(response.status, "kosis_authorization");
    }
    if (response.status === 429) throw new KosisAdapterError(429, "kosis_quota");
    throw new KosisAdapterError(502, `kosis_http_${response.status}`);
  }
  if (response.url) {
    let responseUrl: URL;
    try {
      responseUrl = new URL(response.url);
    } catch {
      throw new KosisAdapterError(502, "kosis_origin");
    }
    if (responseUrl.origin !== KOSIS_ORIGIN) {
      throw new KosisAdapterError(502, "kosis_origin");
    }
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    contentType
    && !/(?:application|text)\/(?:[\w.+-]*\+)?json(?:;|$)/u.test(contentType)
    && !/^text\/plain(?:;|$)/u.test(contentType)
    // KOSIS currently serves its documented JSON body as text/html. The body
    // remains size-bounded and must still parse as strict JSON below.
    && !/^text\/html(?:;|$)/u.test(contentType)
  ) throw new KosisAdapterError(502, "kosis_content_type");

  let text: string;
  try {
    text = await readBoundedResponseText(response, KOSIS_RESPONSE_MAX_BYTES);
  } catch (error) {
    if (error instanceof PublicResponseBodyError) {
      throw new KosisAdapterError(502, "kosis_body_too_large");
    }
    throw new KosisAdapterError(502, "kosis_body_invalid");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new KosisAdapterError(502, "kosis_json");
  }
  return parseKosisRows(payload, spec, nowIso, previous);
}

export async function kosisEmploymentAdapter(
  options: KosisEmploymentAdapterOptions,
): Promise<KosisEmploymentAdapterResult> {
  const apiKey = options.apiKey?.trim() ?? "";
  if (!apiKey) return emptyResult("not-configured");

  const nowTime = Date.parse(options.nowIso);
  if (!Number.isFinite(nowTime)) {
    return emptyResult("unavailable", 0, new KosisAdapterError(502, "kosis_now"));
  }
  const nowIso = new Date(nowTime).toISOString();
  const previous = options.previous ?? new Map<string, PublicInformationItem>();
  const fetchImpl = options.fetchImpl ?? fetch;
  let requestCount = 0;
  const settled = await Promise.allSettled(KOSIS_EMPLOYMENT_TABLES.map(async (spec) => {
    requestCount += 1;
    return await fetchKosisTable(spec, apiKey, nowIso, previous, fetchImpl);
  }));

  const successful = settled.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []);
  const failures = settled.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ spec: KOSIS_EMPLOYMENT_TABLES[index], error: result.reason }]
      : []);
  const errors = failures.map(({ error }) => error);
  if (!successful.length) {
    const error = errors.find((candidate) => failureKind(candidate) === "authorization")
      ?? errors.find((candidate) => failureKind(candidate) === "quota")
      ?? errors[0]
      ?? new KosisAdapterError(502, "kosis_adapter_exception");
    return emptyResult(sourceStatus(error), requestCount, error);
  }

  const freshByGroup = new Map(successful.map(({ item }) => [
    item.employmentStatistic!.group,
    item,
  ]));
  const retainedByGroup = new Map(failures.flatMap(({ spec }) => {
    const retained = retainedItemForFailedTable(spec, previous);
    return retained ? [[spec.group, retained] as const] : [];
  }));
  const items = KOSIS_EMPLOYMENT_TABLES.flatMap(({ group }) => {
    const item = freshByGroup.get(group) ?? retainedByGroup.get(group);
    return item ? [item] : [];
  });
  const asOf = successful
    .map(({ publishedAt }) => publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? nowIso;
  return {
    source: {
      ...source(errors.length ? "partial" : "live", items.length, errors.length ? "kosis_partial" : undefined),
      providerTotalCount: KOSIS_EMPLOYMENT_TABLES.length,
      fetchedCount: successful.length,
      completeness: errors.length ? "partial" : "complete",
    },
    items,
    market: [],
    exchange: [],
    asOf,
    requestCount,
    ...(errors.length ? { failureKind: failureKind(errors[0]) } : {}),
  };
}
