import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const scriptUrl = new URL("../deploy/apply-runtime-stability.sh", import.meta.url);

test("runtime stability deploy stages every runtime and watchdog artifact", async () => {
  const [script, installer] = await Promise.all([
    readFile(scriptUrl, "utf8"),
    readFile(
      new URL("../deploy/install-bora-bridge-memory-watchdog.sh", import.meta.url),
      "utf8",
    ),
  ]);

  for (const artifact of [
    "scripts/build-local-runtime-config.mjs",
    "scripts/start-local-worker.mjs",
    "deploy/run-bora-sandbox.sh",
    "deploy/stop-local-worker.sh",
    "deploy/bora-bridge.service",
    "deploy/check-bora-bridge-health.sh",
    "deploy/bora-bridge-healthcheck.service",
    "deploy/bora-bridge-healthcheck.timer",
    "deploy/restart-bora-bridge.sh",
    "deploy/restart.env.example",
    "deploy/bora-bridge-recover.service",
    "deploy/check-bora-bridge-memory.sh",
    "deploy/bora-bridge-memory-watchdog.service",
    "deploy/bora-bridge-memory-watchdog.timer",
    "deploy/memory-watchdog.env.example",
    "deploy/install-bora-bridge-memory-watchdog.sh",
    "deploy/apply-runtime-stability.sh",
  ]) {
    const pattern = new RegExp(artifact.replaceAll(".", "[.]"), "u");
    assert.match(script, pattern);
    assert.match(installer, pattern);
  }

  assert.match(script, /bash -n/u);
  assert.match(script, /NODE_BIN.*--check/u);
  assert.match(script, /systemd-analyze --user verify/u);
  assert.match(script, /staged-files[.]sha256/u);
  assert.match(script, /inspector: false/u);
  assert.match(script, /ExecStop=\/usr\/bin\/bash deploy\/stop-local-worker[.]sh/u);
  assert.doesNotMatch(script, /readonly WORK_STAGE="\$\(/u);
  assert.match(installer, /apply-runtime-stability[.]sh/u);
  assert.doesNotMatch(installer, /systemctl --user/u);
});

test("runtime stability deploy creates a verified online database backup only", async () => {
  const script = await readFile(scriptUrl, "utf8");

  assert.match(script, /[.]backup '\$\{D1_BACKUP\}'/u);
  assert.match(script, /PRAGMA quick_check;/u);
  assert.match(script, /PRAGMA foreign_key_check;/u);
  assert.match(script, /sha256sum --check --status/u);
  assert.match(script, /exactly one database/u);
  assert.match(script, /! -name 'metadata[.]sqlite'/u);
  assert.match(script, /Miniflare metadata database is unsafe/u);
  assert.match(script, /auth_sessions.*oauth_users.*public_api_source_state/u);
  assert.match(script, /D1 file is deliberately never restored/u);
  assert.doesNotMatch(script, /(?:cp|mv)[^\n]*d1-online-before[^\n]*D1_FILE/u);
  assert.doesNotMatch(script, /(?:cp|mv)[^\n]*D1_BACKUP[^\n]*D1_FILE/u);
});

test("runtime stability deploy uses exact canonical health and bounded live recovery", async () => {
  const script = await readFile(scriptUrl, "utf8");

  assert.match(script, /Host: borabridge[.]com/u);
  assert.match(script, /X-Forwarded-Host: borabridge[.]com/u);
  assert.match(script, /X-Forwarded-Proto: https/u);
  assert.match(script, /Origin: https:\/\/borabridge[.]com/u);
  assert.match(script, /\[\[ "\$\{body\}" == '\{"status":"ok"\}' \]\]/u);
  assert.match(script, /BORA_MEMORY_WATCHDOG_DRY_RUN=0/u);
  assert.doesNotMatch(script, /Watchdog activation mode:.*observe only/u);
  assert.match(script, /validate_private_optional_config/u);
  assert.match(script, /Private configuration must have mode 0600/u);
  assert.match(script, /Watchdog activation mode:.*bounded recovery enabled/u);
  assert.match(script, /enable --now "\$\{WATCHDOG_TIMER\}"/u);
  assert.match(script, /--inspector-addr/u);
});

test("runtime stability deploy rolls back files and units without broad deletion", async () => {
  const script = await readFile(scriptUrl, "utf8");

  assert.match(script, /trap rollback_on_exit EXIT/u);
  assert.match(script, /restore_file/u);
  assert.match(script, /restore_timer_state/u);
  assert.match(script, /enabled-runtime/u);
  assert.match(script, /BORA_RUNTIME_STABILITY_FAILPOINT/u);
  assert.match(script, /rollback_app_stopped/u);
  assert.match(script, /systemctl --user restart "\$\{APP_SERVICE\}"/u);
  assert.match(script, /ActiveEnterTimestampMonotonic/u);
  assert.match(script, /Automatic runtime rollback was incomplete/u);
  assert.match(script, /rm -f -- "\$\{target\}"/u);
  const rollbackTrap = script.indexOf("trap rollback_on_exit EXIT");
  const firstOperationalStop = script.indexOf(
    'applied=1\n/usr/bin/systemctl --user stop "${WATCHDOG_TIMER}"',
  );
  assert.ok(rollbackTrap > 0);
  assert.ok(firstOperationalStop > rollbackTrap);
  assert.doesNotMatch(script, /rm -rf -- "\$\{PROJECT_ROOT\}"/u);
  assert.doesNotMatch(script, /git reset/u);
  assert.doesNotMatch(script, /git checkout/u);
});
