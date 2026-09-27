import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationPath = new URL("../drizzle/0028_public_query_indexes.sql", import.meta.url);
const migration = readFileSync(migrationPath, "utf8");
const cleanup = "DELETE FROM oauth_transactions WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)";
const catalogQuery = `SELECT source_id AS sourceId, category, chunk_index AS chunkIndex, payload, item_count AS itemCount
  FROM public_data_catalog_chunks WHERE category = ? ORDER BY chunk_index, source_id LIMIT 1000`;
const protectedTables = ["oauth_users", "user_profiles", "youth_policy_profiles", "user_finance_snapshots",
  "user_required_consents", "auth_sessions", "ai_user_memories", "user_ai_context_preferences",
  "ai_conversation_contexts", "user_recent_activities", "public_data_user_reads", "judge_evaluation_sessions",
  "service_api_credentials", "ai_provider_settings", "service_api_settings"];

function fixture(db) {
  db.exec("BEGIN");
  db.exec(`CREATE TABLE oauth_transactions(state_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, consumed_at INTEGER);
    CREATE INDEX oauth_transactions_expires_at_idx ON oauth_transactions(expires_at);
    CREATE TABLE public_data_catalog_chunks(source_id TEXT, category TEXT, chunk_index INTEGER, payload TEXT,
      item_count INTEGER, updated_at INTEGER, PRIMARY KEY(source_id, category, chunk_index));
    CREATE INDEX public_data_catalog_chunks_category_idx ON public_data_catalog_chunks(category,source_id,chunk_index);`);
  const transaction = db.prepare("INSERT INTO oauth_transactions VALUES(?,?,?)");
  for (let index = 0; index < 2000; index += 1) transaction.run(`synthetic-${index}`, index * 10, index % 3 ? null : index * 20);
  const chunk = db.prepare("INSERT INTO public_data_catalog_chunks VALUES(?,?,?,?,?,?)");
  for (const category of ["youth", "finance", "startup", "employment"]) {
    for (let source = 0; source < 8; source += 1) for (let part = 0; part < 16; part += 1) {
      chunk.run(`source-${source}`, category, part, JSON.stringify({ synthetic: source * 1000 + part }), part + 1, 123);
    }
  }
  for (const name of protectedTables) {
    db.exec(`CREATE TABLE ${name}(id TEXT PRIMARY KEY, value TEXT);`);
    db.prepare(`INSERT INTO ${name} VALUES(?,?)`).run("synthetic-user", "preserve all columns");
  }
  db.exec("COMMIT");
}

function dataFingerprints(db) {
  return Object.fromEntries(["oauth_transactions", "public_data_catalog_chunks", ...protectedTables].map((name) => {
    const rows = db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all();
    return [name, createHash("sha256").update(JSON.stringify(rows)).digest("hex")];
  }));
}

function plan(db, sql, ...parameters) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters).map((row) => row.detail);
}

test("0028 adds exactly two idempotent indexes and preserves all public and 15 protected tables", () => {
  const db = new DatabaseSync(":memory:");
  try {
    fixture(db);
    const before = dataFingerprints(db);
    const indexes = () => db.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all().map((row) => row.name);
    const original = indexes();
    const statements = migration.replace(/--[^\n]*/gu, "").split(";").map((line) => line.trim()).filter(Boolean);
    assert.equal(statements.length, 2);
    assert.ok(statements.every((sql) => /^CREATE INDEX IF NOT EXISTS /u.test(sql)));
    db.exec(migration);
    db.exec(migration);
    assert.deepEqual(dataFingerprints(db), before);
    assert.deepEqual(indexes().filter((name) => !original.includes(name)),
      ["oauth_transactions_consumed_at_idx", "public_data_catalog_chunks_page_order_idx"]);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
  } finally { db.close(); }
});

test("OAuth cleanup uses both indexed OR branches with unchanged strict expiry/null semantics", () => {
  const db = new DatabaseSync(":memory:");
  try {
    fixture(db);
    const selection = cleanup.replace("DELETE", "SELECT state_hash");
    const parameters = [5000, 7500];
    const before = db.prepare(`${selection} ORDER BY state_hash`).all(...parameters);
    assert.ok(plan(db, cleanup, ...parameters).some((value) => /SCAN oauth_transactions/u.test(value)));
    db.exec(migration);
    const after = plan(db, cleanup, ...parameters);
    assert.ok(after.some((value) => /MULTI-INDEX OR/u.test(value)));
    assert.ok(after.some((value) => /oauth_transactions_expires_at_idx/u.test(value)));
    assert.ok(after.some((value) => /oauth_transactions_consumed_at_idx/u.test(value)));
    assert.deepEqual(db.prepare(`${selection} ORDER BY state_hash`).all(...parameters), before);
    // Execute the actual cleanup only in this synthetic database, never in a copied production DB.
    assert.equal(Number(db.prepare(cleanup).run(...parameters).changes), before.length);
    assert.equal(db.prepare(selection).all(...parameters).length, 0);
  } finally { db.close(); }
});

test("category chunk reads retain exact results/order while eliminating temporary sort", () => {
  const db = new DatabaseSync(":memory:");
  try {
    fixture(db);
    const expected = new Map(["youth", "finance", "startup", "employment"].map((category) => [category, db.prepare(catalogQuery).all(category)]));
    assert.ok(plan(db, catalogQuery, "finance").some((value) => /USE TEMP B-TREE FOR ORDER BY/u.test(value)));
    db.exec(migration);
    for (const [category, rows] of expected) {
      const queryPlan = plan(db, catalogQuery, category);
      assert.ok(queryPlan.some((value) => /public_data_catalog_chunks_page_order_idx/u.test(value)));
      assert.ok(queryPlan.every((value) => !/TEMP B-TREE/u.test(value)));
      assert.deepEqual(db.prepare(catalogQuery).all(category), rows);
    }
    assert.deepEqual(db.prepare(catalogQuery).all("unknown"), []);
  } finally { db.close(); }
});

test("transactional migration failure rolls back the first index without changing data", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE oauth_transactions(state_hash TEXT PRIMARY KEY, expires_at INTEGER, consumed_at INTEGER); INSERT INTO oauth_transactions VALUES('synthetic',20,10)");
    const before = db.prepare("SELECT * FROM oauth_transactions").all();
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() => db.exec(migration), /no such table/u);
    db.exec("ROLLBACK");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='oauth_transactions_consumed_at_idx'").get().n, 0);
    assert.deepEqual(db.prepare("SELECT * FROM oauth_transactions").all(), before);
  } finally { db.close(); }
});

test("approved local migration runner records 0028 once and leaves all prior rows intact", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "bora-query-index-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "fixture.sqlite");
  const db = new DatabaseSync(path);
  fixture(db);
  const expected = dataFingerprints(db);
  db.close();
  const root = resolve(import.meta.dirname, "..");
  for (let run = 0; run < 2; run += 1) {
    const result = spawnSync(process.execPath,
      [join(root, "scripts/apply-local-sqlite-migrations.mjs"), path, resolve(root, "drizzle/0028_public_query_indexes.sql")],
      { encoding: "utf8", timeout: 20000 });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`applied ${run === 0 ? 1 : 0}, checked 1`, "u"));
  }
  const verified = new DatabaseSync(path);
  try {
    assert.deepEqual(dataFingerprints(verified), expected);
    assert.equal(verified.prepare("SELECT COUNT(*) n FROM bora_local_schema_migrations").get().n, 1);
  } finally { verified.close(); }
});
