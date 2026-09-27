import { environmentValue, runtimeServiceSecrets, type ServiceApiKeyName } from "@/lib/runtime-settings";
import { PublicResponseBodyError, readBoundedResponseText } from "./bounded-response";
import { centerOfCommercialPolygon, displayCommercialBoundary } from "./geo";
import {
  COMMERCIAL_AREA_PAGE_SIZE,
  commercialAreaPagePlan,
  publicSourcePolicy,
} from "./policies";
import { prunePublicInformationArchive } from "./retention";
import { safePublicHttpUrl } from "./urls";
import { cleanPublicText, decodePublicTextEntities } from "./text";
import {
  moelPolicyNewsAdapter,
  moelPressReleasesAdapter,
  work24Adapter,
  youthCenterAdapter,
} from "./youth-adapters";
import {
  dataGoBizinfoStartupAdapter,
  kStartupAnnouncementAdapter,
  type StartupAdapterResult,
} from "./startup-adapters";
import {
  SEOUL_COMMERCIAL_SOURCE_URLS,
} from "./seoul-commercial-adapter";
import { kosisEmploymentAdapter } from "./kosis-employment-adapter";
import {
  emptyPublicDataPayload,
  type PublicBackfillCheckpoint,
  type PublicBackfillPageCommit,
  type PublicBackfillRuntime,
  type ExchangeRate,
  type MarketPoint,
  type PublicDataPayload,
  type PublicInformationCategory,
  type PublicInformationItem,
  type PublicInformationLocation,
  type PublicSourceResult,
  type PublicSourceStatus,
} from "./types";

const EXIM_ENDPOINT = "https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON";
const STOCK_ENDPOINT = "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo";
const STOCK_INDEX_ENDPOINT = "https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService/getStockMarketIndex";
const FINANCIAL_COMPANY_ENDPOINT = "https://apis.data.go.kr/1160100/service/GetFnCoBasiInfoService/getFnCoOutl";
const LOAN_PRODUCT_ENDPOINT = "https://apis.data.go.kr/B553701/LoanProductSearchingInfo/LoanProductSearchingInfo/getLoanProductSearchingInfo";
const COMMERCIAL_AREA_ENDPOINT = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeZoneInAdmi";
const ECOS_ENDPOINT = "https://ecos.bok.or.kr/api/KeyStatisticList";
const FINLIFE_DEPOSIT_ENDPOINT = "https://finlife.fss.or.kr/finlifeapi/depositProductsSearch.json";
const FINLIFE_SAVING_ENDPOINT = "https://finlife.fss.or.kr/finlifeapi/savingProductsSearch.json";
const DART_DISCLOSURE_ENDPOINT = "https://opendart.fss.or.kr/api/list.json";
const BIZINFO_ENDPOINT = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";
// data.go.kr의 자동변환 파일 API는 월별 UDDI가 바뀐다. 아래 URL은
// 2026-07-22 공개 버전의 장애 대비 값이고, 실제 수집 시에는 ODCloud의
// 공식 Swagger 명세에서 가장 최신 날짜의 HTTPS 경로를 먼저 해석한다.
const KOSAF_HIGH_SCHOOL_ENDPOINT = "https://api.odcloud.kr/api/15116988/v1/uddi:99997f87-bdbe-48fc-b4cf-b492b7508479";
const KOSAF_UNIVERSITY_ENDPOINT = "https://api.odcloud.kr/api/15028252/v1/uddi:93ea274e-c626-40b9-8963-bbfadccc22ab";
const KOSAF_OAS_ENDPOINT = "https://infuser.odcloud.kr/oas/docs";
const STOCK_PAGE_SIZE = 1_000;
const GENERIC_DATA_GO_MAX_PAGES = 20;
const STOCK_MAX_PAGES = 10;
const FINLIFE_MAX_PAGES_PER_KIND = 20;
const DART_PAGE_COUNT = 100;
const DART_MAX_PAGES = 20;
const BIZINFO_PAGE_SIZE = 100;
const BIZINFO_MAX_PAGES = 10;

const SOURCE_URLS = {
  exchange: "https://www.koreaexim.go.kr/ir/HPHKIR020M01?apino=2&viewtype=C",
  stock: "https://www.data.go.kr/data/15094808/openapi.do",
  stockIndex: "https://www.data.go.kr/data/15094807/openapi.do",
  company: "https://www.data.go.kr/data/15043232/openapi.do",
  loan: "https://www.data.go.kr/data/15106208/openapi.do",
  commercial: "https://www.data.go.kr/data/15012005/openapi.do",
  kosafHigh: "https://www.data.go.kr/data/15116988/fileData.do",
  kosafUniversity: "https://www.data.go.kr/data/15028252/fileData.do",
  ecos: "https://ecos.bok.or.kr/api/",
  finlife: "https://finlife.fss.or.kr/finlife/main/main.do?menuNo=700000",
  dart: "https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001",
  bizinfo: "https://www.bizinfo.go.kr/apiDetail.do?id=bizinfoApi",
} as const;

const CURRENCY_NAMES: Record<string, string> = {
  USD: "미국 달러",
  JPY: "일본 엔",
  CNY: "중국 위안",
  EUR: "유로",
  GBP: "영국 파운드",
  CAD: "캐나다 달러",
  AUD: "호주 달러",
  SGD: "싱가포르 달러",
};

const REQUESTED_CURRENCIES = Object.keys(CURRENCY_NAMES);
const YOUTH_WORDS = ["청년", "대학생", "대학원생", "취업준비", "햇살론유스", "학자금"];

type AdapterResult = {
  source: PublicSourceResult;
  items: PublicInformationItem[];
  market: MarketPoint[];
  exchange: ExchangeRate[];
  asOf: string | null;
  requestCount?: number;
  failureKind?: PublicSourceFailureKind;
  incremental?: boolean;
};

export interface PublicDataBackfillContext {
  checkpoints: ReadonlyMap<string, PublicBackfillCheckpoint>;
  stagedItems: ReadonlyMap<string, readonly PublicInformationItem[]>;
  maxBackfillPagesPerRun: number;
  commitPage: (input: PublicBackfillPageCommit) => Promise<void>;
  readCommittedItems?: PublicBackfillRuntime["readCommittedItems"];
}

export type PublicSourceFailureKind = "authorization" | "quota" | "transient";

class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestCount = 0,
  ) {
    super(message);
  }
}

function retryableProviderTransportFailure(error: unknown) {
  if (!(error instanceof UpstreamError)) return false;
  return error.status === 408
    || error.status === 504
    || error.message === "upstream_timeout"
    || error.message === "upstream_network"
    || /^upstream_http_5[0-9]{2}$/u.test(error.message);
}

function seoulDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}${values.month}${values.day}`;
}

function recentSeoulBusinessDates(
  anchor = new Date(),
  limit = 3,
  maximumLookbackDays = 8,
) {
  const candidates: string[] = [];
  for (let offset = 0; offset < maximumLookbackDays && candidates.length < limit; offset += 1) {
    const date = new Date(anchor.getTime() - offset * 24 * 60 * 60 * 1_000);
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      weekday: "short",
    }).format(date);
    if (weekday !== "Sat" && weekday !== "Sun") candidates.push(seoulDate(date));
  }
  return candidates;
}

function text(value: unknown, maxLength = 180) {
  return cleanPublicText(value, maxLength);
}

function pick(item: Record<string, unknown>, keys: string[], maxLength = 180) {
  for (const key of keys) {
    const value = text(item[key], maxLength);
    if (value) return value;
  }
  return "";
}

function finiteNumber(value: unknown) {
  const parsed = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalFiniteNumber(value: unknown) {
  const raw = String(value ?? "").replaceAll(",", "").trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: unknown) {
  const digits = text(value, 20).replace(/[^0-9]/gu, "");
  if (digits.length >= 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  if (digits.length === 6) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-01`;
  if (digits.length === 4) return `${digits}-01-01`;
  return null;
}

function normalizeLatestDate(value: unknown) {
  const raw = text(value, 240);
  const candidates = [
    ...raw.matchAll(/(20\d{2})[^0-9]?(\d{2})[^0-9]?(\d{2})/gu),
  ].map((match) => `${match[1]}-${match[2]}-${match[3]}`)
    .filter((candidate) => Number.isFinite(Date.parse(`${candidate}T12:00:00+09:00`)));
  return candidates.sort().at(-1) ?? null;
}

function list(value: unknown) {
  return [...new Set(text(value, 300)
    .split(/[,/·|]/gu)
    .map((part) => part.trim())
    .filter(Boolean))];
}

function stablePart(value: unknown, fallback: string) {
  const normalized = text(value, 100).replace(/[^0-9A-Za-z가-힣_-]/gu, "-");
  return normalized || fallback;
}

function compactDate(date: Date) {
  return seoulDate(date);
}

function daysAgo(days: number) {
  return compactDate(new Date(Date.now() - days * 24 * 60 * 60 * 1_000));
}

function objectRows(payload: unknown, containerName: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const container = (payload as Record<string, unknown>)[containerName];
  if (!container || typeof container !== "object" || Array.isArray(container)) return [];
  const rows = (container as Record<string, unknown>).row;
  return (Array.isArray(rows) ? rows : rows && typeof rows === "object" ? [rows] : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function recordArray(value: unknown) {
  return (Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

export function normalizeBizinfoPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new UpstreamError(502, "bizinfo_shape");
  }
  const root = payload as Record<string, unknown>;
  const providerError = text(root.reqErr ?? root.error ?? root.message, 300);
  if (providerError) {
    const authorization = /인증|키|key|auth|존재하지\s*않는/iu.test(providerError);
    throw new UpstreamError(
      authorization ? 403 : 502,
      authorization ? "bizinfo_authorization" : "bizinfo_upstream_error",
    );
  }
  const jsonArray = root.jsonArray;
  if (Array.isArray(jsonArray)) return recordArray(jsonArray);
  if (jsonArray && typeof jsonArray === "object") {
    return recordArray((jsonArray as Record<string, unknown>).item);
  }
  throw new UpstreamError(502, "bizinfo_shape");
}

export function normalizeDataGoServiceKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed.includes("%")) return trimmed;
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

function sourceStatus(error: unknown): PublicSourceStatus {
  if (error instanceof UpstreamError && (error.status === 401 || error.status === 403)) {
    return "authorization-pending";
  }
  return "unavailable";
}

function sourceFailureKind(error: unknown): PublicSourceFailureKind {
  if (error instanceof UpstreamError) {
    if (error.status === 429) return "quota";
    if (error.status === 401 || error.status === 403) return "authorization";
  }
  return "transient";
}

function sourceErrorCode(error: unknown) {
  if (error instanceof UpstreamError && /^[a-z0-9_]+$/u.test(error.message)) {
    return error.message.slice(0, 80);
  }
  return "adapter_exception";
}

function source(
  id: string,
  label: string,
  status: PublicSourceStatus,
  sourceUrl: string,
  itemCount = 0,
): PublicSourceResult {
  return { id, label, status, itemCount, sourceUrl };
}

function sourceWithCoverage(
  id: string,
  label: string,
  sourceUrl: string,
  itemCount: number,
  coverage: PagedRows,
): PublicSourceResult {
  const status: PublicSourceStatus = coverage.completeness === "complete"
    ? "live"
    : coverage.completeness;
  return {
    ...source(id, label, status, sourceUrl, itemCount),
    providerTotalCount: coverage.totalCount,
    fetchedCount: coverage.fetchedCount,
    completeness: coverage.completeness,
    ...(coverage.completeness === "truncated"
      ? { errorCode: "provider_page_window_limit_reached" }
      : {}),
  };
}

async function fetchResponse(endpoint: URL, timeoutMs: number, init: RequestInit = {}) {
  try {
    const response = await fetch(endpoint, {
      ...init,
      // Redirect hops count as separate provider and Worker subrequests. A
      // fixed official endpoint must fail closed instead of silently spending
      // unreserved calls or forwarding a credential to another origin.
      // Cloudflare Workers supports "follow" and "manual", but not "error".
      // Manual mode keeps credentials on the original request while allowing
      // us to reject the redirect response explicitly below.
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new UpstreamError(502, "upstream_redirect");
    }
    return response;
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    const errorName = error instanceof Error ? error.name : "";
    // AbortError is a timeout here because this helper only supplies AbortSignal.timeout().
    if (errorName === "TimeoutError" || errorName === "AbortError") {
      throw new UpstreamError(504, "upstream_timeout");
    }
    if (errorName === "TypeError") {
      throw new UpstreamError(502, "upstream_network");
    }
    // Any remaining exception was still raised by fetch(), not by normalization.
    throw new UpstreamError(502, "upstream_network");
  }
}

async function fetchJson(endpoint: URL, timeoutMs = 8_000) {
  const response = await fetchResponse(endpoint, timeoutMs);
  if (!response.ok) throw new UpstreamError(response.status, `upstream_http_${response.status}`);
  let payload: string;
  try {
    payload = await readBoundedResponseText(response, 12_000_000);
  } catch (error) {
    throw new UpstreamError(502, error instanceof PublicResponseBodyError
      ? "upstream_body_too_large"
      : "upstream_body_invalid");
  }
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new UpstreamError(502, "upstream_non_json");
  }
}

async function fetchText(endpoint: URL, timeoutMs = 8_000) {
  const response = await fetchResponse(endpoint, timeoutMs);
  if (!response.ok) throw new UpstreamError(response.status, `upstream_http_${response.status}`);
  try {
    return await readBoundedResponseText(response, 12_000_000);
  } catch (error) {
    throw new UpstreamError(502, error instanceof PublicResponseBodyError
      ? "upstream_body_too_large"
      : "upstream_body_invalid");
  }
}

function loopbackProxyUrl(value: string) {
  try {
    const endpoint = new URL(value);
    const loopback = endpoint.hostname === "127.0.0.1" && endpoint.port === "3101";
    if (endpoint.protocol !== "http:" || !loopback || endpoint.username || endpoint.password) return null;
    endpoint.pathname = "/v1/dart";
    endpoint.search = "";
    endpoint.hash = "";
    return endpoint;
  } catch {
    return null;
  }
}

async function fetchDartJson(endpoint: URL) {
  const [proxyValue, proxyToken] = await Promise.all([
    environmentValue("PUBLIC_API_PROXY_URL"),
    environmentValue("PUBLIC_API_PROXY_TOKEN"),
  ]);
  if (!proxyValue && !proxyToken) return await fetchJson(endpoint, 15_000);
  const proxyEndpoint = proxyValue ? loopbackProxyUrl(proxyValue) : null;
  if (!proxyEndpoint || !proxyToken || proxyToken.length < 32) {
    throw new UpstreamError(503, "dart_proxy_invalid_config");
  }
  const response = await fetchResponse(proxyEndpoint, 20_000, {
    method: "POST",
    redirect: "manual",
    headers: {
      authorization: `Bearer ${proxyToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ params: Object.fromEntries(endpoint.searchParams.entries()) }),
  });
  if (!response.ok) {
    const cameFromUpstream = response.headers.get("x-bora-proxy-upstream") === "1";
    if (!cameFromUpstream && (response.status === 401 || response.status === 403)) {
      throw new UpstreamError(503, "dart_proxy_unauthorized");
    }
    throw new UpstreamError(response.status, `dart_proxy_http_${response.status}`);
  }
  const payload = await response.text();
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw new UpstreamError(502, "dart_proxy_non_json");
  }
}

function decodeXml(value: string) {
  return decodePublicTextEntities(value).trim();
}

function xmlItems(payload: string) {
  const resultCode = /<resultCode>([^<]*)<\/resultCode>/iu.exec(payload)?.[1]?.trim();
  if (resultCode === "03") return [];
  if (resultCode && resultCode !== "00" && resultCode !== "0") {
    const status = resultCode === "22"
      ? 429
      : ["20", "30", "31", "32"].includes(resultCode)
        ? 403
        : 502;
    throw new UpstreamError(status, `upstream_result_${resultCode}`);
  }
  return [...payload.matchAll(/<item>([\s\S]*?)<\/item>/giu)].map((match) => {
    const item: Record<string, unknown> = {};
    for (const field of match[1].matchAll(/<([A-Za-z0-9_가-힣]+)>([\s\S]*?)<\/\1>/gu)) {
      item[field[1]] = decodeXml(field[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1"));
    }
    return item;
  });
}

function responseItems(payload: unknown): { items: Record<string, unknown>[]; totalCount: number; totalCountProvided: boolean } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { items: [], totalCount: 0, totalCountProvided: false };
  }
  const root = payload as Record<string, unknown>;
  const response = root.response && typeof root.response === "object"
    ? root.response as Record<string, unknown>
    : root;
  const header = response.header && typeof response.header === "object"
    ? response.header as Record<string, unknown>
    : null;
  const resultCode = text(header?.resultCode ?? header?.result_code, 20);
  if (resultCode && resultCode !== "00" && resultCode !== "0" && resultCode !== "03") {
    const status = resultCode === "22"
      ? 429
      : ["20", "30", "31", "32"].includes(resultCode)
        ? 403
        : 502;
    throw new UpstreamError(status, `upstream_result_${resultCode}`);
  }
  const body = response.body && typeof response.body === "object"
    ? response.body as Record<string, unknown>
    : response;
  const container = body.items && typeof body.items === "object" && !Array.isArray(body.items)
    ? body.items as Record<string, unknown>
    : body;
  const rawItems = container.item ?? body.items ?? body.data ?? root.data ?? [];
  const list = Array.isArray(rawItems) ? rawItems : rawItems && typeof rawItems === "object" ? [rawItems] : [];
  const rawTotalCount = body.totalCount ?? root.totalCount;
  const parsedTotalCount = optionalFiniteNumber(rawTotalCount);
  return {
    items: list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)),
    totalCount: Math.max(0, parsedTotalCount ?? list.length),
    totalCountProvided: parsedTotalCount !== null && parsedTotalCount >= 0,
  };
}

export async function dataGoJson(
  apiKey: string,
  endpointUrl: string,
  params: Record<string, string>,
  keyParameter = "serviceKey",
  timeoutMs = 8_000,
) {
  const endpoint = new URL(endpointUrl);
  endpoint.searchParams.set(keyParameter, normalizeDataGoServiceKey(apiKey));
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, value);
  const payload = await fetchText(endpoint, timeoutMs);
  try {
    return responseItems(JSON.parse(payload) as unknown);
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    const items = xmlItems(payload);
    const totalCountMatch = /<totalCount>([^<]*)<\/totalCount>/iu.exec(payload);
    const parsedTotalCount = optionalFiniteNumber(totalCountMatch?.[1]);
    return {
      items,
      totalCount: Math.max(0, parsedTotalCount ?? items.length),
      totalCountProvided: parsedTotalCount !== null && parsedTotalCount >= 0,
    };
  }
}

type PagedRows = {
  items: Record<string, unknown>[];
  totalCount: number | null;
  fetchedCount: number;
  requestCount: number;
  completeness: "complete" | "partial" | "truncated";
};

async function dataGoJsonPages(input: {
  apiKey: string;
  endpoint: string;
  params: Record<string, string>;
  keyParameter?: string;
  pageSize: number;
  maxPages: number;
  timeoutMs?: number;
}): Promise<PagedRows> {
  const collected: Record<string, unknown>[] = [];
  let requestCount = 0;
  let providerTotal: number | null = null;
  for (let page = 1; page <= input.maxPages; page += 1) {
    requestCount += 1;
    let response;
    try {
      response = await dataGoJson(input.apiKey, input.endpoint, {
        ...input.params,
        pageNo: String(page),
        numOfRows: String(input.pageSize),
      }, input.keyParameter, input.timeoutMs);
    } catch (error) {
      if (collected.length) {
        return {
          items: collected,
          totalCount: providerTotal,
          fetchedCount: collected.length,
          requestCount,
          completeness: "partial",
        };
      }
      if (error instanceof UpstreamError) {
        throw new UpstreamError(error.status, error.message, requestCount);
      }
      throw error;
    }
    if (response.totalCountProvided) {
      if (providerTotal !== null && response.totalCount !== providerTotal) {
        throw new UpstreamError(502, "upstream_total_count_changed", requestCount);
      }
      providerTotal = response.totalCount;
    }
    collected.push(...response.items);
    if (
      response.items.length < input.pageSize
      || (providerTotal !== null && collected.length >= providerTotal)
    ) {
      return {
        items: collected,
        totalCount: providerTotal ?? collected.length,
        fetchedCount: collected.length,
        requestCount,
        completeness: "complete",
      };
    }
  }
  return {
    items: collected,
    totalCount: providerTotal,
    fetchedCount: collected.length,
    requestCount,
    completeness: providerTotal !== null && collected.length >= providerTotal
      ? "complete"
      : "truncated",
  };
}

async function odCloudJson(apiKey: string, endpointUrl: string, perPage = 100): Promise<PagedRows> {
  const pageSize = Math.min(100, Math.max(1, Math.trunc(perPage)));
  const items: Record<string, unknown>[] = [];
  let totalCount: number | null = null;
  for (let page = 1; page <= GENERIC_DATA_GO_MAX_PAGES; page += 1) {
    const endpoint = new URL(endpointUrl);
    endpoint.searchParams.set("serviceKey", normalizeDataGoServiceKey(apiKey));
    endpoint.searchParams.set("page", String(page));
    endpoint.searchParams.set("perPage", String(pageSize));
    endpoint.searchParams.set("returnType", "JSON");
    const payload = await fetchJson(endpoint);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new UpstreamError(502, "odcloud_shape");
    }
    const body = payload as Record<string, unknown>;
    const raw = body.data;
    const rows = Array.isArray(raw)
      ? raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      : [];
    const advertised = optionalFiniteNumber(body.totalCount);
    if (advertised !== null) totalCount = Math.max(0, advertised);
    items.push(...rows);
    if (rows.length < pageSize || (totalCount !== null && items.length >= totalCount)) {
      return {
        items,
        totalCount: totalCount ?? items.length,
        fetchedCount: items.length,
        requestCount: page,
        completeness: "complete",
      };
    }
  }
  return {
    items,
    totalCount,
    fetchedCount: items.length,
    requestCount: GENERIC_DATA_GO_MAX_PAGES,
    completeness: "truncated",
  };
}

export async function latestKosafEndpoint(kind: "high" | "university") {
  const namespace = kind === "high" ? "15116988/v1" : "15028252/v1";
  const fallback = kind === "high" ? KOSAF_HIGH_SCHOOL_ENDPOINT : KOSAF_UNIVERSITY_ENDPOINT;
  try {
    const endpoint = new URL(KOSAF_OAS_ENDPOINT);
    endpoint.searchParams.set("namespace", namespace);
    const payload = await fetchJson(endpoint, 8_000);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
    const paths = (payload as Record<string, unknown>).paths;
    if (!paths || typeof paths !== "object" || Array.isArray(paths)) return fallback;
    const prefix = `/${namespace}/uddi:`;
    const candidates = Object.entries(paths as Record<string, unknown>).flatMap(([path, definition]) => {
      if (!path.startsWith(prefix) || !/^\/\d+\/v1\/uddi:[0-9a-f-]+$/iu.test(path)) return [];
      const get = definition && typeof definition === "object" && !Array.isArray(definition)
        ? (definition as Record<string, unknown>).get
        : null;
      const summary = get && typeof get === "object" && !Array.isArray(get)
        ? String((get as Record<string, unknown>).summary ?? "")
        : "";
      const date = /_(\d{8})$/u.exec(summary)?.[1] ?? "";
      return [{ path, date }];
    }).sort((left, right) => right.date.localeCompare(left.date));
    const latest = candidates[0]?.path;
    return latest ? new URL(`/api${latest}`, "https://api.odcloud.kr").toString() : fallback;
  } catch {
    return fallback;
  }
}

export function normalizeKosafRows(
  rows: readonly Record<string, unknown>[],
  kind: "high" | "university",
) {
  const isHigh = kind === "high";
  const sourceUrl = isHigh ? SOURCE_URLS.kosafHigh : SOURCE_URLS.kosafUniversity;
  const label = isHigh ? "한국장학재단 고등학생 학자금지원" : "한국장학재단 대학생 학자금지원";
  return rows.flatMap((item, index) => {
    const institution = pick(item, [
      "운영기관명",
      "지원기관명",
      "학교명",
      "대학명",
      "기관명",
      "교육기관명",
    ]);
    const program = pick(item, [
      "상품명",
      "지원제도",
      "지원제도명",
      "장학금명",
      "사업명",
      "지원명",
    ]);
    const title = [institution, program].filter(Boolean).join(" · ");
    if (!title) return [];
    const target = pick(item, ["신청대상", "지원대상", "대상", "지원자격", "선발대상"]);
    const amount = pick(item, [
      "지원금액",
      "지원내역 상세내용",
      "지원내용",
      "장학금액",
      "지원규모",
    ],);
    const applicationPeriod = pick(item, ["신청기간", "접수기간", "선발일정"]);
    const basis = pick(item, ["학년도", "기준연도", "연도"]);
    const detailUrl = safePublicHttpUrl(
      pick(item, ["홈페이지 주소", "홈페이지URL", "상세페이지 URL", "상세URL"], 1_000),
    );
    const itemSourceUrl = detailUrl ?? sourceUrl;
    return [{
      id: `kosaf-${kind}-${stablePart(item.번호 ?? item.일련번호 ?? item.id, `${title}-${index}`)}`,
      category: "youth" as const,
      title,
      summary: [target, amount, applicationPeriod && `신청기간 ${applicationPeriod}`]
        .filter(Boolean)
        .join(" · ")
        || "한국장학재단 학자금지원 정보",
      source: label,
      sourceUrl: itemSourceUrl,
      sourceLinkKind: detailUrl ? "detail" as const : "dataset" as const,
      publishedAt: normalizeDate(
        item.데이터기준일자
        ?? item.기준일자
        ?? item.등록일자
        ?? item.수정일자,
      ),
      expiresAt: normalizeLatestDate(applicationPeriod),
      tags: [
        isHigh ? "고등학생" : "대학생·대학원생",
        "학자금",
        "section:scholarship",
        "전국",
        basis,
      ].filter(Boolean),
      youthPolicyEligibility: {
        regionScope: "nationwide" as const,
        statuses: isHigh
          ? ["high_school" as const]
          : ["university" as const, "graduate_school" as const],
        interests: ["education" as const],
      },
    }];
  });
}

function discoveredItems(
  items: Omit<PublicInformationItem, "discoveredAt">[],
  previous: Map<string, PublicInformationItem>,
  nowIso: string,
) {
  return items.flatMap((item) => {
    const sourceUrl = safePublicHttpUrl(item.sourceUrl);
    if (!sourceUrl) return [];
    return [{
      ...item,
      sourceUrl,
      discoveredAt: previous.get(item.id)?.discoveredAt ?? nowIso,
      lastVerifiedAt: nowIso,
    }];
  });
}

export const NATIONAL_COMMERCIAL_AREAS_PER_PROVINCE = 10;

export function retainNationalCommercialAreas<T extends {
  id: string;
  title: string;
  location?: { province?: string };
  commercialArea?: { areaSquareMeters: number | null };
}>(items: readonly T[]) {
  const byProvince = new Map<string, T[]>();
  for (const item of items) {
    const province = item.location?.province?.trim() || "기타";
    const provinceItems = byProvince.get(province);
    if (provinceItems) provinceItems.push(item);
    else byProvince.set(province, [item]);
  }
  return [...byProvince.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "ko-KR"))
    .flatMap(([, provinceItems]) => provinceItems
      .sort((left, right) => {
        const areaDelta = (right.commercialArea?.areaSquareMeters ?? -1)
          - (left.commercialArea?.areaSquareMeters ?? -1);
        return areaDelta || left.id.localeCompare(right.id, "ko-KR")
          || left.title.localeCompare(right.title, "ko-KR");
      })
      .slice(0, NATIONAL_COMMERCIAL_AREAS_PER_PROVINCE));
}

const SOURCE_ITEM_PREFIXES: Record<string, string[]> = {
  stock: ["stock-"],
  "financial-company": ["company-"],
  "loan-product": ["loan-"],
  "commercial-area": ["commercial-"],
  "seoul-commercial": ["seoul-commercial-"],
  "kosaf-high": ["kosaf-high-"],
  "kosaf-university": ["kosaf-university-"],
  ecos: ["ecos-"],
  finlife: ["finlife-"],
  dart: ["dart-"],
  bizinfo: ["bizinfo-"],
  "bizinfo-data-go": ["bizinfo-data-go-"],
  kstartup: ["kstartup-"],
  work24: ["work24-"],
  "youth-center": ["youth-center-"],
  "kosis-employment": ["kosis-employment-"],
  "moel-policy-news": ["moel-news-"],
  "moel-press-releases": ["moel-report-"],
};

function sourceOwnsItem(sourceId: string, item: PublicInformationItem) {
  if (sourceId === "commercial-area" && item.id.startsWith("seoul-commercial-")) return false;
  if (sourceId === "bizinfo" && item.id.startsWith("bizinfo-data-go-")) return false;
  return (SOURCE_ITEM_PREFIXES[sourceId] ?? []).some((prefix) => item.id.startsWith(prefix));
}

function publicStartupAdapterResult(result: StartupAdapterResult): AdapterResult {
  const status = result.source.status === "live"
    ? result.completeness === "partial"
      ? "partial"
      : result.completeness === "truncated"
        ? "truncated"
        : "live"
    : result.source.status;
  return {
    source: {
      ...result.source,
      status,
      providerTotalCount: result.totalCount,
      fetchedCount: result.fetchedCount,
      completeness: result.completeness,
    },
    items: result.items,
    market: [],
    exchange: [],
    asOf: result.asOf,
    requestCount: result.requestCount,
    failureKind: result.failureKind,
    incremental: result.incremental,
  };
}

async function exchangeAdapter(apiKey: string | null): Promise<AdapterResult> {
  const empty: AdapterResult = {
    source: source("exchange", "한국수출입은행 환율", "not-configured", SOURCE_URLS.exchange),
    items: [], market: [], exchange: [], asOf: null,
  };
  if (!apiKey) return empty;
  let requestCount = 0;
  try {
    let rates: ExchangeRate[] = [];
    let asOf: string | null = null;
    for (const date of recentSeoulBusinessDates()) {
      const endpoint = new URL(EXIM_ENDPOINT);
      endpoint.searchParams.set("authkey", apiKey);
      endpoint.searchParams.set("searchdate", date);
      endpoint.searchParams.set("data", "AP01");
      requestCount += 1;
      const payload = await fetchJson(endpoint);
      if (!Array.isArray(payload)) throw new UpstreamError(502, "exchange_shape");
      const exchangeResultCode = payload[0] && typeof payload[0] === "object" && !Array.isArray(payload[0])
        ? text((payload[0] as Record<string, unknown>).result, 10)
        : "";
      if (exchangeResultCode && exchangeResultCode !== "1") {
        if (exchangeResultCode === "3") throw new UpstreamError(403, "exchange_invalid_key");
        if (exchangeResultCode === "4") throw new UpstreamError(429, "exchange_quota_exceeded");
      }
      rates = payload.flatMap((raw): ExchangeRate[] => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const item = raw as Record<string, unknown>;
      const sourceUnit = text(item.cur_unit, 20).toUpperCase();
      const match = /^([A-Z]{3})(?:\((\d+)\))?$/u.exec(sourceUnit);
      if (!match) return [];
      const currency = match[1] === "CNH" ? "CNY" : match[1];
      if (!REQUESTED_CURRENCIES.includes(currency)) return [];
      const quotedUnit = match[2] ? Number(match[2]) : 1;
      const quotedRate = finiteNumber(item.deal_bas_r);
      if (quotedRate <= 0 || quotedUnit <= 0) return [];
      return [{
        currency,
        name: CURRENCY_NAMES[currency] ?? text(item.cur_nm) ?? currency,
        baseCurrency: "KRW",
        unit: 1,
        baseRate: Number((quotedRate / quotedUnit).toFixed(6)),
        quotedUnit,
        quotedRate,
        sourceUnit,
      }];
      });
      if (rates.length) {
        asOf = normalizeDate(date);
        break;
      }
    }
    if (!rates.length) throw new UpstreamError(502, "exchange_empty");
    return {
      ...empty,
      source: source("exchange", "한국수출입은행 환율", "live", SOURCE_URLS.exchange, rates.length),
      exchange: rates,
      asOf,
      requestCount,
    };
  } catch (error) {
    return {
      ...empty,
      requestCount,
      failureKind: sourceFailureKind(error),
      source: { ...source("exchange", "한국수출입은행 환율", sourceStatus(error), SOURCE_URLS.exchange), errorCode: sourceErrorCode(error) },
    };
  }
}

async function stockAdapter(apiKey: string | null, nowIso: string, previous: Map<string, PublicInformationItem>): Promise<AdapterResult> {
  const empty: AdapterResult = {
    source: source("stock", "금융위원회 주식시세", "not-configured", SOURCE_URLS.stock),
    items: [], market: [], exchange: [], asOf: null,
  };
  if (!apiKey) return empty;
  let requestCount = 0;
  try {
    requestCount += 1;
    const first = await dataGoJson(apiKey, STOCK_ENDPOINT, {
      pageNo: "1", numOfRows: String(STOCK_PAGE_SIZE), resultType: "json",
    }, "serviceKey", 15_000);
    const latestDate = first.items
      .map((item) => normalizeDate(item.basDt ?? item.baseDate))
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
    if (!latestDate) throw new UpstreamError(502, "stock_date_missing");
    const coverage = await dataGoJsonPages({
      apiKey,
      endpoint: STOCK_ENDPOINT,
      params: { resultType: "json", basDt: latestDate.replaceAll("-", "") },
      pageSize: STOCK_PAGE_SIZE,
      maxPages: STOCK_MAX_PAGES,
      timeoutMs: 15_000,
    });
    requestCount += coverage.requestCount;
    const normalized = discoveredItems(coverage.items.flatMap((item, index) => {
      const name = pick(item, ["itmsNm", "itemName", "종목명"]);
      if (!name) return [];
      const date = normalizeDate(item.basDt ?? item.baseDate);
      const close = finiteNumber(item.clpr ?? item.closePrice);
      const changeRate = finiteNumber(item.fltRt ?? item.changeRate);
      const code = pick(item, ["srtnCd", "isinCd", "shortCode"]);
      return [{
        id: `stock-${stablePart(date, "undated")}-${stablePart(code, String(index))}`,
        category: "finance" as const,
        title: name,
        summary: `종가 ${close.toLocaleString("ko-KR")}원 · 등락률 ${changeRate.toFixed(2)}%`,
        source: "금융위원회 주식시세정보",
        sourceUrl: SOURCE_URLS.stock,
        publishedAt: date,
        tags: ["주식", pick(item, ["mrktCtg", "marketCategory"])].filter(Boolean),
      }];
    }), previous, nowIso);
    if (!normalized.length) throw new UpstreamError(502, "stock_empty");
    let kospiItem: Record<string, unknown> | undefined;
    try {
      requestCount += 1;
      const indexResponse = await dataGoJson(apiKey, STOCK_INDEX_ENDPOINT, {
        pageNo: "1",
        numOfRows: "100",
        resultType: "json",
        basDt: latestDate.replaceAll("-", ""),
      }, "serviceKey", 15_000);
      kospiItem = indexResponse.items.find((item) => {
        const name = pick(item, ["idxNm", "indexName"]).replaceAll(" ", "").toUpperCase();
        return name === "코스피" || name === "KOSPI";
      });
    } catch {
      // Index information is a separately approved data.go.kr API. Keep the
      // successfully collected individual-stock catalogue when that approval
      // is still pending instead of misclassifying an individual stock as KOSPI.
    }
    const market = kospiItem ? [{
      id: "kospi",
      name: "KOSPI",
      value: finiteNumber(kospiItem.clpr),
      change: finiteNumber(kospiItem.vs),
      changeRate: finiteNumber(kospiItem.fltRt),
      asOf: normalizeDate(kospiItem.basDt),
      sourceUrl: SOURCE_URLS.stockIndex,
    }] : [];
    return {
      ...empty,
      source: sourceWithCoverage("stock", "금융위원회 주식시세", SOURCE_URLS.stock, normalized.length, coverage),
      items: normalized,
      market,
      asOf: normalized[0]?.publishedAt ?? null,
      requestCount,
    };
  } catch (error) {
    return { ...empty, requestCount, failureKind: sourceFailureKind(error), source: { ...source("stock", "금융위원회 주식시세", sourceStatus(error), SOURCE_URLS.stock), errorCode: sourceErrorCode(error) } };
  }
}

async function companyAdapter(apiKey: string | null, nowIso: string, previous: Map<string, PublicInformationItem>): Promise<AdapterResult> {
  const empty: AdapterResult = {
    source: source("financial-company", "금융위원회 금융회사 기본정보", "not-configured", SOURCE_URLS.company),
    items: [], market: [], exchange: [], asOf: null,
  };
  if (!apiKey) return empty;
  let requestCount = 0;
  try {
    // The unfiltered provider total is a daily-history table (currently more
    // than two million rows), and its first pages are ordered from 2020 rather
    // than from the latest day. Probe recent Seoul business dates explicitly
    // and publish only a response whose required basDt matches the request.
    // This avoids presenting a historical page window as today's companies.
    const anchor = new Date(nowIso);
    if (!Number.isFinite(anchor.getTime())) {
      throw new UpstreamError(500, "financial_company_invalid_now");
    }
    let latestBaseDate: string | null = null;
    // The gateway occasionally returns a short-lived 5xx/timeout while a
    // newly published daily snapshot is becoming available. Share two retries
    // across the entire date-probe phase so recovery is useful but the maximum
    // request count remains deterministic (10 probes + 2 retries + 20 pages).
    let remainingProbeRetries = 2;
    for (const candidate of recentSeoulBusinessDates(anchor, 10, 21)) {
      let probe: Awaited<ReturnType<typeof dataGoJson>>;
      for (;;) {
        requestCount += 1;
        try {
          probe = await dataGoJson(apiKey, FINANCIAL_COMPANY_ENDPOINT, {
            resultType: "json",
            pageNo: "1",
            numOfRows: "1",
            basDt: candidate,
          }, "ServiceKey", 15_000);
          break;
        } catch (error) {
          if (!retryableProviderTransportFailure(error) || remainingProbeRetries <= 0) throw error;
          remainingProbeRetries -= 1;
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
        }
      }
      if (!probe.items.length) continue;
      const observedDates = new Set(probe.items.map((item) => (
        pick(item, ["basDt", "baseDate", "기준일자"], 20).replace(/[^0-9]/gu, "")
      )));
      if (!observedDates.has(candidate)) {
        throw new UpstreamError(502, "financial_company_date_filter_ignored");
      }
      latestBaseDate = candidate;
      break;
    }
    if (!latestBaseDate) {
      throw new UpstreamError(503, "financial_company_recent_snapshot_unavailable");
    }
    let coverage: PagedRows;
    try {
      coverage = await dataGoJsonPages({
        apiKey,
        endpoint: FINANCIAL_COMPANY_ENDPOINT,
        params: {
          resultType: "json",
          ...(latestBaseDate ? { basDt: latestBaseDate } : {}),
        },
        keyParameter: "ServiceKey",
        pageSize: 100,
        maxPages: GENERIC_DATA_GO_MAX_PAGES,
        timeoutMs: 15_000,
      });
      requestCount += coverage.requestCount;
    } catch (error) {
      if (error instanceof UpstreamError) requestCount += error.requestCount;
      throw error;
    }
    if (coverage.items.some((item) => (
      pick(item, ["basDt", "baseDate", "기준일자"], 20).replace(/[^0-9]/gu, "") !== latestBaseDate
    ))) {
      throw new UpstreamError(502, "financial_company_date_filter_ignored");
    }
    const normalized = discoveredItems(coverage.items.flatMap((item, index) => {
      const name = pick(item, ["fncoNm", "fncoName", "corpNm", "금융회사명"]);
      if (!name) return [];
      const corporationNumber = pick(item, ["crno", "corpRegNo"]);
      const type = pick(item, ["fncoTypeNm", "fncoDcdNm", "업권명"]);
      return [{
        id: `company-${stablePart(corporationNumber, `${name}-${index}`)}`,
        category: "finance" as const,
        title: name,
        summary: type || "금융회사 기본정보",
        source: "금융위원회 금융회사기본정보",
        sourceUrl: SOURCE_URLS.company,
        publishedAt: normalizeDate(item.basDt),
        tags: ["금융회사", type].filter(Boolean),
      }];
    }), previous, nowIso);
    if (!normalized.length) throw new UpstreamError(502, "financial_company_empty");
    return {
      ...empty,
      source: sourceWithCoverage("financial-company", "금융위원회 금융회사 기본정보", SOURCE_URLS.company, normalized.length, coverage),
      items: normalized,
      asOf: normalized[0]?.publishedAt ?? null,
      requestCount,
    };
  } catch (error) {
    return { ...empty, requestCount, failureKind: sourceFailureKind(error), source: { ...source("financial-company", "금융위원회 금융회사 기본정보", sourceStatus(error), SOURCE_URLS.company), errorCode: sourceErrorCode(error) } };
  }
}

async function loanAdapter(apiKey: string | null, nowIso: string, previous: Map<string, PublicInformationItem>): Promise<AdapterResult> {
  const empty: AdapterResult = {
    source: source("loan-product", "서민금융진흥원 대출상품", "not-configured", SOURCE_URLS.loan),
    items: [], market: [], exchange: [], asOf: null,
  };
  if (!apiKey) return empty;
  try {
    const coverage = await dataGoJsonPages({
      apiKey,
      endpoint: LOAN_PRODUCT_ENDPOINT,
      params: {},
      pageSize: 100,
      maxPages: GENERIC_DATA_GO_MAX_PAGES,
      timeoutMs: 15_000,
    });
    const normalized = discoveredItems(coverage.items.flatMap((item, index) => {
      const name = pick(item, ["finPrdNm", "finprdnm", "loanProductName", "상품명", "상품명칭", "prodNm"]);
      if (!name) return [];
      const institution = pick(item, ["fnceInstNm", "ofrinstnm", "financialInstitutionName", "기관명", "금융기관명"]);
      const target = pick(item, ["sprtTrgtCn", "trgt", "suprtgtdtlcond", "지원대상", "대상", "target"]);
      const joined = `${name} ${target}`;
      const category: PublicInformationCategory = YOUTH_WORDS.some((word) => joined.includes(word)) ? "youth" : "finance";
      return [{
        id: `loan-${stablePart(item.finPrdCd ?? item.productCode ?? item.seq, `${name}-${index}`)}`,
        category,
        title: name,
        summary: [institution, target].filter(Boolean).join(" · ") || "공공 금융지원 상품정보",
        source: "서민금융진흥원 대출상품한눈에",
        sourceUrl: SOURCE_URLS.loan,
        publishedAt: normalizeDate(item.basDt ?? item.regDt ?? item.등록일),
        tags: category === "youth"
          ? ["청년", "금융지원", "section:financial-support", "전국", institution].filter(Boolean)
          : ["금융지원", institution].filter(Boolean),
        ...(category === "youth" ? {
          // This source exposes an explicit support-target field. The adapter
          // uses that provider fact only to route youth-labelled products to
          // members who selected financial support as an interest; it does not
          // infer age, income, or final eligibility from the prose.
          youthPolicyEligibility: {
            regionScope: "nationwide" as const,
            interests: ["finance" as const],
          },
        } : {}),
      }];
    }), previous, nowIso);
    if (!normalized.length) throw new UpstreamError(502, "loan_product_empty");
    return {
      ...empty,
      source: sourceWithCoverage("loan-product", "서민금융진흥원 대출상품", SOURCE_URLS.loan, normalized.length, coverage),
      items: normalized,
      asOf: normalized.find((item) => item.publishedAt)?.publishedAt ?? null,
      requestCount: coverage.requestCount,
    };
  } catch (error) {
    return { ...empty, failureKind: sourceFailureKind(error), source: { ...source("loan-product", "서민금융진흥원 대출상품", sourceStatus(error), SOURCE_URLS.loan), errorCode: sourceErrorCode(error) } };
  }
}

async function commercialAreaAdapter(apiKey: string | null, nowIso: string, previous: Map<string, PublicInformationItem>): Promise<AdapterResult> {
  const empty: AdapterResult = {
    source: source("commercial-area", "소상공인 행정구역별 주요상권", "not-configured", SOURCE_URLS.commercial),
    items: [], market: [], exchange: [], asOf: null,
  };
  if (!apiKey) return empty;
  let requestCount = 0;
  try {
    const provinceCodes = [
      "11", "26", "27", "28", "29", "30", "31", "36", "41",
      "51", "43", "44", "52", "46", "47", "48", "50",
    ] as const;
    const queryProvincePage = async (provinceCode: string, pageNo: number) => {
      requestCount += 1;
      return dataGoJson(apiKey, COMMERCIAL_AREA_ENDPOINT, {
        divId: "ctprvnCd",
        key: provinceCode,
        pageNo: String(pageNo),
        numOfRows: String(COMMERCIAL_AREA_PAGE_SIZE),
        type: "json",
      });
    };
    const queryProvince = async (provinceCode: string) => {
      const firstPage = await queryProvincePage(provinceCode, 1);
      if (!firstPage.totalCountProvided) {
        if (firstPage.items.length >= COMMERCIAL_AREA_PAGE_SIZE) {
          throw new UpstreamError(502, "commercial_area_total_count_missing");
        }
        return { items: firstPage.items, expectedCount: firstPage.items.length };
      }
      const plan = commercialAreaPagePlan(firstPage.totalCount);
      if (!plan.complete) throw new UpstreamError(502, "commercial_area_page_limit");
      const pages = [firstPage];
      for (let pageNo = 2; pageNo <= plan.requiredPages; pageNo += 1) {
        const page = await queryProvincePage(provinceCode, pageNo);
        if (!page.totalCountProvided || page.totalCount !== firstPage.totalCount) {
          throw new UpstreamError(502, "commercial_area_total_count_changed");
        }
        pages.push(page);
      }
      const items = pages.flatMap((page) => page.items);
      if (items.length !== firstPage.totalCount) {
        throw new UpstreamError(502, "commercial_area_incomplete");
      }
      return { items, expectedCount: firstPage.totalCount };
    };

    // Validate the key and service authorization once before spending another
    // 16 province requests on an invalid or still-pending credential.
    const first = await queryProvince(provinceCodes[0]);
    const remaining = await mapWithConcurrency(provinceCodes.slice(1), 4, async (provinceCode) => {
      try {
        return { ok: true as const, result: await queryProvince(provinceCode) };
      } catch (error) {
        return { ok: false as const, error };
      }
    });
    const failedProvince = remaining.find((outcome) => !outcome.ok);
    if (failedProvince && !failedProvince.ok) throw failedProvince.error;
    const provinceResults = [
      first,
      ...remaining.flatMap((outcome) => outcome.ok ? [outcome.result] : []),
    ];
    const expectedCount = provinceResults.reduce((sum, result) => sum + result.expectedCount, 0);
    const items = provinceResults.flatMap((result) => result.items);
    const seenZones = new Set<string>();
    const normalizedRows = items.flatMap((item) => {
      const name = pick(item, ["mainTrarNm"]);
      if (!name) return [];
      const zoneNumber = pick(item, ["trarNo"]);
      const province = pick(item, ["ctprvnNm"]);
      const city = pick(item, ["signguNm"]);
      const stableZone = stablePart(zoneNumber, `${province}-${city}-${name}`);
      if (seenZones.has(stableZone)) return [];
      seenZones.add(stableZone);
      const district = [province, city].filter(Boolean).join(" ");
      const rawArea = optionalFiniteNumber(item.trarArea);
      const areaSquareMeters = rawArea !== null && rawArea > 0 ? rawArea : null;
      const referenceDate = normalizeDate(item.stdrDt);
      const rawCoordinateCount = optionalFiniteNumber(item.coordNum);
      const coordinateCount = rawCoordinateCount !== null
        && Number.isSafeInteger(rawCoordinateCount)
        && rawCoordinateCount >= 0
        ? rawCoordinateCount
        : null;
      const center = centerOfCommercialPolygon(item.coords);
      const displayBoundary = displayCommercialBoundary(item.coords);
      const locationLabel = district || "대한민국";
      const location: PublicInformationLocation = {
        label: locationLabel,
        ...(province ? { province } : {}),
        ...(city ? { city } : {}),
        ...(center ? { latitude: center.latitude, longitude: center.longitude } : {}),
        precision: center ? "point" : "administrative",
      };
      return [{
        id: `commercial-${stableZone}`,
        category: "startup" as const,
        title: name,
        summary: [
          district,
          areaSquareMeters === null ? "" : `${Math.round(areaSquareMeters).toLocaleString("ko-KR")}㎡`,
          "행정구역 단위 주요상권",
        ].filter(Boolean).join(" · "),
        source: "소상공인시장진흥공단 주요상권정보",
        sourceUrl: SOURCE_URLS.commercial,
        sourceLinkKind: "dataset" as const,
        publishedAt: referenceDate,
        tags: ["주요상권", province, city].filter(Boolean),
        location,
        commercialArea: {
          areaSquareMeters,
          referenceDate,
          coordinateCount,
          ...(displayBoundary ? { displayBoundary } : {}),
        },
      }];
    });
    if (normalizedRows.length !== expectedCount) {
      throw new UpstreamError(502, "commercial_area_incomplete");
    }
    // The full provider result is validated above, then only a deterministic
    // province-level directory is retained. Area is a selection aid for this
    // national boundary source and never becomes a sales ranking.
    const retainedRows = retainNationalCommercialAreas(normalizedRows);
    const normalized = discoveredItems(retainedRows, previous, nowIso);
    if (!normalized.length) throw new UpstreamError(502, "commercial_area_empty");
    const latestReferenceDate = normalized
      .map((item) => item.commercialArea?.referenceDate ?? null)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
    return {
      ...empty,
      source: source("commercial-area", "소상공인 행정구역별 주요상권", "live", SOURCE_URLS.commercial, normalized.length),
      items: normalized,
      asOf: latestReferenceDate,
      requestCount,
    };
  } catch (error) {
    return {
      ...empty,
      requestCount,
      failureKind: sourceFailureKind(error),
      source: { ...source("commercial-area", "소상공인 행정구역별 주요상권", sourceStatus(error), SOURCE_URLS.commercial), errorCode: sourceErrorCode(error) },
    };
  }
}

async function kosafAdapter(
  apiKey: string | null,
  kind: "high" | "university",
  nowIso: string,
  previous: Map<string, PublicInformationItem>,
): Promise<AdapterResult> {
  const isHigh = kind === "high";
  const sourceUrl = isHigh ? SOURCE_URLS.kosafHigh : SOURCE_URLS.kosafUniversity;
  const label = isHigh ? "한국장학재단 고등학생 학자금지원" : "한국장학재단 대학생 학자금지원";
  const empty: AdapterResult = {
    source: source(`kosaf-${kind}`, label, "not-configured", sourceUrl),
    items: [], market: [], exchange: [], asOf: null,
  };
  if (!apiKey) return empty;
  try {
    const endpoint = await latestKosafEndpoint(kind);
    const coverage = await odCloudJson(apiKey, endpoint);
    const normalized = discoveredItems(normalizeKosafRows(coverage.items, kind), previous, nowIso);
    if (!normalized.length) throw new UpstreamError(502, `kosaf_${kind}_empty`);
    return {
      ...empty,
      source: sourceWithCoverage(`kosaf-${kind}`, label, sourceUrl, normalized.length, coverage),
      items: normalized,
      asOf: normalized.find((item) => item.publishedAt)?.publishedAt ?? null,
      requestCount: coverage.requestCount,
    };
  } catch (error) {
    return { ...empty, failureKind: sourceFailureKind(error), source: { ...source(`kosaf-${kind}`, label, sourceStatus(error), sourceUrl), errorCode: sourceErrorCode(error) } };
  }
}

async function ecosAdapter(
  apiKey: string | null,
  nowIso: string,
  previous: Map<string, PublicInformationItem>,
): Promise<AdapterResult> {
  const empty: AdapterResult = {
    source: source("ecos", "한국은행 ECOS 주요지표", "not-configured", SOURCE_URLS.ecos),
    items: [], market: [], exchange: [], asOf: null,
  };
  if (!apiKey) return empty;
  try {
    const endpoint = new URL(`${ECOS_ENDPOINT}/${encodeURIComponent(apiKey)}/json/kr/1/100`);
    const payload = await fetchJson(endpoint);
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      const providerResult = (payload as Record<string, unknown>).RESULT;
      if (providerResult && typeof providerResult === "object" && !Array.isArray(providerResult)) {
        const code = text((providerResult as Record<string, unknown>).CODE, 30);
        if (code && code !== "INFO-000") {
          throw new UpstreamError(code === "INFO-100" ? 403 : 502, `ecos_${code}`);
        }
      }
    }
    const rows = objectRows(payload, "KeyStatisticList");
    if (!rows.length) throw new UpstreamError(502, "ecos_empty");
    const preferred = rows.filter((item) => {
      const label = pick(item, ["KEYSTAT_NAME", "CLASS_NAME"]);
      return /기준금리|시장금리|예금금리|대출금리|소비자물가/u.test(label);
    });
    const normalized = discoveredItems((preferred.length ? preferred : rows).slice(0, 8).flatMap((item, index) => {
      const name = pick(item, ["KEYSTAT_NAME", "CLASS_NAME"]);
      const value = pick(item, ["DATA_VALUE"]);
      if (!name || !value) return [];
      const unit = pick(item, ["UNIT_NAME"]);
      const cycle = pick(item, ["CYCLE"]);
      return [{
        id: `ecos-${stablePart(name, String(index))}`,
        category: "finance" as const,
        title: name,
        summary: [value + (unit ? ` ${unit}` : ""), cycle].filter(Boolean).join(" · "),
        source: "한국은행 경제통계시스템 ECOS",
        sourceUrl: SOURCE_URLS.ecos,
        publishedAt: normalizeDate(cycle),
        tags: ["경제지표", pick(item, ["CLASS_NAME"])].filter(Boolean),
      }];
    }), previous, nowIso);
    if (!normalized.length) throw new UpstreamError(502, "ecos_shape");
    return {
      ...empty,
      source: source("ecos", "한국은행 ECOS 주요지표", "live", SOURCE_URLS.ecos, normalized.length),
      items: normalized,
      asOf: normalized.find((item) => item.publishedAt)?.publishedAt ?? null,
    };
  } catch (error) {
    return { ...empty, failureKind: sourceFailureKind(error), source: { ...source("ecos", "한국은행 ECOS 주요지표", sourceStatus(error), SOURCE_URLS.ecos), errorCode: sourceErrorCode(error) } };
  }
}

function finlifePayloadItems(payload: unknown, kind: "deposit" | "saving") {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new UpstreamError(502, "finlife_shape");
  }
  const result = (payload as Record<string, unknown>).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new UpstreamError(502, "finlife_shape");
  }
  const body = result as Record<string, unknown>;
  const errorCode = text(body.err_cd, 20);
  if (errorCode && errorCode !== "000") {
    throw new UpstreamError(errorCode.startsWith("01") ? 403 : 502, `finlife_${errorCode}`);
  }
  const options = recordArray(body.optionList);
  const maxPage = Math.max(1, Math.trunc(optionalFiniteNumber(body.max_page_no) ?? 1));
  return {
    rows: recordArray(body.baseList).map((item) => ({ item, options, kind })),
    maxPage,
  };
}

async function finlifeAdapter(
  apiKey: string | null,
  nowIso: string,
  previous: Map<string, PublicInformationItem>,
): Promise<AdapterResult> {
  const empty: AdapterResult = {
    source: source("finlife", "금융감독원 금융상품 한눈에", "not-configured", SOURCE_URLS.finlife),
    items: [], market: [], exchange: [], asOf: null,
  };
  if (!apiKey) return empty;
  let requestCount = 0;
  try {
    const buildEndpoint = (base: string, page: number) => {
      const endpoint = new URL(base);
      endpoint.searchParams.set("auth", apiKey);
      endpoint.searchParams.set("topFinGrpNo", "020000");
      endpoint.searchParams.set("pageNo", String(page));
      return endpoint;
    };
    const fetchKind = async (base: string, kind: "deposit" | "saving") => {
      const rows: ReturnType<typeof finlifePayloadItems>["rows"] = [];
      let maxPage = 1;
      for (let page = 1; page <= Math.min(maxPage, FINLIFE_MAX_PAGES_PER_KIND); page += 1) {
        requestCount += 1;
        const parsed = finlifePayloadItems(await fetchJson(buildEndpoint(base, page)), kind);
        maxPage = parsed.maxPage;
        rows.push(...parsed.rows);
      }
      return { rows, maxPage };
    };
    const settled = await Promise.allSettled([
      fetchKind(FINLIFE_DEPOSIT_ENDPOINT, "deposit"),
      fetchKind(FINLIFE_SAVING_ENDPOINT, "saving"),
    ]);
    const successful = settled.flatMap((result) => (
      result.status === "fulfilled" ? result.value.rows : []
    ));
    if (!successful.length) {
      const failure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      throw failure?.reason ?? new UpstreamError(502, "finlife_empty");
    }
    const normalized = discoveredItems(
      successful
        .flatMap(({ item, options, kind }, index) => {
          const productCode = pick(item, ["fin_prdt_cd"]);
          const companyCode = pick(item, ["fin_co_no"]);
          const name = pick(item, ["fin_prdt_nm"]);
          const company = pick(item, ["kor_co_nm"]);
          if (!name || !company) return [];
          const matchingOptions = options.filter((option) => (
            pick(option, ["fin_prdt_cd"]) === productCode && pick(option, ["fin_co_no"]) === companyCode
          ));
          const bestRate = matchingOptions.reduce<number | null>((best, option) => {
            const rate = optionalFiniteNumber(option.intr_rate2 ?? option.intr_rate);
            return rate === null ? best : best === null || rate > best ? rate : best;
          }, null);
          const disclosureMonth = pick(item, ["dcls_month"]);
          const monthDigits = disclosureMonth.replace(/[^0-9]/gu, "");
          const terms = matchingOptions.map((option) => ({
            termMonths: optionalFiniteNumber(option.save_trm),
            baseRate: optionalFiniteNumber(option.intr_rate),
            maximumRate: optionalFiniteNumber(option.intr_rate2),
            rateType: pick(option, ["intr_rate_type_nm"]) || null,
          })).sort((left, right) => (left.termMonths ?? Number.MAX_SAFE_INTEGER) - (right.termMonths ?? Number.MAX_SAFE_INTEGER));
          return [{
            id: `finlife-${kind}-${stablePart(companyCode, company)}-${stablePart(productCode, `${name}-${index}`)}`,
            category: "finance" as const,
            title: `${company} · ${name}`,
            summary: [kind === "deposit" ? "예금" : "적금", bestRate === null ? "" : `공시 최고금리 ${bestRate}%`, pick(item, ["join_member"])].filter(Boolean).join(" · "),
            source: "금융감독원 금융상품 한눈에",
            sourceUrl: SOURCE_URLS.finlife,
            publishedAt: monthDigits.length >= 6 ? `${monthDigits.slice(0, 4)}-${monthDigits.slice(4, 6)}-01` : null,
            tags: [kind === "deposit" ? "예금" : "적금", pick(item, ["join_way"])].filter(Boolean),
            financialProduct: {
              kind,
              provider: company,
              productName: name,
              productCode,
              joinMethods: list(item.join_way),
              eligibility: pick(item, ["join_member"]) || null,
              specialConditions: pick(item, ["spcl_cnd"]) || null,
              terms,
            },
          }];
        }),
      previous,
      nowIso,
    );
    if (!normalized.length) throw new UpstreamError(502, "finlife_product_empty");
    const fulfilled = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const truncated = fulfilled.some((result) => result.maxPage > FINLIFE_MAX_PAGES_PER_KIND);
    const partial = settled.some((result) => result.status === "rejected");
    const coverage: PagedRows = {
      items: [],
      totalCount: null,
      fetchedCount: successful.length,
      requestCount,
      completeness: partial ? "partial" : truncated ? "truncated" : "complete",
    };
    return {
      ...empty,
      source: sourceWithCoverage("finlife", "금융감독원 금융상품 한눈에", SOURCE_URLS.finlife, normalized.length, coverage),
      items: normalized,
      asOf: normalized.find((item) => item.publishedAt)?.publishedAt ?? null,
      requestCount,
    };
  } catch (error) {
    return { ...empty, requestCount, failureKind: sourceFailureKind(error), source: { ...source("finlife", "금융감독원 금융상품 한눈에", sourceStatus(error), SOURCE_URLS.finlife), errorCode: sourceErrorCode(error) } };
  }
}

async function dartAdapterLegacy(
  apiKey: string | null,
  nowIso: string,
  previous: Map<string, PublicInformationItem>,
): Promise<AdapterResult> {
  const empty: AdapterResult = {
    source: source("dart", "금융감독원 OpenDART 공시", "not-configured", SOURCE_URLS.dart),
    items: [], market: [], exchange: [], asOf: null,
  };
  if (!apiKey) return empty;
  let requestCount = 0;
  try {
    const hasPriorArchive = [...previous.keys()].some((id) => id.startsWith("dart-"));
    const rows: Record<string, unknown>[] = [];
    let totalCount: number | null = null;
    let totalPages = 1;
    let completeness: PagedRows["completeness"] = "complete";
    for (let page = 1; page <= Math.min(totalPages, DART_MAX_PAGES); page += 1) {
      const endpoint = new URL(DART_DISCLOSURE_ENDPOINT);
      endpoint.searchParams.set("crtfc_key", apiKey);
      endpoint.searchParams.set("bgn_de", daysAgo(hasPriorArchive ? 2 : 30));
      endpoint.searchParams.set("end_de", compactDate(new Date()));
      endpoint.searchParams.set("page_no", String(page));
      endpoint.searchParams.set("page_count", String(DART_PAGE_COUNT));
      endpoint.searchParams.set("sort", "date");
      endpoint.searchParams.set("sort_mth", "desc");
      requestCount += 1;
      let payload: unknown;
      try {
        payload = await fetchDartJson(endpoint);
      } catch (error) {
        if (!rows.length) throw error;
        completeness = "partial";
        break;
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new UpstreamError(502, "dart_shape");
      }
      const body = payload as Record<string, unknown>;
      const status = text(body.status, 20);
      if (status === "013" && page === 1) {
        return {
          ...empty,
          source: {
            ...source("dart", "금융감독원 OpenDART 공시", "live", SOURCE_URLS.dart, 0),
            providerTotalCount: 0,
            fetchedCount: 0,
            completeness: "complete",
          },
          requestCount,
          incremental: hasPriorArchive,
        };
      }
      if (status && status !== "000") {
        const errorStatus = ["010", "011", "012"].includes(status) ? 403 : status === "020" ? 429 : 502;
        throw new UpstreamError(errorStatus, `dart_${status}`);
      }
      const advertisedPages = optionalFiniteNumber(body.total_page);
      const advertisedTotal = optionalFiniteNumber(body.total_count);
      if (advertisedPages !== null) totalPages = Math.max(1, Math.trunc(advertisedPages));
      if (advertisedTotal !== null) totalCount = Math.max(0, Math.trunc(advertisedTotal));
      rows.push(...recordArray(body.list));
    }
    if (completeness === "complete" && totalPages > DART_MAX_PAGES) completeness = "truncated";
    const coverage: PagedRows = {
      items: rows,
      totalCount,
      fetchedCount: rows.length,
      requestCount,
      completeness,
    };
    const normalized = discoveredItems(rows.flatMap((item, index) => {
      const receipt = pick(item, ["rcept_no"]);
      const company = pick(item, ["corp_name"]);
      const report = pick(item, ["report_nm"]);
      if (!receipt || !company || !report) return [];
      return [{
        id: `dart-${stablePart(receipt, String(index))}`,
        category: "finance" as const,
        title: `${company} · ${report}`,
        summary: [pick(item, ["flr_nm"]), pick(item, ["rm"])].filter(Boolean).join(" · ") || "최근 전자공시",
        source: "금융감독원 OpenDART",
        sourceUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receipt)}`,
        sourceLinkKind: "detail" as const,
        publishedAt: normalizeDate(item.rcept_dt),
        tags: ["공시", pick(item, ["corp_cls"])].filter(Boolean),
      }];
    }), previous, nowIso);
    if (!normalized.length) throw new UpstreamError(502, "dart_empty");
    return {
      ...empty,
      source: sourceWithCoverage("dart", "금융감독원 OpenDART 공시", SOURCE_URLS.dart, normalized.length, coverage),
      items: normalized,
      asOf: normalized[0]?.publishedAt ?? null,
      requestCount,
      incremental: hasPriorArchive,
    };
  } catch (error) {
    return { ...empty, requestCount, failureKind: sourceFailureKind(error), source: { ...source("dart", "금융감독원 OpenDART 공시", sourceStatus(error), SOURCE_URLS.dart), errorCode: sourceErrorCode(error) } };
  }
}

type DartPage = {
  rows: Record<string, unknown>[];
  totalPages: number;
  totalCount: number;
};

function shortSignature(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function dartQueryIdentity(beginDate: string, endDate: string) {
  const queryState = JSON.stringify({
    version: 2,
    endpoint: DART_DISCLOSURE_ENDPOINT,
    beginDate,
    endDate,
    pageSize: DART_PAGE_COUNT,
    sort: "date:desc",
  });
  return {
    queryState,
    querySignature: `dart-v1-${shortSignature(queryState)}`,
  };
}

function storedDartIdentity(checkpoint: PublicBackfillCheckpoint | null) {
  if (!checkpoint || checkpoint.sourceId !== "dart" || checkpoint.pageSize !== DART_PAGE_COUNT) {
    return null;
  }
  try {
    const state = JSON.parse(checkpoint.queryState) as {
      beginDate?: unknown;
      endDate?: unknown;
    };
    const beginDate = typeof state.beginDate === "string" ? state.beginDate : "";
    const endDate = typeof state.endDate === "string" ? state.endDate : "";
    if (!/^\d{8}$/u.test(beginDate) || !/^\d{8}$/u.test(endDate)) return null;
    const identity = dartQueryIdentity(beginDate, endDate);
    return checkpoint.querySignature === identity.querySignature
      && checkpoint.queryState === identity.queryState
      ? { beginDate, endDate, identity }
      : null;
  } catch {
    return null;
  }
}

async function fetchDartPage(input: {
  apiKey: string;
  beginDate: string;
  endDate: string;
  page: number;
}) {
  const endpoint = new URL(DART_DISCLOSURE_ENDPOINT);
  endpoint.searchParams.set("crtfc_key", input.apiKey);
  endpoint.searchParams.set("bgn_de", input.beginDate);
  endpoint.searchParams.set("end_de", input.endDate);
  endpoint.searchParams.set("page_no", String(input.page));
  endpoint.searchParams.set("page_count", String(DART_PAGE_COUNT));
  endpoint.searchParams.set("sort", "date");
  endpoint.searchParams.set("sort_mth", "desc");
  const payload = await fetchDartJson(endpoint);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new UpstreamError(502, "dart_shape");
  }
  const body = payload as Record<string, unknown>;
  const status = text(body.status, 20);
  if (status === "013") return { rows: [], totalPages: 0, totalCount: 0 } satisfies DartPage;
  if (status && status !== "000") {
    const errorStatus = ["010", "011", "012"].includes(status)
      ? 403
      : status === "020"
        ? 429
        : 502;
    throw new UpstreamError(errorStatus, `dart_${status}`);
  }
  return {
    rows: recordArray(body.list),
    totalPages: Math.max(1, Math.trunc(optionalFiniteNumber(body.total_page) ?? 1)),
    totalCount: Math.max(0, Math.trunc(optionalFiniteNumber(body.total_count) ?? 0)),
  } satisfies DartPage;
}

function normalizeDartItems(
  rows: readonly Record<string, unknown>[],
  previous: Map<string, PublicInformationItem>,
  nowIso: string,
) {
  return discoveredItems(rows.flatMap((item, index) => {
    const receipt = pick(item, ["rcept_no"]);
    const company = pick(item, ["corp_name"]);
    const report = pick(item, ["report_nm"]);
    if (!receipt || !company || !report) return [];
    return [{
      id: `dart-${stablePart(receipt, String(index))}`,
      category: "finance" as const,
      title: `${company} · ${report}`,
      summary: [pick(item, ["flr_nm"]), pick(item, ["rm"])].filter(Boolean).join(" · ") || "최근 전자공시",
      source: "금융감독원 OpenDART",
      sourceUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(receipt)}`,
      sourceLinkKind: "detail" as const,
      publishedAt: normalizeDate(item.rcept_dt),
      tags: ["공시", pick(item, ["corp_cls"])].filter(Boolean),
    }];
  }), previous, nowIso);
}

async function dartAdapter(
  apiKey: string | null,
  nowIso: string,
  previous: Map<string, PublicInformationItem>,
  backfill?: PublicBackfillRuntime,
): Promise<AdapterResult> {
  if (!backfill) return dartAdapterLegacy(apiKey, nowIso, previous);
  const empty: AdapterResult = {
    source: source("dart", "금융감독원 OpenDART 공시", "not-configured", SOURCE_URLS.dart),
    items: [], market: [], exchange: [], asOf: null,
  };
  if (!apiKey) return empty;
  let requestCount = 0;
  try {
    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) throw new UpstreamError(500, "dart_invalid_now");
    const beginDate = compactDate(new Date(now - 30 * 24 * 60 * 60 * 1_000));
    const endDate = compactDate(new Date(now));
    const identity = dartQueryIdentity(beginDate, endDate);
    const storedIdentity = storedDartIdentity(backfill.checkpoint);
    const stored = storedIdentity
      && storedIdentity.identity.querySignature === identity.querySignature
      && storedIdentity.identity.queryState === identity.queryState
      ? backfill.checkpoint
      : null;
    let checkpoint: PublicBackfillCheckpoint = stored
      ? { ...stored, latestRefreshAt: now, updatedAt: now }
      : {
          sourceId: "dart",
          ...identity,
          nextPage: 1,
          pageSize: DART_PAGE_COUNT,
          providerTotalCount: null,
          fetchedCount: 0,
          completed: false,
          latestRefreshAt: now,
          completedAt: null,
          updatedAt: now,
        };
    const byId = new Map((stored ? backfill.stagedItems : [])
      .filter((item) => item.id.startsWith("dart-"))
      .map((item) => [item.id, item]));

    const latestBeginDate = compactDate(new Date(now - 2 * 24 * 60 * 60 * 1_000));
    const latestEndDate = compactDate(new Date(now));
    const latestRows: Record<string, unknown>[] = [];
    let latestPages = 1;
    for (let page = 1; page <= Math.min(latestPages, 2); page += 1) {
      requestCount += 1;
      const latest = await fetchDartPage({
        apiKey,
        beginDate: latestBeginDate,
        endDate: latestEndDate,
        page,
      });
      if (page === 1) latestPages = latest.totalPages;
      latestRows.push(...latest.rows);
    }
    const latestItems = normalizeDartItems(latestRows, previous, nowIso);
    for (const item of latestItems) byId.set(item.id, item);
    try {
      await backfill.commitPage({ checkpoint, pageNumber: 0, items: latestItems });
    } catch {
      throw new UpstreamError(500, "dart_checkpoint_commit_failed");
    }

    let partialError: unknown = null;
    const maximumPages = Math.min(
      DART_MAX_PAGES - 1,
      Math.max(1, Math.trunc(backfill.maxBackfillPagesPerRun)),
    );
    const firstPage = checkpoint.nextPage;
    for (
      let page = firstPage;
      !checkpoint.completed && page < firstPage + maximumPages;
      page += 1
    ) {
      try {
        requestCount += 1;
        const historical = await fetchDartPage({
          apiKey,
          beginDate,
          endDate,
          page,
        });
        const items = normalizeDartItems(historical.rows, previous, nowIso);
        const completed = historical.totalPages === 0 || page >= historical.totalPages;
        checkpoint = {
          ...checkpoint,
          nextPage: page + 1,
          providerTotalCount: historical.totalCount,
          fetchedCount: Math.min(
            historical.totalCount,
            Math.max(checkpoint.fetchedCount, page * DART_PAGE_COUNT),
          ),
          completed,
          completedAt: completed ? now : null,
          latestRefreshAt: now,
          updatedAt: now,
        };
        await backfill.commitPage({ checkpoint, pageNumber: page, items });
        for (const item of items) byId.set(item.id, item);
      } catch (error) {
        partialError = error instanceof UpstreamError
          ? error
          : new UpstreamError(500, "dart_checkpoint_commit_failed");
        break;
      }
    }

    const items = [...byId.values()];
    const completeness: PagedRows["completeness"] = partialError
      ? "partial"
      : checkpoint.completed
        ? "complete"
        : "truncated";
    const coverage: PagedRows = {
      items: [],
      totalCount: checkpoint.providerTotalCount,
      fetchedCount: checkpoint.fetchedCount,
      requestCount,
      completeness,
    };
    return {
      ...empty,
      source: {
        ...sourceWithCoverage(
          "dart",
          "금융감독원 OpenDART 공시",
          SOURCE_URLS.dart,
          items.length,
          coverage,
        ),
        ...(partialError
          ? { errorCode: sourceErrorCode(partialError) }
          : checkpoint.completed
            ? {}
            : { errorCode: "dart_backfill_in_progress" }),
      },
      items,
      asOf: items.map((item) => item.publishedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
      requestCount,
      incremental: true,
      ...(partialError ? { failureKind: sourceFailureKind(partialError) } : {}),
    };
  } catch (error) {
    return {
      ...empty,
      requestCount,
      failureKind: sourceFailureKind(error),
      source: {
        ...source("dart", "금융감독원 OpenDART 공시", sourceStatus(error), SOURCE_URLS.dart),
        errorCode: sourceErrorCode(error),
      },
    };
  }
}

async function bizinfoAdapter(
  apiKey: string | null,
  nowIso: string,
  previous: Map<string, PublicInformationItem>,
  backfill?: PublicBackfillRuntime,
): Promise<AdapterResult> {
  const empty: AdapterResult = {
    source: source("bizinfo", "기업마당 창업 지원사업", "not-configured", SOURCE_URLS.bizinfo),
    items: [], market: [], exchange: [], asOf: null,
  };
  if (!apiKey) return empty;
  let requestCount = 0;
  try {
    const fetchPage = async (page: number) => {
      const endpoint = new URL(BIZINFO_ENDPOINT);
      endpoint.searchParams.set("crtfcKey", apiKey);
      endpoint.searchParams.set("dataType", "json");
      endpoint.searchParams.set("pageUnit", String(BIZINFO_PAGE_SIZE));
      endpoint.searchParams.set("pageIndex", String(page));
      endpoint.searchParams.set("searchLclasId", "06");
      requestCount += 1;
      return normalizeBizinfoPayload(await fetchJson(endpoint));
    };
    const normalizeRows = (
      rows: readonly Record<string, unknown>[],
      page: number,
    ) => discoveredItems(rows.flatMap((item, index) => {
      const title = pick(item, ["pblancNm", "title"]);
      const id = pick(item, ["pblancId", "seq"]);
      if (!title) return [];
      const fallbackUrl = SOURCE_URLS.bizinfo;
      const sourceUrl = safePublicHttpUrl(
        text(item.pblancUrl ?? item.link, 500),
        "https://www.bizinfo.go.kr/",
        ["bizinfo.go.kr"],
      ) ?? fallbackUrl;
      const absoluteIndex = (page - 1) * BIZINFO_PAGE_SIZE + index;
      return [{
        id: `bizinfo-${stablePart(id, `${title}-${absoluteIndex}`)}`,
        category: "startup" as const,
        title,
        summary: pick(item, ["bsnsSumryCn", "description", "trgetNm"]) || "중소기업·창업 지원사업 공고",
        source: "중소벤처기업부 기업마당",
        sourceUrl,
        sourceLinkKind: sourceUrl === fallbackUrl ? "dataset" as const : "detail" as const,
        publishedAt: normalizeDate(item.creatPnttm ?? item.pubDate),
        expiresAt: normalizeLatestDate(pick(item, [
          "reqstEndDe",
          "reqstEndDt",
          "reqstBeginEndDe",
          "reqstDt",
        ])),
        tags: ["창업지원", pick(item, ["jrsdInsttNm", "author"]), pick(item, ["reqstBeginEndDe", "reqstDt"])].filter(Boolean),
      }];
    }), previous, nowIso);

    if (!backfill) {
      const rows: Record<string, unknown>[] = [];
      let completeness: PagedRows["completeness"] = "truncated";
      for (let page = 1; page <= BIZINFO_MAX_PAGES; page += 1) {
        try {
          const pageRows = await fetchPage(page);
          rows.push(...pageRows);
          if (pageRows.length < BIZINFO_PAGE_SIZE) {
            completeness = "complete";
            break;
          }
        } catch (error) {
          if (!rows.length) throw error;
          completeness = "partial";
          break;
        }
      }
      const coverage: PagedRows = {
        items: rows,
        totalCount: completeness === "complete" ? rows.length : null,
        fetchedCount: rows.length,
        requestCount,
        completeness,
      };
      const normalized = normalizeRows(rows, 1);
      if (!normalized.length) throw new UpstreamError(502, "bizinfo_empty");
      return {
        ...empty,
        source: sourceWithCoverage("bizinfo", "기업마당 창업 지원사업", SOURCE_URLS.bizinfo, normalized.length, coverage),
        items: normalized,
        asOf: normalized.find((item) => item.publishedAt)?.publishedAt ?? null,
        requestCount,
      };
    }

    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) throw new UpstreamError(500, "bizinfo_invalid_now");
    const queryState = JSON.stringify({
      version: 2,
      generation: seoulDate(new Date(now)),
      endpoint: BIZINFO_ENDPOINT,
      pageSize: BIZINFO_PAGE_SIZE,
      parameters: {
        dataType: "json",
        searchLclasId: "06",
      },
    });
    let signatureHash = 0x811c9dc5;
    for (let index = 0; index < queryState.length; index += 1) {
      signatureHash ^= queryState.charCodeAt(index);
      signatureHash = Math.imul(signatureHash, 0x01000193);
    }
    const querySignature = `bizinfo-v1-${(signatureHash >>> 0).toString(16).padStart(8, "0")}`;
    let stored = backfill.checkpoint
      && backfill.checkpoint.sourceId === "bizinfo"
      && backfill.checkpoint.querySignature === querySignature
      && backfill.checkpoint.queryState === queryState
      && backfill.checkpoint.pageSize === BIZINFO_PAGE_SIZE
      ? backfill.checkpoint
      : null;
    const stagedById = new Map((stored ? backfill.stagedItems : [])
      .filter((item) => item.id.startsWith("bizinfo-")
        && !item.id.startsWith("bizinfo-data-go-"))
      .map((item) => [item.id, item]));

    const latestRows = await fetchPage(1);
    const latestItems = normalizeRows(latestRows, 1);
    if (latestRows.length > 0 && latestItems.length === 0) {
      throw new UpstreamError(502, "bizinfo_empty");
    }
    const latestProvesComplete = latestRows.length < BIZINFO_PAGE_SIZE;
    if (stored?.completed && !latestProvesComplete && Number(stored.providerTotalCount) < BIZINFO_PAGE_SIZE) {
      stored = null;
    }
    if (!stored || latestProvesComplete) stagedById.clear();
    for (const item of latestItems) stagedById.set(item.id, item);
    const completed = stored?.completed === true || latestProvesComplete;
    let checkpoint: PublicBackfillCheckpoint = {
      sourceId: "bizinfo",
      querySignature,
      queryState,
      nextPage: completed
        ? latestProvesComplete ? 2 : stored?.nextPage ?? 2
        : Math.max(2, stored?.nextPage ?? 2),
      pageSize: BIZINFO_PAGE_SIZE,
      providerTotalCount: latestProvesComplete
        ? latestRows.length
        : stored?.providerTotalCount ?? null,
      fetchedCount: latestProvesComplete
        ? latestRows.length
        : Math.max(latestRows.length, stored?.fetchedCount ?? 0),
      completed,
      latestRefreshAt: now,
      completedAt: completed ? stored?.completedAt ?? now : null,
      updatedAt: now,
    };
    try {
      await backfill.commitPage({
        checkpoint,
        pageNumber: stored && !latestProvesComplete ? 0 : 1,
        items: latestItems,
        resetGeneration: !stored || latestProvesComplete,
      });
    } catch {
      throw new UpstreamError(500, "bizinfo_checkpoint_commit_failed");
    }

    let partialError: unknown = null;
    const maximumPages = Math.min(
      BIZINFO_MAX_PAGES,
      Number.isFinite(backfill.maxBackfillPagesPerRun)
        ? Math.max(0, Math.trunc(backfill.maxBackfillPagesPerRun))
        : 0,
    );
    for (
      let processed = 0;
      !checkpoint.completed && processed < maximumPages;
      processed += 1
    ) {
      const page = checkpoint.nextPage;
      try {
        const pageRows = await fetchPage(page);
        const items = normalizeRows(pageRows, page);
        const pageProvesComplete = pageRows.length < BIZINFO_PAGE_SIZE;
        const nextCheckpoint: PublicBackfillCheckpoint = {
          ...checkpoint,
          nextPage: page + 1,
          providerTotalCount: pageProvesComplete
            ? (page - 1) * BIZINFO_PAGE_SIZE + pageRows.length
            : null,
          fetchedCount: Math.max(
            checkpoint.fetchedCount,
            (page - 1) * BIZINFO_PAGE_SIZE + pageRows.length,
          ),
          completed: pageProvesComplete,
          completedAt: pageProvesComplete ? now : null,
          latestRefreshAt: now,
          updatedAt: now,
        };
        await backfill.commitPage({
          checkpoint: nextCheckpoint,
          pageNumber: page,
          items,
        });
        checkpoint = nextCheckpoint;
        for (const item of items) stagedById.set(item.id, item);
      } catch (error) {
        partialError = error instanceof UpstreamError
          ? error
          : new UpstreamError(500, "bizinfo_checkpoint_commit_failed");
        break;
      }
    }

    const normalized = [...stagedById.values()];
    const completeness: PagedRows["completeness"] = partialError
      ? "partial"
      : checkpoint.completed
        ? "complete"
        : "truncated";
    const coverage: PagedRows = {
      items: [],
      totalCount: checkpoint.providerTotalCount,
      fetchedCount: checkpoint.fetchedCount,
      requestCount,
      completeness,
    };
    return {
      ...empty,
      source: {
        ...sourceWithCoverage(
          "bizinfo",
          "기업마당 창업 지원사업",
          SOURCE_URLS.bizinfo,
          normalized.length,
          coverage,
        ),
        ...(partialError
          ? { errorCode: sourceErrorCode(partialError) }
          : checkpoint.completed
            ? {}
            : { errorCode: "bizinfo_backfill_in_progress" }),
      },
      items: normalized,
      asOf: normalized
        .map((item) => item.publishedAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
      requestCount,
      incremental: true,
      ...(partialError ? { failureKind: sourceFailureKind(partialError) } : {}),
    };
  } catch (error) {
    return { ...empty, requestCount, failureKind: sourceFailureKind(error), source: { ...source("bizinfo", "기업마당 창업 지원사업", sourceStatus(error), SOURCE_URLS.bizinfo), errorCode: sourceErrorCode(error) } };
  }
}

async function seoulCommercialAdapter(
  apiKey: string | null,
  nowIso: string,
  previous: Map<string, PublicInformationItem>,
): Promise<AdapterResult> {
  const empty: AdapterResult = {
    source: source(
      "seoul-commercial",
      "서울시 상권분석서비스",
      "not-configured",
      SEOUL_COMMERCIAL_SOURCE_URLS.sales,
    ),
    items: [],
    market: [],
    exchange: [],
    asOf: null,
    requestCount: 0,
  };
  if (!apiKey) return empty;
  // The credential is an activation gate only. Never send it to Seoul's
  // HTTP-only Open API. A host-side importer downloads the official Sheet
  // CSVs for sales, footfall, and areas over HTTPS and atomically replaces
  // this full catalogue.
  const retained = [...previous.values()].filter((item) => item.id.startsWith("seoul-commercial-"));
  const coverage = seoulCommercialCatalogCoverage(retained);
  if (!retained.length) {
    return {
      ...empty,
      source: {
        ...source(
          "seoul-commercial",
          "서울시 상권분석서비스 공식 HTTPS Sheet CSV",
          "unavailable",
          SEOUL_COMMERCIAL_SOURCE_URLS.sales,
        ),
        errorCode: "seoul_https_snapshot_unavailable",
        providerTotalCount: null,
        fetchedCount: 0,
        completeness: "partial",
      },
      requestCount: 0,
    };
  }
  const complete = coverage.complete;
  return {
    ...empty,
    source: {
      ...source(
        "seoul-commercial",
        "서울시 상권분석서비스 공식 HTTPS Sheet CSV",
        complete ? "live" : "partial",
        SEOUL_COMMERCIAL_SOURCE_URLS.sales,
        retained.length,
      ),
      ...(complete ? {} : { errorCode: "seoul_https_snapshot_incomplete" }),
      providerTotalCount: complete ? retained.length : null,
      fetchedCount: retained.length,
      completeness: complete ? "complete" : "partial",
    },
    items: retained,
    asOf: retained
      .map((item) => item.publishedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? nowIso,
    requestCount: 0,
  };
}

const SEOUL_CATALOG_MIN_COMPLETE_AREAS = 1_500;
const SEOUL_CATALOG_MIN_SALES_COVERAGE = 0.9;
const SEOUL_CATALOG_MIN_FOOTFALL_COVERAGE = 0.99;

export function seoulCommercialCatalogCoverage(
  items: readonly PublicInformationItem[],
) {
  const retained = items.filter((item) => /^seoul-commercial-\d{7,10}$/u.test(item.id));
  const quarters = new Set<string>();
  let salesAreaCount = 0;
  let footfallAreaCount = 0;
  let invalidAnalyticsCount = 0;
  for (const item of retained) {
    const analytics = item.commercialArea?.analytics;
    if (!analytics || !/^20\d{2}[1-4]$/u.test(analytics.referenceQuarter)) {
      invalidAnalyticsCount += 1;
      continue;
    }
    quarters.add(analytics.referenceQuarter);
    if (
      analytics.estimatedTotalSales !== null
      && analytics.salesByHour.length === 6
    ) {
      salesAreaCount += 1;
    }
    if (analytics.footfallByHour.length === 6) {
      footfallAreaCount += 1;
    }
  }
  const areaCount = retained.length;
  const salesRatio = areaCount ? salesAreaCount / areaCount : 0;
  const footfallRatio = areaCount ? footfallAreaCount / areaCount : 0;
  return {
    areaCount,
    salesAreaCount,
    footfallAreaCount,
    salesRatio,
    footfallRatio,
    quarter: quarters.size === 1 ? [...quarters][0] : null,
    quarterCount: quarters.size,
    invalidAnalyticsCount,
    complete: areaCount >= SEOUL_CATALOG_MIN_COMPLETE_AREAS
      && quarters.size === 1
      && invalidAnalyticsCount === 0
      && salesRatio >= SEOUL_CATALOG_MIN_SALES_COVERAGE
      && footfallRatio >= SEOUL_CATALOG_MIN_FOOTFALL_COVERAGE,
  };
}

export const PUBLIC_DATA_SOURCE_IDS = [
  "exchange",
  "stock",
  "financial-company",
  "loan-product",
  "commercial-area",
  "seoul-commercial",
  "kosaf-high",
  "kosaf-university",
  "ecos",
  "finlife",
  "dart",
  "bizinfo",
  "bizinfo-data-go",
  "kstartup",
  "work24",
  "youth-center",
  "kosis-employment",
  "moel-policy-news",
  "moel-press-releases",
] as const;

export type PublicDataSourceId = (typeof PUBLIC_DATA_SOURCE_IDS)[number];

const SOURCE_CREDENTIALS: Record<PublicDataSourceId, ServiceApiKeyName | null> = {
  exchange: "KOREA_EXIM_API_KEY",
  stock: "DATA_GO_KR_API_KEY",
  "financial-company": "DATA_GO_KR_API_KEY",
  "loan-product": "DATA_GO_KR_API_KEY",
  "commercial-area": "DATA_GO_KR_API_KEY",
  "seoul-commercial": "SEOUL_OPEN_DATA_API_KEY",
  "kosaf-high": "DATA_GO_KR_API_KEY",
  "kosaf-university": "DATA_GO_KR_API_KEY",
  ecos: "BOK_ECOS_API_KEY",
  finlife: "FINLIFE_API_KEY",
  dart: "DART_API_KEY",
  bizinfo: "BIZINFO_API_KEY",
  "bizinfo-data-go": "DATA_GO_KR_API_KEY",
  kstartup: "DATA_GO_KR_API_KEY",
  work24: "WORK24_API_KEY",
  "youth-center": "YOUTH_CENTER_API_KEY",
  "kosis-employment": "KOSIS_API_KEY",
  "moel-policy-news": null,
  "moel-press-releases": null,
};

export type ResolvedPublicDataKeys = Partial<Record<ServiceApiKeyName, string | null>>;

export function publicDataSourceCredentialKey(sourceId: string) {
  return PUBLIC_DATA_SOURCE_IDS.includes(sourceId as PublicDataSourceId)
    ? SOURCE_CREDENTIALS[sourceId as PublicDataSourceId]
    : null;
}

export function publicDataSourceIdsForCredential(keyName: ServiceApiKeyName) {
  return PUBLIC_DATA_SOURCE_IDS.filter((sourceId) => SOURCE_CREDENTIALS[sourceId] === keyName);
}

function supportedSourceIds(sourceIds?: readonly string[]) {
  const requested = new Set(sourceIds ?? PUBLIC_DATA_SOURCE_IDS);
  return PUBLIC_DATA_SOURCE_IDS.filter((sourceId) => requested.has(sourceId));
}

export async function resolvePublicDataSourceKeys(sourceIds?: readonly string[]) {
  const ids = supportedSourceIds(sourceIds);
  const keyNames = [...new Set(ids.map((sourceId) => SOURCE_CREDENTIALS[sourceId])
    .filter((keyName): keyName is ServiceApiKeyName => keyName !== null))];
  return await runtimeServiceSecrets(keyNames) as ResolvedPublicDataKeys;
}

export function configuredPublicDataSourceIds(
  sourceIds: readonly string[],
  resolvedKeys: ResolvedPublicDataKeys,
) {
  return supportedSourceIds(sourceIds).filter((sourceId) => {
    const keyName = SOURCE_CREDENTIALS[sourceId];
    return keyName === null || Boolean(resolvedKeys[keyName]);
  });
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return output;
}

function adapterForSource(
  sourceId: PublicDataSourceId,
  key: string | null,
  nowIso: string,
  previousItems: Map<string, PublicInformationItem>,
  backfill?: PublicDataBackfillContext,
) {
  const sourceBackfill = backfill ? {
    checkpoint: backfill.checkpoints.get(sourceId) ?? null,
    stagedItems: backfill.stagedItems.get(sourceId) ?? [],
    maxBackfillPagesPerRun: backfill.maxBackfillPagesPerRun,
    commitPage: backfill.commitPage,
    readCommittedItems: backfill.readCommittedItems,
  } satisfies PublicBackfillRuntime : undefined;
  switch (sourceId) {
    case "exchange": return exchangeAdapter(key);
    case "stock": return stockAdapter(key, nowIso, previousItems);
    case "financial-company": return companyAdapter(key, nowIso, previousItems);
    case "loan-product": return loanAdapter(key, nowIso, previousItems);
    case "commercial-area": return commercialAreaAdapter(key, nowIso, previousItems);
    case "seoul-commercial": return seoulCommercialAdapter(key, nowIso, previousItems);
    case "kosaf-high": return kosafAdapter(key, "high", nowIso, previousItems);
    case "kosaf-university": return kosafAdapter(key, "university", nowIso, previousItems);
    case "ecos": return ecosAdapter(key, nowIso, previousItems);
    case "finlife": return finlifeAdapter(key, nowIso, previousItems);
    case "dart": return dartAdapter(key, nowIso, previousItems, sourceBackfill);
    case "bizinfo": return bizinfoAdapter(key, nowIso, previousItems, sourceBackfill);
    case "bizinfo-data-go": return dataGoBizinfoStartupAdapter({
      apiKey: key,
      nowIso,
      previous: previousItems,
      backfill: sourceBackfill,
    }).then(publicStartupAdapterResult);
    case "kstartup": return kStartupAnnouncementAdapter({
      apiKey: key,
      nowIso,
      previous: previousItems,
      backfill: sourceBackfill,
    }).then(publicStartupAdapterResult);
    case "work24": return work24Adapter(key, nowIso, previousItems, sourceBackfill);
    case "youth-center": return youthCenterAdapter(key, nowIso, previousItems, sourceBackfill);
    case "kosis-employment": return kosisEmploymentAdapter({
      apiKey: key,
      nowIso,
      previous: previousItems,
    });
    case "moel-policy-news": return moelPolicyNewsAdapter(nowIso, previousItems);
    case "moel-press-releases": return moelPressReleasesAdapter(nowIso, previousItems);
  }
}

export async function collectPublicData(
  previousPayload: PublicDataPayload | null,
  options: {
    sourceIds?: readonly string[];
    resolvedKeys?: ResolvedPublicDataKeys;
    previousSourceItems?: ReadonlyMap<string, readonly PublicInformationItem[]>;
    backfill?: PublicDataBackfillContext;
  } = {},
) {
  const nowIso = new Date().toISOString();
  const selectedSourceIds = supportedSourceIds(options.sourceIds);
  const resolvedKeys = options.resolvedKeys ?? await resolvePublicDataSourceKeys(selectedSourceIds);
  const retainedPreviousPayload = previousPayload
    ? {
        ...previousPayload,
        categories: previousPayload.categories.map((group) => {
          const items = prunePublicInformationArchive(group.items, Date.parse(nowIso));
          return { ...group, items, totalCount: items.length };
        }),
      }
    : null;
  const previousItemList = (retainedPreviousPayload?.categories ?? []).flatMap((group) => group.items);
  const previousItems = new Map(previousItemList.map((item) => [item.id, item]));
  const results = await mapWithConcurrency(selectedSourceIds, 3, async (sourceId) => {
    const keyName = SOURCE_CREDENTIALS[sourceId];
    const key = keyName === null ? null : resolvedKeys[keyName] ?? null;
    const sourcePreviousItems = new Map(previousItems);
    for (const item of options.previousSourceItems?.get(sourceId) ?? []) {
      sourcePreviousItems.set(item.id, item);
    }
    return adapterForSource(sourceId, key, nowIso, sourcePreviousItems, options.backfill);
  });
  const resultBySource = new Map(results.map((result) => [result.source.id, result]));

  const payload = emptyPublicDataPayload();
  payload.exchange = previousPayload?.exchange
    ? { ...previousPayload.exchange, rates: [...previousPayload.exchange.rates] }
    : payload.exchange;
  const exchange = resultBySource.get("exchange");
  const usableStatus = (status: PublicSourceStatus) => (
    status === "live" || status === "partial" || status === "truncated"
  );
  if (exchange && usableStatus(exchange.source.status)) {
    payload.exchange = {
      source: "한국수출입은행 환율 API",
      sourceUrl: SOURCE_URLS.exchange,
      asOf: exchange.asOf,
      rates: exchange.exchange,
    };
  }

  payload.market = previousPayload?.market ? [...previousPayload.market] : [];
  const stock = resultBySource.get("stock");
  if (stock && usableStatus(stock.source.status)) payload.market = stock.market;

  let mergedItems = [...previousItemList];
  for (const result of results) {
    if (!usableStatus(result.source.status)) continue;
    const incremental = "incremental" in result && result.incremental === true;
    const retainedForSource = result.source.status === "live" && !incremental
      ? []
      : mergedItems.filter((item) => sourceOwnsItem(result.source.id, item));
    const byId = new Map(
      [...retainedForSource, ...result.items].map((item) => [item.id, item]),
    );
    mergedItems = mergedItems.filter((item) => !sourceOwnsItem(result.source.id, item));
    mergedItems.push(...byId.values());
  }
  mergedItems = prunePublicInformationArchive(mergedItems, Date.parse(nowIso));
  payload.categories = payload.categories.map((group) => {
    const categoryItems = mergedItems.filter((item) => item.category === group.id);
    return { ...group, items: categoryItems, totalCount: categoryItems.length };
  });

  const previousSources = new Map((previousPayload?.sources ?? []).map((item) => [item.id, item]));
  payload.sources = PUBLIC_DATA_SOURCE_IDS.flatMap((sourceId) => {
    const result = resultBySource.get(sourceId);
    const previous = previousSources.get(sourceId);
    const current = result?.source ?? previous;
    if (!current) return [];
    const resultSucceeded = result ? usableStatus(result.source.status) : false;
    const itemCount = sourceId === "exchange"
      ? payload.exchange.rates.length
      : resultSucceeded
        ? mergedItems.filter((item) => sourceOwnsItem(sourceId, item)).length
        : previous?.itemCount ?? current.itemCount;
    return [{ ...current, itemCount }];
  });

  const requestCounts = Object.fromEntries(results.map((result) => {
    const sourceId = result.source.id as PublicDataSourceId;
    const keyName = SOURCE_CREDENTIALS[sourceId];
    const configured = keyName === null || Boolean(resolvedKeys[keyName]);
    const fallbackCount = configured ? publicSourcePolicy(sourceId)?.estimatedCalls ?? 1 : 0;
    return [sourceId, result.requestCount ?? fallbackCount];
  })) as Partial<Record<PublicDataSourceId, number>>;
  const liveSourceCount = results.filter((result) => usableStatus(result.source.status)).length;
  return {
    payload,
    liveSourceCount,
    requestCounts,
    sourceResults: results.map((result) => ({
      ...result.source,
      failureKind: result.failureKind,
    })),
    sourceCatalogs: results.flatMap((result) => {
      if (!usableStatus(result.source.status)) return [];
      const incremental = "incremental" in result && result.incremental === true;
      const completeGeneration = result.source.completeness === "complete";
      if (result.items.length === 0 && (result.source.status !== "live" || incremental)) return [];
      const retainedForSource = completeGeneration || result.source.status === "live" && !incremental
        ? []
        : previousItemList.filter((item) => sourceOwnsItem(result.source.id, item));
      const items = [...new Map(
        [...retainedForSource, ...result.items].map((item) => [item.id, item]),
      ).values()];
      return [{
        sourceId: result.source.id,
        status: result.source.status,
        incremental,
        completeGeneration,
        // A completed generation is authoritative. The service applies the
        // same bounded historical archive policy before publishing it, while
        // viewer freshness filters continue to hide expired rows by default.
        items: completeGeneration ? items : prunePublicInformationArchive(items, Date.parse(nowIso)),
      }];
    }),
    status: results.length > 0 && results.every((result) => (
      result.source.status === "live" && !result.source.errorCode
    )) ? "live" as const : "partial" as const,
  };
}
