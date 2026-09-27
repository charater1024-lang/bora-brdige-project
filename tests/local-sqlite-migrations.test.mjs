import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const runner = join(root, "scripts", "apply-local-sqlite-migrations.mjs");
const migrations = [
  join(root, "drizzle", "0018_account_privacy_lifecycle.sql"),
  join(root, "drizzle", "0019_ai_context_privacy.sql"),
  join(root, "drizzle", "0020_wet_sphinx.sql"),
  join(root, "drizzle", "0021_messy_shocker.sql"),
  join(root, "drizzle", "0022_modern_bromley.sql"),
];

test("local SQLite release migrations are idempotent and preserve existing users", () => {
  const directory = mkdtempSync(join(tmpdir(), "bora-local-migrations-"));
  const databasePath = join(directory, "runtime.sqlite");
  try {
    const database = new DatabaseSync(databasePath);
    database.exec(`CREATE TABLE oauth_users (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    database.prepare(
      "INSERT INTO oauth_users (id, provider, provider_subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run("user-1", "naver", "subject-1", 1, 1);
    database.close();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = spawnSync(
        process.execPath,
        ["--experimental-sqlite", runner, databasePath, ...migrations],
        { cwd: root, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /checked 5/u);
    }

    const migrated = new DatabaseSync(databasePath);
    const tables = migrated.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all().map((row) => row.name);
    assert.ok(tables.includes("user_required_consents"));
    assert.ok(tables.includes("user_ai_context_preferences"));
    assert.ok(tables.includes("user_recent_activities"));
    assert.ok(tables.includes("ai_conversation_contexts"));
    assert.ok(tables.includes("judge_evaluation_sessions"));
    assert.ok(tables.includes("phishing_reputation_lookup_quotas"));
    assert.equal(
      migrated.prepare("SELECT COUNT(*) AS count FROM oauth_users").get().count,
      1,
    );
    assert.equal(
      migrated.prepare("SELECT COUNT(*) AS count FROM bora_local_schema_migrations").get().count,
      5,
    );
    assert.deepEqual(migrated.prepare("PRAGMA foreign_key_check").all(), []);
    const judgeForeignKeys = migrated.prepare("PRAGMA foreign_key_list('judge_evaluation_sessions')").all();
    assert.equal(judgeForeignKeys.some((row) => row.table === "oauth_users" && row.on_delete === "CASCADE"), true);
    const quotaIndexes = migrated.prepare("PRAGMA index_list('phishing_reputation_lookup_quotas')").all();
    assert.equal(
      quotaIndexes.some((row) => row.name === "phishing_reputation_lookup_quotas_updated_idx"),
      true,
    );
    migrated.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local SQLite migration runner rejects a missing migration list", () => {
  const source = readFileSync(runner, "utf8");
  assert.match(source, /migrationArguments\.length === 0/u);
  const result = spawnSync(process.execPath, ["--experimental-sqlite", runner], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/u);
});
