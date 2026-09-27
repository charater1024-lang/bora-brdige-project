import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the user service graph has no cycle and allows web recovery while Local AI starts", async () => {
  const [app, gateway, ollama, tunnel] = await Promise.all([
    read("deploy/bora-bridge.service"), read("deploy/bora-local-llm.service"),
    read("deploy/bora-ollama.service"), read("deploy/bora-cloudflared.service"),
  ]);
  assert.match(app, /^After=.*bora-local-llm[.]service/mu);
  assert.match(app, /^Wants=.*bora-local-llm[.]service/mu);
  assert.match(gateway, /^After=.*bora-ollama[.]service/mu);
  assert.match(gateway, /^Wants=.*bora-ollama[.]service/mu);
  assert.doesNotMatch(ollama, /bora-(?:local-llm|bridge)[.]service/u);
  assert.match(tunnel, /^After=.*bora-bridge[.]service/mu);
  assert.doesNotMatch(app, /Requires=.*bora-local-llm/u);
  for (const unit of [app, gateway, ollama, tunnel]) {
    assert.match(unit, /^Restart=(?:always|on-failure)$/mu);
    assert.match(unit, /^WantedBy=default[.]target$/mu);
  }
});

test("installers and runtime release require durable enablement without claiming an unobserved reboot", async () => {
  const [localInstall, release] = await Promise.all([
    read("deploy/install-local-llm-user-services.sh"), read("deploy/apply-runtime-stability.sh"),
  ]);
  assert.match(localInstall, /loginctl show-user[\s\S]*--property=Linger --value/u);
  assert.ok(localInstall.indexOf("loginctl show-user") < localInstall.indexOf("systemctl --user enable bora-ollama"));
  assert.match(localInstall, /systemctl --user is-enabled --quiet bora-ollama[.]service/u);
  assert.match(localInstall, /systemctl --user is-enabled --quiet bora-local-llm[.]service/u);
  assert.match(release, /systemctl --user enable "\$\{APP_SERVICE\}"/u);
  assert.match(release, /systemctl --user is-enabled --quiet "\$\{APP_SERVICE\}"/u);
  for (const dependency of ["bora-ollama.service", "bora-local-llm.service", "bora-public-api-proxy.service", "bora-cloudflared.service", "bora-public-data-refresh.timer"]) {
    assert.ok(release.includes(dependency));
  }
  assert.match(release, /check-runtime-autostart[.]sh"[\s\\]*\n[\s\S]*complete durable-autostart/u);
  assert.doesNotMatch(localInstall + release, /reboot (?:verified|tested|complete)/iu);
});

test("the recurring canary verifies enabled plus active, exact readiness and records observed boot changes", async () => {
  const [checker, health, release, installer] = await Promise.all([
    read("deploy/check-runtime-autostart.sh"), read("deploy/bora-bridge-healthcheck.service"),
    read("deploy/apply-runtime-stability.sh"), read("deploy/install-bora-bridge-memory-watchdog.sh"),
  ]);
  for (const unit of ["bora-ollama.service", "bora-local-llm.service", "bora-public-api-proxy.service",
    "bora-bridge.service", "bora-cloudflared.service", "bora-bridge-healthcheck.timer",
    "bora-bridge-memory-watchdog.timer", "bora-public-data-refresh.timer"]) assert.ok(checker.includes(unit));
  assert.match(checker, /UnitFileState --value/u);
  assert.match(checker, /ActiveState --value/u);
  assert.match(checker, /Host: borabridge[.]com/u);
  assert.match(checker, /http:\/\/127[.]0[.]0[.]1:3000\/api\/health\)" == '\{"status":"ok"\}'/u);
  assert.match(checker, /127[.]0[.]0[.]1:11435\/health/u);
  assert.match(checker, /value\?\.status==="ok"&&value\?\.model_state==="ready"/u);
  assert.match(checker, /does not claim end-to-end public tunnel availability/u);
  assert.match(checker, /restart_delta/u);
  assert.match(checker, /BORA_AUTOSTART_BOOT_ID_FILE/u);
  assert.match(checker, /previous_boot_id/u);
  assert.match(checker, /reboot_observed/u);
  assert.match(checker, /reboots_observed/u);
  assert.match(checker, /last_reboot_epoch/u);
  assert.match(checker, /reboot_tested[\s\S]*reboot_observed_this_run/u);
  assert.match(checker, /session_flow_tested.*false/u);
  assert.match(health, /ExecStartPost=-\/usr\/bin\/bash .*check-runtime-autostart[.]sh/u);
  assert.match(release, /deploy\/check-runtime-autostart[.]sh/u);
  assert.match(installer, /deploy\/check-runtime-autostart[.]sh/u);
});

test("OAuth sessions are restart-persistent database records, not process memory", async () => {
  const [store, callback, service] = await Promise.all([
    read("lib/auth/store.ts"), read("app/api/auth/callback/[provider]/route.ts"), read("deploy/bora-bridge.service"),
  ]);
  assert.match(store, /CREATE TABLE IF NOT EXISTS auth_sessions/u);
  assert.match(store, /INSERT INTO auth_sessions/u);
  assert.match(store, /WHERE s[.]token_hash = \? AND s[.]expires_at > \?/u);
  assert.match(callback, /createAuthSession\(/u);
  assert.match(callback, /sessionCookie\(\{/u);
  assert.match(service, /TimeoutStopSec=30/u);
  assert.doesNotMatch(store, /new Map.*auth_sessions/su);
});

test("POSIX canary behavior rejects degraded HTTP-200 gateway and accepts ready JSON", { skip: process.platform === "win32" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "bora-autostart-test-"));
  const make = async (name, body) => { const path = join(directory, name); await writeFile(path, `#!/usr/bin/env bash\nset -eu\n${body}\n`); await chmod(path, 0o700); return path; };
  const systemctl = await make("systemctl", String.raw`case "$*" in *UnitFileState*) echo enabled;; *ActiveState*) echo active;; *NRestarts*) echo 0;; *) exit 2;; esac`);
  const loginctl = await make("loginctl", "echo yes");
  const curl = await make("curl", 'case "$*" in *3000/api/health*) printf \'{"status":"ok"}\';; *11435/health*) printf \'%s\' "$GATEWAY_JSON";; *) exit 2;; esac');
  const bootId = join(directory, "boot-id");
  await writeFile(bootId, "11111111-1111-1111-1111-111111111111\n");
  const checker = fileURLToPath(new URL("../deploy/check-runtime-autostart.sh", import.meta.url));
  const run = gateway => spawnSync("bash", [checker], { encoding: "utf8", env: { ...process.env,
    GATEWAY_JSON: gateway, BORA_AUTOSTART_SYSTEMCTL: systemctl, BORA_AUTOSTART_LOGINCTL: loginctl,
    BORA_AUTOSTART_CURL: curl, BORA_AUTOSTART_NODE: process.execPath,
    BORA_AUTOSTART_BOOT_ID_FILE: bootId,
    BORA_AUTOSTART_STATE_ROOT: join(directory, "state"),
  } });
  const degraded = run('{"status":"degraded","model_state":"ready","selected_model":"m"}');
  assert.notEqual(degraded.status, 0);
  assert.match(degraded.stderr, /local_model_gateway_not_ready/u);
  const notLoaded = run('{"status":"ok","model_state":"not-loaded","selected_model":"m"}');
  assert.notEqual(notLoaded.status, 0);
  const ready = run('{"status":"ok","model_state":"ready","selected_model":"m"}');
  assert.equal(ready.status, 0, ready.stderr);
  assert.match(ready.stdout, /"status":"ready"/u);
  assert.match(ready.stdout, /"reboot_tested":false/u);
  await writeFile(bootId, "22222222-2222-2222-2222-222222222222\n");
  const rebooted = run('{"status":"ok","model_state":"ready","selected_model":"m"}');
  assert.equal(rebooted.status, 0, rebooted.stderr);
  assert.match(rebooted.stdout, /"reboot_tested":true/u);
  assert.match(rebooted.stdout, /"reboot_observed_this_run":true/u);
  const sameBoot = run('{"status":"ok","model_state":"ready","selected_model":"m"}');
  assert.equal(sameBoot.status, 0, sameBoot.stderr);
  assert.match(sameBoot.stdout, /"reboot_tested":true/u);
  assert.match(sameBoot.stdout, /"reboot_observed_this_run":false/u);
});
