import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Resolve the runtime already installed with Wrangler, without invoking its CLI,
// reading deployment configuration, installing packages, or using a remote D1.
const fromWrangler = createRequire(import.meta.resolve("wrangler"));
const { Miniflare, Log, LogLevel } = fromWrangler("miniflare");
const root = fileURLToPath(new URL("..", import.meta.url));
const now = Date.parse("2026-08-31T03:00:00Z");
const sourceId = "synthetic-worker-rag";

function item(id, title) {
  return {
    id, title, category: "youth", summary: "합성 호환성 검사 자료. 상세 신청 요건은 원문 확인 필요.",
    source: "합성 테스트 기관", sourceUrl: "https://www.youthcenter.go.kr/", tags: ["전국"],
    publishedAt: "2026-08-01", discoveredAt: "2026-08-30T00:00:00Z",
    lastVerifiedAt: "2026-08-30T00:00:00Z", expiresAt: "2026-09-30",
  };
}

function payload(items) {
  return JSON.stringify({ categories: [{ id: "youth", items }] });
}

// D1.batch takes complete SQL statements. This helper only frames this checked-in
// migration's statements; it keeps trigger bodies intact and does not rewrite SQL.
function migrationStatements(sql) {
  const statements = [];
  let lines = [];
  let trigger = false;
  for (const line of sql.split(/\r?\n/u)) {
    if (!lines.length && (!line.trim() || /^\s*--/u.test(line))) continue;
    lines.push(line);
    if (/^\s*CREATE TRIGGER\b/iu.test(line)) trigger = true;
    if (trigger ? /^\s*END;\s*$/iu.test(line) : /;\s*$/u.test(line)) {
      statements.push(lines.join("\n"));
      lines = [];
      trigger = false;
    }
  }
  assert.equal(lines.join("\n").trim(), "", "the complete migration must be executed");
  assert.ok(statements.length > 0);
  return statements;
}

async function put(database, items) {
  return database.prepare(`INSERT OR REPLACE INTO public_data_catalog_chunks
    (source_id, category, chunk_index, payload, item_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(sourceId, "youth", 0, payload(items), items.length, now).run();
}

test("public RAG migration and live search work through ephemeral workerd D1", { timeout: 30_000 }, async (t) => {
  let outboundAttempts = 0;
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    outboundAttempts += 1;
    throw new Error("unexpected_node_fetch_in_offline_worker_test");
  };
  t.after(() => { globalThis.fetch = savedFetch; });

  const mf = new Miniflare({
    host: "127.0.0.1", port: 0, modules: true, compatibilityDate: "2026-05-15",
    script: "export default { fetch() { return new Response('synthetic-rag-test'); } };",
    d1Databases: { DB: "synthetic-rag-compatibility-only" },
    d1Persist: false, cachePersist: false, durableObjectsPersist: false,
    kvPersist: false, r2Persist: false, cache: false, cf: false,
    log: new Log(LogLevel.ERROR),
    outboundService() {
      outboundAttempts += 1;
      throw new Error("unexpected_worker_outbound_in_offline_test");
    },
  });
  t.after(() => mf.dispose());
  const database = await mf.getD1Database("DB");
  const vite = await createServer({
    root, configFile: false, appType: "custom", logLevel: "silent",
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { "@": root } }, server: { middlewareMode: true },
  });
  t.after(() => vite.close());
  const rag = await vite.ssrLoadModule("/lib/rag/public-catalog.ts");
  const migration = await readFile(new URL("../drizzle/0023_public_rag_index.sql", import.meta.url), "utf8");
  const statements = migrationStatements(migration);
  await database.batch([
    database.prepare(`CREATE TABLE public_data_catalog_chunks (
      source_id TEXT, category TEXT, chunk_index INTEGER, payload TEXT,
      item_count INTEGER, updated_at INTEGER, PRIMARY KEY(source_id,category,chunk_index))`),
    database.prepare("CREATE TABLE public_api_source_state (source_id TEXT PRIMARY KEY, last_error TEXT)"),
  ]);
  await put(database, [item("worker-rent", "청년 월세 지원"), item("worker-scholarship", "대학생 장학금")]);

  await t.test("0023 backfills the catalogue and its FTS5 index through D1", async () => {
    const result = await database.batch(statements.map((sql) => database.prepare(sql)));
    assert.ok(result.every((entry) => entry.success));
    assert.equal(await database.prepare("SELECT COUNT(*) AS n FROM public_rag_documents").first("n"), 2);
    assert.equal(await database.prepare("SELECT COUNT(*) AS n FROM public_rag_fts WHERE public_rag_fts MATCH ?")
      .bind('"월세"*').first("n"), 1);
    // Replaying the real migration must neither duplicate nor corrupt the index.
    await database.batch(statements.map((sql) => database.prepare(sql)));
    assert.equal(await database.prepare("SELECT COUNT(*) AS n FROM public_rag_documents").first("n"), 2);
  });

  await t.test("the unchanged application BM25 query and search wrapper return evidence", async () => {
    const direct = await database.prepare(rag.PUBLIC_RAG_SEARCH_SQL)
      .bind(rag.publicRagMatchExpression("월세 지원"), 0, "2026-08-31", 0).all();
    assert.ok(direct.success);
    assert.ok(direct.results.some((row) => JSON.parse(row.payload).id === "worker-rent"));
    const rank = await database.prepare("SELECT bm25(public_rag_fts, 6.0, 1.0, 3.0) AS score FROM public_rag_fts WHERE public_rag_fts MATCH ?")
      .bind('"월세"*').first("score");
    assert.ok(Number.isFinite(rank));
    const result = await rag.searchPublicCatalogEvidence("월세 지원", { database, now });
    assert.equal(result.status, "ready");
    assert.deepEqual(result.hits.map((hit) => hit.document.id), ["public:worker-rent"]);
  });

  await t.test("chunk replacement and UPDATE refresh FTS tokens and application results", async () => {
    await put(database, [item("worker-replacement", "대학생 학자금대출 이자지원")]);
    assert.equal(await database.prepare("SELECT COUNT(*) AS n FROM public_rag_fts WHERE public_rag_fts MATCH ?")
      .bind('"월세"*').first("n"), 0);
    const replaced = await rag.searchPublicCatalogEvidence("학자금대출 이자지원", { database, now });
    assert.equal(replaced.status, "ready");
    assert.deepEqual(replaced.hits.map((hit) => hit.document.id), ["public:worker-replacement"]);
    await database.prepare("UPDATE public_data_catalog_chunks SET payload = ? WHERE source_id = ?")
      .bind(payload([item("worker-updated", "청년 창업지원")]), sourceId).run();
    assert.equal(await database.prepare("SELECT doc_id FROM public_rag_documents").first("doc_id"), "worker-updated");
    assert.equal(await database.prepare("SELECT COUNT(*) AS n FROM public_rag_fts WHERE public_rag_fts MATCH ?")
      .bind('"학자금대출"*').first("n"), 0);
    const updated = await rag.searchPublicCatalogEvidence("창업지원", { database, now });
    assert.equal(updated.status, "ready");
    assert.deepEqual(updated.hits.map((hit) => hit.document.id), ["public:worker-updated"]);
  });

  await t.test("chunk deletion removes both projections and leaves a real no-match result", async () => {
    await database.prepare("DELETE FROM public_data_catalog_chunks WHERE source_id = ?").bind(sourceId).run();
    assert.equal(await database.prepare("SELECT COUNT(*) AS n FROM public_rag_documents").first("n"), 0);
    assert.equal(await database.prepare("SELECT COUNT(*) AS n FROM public_rag_fts WHERE public_rag_fts MATCH ?")
      .bind('"창업지원"*').first("n"), 0);
    const result = await rag.searchPublicCatalogEvidence("창업지원", { database, now });
    assert.equal(result.status, "no-match");
    assert.deepEqual(result.hits, []);
  });
  assert.equal(outboundAttempts, 0, "only Miniflare's internal loopback D1 transport is used");
});
