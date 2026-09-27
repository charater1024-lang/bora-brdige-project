import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkRepository } from "./check-public-source.mjs";

// Export only a verified committed snapshot. Git archive never includes .git,
// ignored/untracked files, working-tree overrides, or other branches/history.
try {
  if (process.argv.length > 2) throw new Error("No arguments supported; export the current committed HEAD.");
  const run = args => execFileSync("git", args, { maxBuffer: 128 * 1024 * 1024 });
  if (run(["status", "--porcelain", "--untracked-files=normal"]).length) {
    throw new Error("Commit the intended source changes before exporting.");
  }
  const commit = run(["rev-parse", "--verify", "HEAD^{commit}"]).toString().trim();
  const result = checkRepository({ mode: "ref", ref: commit });
  if (result.findings.length) {
    for (const finding of result.findings) console.error(`${JSON.stringify(finding.path)}:${finding.line} ${finding.category}`);
    throw new Error("Public-source checks failed; no archive created.");
  }
  const version = JSON.parse(run(["show", `${commit}:package.json`]).toString()).version;
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("Invalid release version.");
  const prefix = `BORA-Bridge-Finance-AI-public-v${version}`;
  const archive = run(["archive", "--format=zip", `--prefix=${prefix}/`, commit]);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  const output = resolve("output", `${prefix}-${commit.slice(0, 7)}.zip`);
  mkdirSync(resolve("output"), { recursive: true });
  writeFileSync(output, archive, { flag: "wx" });
  console.log(JSON.stringify({ output, version, commit, files: result.files, bytes: archive.length, sha256, containsGitHistory: false }, null, 2));
} catch (error) {
  // Avoid exposing Git stderr or source content on validation failures.
  console.error(error?.status !== undefined ? "Git export failed; no content values are shown." : error.message);
  process.exitCode = 1;
}
