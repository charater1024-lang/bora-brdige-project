import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readDeployFile = (name) =>
  readFile(new URL(`../deploy/${name}`, import.meta.url), "utf8");

test("local worker stop helper targets one exact runner in the service cgroup", async () => {
  const script = await readDeployFile("stop-local-worker.sh");

  assert.match(script, /--property=MainPID --property=ControlGroup/u);
  assert.match(script, /cgroup[.]procs/u);
  assert.match(script, /0::\$\{control_group\}/u);
  assert.match(script, /expected_argv=\(/u);
  assert.match(script, /start-local-worker[.]mjs/u);
  assert.match(script, /--config/u);
  assert.match(script, /--persist-to/u);
  assert.match(script, /--host "\$\{listen_host\}"/u);
  assert.match(script, /--port "\$\{listen_port\}"/u);
  assert.match(script, /candidates\[@\].*!= 1/u);
  assert.match(script, /"\$\{kill_bin\}" -TERM -- "\$\{target_pid\}"/u);
  assert.doesNotMatch(script, /\b(?:pkill|killall)\b/u);
});

test("local worker stop helper bounds graceful waiting and revalidates before signalling", async () => {
  const script = await readDeployFile("stop-local-worker.sh");

  assert.match(script, /BORA_STOP_TIMEOUT_SECONDS:-15/u);
  assert.match(script, /timeout_seconds\} <= 15/u);
  assert.match(
    script,
    /process_is_expected "\$\{target_pid\}"[\s\S]*"\$\{kill_bin\}" -TERM/u,
  );
  assert.match(script, /for \(\(remaining = 10#\$\{timeout_seconds\}/u);
  assert.doesNotMatch(script, /-KILL/u);
});

test("local worker stop helper safely resolves packaged executable symlinks", async () => {
  const script = await readDeployFile("stop-local-worker.sh");

  assert.match(script, /readlink -f -- "\$\{executable\}"/u);
  assert.match(script, /stat --format='%u:%a'/u);
  assert.match(script, /trusted_executable_uid/u);
  assert.match(script, /8#\$\{mode_text\} & 8#022/u);
  assert.match(script, /sleep:\/usr\/lib\/cargo\/bin\/coreutils\/sleep/u);
  assert.match(script, /-f "\$\{resolved\}"/u);
  assert.match(script, /-x "\$\{resolved\}"/u);
  assert.match(script, /systemctl_bin="\$\(resolve_executable systemctl/u);
  assert.match(script, /sleep_bin="\$\(resolve_executable sleep/u);
  assert.doesNotMatch(
    script,
    /Required executable is missing, non-executable, or symbolic/u,
  );
});

test("application service requests exact graceful runner shutdown before systemd cleanup", async () => {
  const service = await readDeployFile("bora-bridge.service");

  assert.match(service, /ExecStop=\/usr\/bin\/bash deploy\/stop-local-worker[.]sh/u);
  assert.match(service, /TimeoutStopSec=30/u);
  assert.match(service, /KillMode=mixed/u);
  assert.match(service, /SuccessExitStatus=143/u);
});
