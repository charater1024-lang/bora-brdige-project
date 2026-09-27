import { formatFinancialLawGroundingSources, type FinancialLawGuidance } from "./financial-law";
import { renderOfficialLawExcerpts, type FinancialLawSummaryLocale } from "./financial-law-summary-cache";

export const LAW_EXCERPT_QUALITY_VERSION = "complete-block-order-v1";
type Block = { id: string; title: string; excerpt: string };

// A transparent ordering heuristic, not a legal correctness or readability proof.
function relevance(block: Block) {
  // The law name (e.g. 예금자보호법) is shared by every block, not an article signal.
  const heading = block.title.replace(/^.*?제\d+(?:의\d+)?조/u, "");
  return /보험금|청구|보호|철회|피해|구제|설명의무|금지|권리/u.test(heading) ? 3
    : /보험료|설립|조직|회계|임원/u.test(heading) ? 1 : 2;
}
function score(blocks: readonly Block[]) {
  return blocks.reduce((total, block, index) => total + relevance(block) * (blocks.length - index), 0);
}

export function lawExcerptOrderingInput(guidance: FinancialLawGuidance) {
  return formatFinancialLawGroundingSources(guidance).map((block, index) => ({
    id: `S${index + 1}`, title: block.title,
  }));
}

/** Model output can only reorder COMPLETE server-owned blocks. It cannot supply prose. */
export function selectLawExcerptCandidate(
  guidance: FinancialLawGuidance, locale: FinancialLawSummaryLocale, candidate: unknown,
) {
  const blocks = formatFinancialLawGroundingSources(guidance);
  const baseline = renderOfficialLawExcerpts(blocks, locale);
  const baseScore = score(blocks);
  const fallback = { summary: baseline, selected: false, score: baseScore, baselineScore: baseScore,
    order: blocks.map((_block, index) => `S${index + 1}`), rubric: LAW_EXCERPT_QUALITY_VERSION };
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return fallback;
  const object = candidate as Record<string, unknown>;
  if (Object.keys(object).length !== 1 || !Array.isArray(object.order)) return fallback;
  const order = object.order;
  const ids = fallback.order;
  if (order.length !== ids.length || new Set(order).size !== ids.length
    || !order.every((id): id is string => typeof id === "string" && ids.includes(id))) return fallback;
  const reordered = order.map((id) => blocks[ids.indexOf(id)]);
  const candidateScore = score(reordered);
  if (candidateScore <= baseScore) return fallback;
  return { summary: renderOfficialLawExcerpts(reordered, locale), selected: true,
    score: candidateScore, baselineScore: baseScore, order, rubric: LAW_EXCERPT_QUALITY_VERSION };
}

export function parseLawExcerptCandidate(raw: string): unknown {
  if (raw.length > 2_000) return null;
  try { return JSON.parse(raw.trim()); } catch { return null; }
}

export function lawExcerptQualityCacheModel(model: string) {
  return `${model}:${LAW_EXCERPT_QUALITY_VERSION}`;
}
