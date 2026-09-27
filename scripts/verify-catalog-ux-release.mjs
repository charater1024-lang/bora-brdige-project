// Read-only production verification. Public counts and bounded search outcomes
// only; no credentials, sessions, user financial values or model requests.
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const [path] = process.argv.slice(2);
if (!path || !isAbsolute(path) || !/\.sqlite3?$/u.test(path) || !lstatSync(path).isFile()
  || lstatSync(path).isSymbolicLink() || realpathSync(path) !== path) throw new Error("explicit_canonical_database_required");
const db = new DatabaseSync(path, { readOnly: true });
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { "@": root } },
  server: { middlewareMode: true, watch: null } });
try {
  const { searchPublicCatalogEvidence } = await vite.ssrLoadModule("/lib/rag/public-catalog.ts");
  const database = { prepare(sql) { return { bind(...args) { return { async all() { return { results: db.prepare(sql).all(...args) }; } }; } }; } };
  const probes = [];
  for (const query of ["제주 청년희망 대출", "서울 청년 월세 지원", "학자금 대출 신청 조건", "12개월 예금 금리"]) {
    const result = await searchPublicCatalogEvidence(query, { database });
    probes.push({ query, status: result.status, candidates: result.candidateCount, hits: result.hits.length, elapsedMs: result.elapsedMs });
  }
  const appliedMigrations = db.prepare("SELECT migration_name FROM bora_local_schema_migrations WHERE migration_name IN ('0023_public_rag_index.sql','0024_public_rag_refresh.sql','0025_public_catalog_generations.sql','0026_financial_company_snapshot_guard.sql') ORDER BY migration_name").all();
  const staleFinancialCompanyDocuments = db.prepare("SELECT COUNT(*) AS n FROM public_rag_documents WHERE source_id='financial-company' AND (length(published_at) != 10 OR date(published_at, '+0 days') IS NULL OR date(published_at, '+0 days') != published_at OR date(published_at) NOT BETWEEN date('now', '+9 hours', '-30 days') AND date('now', '+9 hours', '+1 day'))").get().n;
  const report = {
    mode: "read-only-public-verification",
    databaseCheck: db.prepare("PRAGMA quick_check").get().quick_check,
    indexDocuments: db.prepare("SELECT COUNT(*) AS n FROM public_rag_documents").get().n,
    youthPolicies: db.prepare("SELECT COUNT(*) AS n FROM public_rag_documents WHERE source_id='youth-center'").get().n,
    badYouthYear2000Dates: db.prepare("SELECT COUNT(*) AS n FROM public_rag_documents WHERE source_id='youth-center' AND expires_at LIKE '2000-01-01%'").get().n,
    youthUnknownExpiry: db.prepare("SELECT COUNT(*) AS n FROM public_rag_documents WHERE source_id='youth-center' AND (expires_at IS NULL OR expires_at='')").get().n,
    youthKnownStart: db.prepare("SELECT COUNT(*) AS n FROM public_rag_documents WHERE source_id='youth-center' AND json_extract(payload,'$.applicationStartsAt') IS NOT NULL").get().n,
    sourceStatus: db.prepare("SELECT source_id,last_error,reserved_calls,consecutive_failures FROM public_api_source_state WHERE source_id IN ('work24','kstartup','dart','financial-company') ORDER BY source_id").all(),
    work24Setting: db.prepare("SELECT key_name,enabled FROM service_api_settings WHERE key_name='WORK24_API_KEY'").all(),
    staleFinancialCompanyDocuments,
    migrations: appliedMigrations,
    probes,
  };
  if (
    report.databaseCheck !== "ok"
    || report.staleFinancialCompanyDocuments !== 0
    || !report.migrations.some(({ migration_name: name }) => (
      name === "0026_financial_company_snapshot_guard.sql"
    ))
  ) {
    throw new Error("post_deploy_public_catalog_verification_failed");
  }
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally { await vite.close(); db.close(); }
