import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readDeployFile = (name) =>
  readFile(new URL(`../deploy/${name}`, import.meta.url), "utf8");

test("memory watchdog uses sustained thresholds and bounded restart policy", async () => {
  const script = await readDeployFile("check-bora-bridge-memory.sh");

  assert.match(script, /WARNING_BYTES:-2684354560/u);
  assert.match(script, /RESTART_BYTES:-3758096384/u);
  assert.match(script, /EMERGENCY_BYTES:-4026531840/u);
  assert.match(script, /REQUIRED_SAMPLES:-2/u);
  assert.match(script, /COOLDOWN_SECONDS:-21600/u);
  assert.match(script, /MAX_RESTARTS_PER_WINDOW:-2/u);
  assert.match(script, /consecutive_samples < required_samples/u);
  assert.match(script, /restart_count_in_window >= max_restarts_per_window/u);
  assert.match(script, /last_restart_epoch[\s\S]*cooldown_seconds/u);
  assert.match(script, /flock_bin.*--nonblock/u);
  assert.match(script, /DRY_RUN:-1/u);
  assert.match(script, /bora_memory_watchdog_canary/u);
  assert.match(script, /persisted_consecutive_samples/u);
  assert.match(
    script,
    /now_epoch - last_observation_epoch >= observation_interval_seconds/u,
  );
  assert.match(
    script,
    /if \(\( persisted_consecutive_samples > 0 \)\); then\s+write_state/u,
  );
});

test("memory watchdog reads service and cgroup telemetry without logging secrets", async () => {
  const script = await readDeployFile("check-bora-bridge-memory.sh");

  for (const property of [
    "MemoryCurrent",
    "MemoryPeak",
    "ControlGroup",
    "ActiveState",
    "SubState",
    "NRestarts",
  ]) {
    assert.match(script, new RegExp(`--property=${property}`, "u"));
  }

  assert.match(script, /memory[.]current/u);
  assert.match(script, /memory[.]events/u);
  assert.match(script, /memory[.]swap[.]current/u);
  assert.match(script, /memory[.]pressure/u);
  assert.match(script, /psi_some_avg10/u);
  assert.doesNotMatch(script, /Environment=.{0,20}(API_KEY|SECRET|TOKEN)/u);
});

test("shared restart helper serializes recovery and verifies canonical health", async () => {
  const [watchdog, helper, health, recover] = await Promise.all([
    readDeployFile("check-bora-bridge-memory.sh"),
    readDeployFile("restart-bora-bridge.sh"),
    readDeployFile("check-bora-bridge-health.sh"),
    readDeployFile("bora-bridge-recover.service"),
  ]);

  assert.match(health, /http:\/\/127[.]0[.]0[.]1:3000\/api\/health/u);
  assert.match(health, /Host: borabridge[.]com/u);
  assert.match(health, /X-Forwarded-Proto: https/u);
  assert.match(health, /Origin: https:\/\/borabridge[.]com/u);
  assert.match(helper, /flock_bin.*--nonblock/u);
  assert.match(helper, /reason.*== health[\s\S]*already_healthy/u);
  const preflightIndex = helper.indexOf('if [[ "${reason}" == health ]]');
  const lockIndex = helper.indexOf('exec 9>"${restart_lock}"');
  const lockedRecheckIndex = helper.indexOf(
    'if [[ "${reason}" == health ]]',
    preflightIndex + 1,
  );
  assert.ok(preflightIndex > 0);
  assert.ok(preflightIndex < lockIndex);
  assert.ok(lockedRecheckIndex > lockIndex);
  assert.match(helper, /systemctl_bin.*--user restart/u);
  assert.match(helper, /bora_bridge_restart_succeeded/u);
  assert.match(helper, /health_check_failed/u);
  assert.match(watchdog, /restart-bora-bridge[.]sh/u);
  assert.match(recover, /restart-bora-bridge[.]sh --reason health/u);
});

test("memory watchdog samples twice before the 20-second oomd pressure window", async () => {
  const [service, timer, installer, appService] = await Promise.all([
    readDeployFile("bora-bridge-memory-watchdog.service"),
    readDeployFile("bora-bridge-memory-watchdog.timer"),
    readDeployFile("install-bora-bridge-memory-watchdog.sh"),
    readDeployFile("bora-bridge.service"),
  ]);

  assert.match(service, /Type=oneshot/u);
  assert.match(service, /EnvironmentFile=-%h\/[.]config\/bora-bridge\/memory-watchdog[.]env/u);
  assert.match(service, /NoNewPrivileges=true/u);
  assert.match(service, /TimeoutStartSec=180/u);
  assert.match(timer, /OnUnitInactiveSec=10s/u);
  assert.match(timer, /AccuracySec=1s/u);
  assert.match(timer, /RandomizedDelaySec=1s/u);
  assert.match(timer, /Persistent=true/u);
  assert.match(installer, /bora-runtime-stability-installer[.]XXXXXX/u);
  assert.match(installer, /install -m 0600/u);
  assert.match(installer, /restart[.]env[.]example/u);
  assert.match(installer, /bora-bridge[.]service/u);
  assert.match(installer, /bora-bridge-recover[.]service/u);
  assert.match(installer, /apply-runtime-stability[.]sh/u);
  assert.doesNotMatch(installer, /systemctl --user enable/u);
  assert.match(appService, /MemoryHigh=3750M/u);
  assert.match(appService, /MemoryMax=4G/u);
  assert.match(appService, /MemorySwapMax=256M/u);
  assert.match(appService, /OOMPolicy=stop/u);
});
