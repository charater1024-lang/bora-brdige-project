import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public health response is minimal while authenticated developers receive details", async () => {
  const route = await readFile(new URL("../app/api/health/route.ts", import.meta.url), "utf8");

  assert.match(route, /authenticatedDeveloper\(request\)/u);
  assert.match(route, /developer\s*\?\s*\{/u);
  assert.match(route, /:\s*\{\s*status\s*\}/u);
  assert.match(route, /Vary:\s*"Cookie"/u);
  assert.match(route, /providers/u);
});
