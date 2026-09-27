import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const script = join(root, "scripts/repair-youth-policy-dates.mjs");
function fixture(t) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "bora-date-repair-")));
  chmodSync(directory, 0o700);
  const parent = dirname(directory);
  t.after(() => { assert.equal(dirname(realpathSync(directory)), parent); rmSync(directory, { recursive: true }); });
  const path = join(directory, "synthetic.sqlite");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE public_data_catalog_chunks (source_id TEXT, category TEXT, chunk_index INTEGER,
    payload TEXT, item_count INTEGER, updated_at INTEGER, PRIMARY KEY(source_id,category,chunk_index));
    CREATE TABLE public_data_snapshots (cache_key TEXT PRIMARY KEY, payload TEXT);
    CREATE TABLE public_youth_policy_catalog_chunks (catalog_key TEXT, chunk_index INTEGER, payload TEXT,
      PRIMARY KEY(catalog_key,chunk_index));
    CREATE TABLE public_api_backfill_pages (source_id TEXT, query_signature TEXT, page_number INTEGER, payload TEXT,
      PRIMARY KEY(source_id,query_signature,page_number));
    CREATE TABLE private_test_users (id TEXT, value TEXT);
    INSERT INTO private_test_users VALUES('synthetic-user', 'keep-user-data-unchanged');`);
  const zero = { id: "youth-center-zero", category: "youth", title: "합성 지원정책", source: "합성 기관",
    sourceUrl: "https://www.youthcenter.go.kr/", tags: ["전국"], summary: "합성 안내 · 신청기간 0 ~ 0 · 조건 원문 확인",
    expiresAt: "2000-01-01T00:00:00.000Z", discoveredAt: "2026-08-31T00:00:00Z", lastVerifiedAt: "2026-08-31T00:00:00Z" };
  const historical = { ...zero, id: "youth-center-real-old", summary: "실제 과거 공고", expiresAt: "2000-01-01" };
  const unrelated = { ...zero, id: "other-provider-zero" };
  zero.publishedAt = "2198-01-01T00:00:00.000Z";
  const items = [zero, historical, unrelated];
  const payload = JSON.stringify({ categories: [{ id: "youth", items }], sources: [], __untouched: { value: 17 } });
  db.prepare("INSERT INTO public_data_catalog_chunks VALUES(?,?,?,?,?,?)").run("youth-center", "youth", 0, payload, 3, 123);
  db.prepare("INSERT INTO public_data_snapshots VALUES(?,?)").run("home-overview-v1", payload);
  db.prepare("INSERT INTO public_youth_policy_catalog_chunks VALUES(?,?,?)").run("current", 0, payload);
  db.prepare("INSERT INTO public_api_backfill_pages VALUES(?,?,?,?)").run("youth-center", "synthetic", 1, JSON.stringify(items));
  db.exec(readFileSync(join(root, "drizzle/0023_public_rag_index.sql"), "utf8"));
  db.close();
  return { directory, path, payload };
}
function run(path, backupPath) {
  return spawnSync(process.execPath, ["--experimental-strip-types", script,
    ...(backupPath ? ["--apply", path, "--backup", backupPath] : ["--check", path])], { cwd: root, encoding: "utf8" });
}

test("date repair preview performs no writes and reports distinct affected public policies", (t) => {
  const f = fixture(t);
  const before = readFileSync(f.path);
  const result = run(f.path);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, "read-only-preview");
  assert.equal(report.zeroDatePoliciesFixed, 1);
  assert.equal(report.tables.length, 4);
  assert.deepEqual(readFileSync(f.path), before);
});

test("repair synchronizes all public copies and FTS without modifying real old dates or user data", (t) => {
  const f = fixture(t);
  const backupPath = join(f.directory, "before.sqlite");
  const result = run(f.path, backupPath);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).zeroDatePoliciesFixed, 1);
  assert.ok(existsSync(backupPath));
  const db = new DatabaseSync(f.path, { readOnly: true });
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const chunk = db.prepare("SELECT payload, updated_at FROM public_data_catalog_chunks").get();
    const parsed = JSON.parse(chunk.payload);
    const [repaired, historical, unrelated] = parsed.categories[0].items;
    assert.equal(repaired.expiresAt, null);
    assert.equal(repaired.publishedAt, null);
    assert.equal(repaired.sourceDateMetadata.rawPublishedAt, "2198-01-01T00:00:00.000Z");
    assert.equal(repaired.sourceDateMetadata.publishedAtStatus, "future");
    assert.match(repaired.summary, /신청기간 미확인/u);
    assert.equal(historical.expiresAt, "2000-01-01");
    assert.equal(unrelated.expiresAt, "2000-01-01T00:00:00.000Z");
    assert.deepEqual(parsed.__untouched, { value: 17 });
    assert.equal(chunk.updated_at, 123, "do not invent a newer verification time");
    assert.equal(db.prepare("SELECT expires_at FROM public_rag_documents WHERE doc_id=?").get("youth-center-zero").expires_at, null);
    for (const table of ["public_data_snapshots", "public_youth_policy_catalog_chunks"]) {
      assert.equal(JSON.parse(db.prepare(`SELECT payload FROM ${table}`).get().payload).categories[0].items[0].expiresAt, null);
    }
    assert.equal(JSON.parse(db.prepare("SELECT payload FROM public_api_backfill_pages").get().payload)[0].expiresAt, null);
    assert.equal(db.prepare("SELECT value FROM private_test_users").get().value, "keep-user-data-unchanged");
    assert.equal(backup.prepare("SELECT payload FROM public_data_catalog_chunks").get().payload, f.payload);
  } finally { db.close(); backup.close(); }
  const again = run(f.path);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(JSON.parse(again.stdout).uniquePoliciesChanged, 0);
});

test("repair refuses overwriting an existing backup and rolls back if a public payload is malformed", (t) => {
  const f = fixture(t);
  assert.notEqual(run(f.path, f.path).status, 0);
  const db = new DatabaseSync(f.path);
  db.prepare("UPDATE public_data_snapshots SET payload=?").run('{"youth-center-":"invalid"}');
  db.close();
  const result = run(f.path, join(f.directory, "failed-before.sqlite"));
  assert.notEqual(result.status, 0);
  const check = new DatabaseSync(f.path, { readOnly: true });
  try {
    assert.equal(check.prepare("SELECT payload FROM public_data_catalog_chunks").get().payload, f.payload);
    assert.equal(check.prepare("SELECT expires_at FROM public_rag_documents WHERE doc_id=?").get("youth-center-zero").expires_at, "2000-01-01T00:00:00.000Z");
  } finally { check.close(); }
});
