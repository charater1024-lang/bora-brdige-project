// Public-only rehearsal: never attach, back up, migrate or write the source DB.
import { chmodSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const TABLES = [
  { name: "public_data_catalog_chunks", columns: "source_id TEXT,category TEXT,chunk_index INTEGER,payload TEXT,item_count INTEGER,updated_at INTEGER", keys: ["source_id", "category", "chunk_index"] },
  { name: "public_youth_policy_catalog_chunks", columns: "catalog_key TEXT,chunk_index INTEGER,payload TEXT", keys: ["catalog_key", "chunk_index"] },
  { name: "public_data_snapshots", columns: "cache_key TEXT,payload TEXT", keys: ["cache_key"] },
  { name: "public_api_backfill_pages", columns: "source_id TEXT,query_signature TEXT,page_number INTEGER,payload TEXT", keys: ["source_id", "query_signature", "page_number"], array: true },
];
const requireCheck = (condition, code) => { if (!condition) throw new Error(code); };
function memberships(db) {
  const identities = [];
  let zeroYouthCount = 0, items = 0;
  for (const table of TABLES) {
    for (const row of db.prepare(`SELECT ${table.keys.join(",")},payload FROM ${table.name}`).iterate()) {
      const payload = JSON.parse(row.payload);
      const groups = table.array ? [payload] : payload?.categories?.map(group => group.items);
      requireCheck(Array.isArray(groups) && groups.every(Array.isArray), "invalid_public_payload_shape");
      for (const group of groups) for (const item of group) {
        requireCheck(typeof item?.id === "string", "invalid_public_item_id");
        identities.push(JSON.stringify([table.name, ...table.keys.map(key => row[key]), item.id]));
        items++;
        if (item.id.startsWith("youth-center-") && /신청기간\s*0\s*~\s*0/u.test(item.summary ?? "")) zeroYouthCount++;
      }
    }
  }
  return { digest: createHash("sha256").update(identities.sort().join("\n")).digest("hex"), items, zeroYouthCount };
}
function repair(scratch, backup, apply) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types",
    fileURLToPath(new URL("./repair-youth-policy-dates.mjs", import.meta.url)),
    apply ? "--apply" : "--check", scratch, ...(apply ? ["--backup", backup] : [])],
  { encoding: "utf8", timeout: 180_000, maxBuffer: 1_000_000, windowsHide: true });
  requireCheck(!result.error && result.status === 0, "scratch_repair_failed");
  return JSON.parse(result.stdout);
}

export function checkCatalogMigration(sourcePath) {
  const started = performance.now();
  requireCheck(typeof sourcePath === "string" && isAbsolute(sourcePath) && /\.sqlite3?$/u.test(sourcePath), "absolute_sqlite_path_required");
  const sourceStat = lstatSync(sourcePath);
  requireCheck(sourceStat.isFile() && !sourceStat.isSymbolicLink() && realpathSync(sourcePath) === resolve(sourcePath), "unsafe_source_path");
  const scratchParent = realpathSync(tmpdir());
  const directory = realpathSync(mkdtempSync(join(scratchParent, "bora-public-rehearsal-")));
  chmodSync(directory, 0o700);
  let source, scratch;
  try {
    const privateStat = lstatSync(directory);
    requireCheck(!privateStat.isSymbolicLink() && privateStat.isDirectory()
      && (process.platform === "win32" || ((privateStat.mode & 0o777) === 0o700 && privateStat.uid === process.getuid())), "scratch_not_private");
    const scratchPath = join(directory, "scratch.sqlite");
    requireCheck(resolve(sourcePath) !== scratchPath, "source_scratch_collision");
    source = new DatabaseSync(sourcePath, { readOnly: true });
    // No source PRAGMA, schema enumeration or unrelated table queries.
    source.exec("BEGIN");
    scratch = new DatabaseSync(scratchPath);
    chmodSync(scratchPath, 0o600);
    const scratchStat = lstatSync(scratchPath);
    requireCheck(realpathSync(scratchPath) === scratchPath && !scratchStat.isSymbolicLink()
      && !(sourceStat.dev === scratchStat.dev && sourceStat.ino === scratchStat.ino), "source_scratch_collision");
    scratch.exec("BEGIN");
    const tables = [];
    for (const table of TABLES) {
      scratch.exec(`CREATE TABLE ${table.name} (${table.columns}, PRIMARY KEY (${table.keys.join(",")}))`);
      const columns = table.columns.split(",").map(column => column.split(" ")[0]);
      const insert = scratch.prepare(`INSERT INTO ${table.name} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`);
      let rows = 0;
      for (const row of source.prepare(`SELECT ${columns.join(",")} FROM ${table.name}`).iterate()) {
        requireCheck(++rows <= 100_000 && typeof row.payload === "string" && Buffer.byteLength(row.payload) < 1_900_000, "public_copy_limit_exceeded");
        insert.run(...columns.map(column => row[column]));
      }
      tables.push({ rows });
    }
    scratch.exec("COMMIT");
    source.exec("ROLLBACK"); source.close(); source = null;
    const copiedMs = performance.now() - started;
    const before = memberships(scratch);
    for (const migration of [
      "0023_public_rag_index.sql",
      "0024_public_rag_refresh.sql",
      "0025_public_catalog_generations.sql",
      "0026_financial_company_snapshot_guard.sql",
    ]) {
      scratch.exec("BEGIN IMMEDIATE");
      scratch.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
      scratch.exec("COMMIT");
    }
    const migrationsMs = performance.now() - started - copiedMs;
    scratch.close(); scratch = null;
    const applied = repair(scratchPath, join(directory, "before.sqlite"), true);
    const checked = repair(scratchPath, null, false);
    requireCheck(checked.uniquePoliciesChanged === 0 && checked.tables.every(table => table.rowsChanged === 0), "repair_not_idempotent");
    scratch = new DatabaseSync(scratchPath);
    const after = memberships(scratch);
    requireCheck(before.digest === after.digest && before.items === after.items, "public_membership_changed");
    requireCheck(after.zeroYouthCount === 0, "zero_youth_period_remaining");
    scratch.exec("INSERT INTO public_rag_fts(public_rag_fts,rank) VALUES('integrity-check',1)");
    requireCheck(scratch.prepare("PRAGMA quick_check").get().quick_check === "ok", "scratch_integrity_failed");
    for (const [left, right] of [["public_rag_documents", "public_rag_catalog_projection"], ["public_rag_catalog_projection", "public_rag_documents"]]) {
      requireCheck(!scratch.prepare(`SELECT source_id,category,doc_id FROM ${left} EXCEPT SELECT source_id,category,doc_id FROM ${right} LIMIT 1`).get(), "rag_membership_mismatch");
    }
    for (const [left, right] of [["public_rag_chunk_members", "public_rag_catalog_projection"], ["public_rag_catalog_projection", "public_rag_chunk_members"]]) {
      requireCheck(!scratch.prepare(`SELECT source_id,category,chunk_index,doc_id FROM ${left} EXCEPT SELECT source_id,category,chunk_index,doc_id FROM ${right} LIMIT 1`).get(), "rag_chunk_membership_mismatch");
    }
    const ragDocuments = scratch.prepare("SELECT count(*) AS count FROM public_rag_documents").get().count;
    const year2000CanonicalRemaining = scratch.prepare("SELECT count(*) AS count FROM public_rag_documents WHERE doc_id LIKE 'youth-center-%' AND expires_at LIKE '2000-%'").get().count;
    return { tables, publicItemCopies: after.items, ragDocuments, zeroYouthBefore: before.zeroYouthCount,
      zeroYouthAfter: after.zeroYouthCount, repairedPolicies: applied.uniquePoliciesChanged,
      zeroDatePoliciesFixed: applied.zeroDatePoliciesFixed, sourceVerifiedPoliciesFixed: applied.sourceVerifiedPoliciesFixed,
      year2000CanonicalRemaining,
      remainingRepairs: checked.uniquePoliciesChanged,
      timingsMs: { copy: Math.round(copiedMs), migrations: Math.round(migrationsMs), total: Math.round(performance.now() - started) } };
  } finally {
    try { source?.close(); } finally {
      try { scratch?.close(); } finally {
        requireCheck(realpathSync(directory) === directory && dirname(directory) === scratchParent
          && basename(directory).startsWith("bora-public-rehearsal-") && !lstatSync(directory).isSymbolicLink(), "unsafe_scratch_cleanup");
        rmSync(directory, { recursive: true });
      }
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireCheck(process.argv.length === 3, "expected_one_database_path");
    process.stdout.write(JSON.stringify(checkCatalogMigration(process.argv[2])) + "\n");
  } catch {
    // Never expose SQL, filesystem paths, payloads or child stderr.
    process.stderr.write("Public catalogue migration rehearsal failed.\n");
    process.exitCode = 1;
  }
}
