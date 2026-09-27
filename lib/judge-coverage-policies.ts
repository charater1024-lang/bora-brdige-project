type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function bool(value: unknown) {
  return value === true;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export type CoveragePolicyResult = {
  accepted: boolean;
  violations: string[];
};

function policyResult(checks: ReadonlyArray<readonly [string, boolean]>): CoveragePolicyResult {
  const violations = checks.filter(([, passed]) => !passed).map(([id]) => id);
  return { accepted: violations.length === 0, violations };
}

export function evaluateStoredApiCoverageContract(input: unknown): CoveragePolicyResult {
  const candidate = record(input);
  const kind = text(candidate.kind);

  if (kind === "health") {
    return policyResult([
      ["method", candidate.method === "GET"],
      ["path", candidate.path === "/api/health"],
      ["http-status", candidate.httpStatus === 200],
      ["body-status", candidate.bodyStatus === "ok"],
      ["content-type", text(candidate.contentType).toLowerCase().startsWith("application/json")],
      ["no-store", text(candidate.cacheControl).toLowerCase().includes("no-store")],
      ["personal-data-absent", candidate.containsPersonalData === false],
    ]);
  }

  if (kind === "public-data") {
    return policyResult([
      ["method", candidate.method === "GET"],
      ["path", text(candidate.path).startsWith("/api/public-data/")],
      ["http-status", candidate.httpStatus === 200],
      ["status-disclosure", candidate.bodyStatus === "live" || candidate.bodyStatus === "partial"],
      ["source-present", finite(candidate.sourceCount) >= 1],
      ["https-sources", bool(candidate.allSourcesHttps)],
      ["source-dates", bool(candidate.allSourceDatesPresent)],
      ["item-present", finite(candidate.itemCount) >= 1],
      ["synthetic-fixture", bool(candidate.syntheticFixture)],
      ["personal-data-absent", candidate.containsPersonalData === false],
    ]);
  }

  if (kind === "phishing") {
    return policyResult([
      ["method", candidate.method === "POST"],
      ["path", candidate.path === "/api/phishing"],
      ["same-origin", bool(candidate.sameOrigin)],
      ["content-type", text(candidate.contentType).toLowerCase().startsWith("application/json")],
      ["body-size", finite(candidate.bodyChars) >= 1 && finite(candidate.bodyChars) <= 60_000],
      ["input-size", finite(candidate.inputChars) >= 1 && finite(candidate.inputChars) <= 20_000],
      ["locale", ["ko", "en", "ja", "zh"].includes(text(candidate.locale))],
      ["client-score-absent", candidate.clientSuppliedScore === false],
      ["live-url-absent", candidate.containsLiveUrl === false],
    ]);
  }

  if (kind === "judge-session") {
    const method = text(candidate.method);
    const action = text(candidate.action);
    const validAction = method === "GET"
      ? action === "list" || action === "read"
      : method === "POST"
        ? ["create", "run", "diagnostics"].includes(action)
        : method === "PUT"
          ? ["review", "seal"].includes(action)
          : false;
    return policyResult([
      ["developer-auth", bool(candidate.authenticatedDeveloper)],
      ["same-origin", bool(candidate.sameOrigin)],
      ["method", ["GET", "POST", "PUT"].includes(method)],
      ["action", validAction],
      ["content-type", method === "GET" || text(candidate.contentType).toLowerCase().startsWith("application/json")],
      ["body-size", method === "GET" || (finite(candidate.bodyBytes) >= 2 && finite(candidate.bodyBytes) <= 65_536)],
      ["client-results-absent", candidate.clientSuppliedResults === false],
      ["client-score-absent", candidate.clientSuppliedScore === false],
    ]);
  }

  if (kind === "request-security") {
    const method = text(candidate.method);
    const mutation = method !== "GET" && method !== "HEAD";
    return policyResult([
      ["method", ["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method)],
      ["same-origin", !mutation || bool(candidate.sameOrigin)],
      ["content-type", !mutation || text(candidate.contentType).toLowerCase().startsWith("application/json")],
      ["body-size", !mutation || (finite(candidate.bodyBytes) >= 2 && finite(candidate.bodyBytes) <= 65_536)],
      ["secret-absent", candidate.containsSecret === false],
      ["url-userinfo-absent", candidate.containsUrlUserInfo === false],
      ["formula-prefix-absent", candidate.containsFormulaPrefix === false],
    ]);
  }

  return { accepted: false, violations: ["unknown-contract-kind"] };
}

export function evaluateReproducibilityCoverageContract(input: unknown): CoveragePolicyResult {
  const candidate = record(input);
  const kind = text(candidate.kind);

  if (kind === "artifact-integrity") {
    return policyResult([
      ["sha256", bool(candidate.sha256Valid)],
      ["unique-ids", bool(candidate.uniqueCaseIds)],
      ["suite-count", candidate.suiteCount === 6],
      ["cases-per-suite", candidate.casesPerSuite === 100],
      ["total-cases", candidate.totalCases === 600],
      ["source-refs", bool(candidate.sourceRefsResolved)],
      ["provenance", bool(candidate.provenancePresent)],
      ["immutable-id", bool(candidate.immutableDatasetId)],
    ]);
  }

  if (kind === "runner-boundary") {
    return policyResult([
      ["network-calls", candidate.networkCalls === 0],
      ["model-calls", candidate.modelCalls === 0],
      ["wall-clock-calls", candidate.wallClockCalls === 0],
      ["random-calls", candidate.randomCalls === 0],
      ["repeatability", bool(candidate.repeatByteIdentical)],
      ["case-count", candidate.observedCases === 600],
      ["failure-detail-bound", finite(candidate.failureDetailLimit) >= 1 && finite(candidate.failureDetailLimit) <= 32],
      ["session-budget", finite(candidate.sessionBudgetChars) >= 1 && finite(candidate.sessionBudgetChars) <= 81_920],
    ]);
  }

  if (kind === "export-contract") {
    return policyResult([
      ["schema-version", candidate.schemaVersion === "bora-judge-coverage-compact/v1"],
      ["formula-safe", bool(candidate.formulaSafe)],
      ["secrets-redacted", bool(candidate.secretsRedacted)],
      ["summary-row", candidate.summaryRows === 1],
      ["suite-rows", candidate.suiteRows === 6],
      ["failure-detail-bound", finite(candidate.failureDetailLimit) >= 1 && finite(candidate.failureDetailLimit) <= 32],
      ["bounded-failures-only", bool(candidate.boundedFailuresOnly)],
      ["full-case-rows-not-embedded", candidate.fullCaseRowsEmbedded === false],
      ["definitions-in-versioned-artifacts", bool(candidate.definitionsInVersionedArtifacts)],
      ["aggregate", bool(candidate.aggregateMatches)],
      ["limitations", bool(candidate.limitationsPresent)],
      ["diagnostic-separation", candidate.diagnosticsScored === false],
    ]);
  }

  if (kind === "evidence-boundary") {
    return policyResult([
      ["official-score", candidate.officialHackathonScore === false],
      ["expert-review", ["not_performed", "performed-and-documented"].includes(text(candidate.independentExpertReview))],
      ["quality-claim", candidate.qualityClaim === "coverage-regression-only"],
      ["personal-data", candidate.containsRealPersonalData === false],
      ["malicious-url", candidate.containsLiveMaliciousUrls === false],
      ["runtime-model", candidate.runtimeModelUse === false],
      ["diagnostic-score", candidate.diagnosticsScored === false],
      ["limitations", bool(candidate.limitationsPresent)],
    ]);
  }

  return { accepted: false, violations: ["unknown-reproducibility-kind"] };
}
