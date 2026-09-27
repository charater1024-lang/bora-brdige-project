import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WORKER_FETCH_SOURCES = [
  "lib/legal/financial-law.ts",
  "lib/public-data/adapters.ts",
  "lib/public-data/kosis-employment-adapter.ts",
  "lib/public-data/seoul-commercial-adapter.ts",
  "lib/public-data/startup-adapters.ts",
  "lib/public-data/youth-adapters.ts",
];

test("provider fetches use a Cloudflare Workers-compatible redirect mode", async () => {
  for (const file of WORKER_FETCH_SOURCES) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const executableSource = source
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/\/\/.*$/gmu, "");

    assert.doesNotMatch(
      executableSource,
      /redirect\s*:\s*["']error["']/,
      `${file} must not use the unsupported Workers redirect:error mode`,
    );
    assert.match(
      executableSource,
      /redirect\s*:\s*["']manual["']/,
      `${file} must reject redirects explicitly with redirect:manual`,
    );
  }
});
