import {
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, extname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const [databaseArgument, ...migrationArguments] = process.argv.slice(2);
if (!databaseArgument || migrationArguments.length === 0) {
  fail(
    "Usage: node --experimental-sqlite scripts/apply-local-sqlite-migrations.mjs "
      + "<database.sqlite> <migration.sql...>",
  );
} else {
  const databasePath = resolve(databaseArgument);
  let database;

  try {
    const databaseStat = lstatSync(databasePath);
    if (!databaseStat.isFile() || databaseStat.isSymbolicLink()) {
      throw new Error("database_path_must_be_a_regular_file");
    }
    if (!/\.sqlite3?$/iu.test(extname(databasePath))) {
      throw new Error("database_path_must_end_in_sqlite_or_sqlite3");
    }

    const migrations = migrationArguments.map((argument) => {
      const migrationCandidate = resolve(argument);
      const migrationStat = lstatSync(migrationCandidate);
      const migrationPath = realpathSync(migrationCandidate);
      const migrationName = basename(migrationPath);
      if (
        !migrationStat.isFile()
        || migrationStat.isSymbolicLink()
        || !/^\d{4}_[a-z0-9_]+\.sql$/u.test(migrationName)
      ) {
        throw new Error(`invalid_migration_file:${migrationName}`);
      }
      return {
        name: migrationName,
        sql: readFileSync(migrationPath, "utf8").replace(
          /^\s*-->\s*statement-breakpoint\s*$/gmu,
          "",
        ),
      };
    });

    database = new DatabaseSync(realpathSync(databasePath));
    database.exec("PRAGMA foreign_keys = ON");
    const before = database.prepare("PRAGMA quick_check").get();
    if (before?.quick_check !== "ok") {
      throw new Error("database_quick_check_failed_before_migration");
    }

    database.exec(`CREATE TABLE IF NOT EXISTS bora_local_schema_migrations (
      migration_name TEXT PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    )`);
    const applied = database.prepare(
      "SELECT 1 FROM bora_local_schema_migrations WHERE migration_name = ? LIMIT 1",
    );
    const record = database.prepare(
      "INSERT INTO bora_local_schema_migrations (migration_name, applied_at) VALUES (?, ?)",
    );

    let appliedCount = 0;
    for (const migration of migrations) {
      if (applied.get(migration.name)) continue;
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(migration.sql);
        record.run(migration.name, Date.now());
        database.exec("COMMIT");
        appliedCount += 1;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }

    const after = database.prepare("PRAGMA quick_check").get();
    if (after?.quick_check !== "ok") {
      throw new Error("database_quick_check_failed_after_migration");
    }
    const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) {
      throw new Error("database_foreign_key_check_failed_after_migration");
    }

    process.stdout.write(
      `Local SQLite migrations verified; applied ${appliedCount}, checked ${migrations.length}.\n`,
    );
  } catch (error) {
    fail(error instanceof Error ? error.message : "local_migration_failed");
  } finally {
    database?.close();
  }
}
