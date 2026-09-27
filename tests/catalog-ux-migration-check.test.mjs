import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { checkCatalogMigration } from "../scripts/check-catalog-ux-migration.mjs";

const productionVerifier = fileURLToPath(
  new URL("../scripts/verify-catalog-ux-release.mjs", import.meta.url),
);

test("production SSR verification disables Vite filesystem watching", () => {
  const source = readFileSync(new URL("../scripts/verify-catalog-ux-release.mjs", import.meta.url), "utf8");
  assert.match(source, /server:\s*\{\s*middlewareMode:\s*true,\s*watch:\s*null\s*\}/u);
  assert.match(source, /configFile:\s*false/u);
  assert.match(source, /await vite\.close\(\)/u);
});

test("public-only rehearsal repairs scratch and leaves complete synthetic source bytes unchanged", (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "bora-rehearsal-test-")));
  const parent = dirname(directory);
  t.after(() => {
    assert.equal(dirname(realpathSync(directory)), parent);
    assert.ok(basename(directory).startsWith("bora-rehearsal-test-"));
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, "source.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE public_data_catalog_chunks(source_id TEXT,category TEXT,chunk_index INTEGER,payload TEXT,item_count INTEGER,updated_at INTEGER);
    CREATE TABLE public_youth_policy_catalog_chunks(catalog_key TEXT,chunk_index INTEGER,payload TEXT);
    CREATE TABLE public_data_snapshots(cache_key TEXT,payload TEXT);
    CREATE TABLE public_api_backfill_pages(source_id TEXT,query_signature TEXT,page_number INTEGER,payload TEXT);
    CREATE TABLE unrelated_private_fixture(value TEXT);
    INSERT INTO unrelated_private_fixture VALUES('synthetic only, must never be copied');`);
  const item = { id: "youth-center-synthetic", title: "합성 정책", category: "youth", summary: "신청기간 0 ~ 0", expiresAt: "2000-01-01T00:00:00.000Z", tags: [] };
  const payload = JSON.stringify({ categories: [{ id: "youth", items: [item] }] });
  db.prepare("INSERT INTO public_data_catalog_chunks VALUES(?,?,?,?,?,?)").run("youth-center", "youth", 0, payload, 1, 42);
  db.prepare("INSERT INTO public_youth_policy_catalog_chunks VALUES(?,?,?)").run("test", 0, payload);
  db.prepare("INSERT INTO public_data_snapshots VALUES(?,?)").run("test", payload);
  db.prepare("INSERT INTO public_api_backfill_pages VALUES(?,?,?,?)").run("test", "test", 1, JSON.stringify([item]));
  db.close();
  const before = readFileSync(path);
  const report = checkCatalogMigration(path);
  assert.equal(report.publicItemCopies, 4);
  assert.equal(report.ragDocuments, 1);
  assert.equal(report.zeroYouthBefore, 4);
  assert.equal(report.zeroYouthAfter, 0);
  assert.equal(report.repairedPolicies, 1);
  assert.equal(report.remainingRepairs, 0);
  assert.deepEqual(readFileSync(path), before);
  assert.doesNotMatch(JSON.stringify(report), /synthetic|sqlite|youth-center/u);
});

test("post-deploy verifier requires 0026 and rejects stale financial-company index rows", (t) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "bora-post-deploy-verify-test-")));
  const parent = dirname(directory);
  t.after(() => {
    assert.equal(dirname(realpathSync(directory)), parent);
    assert.ok(basename(directory).startsWith("bora-post-deploy-verify-test-"));
    rmSync(directory, { recursive: true });
  });
  const path = join(directory, "source.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE public_data_catalog_chunks(
      source_id TEXT, category TEXT, chunk_index INTEGER, payload TEXT,
      item_count INTEGER, updated_at INTEGER,
      PRIMARY KEY(source_id,category,chunk_index));
    CREATE TABLE public_api_source_state(
      source_id TEXT PRIMARY KEY, last_error TEXT,
      reserved_calls INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE service_api_settings(key_name TEXT PRIMARY KEY, enabled INTEGER NOT NULL);
    CREATE TABLE bora_local_schema_migrations(
      migration_name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);`);
  for (const migration of [
    "0023_public_rag_index.sql",
    "0024_public_rag_refresh.sql",
    "0026_financial_company_snapshot_guard.sql",
  ]) {
    db.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
    db.prepare("INSERT INTO bora_local_schema_migrations VALUES(?,?)").run(migration, 1);
  }
  db.close();

  const verify = () => spawnSync(process.execPath, [productionVerifier, path], {
    encoding: "utf8",
    timeout: 30_000,
  });
  const valid = verify();
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(JSON.parse(valid.stdout).staleFinancialCompanyDocuments, 0);

  const missing = new DatabaseSync(path);
  missing.prepare("DELETE FROM bora_local_schema_migrations WHERE migration_name=?")
    .run("0026_financial_company_snapshot_guard.sql");
  missing.close();
  assert.notEqual(verify().status, 0, "missing guard migration must fail deployment verification");

  const stale = new DatabaseSync(path);
  stale.prepare("INSERT INTO bora_local_schema_migrations VALUES(?,?)")
    .run("0026_financial_company_snapshot_guard.sql", 2);
  stale.prepare(`INSERT INTO public_rag_documents(
      source_id,category,chunk_index,doc_id,title,body,tags,payload,
      published_at,verified_at,expires_at,indexed_at)
    VALUES('financial-company','finance',0,'company-stale','과거 금융회사',
      '과거 자료','[]','{}','2020-04-08','2026-09-01',NULL,1)`).run();
  stale.close();
  assert.notEqual(verify().status, 0, "stale financial-company FTS row must fail deployment verification");
});
