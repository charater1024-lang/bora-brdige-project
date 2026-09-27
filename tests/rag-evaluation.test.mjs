import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  booleanMetrics,
  evaluateRagDataset,
  evaluateSavedResponses,
  formatRagReport,
  legacyEmploymentStatisticsIntent,
  legacySearchKnowledge,
  parseRagArguments,
  readRagDataset,
  retrievalMetrics,
  validateRagDataset,
  withRagRuntime,
} from "../scripts/evaluate-rag.mjs";

const { dataset, datasetSha256 } = await readRagDataset();

test("the RAG diagnostic is explicitly synthetic and separate from sealed readiness scores", async () => {
  const shape = validateRagDataset(dataset);
  assert.equal(shape.totalCases, 99);
  assert.deepEqual(shape.caseCounts, {
    knowledgeCases: 51,
    contextCases: 8,
    statisticsIntentCases: 16,
    citationCases: 12,
    publicRetrievalCases: 12,
  });
  assert.equal(dataset.authorship.independentHumanReview, "not_performed");
  assert.equal(dataset.authorship.heldOutCertification, false);
  assert.equal(dataset.privacy.syntheticOnly, true);
  assert.equal(dataset.privacy.containsRealPersonalData, false);
  assert.match(datasetSha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual([...new Set(dataset.knowledgeCases.map((item) => item.locale))].sort(), ["en", "ja", "ko", "zh"]);
  assert.equal(dataset.knowledgeCases.filter((item) => item.origin === "audit-regression-existing-core").length, 2);
  assert.equal(dataset.knowledgeCases.filter((item) => item.corpusStatus === "topic-unavailable").length, 10);
  assert.equal(dataset.knowledgeCases.filter((item) => item.corpusStatus === "detail-unavailable").length, 4);
  assert.equal(dataset.citationCases.filter((item) => item.category === "semantic-support-not-machine-graded").length, 1);
  assert.equal("automaticPoints" in dataset, false);
  const runner = await readFile(new URL("../scripts/evaluate-rag.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /generateAICompletion|OPENAI_API_KEY|process\.env/u);
  assert.doesNotMatch(runner, /writeFile|appendFile|writeFileSync/u);
  assert.doesNotMatch(runner, /bora-judge-core|bora-judge-coverage/u);
});

test("diagnostic fixtures reject duplicate IDs, contradictory gold labels, and unknown sources", () => {
  const duplicate = structuredClone(dataset);
  duplicate.contextCases[0].id = duplicate.knowledgeCases[0].id;
  assert.throws(() => validateRagDataset(duplicate), /case_id/u);

  const contradictory = structuredClone(dataset);
  contradictory.knowledgeCases[0].expectNoMatch = true;
  assert.throws(() => validateRagDataset(contradictory), /contradictory_gold/u);

  const unknownSource = structuredClone(dataset);
  unknownSource.citationCases[0].sourceIds.push("not-a-supplied-source");
  assert.throws(() => validateRagDataset(unknownSource), /unknown_citation_fixture_source/u);

  const inflatedClaim = structuredClone(dataset);
  inflatedClaim.authorship.heldOutCertification = true;
  assert.throws(() => validateRagDataset(inflatedClaim), /held_out_disclosure/u);
});

test("Recall@5 and MRR@5 use only labelled relevant queries, with negatives reported separately", () => {
  const metrics = retrievalMetrics([
    { relevantIds: ["a", "b"], retrievedIds: ["x", "b", "a"], expectNoMatch: false },
    { relevantIds: ["z"], retrievedIds: [], expectNoMatch: false },
    { relevantIds: [], retrievedIds: [], expectNoMatch: true },
    { relevantIds: [], retrievedIds: ["x"], expectNoMatch: true },
  ]);
  assert.equal(metrics.totalCases, 4);
  assert.equal(metrics.labelledRelevantCases, 2);
  assert.equal(metrics.recallAt5, 0.5);
  assert.equal(metrics.mrrAt5, 0.25);
  assert.equal(metrics.top1HitRate, 0);
  assert.equal(metrics.noMatchCases, 2);
  assert.equal(metrics.noMatchFalsePositiveCases, 1);
  assert.equal(metrics.noMatchFalsePositiveRate, 0.5);
  assert.equal(retrievalMetrics([]).recallAt5, null);
  assert.equal(retrievalMetrics([]).mrrAt5, null);
  assert.equal(retrievalMetrics([]).noMatchFalsePositiveRate, null);
  assert.throws(() => retrievalMetrics([], 10), /metric_cutoff/u);
});

test("duplicate retrieval IDs neither inflate recall nor move a hit into the first five", () => {
  const metrics = retrievalMetrics([
    { relevantIds: ["a", "b"], retrievedIds: ["a", "a", "a"], expectNoMatch: false },
    { relevantIds: ["z"], retrievedIds: ["x", "x", "x", "x", "x", "z"], expectNoMatch: false },
  ]);
  assert.equal(metrics.recallAt5, 0.25);
  assert.equal(metrics.mrrAt5, 0.5);
  const rank = retrievalMetrics([{ relevantIds: ["a"], retrievedIds: ["x", "x", "a"], expectNoMatch: false }]);
  assert.equal(rank.mrrAt5, 1 / 3);
});

test("exclusion and intent diagnostics retain false positives and false negatives", () => {
  const exclusions = retrievalMetrics([
    { relevantIds: ["seoul"], retrievedIds: ["busan", "seoul"], excludedIds: ["busan"], expectNoMatch: false },
    { relevantIds: ["active"], retrievedIds: ["active"], excludedIds: ["expired"], expectNoMatch: false },
  ]);
  assert.equal(exclusions.exclusionLabelledCases, 2);
  assert.equal(exclusions.exclusionViolationCases, 1);
  assert.equal(exclusions.exclusionViolationRate, 0.5);
  assert.deepEqual(booleanMetrics([
    { expected: true, actual: true },
    { expected: true, actual: false },
    { expected: false, actual: true },
    { expected: false, actual: false },
  ]), { cases: 4, truePositives: 1, falsePositives: 1, trueNegatives: 1, falseNegatives: 1, accuracy: 0.5, precision: 0.5, recall: 0.5 });
  assert.equal(booleanMetrics([]).accuracy, null);
  assert.equal(booleanMetrics([{ expected: false, actual: false }]).precision, null);
});

test("the frozen baseline keeps the old substring and broad statistics-intent behavior", () => {
  const documents = [
    { id: "first", title: "First", content: "generic compare", keywords: ["start", "start"] },
    { id: "second", title: "Second", content: "generic compare", keywords: ["start"] },
  ];
  assert.deepEqual(legacySearchKnowledge("", documents), []);
  const baseline = legacySearchKnowledge("start", documents);
  assert.equal(baseline[0].document.id, "first");
  assert.equal(baseline[0].score, 20);
  assert.equal(baseline[1].score, 12);
  // A broad "data" + "job" trigger is intentionally preserved, not corrected in the baseline.
  assert.equal(legacyEmploymentStatisticsIntent("I need advice for a data analyst job interview."), true);
  assert.equal(legacyEmploymentStatisticsIntent("취업 면접 준비 자료를 찾아줘."), true);
});

test("default CLI has no model mode and saved-response evaluation requires an explicit file", () => {
  assert.deepEqual(parseRagArguments([]), { json: false, responsesPath: null, help: false });
  assert.equal(parseRagArguments(["--json"]).json, true);
  assert.equal(parseRagArguments(["--help"]).help, true);
  assert.match(parseRagArguments(["--responses", "synthetic-responses.json"]).responsesPath, /synthetic-responses\.json$/u);
  assert.throws(() => parseRagArguments(["--responses"]), /responses_argument/u);
  assert.throws(() => parseRagArguments(["--model-url", "https://provider.example"]), /unknown_argument/u);
});

test("real pure modules produce repeatable offline diagnostics without requiring every synthetic query to pass", async () => {
  const before = JSON.stringify(dataset);
  await withRagRuntime((runtime) => {
    const first = evaluateRagDataset(dataset, runtime, { datasetSha256 });
    const second = evaluateRagDataset(dataset, runtime, { datasetSha256 });
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(dataset), before);
    assert.equal(first.totalCases, 99);
    assert.equal(first.execution.networkCalls, 0);
    assert.equal(first.execution.modelCalls, 0);
    assert.equal(first.baseline.sameCurrentKnowledgeCorpus, true);
    assert.equal(first.baseline.fullProductionReplay, false);
    assert.equal(first.knowledge.baseline.labelledRelevantCases, 41);
    assert.equal(first.knowledge.improved.noMatchCases, 10);
    assert.equal(first.publicCatalog.baseline, null);
    assert.equal(first.publicCatalog.usesSyntheticDocuments, true);
    assert.equal(first.citationBoundaries.machineGradedCases, 11);
    assert.equal(first.citationBoundaries.semanticGapExamples, 1);
    assert.equal(first.citationBoundaries.semanticFaithfulnessMeasured, false);
    assert.equal(first.generation.mode, "not-run");
    assert.equal(first.generation.modelCalls, 0);
    assert.equal("totalScore" in first, false);
    assert.equal(first.caseResults.improvedKnowledge.length, 51);
    assert.equal(first.caseResults.context.length, 8);
    assert.equal(first.caseResults.employmentStatisticsIntent.length, 16);
    const summary = formatRagReport(first);
    assert.match(summary, /NOT held-out certification/u);
    assert.match(summary, /Semantic faithfulness remains unmeasured/u);
    assert.match(summary, /No combined readiness score/u);

    const relevantCase = first.caseResults.improvedKnowledge.find((item) => item.id === "audit-emergency-explicit");
    assert.ok(relevantCase.retrievedIds.includes("phishing-emergency-response"));
    const saved = {
      schemaVersion: "bora-rag-saved-responses/v1",
      responses: [{ caseId: relevantCase.id, visibleSourceIds: ["phishing-emergency-response"], answer: "공식 채널로 대응 절차를 확인하세요. [phishing-emergency-response]" }],
    };
    const savedResult = evaluateSavedResponses(saved, first.caseResults.improvedKnowledge, runtime, dataset);
    assert.equal(savedResult.modelCallsDuringEvaluation, 0);
    assert.equal(savedResult.networkCallsDuringEvaluation, 0);
    assert.equal(savedResult.semanticFaithfulnessMeasured, false);
    assert.equal(savedResult.mechanicalGroundingPassed, 1);
    assert.equal(savedResult.results[0].semanticFaithfulness, "not-machine-graded");
    assert.equal(savedResult.results[0].adequateAnswerOrAbstention, "not-machine-graded");
    assert.equal(savedResult.results[0].sourceVisibilityIndependentlyVerified, false);
    assert.equal("answer" in savedResult.results[0], false);

    const invented = structuredClone(saved);
    invented.responses[0].answer = "확인했습니다. [invented-source]";
    const inventedResult = evaluateSavedResponses(invented, first.caseResults.improvedKnowledge, runtime, dataset);
    assert.equal(inventedResult.mechanicalGroundingPassed, 0);
    assert.deepEqual(inventedResult.results[0].unknownSourceIds, ["invented-source"]);

    const forgedEvidence = structuredClone(saved);
    forgedEvidence.responses[0].sources = [{ id: "invented-source", excerpt: "fake evidence" }];
    assert.throws(() => evaluateSavedResponses(forgedEvidence, first.caseResults.improvedKnowledge, runtime, dataset), /caller_supplied_sources/u);
    const duplicateResponse = structuredClone(saved);
    duplicateResponse.responses.push({ ...duplicateResponse.responses[0] });
    assert.throws(() => evaluateSavedResponses(duplicateResponse, first.caseResults.improvedKnowledge, runtime, dataset), /response_case_id/u);
    const unprovidedEvidence = structuredClone(saved);
    unprovidedEvidence.responses[0].visibleSourceIds = [];
    const hiddenResult = evaluateSavedResponses(unprovidedEvidence, first.caseResults.improvedKnowledge, runtime, dataset);
    assert.equal(hiddenResult.mechanicalGroundingPassed, 0);
    assert.deepEqual(hiddenResult.results[0].unknownSourceIds, ["phishing-emergency-response"]);
    const nonRetrievedSource = structuredClone(saved);
    nonRetrievedSource.responses[0].visibleSourceIds = ["made-up-evidence"];
    assert.throws(() => evaluateSavedResponses(nonRetrievedSource, first.caseResults.improvedKnowledge, runtime, dataset), /visible_sources_must_be_retrieved/u);
  });
});

test("the evaluator blocks a fetch attempt before it can perform network IO", async () => {
  await assert.rejects(withRagRuntime(() => fetch("https://network.invalid/diagnostic-test")), /rag_diagnostic_network_forbidden/u);
});
