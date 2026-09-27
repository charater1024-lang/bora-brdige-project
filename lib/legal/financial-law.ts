import { PublicResponseBodyError, readBoundedResponseText } from "../public-data/bounded-response";

const LAW_ORIGIN = "https://www.law.go.kr";
const LAW_SEARCH_ENDPOINT = `${LAW_ORIGIN}/DRF/lawSearch.do`;
const LAW_SERVICE_ENDPOINT = `${LAW_ORIGIN}/DRF/lawService.do`;
const LAW_RESPONSE_MAX_BYTES = 5_000_000;
const LAW_REQUEST_TIMEOUT_MS = 12_000;
const MAX_ARTICLES = 6;
const MAX_RETRIEVAL_ARTICLES = 12;
const LAW_STORED_ARTICLE_MAX_BYTES = 12_000;
const LAW_CONTEXT_MAX_BYTES = 4_000;
export const FINANCIAL_LAW_RETRIEVAL_VERSION = 2;

export enum FinancialLawTopic {
  FinancialConsumerProtection = "financial-consumer-protection",
  ElectronicFinance = "electronic-finance",
  CreditInformation = "credit-information",
  VoicePhishingRecovery = "voice-phishing-recovery",
  DepositorProtection = "depositor-protection",
  FairDebtCollection = "fair-debt-collection",
}

export type FinancialLawManifestEntry = {
  label: string;
  lawName: string;
  strongIntentTerms: readonly string[];
  intentTerms: readonly string[];
  preferredArticles: readonly string[];
  articleKeywords: readonly string[];
};

export const FINANCIAL_LAW_MANIFEST: Readonly<Record<FinancialLawTopic, FinancialLawManifestEntry>> = {
  [FinancialLawTopic.FinancialConsumerProtection]: {
    label: "금융상품 소비자보호",
    lawName: "금융소비자 보호에 관한 법률",
    strongIntentTerms: ["금융소비자보호법", "금소법", "위법계약해지", "부당권유"],
    intentTerms: ["금융상품", "청약철회", "설명의무", "적합성원칙", "적정성원칙"],
    preferredArticles: ["17", "18", "19", "21", "46", "47"],
    articleKeywords: ["적합성", "적정성", "설명의무", "부당권유", "청약철회", "위법계약"],
  },
  [FinancialLawTopic.ElectronicFinance]: {
    label: "전자금융",
    lawName: "전자금융거래법",
    strongIntentTerms: ["전자금융거래법", "전자금융사고", "무권한이체"],
    intentTerms: ["전자금융", "전자지급", "접근매체", "금융사고", "해킹이체"],
    preferredArticles: ["8", "9", "10", "21", "21의2"],
    articleKeywords: ["오류의 정정", "손해배상", "접근매체", "안전성 확보", "전자금융사고"],
  },
  [FinancialLawTopic.CreditInformation]: {
    label: "신용정보",
    lawName: "신용정보의 이용 및 보호에 관한 법률",
    strongIntentTerms: ["신용정보법", "개인신용정보", "신용정보회사", "마이데이터"],
    intentTerms: ["신용조회", "신용점수", "신용정보", "신용평가", "정보제공동의"],
    preferredArticles: ["15", "20", "31", "32", "33", "35", "37", "38의3"],
    articleKeywords: ["개인신용정보", "동의", "제공", "열람", "정정", "삭제", "전송요구"],
  },
  [FinancialLawTopic.VoicePhishingRecovery]: {
    label: "보이스피싱 피해환급",
    lawName: "전기통신금융사기 피해 방지 및 피해금 환급에 관한 특별법",
    strongIntentTerms: ["보이스피싱", "전기통신금융사기", "피해환급", "사기이용계좌"],
    intentTerms: ["지급정지", "피해구제", "명의인", "채권소멸", "환급금"],
    preferredArticles: ["3", "4", "5", "7", "9", "10"],
    articleKeywords: ["피해구제", "지급정지", "사기이용계좌", "채권소멸", "피해환급금"],
  },
  [FinancialLawTopic.DepositorProtection]: {
    label: "예금자보호",
    lawName: "예금자보호법",
    strongIntentTerms: ["예금자보호법", "예금보험공사", "예금보험금"],
    intentTerms: ["예금자보호", "보호한도", "예금보험", "부보금융회사", "보험사고"],
    preferredArticles: ["29", "30", "31", "32", "35", "35의2"],
    articleKeywords: ["보험금", "보험사고", "예금등 채권", "지급", "보호한도"],
  },
  [FinancialLawTopic.FairDebtCollection]: {
    label: "채권추심",
    lawName: "채권의 공정한 추심에 관한 법률",
    strongIntentTerms: ["채권추심법", "불법추심", "채무자대리인"],
    intentTerms: ["채권추심", "빚독촉", "채무독촉", "추심전화", "추심행위"],
    preferredArticles: ["6", "7", "8", "8의2", "9", "10", "11", "12", "13"],
    articleKeywords: ["채권추심", "채무자대리인", "폭행", "협박", "거짓 표시", "관계인", "연락"],
  },
} as const;

const FINANCIAL_LAW_INTENT_ALIASES: Readonly<Record<FinancialLawTopic, readonly string[]>> = {
  [FinancialLawTopic.FinancialConsumerProtection]: [
    "financial consumer protection", "financial product withdrawal", "cooling-off right",
    "金融消費者保護", "金融消费者保护", "金融商品撤回",
  ],
  [FinancialLawTopic.ElectronicFinance]: [
    "electronic financial transaction", "electronic finance", "unauthorized bank transfer",
    "電子金融取引", "电子金融交易", "无授权转账",
  ],
  [FinancialLawTopic.CreditInformation]: [
    "credit information", "credit report", "credit score", "credit data", "mydata",
    "信用情報", "信用情報削除", "个人信用信息", "信用信息",
  ],
  [FinancialLawTopic.VoicePhishingRecovery]: [
    "voice phishing", "vishing", "telecommunications financial fraud",
    "ボイスフィッシング", "振り込め詐欺", "电信金融诈骗", "电信诈骗",
  ],
  [FinancialLawTopic.DepositorProtection]: [
    "depositor protection", "deposit insurance", "deposit protection",
    "預金者保護", "預金保険", "存款保险", "存款保护", "存款人保护",
  ],
  [FinancialLawTopic.FairDebtCollection]: [
    "debt collection", "debt collector", "債権回収", "債権取立", "借金取立", "债务催收", "债权催收",
  ],
};

export type FinancialLawFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type FinancialLawArticle = {
  sourceId: string;
  articleKey: string;
  articleNumber: string;
  articleTitle: string | null;
  text: string;
  effectiveDate: string;
  sourceUrl: string;
  /** True when whole passages could not be retained within the storage bound. */
  textTruncated?: boolean;
  omittedPassageCount?: number;
};

export type FinancialLawGuidance = {
  status: "official-current";
  topic: FinancialLawTopic;
  topicLabel: string;
  publisher: "국가법령정보센터";
  law: {
    lawId: string;
    mst: string;
    lawName: string;
    promulgationDate: string | null;
    promulgationNumber: string | null;
    effectiveDate: string;
    ministry: string | null;
    retrievedAt: string;
    sourceUrl: string;
  };
  articles: FinancialLawArticle[];
  /** Additional shared, question-independent candidates; articles remains the six-card UI list. */
  candidateArticles?: FinancialLawArticle[];
  retrievalVersion?: number;
};

export class FinancialLawClientError extends Error {
  readonly name = "FinancialLawClientError";

  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scalarText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!isObject(value)) return "";
  for (const key of ["#text", "text", "content", "value", "_"]) {
    const nested = scalarText(value[key]);
    if (nested) return nested;
  }
  return "";
}

function cleanText(value: unknown, maximumLength = 8_000) {
  return scalarText(value)
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumLength);
}

function normalizedName(value: unknown) {
  return cleanText(value, 200).normalize("NFKC");
}

function asObjectArray(value: unknown, code: string) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  if (!values.every(isObject)) throw new FinancialLawClientError(code, 502);
  return values as JsonObject[];
}

function validDate(value: unknown) {
  const text = cleanText(value, 8);
  if (!/^\d{8}$/u.test(text)) return "";
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? text
    : "";
}

function safeIdentifier(value: unknown, maximumLength = 40) {
  const text = cleanText(value, maximumLength);
  return /^[0-9A-Za-z_-]+$/u.test(text) ? text : "";
}

function safeOptionalText(value: unknown, maximumLength = 200) {
  return cleanText(value, maximumLength) || null;
}

function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new FinancialLawClientError("financial_law_server_only", 500);
  }
}

function endpoint(path: "search" | "service", oc: string, parameters: Record<string, string>) {
  const credential = oc.trim();
  if (!credential) throw new FinancialLawClientError("financial_law_oc_missing", 401);
  if (credential.length > 200) throw new FinancialLawClientError("financial_law_oc_invalid", 401);

  const url = new URL(path === "search" ? LAW_SEARCH_ENDPOINT : LAW_SERVICE_ENDPOINT);
  url.searchParams.set("OC", credential);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url;
}

async function fetchJson(args: {
  url: URL;
  fetchImpl: FinancialLawFetch;
  expectedPath: "/DRF/lawSearch.do" | "/DRF/lawService.do";
}) {
  let response: Response;
  try {
    response = await args.fetchImpl(args.url, {
      headers: { Accept: "application/json" },
      // Cloudflare Workers rejects redirect:"error" before a request is sent.
      // Manual mode lets us reject redirect responses without forwarding OC.
      redirect: "manual",
      signal: AbortSignal.timeout(LAW_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const code = name === "TimeoutError" || name === "AbortError"
      ? "financial_law_timeout"
      : "financial_law_network_error";
    throw new FinancialLawClientError(code, name === "TimeoutError" || name === "AbortError" ? 504 : 502);
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new FinancialLawClientError("financial_law_redirect_rejected", 502);
  }

  if (response.url) {
    let responseUrl: URL;
    try {
      responseUrl = new URL(response.url);
    } catch {
      throw new FinancialLawClientError("financial_law_response_origin_invalid", 502);
    }
    if (responseUrl.origin !== LAW_ORIGIN || responseUrl.pathname !== args.expectedPath) {
      throw new FinancialLawClientError("financial_law_response_origin_invalid", 502);
    }
  }

  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 || response.status === 429
      ? response.status
      : 502;
    const code = response.status === 401 || response.status === 403
      ? "financial_law_authorization_failed"
      : response.status === 429
        ? "financial_law_quota_exceeded"
        : "financial_law_upstream_http_error";
    throw new FinancialLawClientError(code, status);
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("json")) {
    throw new FinancialLawClientError("financial_law_non_json_response", 502);
  }

  let body: string;
  try {
    body = await readBoundedResponseText(response, LAW_RESPONSE_MAX_BYTES);
  } catch (error) {
    const code = error instanceof PublicResponseBodyError
      ? "financial_law_response_too_large"
      : "financial_law_response_read_failed";
    throw new FinancialLawClientError(code, 502);
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new FinancialLawClientError("financial_law_non_json_response", 502);
  }
}

type CurrentLaw = {
  lawId: string;
  mst: string;
  lawName: string;
  promulgationDate: string | null;
  promulgationNumber: string | null;
  effectiveDate: string;
  ministry: string | null;
};

function parseCurrentLaw(payload: unknown, exactLawName: string): CurrentLaw {
  if (!isObject(payload) || !isObject(payload.LawSearch)) {
    throw new FinancialLawClientError("financial_law_search_shape_invalid", 502);
  }
  const search = payload.LawSearch;
  if (cleanText(search.resultCode, 20) !== "00") {
    throw new FinancialLawClientError("financial_law_search_rejected", 502);
  }

  const exactCurrent = asObjectArray(search.law, "financial_law_search_shape_invalid").filter((law) => (
    normalizedName(law.법령명한글) === exactLawName.normalize("NFKC")
    && cleanText(law.현행연혁코드, 20) === "현행"
  ));
  if (exactCurrent.length !== 1) {
    throw new FinancialLawClientError(
      exactCurrent.length > 1
        ? "financial_law_current_match_ambiguous"
        : "financial_law_current_match_missing",
      502,
    );
  }

  const law = exactCurrent[0];
  const lawId = safeIdentifier(law.법령ID);
  const mst = safeIdentifier(law.법령일련번호);
  const effectiveDate = validDate(law.시행일자);
  if (!lawId || !mst || !effectiveDate) {
    throw new FinancialLawClientError("financial_law_search_shape_invalid", 502);
  }
  return {
    lawId,
    mst,
    lawName: exactLawName,
    promulgationDate: validDate(law.공포일자) || null,
    promulgationNumber: safeOptionalText(law.공포번호, 80),
    effectiveDate,
    ministry: safeOptionalText(law.소관부처명, 120),
  };
}

function articleNumber(unit: JsonObject) {
  const number = cleanText(unit.조문번호, 12).replace(/^제|조$/gu, "");
  const branch = cleanText(unit.조문가지번호, 12).replace(/^의/u, "");
  if (!/^\d{1,4}$/u.test(number)) return "";
  if (branch && !/^\d{1,3}$/u.test(branch)) return "";
  return branch ? `${Number(number)}의${Number(branch)}` : String(Number(number));
}

function articleKey(unit: JsonObject, number: string) {
  const upstreamKey = safeIdentifier(unit.조문키, 40);
  if (upstreamKey) return upstreamKey;
  const match = /^(\d{1,4})(?:의(\d{1,3}))?$/u.exec(number);
  if (!match) return "";
  return `${match[1].padStart(4, "0")}${(match[2] ?? "0").padStart(2, "0")}`;
}

const CONTENT_KEYS = new Set(["조문내용", "항내용", "호내용", "목내용"]);

function collectArticleText(value: unknown, chunks: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectArticleText(item, chunks);
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (CONTENT_KEYS.has(key)) {
      // The response is already byte-bounded. Do not sever a condition here;
      // storage/context bounds below retain or omit complete passage groups.
      const text = cleanText(child, LAW_RESPONSE_MAX_BYTES);
      if (text && chunks.at(-1) !== text) chunks.push(text);
    }
    if (Array.isArray(child) || isObject(child)) collectArticleText(child, chunks);
  }
}

function isPreambleUnit(unit: JsonObject) {
  const kind = cleanText(unit.조문여부, 40).normalize("NFKC").replace(/\s+/gu, "");
  const title = cleanText(unit.조문제목, 40).normalize("NFKC").replace(/\s+/gu, "");
  return kind === "전문" || kind.startsWith("전문") || (!kind && title === "전문");
}

function scoreArticle(
  number: string,
  title: string | null,
  text: string,
  manifest: FinancialLawManifestEntry,
) {
  const preferredIndex = manifest.preferredArticles.indexOf(number);
  // Keep the reviewed manifest order deterministic. Keyword matches can rank
  // additional relevant articles, but cannot reorder the preferred articles.
  let score = preferredIndex >= 0 ? 100_000 - preferredIndex * 1_000 : 0;
  const searchable = `${title ?? ""} ${text}`.normalize("NFKC");
  for (const keyword of manifest.articleKeywords) {
    if (searchable.includes(keyword.normalize("NFKC"))) score += 20 + keyword.length;
  }
  return score;
}

function publicLawUrl(lawName: string) {
  return `${LAW_ORIGIN}/법령/${lawName}`;
}

function publicArticleUrl(lawName: string, number: string) {
  return `${publicLawUrl(lawName)}/제${number}조`;
}

function parseArticles(
  payload: unknown,
  law: CurrentLaw,
  manifest: FinancialLawManifestEntry,
): FinancialLawArticle[] {
  if (!isObject(payload) || !isObject(payload.법령)) {
    throw new FinancialLawClientError("financial_law_service_shape_invalid", 502);
  }
  const lawRoot = payload.법령;
  if (!isObject(lawRoot.기본정보) || !isObject(lawRoot.조문)) {
    throw new FinancialLawClientError("financial_law_service_shape_invalid", 502);
  }
  const basic = lawRoot.기본정보;
  if (
    normalizedName(basic.법령명_한글) !== law.lawName.normalize("NFKC")
    || validDate(basic.시행일자) !== law.effectiveDate
  ) {
    throw new FinancialLawClientError("financial_law_service_version_mismatch", 502);
  }

  const units = asObjectArray(lawRoot.조문.조문단위, "financial_law_service_shape_invalid")
    // The official JSON prepends a non-article "전문" header unit. It has an
    // article number but no article text and must not weaken validation of the
    // real article units that follow it.
    .filter((unit) => !isPreambleUnit(unit));
  const scored = units.map((unit) => {
    const number = articleNumber(unit);
    const key = articleKey(unit, number);
    const title = safeOptionalText(unit.조문제목, 300);
    const chunks: string[] = [];
    collectArticleText(unit, chunks);
    const officialText = chunks.join("\n");
    if (!number || !key || !officialText) {
      throw new FinancialLawClientError("financial_law_article_shape_invalid", 502);
    }
    const retained = retainCompleteLawText(officialText, LAW_STORED_ARTICLE_MAX_BYTES);
    return {
      score: scoreArticle(number, title, officialText, manifest),
      article: {
        sourceId: `law-go-kr:${law.lawId}:${key}:${law.effectiveDate}`,
        articleKey: key,
        articleNumber: number,
        articleTitle: title,
        text: retained.text,
        effectiveDate: law.effectiveDate,
        sourceUrl: publicArticleUrl(law.lawName, number),
        ...(retained.omittedPassageCount ? {
          textTruncated: true,
          omittedPassageCount: retained.omittedPassageCount,
        } : {}),
      } satisfies FinancialLawArticle,
    };
  });

  const articles = scored
    .filter(({ score }) => score > 0)
    .sort((left, right) => (
      right.score - left.score
      || left.article.articleNumber.localeCompare(right.article.articleNumber, "ko", { numeric: true })
      || left.article.articleKey.localeCompare(right.article.articleKey)
    ))
    .slice(0, MAX_RETRIEVAL_ARTICLES)
    .map(({ article }) => article);
  if (!articles.length) {
    throw new FinancialLawClientError("financial_law_relevant_articles_missing", 502);
  }
  return articles;
}

export function detectFinancialLegalIntent(input: string): FinancialLawTopic | null {
  const text = String(input ?? "").normalize("NFKC").toLowerCase().replace(/\s+/gu, "").slice(0, 5_000);
  if (!text) return null;

  let best: { topic: FinancialLawTopic; score: number } | null = null;
  for (const topic of Object.values(FinancialLawTopic)) {
    const manifest = FINANCIAL_LAW_MANIFEST[topic];
    let score = 0;
    for (const term of manifest.strongIntentTerms) {
      const normalized = term.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
      if (text.includes(normalized)) score += 100 + normalized.length;
    }
    for (const term of manifest.intentTerms) {
      const normalized = term.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
      if (text.includes(normalized)) score += 10 + normalized.length;
    }
    for (const term of FINANCIAL_LAW_INTENT_ALIASES[topic]) {
      const normalized = term.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
      if (text.includes(normalized)) score += 100 + normalized.length;
    }
    if (score > 0 && (!best || score > best.score)) best = { topic, score };
  }
  return best?.topic ?? null;
}

export async function fetchFinancialLawGuidance(args: {
  oc: string;
  topic: FinancialLawTopic;
  fetchImpl?: FinancialLawFetch;
}): Promise<FinancialLawGuidance> {
  assertServerOnly();
  const manifest = FINANCIAL_LAW_MANIFEST[args.topic];
  if (!manifest) throw new FinancialLawClientError("financial_law_topic_invalid", 400);
  const fetchImpl = args.fetchImpl ?? fetch;

  const searchPayload = await fetchJson({
    url: endpoint("search", args.oc, {
      target: "eflaw",
      type: "JSON",
      search: "1",
      query: manifest.lawName,
      nw: "3",
      display: "20",
      page: "1",
    }),
    fetchImpl,
    expectedPath: "/DRF/lawSearch.do",
  });
  const law = parseCurrentLaw(searchPayload, manifest.lawName);

  const servicePayload = await fetchJson({
    url: endpoint("service", args.oc, {
      target: "eflaw",
      type: "JSON",
      MST: law.mst,
      efYd: law.effectiveDate,
      chrClsCd: "010202",
    }),
    fetchImpl,
    expectedPath: "/DRF/lawService.do",
  });
  const candidates = parseArticles(servicePayload, law, manifest);

  return {
    status: "official-current",
    topic: args.topic,
    topicLabel: manifest.label,
    publisher: "국가법령정보센터",
    law: {
      ...law,
      retrievedAt: new Date().toISOString(),
      sourceUrl: publicLawUrl(law.lawName),
    },
    articles: candidates.slice(0, MAX_ARTICLES),
    ...(candidates.length > MAX_ARTICLES ? { candidateArticles: candidates.slice(MAX_ARTICLES) } : {}),
    retrievalVersion: FINANCIAL_LAW_RETRIEVAL_VERSION,
  };
}

function utf8Length(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

const PARAGRAPH_MARKER = /^[①-⑳㉑-㉟㊱-㊿]/u;
const QUALIFIER = /다만|예외|제외|그러하지|아니하|단서|경우|한정|불구|각\s*호|각\s*목|unless|except|provided\s+that|however|ただし|但し|場合|除く|但是|除外/iu;
const LEADING_QUALIFIER = /^(?:[①-⑳㉑-㉟㊱-㊿]\s*)?(?:다만|단[,，]|그러나|예외|제\s*\d+\s*항.{0,16}불구|except|unless|however|ただし|但し|但是|除外)/iu;

/** Preserve numbered paragraphs, their sub-items and dependent exceptions as one unit. */
function completeLawPassages(text: string): string[] {
  const lines = text.replace(/\r\n?/gu, "\n")
    .split(/\n+|(?=[①-⑳㉑-㉟㊱-㊿])/u)
    .map((line) => line.trim()).filter(Boolean);
  const paragraphs: string[] = [];
  for (const line of lines) {
    const previous = paragraphs.at(-1);
    const child = /^(?:\d{1,3}[.)]|[가-하][.)])\s/u.test(line);
    if (previous && !PARAGRAPH_MARKER.test(line)
      && (child || LEADING_QUALIFIER.test(line) || /각\s*(?:호|목)|다음과\s*같/u.test(previous))) {
      paragraphs[paragraphs.length - 1] += `\n${line}`;
    } else {
      paragraphs.push(line);
    }
  }
  const parent = paragraphs.map((_paragraph, index) => index);
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]));
  const numbered = new Map<string, number>();
  paragraphs.forEach((paragraph, index) => {
    if (PARAGRAPH_MARKER.test(paragraph)) {
      const number = /^\d+/u.exec(paragraph.normalize("NFKC"))?.[0];
      if (number) numbered.set(number, index);
    }
  });
  paragraphs.forEach((paragraph, index) => {
    if (!LEADING_QUALIFIER.test(paragraph)) return;
    const references = [...paragraph.matchAll(/제\s*(\d+)\s*항/gu)]
      .map((match) => numbered.get(match[1])).filter((value): value is number => value !== undefined);
    for (const target of references.length ? references : index > 0 ? [index - 1] : []) {
      parent[root(index)] = root(target);
    }
  });
  const groups = new Map<number, string[]>();
  paragraphs.forEach((paragraph, index) => {
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), paragraph]);
  });
  return [...groups.values()].flatMap((parts) => {
    const paragraph = parts.join("\n");
    if (parts.length > 1 || PARAGRAPH_MARKER.test(paragraph) || QUALIFIER.test(paragraph)
      || /^(?:\d{1,3}[.)]|[가-하][.)])\s/u.test(paragraph)) return [paragraph];
    // Sentences without dependent conditions can be selected individually.
    // No string or byte prefix is ever returned as an alleged complete passage.
    return paragraph.split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
  });
}

function retainCompleteLawText(text: string, maximumBytes: number) {
  if (utf8Length(text) <= maximumBytes) return { text, omittedPassageCount: 0 };
  const passages = completeLawPassages(text);
  const retained: string[] = [];
  for (const passage of passages) {
    if (utf8Length([...retained, passage].join("\n")) <= maximumBytes) retained.push(passage);
  }
  return { text: retained.join("\n"), omittedPassageCount: passages.length - retained.length };
}

const LAW_QUERY_EQUIVALENTS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/withdraw|cooling.?off|撤回|撤回権|撤销/iu, ["청약철회", "철회"]],
  [/explain|explanation|説明|说明/iu, ["설명의무", "설명"]],
  [/delet|eras|削除|删除/iu, ["삭제"]],
  [/correct|rectif|訂正|更正/iu, ["정정"]],
  [/access|inspect|閲覧|查阅/iu, ["열람"]],
  [/consent|同意/iu, ["동의"]],
  [/refund|recover|返還|返金|退款|返还/iu, ["환급", "피해구제"]],
  [/limit|ceiling|上限|限额/iu, ["한도"]],
  [/exception|except|例外|除外/iu, ["예외", "다만", "제외"]],
  [/deadline|period|期限|期間/iu, ["기간", "기한"]],
  [/transfer|portab|転送|传输/iu, ["전송요구"]],
];

function queryTerms(query: string, guidance: FinancialLawGuidance) {
  const normalized = query.normalize("NFKC").toLocaleLowerCase();
  const terms: string[] = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const keyword of FINANCIAL_LAW_MANIFEST[guidance.topic].articleKeywords) {
    if (normalized.replace(/\s/gu, "").includes(keyword.replace(/\s/gu, ""))) terms.push(keyword);
  }
  for (const [pattern, equivalents] of LAW_QUERY_EQUIVALENTS) {
    if (pattern.test(normalized)) terms.push(...equivalents);
  }
  return [...new Set(terms.map((term) => term.replace(/(?:은|는|을|를|에서|까지|에게|으로|의|와|과|도|에)$/u, "")))]
    .filter((term) => term.length >= 2 && !/^(?:알려|주세요|방법|어떻게|what|how|the|please|under|korean|law)$/iu.test(term));
}

function passageRelevance(text: string, terms: readonly string[]) {
  const normalized = text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "");
  return terms.reduce((score, term) => score + (normalized.includes(term.replace(/\s+/gu, "")) ? Math.min(12, term.length) : 0), 0);
}

export type FinancialLawGroundingSource = {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  publisher: string;
  reviewedAt: string;
  truncated: boolean;
};

function buildFinancialLawContext(guidance: FinancialLawGuidance, query = "") {
  const header = [
    `status: ${guidance.status}`,
    `publisher: ${guidance.publisher}`,
    `law_name: ${guidance.law.lawName}`,
    `effective_date: ${guidance.law.effectiveDate}`,
    `retrieved_at: ${guidance.law.retrievedAt}`,
    `source_url: ${guidance.law.sourceUrl}`,
    "scope: Complete selected passages only, not the full law. Never infer omitted conditions or exceptions. Empty/omitted official_text is not citable evidence.",
  ].join("\n");
  const terms = queryTerms(query, guidance);
  const articles = [...new Map([...guidance.articles, ...(guidance.candidateArticles ?? [])]
    .map((article) => [article.sourceId, article])).values()];
  const ranked = articles.map((article, index) => {
    const exactArticle = new RegExp(`(?:제\\s*${article.articleNumber.replace("의", "\\s*의\\s*")}\\s*조|\\barticle\\s+${article.articleNumber}\\b)`, "iu").test(query);
    return {
      article,
      originalIndex: index,
      relevance: (exactArticle ? 1_000 : 0)
        + passageRelevance(article.articleTitle ?? "", terms) * 8
        + passageRelevance(article.text, terms),
      passages: completeLawPassages(article.text),
      selected: new Set<number>(),
    };
  }).sort((left, right) => right.relevance - left.relevance || left.originalIndex - right.originalIndex);
  const slots = ranked.slice(0, MAX_ARTICLES);
  const selectedText = (slot: typeof slots[number]) => slot.passages
    .filter((_passage, index) => slot.selected.has(index)).join("\n");
  const render = () => [
    header,
    `omitted_article_count: ${articles.length - slots.length}`,
    ...slots.map((slot) => {
      const omitted = slot.passages.length - slot.selected.size + (slot.article.omittedPassageCount ?? 0);
      return [
        `[${slot.article.sourceId}]`,
        `article: 제${slot.article.articleNumber}조${slot.article.articleTitle ? ` (${slot.article.articleTitle})` : ""}`,
        `excerpt_status: ${!slot.selected.size ? "omitted" : omitted || slot.article.textTruncated ? "selected" : "complete"}; omitted_passages=${omitted}`,
        `official_text: ${JSON.stringify(selectedText(slot))}`,
      ].join("\n");
    }),
  ].join("\n\n");
  // Omit whole metadata records if unusually long titles leave no bounded prompt.
  while (slots.length && utf8Length(render()) > LAW_CONTEXT_MAX_BYTES) slots.pop();
  if (utf8Length(render()) > LAW_CONTEXT_MAX_BYTES) {
    return { context: "Official-law context omitted because its metadata exceeds the safe context budget. Do not make a legal claim; consult the official law.", sources: [] as FinancialLawGroundingSource[] };
  }
  const candidates = slots.flatMap((slot, articleIndex) => slot.passages.map((passage, passageIndex) => ({
    slot,
    passageIndex,
    score: terms.length
      ? slot.relevance * 100 + passageRelevance(passage, terms) * 10 - passageIndex
      : -passageIndex * 20 - articleIndex,
  }))).sort((left, right) => right.score - left.score);
  for (const candidate of candidates) {
    candidate.slot.selected.add(candidate.passageIndex);
    if (utf8Length(render()) > LAW_CONTEXT_MAX_BYTES) candidate.slot.selected.delete(candidate.passageIndex);
  }
  const sources = slots.filter((slot) => slot.selected.size).map((slot): FinancialLawGroundingSource => ({
    id: slot.article.sourceId,
    title: `${guidance.law.lawName} 제${slot.article.articleNumber}조${slot.article.articleTitle ? ` (${slot.article.articleTitle})` : ""}`,
    excerpt: selectedText(slot),
    url: slot.article.sourceUrl,
    publisher: guidance.publisher,
    reviewedAt: guidance.law.retrievedAt.slice(0, 10),
    truncated: Boolean(slot.article.textTruncated) || slot.selected.size < slot.passages.length,
  }));
  return { context: render(), sources };
}

export function formatFinancialLawContext(guidance: FinancialLawGuidance, query = "") {
  return buildFinancialLawContext(guidance, query).context;
}

/** Exactly the selected official text passed to the model, never the unseen remainder. */
export function formatFinancialLawGroundingSources(guidance: FinancialLawGuidance, query = "") {
  return buildFinancialLawContext(guidance, query).sources;
}
