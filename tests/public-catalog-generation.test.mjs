import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

function payload(id) { return JSON.stringify({ categories: [{ id: "startup", items: [{ id, category: "startup" }] }] }); }
function publish(db, generation, count = 2) {
  db.exec("BEGIN IMMEDIATE");
  db.prepare("DELETE FROM public_data_catalog_chunks WHERE source_id=?").run("kstartup");
  db.prepare(`INSERT INTO public_data_catalog_chunks SELECT source_id,category,chunk_index,payload,item_count,300
    FROM public_data_catalog_generations WHERE source_id=? AND generation_id=? ORDER BY category,chunk_index`).run("kstartup", generation);
  db.prepare(`INSERT INTO public_data_catalog_generation_pointers VALUES(?,?,?,300)
    ON CONFLICT(source_id) DO UPDATE SET generation_id=excluded.generation_id,item_count=excluded.item_count,published_at=excluded.published_at`)
    .run("kstartup", generation, count);
  db.exec("COMMIT");
}
function cleanupAbandoned(db, sourceId) {
  db.prepare(`DELETE FROM public_data_catalog_generations
    WHERE source_id = ? AND generation_id <> COALESCE((
      SELECT generation_id FROM public_data_catalog_generation_pointers WHERE source_id = ?
    ), '')`).run(sourceId, sourceId);
}

test("legacy rows survive migration and interrupted staging never becomes visible", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "bora-catalog-generation-"));
  const path = join(dir, "catalog.sqlite");
  const writer = new DatabaseSync(path); const reader = new DatabaseSync(path);
  t.after(() => { writer.close(); reader.close(); rmSync(dir, { recursive: true }); });
  writer.exec(`PRAGMA journal_mode=WAL; CREATE TABLE public_data_catalog_chunks(
    source_id TEXT,category TEXT,chunk_index INTEGER,payload TEXT,item_count INTEGER,updated_at INTEGER,
    PRIMARY KEY(source_id,category,chunk_index));`);
  writer.prepare("INSERT INTO public_data_catalog_chunks VALUES(?,?,?,?,?,?)").run("kstartup", "startup", 0, payload("old"), 1, 100);
  writer.exec(readFileSync(new URL("../drizzle/0025_public_catalog_generations.sql", import.meta.url), "utf8"));
  assert.equal(reader.prepare("SELECT json_extract(payload,'$.categories[0].items[0].id') id FROM public_data_catalog_chunks").get().id, "old");
  writer.prepare("INSERT INTO public_data_catalog_generations VALUES(?,?,?,?,?,?,?)").run("kstartup", "new", "startup", 0, payload("new-1"), 1, 200);
  assert.equal(reader.prepare("SELECT json_extract(payload,'$.categories[0].items[0].id') id FROM public_data_catalog_chunks").get().id, "old");
  writer.prepare("INSERT INTO public_data_catalog_generations VALUES(?,?,?,?,?,?,?)").run("kstartup", "new", "startup", 1, payload("new-2"), 1, 200);
  writer.exec("BEGIN IMMEDIATE; DELETE FROM public_data_catalog_chunks WHERE source_id='kstartup';");
  assert.equal(reader.prepare("SELECT COUNT(*) n FROM public_data_catalog_chunks WHERE source_id='kstartup'").get().n, 1,
    "another connection keeps the prior committed generation during publish");
  writer.exec("ROLLBACK");
  assert.equal(reader.prepare("SELECT COUNT(*) n FROM public_data_catalog_chunks WHERE source_id='kstartup'").get().n, 1);
  publish(writer, "new");
  assert.deepEqual(reader.prepare("SELECT chunk_index i FROM public_data_catalog_chunks ORDER BY i").all().map(x => x.i), [0, 1]);
  assert.equal(reader.prepare("SELECT generation_id FROM public_data_catalog_generation_pointers WHERE source_id='kstartup'").get().generation_id, "new");
});

test("retry removes abandoned partial generations without changing live chunks", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "bora-catalog-retry-"));
  const path = join(dir, "catalog.sqlite");
  const db = new DatabaseSync(path);
  t.after(() => { db.close(); rmSync(dir, { recursive: true }); });
  db.exec(`CREATE TABLE public_data_catalog_chunks(
    source_id TEXT,category TEXT,chunk_index INTEGER,payload TEXT,item_count INTEGER,updated_at INTEGER,
    PRIMARY KEY(source_id,category,chunk_index));`);
  db.exec(readFileSync(new URL("../drizzle/0025_public_catalog_generations.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO public_data_catalog_chunks VALUES(?,?,?,?,?,?)")
    .run("kstartup", "startup", 0, payload("live"), 1, 100);
  for (const generation of ["failed-a", "failed-b"]) {
    db.prepare("INSERT INTO public_data_catalog_generations VALUES(?,?,?,?,?,?,?)")
      .run("kstartup", generation, "startup", 0, payload(generation), 1, 200);
  }
  cleanupAbandoned(db, "kstartup");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM public_data_catalog_generations").get().n, 0,
    "legacy/no-pointer retry removes every abandoned staging row");
  assert.equal(db.prepare("SELECT json_extract(payload,'$.categories[0].items[0].id') id FROM public_data_catalog_chunks").get().id, "live");

  db.prepare("INSERT INTO public_data_catalog_generations VALUES(?,?,?,?,?,?,?)")
    .run("kstartup", "published", "startup", 0, payload("published"), 1, 300);
  db.prepare("INSERT INTO public_data_catalog_generation_pointers VALUES(?,?,?,?)")
    .run("kstartup", "published", 1, 300);
  db.prepare("INSERT INTO public_data_catalog_generations VALUES(?,?,?,?,?,?,?)")
    .run("kstartup", "interrupted", "startup", 0, payload("interrupted"), 1, 400);
  cleanupAbandoned(db, "kstartup");
  assert.deepEqual(db.prepare("SELECT generation_id FROM public_data_catalog_generations").all()
    .map(row => row.generation_id), ["published"]);
  assert.equal(db.prepare("SELECT json_extract(payload,'$.categories[0].items[0].id') id FROM public_data_catalog_chunks").get().id, "live");
});
