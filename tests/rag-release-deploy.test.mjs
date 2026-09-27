import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createDistInventory, isPrivateOwnerPermission, isSafeReleaseEntryPermission, validateDist, validateManifestDist, validateRelease, validateProductionBaseline } from "../scripts/validate-rag-release.mjs";

const script = readFileSync(new URL("../deploy/apply-rag-evidence-release.sh", import.meta.url), "utf8");
const stageScript = readFileSync(new URL("../scripts/stage-catalog-ux-release.mjs", import.meta.url), "utf8");
const validatorScript = readFileSync(new URL("../scripts/validate-rag-release.mjs", import.meta.url), "utf8");
const requiredMigrations = [
  "drizzle/0023_public_rag_index.sql",
  "drizzle/0024_public_rag_refresh.sql",
  "drizzle/0026_financial_company_snapshot_guard.sql",
];
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "bora-rag-release-test-")));
  const parent = dirname(root);
  t.after(() => {
    assert.equal(dirname(realpathSync(root)), parent);
    assert.ok(basename(root).startsWith("bora-rag-release-test-"));
    rmSync(root, { recursive: true });
  });
  const buildDir = join(root, "build"), projectRoot = join(root, "project"), manifestPath = join(root, "manifest.json");
  mkdirSync(buildDir, { mode: 0o755 }); mkdirSync(projectRoot, { mode: 0o755 });
  const paths = [
    "drizzle/0023_public_rag_index.sql",
    "scripts/apply-local-sqlite-migrations.mjs",
    "scripts/validate-rag-release.mjs",
    "lib/rag/context.ts",
    "drizzle/0024_public_rag_refresh.sql",
    "drizzle/0026_financial_company_snapshot_guard.sql",
    "scripts/verify-catalog-ux-release.mjs",
  ];
  const files = paths.map((path) => {
    const content = `synthetic test content: ${path}`;
    mkdirSync(dirname(join(buildDir, path)), { recursive: true, mode: 0o755 });
    writeFileSync(join(buildDir, path), content, { mode: 0o644 });
    return { path, sha256: createHash("sha256").update(content).digest("hex") };
  });
  mkdirSync(join(buildDir, "dist", "server"), { recursive: true, mode: 0o755 });
  mkdirSync(join(buildDir, "dist", "client"), { mode: 0o755 });
  writeFileSync(join(buildDir, "dist", "server", "index.js"), "export default {};", { mode: 0o644 });
  writeFileSync(join(buildDir, "dist", "server", "wrangler.json"), "{}", { mode: 0o644 });
  const manifest = {
    files,
    dist: createDistInventory(join(buildDir, "dist")),
    migrations: [...requiredMigrations],
  };
  const save = () => writeFileSync(manifestPath, JSON.stringify(manifest));
  save();
  return { root, buildDir, projectRoot, manifestPath, files, manifest, save };
}

const hash = text => createHash("sha256").update(text).digest("hex");
function addSource(f, path) {
  const content = `synthetic extra: ${path}`;
  mkdirSync(dirname(join(f.buildDir, path)), { recursive: true, mode: 0o755 });
  writeFileSync(join(f.buildDir, path), content, { mode: 0o644 });
  f.files.push({ path, sha256: hash(content) });
}
function reviewedBaseline(f) {
  f.gitStatusSha256 = hash(" M lib/rag/context.ts\n?? scripts/new.ts");
  f.manifest.baseline = {
    gitStatusSha256: f.gitStatusSha256,
    files: f.files.map(({ path }, index) => {
      if (index === 0) return { path, sha256: null };
      mkdirSync(dirname(join(f.projectRoot, path)), { recursive: true, mode: 0o755 });
      writeFileSync(join(f.projectRoot, path), "reviewed existing content", { mode: 0o644 });
      return { path, sha256: hash("reviewed existing content") };
    }),
  };
  f.save();
}

test("reviewed dirty baseline accepts exact old hashes and explicitly absent new targets", (t) => {
  const f = fixture(t);
  assert.equal(validateProductionBaseline(f), false);
  reviewedBaseline(f);
  assert.equal(validateProductionBaseline(f), true);
  assert.doesNotThrow(() => validateRelease(f));
});

test("baseline rejects existing-file content changes even with unchanged git status", (t) => {
  const f = fixture(t); reviewedBaseline(f);
  writeFileSync(join(f.projectRoot, f.files[1].path), "different content, same porcelain status");
  assert.throws(() => validateProductionBaseline(f), /production_source_changed/u);
});

test("baseline rejects missing existing sources and unexpectedly created new targets", (t) => {
  const f = fixture(t); reviewedBaseline(f);
  const target = join(f.projectRoot, f.files[0].path);
  mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
  writeFileSync(target, "unexpected new source", { mode: 0o644 });
  assert.throws(() => validateProductionBaseline(f), /new_source_target_exists/u);
  rmSync(target);
  rmSync(join(f.projectRoot, f.files[1].path));
  assert.throws(() => validateProductionBaseline(f));
});

test("baseline rejects git status drift and uncovered release targets", (t) => {
  const f = fixture(t); reviewedBaseline(f);
  assert.throws(() => validateProductionBaseline({ ...f, gitStatusSha256: hash("new status") }), /production_git_status_changed/u);
  assert.throws(() => validateProductionBaseline({ ...f, gitStatusSha256: undefined }), /production_git_status_changed/u);
  delete f.manifest.baseline.gitStatusSha256; f.save();
  assert.throws(() => validateProductionBaseline(f), /production_git_status_changed/u);
  f.manifest.baseline.gitStatusSha256 = f.gitStatusSha256;
  f.manifest.baseline.files.pop(); f.save();
  assert.throws(() => validateProductionBaseline(f), /release_target_missing_from_baseline/u);
});

test("baseline rejects duplicate, private, traversal and malformed hash entries", (t) => {
  const f = fixture(t); reviewedBaseline(f);
  const original = { ...f.manifest.baseline.files[0] };
  for (const path of ["../private", ".env.local", ".git/config", ".wrangler/state", "dist/index.js", "/absolute", f.files[1].path]) {
    f.manifest.baseline.files[0] = { path, sha256: null }; f.save();
    assert.throws(() => validateProductionBaseline(f), undefined, path);
  }
  f.manifest.baseline.files[0] = { ...original, sha256: "not-a-hash" }; f.save();
  assert.throws(() => validateProductionBaseline(f), /invalid_baseline_hash/u);
});

test("migration plan accepts declared hashed SQL only and preserves explicit order", (t) => {
  const f = fixture(t);
  assert.doesNotThrow(() => validateRelease(f));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/validate-rag-release.mjs", import.meta.url)), "--plan", f.buildDir, f.manifestPath, f.projectRoot], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { migrations: f.manifest.migrations, repairYouthDates: false });
  for (const migrations of [
    [],
    [requiredMigrations[0], requiredMigrations[0], requiredMigrations[1], requiredMigrations[2]],
    ["drizzle/0099_unlisted.sql"],
    ["../0024_outside.sql"],
    ["lib/rag/context.ts"],
    ["drizzle/../../secret.sql"],
    "drizzle/0023_public_rag_index.sql",
    requiredMigrations.slice(0, 2),
    [requiredMigrations[1], requiredMigrations[0], requiredMigrations[2]],
    [requiredMigrations[0], requiredMigrations[2], requiredMigrations[1]],
  ]) {
    f.manifest.migrations = migrations; f.save();
    assert.throws(() => validateRelease(f), undefined, JSON.stringify(migrations));
  }
});

test("0.8.4 release validation requires the hashed financial snapshot guard and verifier", (t) => {
  const f = fixture(t);
  for (const required of [
    "drizzle/0026_financial_company_snapshot_guard.sql",
    "scripts/verify-catalog-ux-release.mjs",
  ]) {
    const index = f.files.findIndex(({ path }) => path === required);
    const [entry] = f.files.splice(index, 1);
    f.save();
    assert.throws(() => validateRelease(f), /required_release_file_missing/u, required);
    f.files.splice(index, 0, entry);
  }
});

test("repair is opt-in and requires the repair script, date helper and refresh migration", (t) => {
  const f = fixture(t);
  for (const option of [false, "true", 1, null]) {
    f.manifest.repairYouthDates = option; f.save();
    assert.throws(() => validateRelease(f), /invalid_repair_option/u);
  }
  f.manifest.repairYouthDates = true;
  for (const path of ["scripts/repair-youth-policy-dates.mjs", "lib/public-data/dates.ts"]) {
    f.save(); assert.throws(() => validateRelease(f));
    addSource(f, path);
  }
  f.manifest.migrations = [...requiredMigrations]; f.save();
  assert.doesNotThrow(() => validateRelease(f));
  for (const path of ["scripts/repair-youth-policy-dates.mjs", "lib/public-data/dates.ts", "drizzle/0024_public_rag_refresh.sql"]) {
    const index = f.files.findIndex(file => file.path === path);
    const [entry] = f.files.splice(index, 1); f.save();
    assert.throws(() => validateRelease(f), undefined, `missing required repair file: ${path}`);
    f.files.splice(index, 0, entry); f.save();
  }
  f.manifest.migrations = [requiredMigrations[0], requiredMigrations[2]]; f.save();
  assert.throws(() => validateRelease(f), undefined, "repair requires 0024 in the execution plan, not merely in the copied sources");
});

test("deployment checks full porcelain status and runs only staged planned SQL before optional repair", () => {
  assert.match(script, /status --porcelain --untracked-files=all/u);
  assert.match(script, /--baseline .*status_hash/u);
  assert.match(script, /absolute_migrations\+=\("\$\{WORK_STAGE\}\/\$\{relative\}"\)/u);
  assert.match(script, /if \[\[ "\$\{repair_youth_dates\}" == 1 \]\]; then/u);
  assert.match(script, /--apply "\$\{D1_FILE\}" --backup "\$\{BACKUP_DIR\}\/d1-before-date-repair\.sqlite"/u);
  assert.ok(script.indexOf("Protected stage validation failed") < script.indexOf("absolute_migrations=()"));
  assert.ok(script.indexOf("Application did not stop cleanly") < script.indexOf("absolute_migrations=()"));
  assert.ok(script.indexOf("Additive migration failed") < script.indexOf("Public date repair failed"));
  assert.match(script, /verify-catalog-ux-release\.mjs/u);
  assert.match(script, /post-deploy-public-verification\.json/u);
  assert.ok(script.indexOf("wait_for_health || fail") < script.indexOf("post-deploy-public-verification.json"));
  assert.ok(script.indexOf("post-deploy-public-verification.json") < script.indexOf("restore_timers || fail"));
});
test("isolated preflight accepts exactly hashed regular source files", (t) => {
  const f = fixture(t);
  assert.deepEqual(validateRelease(f), f.files.map(file => file.path));
});
test("dist inventory detects added, removed and modified production artifacts", (t) => {
  const f = fixture(t);
  assert.doesNotThrow(() => validateManifestDist({ distRoot: join(f.buildDir, "dist"), manifestPath: f.manifestPath }));
  writeFileSync(join(f.buildDir, "dist", "server", "index.js"), "tampered bundle");
  assert.throws(() => validateRelease(f), /dist_aggregate_mismatch/u);
  writeFileSync(join(f.buildDir, "dist", "server", "index.js"), "export default {};");
  writeFileSync(join(f.buildDir, "dist", "client", "unexpected.js"), "unexpected", { mode: 0o644 });
  assert.throws(() => validateRelease(f), /dist_aggregate_mismatch/u);
});
test("release manifest records the deterministic production-bundle inventory", () => {
  assert.match(stageScript, /dist: createDistInventory\(distRoot\)/u);
  assert.match(stageScript, /validateDist\(distRoot\)/u);
  assert.match(stageScript, /0026_financial_company_snapshot_guard\.sql/u);
  assert.match(validatorScript, /required_migration_missing_or_out_of_order/u);
});
test("isolated preflight rejects traversal, private paths, and absolute source paths", (t) => {
  const f = fixture(t);
  for (const path of ["../secret", "/etc/passwd", ".env.local", "lib/.envrc", ".git/config", ".wrangler/state", "dist/server/index.js", "lib//x.ts"]) {
    f.files[3].path = path; f.save();
    assert.throws(() => validateRelease(f), undefined, path);
  }
});
test("isolated preflight rejects wrong hashes and duplicate or missing required entries", (t) => {
  const f = fixture(t);
  const hash = f.files[3].sha256;
  f.files[3].sha256 = "0".repeat(64); f.save();
  assert.throws(() => validateRelease(f), /source_hash_mismatch/u);
  f.files[3].sha256 = hash; f.files.push(f.files[3]); f.save();
  assert.throws(() => validateRelease(f), /duplicate_source_path/u);
  f.files.pop(); f.files.shift(); f.save();
  assert.throws(() => validateRelease(f), /required_release_file_missing/u);
});
test("isolated preflight rejects nested dist secrets", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.buildDir, "dist", "server", ".env.local"), "synthetic only");
  assert.throws(() => validateRelease(f), /private_path_forbidden/u);
});
test("isolated preflight rejects source-parent symlinks", (t) => {
  const f = fixture(t);
  try { symlinkSync(f.projectRoot, join(f.buildDir, "linked"), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (error.code === "EPERM") return t.skip("Host does not permit fixture symlinks"); throw error; }
  f.files[3].path = "linked/context.ts"; f.save();
  assert.throws(() => validateRelease(f), /symbolic_path_forbidden/u);
});
test("protected root permission policy requires exact 0700 and the current uid", () => {
  assert.equal(isPrivateOwnerPermission({ mode: 0o40700, uid: 1000 }, 1000), true);
  for (const mode of [0o40750, 0o40755, 0o40770, 0o42700]) {
    assert.equal(isPrivateOwnerPermission({ mode, uid: 1000 }, 1000), false);
  }
  assert.equal(isPrivateOwnerPermission({ mode: 0o40700, uid: 1001 }, 1000), false);
  assert.equal(isPrivateOwnerPermission({ mode: 0o40700, uid: 1000 }, undefined), false);
});
test("protected entry permission policy allows only owned group-write, never world-write or shared inodes", () => {
  const file = { mode: 0o100664, uid: 1000, nlink: 1, regularFile: true };
  assert.equal(isSafeReleaseEntryPermission(file), false);
  assert.equal(isSafeReleaseEntryPermission(file, 1000), true);
  assert.equal(isSafeReleaseEntryPermission(file, 1001), false);
  assert.equal(isSafeReleaseEntryPermission({ ...file, mode: 0o100666 }, 1000), false);
  assert.equal(isSafeReleaseEntryPermission({ ...file, nlink: 2 }, 1000), false);
  assert.equal(isSafeReleaseEntryPermission({ ...file, mode: 0o40775, nlink: 4, regularFile: false }, 1000), true);
});
test("protected mode cannot be applied to the staged dist", (t) => {
  const f = fixture(t);
  assert.throws(() => validateDist(join(f.buildDir, "dist"), { protectedProjectRoot: f.projectRoot }), /protected_dist_must_be_current_project_dist/u);
});
test("POSIX private project permits current group-write while stage stays strict", { skip: process.platform === "win32" }, (t) => {
  const f = fixture(t);
  chmodSync(f.projectRoot, 0o700);
  cpSync(join(f.buildDir, "dist"), join(f.projectRoot, "dist"), { recursive: true });
  chmodSync(join(f.projectRoot, "dist"), 0o775);
  chmodSync(join(f.projectRoot, "dist", "server", "index.js"), 0o664);
  assert.doesNotThrow(() => validateDist(join(f.projectRoot, "dist"), { protectedProjectRoot: f.projectRoot }));
  assert.throws(() => validateDist(join(f.projectRoot, "dist")), /writable_by_other_users/u);
  mkdirSync(join(f.projectRoot, "lib", "rag"), { recursive: true });
  writeFileSync(join(f.projectRoot, "lib", "rag", "context.ts"), "old source");
  chmodSync(join(f.projectRoot, "lib", "rag", "context.ts"), 0o664);
  assert.doesNotThrow(() => validateRelease(f));
  chmodSync(join(f.buildDir, "lib", "rag", "context.ts"), 0o664);
  assert.throws(() => validateRelease(f), /writable_by_other_users/u);
  chmodSync(join(f.buildDir, "lib", "rag", "context.ts"), 0o644);
  chmodSync(f.projectRoot, 0o755);
  assert.throws(() => validateRelease(f), /writable_by_other_users/u);
  assert.throws(() => validateDist(join(f.projectRoot, "dist"), { protectedProjectRoot: f.projectRoot }), /writable_by_other_users/u);
});
test("release has read-only preflight, baseline checks, lock and bounded canonical health", () => {
  assert.match(script, /--check/u);
  assert.ok(script.indexOf("check_only == 1") < script.indexOf("exec 9>"));
  assert.match(script, /status --porcelain --untracked-files=no/u);
  assert.match(script, /flock -n 9/u);
  assert.match(script, /bora-runtime-stability-release\.lock/u);
  assert.match(script, /flock -n 8/u);
  assert.ok(script.indexOf("flock -n 8") < script.indexOf("BACKUP_DIR=\"$("));
  assert.match(script, /Host: borabridge\.com/u);
  assert.match(script, /X-Forwarded-Proto: https/u);
  assert.match(script, /\[\[ "\$\{body\}" == '\{"status":"ok"\}' \]\]/u);
  assert.doesNotMatch(script, /git (?:reset|checkout|commit|push)/u);
  assert.match(script, /--dist "\$\{PROJECT_ROOT\}\/dist" "\$\{BACKUP_DIR\}\/manifest\.json"/u);
});
test("release backs up database privately and never restores or drops it on rollback", () => {
  assert.match(script, /chmod 0600 -- "\$\{D1_BACKUP\}"/u);
  assert.match(script, /\.backup '\$\{D1_BACKUP\}'/u);
  assert.match(script, /PRAGMA quick_check/u);
  assert.match(script, /PRAGMA foreign_key_check/u);
  assert.match(script, /NEVER restore the D1 backup/u);
  assert.doesNotMatch(script, /(?:cp|mv)[^\n]*D1_BACKUP[^\n]*D1_FILE/u);
  assert.doesNotMatch(script, /DROP (?:TABLE|TRIGGER)|\brm\s+-/iu);
  assert.match(script, /--experimental-sqlite/u);
  assert.match(script, /0023_public_rag_index\.sql/u);
});
test("rollback is installed before stopping service and preserves monitor/refresh timer states", () => {
  assert.ok(script.indexOf("trap rollback_on_exit EXIT") < script.lastIndexOf("applied=1"));
  assert.match(script, /MainPID --value\)" == 0/u);
  for (const timer of ["bora-bridge-healthcheck.timer", "bora-bridge-memory-watchdog.timer", "bora-public-data-refresh.timer", "bora-seoul-commercial-import.timer"]) assert.ok(script.includes(timer));
  assert.match(script, /Enablement is never changed/u);
  assert.match(script, /restore_timers/u);
  assert.match(script, /failed-source/u);
  assert.match(script, /previous-dist/u);
  assert.match(script, /exit 70/u);
});

test("installing root-level source files never widens existing directory permissions", () => {
  const parentHelper = script.slice(script.indexOf("safe_source_parent()"), script.indexOf("canonical_health_once()"));
  assert.match(parentHelper, /if canonical_dir "\$\{parent\}"; then return 0; fi/u);
  assert.ok(parentHelper.indexOf('if canonical_dir "${parent}"; then return 0; fi')
    < parentHelper.indexOf('/usr/bin/install -d -m 0755'));
});
