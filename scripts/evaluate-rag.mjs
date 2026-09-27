import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const RAG_DATASET_PATH = resolve(projectRoot, "evaluation/datasets/bora-rag-benchmark-v1.json");
const LOCALES = new Set(["ko", "en", "ja", "zh"]);
const CORPUS_STATUSES = new Set(["guidance-available", "detail-unavailable", "topic-unavailable"]);
const CASE_COLLECTIONS = ["knowledgeCases", "contextCases", "statisticsIntentCases", "citationCases", "publicRetrievalCases"];

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(`rag_diagnostic_invalid:${message}`);
}

function stringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateRagDataset(dataset) {
  requireCondition(dataset?.schemaVersion === "bora-rag-diagnostic/v1", "schema");
  requireCondition(typeof dataset.datasetId === "string" && dataset.datasetId.length > 0, "dataset_id");
  requireCondition(dataset.authorship?.independentHumanReview === "not_performed", "human_review_disclosure");
  requireCondition(dataset.authorship?.heldOutCertification === false, "held_out_disclosure");
  requireCondition(dataset.privacy?.syntheticOnly === true && dataset.privacy?.containsRealPersonalData === false, "synthetic_boundary");
  requireCondition(dataset.execution?.defaultModelCalls === 0 && dataset.execution?.defaultNetworkCalls === 0, "offline_boundary");
  requireCondition(dataset.execution?.rankingCutoff === 5, "ranking_cutoff");
  requireCondition(Number.isFinite(Date.parse(dataset.execution.publicFixtureNow)), "fixed_time");
  requireCondition(Array.isArray(dataset.claimBoundary) && dataset.claimBoundary.length >= 4, "claim_boundary");
  const seenIds = new Set();
  for (const name of CASE_COLLECTIONS) {
    requireCondition(Array.isArray(dataset[name]) && dataset[name].length > 0, `${name}_missing`);
    for (const item of dataset[name]) {
      requireCondition(typeof item.id === "string" && item.id.length > 0 && !seenIds.has(item.id), "case_id");
      seenIds.add(item.id);
      requireCondition(item.origin === "new-synthetic-diagnostic" || item.origin === "audit-regression-existing-core", `${item.id}_origin`);
      if (name !== "citationCases") {
        requireCondition(LOCALES.has(item.locale), `${item.id}_locale`);
        requireCondition(typeof item.query === "string" && item.query.length > 0, `${item.id}_query`);
      }
      if (name === "knowledgeCases" || name === "publicRetrievalCases") {
        requireCondition(CORPUS_STATUSES.has(item.corpusStatus), `${item.id}_corpus_status`);
        requireCondition(stringArray(item.relevantIds), `${item.id}_relevant_ids`);
        requireCondition(new Set(item.relevantIds).size === item.relevantIds.length, `${item.id}_duplicate_gold`);
        requireCondition(item.relevantIds.length > 0 || item.expectNoMatch === true, `${item.id}_negative_label`);
        requireCondition(!item.expectNoMatch || item.relevantIds.length === 0, `${item.id}_contradictory_gold`);
        requireCondition(item.corpusStatus !== "topic-unavailable" || item.relevantIds.length === 0, `${item.id}_unavailable_gold`);
        requireCondition(item.excludedIds === undefined || stringArray(item.excludedIds), `${item.id}_excluded_ids`);
      }
      if (name === "contextCases") {
        requireCondition(stringArray(item.priorUserQuestions) && stringArray(item.relevantIds), `${item.id}_context`);
        requireCondition(typeof item.expectedContextualized === "boolean" && typeof item.expectedNeedsClarification === "boolean", `${item.id}_context_expectation`);
      }
      if (name === "statisticsIntentCases") requireCondition(typeof item.expected === "boolean", `${item.id}_intent_expectation`);
      if (name === "citationCases") {
        requireCondition(typeof item.answer === "string" && stringArray(item.sourceIds), `${item.id}_citation`);
        requireCondition(item.category === "semantic-support-not-machine-graded" || typeof item.expected?.ok === "boolean", `${item.id}_citation_expectation`);
      }
    }
  }
  requireCondition(Array.isArray(dataset.citationSources) && Array.isArray(dataset.publicDocuments), "source_collections");
  for (const [name, sourceList] of [["citation", dataset.citationSources], ["public", dataset.publicDocuments]]) {
    requireCondition(new Set(sourceList.map((item) => item.id)).size === sourceList.length, `${name}_duplicate_source_id`);
    requireCondition(sourceList.every((item) => typeof item.id === "string" && typeof item.title === "string" && typeof item.excerpt === "string"), `${name}_source_shape`);
  }
  const citationIds = new Set(dataset.citationSources.map((item) => item.id));
  requireCondition(dataset.citationCases.every((item) => item.sourceIds.every((id) => citationIds.has(id))), "unknown_citation_fixture_source");
  const publicIds = new Set(dataset.publicDocuments.map((item) => item.id));
  requireCondition(dataset.publicRetrievalCases.every((item) => [...item.relevantIds, ...(item.excludedIds ?? [])].every((id) => publicIds.has(id))), "unknown_public_gold_source");
  return { totalCases: seenIds.size, caseCounts: Object.fromEntries(CASE_COLLECTIONS.map((name) => [name, dataset[name].length])) };
}

export async function readRagDataset(path = RAG_DATASET_PATH) {
  const bytes = await readFile(path);
  const dataset = JSON.parse(bytes.toString("utf8"));
  const shape = validateRagDataset(dataset);
  return { dataset, datasetSha256: hash(bytes), ...shape };
}

function legacyNormalize(value) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
}

// The pre-change algorithm is frozen here, not in the sealed judge artifacts.
// Both algorithms use the same current corpus; this is not a production replay.
export function legacySearchKnowledge(query, documents, limit = 5) {
  const normalized = legacyNormalize(query);
  if (!normalized) return [];
  const tokens = [...new Set(normalized.split(/\s+/u).filter((token) => token.length >= 2))];
  const cappedLimit = Math.min(10, Math.max(1, Math.trunc(limit) || 4));
  return documents.map((document) => {
    const title = legacyNormalize(document.title);
    const content = legacyNormalize(document.content);
    const keywords = document.keywords.map(legacyNormalize);
    const matchedKeywords = document.keywords.filter((_, index) => normalized.includes(keywords[index]) || keywords[index].includes(normalized));
    let score = matchedKeywords.length * 8;
    for (const token of tokens) {
      if (title.includes(token)) score += 5;
      if (keywords.some((keyword) => keyword.includes(token) || token.includes(keyword))) score += 4;
      if (content.includes(token)) score += 1;
    }
    return { document, score, matchedKeywords };
  }).filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id))
    .slice(0, cappedLimit);
}

export function legacyEmploymentStatisticsIntent(message) {
  const topic = /(?:청년|고령|노인|외국인|취업|고용|실업|경제활동|일자리|employment|unemployment|labou?r|job|若者|高齢|外国人|雇用|失業|青年|高龄|外国人|就业|失业)/iu;
  const statistics = /(?:통계|수치|비율|현황|추이|자료|지표|rate|statistic|figure|trend|data|統計|数値|比率|推移|统计|数值|比例|趋势)/iu;
  const normalized = message.trim().slice(0, 24_000);
  return topic.test(normalized) && statistics.test(normalized);
}

function uniqueAtCutoff(ids, cutoff) {
  return [...new Set(ids.slice(0, cutoff))];
}

export function retrievalMetrics(results, cutoff = 5) {
  requireCondition(cutoff === 5, "metric_cutoff");
  const labelled = results.filter((item) => item.relevantIds.length > 0);
  const negatives = results.filter((item) => item.expectNoMatch === true);
  let recallTotal = 0;
  let reciprocalRankTotal = 0;
  let firstHitCount = 0;
  for (const item of labelled) {
    const relevant = new Set(item.relevantIds);
    const retrieved = uniqueAtCutoff(item.retrievedIds, cutoff);
    const hits = retrieved.filter((id) => relevant.has(id)).length;
    const rank = item.retrievedIds.slice(0, cutoff).findIndex((id) => relevant.has(id));
    recallTotal += hits / relevant.size;
    if (rank >= 0) reciprocalRankTotal += 1 / (rank + 1);
    if (rank === 0) firstHitCount += 1;
  }
  const falsePositiveCases = negatives.filter((item) => uniqueAtCutoff(item.retrievedIds, cutoff).length > 0).length;
  const excludedLabelled = results.filter((item) => item.excludedIds?.length > 0);
  const exclusionViolations = excludedLabelled.filter((item) => item.retrievedIds.slice(0, cutoff).some((id) => item.excludedIds.includes(id))).length;
  return {
    cutoff,
    totalCases: results.length,
    labelledRelevantCases: labelled.length,
    recallAt5: labelled.length ? recallTotal / labelled.length : null,
    mrrAt5: labelled.length ? reciprocalRankTotal / labelled.length : null,
    top1HitRate: labelled.length ? firstHitCount / labelled.length : null,
    noMatchCases: negatives.length,
    noMatchFalsePositiveCases: falsePositiveCases,
    noMatchFalsePositiveRate: negatives.length ? falsePositiveCases / negatives.length : null,
    exclusionLabelledCases: excludedLabelled.length,
    exclusionViolationCases: exclusionViolations,
    exclusionViolationRate: excludedLabelled.length ? exclusionViolations / excludedLabelled.length : null,
  };
}

function groupedMetrics(results, key) {
  return Object.fromEntries([...new Set(results.map((item) => item[key]))].filter(Boolean).sort().map((value) => [
    value,
    retrievalMetrics(results.filter((item) => item[key] === value)),
  ]));
}

function retrievalSummary(results) {
  return {
    ...retrievalMetrics(results),
    byLocale: groupedMetrics(results, "locale"),
    byOrigin: groupedMetrics(results, "origin"),
    byCorpusStatus: groupedMetrics(results, "corpusStatus"),
  };
}

export function booleanMetrics(results) {
  const truePositives = results.filter((item) => item.expected && item.actual).length;
  const falsePositives = results.filter((item) => !item.expected && item.actual).length;
  const trueNegatives = results.filter((item) => !item.expected && !item.actual).length;
  const falseNegatives = results.filter((item) => item.expected && !item.actual).length;
  return {
    cases: results.length,
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    accuracy: results.length ? (truePositives + trueNegatives) / results.length : null,
    precision: truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : null,
    recall: truePositives + falseNegatives ? truePositives / (truePositives + falseNegatives) : null,
  };
}

function retrievalRows(items, retrieve) {
  return items.map((item) => ({
    id: item.id,
    locale: item.locale,
    origin: item.origin,
    corpusStatus: item.corpusStatus,
    query: item.query,
    relevantIds: item.relevantIds,
    excludedIds: item.excludedIds ?? [],
    expectNoMatch: item.expectNoMatch === true,
    retrievedIds: retrieve(item).map((hit) => hit.document.id),
  }));
}

function citationCaseResult(item, sourceById, inspect) {
  const inspected = inspect(item.answer, item.sourceIds.map((id) => sourceById.get(id)), item.options);
  const observed = {
    ok: inspected.ok,
    citedSourceIds: inspected.citedSourceIds,
    unknownSourceIds: inspected.unknownSourceIds,
    unknownUrls: inspected.unknownUrls ?? [],
    missingCitations: inspected.missingCitations,
    unsupportedClaimCount: inspected.unsupportedClaims.length,
    reasons: inspected.reasons,
  };
  if (item.category === "semantic-support-not-machine-graded") {
    return { id: item.id, status: "not-machine-graded", expected: item.expected, observed, semanticFaithfulnessMeasured: false };
  }
  const checks = [];
  for (const key of ["ok", "missingCitations"]) {
    if (typeof item.expected[key] === "boolean") checks.push({ field: key, passed: observed[key] === item.expected[key] });
  }
  if (item.expected.unknownSourceIds) {
    checks.push({ field: "unknownSourceIds", passed: JSON.stringify([...observed.unknownSourceIds].sort()) === JSON.stringify([...item.expected.unknownSourceIds].sort()) });
  }
  if (typeof item.expected.minimumUnsupportedClaims === "number") {
    checks.push({ field: "minimumUnsupportedClaims", passed: observed.unsupportedClaimCount >= item.expected.minimumUnsupportedClaims });
  }
  return { id: item.id, status: checks.every((check) => check.passed) ? "pass" : "fail", expected: item.expected, observed, checks, semanticFaithfulnessMeasured: false };
}

function modelAnswerSources(row, visibleSourceIds, runtime, dataset) {
  const knowledgeById = new Map(runtime.knowledge.FINANCIAL_KNOWLEDGE.map((item) => [item.id, { id: item.id, title: item.title, excerpt: item.content, url: item.source.url }]));
  const publicById = new Map(dataset.publicDocuments.map((item) => [item.id, { id: item.id, title: item.title, excerpt: item.excerpt, url: item.sourceUrl }]));
  return row.retrievedIds.filter((id) => visibleSourceIds.includes(id))
    .map((id) => knowledgeById.get(id) ?? publicById.get(id)).filter(Boolean);
}

// This opt-in path evaluates supplied model text, never invokes a model, and
// never trusts caller-provided evidence. Sources come from this run's retrieval.
export function evaluateSavedResponses(saved, retrievalResults, runtime, dataset) {
  requireCondition(saved?.schemaVersion === "bora-rag-saved-responses/v1", "response_schema");
  requireCondition(Array.isArray(saved.responses) && saved.responses.length > 0 && saved.responses.length <= 500, "response_count");
  const rows = new Map(retrievalResults.map((item) => [item.id, item]));
  const seen = new Set();
  const results = saved.responses.map((item) => {
    requireCondition(typeof item.caseId === "string" && rows.has(item.caseId) && !seen.has(item.caseId), "response_case_id");
    requireCondition(typeof item.answer === "string" && item.answer.length > 0 && item.answer.length <= 24_000, "response_answer");
    requireCondition(item.sources === undefined, "caller_supplied_sources_not_accepted");
    seen.add(item.caseId);
    const row = rows.get(item.caseId);
    requireCondition(stringArray(item.visibleSourceIds) && new Set(item.visibleSourceIds).size === item.visibleSourceIds.length, "visible_source_ids");
    requireCondition(item.visibleSourceIds.every((id) => row.retrievedIds.includes(id)), "visible_sources_must_be_retrieved");
    const sources = modelAnswerSources(row, item.visibleSourceIds, runtime, dataset);
    const result = runtime.grounding.inspectAnswerGrounding(item.answer, sources, {
      requireCitations: sources.length > 0,
      requireNumericGrounding: true,
    });
    return {
      caseId: item.caseId,
      mechanicalGroundingOk: result.ok,
      providedSourceIds: sources.map((source) => source.id),
      citedSourceIds: result.citedSourceIds,
      unknownSourceIds: result.unknownSourceIds,
      unknownUrlCount: result.unknownUrls?.length ?? 0,
      missingCitations: result.missingCitations,
      unsupportedClaimCount: result.unsupportedClaims.length,
      reasons: result.reasons,
      semanticFaithfulness: "not-machine-graded",
      adequateAnswerOrAbstention: "not-machine-graded",
      sourceVisibilityIndependentlyVerified: false,
    };
  });
  return {
    mode: "explicitly-supplied-saved-model-responses",
    modelCallsDuringEvaluation: 0,
    networkCallsDuringEvaluation: 0,
    responseAuthorshipIndependentlyVerified: false,
    semanticFaithfulnessMeasured: false,
    results,
    cases: results.length,
    mechanicalGroundingPassed: results.filter((item) => item.mechanicalGroundingOk).length,
    missingCitationCases: results.filter((item) => item.missingCitations).length,
    unsupportedNumericClaimCases: results.filter((item) => item.unsupportedClaimCount > 0).length,
    disclosure: "Stored output diagnostics only; declared visible source IDs are not independently verified. ID/URL/numeric checks do not establish answer correctness, semantic citation support, or an empirical hallucination rate.",
  };
}

export function evaluateRagDataset(dataset, runtime, { datasetSha256 = null, savedResponses = null } = {}) {
  const { totalCases, caseCounts } = validateRagDataset(dataset);
  const documents = runtime.knowledge.FINANCIAL_KNOWLEDGE;
  const knowledgeIds = new Set(documents.map((item) => item.id));
  requireCondition(dataset.knowledgeCases.every((item) => item.relevantIds.every((id) => knowledgeIds.has(id))), "unknown_knowledge_gold_source");
  requireCondition(dataset.contextCases.every((item) => item.relevantIds.every((id) => knowledgeIds.has(id))), "unknown_context_gold_source");
  const baselineKnowledge = retrievalRows(dataset.knowledgeCases, (item) => legacySearchKnowledge(item.query, documents, 5));
  const improvedKnowledge = retrievalRows(dataset.knowledgeCases, (item) => runtime.knowledge.searchKnowledge(item.query, 5));
  const contextResults = dataset.contextCases.map((item) => {
    const resolved = runtime.query.resolveRagQuery(item.query, item.priorUserQuestions);
    return {
      id: item.id,
      locale: item.locale,
      origin: item.origin,
      query: item.query,
      relevantIds: item.relevantIds,
      expectNoMatch: item.expectedNeedsClarification,
      baselineRetrievedIds: legacySearchKnowledge(item.query, documents, 5).map((hit) => hit.document.id),
      resolvedQuery: resolved.query,
      contextualized: resolved.contextualized,
      needsClarification: resolved.needsClarification,
      contextualizedCorrect: resolved.contextualized === item.expectedContextualized,
      clarificationCorrect: resolved.needsClarification === item.expectedNeedsClarification,
      retrievedIds: resolved.needsClarification ? [] : runtime.knowledge.searchKnowledge(resolved.query, 5).map((hit) => hit.document.id),
    };
  });
  const intentResults = dataset.statisticsIntentCases.map((item) => ({
    id: item.id,
    locale: item.locale,
    query: item.query,
    expected: item.expected,
    baseline: legacyEmploymentStatisticsIntent(item.query),
    improved: runtime.statistics.detectEmploymentStatisticsIntent(item.query),
  }));
  const publicResults = retrievalRows(dataset.publicRetrievalCases, (item) => runtime.publicCatalog.rankPublicRagDocuments(item.query, dataset.publicDocuments, {
    limit: 5,
    now: Date.parse(dataset.execution.publicFixtureNow),
  }));
  const citationById = new Map(dataset.citationSources.map((item) => [item.id, item]));
  const citationResults = dataset.citationCases.map((item) => citationCaseResult(item, citationById, runtime.grounding.inspectAnswerGrounding));
  const report = {
    schemaVersion: "bora-rag-diagnostic-report/v1",
    datasetId: dataset.datasetId,
    datasetSha256,
    corpusSha256: hash(JSON.stringify(documents)),
    corpusDocumentCount: documents.length,
    totalCases,
    caseCounts,
    execution: { mode: "synthetic-offline-diagnostic", modelCalls: 0, networkCalls: 0, fixedPublicTime: dataset.execution.publicFixtureNow },
    disclosure: dataset.claimBoundary,
    authorship: dataset.authorship,
    baseline: { name: "legacy-substring-scorer-2026-08-30", sameCurrentKnowledgeCorpus: true, fullProductionReplay: false },
    corpusAnswerabilityLabels: {
      description: "Synthetic author labels, not measured real-user answer coverage. Partial cases have a relevant general guide but no gold current value or eligibility decision.",
      ...Object.fromEntries([...CORPUS_STATUSES].map((status) => [status, dataset.knowledgeCases.filter((item) => item.corpusStatus === status).length])),
    },
    knowledge: { baseline: retrievalSummary(baselineKnowledge), improved: retrievalSummary(improvedKnowledge) },
    context: {
      cases: contextResults.length,
      contextualizedCorrect: contextResults.filter((item) => item.contextualizedCorrect).length,
      clarificationCorrect: contextResults.filter((item) => item.clarificationCorrect).length,
      baselineRetrieval: retrievalMetrics(contextResults.map((item) => ({ ...item, retrievedIds: item.baselineRetrievedIds }))),
      improvedRetrieval: retrievalMetrics(contextResults),
      privacyBoundary: "Only explicit synthetic prior questions passed to the resolver; no account or conversation database is accessed.",
    },
    employmentStatisticsIntent: {
      baseline: booleanMetrics(intentResults.map((item) => ({ ...item, actual: item.baseline }))),
      improved: booleanMetrics(intentResults.map((item) => ({ ...item, actual: item.improved }))),
    },
    publicCatalog: {
      baseline: null,
      baselineDisclosure: "No invented pre-change public-catalog ranking baseline; synthetic current-path diagnostics only.",
      improved: retrievalSummary(publicResults),
      usesSyntheticDocuments: true,
      sourceFreshnessInProductionMeasured: false,
    },
    citationBoundaries: {
      cases: citationResults.length,
      machineGradedCases: citationResults.filter((item) => item.status !== "not-machine-graded").length,
      passed: citationResults.filter((item) => item.status === "pass").length,
      failed: citationResults.filter((item) => item.status === "fail").length,
      semanticGapExamples: citationResults.filter((item) => item.status === "not-machine-graded").length,
      semanticFaithfulnessMeasured: false,
    },
    generation: savedResponses
      ? evaluateSavedResponses(savedResponses, [...improvedKnowledge, ...contextResults, ...publicResults], runtime, dataset)
      : { mode: "not-run", modelCalls: 0, semanticFaithfulnessMeasured: false, optIn: "--responses <saved-model-responses.json>" },
    caseResults: { baselineKnowledge, improvedKnowledge, context: contextResults, employmentStatisticsIntent: intentResults, publicCatalog: publicResults, citationBoundaries: citationResults },
  };
  return report;
}

export async function withRagRuntime(callback) {
  const { createServer } = await import("vite");
  const originalFetch = globalThis.fetch;
  let observedFetchCalls = 0;
  globalThis.fetch = async () => {
    observedFetchCalls += 1;
    throw new Error("rag_diagnostic_network_forbidden");
  };
  let server;
  try {
    server = await createServer({
      root: projectRoot,
      configFile: false,
      appType: "custom",
      logLevel: "silent",
      resolve: { alias: { "@": projectRoot } },
      server: { middlewareMode: true },
    });
    const [knowledge, query, statistics, grounding, publicCatalog] = await Promise.all([
      server.ssrLoadModule("/lib/rag/knowledge.ts"),
      server.ssrLoadModule("/lib/rag/query.ts"),
      server.ssrLoadModule("/lib/rag/public-statistics.ts"),
      server.ssrLoadModule("/lib/rag/grounding.ts"),
      server.ssrLoadModule("/lib/rag/public-catalog.ts"),
    ]);
    const output = await callback({ knowledge, query, statistics, grounding, publicCatalog });
    requireCondition(observedFetchCalls === 0, "observed_fetch_call");
    return output;
  } finally {
    try {
      if (server) await server.close();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
}

function percent(value) {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function formatRagReport(report) {
  const retrievalLine = (label, metric) => `${label}: Recall@5 ${percent(metric.recallAt5)}, MRR@5 ${metric.mrrAt5 == null ? "n/a" : metric.mrrAt5.toFixed(3)}, no-match false positives ${metric.noMatchFalsePositiveCases}/${metric.noMatchCases}`;
  return [
    `BORA RAG synthetic diagnostic — ${report.datasetId} (${report.totalCases} cases)`,
    "NOT held-out certification; synthetic labels are not independently human-reviewed.",
    `Network/model calls during evaluation: ${report.execution.networkCalls}/${report.execution.modelCalls}.`,
    retrievalLine("Knowledge legacy", report.knowledge.baseline),
    retrievalLine("Knowledge improved", report.knowledge.improved),
    retrievalLine("Context legacy", report.context.baselineRetrieval),
    retrievalLine("Context improved", report.context.improvedRetrieval),
    `Context decisions: ${report.context.contextualizedCorrect}/${report.context.cases}; clarification decisions: ${report.context.clarificationCorrect}/${report.context.cases}.`,
    `Employment intent: legacy ${percent(report.employmentStatisticsIntent.baseline.accuracy)} -> improved ${percent(report.employmentStatisticsIntent.improved.accuracy)}.`,
    retrievalLine("Public catalog (synthetic; no baseline)", report.publicCatalog.improved),
    `Public exclusions violated: ${report.publicCatalog.improved.exclusionViolationCases}/${report.publicCatalog.improved.exclusionLabelledCases}.`,
    `Citation boundaries: ${report.citationBoundaries.passed}/${report.citationBoundaries.machineGradedCases}; semantic-gap examples not graded: ${report.citationBoundaries.semanticGapExamples}.`,
    `Stored model-response diagnostics: ${report.generation.mode}. Semantic faithfulness remains unmeasured.`,
    "No combined readiness score, production accuracy claim, or hallucination-rate claim is produced.",
  ].join("\n");
}

export function parseRagArguments(args) {
  const options = { json: false, responsesPath: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--responses") {
      requireCondition(typeof args[index + 1] === "string" && !args[index + 1].startsWith("--") && !options.responsesPath, "responses_argument");
      options.responsesPath = resolve(projectRoot, args[++index]);
    } else throw new Error(`rag_diagnostic_unknown_argument:${argument}`);
  }
  return options;
}

async function main() {
  const options = parseRagArguments(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/evaluate-rag.mjs [--json] [--responses saved-model-responses.json]\nOffline synthetic diagnostics. No model or external API is invoked. Saved responses are opt-in and must use synthetic case IDs.");
    return;
  }
  const { dataset, datasetSha256 } = await readRagDataset();
  const savedResponses = options.responsesPath ? JSON.parse(await readFile(options.responsesPath, "utf8")) : null;
  const report = await withRagRuntime((runtime) => evaluateRagDataset(dataset, runtime, { datasetSha256, savedResponses }));
  console.log(options.json ? JSON.stringify(report, null, 2) : formatRagReport(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "rag_diagnostic_failed");
    process.exitCode = 1;
  });
}
