// Repair public catalogue copies only. Credentials, accounts and user records
// are never selected or modified. A private, verified backup is mandatory.
import { chmodSync, existsSync, lstatSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { publicApplicationPeriodLabel, repairYouthPolicyApplicationDates, repairYouthPolicySourceDates } from "../lib/public-data/dates.ts";

// One old 900-character summary lost its date footer before storage. The
// official anonymous portal search was rechecked at 2026-08-31T15:31:55.361Z:
// DOCID 20260330005400212312, APLY_PRD_BGNG_YMD="0", APLY_PRD_END_YMD="0".
// Require the exact source, old date and old summary fingerprint. No title-based
// inference, broad year cutoff, or override of a subsequently changed record.
function verifiedTruncatedZeroPeriod(item) {
  return item.id === "youth-center-j1xqed" && item.category === "youth"
    && item.sourceUrl === "https://www.youthcenter.go.kr/youthPolicy/ythPlcyTotalSearch/ythPlcyDetail/20260330005400212312"
    && item.expiresAt === "2000-01-01T00:00:00.000Z" && item.applicationStartsAt == null
    && createHash("sha256").update(item.summary).digest("hex") === "91627e8405d9dd4fa4259630493120a04ff23a962862c6a73f495edb4e5039db";
}

const TABLES = [
  { name: "public_data_catalog_chunks", keys: ["source_id", "category", "chunk_index"], shape: "categories" },
  { name: "public_youth_policy_catalog_chunks", keys: ["catalog_key", "chunk_index"], shape: "categories" },
  { name: "public_data_snapshots", keys: ["cache_key"], shape: "categories" },
  { name: "public_api_backfill_pages", keys: ["source_id", "query_signature", "page_number"], shape: "array" },
];
const MAX_PAYLOAD_BYTES = 1_900_000;
const MAX_ROWS_PER_TABLE = 5_000;
const args = process.argv.slice(2);
const apply = args[0] === "--apply";
if (!apply && args[0] !== "--check") throw new Error("Expected --check or --apply");
const databasePath = args[1];
const backupPath = args[2] === "--backup" ? args[3] : undefined;
if (!databasePath || !isAbsolute(databasePath) || !/\.sqlite3?$/u.test(databasePath)
  || (apply ? args.length !== 4 || !backupPath : args.length !== 2)) {
  throw new Error("Usage: node --experimental-strip-types scripts/repair-youth-policy-dates.mjs --check DATABASE.sqlite | --apply DATABASE.sqlite --backup NEW_PRIVATE_BACKUP.sqlite");
}
if (!lstatSync(databasePath).isFile() || lstatSync(databasePath).isSymbolicLink()
  || realpathSync(databasePath) !== resolve(databasePath)) throw new Error("unsafe_database_path");
if (apply) {
  if (!isAbsolute(backupPath) || !/\.sqlite$/u.test(backupPath) || existsSync(backupPath)
    || realpathSync(dirname(backupPath)) !== resolve(dirname(backupPath))) throw new Error("unsafe_backup_path");
  const parent = lstatSync(dirname(backupPath));
  if (!parent.isDirectory() || parent.isSymbolicLink()
    || (process.platform !== "win32" && ((parent.mode & 0o777) !== 0o700 || parent.uid !== process.getuid()))) {
    throw new Error("backup_parent_must_be_private_and_owned");
  }
}

const db = new DatabaseSync(databasePath, { readOnly: !apply });
let inTransaction = false;
try {
  db.exec("PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;");
  if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("database_check_failed");
  const hasIndex = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='public_rag_documents'").get());
  if (apply && hasIndex) {
    for (const name of ["public_rag_chunk_update", "public_rag_document_update"]) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name)) throw new Error("index_refresh_trigger_missing");
    }
  }
  if (apply) {
    await backup(db, backupPath);
    chmodSync(backupPath, 0o600);
    const copied = new DatabaseSync(backupPath, { readOnly: true });
    try {
      if (copied.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("backup_check_failed");
    } finally { copied.close(); }
    db.exec("BEGIN IMMEDIATE");
    inTransaction = true;
  } else db.exec("BEGIN");

  const uniqueChanged = new Set();
  const zeroDateFixed = new Set();
  const sourceVerifiedFixed = new Set();
  const sourceDatesFixed = new Set();
  const repairNow = Date.now();
  const tables = [];
  for (const table of TABLES) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table.name)) continue;
    const keys = db.prepare(`SELECT ${table.keys.join(",")} FROM ${table.name} WHERE instr(payload, 'youth-center-') > 0 LIMIT ?`)
      .all(MAX_ROWS_PER_TABLE + 1);
    if (keys.length > MAX_ROWS_PER_TABLE) throw new Error("public_repair_row_limit_exceeded");
    const where = table.keys.map(key => `${key}=?`).join(" AND ");
    const read = db.prepare(`SELECT payload FROM ${table.name} WHERE ${where}`);
    const update = apply ? db.prepare(`UPDATE ${table.name} SET payload=? WHERE ${where} AND payload=?`) : null;
    let rowsChanged = 0;
    let itemsChanged = 0;
    for (const key of keys) {
      const values = table.keys.map(name => key[name]);
      const raw = read.get(...values)?.payload;
      if (typeof raw !== "string" || Buffer.byteLength(raw) >= MAX_PAYLOAD_BYTES) throw new Error("public_payload_size_invalid");
      const payload = JSON.parse(raw);
      const groups = table.shape === "array" ? [payload] : payload?.categories?.map(group => group.items);
      if (!Array.isArray(groups) || !groups.every(Array.isArray)) throw new Error("public_payload_shape_invalid");
      let changed = false;
      for (const items of groups) {
        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          if (typeof item?.id !== "string" || !item.id.startsWith("youth-center-")) continue;
          if (typeof item.summary !== "string") throw new Error("public_policy_shape_invalid");
          let repaired = repairYouthPolicyApplicationDates(item);
          if (verifiedTruncatedZeroPeriod(item)) {
            const label = publicApplicationPeriodLabel(null, null);
            repaired = { ...repaired, expiresAt: null, applicationStartsAt: null,
              summary: `${item.summary.slice(0, 900 - label.length - 4).trimEnd()}… · ${label}` };
            sourceVerifiedFixed.add(item.id);
          }
          const sourceRepaired = repairYouthPolicySourceDates(repaired, repairNow);
          if (JSON.stringify(sourceRepaired) !== JSON.stringify(repaired)) sourceDatesFixed.add(item.id);
          repaired = sourceRepaired;
          if (JSON.stringify(item) === JSON.stringify(repaired)) continue;
          if (item.expiresAt && !repaired.expiresAt && /^(?:1999|2000)-/u.test(item.expiresAt)) zeroDateFixed.add(item.id);
          uniqueChanged.add(item.id);
          items[index] = repaired;
          itemsChanged += 1;
          changed = true;
        }
      }
      if (!changed) continue;
      const serialized = JSON.stringify(payload);
      if (Buffer.byteLength(serialized) >= MAX_PAYLOAD_BYTES) throw new Error("repaired_payload_too_large");
      if (apply && update.run(serialized, ...values, raw).changes !== 1) throw new Error("public_record_changed_during_repair");
      rowsChanged += 1;
    }
    tables.push({ table: table.name, rowsScanned: keys.length, rowsChanged, itemsChanged });
  }
  if (apply) {
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok") throw new Error("database_check_failed_after_repair");
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("foreign_key_check_failed");
    if (hasIndex) db.exec("INSERT INTO public_rag_fts(public_rag_fts, rank) VALUES('integrity-check', 1)");
    db.exec("COMMIT");
    inTransaction = false;
  } else db.exec("ROLLBACK");
  process.stdout.write(JSON.stringify({ mode: apply ? "applied" : "read-only-preview", uniquePoliciesChanged: uniqueChanged.size,
    zeroDatePoliciesFixed: zeroDateFixed.size, sourceVerifiedPoliciesFixed: sourceVerifiedFixed.size,
    sourceDatePoliciesFixed: sourceDatesFixed.size,
    tables, privateBackupCreated: apply }, null, 2) + "\n");
} catch (error) {
  if (inTransaction) db.exec("ROLLBACK");
  // Error identifiers never contain public payloads or private table values.
  throw new Error(error instanceof Error && /^[a-z_]+$/u.test(error.message) ? error.message : "public_date_repair_failed");
} finally { db.close(); }
