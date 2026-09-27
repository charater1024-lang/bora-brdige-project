import { execFileSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Explicit opt-in only: do not run this from npm prepare/postinstall or CI.
const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
try {
  const root = git("rev-parse", "--show-toplevel");
  let existing = "";
  try {
    existing = git("config", "--get", "core.hooksPath");
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  const defaultHook = resolve(git("rev-parse", "--git-path", "hooks/pre-commit"));
  if ((existing && existing !== ".githooks") || (!existing && existsSync(defaultHook))) {
    console.error("Refusing to replace an existing core.hooksPath. Integrate the public-source check into your current pre-commit hook manually.");
    process.exitCode = 2;
  } else {
    const hook = join(root, ".githooks", "pre-commit");
    if (!existsSync(hook)) throw new Error("missing hook");
    chmodSync(hook, 0o755);
    git("config", "--local", "core.hooksPath", ".githooks");
    console.log("Installed repository-local public-source pre-commit check (.githooks).");
  }
} catch {
  // Git/config errors may contain private paths or values. Do not echo them.
  console.error("Hook installation failed. Check Git availability and repository permissions.");
  process.exitCode = 2;
}
