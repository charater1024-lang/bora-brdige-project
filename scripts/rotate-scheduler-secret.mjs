import { randomBytes } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

const requestedFiles = process.argv.slice(2);
const allowedNames = new Set([".env.local", ".env.scheduler"]);

if (
  process.env.BORA_CONFIRM_SCHEDULER_SECRET_ROTATION !== "yes"
  || requestedFiles.length !== 2
  || requestedFiles.some((file) => !allowedNames.has(basename(file)))
) {
  console.error(
    "Usage: BORA_CONFIRM_SCHEDULER_SECRET_ROTATION=yes node "
    + "scripts/rotate-scheduler-secret.mjs .env.local .env.scheduler",
  );
  process.exitCode = 2;
} else {
  const secret = randomBytes(32).toString("hex");
  const updated = [];
  for (const requestedFile of requestedFiles) {
    const file = resolve(requestedFile);
    const original = readFileSync(file, "utf8");
    const next = /^SCHEDULER_SECRET=.*$/mu.test(original)
      ? original.replace(/^SCHEDULER_SECRET=.*$/mu, `SCHEDULER_SECRET=${secret}`)
      : `${original.replace(/\s*$/u, "")}\nSCHEDULER_SECRET=${secret}\n`;
    const temporary = resolve(dirname(file), `.${basename(file)}.scheduler-rotate-${process.pid}`);
    writeFileSync(temporary, next, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, file);
    chmodSync(file, 0o600);
    updated.push(basename(file));
  }
  console.log(JSON.stringify({ rotated: true, updated }));
}
