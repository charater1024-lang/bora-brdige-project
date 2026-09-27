import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = fileURLToPath(new URL("..", import.meta.url));
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const shellAvailable = process.platform !== "win32" || existsSync(bash);
const shellTest = (name, fn) => test(name, { skip: !shellAvailable }, fn);
const quoted = value => `'${value.replaceAll("'", "'\\''")}'`;
const scriptText = async name => (await readFile(join(repository, name), "utf8")).replaceAll("\r\n", "\n");
const functionText = (source, name) => {
  const value = source.match(new RegExp(`^${name}\\(\\) \\{[\\s\\S]*?^\\}`, "mu"))?.[0];
  assert.ok(value, `Missing function ${name}`);
  return value;
};
const shell = (input, env = {}) => spawnSync(bash, ["--noprofile", "--norc", "-s"], {
  input: `${input}\n`, encoding: "utf8", timeout: 15000,
  env: { ...process.env, ...env },
});
const posixPath = value => {
  if (process.platform !== "win32") return value;
  const result = shell(`cygpath -u ${quoted(value)}`);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

shellTest("web sandbox masks scheduler and gateway private files without affecting their host services", async () => {
  const source = await scriptText("deploy/run-bora-sandbox.sh");
  const loop = source.match(/^for sensitive_file in \\[\s\S]*?^done$/mu)?.[0];
  assert.ok(loop);
  for (const path of [".env.local", ".env.scheduler", ".env.public-api-proxy", "local-llm-server/.env"]) {
    assert.ok(loop.includes(`\${PROJECT_ROOT}/${path}`));
  }
  const directory = await mkdtemp(join(tmpdir(), "bora-mask-test-"));
  try {
    await mkdir(join(directory, "local-llm-server"));
    await writeFile(join(directory, ".env.scheduler"), "synthetic scheduler configuration\n");
    await writeFile(join(directory, "local-llm-server/.env"), "synthetic gateway configuration\n");
    const path = posixPath(directory);
    const result = shell(`set -euo pipefail
PROJECT_ROOT=${quoted(path)}
DEPLOY_HOME=${quoted(path)}
sandbox_args=()
${functionText(source, "mask_file")}
${loop}
printf '%s\\n' "\${sandbox_args[@]}"
`);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n"), [
      "--ro-bind", "/dev/null", `${path}/.env.scheduler`,
      "--ro-bind", "/dev/null", `${path}/local-llm-server/.env`,
    ]);
    assert.equal(await readFile(join(directory, ".env.scheduler"), "utf8"), "synthetic scheduler configuration\n");
    assert.equal(await readFile(join(directory, "local-llm-server/.env"), "utf8"), "synthetic gateway configuration\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

shellTest("security deployment EXIT handler restores exactly once for failures and signals", async () => {
  const source = await scriptText("deploy/apply-user-security.sh");
  const traps = source.split("\n").filter(line => /^trap (?:on_exit EXIT|'exit (?:129|130|143)' (?:HUP|INT|TERM))$/u.test(line));
  assert.equal(traps.length, 4);
  const prefix = [
    "set -Eeuo pipefail", "MUTATION_STARTED=1", "DEPLOY_SUCCEEDED=0", "BACKUP_DIR=/isolated-test",
    functionText(source, "die"), functionText(source, "on_exit"),
    'restore_previous_release() { printf "ROLLBACK_CALLED\\n"; return 0; }', ...traps,
  ].join("\n");
  for (const [failure, expected] of [
    ["false", 1], ['die "Injected failed readiness"', 1], ["exit 23", 23], ["exit 0", 1],
    ["kill -HUP $$", 129], ["kill -INT $$", 130], ["kill -TERM $$", 143],
  ]) {
    const result = shell(`${prefix}\n${failure}`);
    assert.equal(result.status, expected, `${failure}: ${result.stderr}`);
    assert.equal(result.stdout.match(/ROLLBACK_CALLED/gu)?.length, 1, failure);
  }
  for (const state of ["DEPLOY_SUCCEEDED=1", "MUTATION_STARTED=0"]) {
    const result = shell(`${prefix}\n${state}\nexit 0`);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /ROLLBACK_CALLED/u);
  }
  const failedRestore = shell(`${prefix}\nrestore_previous_release() { printf 'ROLLBACK_CALLED\\n'; return 1; }\nexit 23`);
  assert.equal(failedRestore.status, 70);
  assert.match(failedRestore.stderr, /original exit 23/u);
  assert.equal(failedRestore.stdout.match(/ROLLBACK_CALLED/gu)?.length, 1);
});

shellTest("security deployment restoration never overwrites a still-running release", async () => {
  const source = await scriptText("deploy/apply-user-security.sh");
  const restore = functionText(source, "restore_previous_release");
  const result = shell(`set -Eeuo pipefail
log() { :; }
systemctl() { case "$*" in *stop*) return 1;; *) return 0;; esac; }
mv() { printf 'UNSAFE_WRITE\\n'; }
tar() { printf 'UNSAFE_WRITE\\n'; }
install() { printf 'UNSAFE_WRITE\\n'; }
${restore}
restore_previous_release`);
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /UNSAFE_WRITE/u);
});

shellTest("security restoration reports copy failures without claiming recovery or starting mixed files", async () => {
  const source = await scriptText("deploy/apply-user-security.sh");
  const result = shell(`set -Eeuo pipefail
BACKUP_DIR=/isolated-missing-backup
PROJECT_ROOT=/isolated-missing-project
USER_UNIT_ROOT=/isolated-units
log() { printf '%s\\n' "$*"; }
systemctl() { case "$*" in *is-active*) return 3;; *restart*) printf 'UNSAFE_RESTART\\n';; esac; }
tar() { return 19; }
install() { return 0; }
${functionText(source, "restore_previous_release")}
restore_previous_release`);
  assert.equal(result.status, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /UNSAFE_RESTART|Previous release restored/u);
});

shellTest("security deployment health validation is bounded and requires exact readiness", async () => {
  const source = await scriptText("deploy/apply-user-security.sh");
  const health = functionText(source, "wait_for_application_health");
  assert.match(health, /--connect-timeout 2 --max-time 5/u);
  for (const [body, expected] of [["{\"status\":\"ok\"}", 0], ["{\"status\":\"degraded\"}", 1], ["<html>login</html>", 1]]) {
    const result = shell(`set -Eeuo pipefail
HEALTH_URL=http://127.0.0.1:1/never-requested
curl() { printf '%s' ${quoted(body)}; }
seq() { printf '1\\n'; }
sleep() { :; }
${health}
wait_for_application_health`);
    assert.equal(result.status, expected, result.stderr);
  }
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "bora-deploy-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "deploy"));
  await mkdir(join(directory, "bin"));
  await writeFile(join(directory, "package.json"), "{}\n");
  for (const name of ["deployment-paths.sh", "install-user-units.sh", "bora-bridge.service", "bora-bridge-healthcheck.service", "bora-bridge-memory-watchdog.service", "bora-bridge-recover.service", "bora-local-llm.service"]) {
    await copyFile(join(repository, "deploy", name), join(directory, "deploy", name));
  }
  const node = join(directory, "bin", "node");
  await writeFile(node, "#!/bin/sh\nexit 0\n");
  await chmod(node, 0o700);
  const root = posixPath(directory);
  const environment = { BORA_PROJECT_ROOT: root, BORA_NODE_BIN: `${root}/bin/node`, XDG_CONFIG_HOME: `${root}/config`, HOME: root, BORA_LOCAL_LLM_RUNTIME_ROOT: "" };
  const run = code => shell(`set -Eeuo pipefail\ncd ${quoted(root)}\n${code}`, environment);
  return { directory, root, environment, run };
}

shellTest("unit rendering pins Node and one canonical custom configuration root", async t => {
  const { root, run } = await fixture(t);
  const result = run("bash deploy/install-user-units.sh --print bora-bridge.service bora-bridge-healthcheck.service bora-bridge-memory-watchdog.service bora-bridge-recover.service");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(`Environment=BORA_NODE_BIN=${root}/bin/node`));
  assert.ok(result.stdout.includes(`ExecStartPre=${root}/bin/node scripts/build-local-runtime-config.mjs`));
  assert.ok(result.stdout.includes(`Environment=PATH=${root}/bin:/usr/local/bin:/usr/bin:/bin`));
  assert.ok(result.stdout.includes(`EnvironmentFile=-${root}/config/bora-bridge/memory-watchdog.env`));
  assert.ok(result.stdout.includes(`EnvironmentFile=-${root}/config/bora-bridge/restart.env`));
  assert.doesNotMatch(result.stdout, /%h\/\.config\/bora-bridge/u);
});

shellTest("unit rendering preserves default config semantics and rejects unsafe configuration or Node paths", async t => {
  const { root, run } = await fixture(t);
  const defaultConfig = run("unset XDG_CONFIG_HOME\nbash deploy/install-user-units.sh --print bora-bridge-memory-watchdog.service");
  assert.equal(defaultConfig.status, 0, defaultConfig.stderr);
  assert.ok(defaultConfig.stdout.includes(`EnvironmentFile=-${root}/.config/bora-bridge/memory-watchdog.env`));
  for (const config of ["relative/config", "/tmp/bora with spaces", "/tmp/%h", `${root}/config/../other`]) {
    const invalid = run(`export XDG_CONFIG_HOME=${quoted(config)}\nbash deploy/install-user-units.sh --print bora-bridge.service`);
    assert.notEqual(invalid.status, 0, config);
  }
  const missingNode = run("export BORA_NODE_BIN=/nonexistent/bora-node\nbash deploy/install-user-units.sh --print bora-bridge.service");
  assert.notEqual(missingNode.status, 0);
  const fromPath = run(`unset BORA_NODE_BIN\nexport PATH=${quoted(`${root}/bin`)}:$PATH\nbash deploy/install-user-units.sh --print bora-bridge.service`);
  assert.equal(fromPath.status, 0, fromPath.stderr);
  assert.ok(fromPath.stdout.includes(`Environment=BORA_NODE_BIN=${root}/bin/node`));
  const unsafeNode = run(`cp bin/node 'bin/node with spaces'\nexport BORA_NODE_BIN=${quoted(`${root}/bin/node with spaces`)}\nbash deploy/install-user-units.sh --print bora-bridge.service`);
  assert.notEqual(unsafeNode.status, 0);
});

shellTest("unit installation validates the complete selection and destinations before replacement", async t => {
  const { directory, run } = await fixture(t);
  const unitRoot = join(directory, "config", "systemd", "user");
  await mkdir(unitRoot, { recursive: true });
  await writeFile(join(unitRoot, "bora-bridge.service"), "original-app\n");
  for (const selection of ["bora-bridge.service bora-unknown.service", "bora-bridge.service bora-bridge.service"]) {
    const result = run(`bash deploy/install-user-units.sh ${selection}`);
    assert.notEqual(result.status, 0);
    assert.equal(await readFile(join(unitRoot, "bora-bridge.service"), "utf8"), "original-app\n");
  }
  await mkdir(join(unitRoot, "bora-bridge-recover.service"));
  const badDestination = run("bash deploy/install-user-units.sh bora-bridge.service bora-bridge-recover.service");
  assert.notEqual(badDestination.status, 0);
  assert.equal(await readFile(join(unitRoot, "bora-bridge.service"), "utf8"), "original-app\n");
  assert.deepEqual((await readdir(unitRoot)).sort(), ["bora-bridge-recover.service", "bora-bridge.service"]);
});

test("POSIX unit installation restores earlier replacements when a later atomic rename fails", { skip: process.platform === "win32" }, async t => {
  const { directory, root, run } = await fixture(t);
  const unitRoot = join(directory, "config", "systemd", "user");
  await mkdir(unitRoot, { recursive: true });
  await writeFile(join(unitRoot, "bora-bridge.service"), "original-app\n");
  await writeFile(join(unitRoot, "bora-bridge-recover.service"), "original-recovery\n");
  const result = run(`mv() {
  case "$*" in *bora-bridge-recover.service.next*) return 41;; esac
  command mv "$@"
}
export -f mv
bash deploy/install-user-units.sh bora-bridge.service bora-bridge-memory-watchdog.service bora-bridge-recover.service`);
  assert.equal(result.status, 41, result.stderr);
  assert.equal(await readFile(join(unitRoot, "bora-bridge.service"), "utf8"), "original-app\n");
  assert.equal(await readFile(join(unitRoot, "bora-bridge-recover.service"), "utf8"), "original-recovery\n");
  assert.equal(existsSync(join(unitRoot, "bora-bridge-memory-watchdog.service")), false);
  assert.equal((await readdir(unitRoot)).some(name => name.startsWith(".bora-unit-stage")), false);
  const success = run("bash deploy/install-user-units.sh bora-bridge.service bora-bridge-recover.service");
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /No service was enabled, reloaded, or restarted/u);
  assert.ok((await readFile(join(unitRoot, "bora-bridge.service"), "utf8")).includes(`Environment=BORA_NODE_BIN=${root}/bin/node`));
});
