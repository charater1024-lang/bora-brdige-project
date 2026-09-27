import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  server: { middlewareMode: true },
});
const { buildDailyFinanceGuide } = await server.ssrLoadModule("/lib/daily-finance-guide.ts");

test.after(async () => {
  await server.close();
});

const now = Date.parse("2026-07-28T12:00:00.000Z");
const completeProfile = {
  enabled: true,
  birthYear: 1998,
  region: "seoul",
  status: "employed",
  interests: ["asset_building", "finance"],
};
const amounts = {
  cashAndDeposits: 1_000_000,
  investments: 0,
  otherAssets: 0,
  liabilities: 0,
  monthlyIncome: 2_500_000,
  fixedExpenses: 900_000,
  variableExpenses: 600_000,
  debtPayment: 0,
};

test("daily guide completes only verified account-backed actions", () => {
  const guide = buildDailyFinanceGuide({
    authenticated: true,
    snapshot: {
      version: 1,
      amounts,
      useForAi: false,
      updatedAt: Date.parse("2026-07-28T01:00:00.000Z"),
    },
    youthPolicyProfile: completeProfile,
    unreadOfficialItems: 0,
    publicDataAvailable: true,
    now,
  });

  assert.equal(guide.completedCount, 3);
  assert.equal(guide.totalCount, 3);
  assert.deepEqual(guide.tasks.map((task) => task.reason), [
    "completed-today",
    "profile-ready",
    "nothing-unread",
  ]);
});

test("old finance values, incomplete profile and unread records become recommendations", () => {
  const guide = buildDailyFinanceGuide({
    authenticated: true,
    snapshot: {
      version: 1,
      amounts,
      useForAi: false,
      updatedAt: Date.parse("2026-07-26T10:00:00.000Z"),
    },
    youthPolicyProfile: {
      ...completeProfile,
      status: null,
    },
    unreadOfficialItems: 7,
    publicDataAvailable: true,
    now,
  });

  assert.equal(guide.completedCount, 0);
  assert.deepEqual(guide.tasks.map((task) => [task.id, task.state, task.reason]), [
    ["finance-review", "attention", "finance-entry-needed"],
    ["profile-setup", "attention", "profile-incomplete"],
    ["official-updates", "attention", "unread-items"],
  ]);
  assert.equal(guide.tasks[2].count, 7);
});

test("anonymous guide does not claim that account actions are complete", () => {
  const guide = buildDailyFinanceGuide({
    authenticated: false,
    snapshot: null,
    youthPolicyProfile: null,
    unreadOfficialItems: 0,
    publicDataAvailable: true,
    now,
  });

  assert.equal(guide.completedCount, 0);
  assert.ok(guide.tasks.every((task) => task.reason === "sign-in-required"));
});
