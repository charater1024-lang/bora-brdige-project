// Isolated release preparation from the running server's source tree. Copies no
// credentials, runtime database, Git directory, old build or node_modules.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDistInventory, validateDist } from "./validate-rag-release.mjs";

const PROJECT = resolve(process.env.BORA_PROJECT_ROOT || fileURLToPath(new URL("..", import.meta.url)));
const GIT = process.env.BORA_GIT_BIN || "git";
const [mode, buildDir, fileListPath] = process.argv.slice(2);
const forbidden = /^(?:\.env.*|\.git|\.wrangler|\.deploy.*|node_modules|dist)$/u;
const digest = value => createHash("sha256").update(value).digest("hex");
function allowed(path) {
  return typeof path === "string" && path.length <= 240 && /^[A-Za-z0-9_.@+()[\]/-]+$/u.test(path)
    && path.split("/").every(part => part && part !== "." && part !== ".." && !forbidden.test(part));
}
function checkedFile(root, path) {
  if (!allowed(path)) throw new Error("unsafe_source_path");
  let current = root;
  for (const part of path.split("/")) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("source_symlink_forbidden");
  }
  if (!lstatSync(current).isFile() || realpathSync(current) !== current) throw new Error("source_not_regular");
  return current;
}
const expectedBuildPrefix = `${basename(PROJECT)}-build-rag-`;
if (!buildDir || resolve(buildDir) !== buildDir || dirname(buildDir) !== dirname(PROJECT)
  || !basename(buildDir).startsWith(expectedBuildPrefix)
  || !/^[A-Za-z0-9_-]+$/u.test(basename(buildDir).slice(expectedBuildPrefix.length))) throw new Error("unsafe_build_root");
if (realpathSync(PROJECT) !== PROJECT || lstatSync(PROJECT).isSymbolicLink()) throw new Error("unsafe_project_root");
if (mode === "--seed") {
  if (fileListPath !== undefined || existsSync(buildDir)) throw new Error("build_root_must_be_new");
  const head = execFileSync(GIT, ["-C", PROJECT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const status = execFileSync(GIT, ["-C", PROJECT, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trimEnd();
  const sourcePaths = [...new Set(execFileSync(GIT, ["-C", PROJECT, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
    .split("\0").filter(Boolean))].filter(path => !path.split("/").some(part => forbidden.test(part)));
  if (!sourcePaths.length || sourcePaths.length > 5000 || sourcePaths.some(path => !allowed(path))) throw new Error("unsafe_source_inventory");
  mkdirSync(buildDir, { mode: 0o700 });
  const files = [];
  for (const path of sourcePaths.sort()) {
    const source = checkedFile(PROJECT, path);
    const target = join(buildDir, path);
    const hash = digest(readFileSync(source));
    mkdirSync(dirname(target), { recursive: true, mode: 0o755 });
    copyFileSync(source, target);
    chmodSync(target, 0o644);
    if (digest(readFileSync(target)) !== hash || digest(readFileSync(source)) !== hash) throw new Error("source_changed_during_copy");
    files.push({ path, sha256: hash });
  }
  const baseline = { commit: head, gitStatusSha256: digest(status), files };
  writeFileSync(join(buildDir, "release-baseline.json"), JSON.stringify(baseline, null, 2), { mode: 0o600, flag: "wx" });
  symlinkSync(join(PROJECT, "node_modules"), join(buildDir, "node_modules"), "dir");
  process.stdout.write(JSON.stringify({ mode: "isolated-source-copy", buildDir, baselineCommit: head, sourceFiles: files.length }) + "\n");
} else if (mode === "--manifest") {
  if (realpathSync(buildDir) !== buildDir || !fileListPath) throw new Error("unsafe_manifest_input");
  const baseline = JSON.parse(readFileSync(join(buildDir, "release-baseline.json"), "utf8"));
  const paths = readFileSync(resolve(fileListPath), "utf8").trim().split(/\r?\n/u);
  if (!paths.length || paths.length > 512 || new Set(paths).size !== paths.length || paths.some(path => !allowed(path))) throw new Error("invalid_release_files");
  const files = paths.map(path => {
    const target = checkedFile(buildDir, path);
    // Mechanical line-ending normalization in the isolated copy only, so
    // PowerShell-created scripts are safe for Bash and hashes remain exact.
    if (/\.(?:ts|tsx|js|mjs|css|json|md|sql|sh)$/u.test(path)) {
      const content = readFileSync(target, "utf8");
      if (content.includes("\r\n")) writeFileSync(target, content.replace(/\r\n/gu, "\n"));
    }
    chmodSync(target, 0o644);
    return { path, sha256: digest(readFileSync(target)) };
  });
  const known = new Set(baseline.files.map(file => file.path));
  for (const path of paths) if (!known.has(path)) baseline.files.push({ path, sha256: null });
  const version = JSON.parse(readFileSync(checkedFile(buildDir, "package.json"), "utf8")).version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("invalid_release_version");
  const distRoot = join(buildDir, "dist");
  validateDist(distRoot);
  const manifest = { version, files, baseline, dist: createDistInventory(distRoot), migrations: [
    "drizzle/0023_public_rag_index.sql",
    "drizzle/0024_public_rag_refresh.sql",
    "drizzle/0025_public_catalog_generations.sql",
    "drizzle/0026_financial_company_snapshot_guard.sql",
  ], repairYouthDates: true };
  const target = join(buildDir, "release-manifest.json");
  writeFileSync(target, JSON.stringify(manifest, null, 2), { mode: 0o600, flag: "wx" });
  process.stdout.write(JSON.stringify({ mode: "hashed-release-manifest", sourceFiles: files.length, target }) + "\n");
} else throw new Error("Expected --seed BUILD_DIR or --manifest BUILD_DIR FILE_LIST");
