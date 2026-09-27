/** Evidence supplied to the model, not a larger document that it never saw. */
export interface GroundingSource {
  id: string;
  title: string;
  excerpt: string;
  url?: string;
}

export interface GroundingOptions {
  /** Disable for greetings or other answers that make no source-based claim. */
  requireCitations?: boolean;
  /** Disable separately for user-entered amounts and explicitly labelled calculations. */
  requireNumericGrounding?: boolean;
  /** Legal answers can require at least one supplied `law-go-kr:` citation. */
  requiredCitationPrefix?: string;
}

export type GroundingClaim = {
  text: string;
  value: string;
  kind: "amount" | "rate" | "date";
};

export interface GroundingInspection<T extends GroundingSource = GroundingSource> {
  ok: boolean;
  citedSourceIds: string[];
  usedSources: T[];
  unknownSourceIds: string[];
  unknownUrls: string[];
  missingCitations: boolean;
  unsupportedClaims: GroundingClaim[];
  reasons: string[];
}

type NumericClaim = GroundingClaim & { key: string };
type PositionedValue = { key: string; start: number; end: number };
type DurationMention = { keys: string[]; start: number; end: number };
const CITATION = /\[([^\]\r\n]{1,180})\]/gu;
const SOURCE_ID_SHAPE = /^(?:[\p{L}][\p{L}\p{N}._:-]{1,179}|\d{1,6})$/u;
const NUMBER = "[+-]?\\d[\\d,]*(?:\\.\\d+)?";
const KOREAN_SCALE = "(?:천억|백억|십억|천만|백만|십만|조|억|만|천|兆|億|亿|万|千|billion|million|thousand)";
const CURRENCY = "(?:원|달러|유로|위안|엔|円|元|won|dollars?|euros?|yen|yuan|KRW|USD|EUR|JPY|CNY)";
const AMOUNT = new RegExp(
  `(?:[₩$€¥]\\s*${NUMBER}(?:\\s*${KOREAN_SCALE})?|(?:KRW|USD|EUR|JPY|CNY)\\s*${NUMBER}(?:\\s*${KOREAN_SCALE})?|${NUMBER}(?:\\s*${KOREAN_SCALE})?(?:\\s*${NUMBER}\\s*${KOREAN_SCALE}){0,3}\\s*${CURRENCY})`,
  "giu",
);
const AMOUNT_RANGE = new RegExp(`(${NUMBER})\\s*(?:~|∼|–|—|to)\\s*(${NUMBER})\\s*(${KOREAN_SCALE})?\\s*(${CURRENCY})`, "giu");
const RATE = new RegExp(`(${NUMBER})(?:\\s*(?:~|∼|–|—|to)\\s*(${NUMBER}))?\\s*(%p|%|퍼센트포인트|퍼센트|percentage points?|percent|パーセント)`, "giu");
const DURATION = /(\d+(?:\.\d+)?(?:\s*(?:\/|,|·|및|와|과|또는|or)\s*\d+(?:\.\d+)?)*)\s*(개월|달|months?|년|years?|か月|ヶ月|个月|個月)/giu;
const DATE = /(?<!\d)((?:19|20|21)\d{2})(?:(?:\s*[-/.]\s*|\s*[년年]\s*)(\d{1,2})(?:(?:\s*[-/.]\s*|\s*[월月]\s*)(\d{1,2})\s*[일日]?)?\s*[월月]?|\s*[년年])(?!\d)/gu;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NAMED_DATE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20|21)\d{2})\b/giu;
const SCALE: Record<string, number> = {
  천: 1_000, 만: 10_000, 십만: 100_000, 백만: 1_000_000, 천만: 10_000_000,
  억: 100_000_000, 십억: 1_000_000_000, 백억: 10_000_000_000, 천억: 100_000_000_000,
  조: 1_000_000_000_000,
  千: 1_000, 万: 10_000, 億: 100_000_000, 亿: 100_000_000, 兆: 1_000_000_000_000,
  thousand: 1_000, million: 1_000_000, billion: 1_000_000_000,
};

function unique(values: string[]) {
  return [...new Set(values)];
}

function citationIds(text: string, known: ReadonlyMap<string, GroundingSource>) {
  return [...text.matchAll(CITATION)]
    .filter((match) => known.has(match[1].trim()) || text[match.index + match[0].length] !== "(")
    .map((match) => match[1].trim())
    .filter((id) => known.has(id) || SOURCE_ID_SHAPE.test(id));
}

function normalizedUrl(value: string) {
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function answerUrls(text: string) {
  const bare = [...text.matchAll(/https?:\/\/[^\s<>\]"']+/giu)]
    .map((match) => match[0].replace(/[),.;!?]+$/u, ""));
  const markdown = [...text.matchAll(/\]\(\s*([^\s)]+)(?:\s+"[^"\r\n]*")?\s*\)/gu)]
    .map((match) => match[1]);
  return unique([...bare, ...markdown]);
}

function citedIdsIncludingUrls(text: string, known: ReadonlyMap<string, GroundingSource>) {
  const urls = new Set(answerUrls(text).map(normalizedUrl));
  return unique([...citationIds(text, known), ...[...known.values()]
    .filter((source) => source.url && urls.has(normalizedUrl(source.url)))
    .map((source) => source.id)]);
}

function numberValue(value: string) {
  return Number(value.replaceAll(",", ""));
}

function amountKey(value: string) {
  const currency = /\$|USD|dollar|달러/iu.test(value) ? "USD"
    : /€|EUR|euro|유로/iu.test(value) ? "EUR"
      : /CNY|yuan|위안|元/iu.test(value) ? "CNY"
        : /¥|JPY|yen|엔|円/iu.test(value) ? "JPY" : "KRW";
  const components = [...value.matchAll(new RegExp(`(${NUMBER})\\s*(${KOREAN_SCALE})?`, "giu"))];
  const amount = components.reduce((sum, match) => sum + numberValue(match[1]) * (SCALE[match[2]?.toLocaleLowerCase()] ?? 1), 0);
  return `${currency}:${Math.abs(amount) <= Number.MAX_SAFE_INTEGER ? amount : value.replace(/[\s,]/gu, "").toLocaleLowerCase()}`;
}

function claimText(text: string) {
  // Identifiers and URLs often contain numbers, but are not factual numeric claims.
  return text.normalize("NFKC")
    .replace(CITATION, " ")
    .replace(/https?:\/\/\S+/giu, " ");
}

function numericClaims(text: string): NumericClaim[] {
  const normalized = claimText(text);
  const claims: NumericClaim[] = [];
  const amountRanges = [...normalized.matchAll(AMOUNT_RANGE)];
  for (const match of amountRanges) {
    for (const number of [match[1], match[2]]) {
      const value = `${number}${match[3] ?? ""}${match[4]}`;
      claims.push({ text, value, kind: "amount", key: `amount:${amountKey(value)}` });
    }
  }
  for (const match of normalized.matchAll(AMOUNT)) {
    if (amountRanges.some((range) => match.index >= range.index && match.index < range.index + range[0].length)) continue;
    claims.push({ text, value: match[0], kind: "amount", key: `amount:${amountKey(match[0])}` });
  }
  for (const match of normalized.matchAll(new RegExp(`百分之\\s*(${NUMBER})`, "gu"))) {
    claims.push({ text, value: match[0], kind: "rate", key: `rate:percent:${numberValue(match[1])}` });
  }
  for (const match of normalized.matchAll(RATE)) {
    const unit = /%p|퍼센트포인트|percentage point/iu.test(match[3]) ? "points" : "percent";
    for (const value of [match[1], match[2]].filter((value): value is string => Boolean(value))) {
      claims.push({ text, value: `${value}${match[3]}`, kind: "rate", key: `rate:${unit}:${numberValue(value)}` });
    }
  }
  for (const match of normalized.matchAll(DATE)) {
    const year = Number(match[1]);
    const month = match[2] ? Number(match[2]) : null;
    const day = match[3] ? Number(match[3]) : null;
    const value = [String(year), ...(month === null ? [] : [String(month).padStart(2, "0")]), ...(day === null ? [] : [String(day).padStart(2, "0")])].join("-");
    const valid = (month === null || month >= 1 && month <= 12)
      && (day === null || month !== null && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate());
    claims.push({ text, value: match[0], kind: "date", key: `${valid ? "date" : "invalid-date"}:${value}` });
  }
  for (const match of normalized.matchAll(NAMED_DATE)) {
    const month = MONTHS.indexOf(match[1].toLocaleLowerCase()) + 1;
    const day = Number(match[2]);
    const valid = day >= 1 && day <= new Date(Date.UTC(Number(match[3]), month, 0)).getUTCDate();
    claims.push({ text, value: match[0], kind: "date", key: `${valid ? "date" : "invalid-date"}:${match[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
  }
  return claims;
}

function durationMentions(text: string): DurationMention[] {
  const mentions: DurationMention[] = [];
  for (const match of text.matchAll(DURATION)) {
    const years = /^(?:년|years?)$/iu.test(match[2]);
    const values = [...match[1].matchAll(/\d+(?:\.\d+)?/gu)]
      .map((number) => numberValue(number[0]))
      // Calendar years are metadata, not a deposit term. Financial product
      // terms above these bounds are also too ambiguous to bind safely.
      .filter((value) => value > 0 && (years ? value <= 50 : value <= 600))
      .map((value) => value * (years ? 12 : 1));
    if (!values.length) continue;
    mentions.push({
      keys: unique(values.map((value) => `term-months:${value}`)),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return mentions;
}

function rateValues(text: string): PositionedValue[] {
  const values: PositionedValue[] = [];
  for (const match of text.matchAll(new RegExp(`百分之\\s*(${NUMBER})`, "gu"))) {
    values.push({ key: `rate:percent:${numberValue(match[1])}`, start: match.index, end: match.index + match[0].length });
  }
  for (const match of text.matchAll(RATE)) {
    const unit = /%p|퍼센트포인트|percentage point/iu.test(match[3]) ? "points" : "percent";
    for (const value of [match[1], match[2]].filter((item): item is string => Boolean(item))) {
      values.push({ key: `rate:${unit}:${numberValue(value)}`, start: match.index, end: match.index + match[0].length });
    }
  }
  return values.sort((left, right) => left.start - right.start || left.end - right.end);
}

function evidenceKeys(source: GroundingSource) {
  // Collection/review dates and URLs must not accidentally validate a deadline.
  const keys = new Set<string>();
  for (const claim of numericClaims(`${source.title}\n${source.excerpt}`)) {
    keys.add(claim.key);
    if (claim.kind === "date") {
      const parts = claim.key.split("-");
      if (parts.length > 1) keys.add(parts[0]);
      if (parts.length > 2) keys.add(parts.slice(0, 2).join("-"));
    }
  }
  return keys;
}

/** Keep trailing citations with the statement before them, not the next claim. */
function statements(answer: string) {
  const result: string[] = [];
  for (const line of answer.split(/\r?\n/gu)) {
    if (!line.trim()) continue;
    if (/^\s*(?:\[[^\]\r\n]+\]\s*)+$/u.test(line) && result.length) {
      result[result.length - 1] += ` ${line.trim()}`;
      continue;
    }
    let start = 0;
    let inBracket = false;
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === "[") inBracket = true;
      if (line[index] === "]") inBracket = false;
      if (inBracket || !/[.!?。！？]/u.test(line[index])) continue;
      if (line[index] === "." && /\d/u.test(line[index - 1] ?? "") && /\d/u.test(line[index + 1] ?? "")) continue;
      // Do not split URLs or abbreviations in the middle of a non-whitespace token.
      if (line[index] === "." && line[index + 1] && !/\s|\[/u.test(line[index + 1])) continue;
      const suffix = /^(?:\s*\[[^\]\r\n]{1,180}\])*/u.exec(line.slice(index + 1))?.[0] ?? "";
      const end = index + 1 + suffix.length;
      result.push(line.slice(start, end));
      start = end;
      index = end - 1;
    }
    if (line.slice(start).trim()) result.push(line.slice(start));
  }
  return result;
}

/**
 * Bind a rate to the term written in the same evidence statement/row. Merely
 * finding both values somewhere in a cited product is insufficient: e.g. a
 * 24-month 2.8% row must not validate a claim of 12 months at 2.8%.
 */
function rateDurationAssociations(text: string) {
  const associations: Array<{ rateKey: string; durationKeys: string[] }> = [];
  for (const rawStatement of statements(claimText(text))) {
    const durations = durationMentions(rawStatement);
    const rates = rateValues(rawStatement);
    if (!durations.length || !rates.length) continue;
    for (let index = 0; index < rates.length; index += 1) {
      const rate = rates[index];
      const previousRateEnd = index ? rates[index - 1].end : 0;
      const nextRateStart = rates[index + 1]?.start ?? rawStatement.length;
      let relevant = durations.filter((duration) => duration.start >= previousRateEnd && duration.end <= rate.start);
      if (!relevant.length) {
        const carried = [...durations].reverse().find((duration) => duration.end <= rate.start);
        if (carried) relevant = [carried];
      }
      if (!relevant.length) relevant = durations.filter((duration) => duration.start >= rate.end && duration.end <= nextRateStart);
      const durationKeys = unique(relevant.flatMap((duration) => duration.keys));
      if (durationKeys.length) associations.push({ rateKey: rate.key, durationKeys });
    }
  }
  return associations;
}

function evidenceRateDurationKeys(source: GroundingSource) {
  const result = new Set<string>();
  for (const association of rateDurationAssociations(`${source.title}\n${source.excerpt}`)) {
    for (const durationKey of association.durationKeys) result.add(`${durationKey}|${association.rateKey}`);
  }
  return result;
}

/**
 * A deterministic ID/URL and numeric-evidence check, NOT semantic entailment.
 * A valid result does not establish legal correctness or prove that a source
 * supports the meaning of every sentence. Callers must label it accordingly.
 */
export function inspectAnswerGrounding<T extends GroundingSource>(
  answer: string,
  sources: readonly T[],
  options: GroundingOptions = {},
): GroundingInspection<T> {
  const known = new Map(sources.filter((source) => source.id && source.excerpt.trim()).map((source) => [source.id, source]));
  const allIds = citedIdsIncludingUrls(answer, known);
  const citedSourceIds = allIds.filter((id) => known.has(id));
  const usedSources = citedSourceIds.map((id) => known.get(id) as T);
  const unknownSourceIds = allIds.filter((id) => !known.has(id));
  const missingCitations = (options.requireCitations ?? true) && !citedSourceIds.length;
  const allowedUrls = new Set(sources.map((source) => source.url ? normalizedUrl(source.url) : null).filter((url): url is string => Boolean(url)));
  const unknownUrls = answerUrls(answer).filter((url) => !allowedUrls.has(normalizedUrl(url) ?? ""));
  const keysBySource = new Map(usedSources.map((source) => [source.id, evidenceKeys(source)]));
  const rateDurationKeysBySource = new Map(usedSources.map((source) => [source.id, evidenceRateDurationKeys(source)]));
  const unsupportedClaims: GroundingClaim[] = [];
  if (options.requireNumericGrounding !== false) {
    // A trailing reference may support a short paragraph, but must not bleed
    // across a blank line or a separate list item. Explicit sentence references
    // still take precedence over that paragraph reference.
    for (const paragraph of answer.split(/\r?\n\s*\r?\n|\r?\n(?=\s*(?:[-*]|\d+[.)])\s)/u)) {
      const parts = statements(paragraph);
      const trailingIds = paragraph.length <= 1200
        ? citedIdsIncludingUrls(parts.at(-1) ?? "", known).filter((id) => known.has(id)) : [];
      for (const statement of parts) {
        const explicitIds = citedIdsIncludingUrls(statement, known).filter((id) => known.has(id));
        const ids = explicitIds.length ? explicitIds : trailingIds;
        const unsupportedRateRelations = new Set(rateDurationAssociations(statement)
          .filter((association) => !ids.some((id) => association.durationKeys.every((durationKey) =>
            rateDurationKeysBySource.get(id)?.has(`${durationKey}|${association.rateKey}`))))
          .map((association) => association.rateKey));
        for (const { key, ...claim } of numericClaims(statement)) {
          if (key.startsWith("invalid-") || !ids.some((id) => keysBySource.get(id)?.has(key)) || unsupportedRateRelations.has(key)) {
            unsupportedClaims.push(claim);
          }
        }
      }
    }
  }
  const reasons = [
    ...(!answer.trim() ? ["empty_answer"] : []),
    ...(unknownSourceIds.length ? ["unknown_source_id"] : []),
    ...(unknownUrls.length ? ["unknown_source_url"] : []),
    ...(missingCitations ? ["missing_citations"] : []),
    ...(options.requiredCitationPrefix && !citedSourceIds.some((id) => id.startsWith(options.requiredCitationPrefix as string)) ? ["missing_required_citation"] : []),
    ...(unsupportedClaims.length ? ["unsupported_numeric_claim"] : []),
  ];
  return { ok: !reasons.length, citedSourceIds, usedSources, unknownSourceIds, unknownUrls, missingCitations, unsupportedClaims, reasons };
}
