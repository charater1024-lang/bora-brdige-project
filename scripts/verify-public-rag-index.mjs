// Production catalogue is opened read-only. All index writes are in :memory:.
import { readFile, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "vite";

const databasePath = process.argv[2];
if (!databasePath || !/\.sqlite3?$/iu.test(databasePath)) throw new Error("An explicit source .sqlite file is required");
const stat = await lstat(databasePath);
if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Source must be a regular database file");
const root = fileURLToPath(new URL("..", import.meta.url));
const source = new DatabaseSync(resolve(databasePath), { readOnly: true });
const scratch = new DatabaseSync(":memory:");
const vite = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: { alias: { "@": root } }, server: { middlewareMode: true, watch: null } });
try {
  scratch.exec(`CREATE TABLE public_data_catalog_chunks (source_id TEXT, category TEXT, chunk_index INTEGER,
    payload TEXT, item_count INTEGER, updated_at INTEGER, PRIMARY KEY(source_id,category,chunk_index));
    CREATE TABLE public_api_source_state (source_id TEXT PRIMARY KEY, last_error TEXT);`);
  const put = scratch.prepare("INSERT INTO public_data_catalog_chunks VALUES(?,?,?,?,?,?)");
  let chunks = 0;
  for (const row of source.prepare("SELECT source_id,category,chunk_index,payload,item_count,updated_at FROM public_data_catalog_chunks").iterate()) {
    put.run(row.source_id, row.category, row.chunk_index, row.payload, row.item_count, row.updated_at);
    chunks += 1;
  }
  const putState = scratch.prepare("INSERT INTO public_api_source_state VALUES(?,?)");
  for (const row of source.prepare("SELECT source_id,last_error FROM public_api_source_state").iterate()) putState.run(row.source_id, row.last_error);
  const start = performance.now();
  for (const migration of [
    "0023_public_rag_index.sql",
    "0024_public_rag_refresh.sql",
    "0026_financial_company_snapshot_guard.sql",
  ]) scratch.exec(await readFile(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
  const buildMs = Math.round(performance.now() - start);
  scratch.exec("INSERT INTO public_rag_fts(public_rag_fts) VALUES('integrity-check')");
  const { searchPublicCatalogEvidence } = await vite.ssrLoadModule("/lib/rag/public-catalog.ts");
  const { buildBoundedRagMessages, ragSystemInstructions, restoreRagSourceIds } = await vite.ssrLoadModule("/lib/rag/context.ts");
  const { inspectAnswerGrounding } = await vite.ssrLoadModule("/lib/rag/grounding.ts");
  const modelEnvironmentIndex = process.argv.indexOf("--local-model-env");
  let localToken = null;
  let localModel = null;
  if (modelEnvironmentIndex >= 0) {
    // Explicit opt-in only, fixed loopback destination, never log the service key.
    const environmentPath = process.argv[modelEnvironmentIndex + 1];
    if (!environmentPath) throw new Error("Local model environment path is required");
    const environment = await readFile(environmentPath, "utf8");
    const value = /^\s*LOCAL_LLM_API_KEY\s*=\s*(.+?)\s*$/mu.exec(environment)?.[1];
    localToken = value?.replace(/^['"]|['"]$/gu, "");
    if (!localToken) throw new Error("Local service authentication is not configured");
    const health = await fetch("http://127.0.0.1:11435/health", { signal: AbortSignal.timeout(5000) }).then(r => r.json());
    if (health.model_state !== "ready" || !health.selected_model) throw new Error("Local model is not ready; no activation was attempted");
    localModel = health.selected_model;
  }
  const database = { prepare(sql) { return { bind(...args) { return { async all() { return { results: scratch.prepare(sql).all(...args) }; } }; } }; } };
  const probes = [];
  for (const query of ["서울 청년 월세 지원", "학자금 대출 신청 조건", "12개월 예금 금리", "부산 창업 공고", "취업 지원 정책"]) {
    const result = await searchPublicCatalogEvidence(query, { database });
    const packed = buildBoundedRagMessages({ instructions: ragSystemInstructions("ko", false, result.status), question: query,
      sources: result.hits.map(({ document }) => ({ ...document, kind: "public-catalog", url: document.sourceUrl,
        reviewedAt: document.verifiedAt?.slice(0, 10) ?? "" })) });
    const probe = { query, status: result.status, candidates: result.candidateCount, hits: result.hits.length,
      searchMs: result.elapsedMs, includedEvidence: packed.sources.length, estimatedInputTokens: packed.estimatedInputTokens };
    if (process.argv.includes("--show-evidence") && probes.length < 3) {
      probe.publicEvidence = packed.sources.slice(0, 2).map(({ id, title, excerpt }) => ({ id, title, excerpt }));
    }
    if (localToken && probes.length < 3 && packed.sources.length) {
      const inferenceStart = performance.now();
      try {
        const response = await fetch("http://127.0.0.1:11435/v1/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localToken}` },
          body: JSON.stringify({ model: localModel, messages: packed.messages, max_tokens: 500, temperature: 0.2 }),
          signal: AbortSignal.timeout(25_000),
        });
        if (!response.ok) throw new Error(`local-status-${response.status}`);
        const completion = await response.json();
        const answer = restoreRagSourceIds(completion.choices?.[0]?.message?.content ?? "", packed.citationAliases);
        const inspection = inspectAnswerGrounding(answer, packed.sources, { requireCitations: true, requireNumericGrounding: true });
        probe.localModel = { elapsedMs: Math.round(performance.now() - inferenceStart), model: localModel,
          usage: completion.usage,
          citationValueChecks: inspection.ok, reasons: inspection.reasons, answerPreview: answer.slice(0, 1200),
          semanticFaithfulnessMeasured: false };
      } catch {
        probe.localModel = { elapsedMs: Math.round(performance.now() - inferenceStart), status: "unavailable-or-timeout" };
      }
      process.stdout.write(`Completed bounded Local-model probe ${probes.length + 1}.\n`);
    }
    probes.push(probe);
  }
  process.stdout.write(JSON.stringify({ mode: "read-only-source-in-memory-index", sourceChunks: chunks, buildMs,
    indexed: scratch.prepare("SELECT category, COUNT(*) AS count FROM public_rag_documents GROUP BY category").all(),
    databaseCheck: scratch.prepare("PRAGMA quick_check").get().quick_check,
    peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024), probes }, null, 2) + "\n");
} finally {
  await vite.close();
  scratch.close();
  source.close();
}
