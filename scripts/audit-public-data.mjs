import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const databasePath = process.argv[2];

if (!databasePath || !/\.sqlite3?$/iu.test(databasePath)) {
  console.error("Usage: node --experimental-sqlite scripts/audit-public-data.mjs <database.sqlite>");
  process.exitCode = 2;
} else {
  const database = new DatabaseSync(resolve(databasePath), { readOnly: true });
  const snapshot = database.prepare(`
    SELECT status,
      item_count AS itemCount,
      length(payload) AS payloadBytes,
      last_successful_at AS lastSuccessfulAt,
      next_refresh_at AS nextRefreshAt,
      last_error AS lastError
    FROM public_data_snapshots
    WHERE cache_key = ?
  `).get("home-overview-v1");
  const payloadRow = database.prepare(`
    SELECT payload
    FROM public_data_snapshots
    WHERE cache_key = ?
  `).get("home-overview-v1");
  const payload = payloadRow?.payload ? JSON.parse(payloadRow.payload) : {};
  const categories = Array.isArray(payload.categories)
    ? payload.categories.map((group) => ({
        id: group?.id ?? null,
        totalCount: group?.totalCount ?? null,
        storedItems: Array.isArray(group?.items) ? group.items.length : null,
      }))
    : [];
  const sources = Array.isArray(payload.sources)
    ? payload.sources.map((source) => ({
        id: source?.id ?? null,
        status: source?.status ?? null,
        itemCount: source?.itemCount ?? null,
        errorCode: source?.errorCode ?? null,
      }))
    : [];
  const sourceStates = database.prepare(`
    SELECT source_id AS sourceId,
      used_calls AS usedCalls,
      reserved_calls AS reservedCalls,
      daily_limit AS dailyLimit,
      last_success_at AS lastSuccessAt,
      last_attempt_at AS lastAttemptAt,
      next_due_at AS nextDueAt,
      consecutive_failures AS failures,
      last_error AS lastError
    FROM public_api_source_state
    ORDER BY source_id
  `).all();
  const catalogSummary = database.prepare(`
    SELECT source_id AS sourceId,
      count(*) AS chunkCount,
      sum(item_count) AS itemCount,
      max(length(payload)) AS largestChunkBytes,
      max(updated_at) AS updatedAt
    FROM public_data_catalog_chunks
    GROUP BY source_id
    ORDER BY source_id
  `).all();
  const credentialActivation = database.prepare(`
    SELECT s.key_name AS keyName,
      s.enabled AS requestedEnabled,
      CASE WHEN c.key_name IS NULL THEN 0 ELSE 1 END AS storedCredential,
      s.updated_at AS updatedAt
    FROM service_api_settings s
    LEFT JOIN service_api_credentials c ON c.key_name = s.key_name
    ORDER BY s.key_name
  `).all();

  console.log(JSON.stringify({
    snapshot,
    categories,
    sources,
    sourceStates,
    catalogSummary,
    credentialActivation,
  }, null, 2));
  database.close();
}
