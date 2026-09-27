import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EMPTY_FOREIGN_SETTLEMENT_BUDGET,
  FOREIGN_SETTLEMENT_GUIDE_STEP_IDS,
  foreignSettlementBudgetSummary,
  normalizeForeignSettlementBudget,
} from "../lib/foreign-settlement.ts";

const componentSource = await readFile(
  new URL("../app/components/foreign-settlement-copilot.tsx", import.meta.url),
  "utf8",
);

test("foreign settlement guide has the five required stages in a stable order", () => {
  assert.deepEqual(FOREIGN_SETTLEMENT_GUIDE_STEP_IDS, [
    "identity",
    "account",
    "telecom",
    "taxInsurance",
    "remittanceSafety",
  ]);
  assert.equal(new Set(FOREIGN_SETTLEMENT_GUIDE_STEP_IDS).size, 5);
});

test("foreign settlement UI keeps data local and exposes guide alternatives", () => {
  assert.doesNotMatch(
    componentSource,
    /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|sendBeacon)\b/,
  );
  assert.match(componentSource, /className=\{styles\.journeyMap\}/);
  assert.match(componentSource, /className=\{styles\.documentComparison\}/);
  assert.match(componentSource, /className=\{styles\.resourcePreview\}/);
  assert.match(componentSource, /guideCopy = \{\s*ko:/);
  assert.match(componentSource, /\n  en: \{/);
  assert.match(componentSource, /\n  ja: \{/);
  assert.match(componentSource, /\n  zh: \{/);
  assert.match(componentSource, /<h1 id=\{`\$\{baseId\}-title`\}>\{t\.title\}<\/h1>/u);
  assert.match(componentSource, /value=\{formatAmountInput\(amountInputs\[field\], locale\)\}/u);
  assert.match(componentSource, /new Intl\.NumberFormat\(localeTags\[locale\]/u);
});

test("foreign settlement budget starts with truthful zeros and no chart data", () => {
  const result = foreignSettlementBudgetSummary({});

  assert.deepEqual(result.amounts, EMPTY_FOREIGN_SETTLEMENT_BUDGET);
  assert.equal(result.totalExpenses, 0);
  assert.equal(result.remaining, 0);
  assert.equal(result.expenseRatio, null);
  assert.equal(result.completedFields, 0);
  assert.equal(result.hasAnyInput, false);
  assert.equal(result.hasExpenseInput, false);
  assert.ok(result.expenses.every((item) => item.value === 0 && item.share === 0));
});

test("foreign settlement budget derives totals only from user-entered values", () => {
  const result = foreignSettlementBudgetSummary({
    monthlyIncome: "3,000,000",
    housing: 900_000,
    food: 500_000,
    transport: 100_000,
    telecom: 50_000,
    insurance: 150_000,
    remittance: 300_000,
    other: 200_000,
  });

  assert.equal(result.totalExpenses, 2_200_000);
  assert.equal(result.remaining, 800_000);
  assert.equal(Math.round(result.expenseRatio), 73);
  assert.equal(result.completedFields, 8);
  assert.equal(result.hasAnyInput, true);
  assert.equal(result.hasExpenseInput, true);
  assert.equal(Math.round(result.expenses[0].share), 41);
});

test("invalid, negative, and oversized values are safely bounded", () => {
  const result = normalizeForeignSettlementBudget({
    monthlyIncome: -1,
    housing: Number.POSITIVE_INFINITY,
    food: "not-a-number",
    transport: 2_000_000_000_000,
  });

  assert.equal(result.monthlyIncome, 0);
  assert.equal(result.housing, 0);
  assert.equal(result.food, 0);
  assert.equal(result.transport, 1_000_000_000_000);
});
