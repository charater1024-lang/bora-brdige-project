import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const source = (await readFile(new URL("../deploy/run-bora-ops-sandbox.sh", import.meta.url), "utf8")).replaceAll("\r\n", "\n");
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const available = process.platform !== "win32" || existsSync(bash);
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const shell = script => spawnSync(bash, ["--noprofile", "--norc", "-s"], { input: script, encoding: "utf8", timeout: 10000,
  env: { ...process.env, SYNTHETIC_SECRET: "test-do-not-inherit-synthetic-secret" } });

test("ops units delegate namespace isolation to direct Bubblewrap, not a weaker naked Python process", async () => {
  for (const name of ["bora-database-backup.service", "bora-deep-readiness.service"]) {
    const unit = await readFile(new URL(`../deploy/${name}`, import.meta.url), "utf8");
    assert.match(unit, /ExecStart=\/usr\/bin\/bash .*run-bora-ops-sandbox\.sh (?:backup|readiness)/u);
    assert.doesNotMatch(unit, /^(?:PrivateTmp|PrivateNetwork|ProtectHome|ProtectSystem|ReadWritePaths)=/mu);
    assert.match(unit, /UMask=0077/u);
    assert.match(unit, /MemoryMax=/u);
    assert.doesNotMatch(unit, /OnFailure=bora-bridge-recover|Restart=/u);
  }
  assert.match(source, /--ro-bind \/ \/ --dev \/dev --proc \/proc --tmpfs \/tmp/u);
  assert.match(source, /--clearenv/u);
  assert.match(source, /--cap-drop ALL/u);
  assert.match(source, /"\$\{python_bin\}" -I -B/u);
  assert.match(source, /backup_public_key_required/u);
  assert.match(source, /\.sqlite && "\$\{database##\*\/\}" != metadata\.sqlite/u);
  assert.doesNotMatch(source, /--setenv (?:SSH_AUTH_SOCK|LOCAL_LLM_API_KEY|SCHEDULER_SECRET|PYTHONPATH)/u);
});

test("sandbox argument assembly restricts writable output, DB companions, credentials and network", { skip: !available }, async () => {
  const root = await mkdtemp(join(tmpdir(), "bora-ops-sandbox-"));
  try {
    for (const directory of ["home/.ssh", "home/.config/bora-bridge", "home/.local/share/bora-bridge/encrypted-backups",
      "home/.local/share/bora-bridge/ops", "project/deploy", "project/local-llm-server",
      "project/.wrangler/state/v3/d1/miniflare-D1DatabaseObject"]) await mkdir(join(root, directory), { recursive: true });
    for (const file of ["project/deploy/backup-bora-sqlite.py", "project/deploy/check-bora-deep-readiness.py",
      "project/.env.local", "project/.env.scheduler", "project/local-llm-server/.env", "home/.config/bora-bridge/backup-public.pem",
      "project/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/example.sqlite",
      "project/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/example.sqlite-wal",
      "project/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/example.sqlite-shm"]) await writeFile(join(root, file), "synthetic fixture");
    const converted = process.platform === "win32" ? shell(`cygpath -u ${quote(root)}\n`) : { status: 0, stdout: root };
    assert.equal(converted.status, 0);
    const base = converted.stdout.trim();
    const tail = source.slice(source.indexOf("args=(")).replace(/^exec .*$/mu, 'printf "%s\\n" "${args[@]}" "${python_bin}" -I -B "${entry}"');
    for (const mode of ["backup", "readiness"]) {
      const result = shell(`set -euo pipefail
project_root=${quote(base + "/project")}
account_home=${quote(base + "/home")}
data_root="$account_home/.local/share/bora-bridge"
database="$project_root/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/example.sqlite"
backup_dir="$data_root/encrypted-backups"
status_dir="$data_root/ops"
public_key="$account_home/.config/bora-bridge/backup-public.pem"
public_url=https://example.invalid
python_bin=/usr/bin/python3
ops_mode=${mode}
fail() { exit 2; }
${tail}
`);
      assert.equal(result.status, 0, result.stderr);
      const args = result.stdout.trim().split("\n");
      assert.equal(args.includes("--unshare-net"), mode === "backup");
      const writable = args.flatMap((item, index) => item === "--bind" ? [args[index + 1]] : []);
      assert.deepEqual(writable, [base + "/home/.local/share/bora-bridge/" + (mode === "backup" ? "encrypted-backups" : "ops")]);
      for (const suffix of ["", "-wal", "-shm"]) {
        const path = base + "/project/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/example.sqlite" + suffix;
        const index = args.indexOf(path, args.indexOf("--dir") + 2);
        assert.ok(index > 0);
        assert.equal(args[index - 1], "--ro-bind");
      }
      assert.match(result.stdout, /--tmpfs\n.*\/home\/\.ssh\n/u);
      assert.match(result.stdout, /--ro-bind\n\/dev\/null\n.*\/project\/local-llm-server\/\.env/u);
      assert.doesNotMatch(result.stdout, /test-do-not-inherit-synthetic-secret/u);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
