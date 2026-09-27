import { PublicResponseBodyError, readBoundedResponseText } from "./bounded-response";
import type {
  PublicBackfillCheckpoint,
  PublicBackfillRuntime,
  PublicInformationItem,
  PublicSourceResult,
  PublicSourceStatus,
} from "./types";
import { safePublicHttpUrl } from "./urls";
import { cleanPublicText } from "./text";

export const DATA_GO_BIZINFO_ENDPOINT =
  "https://apis.data.go.kr/1421000/bizinfo/pblancBsnsService";
export const K_STARTUP_ANNOUNCEMENT_ENDPOINT =
  "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01";

export const DATA_GO_BIZINFO_SOURCE_URL =
  "https://www.data.go.kr/data/15157820/openapi.do";
export const K_STARTUP_SOURCE_URL =
  "https://www.data.go.kr/data/15125364/openapi.do";

export const STARTUP_ADAPTER_MAX_PAGES = 20;
export const STARTUP_ADAPTER_DEFAULT_PAGE_SIZE = 100;
const STARTUP_RESPONSE_MAX_BYTES = 4_000_000;
const STARTUP_REQUEST_TIMEOUT_MS = 12_000;

export const STARTUP_PROVINCES = [
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
  "경기도",
  "강원특별자치도",
  "충청북도",
  "충청남도",
  "전북특별자치도",
  "전라남도",
  "경상북도",
  "경상남도",
  "제주특별자치도",
] as const;

export type StartupProvince = (typeof STARTUP_PROVINCES)[number];
export type StartupProvider = "bizinfo-data-go" | "kstartup";
export type StartupAdapterCompleteness = "complete" | "truncated" | "partial";
export type StartupAdapterFailureKind = "authorization" | "quota" | "transient";
export type StartupScope = "regional" | "nationwide" | "unknown";

export interface StartupAnnouncementRecord {
  item: PublicInformationItem;
  provider: StartupProvider;
  officialId: string;
  targetRegions: StartupProvince[];
  scope: StartupScope;
  registeredAt: string | null;
  modifiedAt: string | null;
  applicationStartsAt: string | null;
  applicationEndsAt: string | null;
  target: string | null;
  agencies: string[];
  applicationMethod: string | null;
  contact: string | null;
  detailUrl: string | null;
  applicationUrl: string | null;
  officialHashTags: string[];
}

export interface StartupAdapterResult {
  source: PublicSourceResult;
  records: StartupAnnouncementRecord[];
  items: PublicInformationItem[];
  requestCount: number;
  totalCount: number;
  fetchedCount: number;
  completeness: StartupAdapterCompleteness;
  asOf: string | null;
  failureKind?: StartupAdapterFailureKind;
  incremental?: boolean;
}

export type StartupAdapterFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface StartupAdapterOptions {
  apiKey: string | null;
  nowIso: string;
  previous?: ReadonlyMap<string, PublicInformationItem>;
  fetchImpl?: StartupAdapterFetch;
  pageSize?: number;
  /**
   * Supplied only by the shared scheduler. Direct adapter callers keep the
   * legacy bounded full-run behavior, while production advances a durable
   * historical cursor independently from the replaceable latest page.
   */
  backfill?: PublicBackfillRuntime;
  /**
   * Application links can legitimately leave the catalog provider. They are
   * accepted only when the deployment explicitly adds their hostname here.
   */
  allowedApplicationHosts?: readonly string[];
}

type StartupPage = {
  rows: Record<string, unknown>[];
  totalCount: number;
  currentCount: number | null;
  page: number | null;
  perPage: number | null;
};

type ProviderSpec = {
  provider: StartupProvider;
  sourceId: string;
  label: string;
  endpoint: string;
  sourceUrl: string;
  detailBase: string;
  detailHosts: readonly string[];
  requestParameters: (page: number, pageSize: number) => Record<string, string>;
  normalize: (
    row: Record<string, unknown>,
    context: NormalizeContext,
  ) => StartupAnnouncementRecord;
};

type NormalizeContext = {
  nowIso: string;
  previous: ReadonlyMap<string, PublicInformationItem>;
  allowedApplicationHosts: readonly string[];
};

class StartupAdapterError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

const REGION_ALIASES: Readonly<Record<string, StartupProvince[]>> = {
  서울: ["서울특별시"],
  서울특별시: ["서울특별시"],
  부산: ["부산광역시"],
  부산광역시: ["부산광역시"],
  대구: ["대구광역시"],
  대구광역시: ["대구광역시"],
  인천: ["인천광역시"],
  인천광역시: ["인천광역시"],
  광주: ["광주광역시"],
  광주광역시: ["광주광역시"],
  대전: ["대전광역시"],
  대전광역시: ["대전광역시"],
  울산: ["울산광역시"],
  울산광역시: ["울산광역시"],
  세종: ["세종특별자치시"],
  세종특별자치시: ["세종특별자치시"],
  경기: ["경기도"],
  경기도: ["경기도"],
  강원: ["강원특별자치도"],
  강원도: ["강원특별자치도"],
  강원특별자치도: ["강원특별자치도"],
  충북: ["충청북도"],
  충청북도: ["충청북도"],
  충남: ["충청남도"],
  충청남도: ["충청남도"],
  전북: ["전북특별자치도"],
  전라북도: ["전북특별자치도"],
  전북특별자치도: ["전북특별자치도"],
  전남: ["전라남도"],
  전라남도: ["전라남도"],
  경북: ["경상북도"],
  경상북도: ["경상북도"],
  경남: ["경상남도"],
  경상남도: ["경상남도"],
  제주: ["제주특별자치도"],
  제주도: ["제주특별자치도"],
  제주특별자치도: ["제주특별자치도"],
  // This is a legacy Bizinfo hashtag rather than an administrative unit.
  전남광주: ["전라남도", "광주광역시"],
};

function unique<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function cleanText(value: unknown, maximumLength = 500) {
  return cleanPublicText(value, maximumLength);
}

function firstText(
  row: Record<string, unknown>,
  keys: readonly string[],
  maximumLength = 500,
) {
  for (const key of keys) {
    const value = cleanText(row[key], maximumLength);
    if (value) return value;
  }
  return "";
}

function normalizedId(value: unknown) {
  return cleanText(value, 120).replace(/[^0-9A-Za-z가-힣_-]/gu, "-");
}

function validDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day;
}

function datesFrom(value: unknown) {
  const raw = cleanText(value, 600);
  const output: string[] = [];
  for (const match of raw.matchAll(/(20\d{2})[^0-9]?(\d{1,2})[^0-9]?(\d{1,2})/gu)) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!validDate(year, month, day)) continue;
    output.push(`${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return unique(output);
}

export function normalizeStartupDate(value: unknown) {
  return datesFrom(value)[0] ?? null;
}

function applicationPeriod(
  row: Record<string, unknown>,
  startKeys: readonly string[],
  endKeys: readonly string[],
  combinedKeys: readonly string[],
) {
  const explicitStart = normalizeStartupDate(firstText(row, startKeys, 120));
  const explicitEnd = normalizeStartupDate(firstText(row, endKeys, 120));
  const combinedDates = datesFrom(firstText(row, combinedKeys, 300));
  return {
    start: explicitStart ?? combinedDates[0] ?? null,
    end: explicitEnd ?? combinedDates.at(-1) ?? null,
  };
}

function regionTokens(value: unknown) {
  return cleanText(value, 500)
    .split(/[,/|·;\n]+/gu)
    .map((token) => token.replace(/\s+/gu, "").trim())
    .filter(Boolean);
}

export function startupRegionsFromOfficialFields(...values: unknown[]): StartupProvince[] {
  const regions = values.flatMap((value) => regionTokens(value)
    .flatMap((token) => REGION_ALIASES[token] ?? []));
  return STARTUP_PROVINCES.filter((province) => regions.includes(province));
}

function officialScope(values: readonly unknown[], regions: readonly StartupProvince[]): StartupScope {
  if (values.some((value) => regionTokens(value).includes("전국"))) return "nationwide";
  return regions.length ? "regional" : "unknown";
}

function hashTags(value: unknown) {
  return unique(cleanText(value, 2_000)
    .split(/[,#|·;\n]+/gu)
    .map((tag) => tag.trim())
    .filter((tag) => Boolean(tag) && tag.length <= 80 && !/^https?:/iu.test(tag)))
    .slice(0, 32);
}

function safeProviderUrl(
  value: unknown,
  base: string,
  allowedHosts: readonly string[],
) {
  return safePublicHttpUrl(cleanText(value, 1_000), base, allowedHosts);
}

function safeApplicationUrl(
  value: unknown,
  base: string,
  providerHosts: readonly string[],
  additionalHosts: readonly string[],
) {
  return safeProviderUrl(value, base, unique([...providerHosts, ...additionalHosts]));
}

function sourceStatus(error: unknown): PublicSourceStatus {
  return error instanceof StartupAdapterError
    && (error.status === 401 || error.status === 403)
    ? "authorization-pending"
    : "unavailable";
}

function failureKind(error: unknown): StartupAdapterFailureKind {
  if (error instanceof StartupAdapterError) {
    if (error.status === 401 || error.status === 403) return "authorization";
    if (error.status === 429) return "quota";
  }
  return "transient";
}

function safeErrorCode(error: unknown) {
  return error instanceof StartupAdapterError && /^[a-z0-9_]+$/u.test(error.code)
    ? error.code.slice(0, 80)
    : "startup_adapter_exception";
}

function source(
  spec: ProviderSpec,
  status: PublicSourceStatus,
  itemCount = 0,
  errorCode?: string,
): PublicSourceResult {
  return {
    id: spec.sourceId,
    label: spec.label,
    status,
    itemCount,
    sourceUrl: spec.sourceUrl,
    ...(errorCode ? { errorCode } : {}),
  };
}

function emptyResult(
  spec: ProviderSpec,
  status: PublicSourceStatus,
  error?: unknown,
  requestCount = 0,
): StartupAdapterResult {
  const code = error ? safeErrorCode(error) : undefined;
  return {
    source: source(spec, status, 0, code),
    records: [],
    items: [],
    requestCount,
    totalCount: 0,
    fetchedCount: 0,
    completeness: "complete",
    asOf: null,
    ...(error ? { failureKind: failureKind(error) } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rowsFrom(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((entry) => {
    const row = asRecord(entry);
    return row ? [expandColumnRow(row)] : [];
  });
  const row = asRecord(value);
  if (!row) return [];
  if (Object.prototype.hasOwnProperty.call(row, "item")) return rowsFrom(row.item);
  return [expandColumnRow(row)];
}

function columnValue(column: Record<string, unknown>) {
  return cleanText(
    column.value
      ?? column._text
      ?? column["#text"]
      ?? column._
      ?? column.content,
    4_000,
  );
}

function expandColumnRow(row: Record<string, unknown>) {
  const rawColumns = row.col;
  if (!rawColumns) return row;
  const columns = Array.isArray(rawColumns) ? rawColumns : [rawColumns];
  const expanded = { ...row };
  for (const candidate of columns) {
    const column = asRecord(candidate);
    if (!column) continue;
    const attributes = asRecord(column._attributes);
    const name = cleanText(column.name ?? column["@name"] ?? attributes?.name, 120);
    if (name) expanded[name] = columnValue(column);
  }
  delete expanded.col;
  return expanded;
}

function numericMetadata(value: unknown) {
  const raw = cleanText(value, 40).replaceAll(",", "");
  if (!/^\d+$/u.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function upstreamCodeError(codeValue: unknown, messageValue?: unknown) {
  const code = cleanText(codeValue, 40);
  const message = cleanText(messageValue, 200).toLocaleUpperCase("en-US");
  if ((!code || code === "00" || code === "0" || code === "03")
    && !/SERVICE_KEY|LIMITED_NUMBER|ACCESS_DENIED/u.test(message)) return null;
  const normalizedCode = code || (message.includes("LIMITED_NUMBER") ? "22" : "30");
  const status = normalizedCode === "22"
    ? 429
    : ["20", "30", "31", "32"].includes(normalizedCode)
      || /SERVICE_KEY|ACCESS_DENIED/u.test(message)
      ? 403
      : 502;
  return new StartupAdapterError(
    status,
    `startup_upstream_${normalizedCode.replace(/[^0-9a-z]+/giu, "_").toLocaleLowerCase("en-US")}`,
  );
}

function parseJsonPage(payload: unknown): StartupPage {
  const root = asRecord(payload);
  if (!root) throw new StartupAdapterError(502, "startup_invalid_json_shape");
  const response = asRecord(root.response) ?? root;
  const header = asRecord(response.header) ?? asRecord(root.header);
  const commonHeader = asRecord(root.cmmMsgHeader);
  const headerError = upstreamCodeError(
    header?.resultCode ?? header?.result_code ?? commonHeader?.returnReasonCode ?? root.resultCode,
    header?.resultMsg ?? commonHeader?.errMsg ?? root.errMsg,
  );
  if (headerError) throw headerError;

  const body = asRecord(response.body) ?? response;
  const bodyItems = asRecord(body.items);
  const bodyData = asRecord(body.data);
  const candidates = [
    bodyItems?.item,
    body.items,
    bodyData?.item,
    body.data,
    response.data,
    root.data,
    root.item,
  ];
  let rows: Record<string, unknown>[] = [];
  for (const candidate of candidates) {
    const parsed = rowsFrom(candidate);
    if (parsed.length) {
      rows = parsed;
      break;
    }
    if (Array.isArray(candidate)) {
      rows = [];
      break;
    }
  }

  const rowTotal = rows.map((row) => numericMetadata(
    row.totCnt ?? row.totalCount,
  )).find((value) => value !== null) ?? null;
  const totalCount = numericMetadata(
    body.totalCount
      ?? response.totalCount
      ?? root.totalCount
      ?? body.matchCount
      ?? root.matchCount,
  ) ?? rowTotal;
  if (totalCount === null) throw new StartupAdapterError(502, "startup_total_missing");
  const currentCount = numericMetadata(
    body.currentCount ?? response.currentCount ?? root.currentCount,
  );
  if (currentCount !== null && currentCount !== rows.length) {
    throw new StartupAdapterError(502, "startup_current_count_mismatch");
  }
  return {
    rows,
    totalCount,
    currentCount,
    page: numericMetadata(body.page ?? response.page ?? root.page ?? body.pageNo ?? root.pageNo),
    perPage: numericMetadata(
      body.perPage
        ?? response.perPage
        ?? root.perPage
        ?? body.pPage
        ?? root.pPage
        ?? body.numOfRows
        ?? root.numOfRows,
    ),
  };
}

function decodeXml(value: string) {
  return cleanText(value, 4_000);
}

function xmlTag(payload: string, names: readonly string[]) {
  for (const name of names) {
    const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "iu").exec(payload);
    if (match) return decodeXml(match[1]);
  }
  return "";
}

function parseXmlRow(payload: string) {
  const row: Record<string, unknown> = {};
  for (const match of payload.matchAll(
    /<col\s+[^>]*name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/col>/giu,
  )) {
    const name = cleanText(match[1], 120);
    if (name) row[name] = decodeXml(match[2]);
  }
  const withoutColumns = payload.replace(/<col\s+[\s\S]*?<\/col>/giu, " ");
  for (const match of withoutColumns.matchAll(
    /<([A-Za-z0-9_가-힣]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gu,
  )) {
    if (!/<[A-Za-z]/u.test(match[2])) row[match[1]] = decodeXml(match[2]);
  }
  return row;
}

function parseXmlPage(payload: string): StartupPage {
  if (!/<(?:response|results|OpenAPI_ServiceResponse|items|data)\b/iu.test(payload)) {
    throw new StartupAdapterError(502, "startup_invalid_xml_shape");
  }
  const error = upstreamCodeError(
    xmlTag(payload, ["resultCode", "returnReasonCode"]),
    xmlTag(payload, ["resultMsg", "errMsg", "returnAuthMsg"]),
  );
  if (error) throw error;
  const rows = [...payload.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/giu)]
    .map((match) => parseXmlRow(match[1]));
  const totalCount = numericMetadata(xmlTag(payload, ["totalCount", "matchCount"]))
    ?? rows.map((row) => numericMetadata(row.totCnt)).find((value) => value !== null)
    ?? null;
  if (totalCount === null) throw new StartupAdapterError(502, "startup_total_missing");
  const currentCount = numericMetadata(xmlTag(payload, ["currentCount"]));
  if (currentCount !== null && currentCount !== rows.length) {
    throw new StartupAdapterError(502, "startup_current_count_mismatch");
  }
  return {
    rows,
    totalCount,
    currentCount,
    page: numericMetadata(xmlTag(payload, ["page", "pageNo"])),
    perPage: numericMetadata(xmlTag(payload, ["perPage", "pPage", "numOfRows"])),
  };
}

export function parseStartupProviderPage(payload: string): StartupPage {
  const trimmed = payload.trim();
  if (!trimmed) throw new StartupAdapterError(502, "startup_empty_response");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return parseJsonPage(JSON.parse(trimmed) as unknown);
    } catch (error) {
      if (error instanceof StartupAdapterError) throw error;
      throw new StartupAdapterError(502, "startup_non_json");
    }
  }
  return parseXmlPage(trimmed);
}

function normalizedDataGoKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed.includes("%")) return trimmed;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

async function fetchStartupPage(args: {
  spec: ProviderSpec;
  apiKey: string;
  page: number;
  pageSize: number;
  fetchImpl: StartupAdapterFetch;
}) {
  const endpoint = new URL(args.spec.endpoint);
  endpoint.searchParams.set("serviceKey", normalizedDataGoKey(args.apiKey));
  for (const [name, value] of Object.entries(
    args.spec.requestParameters(args.page, args.pageSize),
  )) {
    endpoint.searchParams.set(name, value);
  }
  let response: Response;
  try {
    response = await args.fetchImpl(endpoint, {
      method: "GET",
      // Cloudflare Workers rejects redirect:"error" before issuing a request.
      // Manual mode preserves the fail-closed credential boundary below.
      redirect: "manual",
      signal: AbortSignal.timeout(STARTUP_REQUEST_TIMEOUT_MS),
      headers: { accept: "application/json, application/xml;q=0.8, text/xml;q=0.7" },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new StartupAdapterError(
      name === "AbortError" || name === "TimeoutError" ? 504 : 502,
      name === "AbortError" || name === "TimeoutError"
        ? "startup_upstream_timeout"
        : "startup_upstream_network",
    );
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new StartupAdapterError(502, "startup_upstream_redirect");
  }
  if (response.url) {
    let responseUrl: URL;
    try {
      responseUrl = new URL(response.url);
    } catch {
      throw new StartupAdapterError(502, "startup_upstream_origin");
    }
    if (responseUrl.origin !== endpoint.origin) {
      throw new StartupAdapterError(502, "startup_upstream_origin");
    }
  }
  if (!response.ok) {
    const status = response.status === 429
      ? 429
      : response.status === 401 || response.status === 403
        ? 403
        : response.status >= 500
          ? 502
          : response.status;
    throw new StartupAdapterError(status, `startup_upstream_http_${response.status}`);
  }
  let text: string;
  try {
    text = await readBoundedResponseText(response, STARTUP_RESPONSE_MAX_BYTES);
  } catch (error) {
    throw new StartupAdapterError(
      502,
      error instanceof PublicResponseBodyError
        ? "startup_body_too_large"
        : "startup_body_invalid",
    );
  }
  return parseStartupProviderPage(text);
}

function validatePage(
  page: StartupPage,
  expectedPage: number,
  pageSize: number,
  expectedTotal?: number,
) {
  if (expectedTotal !== undefined && page.totalCount !== expectedTotal) {
    throw new StartupAdapterError(502, "startup_total_changed");
  }
  if (page.page !== null && page.page !== expectedPage) {
    throw new StartupAdapterError(502, "startup_page_mismatch");
  }
  if (page.perPage !== null && page.perPage !== pageSize) {
    throw new StartupAdapterError(502, "startup_page_size_mismatch");
  }
  const offset = (expectedPage - 1) * pageSize;
  const remaining = Math.max(0, page.totalCount - offset);
  const expectedRows = Math.min(pageSize, remaining);
  if (page.rows.length !== expectedRows) {
    throw new StartupAdapterError(502, "startup_incomplete_page");
  }
}

function recordSignature(record: StartupAnnouncementRecord) {
  return JSON.stringify([
    record.item.title,
    record.item.sourceUrl,
    record.registeredAt,
    record.modifiedAt,
    record.applicationStartsAt,
    record.applicationEndsAt,
  ]);
}

function deduplicatedRecords(records: readonly StartupAnnouncementRecord[]) {
  const byId = new Map<string, StartupAnnouncementRecord>();
  for (const record of records) {
    const key = `${record.provider}:${record.officialId}`;
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, record);
      continue;
    }
    if (recordSignature(existing) !== recordSignature(record)) {
      throw new StartupAdapterError(502, "startup_duplicate_conflict");
    }
  }
  return [...byId.values()];
}

function safeNow(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) {
    throw new StartupAdapterError(500, "startup_invalid_now");
  }
  return new Date(value).toISOString();
}

function tagsFor(args: {
  providerLabel: string;
  category: string;
  target: string;
  agencies: readonly string[];
  regions: readonly StartupProvince[];
  scope: StartupScope;
  hashes: readonly string[];
}) {
  const regionAliases = new Set(Object.keys(REGION_ALIASES));
  const genericHashes = args.hashes.filter((tag) => !regionAliases.has(tag.replace(/\s+/gu, "")));
  return unique([
    "창업지원",
    args.providerLabel,
    args.category,
    args.target,
    ...args.agencies,
    ...args.regions,
    ...(args.scope === "nationwide" ? ["전국"] : []),
    ...genericHashes,
  ].map((tag) => cleanText(tag, 80)).filter(Boolean)).slice(0, 40);
}

function commonRecord(args: {
  provider: StartupProvider;
  itemPrefix: string;
  providerLabel: string;
  row: Record<string, unknown>;
  idKeys: readonly string[];
  titleKeys: readonly string[];
  summaryKeys: readonly string[];
  registeredKeys: readonly string[];
  modifiedKeys: readonly string[];
  startKeys: readonly string[];
  endKeys: readonly string[];
  combinedPeriodKeys: readonly string[];
  targetKeys: readonly string[];
  agencyKeys: readonly (readonly string[])[];
  categoryKeys: readonly string[];
  regionKeys: readonly string[];
  hashKeys: readonly string[];
  methodKeys: readonly string[];
  contactKeys: readonly string[];
  detailKeys: readonly string[];
  applicationKeys: readonly string[];
  detailBase: string;
  detailHosts: readonly string[];
  datasetUrl: string;
  context: NormalizeContext;
}) {
  const officialId = normalizedId(firstText(args.row, args.idKeys, 120));
  const title = firstText(args.row, args.titleKeys, 240);
  if (!officialId || !title) {
    throw new StartupAdapterError(502, "startup_required_field_missing");
  }
  const regionValues = args.regionKeys.map((key) => args.row[key]);
  const hashValue = firstText(args.row, args.hashKeys, 2_000);
  const officialHashTags = hashTags(hashValue);
  const fieldRegions = startupRegionsFromOfficialFields(...regionValues);
  const fieldScope = officialScope(regionValues, fieldRegions);
  const hashRegions = startupRegionsFromOfficialFields(hashValue);
  const usableHashRegions = hashRegions.length === STARTUP_PROVINCES.length
    ? []
    : hashRegions;
  const hashScope = officialScope([hashValue], usableHashRegions);
  const scope = fieldScope === "unknown" ? hashScope : fieldScope;
  const targetRegions = scope === "regional"
    ? fieldScope === "regional" ? fieldRegions : usableHashRegions
    : [];
  const agencies = unique(args.agencyKeys
    .map((keys) => firstText(args.row, keys, 160))
    .filter(Boolean));
  const target = firstText(args.row, args.targetKeys, 500) || null;
  const category = firstText(args.row, args.categoryKeys, 120);
  const registeredAt = normalizeStartupDate(firstText(args.row, args.registeredKeys, 120));
  const modifiedAt = normalizeStartupDate(firstText(args.row, args.modifiedKeys, 120));
  const period = applicationPeriod(
    args.row,
    args.startKeys,
    args.endKeys,
    args.combinedPeriodKeys,
  );
  const detailUrl = safeProviderUrl(
    firstText(args.row, args.detailKeys, 1_000),
    args.detailBase,
    args.detailHosts,
  );
  const applicationUrl = safeApplicationUrl(
    firstText(args.row, args.applicationKeys, 1_000),
    args.detailBase,
    args.detailHosts,
    args.context.allowedApplicationHosts,
  );
  const itemId = `${args.itemPrefix}-${officialId}`;
  const summary = firstText(args.row, args.summaryKeys, 1_200)
    || [target, category, period.end ? `신청 마감 ${period.end}` : ""].filter(Boolean).join(" · ")
    || "공식 창업 지원사업 공고입니다.";
  const item: PublicInformationItem = {
    id: itemId,
    category: "startup",
    title,
    summary,
    source: args.providerLabel,
    sourceUrl: detailUrl ?? args.datasetUrl,
    sourceLinkKind: detailUrl ? "detail" : "dataset",
    publishedAt: modifiedAt ?? registeredAt,
    discoveredAt: args.context.previous.get(itemId)?.discoveredAt ?? args.context.nowIso,
    lastVerifiedAt: args.context.nowIso,
    expiresAt: period.end,
    tags: tagsFor({
      providerLabel: args.providerLabel,
      category,
      target: target ?? "",
      agencies,
      regions: targetRegions,
      scope,
      hashes: officialHashTags,
    }),
    ...(targetRegions.length === 1 ? {
      location: {
        label: targetRegions[0],
        province: targetRegions[0],
        precision: "administrative",
      },
    } : {}),
  };
  return {
    item,
    provider: args.provider,
    officialId,
    targetRegions,
    scope,
    registeredAt,
    modifiedAt,
    applicationStartsAt: period.start,
    applicationEndsAt: period.end,
    target,
    agencies,
    applicationMethod: firstText(args.row, args.methodKeys, 1_000) || null,
    contact: firstText(args.row, args.contactKeys, 500) || null,
    detailUrl,
    applicationUrl,
    officialHashTags,
  } satisfies StartupAnnouncementRecord;
}

export function normalizeDataGoBizinfoAnnouncement(
  row: Record<string, unknown>,
  context: NormalizeContext,
) {
  return commonRecord({
    provider: "bizinfo-data-go",
    itemPrefix: "bizinfo-data-go",
    providerLabel: "중소벤처기업부 기업마당",
    row,
    idKeys: ["pblancId", "seq", "pbancId", "pblanc_id"],
    titleKeys: ["pblancNm", "title", "pbancNm"],
    summaryKeys: ["bsnsSumryCn", "description", "trgetNm"],
    registeredKeys: ["creatPnttm", "pubDate", "regDt", "frstRegDt"],
    modifiedKeys: ["lastUpdtPnttm", "updtPnttm", "mdfcnDt", "lastMdfcnDt"],
    startKeys: ["reqstBeginDe", "reqstBeginDt", "aplyBgngDt"],
    endKeys: ["reqstEndDe", "reqstEndDt", "aplyEndDt"],
    combinedPeriodKeys: ["reqstBeginEndDe", "reqstDt"],
    targetKeys: ["trgetNm", "sprtTrgtCn", "target"],
    agencyKeys: [
      ["jrsdInsttNm", "author"],
      ["excInsttNm", "executionAgency"],
    ],
    categoryKeys: ["pldirSportRealmLclasCodeNm", "lcategory", "searchLclasNm"],
    regionKeys: ["sprtTrgtRgnCn", "region", "areaNm"],
    hashKeys: ["hashTags", "hashtags", "hashtag"],
    methodKeys: ["reqstMthPapersCn", "applicationMethod"],
    contactKeys: ["refrncNm", "inqireCn", "contact"],
    detailKeys: ["pblancUrl", "link", "detailUrl"],
    applicationKeys: ["rceptEngnHmpgUrl", "applicationUrl"],
    detailBase: "https://www.bizinfo.go.kr/",
    detailHosts: ["bizinfo.go.kr"],
    datasetUrl: DATA_GO_BIZINFO_SOURCE_URL,
    context,
  });
}

export function normalizeKStartupAnnouncement(
  row: Record<string, unknown>,
  context: NormalizeContext,
) {
  return commonRecord({
    provider: "kstartup",
    itemPrefix: "kstartup",
    providerLabel: "중소벤처기업부·창업진흥원 K-Startup",
    row,
    idKeys: ["pbanc_sn", "pbancSn", "announcementId"],
    titleKeys: ["biz_pbanc_nm", "bizPbancNm", "intg_pbanc_biz_nm"],
    summaryKeys: ["pbanc_ctnt", "pbancCtnt", "aply_trgt_ctnt", "intg_pbanc_biz_nm"],
    registeredKeys: ["pbanc_reg_dt", "reg_dt", "frst_reg_dt", "created_at"],
    modifiedKeys: ["last_mdfcn_dt", "mdfcn_dt", "upd_dt", "updated_at"],
    startKeys: ["pbanc_rcpt_bgng_dt", "pbancRcptBgngDt"],
    endKeys: ["pbanc_rcpt_end_dt", "pbancRcptEndDt"],
    combinedPeriodKeys: ["pbanc_rcpt_bgng_end_dt", "rcpt_period"],
    targetKeys: ["aply_trgt", "aplyTrgt", "aply_trgt_ctnt"],
    agencyKeys: [
      ["sprv_inst", "sprvInst"],
      ["biz_supt_org_nm", "bizSuptOrgNm"],
    ],
    categoryKeys: ["supt_biz_clsfc", "suptBizClsfc"],
    regionKeys: ["supt_regin", "suptRegin"],
    hashKeys: ["hash_tags", "hashTags"],
    methodKeys: [
      "aply_mthd_etc_istc",
      "aply_mthd_eml_rcpt_istc",
      "aply_mthd_fax_rcpt_istc",
    ],
    contactKeys: ["biz_gdnc_cn", "inqire_cn", "contact"],
    detailKeys: ["detl_pg_url", "detail_url", "detlPgUrl"],
    applicationKeys: ["aply_mthd_onli_rcpt_istc", "aply_url", "applicationUrl"],
    detailBase: "https://www.k-startup.go.kr/",
    detailHosts: ["k-startup.go.kr"],
    datasetUrl: K_STARTUP_SOURCE_URL,
    context,
  });
}

const BIZINFO_SPEC: ProviderSpec = {
  provider: "bizinfo-data-go",
  sourceId: "bizinfo-data-go",
  label: "중소벤처기업부 기업마당 지원사업 공고",
  endpoint: DATA_GO_BIZINFO_ENDPOINT,
  sourceUrl: DATA_GO_BIZINFO_SOURCE_URL,
  detailBase: "https://www.bizinfo.go.kr/",
  detailHosts: ["bizinfo.go.kr"],
  requestParameters: (page, pageSize) => ({
    pageNo: String(page),
    numOfRows: String(pageSize),
    type: "json",
    dataType: "json",
    searchLclasId: "06",
  }),
  normalize: normalizeDataGoBizinfoAnnouncement,
};

const K_STARTUP_SPEC: ProviderSpec = {
  provider: "kstartup",
  sourceId: "kstartup",
  label: "중소벤처기업부·창업진흥원 K-Startup 공고",
  endpoint: K_STARTUP_ANNOUNCEMENT_ENDPOINT,
  sourceUrl: K_STARTUP_SOURCE_URL,
  detailBase: "https://www.k-startup.go.kr/",
  detailHosts: ["k-startup.go.kr"],
  requestParameters: (page, pageSize) => ({
    page: String(page),
    perPage: String(pageSize),
    returnType: "json",
  }),
  normalize: normalizeKStartupAnnouncement,
};

function signatureHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function seoulGeneration(nowIso: string) {
  const date = new Date(nowIso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function startupBackfillIdentity(
  spec: ProviderSpec,
  pageSize: number,
  generation: string,
) {
  const staticParameters = Object.fromEntries(
    Object.entries(spec.requestParameters(1, pageSize))
      .filter(([name]) => !["page", "pageNo", "pageIndex", "startPage"].includes(name))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const queryState = JSON.stringify({
    version: 2,
    generation,
    provider: spec.provider,
    endpoint: spec.endpoint,
    pageSize,
    parameters: staticParameters,
  });
  return {
    queryState,
    querySignature: `startup-v1-${spec.sourceId}-${signatureHash(queryState)}`,
  };
}

function matchingCheckpoint(
  checkpoint: PublicBackfillCheckpoint | null,
  spec: ProviderSpec,
  querySignature: string,
  queryState: string,
  pageSize: number,
) {
  return checkpoint
    && checkpoint.sourceId === spec.sourceId
    && checkpoint.querySignature === querySignature
    && checkpoint.queryState === queryState
    && checkpoint.pageSize === pageSize
    ? checkpoint
    : null;
}

function startupCheckpoint(input: {
  spec: ProviderSpec;
  querySignature: string;
  queryState: string;
  pageSize: number;
  nextPage: number;
  providerTotalCount: number;
  fetchedCount: number;
  completed: boolean;
  latestRefreshAt: number;
  completedAt: number | null;
}): PublicBackfillCheckpoint {
  return {
    sourceId: input.spec.sourceId,
    querySignature: input.querySignature,
    queryState: input.queryState,
    nextPage: input.nextPage,
    pageSize: input.pageSize,
    providerTotalCount: input.providerTotalCount,
    fetchedCount: input.fetchedCount,
    completed: input.completed,
    latestRefreshAt: input.latestRefreshAt,
    completedAt: input.completedAt,
    updatedAt: input.latestRefreshAt,
  };
}

async function startupAdapter(
  spec: ProviderSpec,
  options: StartupAdapterOptions,
): Promise<StartupAdapterResult> {
  if (!options.apiKey?.trim()) return emptyResult(spec, "not-configured");
  let requestCount = 0;
  const pageSize = Number.isSafeInteger(options.pageSize)
    && Number(options.pageSize) >= 1
    && Number(options.pageSize) <= STARTUP_ADAPTER_DEFAULT_PAGE_SIZE
    ? Number(options.pageSize)
    : STARTUP_ADAPTER_DEFAULT_PAGE_SIZE;
  const context: NormalizeContext = {
    nowIso: "",
    previous: options.previous ?? new Map(),
    allowedApplicationHosts: options.allowedApplicationHosts ?? [],
  };
  try {
    context.nowIso = safeNow(options.nowIso);
    const fetchImpl = options.fetchImpl ?? fetch;
    requestCount += 1;
    const first = await fetchStartupPage({
      spec,
      apiKey: options.apiKey,
      page: 1,
      pageSize,
      fetchImpl,
    });
    validatePage(first, 1, pageSize);
    const firstRecords = first.rows.map((row) => spec.normalize(row, context));
    const requiredPages = Math.max(1, Math.ceil(first.totalCount / pageSize));

    if (!options.backfill) {
      const fetchedRows = [...first.rows];
      let collectedRecords = [...firstRecords];
      let partialError: unknown = null;
      for (let page = 2; page <= Math.min(requiredPages, STARTUP_ADAPTER_MAX_PAGES); page += 1) {
        try {
          requestCount += 1;
          const next = await fetchStartupPage({
            spec,
            apiKey: options.apiKey,
            page,
            pageSize,
            fetchImpl,
          });
          validatePage(next, page, pageSize, first.totalCount);
          const nextRecords = next.rows.map((row) => spec.normalize(row, context));
          fetchedRows.push(...next.rows);
          collectedRecords.push(...nextRecords);
        } catch (error) {
          partialError = error;
          break;
        }
      }

      collectedRecords = deduplicatedRecords(collectedRecords);
      const completeness: StartupAdapterCompleteness = partialError
        ? "partial"
        : requiredPages > STARTUP_ADAPTER_MAX_PAGES
          ? "truncated"
          : "complete";
      const items = collectedRecords.map((record) => record.item);
      const asOf = collectedRecords
        .map((record) => record.modifiedAt ?? record.registeredAt)
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => right.localeCompare(left))[0] ?? null;
      return {
        source: source(
          spec,
          "live",
          items.length,
          partialError ? safeErrorCode(partialError) : undefined,
        ),
        records: collectedRecords,
        items,
        requestCount,
        totalCount: first.totalCount,
        fetchedCount: fetchedRows.length,
        completeness,
        asOf,
        ...(partialError ? { failureKind: failureKind(partialError) } : {}),
      };
    }

    const runtime = options.backfill;
    const now = Date.parse(context.nowIso);
    const identity = startupBackfillIdentity(
      spec,
      pageSize,
      seoulGeneration(context.nowIso),
    );
    let stored = matchingCheckpoint(
      runtime.checkpoint,
      spec,
      identity.querySignature,
      identity.queryState,
      pageSize,
    );
    // A changed provider total is a new offset walk, not proof that the old
    // final page magically gained rows. Reset only after the new first page
    // has been fetched/validated and persist it with the new cursor atomically.
    if (stored && stored.providerTotalCount !== first.totalCount) stored = null;
    const stagedById = new Map((stored ? runtime.stagedItems : [])
      .filter((item) => item.id.startsWith(`${spec.sourceId}-`))
      .map((item) => [item.id, item]));
    for (const record of firstRecords) stagedById.set(record.item.id, record.item);
    let collectedRecords = [...firstRecords];
    let partialError: unknown = null;
    const initiallyCompleted = stored?.completed
      || (stored ? stored.nextPage > requiredPages : requiredPages <= 1);
    let checkpoint = startupCheckpoint({
      spec,
      ...identity,
      pageSize,
      nextPage: initiallyCompleted ? requiredPages + 1 : Math.max(2, stored?.nextPage ?? 2),
      providerTotalCount: first.totalCount,
      fetchedCount: initiallyCompleted
        ? first.totalCount
        : Math.min(first.totalCount, Math.max(first.rows.length, stored?.fetchedCount ?? 0)),
      completed: initiallyCompleted,
      latestRefreshAt: now,
      completedAt: initiallyCompleted ? stored?.completedAt ?? now : null,
    });

    try {
      await runtime.commitPage({
        checkpoint,
        pageNumber: stored ? 0 : 1,
        items: firstRecords.map((record) => record.item),
        resetGeneration: !stored,
      });
    } catch {
      throw new StartupAdapterError(500, "startup_checkpoint_commit_failed");
    }

    const maximumPages = Math.min(
      STARTUP_ADAPTER_MAX_PAGES - 1,
      Math.max(1, Math.trunc(runtime.maxBackfillPagesPerRun)),
    );
    const finalPageThisRun = checkpoint.completed
      ? 0
      : Math.min(requiredPages, checkpoint.nextPage + maximumPages - 1);
    for (let page = checkpoint.nextPage; page <= finalPageThisRun; page += 1) {
      try {
        requestCount += 1;
        const next = await fetchStartupPage({
          spec,
          apiKey: options.apiKey,
          page,
          pageSize,
          fetchImpl,
        });
        validatePage(next, page, pageSize, first.totalCount);
        const nextRecords = next.rows.map((row) => spec.normalize(row, context));
        const completed = page >= requiredPages;
        checkpoint = startupCheckpoint({
          spec,
          ...identity,
          pageSize,
          nextPage: page + 1,
          providerTotalCount: first.totalCount,
          fetchedCount: Math.min(
            first.totalCount,
            Math.max(checkpoint.fetchedCount, page * pageSize),
          ),
          completed,
          latestRefreshAt: now,
          completedAt: completed ? now : null,
        });
        await runtime.commitPage({
          checkpoint,
          pageNumber: page,
          items: nextRecords.map((record) => record.item),
        });
        collectedRecords.push(...nextRecords);
        for (const record of nextRecords) stagedById.set(record.item.id, record.item);
      } catch (error) {
        partialError = error instanceof StartupAdapterError
          ? error
          : new StartupAdapterError(500, "startup_checkpoint_commit_failed");
        break;
      }
    }

    collectedRecords = deduplicatedRecords(collectedRecords);
    const items = [...stagedById.values()];
    const completeness: StartupAdapterCompleteness = partialError
      ? "partial"
      : checkpoint.completed
        ? "complete"
        : "truncated";
    const asOf = items
      .map((item) => item.publishedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
    return {
      source: source(
        spec,
        "live",
        items.length,
        partialError
          ? safeErrorCode(partialError)
          : checkpoint.completed
            ? undefined
            : "startup_backfill_in_progress",
      ),
      records: collectedRecords,
      items,
      requestCount,
      totalCount: first.totalCount,
      fetchedCount: checkpoint.fetchedCount,
      completeness,
      asOf,
      incremental: true,
      ...(partialError ? { failureKind: failureKind(partialError) } : {}),
    };
  } catch (error) {
    return emptyResult(spec, sourceStatus(error), error, requestCount);
  }
}

export function dataGoBizinfoStartupAdapter(options: StartupAdapterOptions) {
  return startupAdapter(BIZINFO_SPEC, options);
}

export function kStartupAnnouncementAdapter(options: StartupAdapterOptions) {
  return startupAdapter(K_STARTUP_SPEC, options);
}
