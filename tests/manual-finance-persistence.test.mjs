import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { createServer } from "vite";

let modulePromise;

async function snapshotModule() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const server = await createServer({
        root: fileURLToPath(new URL("..", import.meta.url)),
        configFile: false,
        appType: "custom",
        logLevel: "silent",
        server: { middlewareMode: true },
      });
      return {
        server,
        snapshot: await server.ssrLoadModule("/lib/manual-finance-snapshot.ts"),
      };
    })();
  }
  return (await modulePromise).snapshot;
}

after(async () => {
  if (modulePromise) await (await modulePromise).server.close();
});

const amounts = {
  cashAndDeposits: 1_000_000,
  investments: 2_000_000,
  otherAssets: 0,
  liabilities: 500_000,
  monthlyIncome: 3_000_000,
  fixedExpenses: 1_000_000,
  variableExpenses: 700_000,
  debtPayment: 100_000,
};

test("manual finance persistence accepts only a complete versioned numeric snapshot", async () => {
  const {
    parseManualFinanceSnapshotInput,
    parseStoredManualFinanceSnapshot,
  } = await snapshotModule();
  assert.deepEqual(parseManualFinanceSnapshotInput({ version: 1, amounts }), {
    version: 1,
    amounts,
    useForAi: false,
  });
  assert.deepEqual(parseManualFinanceSnapshotInput({ version: 1, amounts, useForAi: true }), {
    version: 1,
    amounts,
    useForAi: true,
  });
  assert.deepEqual(
    parseStoredManualFinanceSnapshot(JSON.stringify({
      version: 1,
      amounts,
      useForAi: true,
    }), 1_800_000_000_000),
    { version: 1, amounts, useForAi: true, updatedAt: 1_800_000_000_000 },
  );
});

test("manual finance persistence rejects identifiers, notes, coercion and invalid ranges", async () => {
  const {
    MAX_MANUAL_FINANCE_AMOUNT,
    parseManualFinanceSnapshotInput,
  } = await snapshotModule();
  for (const invalid of [
    { version: 1, amounts: { ...amounts, accountNumber: "123-456" } },
    { version: 1, amounts: { ...amounts, monthlyIncome: "3000000" } },
    { version: 1, amounts: { ...amounts, monthlyIncome: -1 } },
    { version: 1, amounts: { ...amounts, monthlyIncome: 1.5 } },
    { version: 1, amounts: { ...amounts, monthlyIncome: MAX_MANUAL_FINANCE_AMOUNT + 1 } },
    { version: 1, amounts, note: "private note" },
    { version: 1, amounts, useForAi: "yes" },
    { version: 2, amounts },
  ]) {
    assert.throws(() => parseManualFinanceSnapshotInput(invalid));
  }
});

test("AI context is bounded and emitted only after explicit consent", async () => {
  const {
    MAX_MANUAL_FINANCE_AI_CONTEXT_CHARS,
    manualFinanceAiContext,
  } = await snapshotModule();
  const base = {
    version: 1,
    amounts,
    updatedAt: 1_800_000_000_000,
  };
  assert.equal(manualFinanceAiContext({ ...base, useForAi: false }), null);
  const context = manualFinanceAiContext({ ...base, useForAi: true });
  assert.ok(context);
  assert.ok(context.length <= MAX_MANUAL_FINANCE_AI_CONTEXT_CHARS);
  assert.match(context, /User-consented/u);
  assert.match(context, /monthlyIncome=3000000/u);
  assert.match(context, /not verified by a financial institution/u);
});

test("manual finance migration enforces one bounded, cascading snapshot per user", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("CREATE TABLE oauth_users (id TEXT PRIMARY KEY NOT NULL)");
    database.exec("INSERT INTO oauth_users (id) VALUES ('user-1'), ('user-2')");
    const migration = await readFile(
      new URL("../drizzle/0013_user_finance_snapshot.sql", import.meta.url),
      "utf8",
    );
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
    const insert = database.prepare(`INSERT INTO user_finance_snapshots
      (user_id, schema_version, snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)`);
    insert.run("user-1", 1, JSON.stringify({ version: 1, amounts }), 1, 1);
    assert.throws(
      () => insert.run("user-1", 1, JSON.stringify({ version: 1, amounts }), 1, 1),
      /UNIQUE constraint failed/u,
    );
    assert.throws(
      () => insert.run("user-2", 2, JSON.stringify({ version: 2, amounts }), 1, 1),
      /CHECK constraint failed/u,
    );
    assert.throws(
      () => insert.run("user-2", 1, "x".repeat(2_049), 1, 1),
      /CHECK constraint failed/u,
    );
    database.exec("DELETE FROM oauth_users WHERE id = 'user-1'");
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM user_finance_snapshots").get().count,
      0,
    );
  } finally {
    database.close();
  }
});

test("Drizzle metadata records the same finance snapshot constraints as the migration", async () => {
  const [journal, snapshot] = await Promise.all([
    readFile(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../drizzle/meta/0013_snapshot.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.ok(journal.entries.some((entry) => entry.tag === "0013_user_finance_snapshot"));
  const table = snapshot.tables.user_finance_snapshots;
  assert.ok(table);
  assert.equal(
    table.checkConstraints.user_finance_snapshots_version_check.value,
    "\"user_finance_snapshots\".\"schema_version\" = 1",
  );
  assert.equal(
    table.checkConstraints.user_finance_snapshots_payload_size_check.value,
    "length(\"user_finance_snapshots\".\"snapshot_json\") <= 2048",
  );
});

test("finance snapshot route is session-bound, same-origin and JSON-only", async () => {
  const [route, store] = await Promise.all([
    readFile(new URL("../app/api/finance/snapshot/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/manual-finance-store.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /authenticatedUser\(request\)/u);
  assert.doesNotMatch(route, /authenticatedUser\(request\)\.catch\(\(\) => null\)/u);
  assert.match(route, /finance_snapshot_unavailable" \}, 503/u);
  assert.match(route, /await requireSameOrigin\(request\)/u);
  assert.match(route, /application\/json/u);
  assert.match(route, /saveManualFinanceSnapshot\(user\.id, input\)/u);
  assert.match(route, /deleteManualFinanceSnapshot\(user\.id\)/u);
  assert.doesNotMatch(route, /body\.userId|input\.userId|console\./u);
  assert.match(store, /WHERE user_id = \?/u);
  assert.match(store, /\.bind\(userId\)/u);
  assert.match(store, /ON CONFLICT\(user_id\) DO UPDATE/u);
  assert.match(store, /getManualFinanceAiContext/u);
  assert.doesNotMatch(store, /console\./u);
});
