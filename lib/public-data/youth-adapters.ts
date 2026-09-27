import type {
  YouthPolicyInterest,
  YouthPolicyRegion,
} from "@/lib/auth/youth-policy-profile";
import { PublicResponseBodyError, readBoundedResponseText } from "./bounded-response";
import { safePublicHttpUrl } from "./urls";
import { cleanPublicText } from "./text";
import { normalizePublicDate, normalizePublicDateTime, publicApplicationPeriodLabel, normalizeYouthPortalSourceDates } from "./dates";
import type {
  PublicBackfillCheckpoint,
  PublicBackfillRuntime,
  PublicInformationItem,
  PublicSourceResult,
  PublicSourceStatus,
} from "./types";

export type SupplementalFailureKind = "authorization" | "quota" | "transient";

export interface SupplementalPublicAdapterResult {
  source: PublicSourceResult;
  items: PublicInformationItem[];
  market: [];
  exchange: [];
  asOf: string | null;
  requestCount: number;
  failureKind?: SupplementalFailureKind;
  incremental?: boolean;
}

const WORK24_ENDPOINT = "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do";
const WORK24_GUIDE = "https://www.work24.go.kr/cm/e/a/0110/selectOpenApiIntro.do";
const YOUTH_CENTER_ENDPOINT = "https://www.youthcenter.go.kr/opi/youthPlcyList.do";
const YOUTH_CENTER_GUIDE = "https://www.youthcenter.go.kr/cmnFooter/openapiIntro/oaiGuide";
const YOUTH_CENTER_HOME = "https://www.youthcenter.go.kr/youthPolicy/ythPlcyTotalSearch";
const YOUTH_CENTER_PORTAL_ENDPOINT = "https://www.youthcenter.go.kr/pubot/search/portalPolicySearch";
const MOEL_RSS_ENDPOINT = "https://www.moel.go.kr/rss/policy.do";
const MOEL_RSS_GUIDE = "https://www.moel.go.kr/site/rss/rssList.do";
const MOEL_PRESS_LIST_ENDPOINT = "https://www.moel.go.kr/news/enews/report/enewsList.do";
const MOEL_PRESS_PAGE_SIZE = 10;
export const MOEL_PRESS_MAX_LIST_PAGES = 8;
export const MOEL_PRESS_MAX_DETAILS = 16;
export const MOEL_PRESS_MAX_REQUESTS =
  MOEL_PRESS_MAX_LIST_PAGES + MOEL_PRESS_MAX_DETAILS;
const MOEL_PRESS_RECENT_DAYS = 30;
const MOEL_PRESS_MAX_REDIRECTS = 0;
const WORK24_PAGE_SIZE = 100;
const YOUTH_CENTER_PAGE_SIZE = 40;
const WORK24_MAX_PAGES = 20;
const WORK24_PROVIDER_MAX_PAGE = 1_000;
// The official recruitment API accepts M-1. A shared, checkpointed refresh
// gives every viewer the broader one-month catalogue without per-user calls.
const WORK24_REGISTRATION_WINDOW = "M-1";
const YOUTH_CENTER_MAX_PAGES = 5;
const YOUTH_CENTER_PORTAL_PAGE_SIZE = 100;
// The provider's HTTPS Open API currently redirects to an insecure HTTP:8080
// endpoint. The keyless official portal is therefore the safe fallback. Its
// current catalogue fits within 30 pages while keeping one refresh below the
// Worker subrequest ceiling together with the rejected API request and session.
const YOUTH_CENTER_PORTAL_MAX_PAGES = 30;
const YOUTH_CENTER_SECTION_PAGE_STRIDE = 100_000;
const MAX_SAFE_REDIRECTS = 1;
const YOUTH_CENTER_PORTAL_COOKIES = new Set([
  "SCOUTER",
  "XSRF-TOKEN",
  "yat",
  "yrt",
  "UID",
  "ygt",
  "ctpvCnt",
  "ctpvSggCnt",
]);

class UpstreamError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function sourceStatus(error: unknown): PublicSourceStatus {
  return error instanceof UpstreamError && (error.status === 401 || error.status === 403)
    ? "authorization-pending"
    : "unavailable";
}

function failureKind(error: unknown): SupplementalFailureKind {
  if (error instanceof UpstreamError) {
    if (error.status === 429) return "quota";
    if (error.status === 401 || error.status === 403) return "authorization";
  }
  return "transient";
}

function errorCode(error: unknown) {
  if (error instanceof UpstreamError && /^[a-z0-9_]+$/u.test(error.message)) return error.message;
  return "adapter_exception";
}

function source(
  id: string,
  label: string,
  status: PublicSourceStatus,
  sourceUrl: string,
  itemCount = 0,
): PublicSourceResult {
  return { id, label, status, sourceUrl, itemCount };
}

function emptyResult(id: string, label: string, sourceUrl: string): SupplementalPublicAdapterResult {
  return {
    source: source(id, label, "not-configured", sourceUrl),
    items: [],
    market: [],
    exchange: [],
    asOf: null,
    requestCount: 0,
  };
}

async function fetchText(endpoint: URL, timeoutMs = 12_000) {
  const signal = AbortSignal.timeout(timeoutMs);
  let requestEndpoint = endpoint;
  let response: Response | null = null;
  for (let redirectCount = 0; redirectCount <= MAX_SAFE_REDIRECTS; redirectCount += 1) {
    try {
      response = await fetch(requestEndpoint, {
        signal,
        // Workers does not implement redirect:"error". Manual handling lets
        // YouthCenter recover from a provider path move while ensuring its
        // server-side key never crosses an origin or an HTTPS downgrade.
        redirect: "manual",
        headers: { Accept: "application/xml, text/xml, application/rss+xml, text/plain;q=0.8" },
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new UpstreamError(name === "TimeoutError" || name === "AbortError" ? 504 : 502, "upstream_network");
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location || redirectCount >= MAX_SAFE_REDIRECTS) {
      throw new UpstreamError(502, "upstream_redirect");
    }
    let redirected: URL;
    try {
      redirected = new URL(location, requestEndpoint);
    } catch {
      throw new UpstreamError(502, "upstream_redirect");
    }
    if (
      redirected.protocol !== "https:"
      || redirected.origin !== endpoint.origin
      || redirected.username
      || redirected.password
    ) {
      throw new UpstreamError(502, "upstream_redirect");
    }
    requestEndpoint = redirected;
  }
  if (!response) throw new UpstreamError(502, "upstream_network");
  if (!response.ok) throw new UpstreamError(response.status, `upstream_http_${response.status}`);
  const responseUrl = response.url ? new URL(response.url) : requestEndpoint;
  if (responseUrl.origin !== endpoint.origin) throw new UpstreamError(502, "upstream_origin");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !/(?:application|text)\/(?:xml|rss\+xml|plain)/u.test(contentType)) {
    throw new UpstreamError(502, "upstream_content_type");
  }
  let body: string;
  try {
    body = await readBoundedResponseText(response, 4_000_000);
  } catch (error) {
    if (error instanceof PublicResponseBodyError) {
      throw new UpstreamError(502, "upstream_body_too_large");
    }
    throw new UpstreamError(502, "upstream_body_invalid");
  }
  if (!/^\s*(?:<\?xml[^>]*>\s*)?</u.test(body)) {
    throw new UpstreamError(502, "upstream_body_invalid");
  }
  return body;
}

export type MoelPressFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function fetchMoelHtml(
  endpoint: URL,
  fetchImpl: MoelPressFetch,
  timeoutMs = 12_000,
) {
  const signal = AbortSignal.timeout(timeoutMs);
  let requestEndpoint = endpoint;
  let response: Response | null = null;
  for (let redirectCount = 0; redirectCount <= MOEL_PRESS_MAX_REDIRECTS; redirectCount += 1) {
    try {
      response = await fetchImpl(requestEndpoint, {
        signal,
        redirect: "manual",
        headers: { Accept: "text/html,application/xhtml+xml;q=0.9" },
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new UpstreamError(
        name === "TimeoutError" || name === "AbortError" ? 504 : 502,
        "moel_press_network",
      );
    }
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location || redirectCount >= MOEL_PRESS_MAX_REDIRECTS) {
      throw new UpstreamError(502, "moel_press_redirect");
    }
    let redirected: URL;
    try {
      redirected = new URL(location, requestEndpoint);
    } catch {
      throw new UpstreamError(502, "moel_press_redirect");
    }
    if (
      redirected.protocol !== "https:"
      || redirected.origin !== new URL(MOEL_PRESS_LIST_ENDPOINT).origin
      || redirected.username
      || redirected.password
    ) {
      throw new UpstreamError(502, "moel_press_redirect");
    }
    requestEndpoint = redirected;
  }
  if (!response) throw new UpstreamError(502, "moel_press_network");
  if (!response.ok) throw new UpstreamError(response.status, `moel_press_http_${response.status}`);
  const responseUrl = response.url ? new URL(response.url) : requestEndpoint;
  if (
    responseUrl.protocol !== "https:"
    || responseUrl.origin !== new URL(MOEL_PRESS_LIST_ENDPOINT).origin
  ) throw new UpstreamError(502, "moel_press_origin");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/u.test(contentType)) {
    throw new UpstreamError(502, "moel_press_content_type");
  }
  let body: string;
  try {
    body = await readBoundedResponseText(response, 2_000_000);
  } catch (error) {
    if (error instanceof PublicResponseBodyError) {
      throw new UpstreamError(502, "moel_press_body_too_large");
    }
    throw new UpstreamError(502, "moel_press_body_invalid");
  }
  if (!/(?:<!doctype\s+html[^>]*>|<html(?:\s[^>]*)?>)/iu.test(body.slice(0, 50_000))) {
    throw new UpstreamError(502, "moel_press_body_invalid");
  }
  return body;
}

function cleanText(value: string | null | undefined, maxLength = 600) {
  return cleanPublicText(value, maxLength);
}

function blocks(payload: string, tagName: string) {
  const escaped = tagName.replace(/[^A-Za-z0-9_]/gu, "");
  if (!escaped) return [];
  return [...payload.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "giu"))]
    .map((match) => match[1]);
}

function field(block: string, names: readonly string[], maxLength = 600) {
  for (const name of names) {
    const escaped = name.replace(/[^A-Za-z0-9_:]/gu, "");
    if (!escaped) continue;
    const match = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "iu").exec(block);
    const value = cleanText(match?.[1], maxLength);
    if (value) return value;
  }
  return "";
}

function nonNegativeIntegerField(
  payload: string,
  names: readonly string[],
  shapeError: string,
) {
  const value = field(payload, names, 40);
  if (!value) return null;
  if (!/^\d+$/u.test(value)) throw new UpstreamError(502, shapeError);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new UpstreamError(502, shapeError);
  return parsed;
}

function stableId(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function normalizeDate(value: string) {
  return normalizePublicDateTime(value);
}

function applicationDates(value: string) {
  const dates = [...value.matchAll(/(?<!\d)(20\d{2})(?:[-./년]\s*)?(\d{1,2})(?:[-./월]\s*)?(\d{1,2})(?!\d)/gu)]
    .map((match) => `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`)
    .filter((candidate) => normalizePublicDate(candidate) !== null);
  return { startsAt: dates.length === 2 ? dates[0] : null, expiresAt: dates.length > 0 && dates.length <= 2 ? dates.at(-1)! : null };
}

function summaryWithApplicationPeriod(bodyParts: readonly string[], periodLabel: string) {
  const body = bodyParts.filter(Boolean).join(" · ");
  // Keep the complete date/unknown notice even when both provider description
  // fields reach their limits. A missing footer must not conceal uncertainty.
  const bodyLimit = Math.max(0, 900 - periodLabel.length - 3);
  const prefix = body.length > bodyLimit ? `${body.slice(0, Math.max(0, bodyLimit - 1)).trimEnd()}…` : body;
  return [prefix, periodLabel].filter(Boolean).join(" · ");
}

const REGION_NAMES: Array<[YouthPolicyRegion, RegExp]> = [
  ["seoul", /서울/u], ["busan", /부산/u], ["daegu", /대구/u], ["incheon", /인천/u],
  ["gwangju", /광주/u], ["daejeon", /대전/u], ["ulsan", /울산/u], ["sejong", /세종/u],
  ["gyeonggi", /경기/u], ["gangwon", /강원/u], ["chungbuk", /충북|충청북도/u],
  ["chungnam", /충남|충청남도/u], ["jeonbuk", /전북|전라북도|전북특별자치도/u],
  ["jeonnam", /전남|전라남도/u], ["gyeongbuk", /경북|경상북도/u],
  ["gyeongnam", /경남|경상남도/u], ["jeju", /제주/u],
];

function regionsFromOfficialField(value: string) {
  if (!value || /전국|제한없음|무관/u.test(value)) return [];
  return REGION_NAMES.filter(([, matcher]) => matcher.test(value)).map(([region]) => region);
}

function regionScopeFromOfficialField(
  value: string,
  regions: readonly YouthPolicyRegion[],
): "nationwide" | "regional" | "unknown" {
  if (/전국|제한없음|무관/u.test(value)) return "nationwide";
  if (regions.length) return "regional";
  return "unknown";
}

function positiveAge(value: string) {
  const digits = value.match(/\d+/u)?.[0];
  if (!digits) return undefined;
  const parsed = Number(digits);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 120 ? parsed : undefined;
}

function safeSourceUrl(candidate: string, fallback: string, allowedHosts?: readonly string[]) {
  return safePublicHttpUrl(candidate, undefined, allowedHosts) ?? fallback;
}

function work24Total(payload: string) {
  const total = nonNegativeIntegerField(payload, ["total"], "work24_shape");
  if (total === null) throw new UpstreamError(502, "work24_shape");
  return total;
}

export function normalizeWork24Xml(
  payload: string,
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
) {
  const errorMessage = field(payload, ["error", "message", "errMsg", "errorMsg"], 200);
  if (
    /인증|개인회원|사용할\s*수\s*없는|신청하신.*서비스.*존재하지|auth|key|승인/iu.test(errorMessage)
  ) {
    throw new UpstreamError(403, "work24_authorization");
  }
  if (errorMessage) throw new UpstreamError(502, "work24_provider_error");
  if (!/<wantedRoot(?:\s[^>]*)?>/iu.test(payload)) throw new UpstreamError(502, "work24_shape");
  const total = work24Total(payload);
  const items = blocks(payload, "wanted").flatMap((block): PublicInformationItem[] => {
    const wantedAuthNo = field(block, ["wantedAuthNo"], 100);
    const title = field(block, ["title"], 300);
    if (!wantedAuthNo || !title) return [];
    const company = field(block, ["company"], 180);
    const industry = field(block, ["indTpNm"], 160);
    const region = field(block, ["region", "basicAddr", "strtnmCd"], 220);
    const pay = [field(block, ["salTpNm"], 80), field(block, ["sal"], 120)].filter(Boolean).join(" ");
    const career = field(block, ["career"], 100);
    const education = [field(block, ["minEdubg"], 100), field(block, ["maxEdubg"], 100)]
      .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)
      .join("~");
    const workSchedule = field(block, ["holidayTpNm"], 100);
    const employmentType = (() => {
      switch (field(block, ["empTpCd"], 10)) {
        case "10": return "기간의 정함이 없는 근로계약";
        case "11": return "기간의 정함이 없는 시간선택제";
        case "20": return "기간의 정함이 있는 근로계약";
        case "21": return "기간의 정함이 있는 시간선택제";
        default: return "";
      }
    })();
    const closeDate = field(block, ["closeDt"], 80);
    const itemId = `work24-${wantedAuthNo.replace(/[^0-9A-Za-z-]/gu, "-").slice(0, 100)}`;
    const sourceUrl = safeSourceUrl(
      field(block, ["wantedInfoUrl"], 800),
      WORK24_GUIDE,
      ["work24.go.kr", "work.go.kr"],
    );
    const summary = [
      company,
      industry,
      region,
      pay,
      employmentType,
      education && `학력 ${education}`,
      career,
      workSchedule,
      closeDate && `마감 ${closeDate}`,
    ].filter(Boolean).join(" · ");
    const eligibleRegions = regionsFromOfficialField(region);
    const regionScope = regionScopeFromOfficialField(region, eligibleRegions);
    return [{
      id: itemId,
      category: "youth",
      title,
      summary,
      source: "고용24",
      sourceUrl,
      sourceLinkKind: sourceUrl === WORK24_GUIDE ? "dataset" : "detail",
      publishedAt: normalizeDate(field(block, ["regDt", "smodifyDtm"], 80)),
      expiresAt: normalizePublicDate(closeDate),
      discoveredAt: previous.get(itemId)?.discoveredAt ?? nowIso,
      lastVerifiedAt: nowIso,
      tags: [
        "취업",
        "공식 채용정보",
        "section:employment",
        company,
        industry,
        pay,
        employmentType,
        education,
        career,
        workSchedule,
      ].filter(Boolean),
      location: region ? { label: region, precision: "administrative" } : undefined,
      youthPolicyEligibility: {
        regionScope,
        interests: ["employment"],
        ...(eligibleRegions.length ? { regions: eligibleRegions } : {}),
      },
    }];
  });
  if (total > 0 && items.length === 0) throw new UpstreamError(502, "work24_shape");
  return items;
}

function backfillSignature(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function kstBackfillGeneration(nowIso: string) {
  const instant = new Date(nowIso);
  if (!Number.isFinite(instant.getTime())) throw new UpstreamError(500, "invalid_backfill_generation");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

type Work24BackfillQueryState = {
  version: 2 | 3;
  endpoint: string;
  pageSize: number;
  registrationWindow: string;
  sort: string;
  reconciliationDay: string;
};

function parseWork24BackfillQueryState(value: string): Work24BackfillQueryState | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      !parsed
      || typeof parsed !== "object"
      || Array.isArray(parsed)
      || (parsed.version !== 2 && parsed.version !== 3)
      || parsed.endpoint !== WORK24_ENDPOINT
      || parsed.pageSize !== WORK24_PAGE_SIZE
      || parsed.registrationWindow !== WORK24_REGISTRATION_WINDOW
      || parsed.sort !== "DESC"
      || typeof parsed.reconciliationDay !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/u.test(parsed.reconciliationDay)
    ) return null;
    if (
      parsed.version === 2
      && (!Number.isSafeInteger(parsed.providerTotalCount) || Number(parsed.providerTotalCount) < 0)
    ) return null;
    return {
      version: parsed.version,
      endpoint: parsed.endpoint,
      pageSize: parsed.pageSize,
      registrationWindow: parsed.registrationWindow,
      sort: parsed.sort,
      reconciliationDay: parsed.reconciliationDay,
    };
  } catch {
    return null;
  }
}

function work24BackfillIdentity(nowIso: string) {
  const queryState = JSON.stringify({
    version: 3,
    endpoint: WORK24_ENDPOINT,
    pageSize: WORK24_PAGE_SIZE,
    registrationWindow: WORK24_REGISTRATION_WINDOW,
    sort: "DESC",
    reconciliationDay: kstBackfillGeneration(nowIso),
  });
  return {
    queryState,
    querySignature: `work24-v4-${backfillSignature(queryState)}`,
  };
}

function matchingWork24Checkpoint(
  checkpoint: PublicBackfillCheckpoint | null,
  reconciliationDay: string,
) {
  if (
    !checkpoint
    || checkpoint.sourceId !== "work24"
    || checkpoint.pageSize !== WORK24_PAGE_SIZE
  ) return null;
  const state = parseWork24BackfillQueryState(checkpoint.queryState);
  if (!state) return null;
  const signatureVersion = state.version === 2 ? "work24-v3" : "work24-v4";
  if (checkpoint.querySignature !== `${signatureVersion}-${backfillSignature(checkpoint.queryState)}`) {
    return null;
  }
  // An incomplete offset walk must retain its generation across KST days and
  // changes to the provider's live total. Page one is still replaced below on
  // every run. Only a completed generation rolls over on the next KST day.
  if (checkpoint.completed && state.reconciliationDay !== reconciliationDay) return null;
  return checkpoint;
}

function work24Endpoint(apiKey: string, page: number) {
  const endpoint = new URL(WORK24_ENDPOINT);
  endpoint.searchParams.set("authKey", apiKey);
  endpoint.searchParams.set("callTp", "L");
  endpoint.searchParams.set("returnType", "XML");
  endpoint.searchParams.set("startPage", String(page));
  endpoint.searchParams.set("display", String(WORK24_PAGE_SIZE));
  endpoint.searchParams.set("regDate", WORK24_REGISTRATION_WINDOW);
  endpoint.searchParams.set("sortOrderBy", "DESC");
  return endpoint;
}

async function checkpointedWork24Adapter(
  apiKey: string,
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
  runtime: PublicBackfillRuntime,
  empty: SupplementalPublicAdapterResult,
): Promise<SupplementalPublicAdapterResult> {
  let requestCount = 0;
  try {
    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) throw new UpstreamError(500, "work24_invalid_now");

    requestCount += 1;
    const firstPayload = await fetchText(work24Endpoint(apiKey, 1));
    const firstItems = normalizeWork24Xml(firstPayload, nowIso, previous);
    const total = work24Total(firstPayload);
    const providerPages = Math.max(1, Math.ceil(total / WORK24_PAGE_SIZE));
    const requiredPages = Math.min(providerPages, WORK24_PROVIDER_MAX_PAGE);
    const providerPageLimitReached = providerPages > WORK24_PROVIDER_MAX_PAGE;
    const reconciliationDay = kstBackfillGeneration(nowIso);
    let stored = matchingWork24Checkpoint(runtime.checkpoint, reconciliationDay);
    if (stored && stored.providerTotalCount !== total) stored = null;
    const identity = stored ?? work24BackfillIdentity(nowIso);
    const stagedById = new Map((stored ? runtime.stagedItems : [])
      .filter((item) => item.id.startsWith("work24-"))
      .map((item) => [item.id, item]));
    for (const item of firstItems) stagedById.set(item.id, item);

    const completed = requiredPages <= 1
      || Boolean(stored && stored.nextPage > requiredPages);
    const fetchableCount = Math.min(total, requiredPages * WORK24_PAGE_SIZE);
    const retainedFetchedCount = Math.min(
      fetchableCount,
      Math.max(firstItems.length, stored?.fetchedCount ?? 0),
    );
    let checkpoint: PublicBackfillCheckpoint = {
      sourceId: "work24",
      querySignature: identity.querySignature,
      queryState: identity.queryState,
      nextPage: completed
        ? Math.max(requiredPages + 1, stored?.nextPage ?? 2)
        : Math.max(2, stored?.nextPage ?? 2),
      pageSize: WORK24_PAGE_SIZE,
      providerTotalCount: total,
      fetchedCount: retainedFetchedCount,
      completed,
      latestRefreshAt: now,
      completedAt: completed ? stored?.completedAt ?? now : null,
      updatedAt: now,
    };

    try {
      await runtime.commitPage({ checkpoint, pageNumber: stored ? 0 : 1, items: firstItems, resetGeneration: !stored });
    } catch {
      throw new UpstreamError(500, "work24_checkpoint_commit_failed");
    }

    let partialError: unknown = null;
    const maximumPages = Math.max(1, Math.trunc(runtime.maxBackfillPagesPerRun));
    const firstBackfillPage = checkpoint.nextPage;
    for (
      let page = firstBackfillPage;
      !checkpoint.completed && page < firstBackfillPage + maximumPages;
      page += 1
    ) {
      try {
        requestCount += 1;
        const payload = await fetchText(work24Endpoint(apiKey, page));
        const pageItems = normalizeWork24Xml(payload, nowIso, previous);
        const pageTotal = work24Total(payload);
        if (pageTotal !== total) {
          throw new UpstreamError(502, "work24_total_changed");
        }
        const pageCompleted = page >= requiredPages;
        checkpoint = {
          ...checkpoint,
          nextPage: page + 1,
          fetchedCount: Math.min(total, checkpoint.fetchedCount + pageItems.length),
          completed: pageCompleted,
          completedAt: pageCompleted ? now : null,
          updatedAt: now,
        };
        await runtime.commitPage({ checkpoint, pageNumber: page, items: pageItems });
        for (const item of pageItems) stagedById.set(item.id, item);
      } catch (error) {
        partialError = error instanceof UpstreamError
          ? error
          : new UpstreamError(500, "work24_checkpoint_commit_failed");
        break;
      }
    }

    const items = [...stagedById.values()];
    const completeness = partialError
      ? "partial" as const
      : checkpoint.completed
        ? providerPageLimitReached
          ? "truncated" as const
          : "complete" as const
        : "truncated" as const;
    return {
      ...empty,
      source: {
        ...source(
          "work24",
          "고용24 채용정보",
          completeness === "complete" ? "live" : completeness,
          WORK24_GUIDE,
          items.length,
        ),
        providerTotalCount: total,
        fetchedCount: checkpoint.fetchedCount,
        completeness,
        errorCode: partialError
          ? errorCode(partialError)
          : checkpoint.completed && providerPageLimitReached
            ? "work24_provider_page_limit"
            : checkpoint.completed
              ? undefined
              : "work24_backfill_in_progress",
      },
      items,
      asOf: items.find((item) => item.publishedAt)?.publishedAt ?? nowIso,
      requestCount,
      incremental: true,
      ...(partialError ? { failureKind: failureKind(partialError) } : {}),
    };
  } catch (error) {
    return {
      ...empty,
      source: {
        ...source("work24", "고용24 채용정보", sourceStatus(error), WORK24_GUIDE),
        errorCode: errorCode(error),
      },
      requestCount,
      failureKind: failureKind(error),
      incremental: true,
    };
  }
}

export async function work24Adapter(
  apiKey: string | null,
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
  backfill?: PublicBackfillRuntime,
): Promise<SupplementalPublicAdapterResult> {
  const empty = emptyResult("work24", "고용24 채용정보", WORK24_GUIDE);
  if (!apiKey) return empty;
  if (backfill) {
    return checkpointedWork24Adapter(apiKey, nowIso, previous, backfill, empty);
  }
  let requestCount = 0;
  try {
    const byId = new Map<string, PublicInformationItem>();
    let total = 0;
    for (let page = 1; page <= WORK24_MAX_PAGES; page += 1) {
      if (page > 1 && total <= (page - 1) * WORK24_PAGE_SIZE) break;
      const endpoint = new URL(WORK24_ENDPOINT);
      endpoint.searchParams.set("authKey", apiKey);
      endpoint.searchParams.set("callTp", "L");
      endpoint.searchParams.set("returnType", "XML");
      endpoint.searchParams.set("startPage", String(page));
      endpoint.searchParams.set("display", String(WORK24_PAGE_SIZE));
      endpoint.searchParams.set("regDate", WORK24_REGISTRATION_WINDOW);
      endpoint.searchParams.set("sortOrderBy", "DESC");
      requestCount += 1;
      const payload = await fetchText(endpoint);
      const pageItems = normalizeWork24Xml(payload, nowIso, previous);
      if (page === 1) total = work24Total(payload);
      for (const item of pageItems) byId.set(item.id, item);
    }
    const items = [...byId.values()];
    const requiredPages = Math.max(1, Math.ceil(total / WORK24_PAGE_SIZE));
    const completeness = requiredPages > WORK24_MAX_PAGES ? "truncated" : "complete";
    return {
      ...empty,
      source: {
        ...source(
          "work24",
          "고용24 채용정보",
          completeness === "complete" ? "live" : "truncated",
          WORK24_GUIDE,
          items.length,
        ),
        providerTotalCount: total,
        fetchedCount: items.length,
        completeness,
      },
      items,
      asOf: items.find((item) => item.publishedAt)?.publishedAt ?? nowIso,
      requestCount,
    };
  } catch (error) {
    return {
      ...empty,
      source: { ...source("work24", "고용24 채용정보", sourceStatus(error), WORK24_GUIDE), errorCode: errorCode(error) },
      requestCount,
      failureKind: failureKind(error),
    };
  }
}

type YouthCenterSection =
  | "employment"
  | "scholarship"
  | "financial_support"
  | "policy_news";

interface YouthCenterSectionConfig {
  section: YouthCenterSection;
  policyCodes: string;
}

const YOUTH_CENTER_SECTIONS: readonly YouthCenterSectionConfig[] = [
  { section: "employment", policyCodes: "023010" },
  { section: "scholarship", policyCodes: "023030" },
  { section: "financial_support", policyCodes: "023040" },
  { section: "policy_news", policyCodes: "023020,023050" },
];

const YOUTH_CENTER_SECTION_METADATA: Record<
  YouthCenterSection,
  { tags: string[]; interests: YouthPolicyInterest[] }
> = {
  employment: {
    tags: ["취업", "청년정책", "section:employment"],
    interests: ["employment"],
  },
  scholarship: {
    tags: ["학자금", "교육", "청년정책", "section:scholarship"],
    interests: ["education"],
  },
  financial_support: {
    tags: ["금융지원", "청년정책", "section:financial-support"],
    interests: ["finance"],
  },
  policy_news: {
    tags: ["기타 청년정책", "청년정책", "section:policy-news"],
    interests: [],
  },
};

function compactOfficialCategory(value: string) {
  return value.replace(/[\s·･ㆍ]/gu, "");
}

function officialKeywordTokens(value: string) {
  return value
    .split(/[,|]/u)
    .map((token) => cleanText(token, 80))
    .filter(Boolean)
    .slice(0, 8);
}

interface YouthCenterClassificationFields {
  majorName: string;
  middleName: string;
  keywordValue: string;
  majorCode: string;
}

function classifyYouthCenterFields(
  {
    majorName,
    middleName,
    keywordValue,
    majorCode,
  }: YouthCenterClassificationFields,
  fallback: YouthCenterSection,
) {
  const major = compactOfficialCategory(majorName);
  const middle = compactOfficialCategory(middleName);
  const keywords = officialKeywordTokens(keywordValue);
  const compactKeywords = new Set(keywords.map(compactOfficialCategory));

  let section = fallback;
  let interests = [...YOUTH_CENTER_SECTION_METADATA[fallback].interests];

  if (middle === "창업" || compactKeywords.has("벤처")) {
    section = "policy_news";
    interests = ["startup"];
  } else if (middle === "취업" || compactKeywords.has("인턴")) {
    section = "employment";
    interests = ["employment"];
  } else if (middle === "교육비지원" || compactKeywords.has("교육지원")) {
    section = "scholarship";
    interests = ["education"];
  } else if (
    middle === "취약계층및금융지원"
    || ["대출", "금리혜택", "신용회복"].some((keyword) => compactKeywords.has(keyword))
  ) {
    section = "financial_support";
    interests = middle === "취약계층및금융지원"
      ? ["finance", "welfare"]
      : ["finance"];
  } else if (
    major === "주거"
    || middle === "주택및거주지"
    || middle === "기숙사"
    || middle === "전월세및주거급여지원"
    || compactKeywords.has("공공임대주택")
    || compactKeywords.has("주거지원")
  ) {
    section = "policy_news";
    interests = ["housing"];
  } else if (major === "교육" || major === "교육직업훈련") {
    section = "policy_news";
    interests = ["education"];
  } else if (major === "복지문화" || major === "금융복지문화") {
    section = "policy_news";
    interests = ["welfare"];
  } else if (major === "참여권리" || major === "참여기반") {
    section = "policy_news";
    interests = [];
  } else if (major === "일자리") {
    section = "employment";
    interests = ["employment"];
  } else {
    const policyCodes = majorCode.split(/[,|]/u).map((value) => value.trim());
    if (policyCodes.includes("023010")) {
      section = "employment";
      interests = ["employment"];
    } else if (policyCodes.includes("023020")) {
      section = "policy_news";
      interests = ["housing"];
    } else if (policyCodes.includes("023030")) {
      section = "scholarship";
      interests = ["education"];
    } else if (policyCodes.includes("023040")) {
      section = "financial_support";
      interests = ["finance"];
    } else if (policyCodes.includes("023050")) {
      section = "policy_news";
      interests = [];
    }
  }

  const officialTags = [majorName, middleName, ...keywords]
    .filter((tag) => tag && !tag.startsWith("section:"));
  return {
    section,
    interests,
    tags: [...new Set([
      ...YOUTH_CENTER_SECTION_METADATA[section].tags,
      ...officialTags,
    ])].slice(0, 12),
  };
}

function classifyYouthCenterPolicy(block: string, fallback: YouthCenterSection) {
  return classifyYouthCenterFields({
    majorName: field(block, ["lclsfNm"], 120),
    middleName: field(block, ["mclsfNm"], 120),
    keywordValue: field(block, ["plcyKywdNm"], 400),
    majorCode: field(block, ["bizTycd", "polyBizTy"], 80),
  }, fallback);
}

function youthCenterTotal(payload: string) {
  return nonNegativeIntegerField(
    payload,
    ["totalCnt", "totalCount", "totCount", "total"],
    "youth_center_shape",
  );
}

export function normalizeYouthCenterXml(
  payload: string,
  section: YouthCenterSection,
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
) {
  const responseCode = field(payload, ["respResult", "resultCode"], 80);
  const responseMessage = field(payload, ["errMsg", "resultMsg"], 200);
  if ((responseCode && !/^(?:0|00|200|success)$/iu.test(responseCode)) || /인증|auth|key|승인/u.test(responseMessage)) {
    throw new UpstreamError(403, "youth_center_authorization");
  }
  if (!/<youthPolicyList(?:\s[^>]*)?>/iu.test(payload)
    || !responseCode) throw new UpstreamError(502, "youth_center_shape");
  const candidates = blocks(payload, "youthPolicy");
  const items = candidates.flatMap((block): PublicInformationItem[] => {
    const policyId = field(block, ["bizId", "policyId", "plcyNo"], 140);
    const title = field(block, ["polyBizSjnm", "plcyNm"], 300);
    if (!policyId || !title) return [];
    const introduction = field(block, ["polyItcnCn", "plcyExplnCn"], 500);
    const support = field(block, ["sporCn", "plcySprtCn"], 500);
    const applicationPeriod = field(block, ["rqutPrdCn", "aplyYmd"], 240);
    const period = applicationDates(applicationPeriod);
    const periodNotice = !period.expiresAt && applicationPeriod
      && !/^(?:0+|미정|미확인|알\s*수\s*없음)(?:\s*[~～]\s*(?:0+|미정|미확인|알\s*수\s*없음))?$/u.test(applicationPeriod)
      ? `제공 신청 안내: ${applicationPeriod} (일정 원문 확인 필요)` : "";
    // Classify with the complete provider field. Some portal rows enumerate
    // many administrative areas and put "전국" after the old 220-character
    // display boundary; truncating before classification turned them into a
    // Seoul-only policy. Only the tag shown to users is shortened.
    const officialRegion = field(block, ["polyBizIscd", "sprtTrgtRgnCn"], 8_000);
    const officialRegionDisplay = cleanText(officialRegion, 220);
    const itemId = `youth-center-${stableId(policyId)}`;
    const officialUrl = field(block, ["rqutUrla", "rfcSiteUrla1", "aplyUrlAddr"], 800);
    const sourceUrl = safeSourceUrl(officialUrl, YOUTH_CENTER_HOME);
    const minAge = positiveAge(field(block, ["bgnAge", "sprtTrgtMinAge"], 40));
    const maxAge = positiveAge(field(block, ["endAge", "sprtTrgtMaxAge"], 40));
    const regions = regionsFromOfficialField(officialRegion);
    const regionScope = regionScopeFromOfficialField(officialRegion, regions);
    const classification = classifyYouthCenterPolicy(block, section);
    return [{
      id: itemId,
      category: "youth",
      title,
      summary: summaryWithApplicationPeriod([introduction, support, periodNotice], publicApplicationPeriodLabel(period.startsAt, period.expiresAt)),
      source: "온통청년",
      sourceUrl,
      sourceLinkKind: sourceUrl === YOUTH_CENTER_HOME ? "dataset" : "detail",
      ...normalizeYouthPortalSourceDates({
        frstRgstDt: field(block, ["frstRgstDt"], 80),
        lastUpdtDt: field(block, ["lastUpdtDt"], 80),
        lastCntcUpdtDt: field(block, ["lastCntcUpdtDt"], 80),
      }, nowIso, previous.get(itemId)),
      expiresAt: period.expiresAt,
      applicationStartsAt: period.startsAt,
      discoveredAt: previous.get(itemId)?.discoveredAt ?? nowIso,
      lastVerifiedAt: nowIso,
      tags: [
        ...classification.tags,
        ...(regionScope === "nationwide" ? ["전국"] : officialRegionDisplay ? [officialRegionDisplay] : []),
      ].slice(0, 12),
      youthPolicyEligibility: {
        regionScope,
        ...(minAge !== undefined ? { minAge } : {}),
        ...(maxAge !== undefined ? { maxAge } : {}),
        ...(regions.length ? { regions } : {}),
        interests: classification.interests,
      },
    }];
  });
  const total = youthCenterTotal(payload);
  if (total !== null && total > 0 && items.length === 0) {
    throw new UpstreamError(502, "youth_center_shape");
  }
  return items;
}

type UnknownJsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is UnknownJsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonField(
  record: UnknownJsonObject,
  names: readonly string[],
  maxLength = 600,
) {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" || typeof value === "number") {
      const cleaned = cleanText(String(value), maxLength);
      if (cleaned) return cleaned;
    }
  }
  return "";
}

function youthCenterPortalRecords(value: unknown, depth = 0): UnknownJsonObject[] {
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    const records = value.filter(isJsonObject);
    if (records.some((record) => jsonField(record, ["DOCID"], 140)
      && jsonField(record, ["PLCY_NM"], 300))) {
      return records;
    }
    return value.reduce<UnknownJsonObject[]>((best, candidate) => {
      const nested = youthCenterPortalRecords(candidate, depth + 1);
      return nested.length > best.length ? nested : best;
    }, []);
  }
  if (!isJsonObject(value)) return [];
  return Object.values(value).reduce<UnknownJsonObject[]>((best, candidate) => {
    const nested = youthCenterPortalRecords(candidate, depth + 1);
    return nested.length > best.length ? nested : best;
  }, []);
}

function youthCenterPortalTotal(value: unknown, depth = 0): number | null {
  if (depth > 4 || !isJsonObject(value)) return null;
  for (const [name, candidate] of Object.entries(value)) {
    if (!["totalcount", "totalcnt", "totcount", "total"].includes(name.toLowerCase())) continue;
    const parsed = typeof candidate === "number" ? candidate : Number(candidate);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  for (const candidate of Object.values(value)) {
    const nested = youthCenterPortalTotal(candidate, depth + 1);
    if (nested !== null) return nested;
  }
  return null;
}

export function normalizeYouthCenterPortalJson(
  payload: unknown,
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
) {
  if (!isJsonObject(payload)) throw new UpstreamError(502, "youth_center_portal_shape");
  const records = youthCenterPortalRecords(payload);
  const total = youthCenterPortalTotal(payload);
  const items = records.flatMap((record): PublicInformationItem[] => {
    const policyId = jsonField(record, ["DOCID"], 140);
    const title = jsonField(record, ["PLCY_NM"], 300);
    if (!policyId || !title) return [];
    const introduction = jsonField(record, ["PLCY_EXPLN_CN"], 500);
    const support = jsonField(record, ["PLCY_SPRT_CN"], 500);
    const beginsAt = normalizePublicDate(jsonField(record, ["APLY_PRD_BGNG_YMD"], 80));
    const endsAt = normalizePublicDate(jsonField(record, ["APLY_PRD_END_YMD"], 80));
    const applicationPeriod = publicApplicationPeriodLabel(beginsAt, endsAt);
    const officialRegion = jsonField(record, ["STDG_NM", "STDG_CTPV_NM"], 8_000);
    const officialRegionDisplay = cleanText(officialRegion, 220);
    const minAge = positiveAge(jsonField(record, ["SPRT_TRGT_MIN_AGE"], 40));
    const maxAge = positiveAge(jsonField(record, ["SPRT_TRGT_MAX_AGE"], 40));
    const regions = regionsFromOfficialField(officialRegion);
    const regionScope = regionScopeFromOfficialField(officialRegion, regions);
    const classification = classifyYouthCenterFields({
      majorName: jsonField(record, ["USER_LCLSF_NM"], 120),
      middleName: jsonField(record, ["USER_MCLSF_NM"], 120),
      keywordValue: jsonField(record, ["PLCY_KYWD_NM"], 400),
      majorCode: jsonField(record, ["USER_LCLSF_NO"], 80),
    }, "policy_news");
    const itemId = `youth-center-${stableId(policyId)}`;
    const detailUrl = new URL(
      `/youthPolicy/ythPlcyTotalSearch/ythPlcyDetail/${encodeURIComponent(policyId)}`,
      YOUTH_CENTER_HOME,
    ).toString();
    return [{
      id: itemId,
      category: "youth",
      title,
      summary: summaryWithApplicationPeriod([introduction, support], applicationPeriod),
      source: "온통청년",
      sourceUrl: detailUrl,
      sourceLinkKind: "detail",
      ...normalizeYouthPortalSourceDates(record, nowIso, previous.get(itemId)),
      expiresAt: endsAt,
      applicationStartsAt: beginsAt,
      discoveredAt: previous.get(itemId)?.discoveredAt ?? nowIso,
      lastVerifiedAt: nowIso,
      tags: [
        ...classification.tags,
        ...(regionScope === "nationwide" ? ["전국"] : officialRegionDisplay ? [officialRegionDisplay] : []),
      ].slice(0, 12),
      youthPolicyEligibility: {
        regionScope,
        ...(minAge !== undefined ? { minAge } : {}),
        ...(maxAge !== undefined ? { maxAge } : {}),
        ...(regions.length ? { regions } : {}),
        interests: classification.interests,
      },
    }];
  });
  if ((total !== null && total > 0 && items.length === 0)
    || (records.length > 0 && items.length === 0)) {
    throw new UpstreamError(502, "youth_center_portal_shape");
  }
  return { items, total };
}

function youthCenterPortalCookieHeader(headers: Headers) {
  const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof extendedHeaders.getSetCookie === "function"
    ? extendedHeaders.getSetCookie()
    : [headers.get("set-cookie") ?? ""];
  const cookies = new Map<string, string>();
  for (const value of values) {
    for (const match of value.matchAll(/(?:^|,\s*)([A-Za-z0-9_-]+)=([^;,\r\n]*)/gu)) {
      const name = match[1];
      const cookieValue = match[2].trim();
      if (
        !YOUTH_CENTER_PORTAL_COOKIES.has(name)
        || !cookieValue
        || cookieValue.length > 2_000
        || /[\s;,]/u.test(cookieValue)
      ) continue;
      cookies.set(name, cookieValue);
    }
  }
  if (cookies.size === 0) throw new UpstreamError(502, "youth_center_portal_session");
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function openYouthCenterPortalSession() {
  let response: Response;
  try {
    response = await fetch(YOUTH_CENTER_HOME, {
      signal: AbortSignal.timeout(12_000),
      redirect: "manual",
      headers: { Accept: "text/html,application/xhtml+xml;q=0.9" },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new UpstreamError(
      name === "TimeoutError" || name === "AbortError" ? 504 : 502,
      "youth_center_portal_network",
    );
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(502, "youth_center_portal_redirect");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(response.status, `youth_center_portal_http_${response.status}`);
  }
  if (response.url && new URL(response.url).origin !== new URL(YOUTH_CENTER_HOME).origin) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(502, "youth_center_portal_origin");
  }
  const cookieHeader = youthCenterPortalCookieHeader(response.headers);
  await response.body?.cancel().catch(() => undefined);
  return cookieHeader;
}

function youthCenterPortalRequest(page: number) {
  return {
    PVSN_INST_GROUP_CD: "",
    SPRT_TRGT_AGE: "",
    EARN_MIN_AMT: "",
    EARN_MAX_AMT: "",
    QLFC_ACBG_NM: "",
    MRG_STTS_CD: "",
    query: "",
    MJR_CND_NM: "",
    EMPM_STTS_NM: "",
    STDG_NM: "",
    SPCL_FLD_NM: "",
    USER_MCLSF_NO: "",
    STDG_CTPV_NM: "",
    PLCY_KYWD_SN: "",
    pageNum: page,
    sortFields: "DATE/DESC",
    listCount: YOUTH_CENTER_PORTAL_PAGE_SIZE,
    searchFields: "",
    APLY_PRD_BGNG_YMD: "",
    APLY_PRD_END_YMD: "",
    APLY_PRD_SE_CD: "",
    ODTM_CD: "",
  };
}

async function fetchYouthCenterPortalPage(page: number, cookieHeader: string) {
  let response: Response;
  try {
    response = await fetch(YOUTH_CENTER_PORTAL_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        Origin: new URL(YOUTH_CENTER_HOME).origin,
        Referer: YOUTH_CENTER_HOME,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(youthCenterPortalRequest(page)),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new UpstreamError(
      name === "TimeoutError" || name === "AbortError" ? 504 : 502,
      "youth_center_portal_network",
    );
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(502, "youth_center_portal_redirect");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(response.status, `youth_center_portal_http_${response.status}`);
  }
  if (response.url && new URL(response.url).origin !== new URL(YOUTH_CENTER_PORTAL_ENDPOINT).origin) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(502, "youth_center_portal_origin");
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !/^application\/json(?:;|$)/u.test(contentType)) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(502, "youth_center_portal_content_type");
  }
  let body: string;
  try {
    body = await readBoundedResponseText(response, 4_000_000);
  } catch {
    throw new UpstreamError(502, "youth_center_portal_body_invalid");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new UpstreamError(502, "youth_center_portal_body_invalid");
  }
}

async function loadYouthCenterPortal(
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
) {
  let requestCount = 1;
  const cookieHeader = await openYouthCenterPortalSession();
  const byId = new Map<string, PublicInformationItem>();
  let total: number | null = null;
  let exhausted = true;
  for (let page = 1; page <= YOUTH_CENTER_PORTAL_MAX_PAGES; page += 1) {
    requestCount += 1;
    const payload = await fetchYouthCenterPortalPage(page, cookieHeader);
    const normalized = normalizeYouthCenterPortalJson(payload, nowIso, previous);
    total = normalized.total;
    for (const item of normalized.items) byId.set(item.id, item);
    if (
      normalized.items.length < YOUTH_CENTER_PORTAL_PAGE_SIZE
      || (total !== null && total <= page * YOUTH_CENTER_PORTAL_PAGE_SIZE)
    ) {
      exhausted = false;
      break;
    }
  }
  return {
    items: [...byId.values()],
    requestCount,
    total,
    completeness: exhausted ? "truncated" as const : "complete" as const,
  };
}

interface YouthCenterOpenApiSectionState {
  section: YouthCenterSection;
  policyCodes: string;
  initialized: boolean;
  nextPage: number;
  total: number | null;
  fetchedCount: number;
  completed: boolean;
}

interface YouthCenterOpenApiState {
  version: 2;
  mode: "open-api";
  reconciliationDay: string;
  sections: YouthCenterOpenApiSectionState[];
}

interface YouthCenterPortalState {
  version: 2;
  mode: "portal";
  reconciliationDay: string;
  nextPage: number;
  total: number | null;
  fetchedCount: number;
  completed: boolean;
}

function youthCenterOpenApiSignature(reconciliationDay: string) {
  return `youth-center-open-v2-${backfillSignature(JSON.stringify({
    endpoint: YOUTH_CENTER_ENDPOINT,
    pageSize: YOUTH_CENTER_PAGE_SIZE,
    sections: YOUTH_CENTER_SECTIONS,
    reconciliationDay,
  }))}`;
}

function youthCenterPortalSignature(reconciliationDay: string) {
  return `youth-center-portal-v2-${backfillSignature(JSON.stringify({
    endpoint: YOUTH_CENTER_PORTAL_ENDPOINT,
    pageSize: YOUTH_CENTER_PORTAL_PAGE_SIZE,
    reconciliationDay,
  }))}`;
}

function safeCheckpointInteger(value: unknown, minimum: number, maximum = 1_000_000) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
    ? Number(value)
    : null;
}

function readYouthCenterOpenApiState(
  checkpoint: PublicBackfillCheckpoint | null,
  reconciliationDay: string,
) {
  if (
    !checkpoint
    || checkpoint.sourceId !== "youth-center"
    || checkpoint.querySignature !== youthCenterOpenApiSignature(reconciliationDay)
    || checkpoint.pageSize !== YOUTH_CENTER_PAGE_SIZE
  ) return null;
  try {
    const parsed = JSON.parse(checkpoint.queryState) as Partial<YouthCenterOpenApiState>;
    if (
      parsed.version !== 2
      || parsed.mode !== "open-api"
      || parsed.reconciliationDay !== reconciliationDay
      || !Array.isArray(parsed.sections)
    ) {
      return null;
    }
    const sections = YOUTH_CENTER_SECTIONS.map((config, index) => {
      const state = parsed.sections?.[index] as Partial<YouthCenterOpenApiSectionState> | undefined;
      const nextPage = safeCheckpointInteger(state?.nextPage, 1, 99_999);
      const fetchedCount = safeCheckpointInteger(state?.fetchedCount, 0);
      const total = state?.total === null
        ? null
        : safeCheckpointInteger(state?.total, 0);
      if (
        !state
        || state.section !== config.section
        || state.policyCodes !== config.policyCodes
        || typeof state.initialized !== "boolean"
        || typeof state.completed !== "boolean"
        || nextPage === null
        || fetchedCount === null
        || (state.total !== null && total === null)
      ) throw new Error("invalid");
      return {
        section: config.section,
        policyCodes: config.policyCodes,
        initialized: state.initialized,
        nextPage,
        total,
        fetchedCount,
        completed: state.completed,
      } satisfies YouthCenterOpenApiSectionState;
    });
    return {
      version: 2,
      mode: "open-api",
      reconciliationDay,
      sections,
    } satisfies YouthCenterOpenApiState;
  } catch {
    return null;
  }
}

function readYouthCenterPortalState(
  checkpoint: PublicBackfillCheckpoint | null,
  reconciliationDay: string,
) {
  if (
    !checkpoint
    || checkpoint.sourceId !== "youth-center"
    || checkpoint.querySignature !== youthCenterPortalSignature(reconciliationDay)
    || checkpoint.pageSize !== YOUTH_CENTER_PORTAL_PAGE_SIZE
  ) return null;
  try {
    const parsed = JSON.parse(checkpoint.queryState) as Partial<YouthCenterPortalState>;
    const nextPage = safeCheckpointInteger(parsed.nextPage, 1);
    const fetchedCount = safeCheckpointInteger(parsed.fetchedCount, 0);
    const total = parsed.total === null ? null : safeCheckpointInteger(parsed.total, 0);
    if (
      parsed.version !== 2
      || parsed.mode !== "portal"
      || parsed.reconciliationDay !== reconciliationDay
      || typeof parsed.completed !== "boolean"
      || nextPage === null
      || fetchedCount === null
      || (parsed.total !== null && total === null)
    ) return null;
    return {
      version: 2,
      mode: "portal",
      reconciliationDay,
      nextPage,
      total,
      fetchedCount,
      completed: parsed.completed,
    } satisfies YouthCenterPortalState;
  } catch {
    return null;
  }
}

function youthCenterOpenApiCheckpoint(
  state: YouthCenterOpenApiState,
  now: number,
  completedAt: number | null,
): PublicBackfillCheckpoint {
  const firstIncompleteIndex = state.sections.findIndex((section) => !section.completed);
  const completed = firstIncompleteIndex < 0;
  const totalsKnown = state.sections.every((section) => section.initialized && section.total !== null);
  return {
    sourceId: "youth-center",
    querySignature: youthCenterOpenApiSignature(state.reconciliationDay),
    queryState: JSON.stringify(state),
    nextPage: completed
      ? 1
      : (firstIncompleteIndex + 1) * YOUTH_CENTER_SECTION_PAGE_STRIDE
        + state.sections[firstIncompleteIndex].nextPage,
    pageSize: YOUTH_CENTER_PAGE_SIZE,
    providerTotalCount: totalsKnown
      ? state.sections.reduce((sum, section) => sum + (section.total ?? 0), 0)
      : null,
    fetchedCount: state.sections.reduce((sum, section) => sum + section.fetchedCount, 0),
    completed,
    latestRefreshAt: now,
    completedAt: completed ? completedAt ?? now : null,
    updatedAt: now,
  };
}

function youthCenterPortalCheckpoint(
  state: YouthCenterPortalState,
  now: number,
  completedAt: number | null,
): PublicBackfillCheckpoint {
  return {
    sourceId: "youth-center",
    querySignature: youthCenterPortalSignature(state.reconciliationDay),
    queryState: JSON.stringify(state),
    nextPage: state.nextPage,
    pageSize: YOUTH_CENTER_PORTAL_PAGE_SIZE,
    providerTotalCount: state.total,
    fetchedCount: state.fetchedCount,
    completed: state.completed,
    latestRefreshAt: now,
    completedAt: state.completed ? completedAt ?? now : null,
    updatedAt: now,
  };
}

function youthCenterOpenApiEndpoint(
  apiKey: string,
  config: YouthCenterSectionConfig,
  page: number,
) {
  const endpoint = new URL(YOUTH_CENTER_ENDPOINT);
  endpoint.searchParams.set("openApiVlak", apiKey);
  endpoint.searchParams.set("pageIndex", String(page));
  endpoint.searchParams.set("display", String(YOUTH_CENTER_PAGE_SIZE));
  endpoint.searchParams.set("bizTycdSel", config.policyCodes);
  return endpoint;
}

function preferredYouthCenterError(errors: readonly unknown[]) {
  return errors.find((candidate) => failureKind(candidate) === "authorization")
    ?? errors.find((candidate) => failureKind(candidate) === "quota")
    ?? errors[0]
    ?? new UpstreamError(502, "adapter_exception");
}

async function checkpointedYouthCenterPortal(
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
  runtime: PublicBackfillRuntime,
  empty: SupplementalPublicAdapterResult,
  initialRequestCount = 0,
): Promise<SupplementalPublicAdapterResult> {
  let requestCount = initialRequestCount;
  try {
    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) throw new UpstreamError(500, "youth_center_invalid_now");
    const reconciliationDay = kstBackfillGeneration(nowIso);
    requestCount += 1;
    const cookieHeader = await openYouthCenterPortalSession();
    requestCount += 1;
    const first = normalizeYouthCenterPortalJson(
      await fetchYouthCenterPortalPage(1, cookieHeader),
      nowIso,
      previous,
    );
    let stored = readYouthCenterPortalState(runtime.checkpoint, reconciliationDay);
    if (stored && stored.total !== first.total) stored = null;
    const requiredPages = first.total === null
      ? null
      : Math.max(1, Math.ceil(first.total / YOUTH_CENTER_PORTAL_PAGE_SIZE));
    const completed = requiredPages !== null
      ? requiredPages <= 1 || Boolean(stored?.completed && stored.nextPage > requiredPages)
      : first.items.length < YOUTH_CENTER_PORTAL_PAGE_SIZE;
    let state: YouthCenterPortalState = {
      version: 2,
      mode: "portal",
      reconciliationDay,
      nextPage: completed
        ? (requiredPages ?? 1) + 1
        : Math.max(2, stored?.nextPage ?? 2),
      total: first.total,
      fetchedCount: completed && first.total !== null
        ? first.total
        : Math.max(first.items.length, stored?.fetchedCount ?? 0),
      completed,
    };
    let checkpoint = youthCenterPortalCheckpoint(
      state,
      now,
      completed ? runtime.checkpoint?.completedAt ?? null : null,
    );
    const singlePage = requiredPages !== null && requiredPages <= 1;
    const stagedById = new Map((stored && !singlePage ? runtime.stagedItems : [])
      .filter((item) => item.id.startsWith("youth-center-"))
      .map((item) => [item.id, item]));
    for (const item of first.items) stagedById.set(item.id, item);
    try {
      await runtime.commitPage({ checkpoint, pageNumber: stored && !singlePage ? 0 : 1,
        items: first.items, resetGeneration: !stored || singlePage });
    } catch {
      throw new UpstreamError(500, "youth_center_checkpoint_commit_failed");
    }

    let partialError: unknown = null;
    const maximumPages = Math.max(1, Math.trunc(runtime.maxBackfillPagesPerRun));
    const firstBackfillPage = state.nextPage;
    for (
      let page = firstBackfillPage;
      !state.completed && page < firstBackfillPage + maximumPages;
      page += 1
    ) {
      try {
        requestCount += 1;
        const normalized = normalizeYouthCenterPortalJson(
          await fetchYouthCenterPortalPage(page, cookieHeader),
          nowIso,
          previous,
        );
        if (
          state.total !== null
          && normalized.total !== null
          && normalized.total !== state.total
        ) throw new UpstreamError(502, "youth_center_total_changed");
        const pageCompleted = state.total !== null
          ? state.total <= page * YOUTH_CENTER_PORTAL_PAGE_SIZE
          : normalized.items.length < YOUTH_CENTER_PORTAL_PAGE_SIZE;
        state = {
          ...state,
          nextPage: page + 1,
          fetchedCount: state.total === null
            ? state.fetchedCount + normalized.items.length
            : Math.min(state.total, state.fetchedCount + normalized.items.length),
          completed: pageCompleted,
        };
        checkpoint = youthCenterPortalCheckpoint(
          state,
          now,
          pageCompleted ? now : null,
        );
        await runtime.commitPage({ checkpoint, pageNumber: page, items: normalized.items });
        for (const item of normalized.items) stagedById.set(item.id, item);
      } catch (error) {
        partialError = error instanceof UpstreamError
          ? error
          : new UpstreamError(500, "youth_center_checkpoint_commit_failed");
        break;
      }
    }

    const items = [...stagedById.values()];
    const completeness = partialError
      ? "partial" as const
      : state.completed
        ? "complete" as const
        : "truncated" as const;
    return {
      ...empty,
      source: {
        ...source(
          "youth-center",
          "온통청년 청년정책",
          completeness === "complete" ? "live" : completeness,
          YOUTH_CENTER_GUIDE,
          items.length,
        ),
        providerTotalCount: state.total,
        fetchedCount: state.fetchedCount,
        completeness,
        errorCode: partialError
          ? errorCode(partialError)
          : state.completed
            ? undefined
            : "youth_center_backfill_in_progress",
      },
      items,
      asOf: items.find((item) => item.publishedAt)?.publishedAt ?? nowIso,
      requestCount,
      incremental: true,
      ...(partialError ? { failureKind: failureKind(partialError) } : {}),
    };
  } catch (error) {
    return {
      ...empty,
      source: {
        ...source(
          "youth-center",
          "온통청년 청년정책",
          sourceStatus(error),
          YOUTH_CENTER_GUIDE,
        ),
        errorCode: errorCode(error),
      },
      requestCount,
      failureKind: failureKind(error),
      incremental: true,
    };
  }
}

async function checkpointedYouthCenterOpenApi(
  apiKey: string,
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
  runtime: PublicBackfillRuntime,
  empty: SupplementalPublicAdapterResult,
): Promise<SupplementalPublicAdapterResult> {
  let requestCount = 0;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) {
    return {
      ...empty,
      source: {
        ...source("youth-center", "온통청년 청년정책", "unavailable", YOUTH_CENTER_GUIDE),
        errorCode: "youth_center_invalid_now",
      },
      requestCount,
      failureKind: "transient",
      incremental: true,
    };
  }
  const reconciliationDay = kstBackfillGeneration(nowIso);
  const storedPortal = readYouthCenterPortalState(runtime.checkpoint, reconciliationDay);
  if (storedPortal) {
    return checkpointedYouthCenterPortal(nowIso, previous, runtime, empty);
  }
  const stored = readYouthCenterOpenApiState(runtime.checkpoint, reconciliationDay);
  let state: YouthCenterOpenApiState = stored ?? {
    version: 2,
    mode: "open-api",
    reconciliationDay,
    sections: YOUTH_CENTER_SECTIONS.map((config) => ({
      ...config,
      initialized: false,
      nextPage: 2,
      total: null,
      fetchedCount: 0,
      completed: false,
    })),
  };
  const stagedById = new Map((stored ? runtime.stagedItems : [])
    .filter((item) => item.id.startsWith("youth-center-"))
    .map((item) => [item.id, item]));
  const errors: unknown[] = [];
  let successfulLatestPages = 0;
  let resetStoredSection = false;
  let checkpoint = youthCenterOpenApiCheckpoint(state, now, runtime.checkpoint?.completedAt ?? null);

  for (const [index, config] of YOUTH_CENTER_SECTIONS.entries()) {
    requestCount += 1;
    try {
      const payload = await fetchText(youthCenterOpenApiEndpoint(apiKey, config, 1));
      const items = normalizeYouthCenterXml(payload, config.section, nowIso, previous);
      const total = youthCenterTotal(payload);
      const requiredPages = total === null
        ? null
        : Math.max(1, Math.ceil(total / YOUTH_CENTER_PAGE_SIZE));
      const prior = state.sections[index];
      const restart = !prior.initialized || prior.total !== total
        || requiredPages !== null && requiredPages <= 1;
      const completed = requiredPages !== null
        ? requiredPages <= 1 || Boolean(!restart && prior.completed && prior.nextPage > requiredPages)
        : items.length < YOUTH_CENTER_PAGE_SIZE;
      const nextState: YouthCenterOpenApiState = {
        ...state,
        sections: state.sections.map((section, sectionIndex) => sectionIndex === index
          ? {
              ...section,
              initialized: true,
              nextPage: completed
                ? (requiredPages ?? 1) + 1
                : restart ? 2 : Math.max(2, prior.nextPage),
              total,
              fetchedCount: completed && total !== null
                ? total
                : restart ? items.length : Math.max(items.length, prior.fetchedCount),
              completed,
            }
          : section),
      };
      const nextCheckpoint = youthCenterOpenApiCheckpoint(
        nextState,
        now,
        checkpoint.completedAt,
      );
      await runtime.commitPage({ checkpoint: nextCheckpoint,
        pageNumber: restart ? (index + 1) * YOUTH_CENTER_SECTION_PAGE_STRIDE + 1 : index,
        items, ...(restart ? { resetSection: index } : {}) });
      if (restart && prior.initialized) resetStoredSection = true;
      state = nextState;
      checkpoint = nextCheckpoint;
      for (const item of items) stagedById.set(item.id, item);
      successfulLatestPages += 1;
    } catch (error) {
      if (successfulLatestPages === 0 && errorCode(error) === "upstream_redirect") {
        return checkpointedYouthCenterPortal(
          nowIso,
          previous,
          runtime,
          empty,
          requestCount,
        );
      }
      errors.push(error instanceof UpstreamError
        ? error
        : new UpstreamError(500, "youth_center_checkpoint_commit_failed"));
    }
  }

  if (successfulLatestPages === 0) {
    const error = preferredYouthCenterError(errors);
    return {
      ...empty,
      source: {
        ...source(
          "youth-center",
          "온통청년 청년정책",
          sourceStatus(error),
          YOUTH_CENTER_GUIDE,
        ),
        errorCode: errorCode(error),
      },
      requestCount,
      failureKind: failureKind(error),
      incremental: true,
    };
  }

  let partialError: unknown = null;
  let remainingPages = Math.max(1, Math.trunc(runtime.maxBackfillPagesPerRun));
  while (remainingPages > 0) {
    const sectionIndex = state.sections.findIndex((section) => (
      section.initialized && !section.completed
    ));
    if (sectionIndex < 0) break;
    const section = state.sections[sectionIndex];
    const config = YOUTH_CENTER_SECTIONS[sectionIndex];
    const page = section.nextPage;
    const pageNumber = (sectionIndex + 1) * YOUTH_CENTER_SECTION_PAGE_STRIDE + page;
    if (pageNumber > 1_000_000) {
      partialError = new UpstreamError(502, "youth_center_page_overflow");
      break;
    }
    requestCount += 1;
    try {
      const payload = await fetchText(youthCenterOpenApiEndpoint(apiKey, config, page));
      const items = normalizeYouthCenterXml(payload, config.section, nowIso, previous);
      const total = youthCenterTotal(payload);
      if (section.total !== null && total !== null && total !== section.total) {
        throw new UpstreamError(502, "youth_center_total_changed");
      }
      const effectiveTotal = section.total ?? total;
      const completed = effectiveTotal !== null
        ? effectiveTotal <= page * YOUTH_CENTER_PAGE_SIZE
        : items.length < YOUTH_CENTER_PAGE_SIZE;
      const nextState: YouthCenterOpenApiState = {
        ...state,
        sections: state.sections.map((candidate, index) => index === sectionIndex
          ? {
              ...candidate,
              nextPage: page + 1,
              total: effectiveTotal,
              fetchedCount: effectiveTotal === null
                ? candidate.fetchedCount + items.length
                : Math.min(effectiveTotal, candidate.fetchedCount + items.length),
              completed,
            }
          : candidate),
      };
      const nextCheckpoint = youthCenterOpenApiCheckpoint(
        nextState,
        now,
        completed && nextState.sections.every((candidate) => candidate.completed)
          ? now
          : null,
      );
      await runtime.commitPage({ checkpoint: nextCheckpoint, pageNumber, items });
      state = nextState;
      checkpoint = nextCheckpoint;
      for (const item of items) stagedById.set(item.id, item);
      remainingPages -= 1;
    } catch (error) {
      partialError = error instanceof UpstreamError
        ? error
        : new UpstreamError(500, "youth_center_checkpoint_commit_failed");
      break;
    }
  }

  if (partialError) errors.push(partialError);
  checkpoint = youthCenterOpenApiCheckpoint(
    state,
    now,
    state.sections.every((section) => section.completed) ? now : null,
  );
  let items = [...stagedById.values()];
  if (checkpoint.completed && !errors.length) {
    try {
      if (runtime.readCommittedItems) items = await runtime.readCommittedItems(checkpoint);
      else if (resetStoredSection) throw new Error("committed_staging_reader_required");
    } catch {
      errors.push(new UpstreamError(500, "youth_center_committed_staging_invalid"));
    }
  }
  const completeness = errors.length
    ? "partial" as const
    : checkpoint.completed
      ? "complete" as const
      : "truncated" as const;
  const error = errors.length ? preferredYouthCenterError(errors) : null;
  return {
    ...empty,
    source: {
      ...source(
        "youth-center",
        "온통청년 청년정책",
        completeness === "complete" ? "live" : completeness,
        YOUTH_CENTER_GUIDE,
        items.length,
      ),
      providerTotalCount: checkpoint.providerTotalCount,
      fetchedCount: checkpoint.fetchedCount,
      completeness,
      errorCode: error
        ? errorCode(error)
        : checkpoint.completed
          ? undefined
          : "youth_center_backfill_in_progress",
    },
    items,
    asOf: items.find((item) => item.publishedAt)?.publishedAt ?? nowIso,
    requestCount,
    incremental: true,
    ...(error ? { failureKind: failureKind(error) } : {}),
  };
}

export async function youthCenterAdapter(
  apiKey: string | null,
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
  backfill?: PublicBackfillRuntime,
): Promise<SupplementalPublicAdapterResult> {
  const empty = emptyResult("youth-center", "온통청년 청년정책", YOUTH_CENTER_GUIDE);
  if (!apiKey) return empty;
  if (backfill) {
    return checkpointedYouthCenterOpenApi(apiKey, nowIso, previous, backfill, empty);
  }
  let requestCount = 0;
  const loadSection = async ({ section, policyCodes }: YouthCenterSectionConfig) => {
    const items: PublicInformationItem[] = [];
    let hasNextPage = true;
    let total: number | null = null;
    let partial = false;
    for (let page = 1; page <= YOUTH_CENTER_MAX_PAGES && hasNextPage; page += 1) {
      const endpoint = new URL(YOUTH_CENTER_ENDPOINT);
      endpoint.searchParams.set("openApiVlak", apiKey);
      endpoint.searchParams.set("pageIndex", String(page));
      endpoint.searchParams.set("display", String(YOUTH_CENTER_PAGE_SIZE));
      endpoint.searchParams.set("bizTycdSel", policyCodes);
      requestCount += 1;
      try {
        const payload = await fetchText(endpoint);
        const pageItems = normalizeYouthCenterXml(payload, section, nowIso, previous);
        items.push(...pageItems);
        total = youthCenterTotal(payload);
        hasNextPage = total === null
          ? pageItems.length >= YOUTH_CENTER_PAGE_SIZE
          : total > page * YOUTH_CENTER_PAGE_SIZE;
      } catch (error) {
        if (page === 1) throw error;
        partial = true;
        hasNextPage = false;
      }
    }
    return {
      items,
      total,
      completeness: partial
        ? "partial" as const
        : hasNextPage
          ? "truncated" as const
          : "complete" as const,
    };
  };

  const successful: Awaited<ReturnType<typeof loadSection>>[] = [];
  const errors: unknown[] = [];
  try {
    successful.push(await loadSection(YOUTH_CENTER_SECTIONS[0]));
  } catch (error) {
    if (errorCode(error) === "upstream_redirect") {
      try {
        const portal = await loadYouthCenterPortal(nowIso, previous);
        requestCount += portal.requestCount;
        const items = portal.items;
        return {
          ...empty,
          source: {
            ...source(
              "youth-center",
              "온통청년 청년정책",
              portal.completeness === "complete" ? "live" : "truncated",
              YOUTH_CENTER_GUIDE,
              items.length,
            ),
            providerTotalCount: portal.total,
            fetchedCount: items.length,
            completeness: portal.completeness,
          },
          items,
          asOf: items.find((item) => item.publishedAt)?.publishedAt ?? nowIso,
          requestCount,
        };
      } catch (portalError) {
        return {
          ...empty,
          source: {
            ...source(
              "youth-center",
              "온통청년 청년정책",
              sourceStatus(portalError),
              YOUTH_CENTER_GUIDE,
            ),
            errorCode: errorCode(portalError),
          },
          requestCount,
          failureKind: failureKind(portalError),
        };
      }
    }
    errors.push(error);
  }

  const settled = await Promise.allSettled(YOUTH_CENTER_SECTIONS.slice(1).map(loadSection));
  for (const result of settled) {
    if (result.status === "fulfilled") successful.push(result.value);
    else errors.push(result.reason);
  }
  if (successful.length === 0) {
    const error = errors.find((candidate) => failureKind(candidate) === "authorization")
      ?? errors.find((candidate) => failureKind(candidate) === "quota")
      ?? errors[0]
      ?? new UpstreamError(502, "adapter_exception");
    return {
      ...empty,
      source: { ...source("youth-center", "온통청년 청년정책", sourceStatus(error), YOUTH_CENTER_GUIDE), errorCode: errorCode(error) },
      requestCount,
      failureKind: failureKind(error),
    };
  }

  const byId = new Map<string, PublicInformationItem>();
  for (const item of successful.flatMap((result) => result.items)) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  const items = [...byId.values()];
  const completeness = errors.length || successful.some((result) => result.completeness === "partial")
    ? "partial"
    : successful.some((result) => result.completeness === "truncated")
      ? "truncated"
      : "complete";
  const providerTotalCount = successful.every((result) => result.total !== null)
    ? successful.reduce((sum, result) => sum + (result.total ?? 0), 0)
    : null;
  return {
    ...empty,
    source: {
      ...source(
        "youth-center",
        "온통청년 청년정책",
        completeness === "complete" ? "live" : completeness,
        YOUTH_CENTER_GUIDE,
        items.length,
      ),
      providerTotalCount,
      fetchedCount: items.length,
      completeness,
    },
    items,
    asOf: items.find((item) => item.publishedAt)?.publishedAt ?? nowIso,
    requestCount,
  };
}

// The MOEL search itself is scoped to "청년". Keep the local relevance gate
// broad enough for Korean particles and compound nouns such as 청년이,
// 청년세대, and 청년일경험; the previous suffix allow-list incorrectly
// treated a structurally valid result page as an upstream shape failure.
const YOUTH_NEWS_TERMS = /청년/u;
const YOUTH_EMPLOYMENT_NEWS_TERMS =
  /일자리|고용|채용(?:박람회|행사|지원|정보)|구직|취업(?:지원|준비|상담|역량)|일경험|인턴|직업훈련|내일배움/u;

export function normalizeMoelPolicyRss(
  payload: string,
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
) {
  if (!/<rss(?:\s[^>]*)?>/iu.test(payload) || !/<channel(?:\s[^>]*)?>/iu.test(payload)) {
    throw new UpstreamError(502, "moel_rss_shape");
  }
  return blocks(payload, "item").flatMap((block): PublicInformationItem[] => {
    const title = field(block, ["title"], 300);
    const description = field(block, ["description"], 700);
    if (!title || !YOUTH_NEWS_TERMS.test(`${title} ${description}`)) return [];
    const link = safeSourceUrl(field(block, ["link"], 800), MOEL_RSS_GUIDE, ["moel.go.kr"]);
    const guid = field(block, ["guid"], 300) || link || title;
    const itemId = `moel-news-${stableId(guid)}`;
    const employmentInformation = YOUTH_EMPLOYMENT_NEWS_TERMS.test(`${title} ${description}`);
    return [{
      id: itemId,
      category: "youth",
      title,
      summary: description,
      source: "고용노동부 정책자료",
      sourceUrl: link,
      sourceLinkKind: link === MOEL_RSS_GUIDE ? "dataset" : "detail",
      publishedAt: normalizeDate(field(block, ["pubDate", "dc:date", "dcDate", "date"], 120)),
      discoveredAt: previous.get(itemId)?.discoveredAt ?? nowIso,
      lastVerifiedAt: nowIso,
      tags: employmentInformation
        ? ["취업지원", "정부 정책뉴스", "청년", "section:employment", "전국"]
        : ["정부 정책뉴스", "청년", "section:policy-news", "전국"],
      ...(employmentInformation
        ? {
          youthPolicyEligibility: {
            regionScope: "nationwide" as const,
            interests: ["employment"] as YouthPolicyInterest[],
          },
        }
        : {}),
    }];
  });
}

export async function moelPolicyNewsAdapter(
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
): Promise<SupplementalPublicAdapterResult> {
  const label = "고용노동부 청년 정책자료";
  const empty = emptyResult("moel-policy-news", label, MOEL_RSS_GUIDE);
  try {
    const items = normalizeMoelPolicyRss(await fetchText(new URL(MOEL_RSS_ENDPOINT)), nowIso, previous);
    return {
      ...empty,
      source: source("moel-policy-news", label, "live", MOEL_RSS_GUIDE, items.length),
      items,
      asOf: items.find((item) => item.publishedAt)?.publishedAt ?? nowIso,
      requestCount: 1,
    };
  } catch (error) {
    return {
      ...empty,
      source: { ...source("moel-policy-news", label, sourceStatus(error), MOEL_RSS_GUIDE), errorCode: errorCode(error) },
      requestCount: 1,
      failureKind: failureKind(error),
    };
  }
}

export interface MoelPressCandidate {
  newsSequence: string;
  title: string;
  publishedAt: string | null;
  sourceUrl: string;
}

function htmlAttribute(tag: string, name: string, maximumLength = 1_000) {
  const safeName = name.replace(/[^A-Za-z0-9_:-]/gu, "");
  if (!safeName) return "";
  const match = new RegExp(`\\b${safeName}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "iu").exec(tag);
  return cleanText(match?.[2], maximumLength);
}

function moelPressListUrl(page = 1) {
  const url = new URL(MOEL_PRESS_LIST_ENDPOINT);
  url.searchParams.set("searchField", "3");
  url.searchParams.set("searchText", "청년");
  url.searchParams.set("pageIndex", String(page));
  url.searchParams.set("pageUnit", String(MOEL_PRESS_PAGE_SIZE));
  return url;
}

function isRecentMoelPressDate(value: string | null, now: number) {
  if (!value) return true;
  const endOfKstDay = Date.parse(`${value}T23:59:59.999+09:00`);
  return Number.isFinite(endOfKstDay)
    && endOfKstDay >= now - MOEL_PRESS_RECENT_DAYS * 24 * 60 * 60 * 1_000;
}

export function normalizeMoelPressListHtml(payload: string): MoelPressCandidate[] {
  const tableBodies = [...payload.matchAll(/<tbody(?:\s[^>]*)?>([\s\S]*?)<\/tbody>/giu)]
    .map((match) => match[1]);
  if (!tableBodies.length) throw new UpstreamError(502, "moel_press_list_shape");
  const tableBody = tableBodies.find((body) => /enewsView\.do\?news_seq=/u.test(body));
  if (!tableBody) {
    const visibleText = cleanText(tableBodies.join(" "), 20_000);
    if (/(?:검색(?:된)?\s*(?:자료|내용|결과)\s*(?:가|이)?\s*없|총\s*0\s*건)/u.test(visibleText)) {
      return [];
    }
    throw new UpstreamError(502, "moel_press_list_shape");
  }

  const candidates = new Map<string, MoelPressCandidate>();
  for (const rowMatch of tableBody.matchAll(/<tr(?:\s[^>]*)?>([\s\S]*?)<\/tr>/giu)) {
    const row = rowMatch[1];
    const dateMatch = /<td\b[^>]*aria-label\s*=\s*(["'])등록일\1[^>]*>([\s\S]*?)<\/td>/iu.exec(row);
    const publishedAt = normalizeDate(cleanText(dateMatch?.[2], 80));
    for (const anchorMatch of row.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/giu)) {
      const href = htmlAttribute(anchorMatch[1], "href");
      const sequence = /(?:^|[?&])news_seq=(\d{1,12})(?:&|$)/u.exec(href)?.[1] ?? "";
      if (!sequence) continue;
      const title = htmlAttribute(anchorMatch[1], "title", 400)
        || cleanText(anchorMatch[2], 400);
      if (!title || !YOUTH_NEWS_TERMS.test(title)) continue;
      const sourceUrl = new URL(
        `enewsView.do?news_seq=${encodeURIComponent(sequence)}`,
        MOEL_PRESS_LIST_ENDPOINT,
      ).toString();
      candidates.set(sequence, {
        newsSequence: sequence,
        title,
        publishedAt,
        sourceUrl,
      });
      break;
    }
  }
  const normalized = [...candidates.values()];
  if (
    normalized.length === 0
    && !/(?:검색(?:된)?\s*(?:자료|내용|결과)\s*(?:가|이)?\s*없|총\s*0\s*건)/u.test(
      cleanText(tableBody, 20_000),
    )
  ) {
    throw new UpstreamError(502, "moel_press_list_shape");
  }
  return normalized;
}

function verifiedPreviousMoelPress(
  candidate: MoelPressCandidate,
  previous: ReadonlyMap<string, PublicInformationItem>,
) {
  const item = previous.get(`moel-report-${candidate.newsSequence}`);
  return item?.category === "youth"
    && item.sourceUrl === candidate.sourceUrl
    && item.sourceLinkKind === "detail"
    ? item
    : null;
}

function listVerifiedPreviousMoelPress(
  candidate: MoelPressCandidate,
  previous: ReadonlyMap<string, PublicInformationItem>,
  nowIso: string,
) {
  const item = verifiedPreviousMoelPress(candidate, previous);
  if (
    !item
    || item.title !== candidate.title
    || (candidate.publishedAt !== null && item.publishedAt !== candidate.publishedAt)
  ) return null;
  return {
    ...item,
    publishedAt: candidate.publishedAt ?? item.publishedAt,
    lastVerifiedAt: nowIso,
  };
}

export function normalizeMoelPressDetailHtml(
  payload: string,
  candidate: MoelPressCandidate,
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
): PublicInformationItem {
  if (
    !/^\d{1,12}$/u.test(candidate.newsSequence)
    || candidate.sourceUrl !== new URL(
      `enewsView.do?news_seq=${encodeURIComponent(candidate.newsSequence)}`,
      MOEL_PRESS_LIST_ENDPOINT,
    ).toString()
  ) throw new UpstreamError(502, "moel_press_candidate");
  if (!/<div\b[^>]*class\s*=\s*(["'])[^"']*\bboard_view_wrap\b[^"']*\1[^>]*>/iu.test(payload)) {
    throw new UpstreamError(502, "moel_press_detail_shape");
  }
  const contentMatch = /<div\b[^>]*class\s*=\s*(["'])[^"']*\bb_content\b[^"']*\bnews_content\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/iu.exec(payload);
  if (!contentMatch) throw new UpstreamError(502, "moel_press_detail_shape");
  const strongMatch = /<strong(?:\s[^>]*)?>([\s\S]*?)<\/strong>/iu.exec(contentMatch[2]);
  const fullBody = cleanText(contentMatch[2], 1_500);
  const preferred = cleanText(strongMatch?.[1], 900);
  const withoutContact = (preferred.length >= 30 ? preferred : fullBody)
    .split(/\s*문\s*의\s*:/u)[0]
    .trim()
    .slice(0, 900);
  if (!withoutContact) throw new UpstreamError(502, "moel_press_detail_shape");
  const itemId = `moel-report-${candidate.newsSequence}`;
  const employmentInformation = YOUTH_EMPLOYMENT_NEWS_TERMS.test(`${candidate.title} ${withoutContact}`);
  return {
    id: itemId,
    category: "youth",
    title: candidate.title,
    summary: withoutContact,
    source: "고용노동부 보도자료",
    sourceUrl: candidate.sourceUrl,
    sourceLinkKind: "detail",
    publishedAt: candidate.publishedAt,
    discoveredAt: previous.get(itemId)?.discoveredAt ?? nowIso,
    lastVerifiedAt: nowIso,
    tags: [
      ...(employmentInformation ? ["취업지원"] : []),
      "정부 정책뉴스",
      "청년",
      "section:policy-news",
      "전국",
    ],
  };
}

export async function moelPressReleasesAdapter(
  nowIso: string,
  previous: ReadonlyMap<string, PublicInformationItem>,
  fetchImpl: MoelPressFetch = fetch,
): Promise<SupplementalPublicAdapterResult> {
  const label = "고용노동부 청년 보도자료";
  const empty = emptyResult("moel-press-releases", label, MOEL_PRESS_LIST_ENDPOINT);
  let requestCount = 0;
  try {
    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) throw new UpstreamError(500, "moel_press_invalid_now");

    const candidatesBySequence = new Map<string, MoelPressCandidate>();
    let reachedRecentWindowBoundary = false;
    let pagesFetched = 0;
    for (let page = 1; page <= MOEL_PRESS_MAX_LIST_PAGES; page += 1) {
      requestCount += 1;
      pagesFetched = page;
      const pageCandidates = normalizeMoelPressListHtml(
        await fetchMoelHtml(moelPressListUrl(page), fetchImpl),
      );
      if (pageCandidates.length === 0) {
        reachedRecentWindowBoundary = true;
        break;
      }
      for (const candidate of pageCandidates) {
        if (!isRecentMoelPressDate(candidate.publishedAt, now)) {
          reachedRecentWindowBoundary = true;
          continue;
        }
        candidatesBySequence.set(candidate.newsSequence, candidate);
      }
      if (reachedRecentWindowBoundary) break;
    }

    const candidates = [...candidatesBySequence.values()];
    const itemsById = new Map<string, PublicInformationItem>();
    const detailCandidates: MoelPressCandidate[] = [];
    let detailBackfillIncomplete = false;
    for (const candidate of candidates) {
      const cached = listVerifiedPreviousMoelPress(candidate, previous, nowIso);
      if (cached) {
        itemsById.set(cached.id, cached);
      } else if (detailCandidates.length < MOEL_PRESS_MAX_DETAILS) {
        detailCandidates.push(candidate);
      } else {
        detailBackfillIncomplete = true;
      }
    }

    requestCount += detailCandidates.length;
    const settled = await Promise.all(detailCandidates.map(async (candidate) => {
      try {
        const detail = await fetchMoelHtml(new URL(candidate.sourceUrl), fetchImpl);
        return {
          fresh: true,
          item: normalizeMoelPressDetailHtml(detail, candidate, nowIso, previous),
        };
      } catch (error) {
        if (!(error instanceof UpstreamError)) throw error;
        return {
          fresh: false,
          item: verifiedPreviousMoelPress(candidate, previous),
        };
      }
    }));
    for (const { item } of settled) {
      if (item) itemsById.set(item.id, item);
    }
    const freshDetailCount = settled.filter(({ fresh }) => fresh).length;
    const failedDetailCount = settled.length - freshDetailCount;
    if (detailCandidates.length > 0 && freshDetailCount === 0) {
      throw new UpstreamError(502, "moel_press_details_unavailable");
    }

    const listWindowTruncated = !reachedRecentWindowBoundary
      && pagesFetched >= MOEL_PRESS_MAX_LIST_PAGES;
    const status = failedDetailCount > 0
      ? "partial" as const
      : listWindowTruncated || detailBackfillIncomplete
        ? "truncated" as const
        : "live" as const;
    const completeness = status === "live"
      ? "complete" as const
      : status;
    const collectionError = failedDetailCount > 0
      ? "moel_press_detail_partial"
      : detailBackfillIncomplete
        ? "moel_press_backfill_in_progress"
        : listWindowTruncated
          ? "moel_press_recent_window_truncated"
          : undefined;
    const items = [...itemsById.values()];
    return {
      ...empty,
      source: {
        ...source("moel-press-releases", label, status, MOEL_PRESS_LIST_ENDPOINT, items.length),
        fetchedCount: candidates.length,
        completeness,
        errorCode: collectionError,
      },
      items,
      asOf: items.map((item) => item.publishedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? nowIso,
      requestCount,
      incremental: true,
      ...(failedDetailCount > 0 ? { failureKind: "transient" as const } : {}),
    };
  } catch (error) {
    const status = sourceStatus(error) === "authorization-pending"
      ? "unavailable"
      : sourceStatus(error);
    const kind = failureKind(error) === "authorization"
      ? "transient"
      : failureKind(error);
    return {
      ...empty,
      source: {
        ...source("moel-press-releases", label, status, MOEL_PRESS_LIST_ENDPOINT),
        errorCode: errorCode(error),
      },
      requestCount,
      failureKind: kind,
      incremental: true,
    };
  }
}
