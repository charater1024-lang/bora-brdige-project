import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EMPTY_MANUAL_FINANCE_AMOUNTS,
  manualFinanceSummary,
  normalizeManualFinanceAmounts,
  parseStoredManualFinance,
} from "../lib/manual-finance.ts";

test("manual finance starts with truthful zero values and no example data", () => {
  const result = manualFinanceSummary({});
  assert.deepEqual(result.amounts, EMPTY_MANUAL_FINANCE_AMOUNTS);
  assert.equal(result.totalAssets, 0);
  assert.equal(result.netAssets, 0);
  assert.equal(result.monthlyBalance, 0);
  assert.equal(result.completedFields, 0);
});

test("manual finance derives net worth and a deficit only from entered values", () => {
  const result = manualFinanceSummary({
    cashAndDeposits: 10_000_000,
    investments: 5_000_000,
    otherAssets: 1_000_000,
    liabilities: 4_000_000,
    monthlyIncome: 3_000_000,
    fixedExpenses: 1_500_000,
    variableExpenses: 900_000,
    debtPayment: 800_000,
  });
  assert.equal(result.totalAssets, 16_000_000);
  assert.equal(result.netAssets, 12_000_000);
  assert.equal(result.monthlyOutflow, 3_200_000);
  assert.equal(result.monthlyBalance, -200_000);
  assert.equal(result.cashflowBasisTotal, 3_200_000);
  assert.equal(result.cashflow.find((item) => item.id === "available")?.value, 0);
  assert.ok(Math.abs(
    result.cashflow.reduce((total, item) => total + item.sharePercent, 0) - 100,
  ) < 0.000_001);
  assert.ok(Math.abs(
    result.assetComposition.reduce((total, item) => total + item.sharePercent, 0) - 100,
  ) < 0.000_001);
  assert.equal(Math.round(result.debtPaymentRatio), 27);
});

test("a surplus cashflow composition allocates the full income including available money", () => {
  const result = manualFinanceSummary({
    monthlyIncome: 4_000_000,
    fixedExpenses: 1_500_000,
    variableExpenses: 800_000,
    debtPayment: 200_000,
  });

  assert.equal(result.cashflowBasisTotal, 4_000_000);
  assert.equal(result.cashflow.find((item) => item.id === "available")?.value, 1_500_000);
  assert.ok(Math.abs(
    result.cashflow.reduce((total, item) => total + item.sharePercent, 0) - 100,
  ) < 0.000_001);
});

test("invalid, negative, and oversized manual values are bounded", () => {
  const result = normalizeManualFinanceAmounts({
    cashAndDeposits: -1,
    investments: Number.POSITIVE_INFINITY,
    otherAssets: "not-a-number",
    liabilities: 2_000_000_000_000_000,
  });
  assert.equal(result.cashAndDeposits, 0);
  assert.equal(result.investments, 0);
  assert.equal(result.otherAssets, 0);
  assert.equal(result.liabilities, 1_000_000_000_000_000);
});

test("device storage accepts only the explicit versioned opt-in shape", () => {
  assert.equal(parseStoredManualFinance(null), null);
  assert.equal(parseStoredManualFinance('{"version":1,"remember":false,"amounts":{"cashAndDeposits":10}}'), null);
  assert.deepEqual(
    parseStoredManualFinance('{"version":1,"remember":true,"amounts":{"cashAndDeposits":1000}}'),
    { ...EMPTY_MANUAL_FINANCE_AMOUNTS, cashAndDeposits: 1_000 },
  );
  assert.equal(parseStoredManualFinance("{broken"), null);
});

test("the signed-in workbook uses the authenticated snapshot contract safely", () => {
  const source = readFileSync(
    new URL("../app/components/personal-asset-workbook.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /fetch\("\/api\/finance\/snapshot",\s*\{\s*cache: "no-store"/u);
  assert.match(source, /method: "PUT"[\s\S]*version: 1,[\s\S]*amounts,[\s\S]*useForAi:/u);
  assert.match(source, /method: "DELETE"/u);
  assert.match(source, /authState !== "signed-in" \|\| !initialLoadResolved/u);
  assert.match(source, /typeof nestedUpdatedAt === "number"[\s\S]*Number\.isSafeInteger\(nestedUpdatedAt\)/u);
  assert.doesNotMatch(source, /localStorage\.getItem|legacySource.*"device"/u);
  assert.match(source, /discardUnboundLegacyFinance[\s\S]*localStorage\.removeItem\(STORAGE_KEY\)/u);
  assert.doesNotMatch(source, /localStorage\.setItem/u);
  assert.match(source, /const ANONYMOUS_DRAFT_KEY = "bora-anonymous-finance-draft-v1"/u);
  assert.match(source, /window\.sessionStorage\.setItem\(ANONYMOUS_DRAFT_KEY/u);
  assert.match(source, /window\.sessionStorage\.getItem\(ANONYMOUS_DRAFT_KEY\)/u);
  assert.match(source, /principalKey: string \| null/u);
  assert.match(source, /claimAnonymousDraft\(expectedPrincipal\)/u);
  assert.match(source, /response\.status === 401[\s\S]*enterAnonymousMode\(\)/u);
  assert.doesNotMatch(source, /response\.status === 401[\s\S]{0,120}writeAnonymousDraft\(inputsRef\.current\)/u);
  assert.match(source, /principalUserId: string \| null/u);
  assert.match(source, /sessionExpiresAt: number \| string \| null/u);
  assert.match(source, /activePrincipalRef\.current !== expectedPrincipal/u);
  assert.match(source, /expiresAt - Date\.now\(\)[\s\S]*enterAnonymousMode\(\)/u);
  assert.match(source, /window\.addEventListener\("focus", revalidate\)/u);
  assert.match(source, /document\.addEventListener\("visibilitychange", revalidateWhenVisible\)/u);
  assert.match(source, /loadSnapshot\(principalUserId, "validate"\)/u);
  assert.match(source, /if \(mode === "validate"\) return;[\s\S]*const nextInputs/u);
  assert.match(source, /onClick=\{preserveDraftBeforeSignIn\}/u);
  assert.match(source, /legacyImportedRef\.current[\s\S]*discardUnboundLegacyFinance\(\)/u);
  assert.match(source, /sharePercent\.toFixed\(1\).*%/u);
});
