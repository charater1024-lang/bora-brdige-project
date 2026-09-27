import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { performance } from "node:perf_hooks";
import test from "node:test";

const initial = readFileSync(new URL("../drizzle/0023_public_rag_index.sql", import.meta.url), "utf8");
const incremental = readFileSync(new URL("../drizzle/0024_public_rag_refresh.sql", import.meta.url), "utf8");
const epoch = Date.parse("2026-09-01T00:00:00Z");
function item(id, extra = {}) {
  return { id, title: `StableToken policy ${id}`, category: "youth", summary: "Unchanged public evidence.",
    source: "Synthetic official source", sourceUrl: "https://www.youthcenter.go.kr/", tags: ["nationwide"],
    publishedAt: "2026-08-01", discoveredAt: "2026-08-01T00:00:00Z", lastVerifiedAt: "2026-09-01T00:00:00Z",
    applicationStartsAt: "2026-09-01", expiresAt: "2026-10-01", ...extra };
}
function put(db, chunk, items, at = epoch, source = "synthetic", category = "youth") {
  db.prepare("INSERT OR REPLACE INTO public_data_catalog_chunks VALUES(?,?,?,?,?,?)")
    .run(source, category, chunk, JSON.stringify({ categories: [{ id: category, items }] }), items.length, at);
}
function setup(t, updated = true) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`PRAGMA recursive_triggers=OFF;
    CREATE TABLE public_data_catalog_chunks (source_id TEXT, category TEXT, chunk_index INTEGER,
      payload TEXT, item_count INTEGER, updated_at INTEGER, PRIMARY KEY(source_id,category,chunk_index));`);
  db.exec(initial);
  if (updated) db.exec(incremental);
  return db;
}
function rows(db) { return db.prepare("SELECT * FROM public_rag_documents ORDER BY source_id,category,doc_id").all(); }
function matches(db, query) { return db.prepare("SELECT count(*) AS n FROM public_rag_fts WHERE public_rag_fts MATCH ?").get(query).n; }
function integrity(db) {
  db.exec("INSERT INTO public_rag_fts(public_rag_fts,rank) VALUES('integrity-check',1)");
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE name='public_rag_chunk_members'").get()) {
    for (const [left, right] of [["public_rag_chunk_members", "public_rag_catalog_projection"], ["public_rag_catalog_projection", "public_rag_chunk_members"]]) {
      assert.equal(db.prepare(`SELECT count(*) AS n FROM (
        SELECT source_id,category,chunk_index,doc_id FROM ${left}
        EXCEPT SELECT source_id,category,chunk_index,doc_id FROM ${right})`).get().n, 0, "membership must match every current chunk");
    }
  }
}
function counters(db) {
  const counts = { insert: 0, delete: 0, update: 0, ftsStatements: 0 };
  // SQLite forbids observers on FTS shadow tables. Test-only UDF calls are
  // inserted immediately before the existing FTS statements, retaining each
  // checked-in trigger's WHEN condition and SQL. These count logical statement
  // executions, not physical disk writes, FTS segment writes, memory or latency.
  db.function("test_fts_statement", () => { counts.ftsStatements += 1; return 0; });
  for (const trigger of db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'public_rag_document_%'").all()) {
    const observed = trigger.sql.replace(/INSERT INTO public_rag_fts\b/gu, "SELECT test_fts_statement();\nINSERT INTO public_rag_fts");
    db.exec(`DROP TRIGGER ${trigger.name}; ${observed}`);
  }
  for (const event of ["insert", "delete", "update"]) {
    db.function(`test_document_${event}`, () => { counts[event] += 1; return 0; });
    db.exec(`CREATE TEMP TRIGGER observe_${event} AFTER ${event.toUpperCase()} ON main.public_rag_documents
      BEGIN SELECT test_document_${event}(); END;`);
  }
  return { counts, reset() { for (const key of Object.keys(counts)) counts[key] = 0; } };
}
test("1000-record metadata refresh retains row IDs and avoids document/FTS replacement work", (t) => {
  const results = {};
  for (const [name, updated] of [["0023", false], ["0024", true]]) {
    const db = setup(t, updated);
    const observer = counters(db);
    const records = Array.from({ length: 1000 }, (_, index) => item(`policy-${index}`));
    for (let chunk = 0; chunk < 10; chunk++) put(db, chunk, records.slice(chunk * 100, (chunk + 1) * 100));
    const before = new Map(rows(db).map(row => [row.doc_id, row.row_id]));
    observer.reset();
    let latest;
    for (let round = 1; round <= 3; round++) {
      latest = records.map(record => ({ ...record, lastVerifiedAt: `2026-09-0${round + 1}T00:00:00Z`, expiresAt: `2026-10-0${round + 1}` }));
      db.exec("BEGIN");
      for (let chunk = 0; chunk < 10; chunk++) put(db, chunk, latest.slice(chunk * 100, (chunk + 1) * 100), epoch + round * 86400000);
      db.exec("COMMIT");
    }
    results[name] = { ...observer.counts };
    assert.equal(rows(db).length, 1000);
    assert.equal(matches(db, "stabletoken"), 1000);
    integrity(db);
    if (updated) {
      assert.deepEqual(observer.counts, { insert: 0, delete: 0, update: 3000, ftsStatements: 0 });
      for (const row of rows(db)) {
        assert.equal(row.row_id, before.get(row.doc_id));
        assert.equal(row.verified_at, "2026-09-04T00:00:00Z");
        assert.equal(row.expires_at, "2026-10-04");
        assert.equal(JSON.parse(row.payload).applicationStartsAt, "2026-09-01");
      }
      observer.reset();
      for (let chunk = 0; chunk < 10; chunk++) put(db, chunk, latest.slice(chunk * 100, (chunk + 1) * 100), epoch + 3 * 86400000);
      assert.deepEqual(observer.counts, { insert: 0, delete: 0, update: 0, ftsStatements: 0 });
    } else assert.deepEqual(observer.counts, { insert: 3000, delete: 3000, update: 0, ftsStatements: 6000 });
  }
  t.diagnostic(`Synthetic 1000 records x 3 metadata refreshes; logical operations: ${JSON.stringify(results)}`);
});
test("text changes update only affected FTS entries; disappeared documents are removed", (t) => {
  const db = setup(t);
  put(db, 0, [item("a"), item("b"), item("c")]);
  const before = new Map(rows(db).map(row => [row.doc_id, row.row_id]));
  const observer = counters(db);
  put(db, 0, [item("a", { title: "ChangedToken", summary: "Changed body", tags: ["ChangedTag"] }), item("b")]);
  assert.deepEqual(observer.counts, { insert: 0, delete: 1, update: 1, ftsStatements: 3 });
  assert.equal(matches(db, "changedtoken"), 1);
  assert.equal(matches(db, "stabletoken"), 1);
  for (const row of rows(db)) assert.equal(row.row_id, before.get(row.doc_id));
  integrity(db);
});
test("moving and overlapping chunks preserve one document and rehome a deleted owner", (t) => {
  const db = setup(t);
  put(db, 0, [item("a")]);
  const rowId = rows(db)[0].row_id;
  put(db, 1, [item("a"), item("b")], epoch + 1);
  integrity(db);
  put(db, 0, []);
  integrity(db);
  assert.equal(rows(db).length, 2);
  assert.equal(rows(db).find(row => row.doc_id === "a").row_id, rowId);
  put(db, 0, [item("a", { title: "OlderToken" })], epoch + 2);
  put(db, 1, [item("a", { title: "NewerToken" }), item("b")], epoch + 3);
  integrity(db);
  db.exec("DELETE FROM public_data_catalog_chunks WHERE chunk_index=1");
  assert.equal(rows(db).length, 1);
  assert.equal(rows(db)[0].row_id, rowId);
  assert.equal(rows(db)[0].chunk_index, 0);
  assert.equal(matches(db, "oldertoken"), 1);
  assert.equal(matches(db, "newertoken"), 0);
  integrity(db);
  db.exec("DELETE FROM public_data_catalog_chunks");
  assert.equal(rows(db).length, 0);
  assert.equal(matches(db, "oldertoken"), 0);
  integrity(db);
});
test("UPDATE payload and chunk identity changes remove stale source/category ownership", (t) => {
  const db = setup(t);
  put(db, 0, [item("old")]);
  const payload = JSON.stringify({ categories: [{ id: "finance", items: [item("new", { category: "finance" })] }] });
  db.prepare("UPDATE public_data_catalog_chunks SET source_id='replacement',category='finance',chunk_index=2,payload=?").run(payload);
  assert.equal(rows(db).length, 1);
  assert.equal(rows(db)[0].doc_id, "new");
  assert.equal(rows(db)[0].source_id, "replacement");
  assert.equal(rows(db)[0].category, "finance");
  assert.equal(rows(db)[0].chunk_index, 2);
  integrity(db);
});
test("same-key UPDATE and UPDATE OR REPLACE keep membership synchronized through key collisions", (t) => {
  const db = setup(t);
  put(db, 0, [item("a"), item("removed")]);
  put(db, 1, [item("collision")]);
  const before = rows(db).find(row => row.doc_id === "a").row_id;
  db.prepare("UPDATE public_data_catalog_chunks SET payload=? WHERE chunk_index=0")
    .run(JSON.stringify({ categories: [{ id: "youth", items: [item("a", { applicationStartsAt: "2026-09-03" }), item("added")] }] }));
  assert.deepEqual(rows(db).map(row => row.doc_id), ["a", "added", "collision"]);
  assert.equal(rows(db).find(row => row.doc_id === "a").row_id, before);
  integrity(db);
  db.exec("UPDATE OR REPLACE public_data_catalog_chunks SET chunk_index=1 WHERE chunk_index=0");
  assert.deepEqual(rows(db).map(row => row.doc_id), ["a", "added"]);
  assert.ok(rows(db).every(row => row.chunk_index === 1));
  assert.equal(rows(db).find(row => row.doc_id === "a").row_id, before);
  integrity(db);
});
test("recursive-trigger replacement remains correct, including duplicate and removed records", (t) => {
  const db = setup(t);
  db.exec("PRAGMA recursive_triggers=ON");
  put(db, 0, [item("a"), item("b")]);
  put(db, 1, [item("b"), item("c")]);
  integrity(db);
  put(db, 0, [item("a", { title: "ChangedToken" })]);
  integrity(db);
  assert.equal(rows(db).length, 3);
  assert.equal(matches(db, "changedtoken"), 1);
  assert.equal(matches(db, "stabletoken"), 2);
  db.exec("DELETE FROM public_data_catalog_chunks WHERE chunk_index=1");
  assert.equal(rows(db).length, 1);
  assert.equal(rows(db)[0].doc_id, "a");
  integrity(db);
});

test("rehome execution plan uses indexed exact chunks instead of a source-wide JSON scan", (t) => {
  const db = setup(t);
  const update = incremental.match(/  UPDATE public_rag_documents SET[\s\S]*?;/u)[0]
    .replaceAll("new.source_id", "'synthetic'").replaceAll("new.category", "'youth'").replaceAll("new.chunk_index", "0");
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${update}`).all().map(row => row.detail).join("\n");
  assert.match(plan, /SEARCH c USING INDEX [^\n]+\(source_id=\? AND category=\? AND chunk_index=\?\)/u);
  assert.match(plan, /SEARCH m USING COVERING INDEX public_rag_chunk_members_doc_idx \(source_id=\? AND category=\? AND doc_id=\?\)/u);
  assert.doesNotMatch(plan, /SCAN c\b/u);
  t.diagnostic("JSON expansion is behind the (source_id, category, chunk_index) point lookup; membership uses the covering doc-id index.");
});

test("1000 and 10000 record whole replacement, reverse ordering, and deletion stay bounded", { timeout: 30000 }, async (t) => {
  const timings = [];
  for (const size of [1000, 10000]) for (const scenario of ["replace", "reverse", "delete"]) {
    for (const [version, updated] of [["0023", false], ["0024", true]]) {
      await t.test(`${version} ${size} ${scenario}`, (child) => {
        const db = setup(child, updated);
        const records = Array.from({ length: size }, (_, index) => item(`policy-${index}`));
        const write = (items, at) => {
          db.exec("BEGIN");
          for (let offset = 0; offset < items.length; offset += 100) put(db, offset / 100, items.slice(offset, offset + 100), at);
          db.exec("COMMIT");
        };
        write(records, epoch);
        const next = scenario === "replace" ? records.map((record, index) => ({ ...record, id: `replacement-${index}` })) : [...records].reverse();
        const start = performance.now();
        if (scenario === "delete") db.exec("DELETE FROM public_data_catalog_chunks");
        else write(next, epoch + 1);
        timings.push({ version, size, scenario, milliseconds: Math.round(performance.now() - start) });
        assert.equal(rows(db).length, scenario === "delete" ? 0 : size);
        assert.equal(matches(db, "stabletoken"), scenario === "delete" ? 0 : size);
        integrity(db);
      });
    }
  }
  t.diagnostic(`Synthetic timings (not a production latency promise): ${JSON.stringify(timings)}`);
});
test("0024 can backfill start dates and replay without duplicating or changing row IDs", (t) => {
  const db = setup(t, false);
  put(db, 0, [item("a")]);
  const before = rows(db)[0].row_id;
  assert.equal(JSON.parse(rows(db)[0].payload).applicationStartsAt, undefined);
  db.exec(incremental);
  assert.equal(rows(db)[0].row_id, before);
  assert.equal(JSON.parse(rows(db)[0].payload).applicationStartsAt, "2026-09-01");
  db.exec(incremental);
  assert.equal(rows(db).length, 1);
  assert.equal(rows(db)[0].row_id, before);
  assert.equal(matches(db, "stabletoken"), 1);
  integrity(db);
});

function migrationStatements(sql) {
  const statements = [];
  let lines = [];
  let trigger = false;
  for (const line of sql.split(/\r?\n/u)) {
    if (!lines.length && (!line.trim() || /^\s*--/u.test(line))) continue;
    lines.push(line);
    if (/^\s*CREATE TRIGGER\b/iu.test(line)) trigger = true;
    if (trigger ? /^\s*END;\s*$/iu.test(line) : /;\s*$/u.test(line)) {
      statements.push(lines.join("\n")); lines = []; trigger = false;
    }
  }
  assert.equal(lines.join("\n").trim(), "");
  return statements;
}
test("0024 executes through ephemeral workerd D1 and preserves row IDs on metadata refresh", { timeout: 30000 }, async (t) => {
  const fromWrangler = createRequire(import.meta.resolve("wrangler"));
  const { Miniflare, Log, LogLevel } = fromWrangler("miniflare");
  let outboundAttempts = 0;
  const mf = new Miniflare({
    host: "127.0.0.1", port: 0, modules: true, compatibilityDate: "2026-05-15",
    script: "export default { fetch() { return new Response('synthetic-refresh-only'); } };",
    d1Databases: { DB: "synthetic-rag-refresh-only" },
    d1Persist: false, cachePersist: false, durableObjectsPersist: false, kvPersist: false, r2Persist: false,
    cache: false, cf: false, log: new Log(LogLevel.ERROR),
    outboundService() { outboundAttempts += 1; throw new Error("unexpected_outbound_in_refresh_test"); },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  await db.prepare(`CREATE TABLE public_data_catalog_chunks (source_id TEXT, category TEXT, chunk_index INTEGER,
    payload TEXT, item_count INTEGER, updated_at INTEGER, PRIMARY KEY(source_id,category,chunk_index))`).run();
  await db.batch(migrationStatements(initial).map(sql => db.prepare(sql)));
  const putWorker = async (chunk, items, at = epoch) => db.prepare("INSERT OR REPLACE INTO public_data_catalog_chunks VALUES(?,?,?,?,?,?)")
    .bind("synthetic", "youth", chunk, JSON.stringify({ categories: [{ id: "youth", items }] }), items.length, at).run();
  await putWorker(0, [item("a")]);
  await putWorker(1, [item("b"), item("c")]);
  const before = await db.prepare("SELECT row_id FROM public_rag_documents WHERE doc_id='a'").first("row_id");
  await db.batch(migrationStatements(incremental).map(sql => db.prepare(sql)));
  await putWorker(0, [item("a", { expiresAt: "2026-12-31", applicationStartsAt: "2026-09-02" })], epoch + 1);
  const row = await db.prepare("SELECT row_id,expires_at,payload FROM public_rag_documents WHERE doc_id='a'").first();
  assert.equal(row.row_id, before);
  assert.equal(row.expires_at, "2026-12-31");
  assert.equal(JSON.parse(row.payload).applicationStartsAt, "2026-09-02");
  await putWorker(0, [item("a", { title: "ChangedToken" })], epoch + 2);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM public_rag_fts WHERE public_rag_fts MATCH 'changedtoken'").first("n"), 1);
  await putWorker(2, [item("a", { title: "NewestToken" })], epoch + 3);
  await db.prepare("DELETE FROM public_data_catalog_chunks WHERE chunk_index=2").run();
  assert.equal(await db.prepare("SELECT row_id FROM public_rag_documents WHERE doc_id='a'").first("row_id"), before);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM public_rag_fts WHERE public_rag_fts MATCH 'changedtoken'").first("n"), 1);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM public_rag_fts WHERE public_rag_fts MATCH 'newesttoken'").first("n"), 0);
  await db.prepare("DELETE FROM public_data_catalog_chunks").run();
  assert.equal(await db.prepare("SELECT count(*) AS n FROM public_rag_documents").first("n"), 0);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM public_rag_chunk_members").first("n"), 0);
  await db.prepare("INSERT INTO public_rag_fts(public_rag_fts,rank) VALUES('integrity-check',1)").run();
  assert.equal(outboundAttempts, 0);
});
