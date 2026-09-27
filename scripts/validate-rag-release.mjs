import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const forbidden = /^(?:\.env.*|\.git|\.wrangler|\.deploy.*|node_modules)$/u;
function assert(ok, message) { if (!ok) throw new Error(message); }
/** Permission predicates are separate so their POSIX policy can be tested on Windows. */
export function isPrivateOwnerPermission({ mode, uid }, currentUid) {
  return Number.isSafeInteger(currentUid) && currentUid >= 0 && uid === currentUid
    && (mode & 0o7777) === 0o700;
}
export function isSafeReleaseEntryPermission({ mode, uid, nlink, regularFile }, protectedUid = null) {
  if ((mode & 0o022) === 0) return true;
  // A private ancestor blocks traversal by other users. Only its owner's
  // group-writable entries qualify; never extend this to world-write or an
  // inode that may also be reachable via a hard link outside that ancestor.
  return Number.isSafeInteger(protectedUid) && protectedUid >= 0 && uid === protectedUid
    && (mode & 0o002) === 0 && (!regularFile || nlink === 1);
}
function protectedProjectUid(root) {
  const stat = lstatSync(root);
  const uid = process.getuid?.();
  return isAbsolute(root) && realpathSync(root) === root && stat.isDirectory()
    && !stat.isSymbolicLink() && isPrivateOwnerPermission(stat, uid)
    && (process.geteuid?.() ?? uid) === uid ? uid : null;
}
function entryPermission(stat, protectedUid = null) {
  return process.platform === "win32" || isSafeReleaseEntryPermission({
    mode: stat.mode, uid: stat.uid, nlink: stat.nlink, regularFile: stat.isFile(),
  }, protectedUid);
}

const sha256 = value => createHash("sha256").update(value).digest("hex");

/** Produce a deterministic, path-aware inventory of the production bundle. */
export function createDistInventory(root) {
  const files = [];
  const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
      const target = join(directory, entry.name);
      const stat = lstatSync(target);
      assert(!stat.isSymbolicLink(), "symbolic_dist_entry");
      if (entry.isDirectory()) visit(target);
      else {
        assert(entry.isFile(), "special_dist_entry");
        const path = relative(root, target).split(sep).join("/");
        assert(path && !path.includes("\0") && !path.includes("\n"), "invalid_dist_path");
        files.push({ path, sha256: sha256(readFileSync(target)) });
      }
    }
  }
  visit(root);
  files.sort((a, b) => compare(a.path, b.path));
  const aggregateSha256 = sha256(files.map(file => `${file.path}\0${file.sha256}\n`).join(""));
  return { algorithm: "sha256", files, aggregateSha256 };
}

export function validateManifestDist({ distRoot, manifestPath, protectedProjectRoot }) {
  validateDist(distRoot, protectedProjectRoot === undefined ? {} : { protectedProjectRoot });
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const declared = manifest.dist;
  assert(declared && declared.algorithm === "sha256" && Array.isArray(declared.files), "missing_dist_inventory");
  assert(declared.files.length > 0 && declared.files.length <= 5000, "invalid_dist_inventory");
  const actual = createDistInventory(distRoot);
  assert(declared.aggregateSha256 === actual.aggregateSha256, "dist_aggregate_mismatch");
  assert(declared.files.length === actual.files.length, "dist_file_count_mismatch");
  for (let index = 0; index < actual.files.length; index += 1) {
    const expected = declared.files[index];
    const found = actual.files[index];
    assert(expected && expected.path === found.path && expected.sha256 === found.sha256, "dist_file_hash_mismatch");
  }
  return actual;
}
function safePath(root, target, allowMissing = false, protectedUid = null) {
  const rel = relative(root, target);
  assert(rel && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel), "path_outside_root");
  let current = root;
  for (const part of rel.split(sep)) {
    assert(!forbidden.test(part), "private_path_forbidden");
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      assert(!stat.isSymbolicLink(), "symbolic_path_forbidden");
      assert(stat.isDirectory() || stat.isFile(), "special_file_forbidden");
      assert(entryPermission(stat, protectedUid), "writable_by_other_users");
    } catch (error) {
      if (!(allowMissing && error.code === "ENOENT")) throw error;
    }
  }
}
export function validateDist(root, { protectedProjectRoot } = {}) {
  let protectedUid = null;
  if (protectedProjectRoot !== undefined) {
    // This is an explicit current-production-dist mode, not a generic bypass
    // for staged builds or arbitrary descendants of a private directory.
    assert(root === join(protectedProjectRoot, "dist"), "protected_dist_must_be_current_project_dist");
    protectedUid = protectedProjectUid(protectedProjectRoot);
  }
  const rootStat = lstatSync(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink() && realpathSync(root) === root, "unsafe_dist_root");
  assert(entryPermission(rootStat, protectedUid), "writable_by_other_users");
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = join(directory, entry.name);
      safePath(root, target, false, protectedUid);
      if (entry.isDirectory()) visit(target);
      else assert(entry.isFile(), "special_dist_entry");
    }
  }
  visit(root);
  for (const file of ["server/index.js", "server/wrangler.json"]) {
    assert(lstatSync(join(root, file)).isFile(), "incomplete_dist");
  }
  assert(lstatSync(join(root, "client")).isDirectory(), "incomplete_client_dist");
}
export function validateRelease({ buildDir, manifestPath, projectRoot }) {
  for (const root of [buildDir, projectRoot]) {
    assert(isAbsolute(root) && realpathSync(root) === root && lstatSync(root).isDirectory(), "noncanonical_root");
    assert(process.platform === "win32" || (lstatSync(root).mode & 0o022) === 0, "root_writable_by_other_users");
  }
  const protectedUid = protectedProjectUid(projectRoot);
  assert(isAbsolute(manifestPath) && realpathSync(manifestPath) === manifestPath
    && lstatSync(manifestPath).isFile(), "unsafe_manifest");
  assert(lstatSync(manifestPath).size <= 1_000_000, "manifest_too_large");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 512, "invalid_manifest_files");
  const paths = [];
  for (const entry of manifest.files) {
    assert(typeof entry.path === "string" && entry.path.length <= 240
      && /^[A-Za-z0-9_.@+()[\]/-]+$/u.test(entry.path), "invalid_source_path");
    const parts = entry.path.split("/");
    assert(parts.every(part => part && part !== "." && part !== ".." && !forbidden.test(part))
      && parts[0] !== "dist", "forbidden_source_path");
    assert(!paths.includes(entry.path), "duplicate_source_path");
    assert(/^[a-f0-9]{64}$/u.test(entry.sha256), "invalid_source_hash");
    const source = join(buildDir, entry.path);
    safePath(buildDir, source);
    safePath(projectRoot, join(projectRoot, entry.path), true, protectedUid);
    assert(lstatSync(source).isFile(), "source_not_regular_file");
    const hash = createHash("sha256").update(readFileSync(source)).digest("hex");
    assert(hash === entry.sha256, "source_hash_mismatch");
    paths.push(entry.path);
  }
  for (const required of [
    "drizzle/0023_public_rag_index.sql",
    "drizzle/0024_public_rag_refresh.sql",
    "drizzle/0026_financial_company_snapshot_guard.sql",
    "scripts/apply-local-sqlite-migrations.mjs",
    "scripts/validate-rag-release.mjs",
    "scripts/verify-catalog-ux-release.mjs",
  ]) {
    assert(paths.includes(required), "required_release_file_missing");
  }
  const migrations = releaseMigrations(manifest, paths);
  if (manifest.repairYouthDates === true) {
    assert(migrations.includes("drizzle/0024_public_rag_refresh.sql"), "repair_migration_not_scheduled");
    for (const required of ["scripts/repair-youth-policy-dates.mjs", "lib/public-data/dates.ts", "drizzle/0024_public_rag_refresh.sql"]) {
      assert(paths.includes(required), "required_repair_file_missing");
    }
  } else assert(manifest.repairYouthDates === undefined, "invalid_repair_option");
  validateManifestDist({ distRoot: join(buildDir, "dist"), manifestPath });
  return paths;
}

function releaseMigrations(manifest, paths = manifest.files.map(file => file.path)) {
  const migrations = manifest.migrations;
  assert(Array.isArray(migrations) && migrations.length >= 1 && migrations.length <= 8, "invalid_migrations");
  assert(new Set(migrations).size === migrations.length, "duplicate_migrations");
  for (const migration of migrations) {
    assert(typeof migration === "string" && /^drizzle\/\d{4}_[a-z0-9_]+\.sql$/u.test(migration)
      && paths.includes(migration), "invalid_migration_path");
  }
  // 0026 references the incremental membership table created by 0024. Make
  // both the presence and dependency order part of the signed release plan;
  // a hand-written manifest must not silently omit the stale-index guard.
  let previousIndex = -1;
  for (const required of [
    "drizzle/0023_public_rag_index.sql",
    "drizzle/0024_public_rag_refresh.sql",
    "drizzle/0026_financial_company_snapshot_guard.sql",
  ]) {
    const index = migrations.indexOf(required);
    assert(index > previousIndex, "required_migration_missing_or_out_of_order");
    previousIndex = index;
  }
  return migrations;
}

/** Allow a reviewed dirty production tree, but only against captured file hashes.
 * A concurrent source change or an unexpected file at a new target aborts deploy. */
export function validateProductionBaseline({ manifestPath, projectRoot, gitStatusSha256 }) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.baseline === undefined) return false;
  assert(typeof manifest.baseline.gitStatusSha256 === "string"
    && /^[a-f0-9]{64}$/u.test(manifest.baseline.gitStatusSha256)
    && manifest.baseline.gitStatusSha256 === gitStatusSha256, "production_git_status_changed");
  assert(Array.isArray(manifest.baseline.files) && manifest.baseline.files.length > 0
    && manifest.baseline.files.length <= 5000, "invalid_baseline_files");
  const protectedUid = protectedProjectUid(projectRoot);
  const seen = new Set();
  for (const entry of manifest.baseline.files) {
    assert(typeof entry.path === "string" && entry.path.length <= 240
      && /^[A-Za-z0-9_.@+()[\]/-]+$/u.test(entry.path), "invalid_baseline_path");
    const parts = entry.path.split("/");
    assert(parts.every(part => part && part !== "." && part !== ".." && !forbidden.test(part))
      && parts[0] !== "dist" && !seen.has(entry.path), "forbidden_baseline_path");
    seen.add(entry.path);
    assert(entry.sha256 === null || /^[a-f0-9]{64}$/u.test(entry.sha256), "invalid_baseline_hash");
    const target = join(projectRoot, entry.path);
    safePath(projectRoot, target, entry.sha256 === null, protectedUid);
    if (entry.sha256 === null) {
      assert(!existsSync(target), "new_source_target_exists");
    } else {
      assert(lstatSync(target).isFile(), "baseline_source_not_regular");
      assert(createHash("sha256").update(readFileSync(target)).digest("hex") === entry.sha256, "production_source_changed");
    }
  }
  for (const entry of manifest.files) assert(seen.has(entry.path), "release_target_missing_from_baseline");
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    const mode = args[0]?.startsWith("--") ? args.shift() : "validate";
    const [buildDir, manifestPath, projectRoot, gitStatusSha256] = args;
    if (mode === "--baseline") {
      if (!validateProductionBaseline({ manifestPath, projectRoot, gitStatusSha256 })) process.exitCode = 3;
    } else if (mode === "--plan") {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      process.stdout.write(JSON.stringify({ migrations: releaseMigrations(manifest), repairYouthDates: manifest.repairYouthDates === true }));
    } else if (mode === "--dist") {
      validateManifestDist({ distRoot: buildDir, manifestPath, protectedProjectRoot: projectRoot });
      process.stdout.write("dist_verified\n");
    } else {
      assert(mode === "validate", "unknown_mode");
      process.stdout.write(validateRelease({ buildDir, manifestPath, projectRoot }).join("\n") + "\n");
    }
  } catch {
    // Never echo manifest contents, source contents, keys or database records.
    process.stderr.write("RAG release manifest/path/hash validation failed.\n");
    process.exitCode = 2;
  }
}
