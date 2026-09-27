import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = new URL("../scripts/requeue-public-data.mjs", import.meta.url);
const scriptPath = fileURLToPath(script);
const requeueConfirmation = "BORA_CONFIRM_PUBLIC_SOURCE_REQUEUE";
const forceConfirmation = "BORA_CONFIRM_PUBLIC_SOURCE_FORCE_CURRENT_CYCLE";

function commandEnvironment({ confirmed = false, forceConfirmed = false } = {}) {
  return {
    ...process.env,
    [requeueConfirmation]: confirmed ? "yes" : "",
    [forceConfirmation]: forceConfirmed ? "yes" : "",
  };
}

function createDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "bora-requeue-"));
  const databasePath = join(directory, "public.sqlite");
  execFileSync(process.execPath, [
    "--experimental-sqlite",
    "--input-type=module",
    "-e",
    `import { DatabaseSync } from "node:sqlite";
     const db = new DatabaseSync(${JSON.stringify(databasePath)});
     db.exec(\`CREATE TABLE public_api_source_state (
       source_id TEXT PRIMARY KEY,
       quota_day TEXT NOT NULL,
       used_calls INTEGER NOT NULL,
       reserved_calls INTEGER NOT NULL,
       daily_limit INTEGER NOT NULL,
       quota_verified INTEGER NOT NULL,
       next_due_at INTEGER NOT NULL,
       last_success_at INTEGER,
       last_attempt_at INTEGER NOT NULL,
       backoff_until INTEGER NOT NULL,
       consecutive_failures INTEGER NOT NULL,
       last_error TEXT,
       updated_at INTEGER NOT NULL
     );
     INSERT INTO public_api_source_state VALUES
       ('dart', '20260901', 77, 0, 1000, 1, 999, 777, 666, 888, 2, 'historical-error', 1),
       ('peer', '20260901', 12, 0, 500, 1, 444, 333, 222, 111, 3, 'peer-error', 10),
       ('busy', '20260901', 20, 1, 250, 1, 999, 777, 666, 888, 4, 'busy-error', 20)\`);
     db.close();`,
  ]);
  return databasePath;
}

function readStates(databasePath) {
  const output = execFileSync(process.execPath, [
    "--experimental-sqlite",
    "--input-type=module",
    "-e",
    `import { DatabaseSync } from "node:sqlite";
     const db = new DatabaseSync(${JSON.stringify(databasePath)}, { readOnly: true });
     const rows = db.prepare(\`SELECT source_id AS sourceId,
       quota_day AS quotaDay, used_calls AS usedCalls,
       reserved_calls AS reservedCalls, daily_limit AS dailyLimit,
       quota_verified AS quotaVerified, next_due_at AS nextDueAt,
       last_success_at AS lastSuccessAt, last_attempt_at AS lastAttemptAt,
       backoff_until AS backoffUntil, consecutive_failures AS consecutiveFailures,
       last_error AS lastError, updated_at AS updatedAt
       FROM public_api_source_state ORDER BY source_id\`).all();
     console.log(JSON.stringify(rows));
     db.close();`,
  ], { encoding: "utf8" });
  return JSON.parse(output);
}

function source(states, sourceId) {
  return states.find((state) => state.sourceId === sourceId);
}

test("public source requeue remains explicit and refuses active reservations", () => {
  const databasePath = createDatabase();
  const before = readStates(databasePath);

  const withoutConfirmation = spawnSync(process.execPath, [
    "--experimental-sqlite",
    scriptPath,
    databasePath,
    "dart",
  ], { env: commandEnvironment() });
  assert.equal(withoutConfirmation.status, 2);
  assert.deepEqual(readStates(databasePath), before);

  const busy = spawnSync(process.execPath, [
    "--experimental-sqlite",
    scriptPath,
    databasePath,
    "dart",
    "busy",
  ], {
    env: commandEnvironment({ confirmed: true }),
  });
  assert.notEqual(busy.status, 0);
  assert.deepEqual(readStates(databasePath), before, "the transaction must roll back every selected source");
});

test("force-current-cycle refuses to run without its second confirmation", () => {
  const databasePath = createDatabase();
  const before = readStates(databasePath);
  const refused = spawnSync(process.execPath, [
    "--experimental-sqlite",
    scriptPath,
    databasePath,
    "dart",
    "--force-current-cycle",
  ], {
    env: commandEnvironment({ confirmed: true }),
    encoding: "utf8",
  });

  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /BORA_CONFIRM_PUBLIC_SOURCE_FORCE_CURRENT_CYCLE=yes/u);
  assert.deepEqual(readStates(databasePath), before);
});

test("force-current-cycle refuses duplicate force flags before opening the database", () => {
  const databasePath = createDatabase();
  const before = readStates(databasePath);
  const refused = spawnSync(process.execPath, [
    "--experimental-sqlite",
    scriptPath,
    databasePath,
    "dart",
    "--force-current-cycle",
    "--force-current-cycle",
  ], {
    env: commandEnvironment({ confirmed: true, forceConfirmed: true }),
    encoding: "utf8",
  });

  assert.equal(refused.status, 2);
  assert.deepEqual(readStates(databasePath), before);
});

test("force-current-cycle rolls back when a selected source is unknown", () => {
  const databasePath = createDatabase();
  const before = readStates(databasePath);
  const refused = spawnSync(process.execPath, [
    "--experimental-sqlite",
    scriptPath,
    databasePath,
    "dart",
    "unknown-source",
    "--force-current-cycle",
  ], {
    env: commandEnvironment({ confirmed: true, forceConfirmed: true }),
    encoding: "utf8",
  });

  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /unknown_public_source:unknown-source/u);
  assert.deepEqual(readStates(databasePath), before);
});

test("force-current-cycle rolls back every source when one is reserved", () => {
  const databasePath = createDatabase();
  const before = readStates(databasePath);
  const refused = spawnSync(process.execPath, [
    "--experimental-sqlite",
    scriptPath,
    databasePath,
    "dart",
    "busy",
    "--force-current-cycle",
  ], {
    env: commandEnvironment({ confirmed: true, forceConfirmed: true }),
    encoding: "utf8",
  });

  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /public_source_is_reserved:busy/u);
  assert.deepEqual(readStates(databasePath), before);
});

test("default requeue output and current-cycle marker remain unchanged", () => {
  const databasePath = createDatabase();
  const before = readStates(databasePath);
  const completed = spawnSync(process.execPath, [
    "--experimental-sqlite",
    scriptPath,
    databasePath,
    "dart",
  ], {
    env: commandEnvironment({ confirmed: true, forceConfirmed: true }),
    encoding: "utf8",
  });

  assert.equal(completed.status, 0, completed.stderr);
  assert.deepEqual(JSON.parse(completed.stdout), { requeued: ["dart"] });
  const after = readStates(databasePath);
  const dart = source(after, "dart");
  const { updatedAt, ...stableDart } = dart;
  assert.ok(updatedAt > source(before, "dart").updatedAt);
  assert.deepEqual(stableDart, {
    sourceId: "dart",
    quotaDay: "20260901",
    usedCalls: 77,
    reservedCalls: 0,
    dailyLimit: 1000,
    quotaVerified: 1,
    nextDueAt: 0,
    lastSuccessAt: 777,
    lastAttemptAt: 666,
    backoffUntil: 0,
    consecutiveFailures: 2,
    lastError: "historical-error",
  });
  assert.deepEqual(source(after, "peer"), source(before, "peer"));
  assert.deepEqual(source(after, "busy"), source(before, "busy"));
});

test("force-current-cycle clears eligibility only for selected unreserved sources", () => {
  const databasePath = createDatabase();
  const before = readStates(databasePath);
  const completed = spawnSync(process.execPath, [
    "--experimental-sqlite",
    scriptPath,
    databasePath,
    "dart",
    "--force-current-cycle",
  ], {
    env: commandEnvironment({ confirmed: true, forceConfirmed: true }),
    encoding: "utf8",
  });

  assert.equal(completed.status, 0, completed.stderr);
  assert.deepEqual(JSON.parse(completed.stdout), {
    requeued: ["dart"],
    mode: "force-current-cycle",
  });
  const after = readStates(databasePath);
  const dart = source(after, "dart");
  const { updatedAt, ...stableDart } = dart;
  assert.ok(updatedAt > source(before, "dart").updatedAt);
  assert.deepEqual(stableDart, {
    sourceId: "dart",
    quotaDay: "20260901",
    usedCalls: 77,
    reservedCalls: 0,
    dailyLimit: 1000,
    quotaVerified: 1,
    nextDueAt: 0,
    lastSuccessAt: null,
    lastAttemptAt: 666,
    backoffUntil: 0,
    consecutiveFailures: 2,
    lastError: "historical-error",
  });
  assert.deepEqual(source(after, "peer"), source(before, "peer"));
  assert.deepEqual(source(after, "busy"), source(before, "busy"));
});
