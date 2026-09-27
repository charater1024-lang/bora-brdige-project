import {
  manualFinanceAiContext,
  MANUAL_FINANCE_SNAPSHOT_VERSION,
  parseManualFinanceSnapshotInput,
  parseStoredManualFinanceSnapshot,
  type ManualFinanceSnapshot,
  type ManualFinanceSnapshotInput,
} from "./manual-finance-snapshot";

let schemaReady: Promise<void> | null = null;

async function getFinanceD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("D1 binding is unavailable.");
  return env.DB;
}

export async function ensureManualFinanceSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = await getFinanceD1();
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS user_finance_snapshots (
        user_id TEXT PRIMARY KEY NOT NULL REFERENCES oauth_users(id) ON DELETE CASCADE,
        schema_version INTEGER NOT NULL DEFAULT 1
          CHECK (schema_version = 1),
        snapshot_json TEXT NOT NULL
          CHECK (length(snapshot_json) <= 2048),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS user_finance_snapshots_updated_at_idx ON user_finance_snapshots (updated_at)",
      ),
    ]);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

type SnapshotRow = {
  schemaVersion: number;
  snapshotJson: string;
  updatedAt: number;
};

export async function getManualFinanceSnapshot(
  userId: string,
): Promise<ManualFinanceSnapshot | null> {
  await ensureManualFinanceSchema();
  const row = await (await getFinanceD1())
    .prepare(`SELECT
      schema_version AS schemaVersion,
      snapshot_json AS snapshotJson,
      updated_at AS updatedAt
    FROM user_finance_snapshots
    WHERE user_id = ?`)
    .bind(userId)
    .first<SnapshotRow>();
  if (!row || row.schemaVersion !== MANUAL_FINANCE_SNAPSHOT_VERSION) return null;
  return parseStoredManualFinanceSnapshot(row.snapshotJson, row.updatedAt);
}

export async function saveManualFinanceSnapshot(
  userId: string,
  value: ManualFinanceSnapshotInput,
): Promise<ManualFinanceSnapshot> {
  await ensureManualFinanceSchema();
  // Revalidate at the persistence boundary even when the route already did so.
  const snapshot = parseManualFinanceSnapshotInput(value);
  const now = Date.now();
  await (await getFinanceD1())
    .prepare(`INSERT INTO user_finance_snapshots
      (user_id, schema_version, snapshot_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      schema_version = excluded.schema_version,
      snapshot_json = excluded.snapshot_json,
      updated_at = excluded.updated_at`)
    .bind(
      userId,
      snapshot.version,
      JSON.stringify(snapshot),
      now,
      now,
    )
    .run();
  return { ...snapshot, updatedAt: now };
}

export async function deleteManualFinanceSnapshot(userId: string): Promise<void> {
  await ensureManualFinanceSchema();
  await (await getFinanceD1())
    .prepare("DELETE FROM user_finance_snapshots WHERE user_id = ?")
    .bind(userId)
    .run();
}

/**
 * Read AI context by an already-authenticated immutable user id. Callers must
 * not accept this id from a client payload.
 */
export async function getManualFinanceAiContext(
  userId: string,
): Promise<string | null> {
  const snapshot = await getManualFinanceSnapshot(userId);
  return snapshot ? manualFinanceAiContext(snapshot) : null;
}
