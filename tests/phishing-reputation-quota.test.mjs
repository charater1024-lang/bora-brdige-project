import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  claimPhishingReputationLookupQuota,
  PHISHING_REPUTATION_LOOKUP_CLAIM_SQL,
  PHISHING_REPUTATION_LOOKUP_MAX_REQUESTS,
  PHISHING_REPUTATION_LOOKUP_WINDOW_MS,
  PHISHING_REPUTATION_QUOTA_RETENTION_MS,
  runPhishingReputationLookupWithQuota,
} from "../lib/phishing-reputation-quota.ts";

const TEST_PEPPER = "test-only-quota-pepper-32-characters";

function d1Adapter(database) {
  return {
    prepare(sql) {
      let values = [];
      const prepared = {
        bind(...nextValues) {
          values = nextValues;
          return prepared;
        },
        async run() {
          const result = database.prepare(sql).run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
        async first() {
          return database.prepare(sql).get(...values) ?? null;
        },
      };
      return prepared;
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

function reputationRequest(ip = "203.0.113.24") {
  return new Request("https://borabridge.example/api/phishing", {
    headers: { "cf-connecting-ip": ip },
  });
}

test("the D1 claim atomically caps one reputation subject in each window", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const migration = await readFile(
      new URL("../drizzle/0021_messy_shocker.sql", import.meta.url),
      "utf8",
    );
    database.exec(migration);
    const claim = database.prepare(PHISHING_REPUTATION_LOOKUP_CLAIM_SQL);
    const subjectHash = "a".repeat(64);
    const startedAt = 1_800_000_000_000;

    for (let index = 0; index < PHISHING_REPUTATION_LOOKUP_MAX_REQUESTS; index += 1) {
      assert.equal(claim.run(subjectHash, startedAt + index, startedAt + index).changes, 1);
    }
    assert.equal(claim.run(subjectHash, startedAt + 20_000, startedAt + 20_000).changes, 0);
    assert.equal(
      database.prepare(
        "SELECT request_count AS requestCount FROM phishing_reputation_lookup_quotas WHERE subject_hash = ?",
      ).get(subjectHash).requestCount,
      PHISHING_REPUTATION_LOOKUP_MAX_REQUESTS,
    );

    const resetAt = startedAt + PHISHING_REPUTATION_LOOKUP_WINDOW_MS;
    assert.equal(claim.run(subjectHash, resetAt, resetAt).changes, 1);
    assert.equal(
      database.prepare(
        "SELECT request_count AS requestCount FROM phishing_reputation_lookup_quotas WHERE subject_hash = ?",
      ).get(subjectHash).requestCount,
      1,
    );
  } finally {
    database.close();
  }
});

test("the reputation quota fails closed when D1 is unavailable", async () => {
  const claim = await claimPhishingReputationLookupQuota(reputationRequest(), {
    database: null,
    now: 1_800_000_000_000,
    pepper: TEST_PEPPER,
  });
  assert.deepEqual(claim, {
    allowed: false,
    reason: "storage-unavailable",
    retryAfterSeconds: 60,
  });

  let lookupCalls = 0;
  const run = await runPhishingReputationLookupWithQuota(
    reputationRequest(),
    async () => {
      lookupCalls += 1;
      return "must-not-run";
    },
    { database: null, now: 1_800_000_000_000, pepper: TEST_PEPPER },
  );
  assert.equal(run.status, "storage-unavailable");
  assert.equal(run.value, null);
  assert.equal(lookupCalls, 0);
});

test("an exhausted durable quota prevents the external lookup callback", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const d1 = d1Adapter(database);
    const request = reputationRequest();
    const now = 1_800_000_000_000;
    let lookupCalls = 0;

    for (let index = 0; index < PHISHING_REPUTATION_LOOKUP_MAX_REQUESTS; index += 1) {
      const run = await runPhishingReputationLookupWithQuota(
        request,
        async () => {
          lookupCalls += 1;
          return `provider-result-${index}`;
        },
        { database: d1, now: now + index, pepper: TEST_PEPPER },
      );
      assert.equal(run.status, "completed");
    }

    const blocked = await runPhishingReputationLookupWithQuota(
      request,
      async () => {
        lookupCalls += 1;
        return "must-not-run";
      },
      { database: d1, now: now + 10_000, pepper: TEST_PEPPER },
    );
    assert.equal(blocked.status, "quota-exhausted");
    assert.equal(blocked.value, null);
    assert.equal(blocked.retryAfterSeconds, 50);
    assert.equal(lookupCalls, PHISHING_REPUTATION_LOOKUP_MAX_REQUESTS);

    const stored = database.prepare(
      "SELECT subject_hash AS subjectHash, request_count AS requestCount FROM phishing_reputation_lookup_quotas",
    ).get();
    assert.equal(stored.requestCount, PHISHING_REPUTATION_LOOKUP_MAX_REQUESTS);
    assert.match(stored.subjectHash, /^[a-f0-9]{64}$/u);
    assert.notEqual(stored.subjectHash, "203.0.113.24");
  } finally {
    database.close();
  }
});

test("quota identifiers are keyed and stale daily buckets are deleted", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const d1 = d1Adapter(database);
    const now = 1_800_000_000_000;
    await claimPhishingReputationLookupQuota(reputationRequest(), {
      database: d1,
      now,
      pepper: TEST_PEPPER,
    });
    database.prepare(
      "INSERT INTO phishing_reputation_lookup_quotas (subject_hash, window_started_at, request_count, updated_at) VALUES (?, ?, ?, ?)",
    ).run("b".repeat(64), 1, 1, now - PHISHING_REPUTATION_QUOTA_RETENTION_MS - 1);

    await claimPhishingReputationLookupQuota(reputationRequest("203.0.113.25"), {
      database: d1,
      now: now + 10 * 60_000,
      pepper: TEST_PEPPER,
    });
    assert.equal(
      database.prepare(
        "SELECT COUNT(*) AS count FROM phishing_reputation_lookup_quotas WHERE subject_hash = ?",
      ).get("b".repeat(64)).count,
      0,
    );
    const stored = database.prepare(
      "SELECT subject_hash AS subjectHash FROM phishing_reputation_lookup_quotas ORDER BY updated_at LIMIT 1",
    ).get();
    assert.match(stored.subjectHash, /^[a-f0-9]{64}$/u);
    assert.notEqual(stored.subjectHash, "203.0.113.24");
  } finally {
    database.close();
  }
});

test("missing keyed-hash material fails closed before lookup", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    let lookupCalls = 0;
    const run = await runPhishingReputationLookupWithQuota(
      reputationRequest(),
      async () => {
        lookupCalls += 1;
        return "must-not-run";
      },
      { database: d1Adapter(database), now: 1_800_000_000_000 },
    );
    assert.equal(run.status, "storage-unavailable");
    assert.equal(lookupCalls, 0);
  } finally {
    database.close();
  }
});

test("the claim is a single conditional UPSERT without a check-then-write SELECT", () => {
  assert.match(PHISHING_REPUTATION_LOOKUP_CLAIM_SQL, /^INSERT INTO phishing_reputation_lookup_quotas/u);
  assert.match(PHISHING_REPUTATION_LOOKUP_CLAIM_SQL, /ON CONFLICT\(subject_hash\) DO UPDATE/u);
  assert.match(PHISHING_REPUTATION_LOOKUP_CLAIM_SQL, /request_count < 6/u);
  assert.doesNotMatch(PHISHING_REPUTATION_LOOKUP_CLAIM_SQL, /SELECT/u);
});
