import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const FORCE_CURRENT_CYCLE_FLAG = "--force-current-cycle";
const FORCE_CURRENT_CYCLE_MODE = "force-current-cycle";
const FORCE_CURRENT_CYCLE_CONFIRMATION = "BORA_CONFIRM_PUBLIC_SOURCE_FORCE_CURRENT_CYCLE";
const commandArguments = process.argv.slice(2);
const forceFlagCount = commandArguments.filter(
  (argument) => argument === FORCE_CURRENT_CYCLE_FLAG,
).length;
const forceCurrentCycle = forceFlagCount === 1;
const [databasePath, ...sourceIds] = commandArguments.filter(
  (argument) => argument !== FORCE_CURRENT_CYCLE_FLAG,
);
const confirmed = process.env.BORA_CONFIRM_PUBLIC_SOURCE_REQUEUE === "yes";
const forceCurrentCycleConfirmed = !forceCurrentCycle
  || process.env[FORCE_CURRENT_CYCLE_CONFIRMATION] === "yes";

if (
  !confirmed
  || forceFlagCount > 1
  || !forceCurrentCycleConfirmed
  || !databasePath
  || !/\.sqlite3?$/iu.test(databasePath)
  || sourceIds.length < 1
  || sourceIds.length > 10
  || sourceIds.some((sourceId) => !/^[a-z0-9-]{2,80}$/u.test(sourceId))
) {
  console.error(
    "Usage: BORA_CONFIRM_PUBLIC_SOURCE_REQUEUE=yes node --experimental-sqlite "
    + "scripts/requeue-public-data.mjs <database.sqlite> <source-id...> "
    + `[${FORCE_CURRENT_CYCLE_FLAG}]\n`
    + `Force mode additionally requires ${FORCE_CURRENT_CYCLE_CONFIRMATION}=yes.`,
  );
  process.exitCode = 2;
} else {
  const uniqueSourceIds = [...new Set(sourceIds)];
  const database = new DatabaseSync(resolve(databasePath));
  try {
    database.exec("BEGIN IMMEDIATE");
    const read = database.prepare(`SELECT source_id AS sourceId,
      reserved_calls AS reservedCalls
      FROM public_api_source_state
      WHERE source_id = ?`);
    const update = database.prepare(`UPDATE public_api_source_state
      SET next_due_at = 0,
        backoff_until = 0,
        last_success_at = CASE WHEN ? = 1 THEN NULL ELSE last_success_at END,
        updated_at = ?
      WHERE source_id = ?
        AND reserved_calls = 0`);
    const now = Date.now();
    for (const sourceId of uniqueSourceIds) {
      const state = read.get(sourceId);
      if (!state) throw new Error(`unknown_public_source:${sourceId}`);
      if (state.reservedCalls !== 0) throw new Error(`public_source_is_reserved:${sourceId}`);
      const result = update.run(forceCurrentCycle ? 1 : 0, now, sourceId);
      if (result.changes !== 1) throw new Error(`public_source_requeue_conflict:${sourceId}`);
    }
    database.exec("COMMIT");
    console.log(JSON.stringify(forceCurrentCycle
      ? { requeued: uniqueSourceIds, mode: FORCE_CURRENT_CYCLE_MODE }
      : { requeued: uniqueSourceIds }));
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // The transaction may already be closed; preserve the original error.
    }
    throw error;
  } finally {
    database.close();
  }
}
