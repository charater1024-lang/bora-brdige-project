import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptPath = fileURLToPath(new URL("../scripts/rotate-scheduler-secret.mjs", import.meta.url));

test("scheduler secret rotation updates both private files without printing the secret", () => {
  const directory = mkdtempSync(join(tmpdir(), "bora-scheduler-"));
  const local = join(directory, ".env.local");
  const scheduler = join(directory, ".env.scheduler");
  writeFileSync(local, "AUTH_MODE=external\nSCHEDULER_SECRET=old-local\n");
  writeFileSync(scheduler, "SCHEDULER_SECRET=old-scheduler\n");

  const denied = spawnSync(process.execPath, [scriptPath, local, scheduler]);
  assert.equal(denied.status, 2);

  const completed = spawnSync(process.execPath, [scriptPath, local, scheduler], {
    env: { ...process.env, BORA_CONFIRM_SCHEDULER_SECRET_ROTATION: "yes" },
    encoding: "utf8",
  });
  assert.equal(completed.status, 0, completed.stderr);
  const output = JSON.parse(completed.stdout);
  assert.deepEqual(output, {
    rotated: true,
    updated: [".env.local", ".env.scheduler"],
  });

  const localSecret = readFileSync(local, "utf8").match(/^SCHEDULER_SECRET=(.+)$/mu)?.[1];
  const schedulerSecret = readFileSync(scheduler, "utf8").match(/^SCHEDULER_SECRET=(.+)$/mu)?.[1];
  assert.equal(localSecret, schedulerSecret);
  assert.match(localSecret, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(completed.stdout, new RegExp(localSecret, "u"));
});
