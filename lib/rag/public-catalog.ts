import type { PublicInformationCategory, PublicInformationItem } from "../public-data/types";
import { safePublicHttpUrl } from "../public-data/urls";
import { startupAnnouncementRegionScope, STARTUP_PROVINCE_BY_REGION } from "../public-data/startup-region-view";
import { financialConceptRequested, studentLoanOfficialGuideRequested, normalizeRagText, ragSearchTerms } from "./query";
import { detectEmploymentStatisticsIntent } from "./public-statistics";
import { normalizePublicDate, publicApplicationPeriod, publicDateEnd,
  publicNoticeOperationalPeriod, repairYouthPolicyApplicationDates } from "../public-data/dates";
import { isRecentFinancialCompanyItem } from "../public-data/operations-view";
import { containsPromptInjection } from "../ai/context-policy.ts";

export interface PublicRagDocument {
  id: string;
  category: PublicInformationCategory;
  title: string;
  excerpt: string;
  sourceUrl: string;
  publisher: string;
  publishedAt: string | null;
  verifiedAt: string | null;
  expiresAt: string | null;
  applicationStartsAt?: string | null;
  /** Explicit event/operation end signal; never treated as an application deadline. */
  operationalEndsAt?: string | null;
  operationalDateEvidence?: "explicit-operational-date" | "event-title-month" | "kstartup-title-year" | null;
  regionScope?: string;
  regions?: string[];
  kind?: string;
}
export interface PublicRagSearchHit { document: PublicRagDocument; score: number }
export interface PublicRagSearchResult {
  status: "ready" | "no-match" | "unavailable" | "not-requested";
  hits: PublicRagSearchHit[];
  candidateCount: number;
  elapsedMs: number;
  method: "bm25-prefix-and-structured-filters";
}

const CATEGORIES = new Set(["youth", "finance", "startup", "employment"]);
const MAX_CANDIDATES = 64;
const MAX_EXCERPT_CHARS = 1250;
const DAY = 86_400_000;
const PRODUCT_INTENT = /예금|적금|금융상품|저축상품|\bdeposit\b|\bsavings\b|預金|積金|存款|储蓄/iu;
const CATALOG_INTENT = /정책|지원|장학|학자금|월세|주거|청년|창업|공고|모집|취업|고용|일자리|채용|대출|금리|예금|적금|금융상품|자격|신청|지원금|보조금|중도해지|policy|polic(?:y|ies)|support|scholarship|student loan|rent|housing|startup|grant|job|employment|deposit|savings|loan|금융지원|奨学金|家賃|政策|支援|起業|預金|就業|补助|奖学金|房租|创业|存款|就业/iu;
const PAST_INTENT = /만료|마감된|종료된|과거|지난해|작년|expired|historical|previous year|終了|過去|已截止|往年/iu;
const CURRENT_INTENT = /현재|최신|오늘|지금|이번|접수중|신청중|current|latest|today|now|open\s+now|現行|現在|最新|受付中|当前|目前|最新|申请中/iu;
const GENERIC_TERMS = new Set(["지원", "정책", "정보", "신청", "조건", "대상", "가능", "추천", "안내", "자료", "알려", "여부", "policy", "support", "information", "조건이"]);

export function publicCatalogRequested(query: string) { return !financialConceptRequested(query) && !studentLoanOfficialGuideRequested(query) && CATALOG_INTENT.test(query); }

function isKosafRecord(id: string) {
  return /^(?:public:)?kosaf-/u.test(id);
}

function safeText(value: unknown, limit: number) {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/gu, " ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, " ").trim().slice(0, limit)
    : "";
}

const QUARANTINED_PROVIDER_TEXT = "[공급자 텍스트 격리됨: 공식 원문 확인 필요]";
const CATEGORY_TITLE_FALLBACK: Record<PublicInformationCategory, string> = {
  youth: "청년 정책 공식자료(제목 격리)",
  finance: "금융 공식자료(제목 격리)",
  startup: "창업 지원 공식자료(제목 격리)",
  employment: "고용 공식자료(제목 격리)",
};

/**
 * Provider-controlled strings are evidence, never instructions. If a field
 * resembles a prompt override, discard the entire field instead of trying to
 * redact fragments that could preserve an executable instruction.
 */
function safeEvidenceText(value: unknown, limit: number, fallback = QUARANTINED_PROVIDER_TEXT) {
  const text = safeText(value, limit);
  if (!text) return "";
  return containsPromptInjection(text) ? fallback : text;
}

/** Keep complete sentences/fields. Never silently turn a cut condition into a fact. */
export function boundedEvidenceText(text: string, maximum = MAX_EXCERPT_CHARS) {
  if (text.length <= maximum) return text;
  const end = Math.max(text.lastIndexOf("\n", maximum - 40), text.lastIndexOf(". ", maximum - 40));
  const kept = end >= 80 ? text.slice(0, end + 1) : "";
  return `${kept}\n[자료 일부 생략: 신청조건·예외는 원문 확인 필요]`.trim();
}

export function publicItemRagDocument(item: PublicInformationItem): PublicRagDocument | null {
  item = repairYouthPolicyApplicationDates(item);
  const sourceUrl = safePublicHttpUrl(item.sourceUrl);
  if (!sourceUrl || !CATEGORIES.has(item.category) || !/^[a-zA-Z0-9:_-]{1,160}$/u.test(item.id)
    || !item.title || item.commercialArea || !isRecentFinancialCompanyItem(item)) return null;
  // Legacy KOSAF rows use "nationwide" for catalogue inclusion, not verified
  // residence/education eligibility. Do not infer that eligibility from an
  // institution's name or address, or mutate the shared cached item.
  const kosafRegionUnverified = isKosafRecord(item.id);
  const scope = kosafRegionUnverified
    ? { kind: "unknown" as const, regions: [] }
    : startupAnnouncementRegionScope(item);
  const product = item.financialProduct;
  const policy = item.youthPolicyEligibility;
  const statistic = item.employmentStatistic;
  const title = safeEvidenceText(item.title, 400, CATEGORY_TITLE_FALLBACK[item.category]);
  const operational = product || statistic
    ? { endsAt: null, evidence: null }
    : publicNoticeOperationalPeriod(item);
  const sections = [
    `제목: ${title}`,
    ...(product ? [
      `금융회사: ${safeEvidenceText(product.provider, 100) || "미제공"}; 유형: ${product.kind === "deposit" ? "예금" : "적금"}`,
      ...product.terms.slice(0, 8).map((term) => `기간: ${term.termMonths ?? "미제공"}개월; 기본금리: ${term.baseRate ?? "미제공"}%; 최고금리: ${term.maximumRate ?? "미제공"}%${term.rateType ? `; ${safeEvidenceText(term.rateType, 40)}` : ""}`),
      `가입대상: ${safeEvidenceText(product.eligibility, 900) || "미제공"}`,
      `우대조건: ${safeEvidenceText(product.specialConditions, 1300) || "미제공"}`,
      "최고금리는 우대조건 충족 시에만 적용. 가입 가능 여부는 확정하지 않음.",
    ] : []),
    ...(statistic ? [
      `통계대상: ${safeEvidenceText(statistic.groupLabel, 120) || "미제공"}; 기준기간: ${safeEvidenceText(statistic.period, 40) || "미제공"}`,
      ...statistic.metrics.slice(0, 24).map((metric) => `${safeEvidenceText(metric.name, 120) || "항목명 격리"}: ${metric.value}${safeEvidenceText(metric.unit, 40)}`),
      "통계의 모집단·기준기간이 다른 수치를 직접 비교하지 않음.",
    ] : []),
    ...(policy ? [
      `연령: ${policy.minAge ?? "미제공"}~${policy.maxAge ?? "미제공"}세; 이는 일부 구조화 조건이며 자격 확정이 아님.`,
    ] : []),
    kosafRegionUnverified
      ? "지역조건: 미확인 — 제공기관·통합목록의 탐색분류는 실제 신청지역 자격을 뜻하지 않음. 지역·거주·재학 요건은 공고 원문 확인 필요."
      : `지역범위: ${scope.kind === "nationwide" ? "전국" : scope.kind === "regional" ? scope.regions.map((region) => STARTUP_PROVINCE_BY_REGION[region]).join(", ") : "미확인"}`,
    `신청시작: ${normalizePublicDate(item.applicationStartsAt) ?? "미제공"}`,
    `신청마감: ${normalizePublicDate(item.expiresAt) ?? "미제공 — 현재 신청 가능 여부 확인 필요"}`,
    ...(operational.endsAt ? [
      `행사·운영 종료 신호: ${operational.endsAt} — 공고 본문의 명시 일정에서 추출했으며 신청마감으로 해석하지 않음.`,
    ] : []),
    safeEvidenceText(item.summary, 6000),
  ];
  return {
    id: `public:${item.id}`,
    category: item.category,
    title,
    excerpt: boundedEvidenceText(sections.filter(Boolean).join("\n")),
    sourceUrl,
    publisher: safeEvidenceText(item.source, 160, "공식 데이터 제공기관(이름 격리)"),
    publishedAt: item.publishedAt ?? null,
    verifiedAt: item.lastVerifiedAt ?? item.discoveredAt ?? null,
    expiresAt: normalizePublicDate(item.expiresAt),
    applicationStartsAt: normalizePublicDate(item.applicationStartsAt),
    operationalEndsAt: operational.endsAt,
    operationalDateEvidence: operational.evidence,
    regionScope: scope.kind,
    regions: scope.kind === "regional" ? scope.regions.map((region) => STARTUP_PROVINCE_BY_REGION[region]) : [],
    kind: product ? "financial-product" : statistic ? "employment-statistic" : "notice",
  };
}

const TRACKING_QUERY_PARAMETER = /^(?:utm_.+|fbclid|gclid|dclid|msclkid|ref|source)$/iu;

/** Stable URL identity for result diversity; this never changes a displayed link. */
export function canonicalPublicEvidenceUrl(value: string) {
  const safe = safePublicHttpUrl(value);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (url.hostname === "www.bizinfo.go.kr") url.hostname = "bizinfo.go.kr";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_PARAMETER.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString();
  } catch {
    return null;
  }
}

function bizinfoDocument(document: PublicRagDocument) {
  return /^(?:public:)?bizinfo(?:-data-go)?-/u.test(document.id);
}

function bizinfoOfficialId(document: PublicRagDocument) {
  const local = document.id.replace(/^public:/u, "");
  const match = local.match(/^bizinfo(?:-data-go)?-(.+)$/u);
  return match?.[1] && match[1].length <= 160 ? match[1].toLocaleLowerCase("en-US") : null;
}

function specificBizinfoUrl(value: string) {
  const canonical = canonicalPublicEvidenceUrl(value);
  if (!canonical) return null;
  const url = new URL(canonical);
  if (url.hostname !== "bizinfo.go.kr") return null;
  if (url.pathname === "/" || (url.pathname === "/apiDetail.do" && url.searchParams.get("id") === "bizinfoApi")) return null;
  return canonical;
}

function bizinfoIdentityKeys(document: PublicRagDocument) {
  if (!bizinfoDocument(document)) return [`document:${document.id}`];
  const keys: string[] = [];
  const officialId = bizinfoOfficialId(document);
  if (officialId) keys.push(`bizinfo-id:${officialId}`);
  const canonicalUrl = specificBizinfoUrl(document.sourceUrl);
  if (canonicalUrl) {
    keys.push(`bizinfo-url:${canonicalUrl}`);
    const url = new URL(canonicalUrl);
    for (const name of ["pblancId", "pbancId", "pblancSeq", "taskSeq", "seq"] as const) {
      const value = url.searchParams.get(name);
      if (value && value.length <= 160) keys.push(`bizinfo-query-id:${value.toLocaleLowerCase("en-US")}`);
    }
  }
  const period = [document.applicationStartsAt, document.expiresAt].filter(Boolean).join("/");
  if (period) keys.push(`bizinfo-title-period:${normalizeRagText(document.title)}:${period}`);
  return keys.length ? keys : [`document:${document.id}`];
}

const REGION_ALIASES: Record<string, string[]> = {
  서울: ["서울", "seoul", "ソウル", "首尔"], 부산: ["부산", "busan", "プサン", "釜山"], 대구: ["대구", "daegu", "大邱"], 인천: ["인천", "incheon", "仁川"],
  광주: ["광주", "gwangju"], 대전: ["대전", "daejeon"], 울산: ["울산", "ulsan"], 세종: ["세종", "sejong"],
  경기: ["경기", "gyeonggi"], 강원: ["강원", "gangwon"], 충북: ["충북", "충청북", "chungbuk"],
  충남: ["충남", "충청남", "chungnam"], 전북: ["전북", "전라북", "jeonbuk"],
  전남: ["전남", "전라남", "jeonnam"], 경북: ["경북", "경상북", "gyeongbuk"],
  경남: ["경남", "경상남", "gyeongnam"], 제주: ["제주", "jeju"],
};

function requestedRegions(query: string) {
  const normalized = normalizeRagText(query);
  return Object.entries(REGION_ALIASES).filter(([, aliases]) => aliases.some((alias) => normalized.includes(alias))).map(([region]) => region);
}

/** Pure, bounded reranking; explicit regional conflicts and expired offers are excluded. */
export function rankPublicRagDocuments(
  query: string,
  docs: readonly PublicRagDocument[],
  options: { limit?: number; now?: number } = {},
): PublicRagSearchHit[] {
  const terms = ragSearchTerms(query).slice(0, 24);
  if (!terms.length) return [];
  const now = options.now ?? Date.now();
  const regions = requestedRegions(query);
  const productRequested = PRODUCT_INTENT.test(query);
  const studentLoanGuidance = /학자금|student\s*loan|奨学|学費|助学贷款/iu.test(query)
    && /금리|이자|공식|안내|rate|interest|official|金利|利率/iu.test(query);
  const statisticsRequested = detectEmploymentStatisticsIntent(query);
  const currentYear = new Date(now + 9 * 3_600_000).getUTCFullYear();
  const currentRequested = CURRENT_INTENT.test(query) || query.includes(`${currentYear}년`);
  const subjectFilters = [
    { intent: /월세|주거|전세|rent|housing|家賃|住居|房租|住房/iu, evidence: /월세|주거|전세|임차|임대|주택|rent|housing|家賃|住居|房租|住房/iu },
    { intent: /학자금|장학|등록금|scholarship|student loan|奨学|学費|奖学|学费/iu, evidence: /학자금|장학|등록금|scholarship|student loan|奨学|学費|奖学|学费/iu },
    { intent: /창업|startup|entrepreneur|起業|创业/iu, evidence: /창업|스타트업|startup|entrepreneur|起業|创业/iu },
  ].filter((subject) => subject.intent.test(query));
  const pastRequested = PAST_INTENT.test(query);
  const distinct = new Map<string, PublicRagSearchHit>();
  for (const document of docs) {
    if (!safePublicHttpUrl(document.sourceUrl) || !CATEGORIES.has(document.category)) continue;
    const period = publicApplicationPeriod(document, now);
    if (!pastRequested && period.status === "expired") continue;
    const operationalEnd = publicDateEnd(document.operationalEndsAt);
    // A clearly ended event is not a current opportunity merely because the
    // provider omitted its application deadline. Historical queries may still
    // retrieve it with an explicit elapsed-schedule label.
    if (!pastRequested && operationalEnd !== null && operationalEnd < now) continue;
    if (productRequested && document.kind !== "financial-product") continue;
    if (document.kind === "employment-statistic" && !statisticsRequested) continue;
    if (subjectFilters.length && !subjectFilters.some((subject) => subject.evidence.test(`${document.title} ${document.excerpt}`))) continue;
    // A requested region needs confirmed regional evidence. A KOSAF catalogue
    // default (including a prebuilt legacy nationwide projection) cannot supply it.
    if (regions.length && isKosafRecord(document.id)
      && (document.regionScope !== "regional" || !document.regions?.length)) continue;
    if (regions.length && document.regionScope === "regional" && document.regions?.length
      && !document.regions.some((value) => regions.some((region) =>
        REGION_ALIASES[region].some((alias) => value.toLowerCase().includes(alias))))) continue;
    const title = normalizeRagText(document.title);
    const body = normalizeRagText(document.excerpt);
    let meaningful = 0;
    let score = 0;
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inBody = body.includes(term);
      if (!inTitle && !inBody) continue;
      const generic = GENERIC_TERMS.has(term) || requestedRegions(term).length > 0;
      if (!generic) meaningful += 1;
      score += inTitle ? generic ? 2 : 10 : generic ? 0.5 : 2;
    }
    if (!meaningful || score < 3) continue;
    // Nationwide loan terms belong to the administering body's guidance, not
    // a municipality's separate interest-subsidy announcement.
    if (studentLoanGuidance && !regions.length) {
      const host = new URL(document.sourceUrl).hostname;
      if (host === "kosaf.go.kr" || host.endsWith(".kosaf.go.kr")) score += 35;
      if (/이자\s*지원|이자액|interest\s*subsid/iu.test(document.title)) score -= 8;
    }
    if (regions.length && document.regionScope === "regional") score += 5;
    if (regions.length && document.regionScope === "nationwide") score += 1;
    if (!pastRequested && document.kind === "notice") {
      const periodPriority = period.status === "within-period" ? 6
        : period.status === "deadline-known" ? 4
          : period.status === "upcoming" ? 2 : 0;
      score += currentRequested ? periodPriority * 2 : periodPriority;
      if (operationalEnd !== null && operationalEnd >= now) score += currentRequested ? 4 : 2;
      if (currentRequested && period.status === "unknown" && operationalEnd === null) score -= 1;
    }
    const verifiedAt = Date.parse(document.verifiedAt ?? "");
    if (Number.isFinite(verifiedAt) && now - verifiedAt <= 7 * DAY) score += 1;
    const previous = distinct.get(document.id);
    if (!previous || previous.score < score) {
      const periodLabel = {
        upcoming: "접수 예정 — 시작일 전이며 원문 확인 필요",
        "within-period": "기재된 신청기간 내 — 실제 접수 가능 여부는 원문 확인 필요",
        "deadline-known": "마감일만 확인 — 시작일과 실제 접수 가능 여부는 원문 확인 필요",
        expired: "기재 마감일 경과",
        unknown: "신청기간 미확인 — 날짜 누락 또는 불일치, 현재 접수 가능 여부를 단정하지 않음",
      }[period.status];
      const periodRelevant = document.kind === "notice" && (/신청|접수|모집|마감|언제|apply|deadline|申請|申请/iu.test(query)
        || Boolean(document.expiresAt || document.applicationStartsAt));
      const operationalLabel = operationalEnd !== null
        ? operationalEnd < now
          ? "내용일정 상태: 확인된 행사·운영 종료일 경과 — 현재 지원으로 제시하지 않음"
          : "내용일정 상태: 확인된 행사·운영 종료일 미경과 — 신청 가능 여부는 별도 확인 필요"
        : "";
      distinct.set(document.id, { document: { ...document, excerpt: boundedEvidenceText(`${periodRelevant ? `기간상태: ${periodLabel}\n` : ""}${operationalLabel ? `${operationalLabel}\n` : ""}${document.excerpt}`) }, score });
    }
  }
  const ranked = [...distinct.values()].sort((a, b) => b.score - a.score
    || Number(/^(?:public:)?bizinfo-data-go-/u.test(b.document.id)) - Number(/^(?:public:)?bizinfo-data-go-/u.test(a.document.id))
    || b.document.excerpt.length - a.document.excerpt.length
    || a.document.id.localeCompare(b.document.id));
  const selected: PublicRagSearchHit[] = [];
  const seenIdentities = new Set<string>();
  const limit = Math.min(6, Math.max(1, options.limit ?? 4));
  for (const hit of ranked) {
    const identities = bizinfoIdentityKeys(hit.document);
    if (identities.some((identity) => seenIdentities.has(identity))) continue;
    identities.forEach((identity) => seenIdentities.add(identity));
    selected.push(hit);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function publicRagMatchExpression(query: string) {
  return ragSearchTerms(query).filter((term) => !GENERIC_TERMS.has(term))
    .filter((term) => term.length >= 2 && term.length <= 40).slice(0, 16)
    .map((term) => `"${term.replace(/"/gu, '""')}"*`).join(" OR ");
}

// User input is bound as data. FTS ranks the complete durable catalogue in the
// database and returns at most 64 small projections, never every source chunk.
export const PUBLIC_RAG_SEARCH_SQL = `SELECT d.payload
  FROM public_rag_fts JOIN public_rag_documents d ON d.row_id = public_rag_fts.rowid
  WHERE public_rag_fts MATCH ?1
    AND (?2 = 1 OR d.expires_at IS NULL OR d.expires_at = ''
      OR length(d.expires_at) != 10
      OR d.expires_at NOT GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'
      OR substr(d.expires_at, 1, 4) NOT BETWEEN '1900' AND '2199'
      OR date(d.expires_at, '+0 days') IS NULL OR date(d.expires_at, '+0 days') != d.expires_at
      OR d.expires_at >= ?3
      OR (json_extract(d.payload, '$.applicationStartsAt') IS NOT NULL
        AND (length(json_extract(d.payload, '$.applicationStartsAt')) != 10
          OR json_extract(d.payload, '$.applicationStartsAt') NOT GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'
          OR json_extract(d.payload, '$.applicationStartsAt') > d.expires_at))
      OR (d.doc_id LIKE 'youth-center-%' AND d.body LIKE '%신청기간 0 ~ 0%'))
    AND (?4 = 0 OR json_type(d.payload, '$.financialProduct') = 'object')
    AND (d.source_id <> 'financial-company' OR (
      length(d.published_at) = 10
      AND d.published_at GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'
      AND date(d.published_at, '+0 days') = d.published_at
      AND date(d.published_at) BETWEEN date(?3, '-30 days') AND date(?3, '+1 day')))
    AND NOT EXISTS (SELECT 1 FROM public_api_source_state s WHERE s.source_id = d.source_id
      AND s.last_error IN ('credential-unavailable', 'disabled_by_operator'))
  ORDER BY bm25(public_rag_fts, 6.0, 1.0, 3.0), d.doc_id LIMIT ${MAX_CANDIDATES}`;

export async function searchPublicCatalogEvidence(
  query: string,
  options: { database?: D1Database; now?: number } = {},
): Promise<PublicRagSearchResult> {
  const started = Date.now();
  const empty = (status: PublicRagSearchResult["status"]): PublicRagSearchResult => ({
    status, hits: [], candidateCount: 0, elapsedMs: Date.now() - started, method: "bm25-prefix-and-structured-filters",
  });
  if (!publicCatalogRequested(query)) return empty("not-requested");
  const expression = publicRagMatchExpression(query);
  if (!expression) return empty("no-match");
  try {
    const db = options.database ?? (await import("cloudflare:workers")).env.DB;
    if (!db) return empty("unavailable");
    const now = options.now ?? Date.now();
    const day = new Date(now + 9 * 3_600_000).toISOString().slice(0, 10);
    const result = await db.prepare(PUBLIC_RAG_SEARCH_SQL)
      .bind(expression, PAST_INTENT.test(query) ? 1 : 0, day, PRODUCT_INTENT.test(query) ? 1 : 0)
      .all<{ payload: string }>();
    const documents = result.results.flatMap(({ payload }) => {
      try {
        if (payload.length > 24_000) return [];
        const document = publicItemRagDocument(JSON.parse(payload) as PublicInformationItem);
        return document ? [document] : [];
      } catch { return []; }
    });
    const hits = rankPublicRagDocuments(query, documents, { now });
    return { status: hits.length ? "ready" : "no-match", hits, candidateCount: documents.length,
      elapsedMs: Date.now() - started, method: "bm25-prefix-and-structured-filters" };
  } catch {
    // A missing migration/index must be visible as unavailable, not 'no matches'.
    return empty("unavailable");
  }
}
