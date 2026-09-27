import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  AI_RATE_LIMIT_CLAIM_SQL,
  AI_RATE_LIMIT_MAX_REQUESTS,
  AI_RATE_LIMIT_WINDOW_MS,
} from "../lib/ai/rate-limit.ts";

test("the D1-compatible claim atomically caps each user at ten requests per minute", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("CREATE TABLE oauth_users (id TEXT PRIMARY KEY NOT NULL)");
    database.prepare("INSERT INTO oauth_users (id) VALUES (?)").run("user-1");
    const migration = await readFile(new URL("../drizzle/0009_ai_user_rate_limit.sql", import.meta.url), "utf8");
    database.exec(migration);
    const claim = database.prepare(AI_RATE_LIMIT_CLAIM_SQL);
    const startedAt = 1_800_000_000_000;

    for (let index = 0; index < AI_RATE_LIMIT_MAX_REQUESTS; index += 1) {
      assert.equal(claim.run("user-1", startedAt + index, startedAt + index).changes, 1);
    }
    assert.equal(claim.run("user-1", startedAt + 10_000, startedAt + 10_000).changes, 0);
    assert.equal(
      database.prepare("SELECT request_count AS requestCount FROM ai_user_rate_limits WHERE user_id = ?")
        .get("user-1").requestCount,
      AI_RATE_LIMIT_MAX_REQUESTS,
    );

    const resetAt = startedAt + AI_RATE_LIMIT_WINDOW_MS;
    assert.equal(claim.run("user-1", resetAt, resetAt).changes, 1);
    assert.equal(
      database.prepare("SELECT request_count AS requestCount FROM ai_user_rate_limits WHERE user_id = ?")
        .get("user-1").requestCount,
      1,
    );
  } finally {
    database.close();
  }
});

test("AI authentication and rate limiting precede provider, RAG, and memory work", async () => {
  const route = await readFile(new URL("../app/api/ai/route.ts", import.meta.url), "utf8");
  const authIndex = route.indexOf("authenticatedUser(request)");
  const claimIndex = route.indexOf("claimAiRequestRateLimit(user.id)");
  assert.ok(authIndex >= 0);
  assert.ok(claimIndex > authIndex);
  for (const protectedOperation of ["selectedAiRuntime()", "searchKnowledge(", "getAiUserMemories(", "generateAICompletion("]) {
    assert.ok(route.indexOf(protectedOperation) > claimIndex, `${protectedOperation} must run after the rate-limit claim`);
  }
  assert.match(route, /ai_rate_limit_unavailable[\s\S]*503/u);
  assert.match(route, /ai_rate_limit_exceeded[\s\S]*429[\s\S]*Retry-After/u);
});

test("the rate-limit claim is one conditional UPSERT rather than a check-then-write sequence", () => {
  assert.match(AI_RATE_LIMIT_CLAIM_SQL, /^INSERT INTO ai_user_rate_limits/u);
  assert.match(AI_RATE_LIMIT_CLAIM_SQL, /ON CONFLICT\(user_id\) DO UPDATE/u);
  assert.match(AI_RATE_LIMIT_CLAIM_SQL, /request_count < 10/u);
  assert.doesNotMatch(AI_RATE_LIMIT_CLAIM_SQL, /SELECT/u);
});
