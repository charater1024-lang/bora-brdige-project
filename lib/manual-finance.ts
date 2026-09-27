export const MANUAL_FINANCE_FIELDS = [
  "cashAndDeposits",
  "investments",
  "otherAssets",
  "liabilities",
  "monthlyIncome",
  "fixedExpenses",
  "variableExpenses",
  "debtPayment",
] as const;

export type ManualFinanceField = (typeof MANUAL_FINANCE_FIELDS)[number];
export type ManualFinanceAmounts = Record<ManualFinanceField, number>;

export const EMPTY_MANUAL_FINANCE_AMOUNTS: ManualFinanceAmounts = {
  cashAndDeposits: 0,
  investments: 0,
  otherAssets: 0,
  liabilities: 0,
  monthlyIncome: 0,
  fixedExpenses: 0,
  variableExpenses: 0,
  debtPayment: 0,
};

const MAX_SAFE_AMOUNT = 1_000_000_000_000_000;

function normalizedAmount(value: unknown) {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : 0;
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(MAX_SAFE_AMOUNT, Math.round(number));
}

export function normalizeManualFinanceAmounts(
  value: unknown,
): ManualFinanceAmounts {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(MANUAL_FINANCE_FIELDS.map((field) => [
    field,
    normalizedAmount(input[field]),
  ])) as unknown as ManualFinanceAmounts;
}

export function manualFinanceSummary(value: unknown) {
  const amounts = normalizeManualFinanceAmounts(value);
  const totalAssets = amounts.cashAndDeposits + amounts.investments + amounts.otherAssets;
  const netAssets = totalAssets - amounts.liabilities;
  const monthlyOutflow = amounts.fixedExpenses
    + amounts.variableExpenses
    + amounts.debtPayment;
  const monthlyBalance = amounts.monthlyIncome - monthlyOutflow;
  const debtPaymentRatio = amounts.monthlyIncome > 0
    ? Math.min(999, (amounts.debtPayment / amounts.monthlyIncome) * 100)
    : null;
  const completedFields = MANUAL_FINANCE_FIELDS.filter((field) => amounts[field] > 0).length;
  const assetComposition = [
    { id: "cashAndDeposits" as const, value: amounts.cashAndDeposits },
    { id: "investments" as const, value: amounts.investments },
    { id: "otherAssets" as const, value: amounts.otherAssets },
  ].map((item) => ({
    ...item,
    sharePercent: totalAssets > 0 ? (item.value / totalAssets) * 100 : 0,
  }));
  const cashflowBasisTotal = monthlyBalance >= 0 && amounts.monthlyIncome > 0
    ? amounts.monthlyIncome
    : monthlyOutflow;
  const cashflow = [
    { id: "fixedExpenses" as const, value: amounts.fixedExpenses },
    { id: "variableExpenses" as const, value: amounts.variableExpenses },
    { id: "debtPayment" as const, value: amounts.debtPayment },
    { id: "available" as const, value: Math.max(0, monthlyBalance) },
  ].map((item) => ({
    ...item,
    sharePercent: cashflowBasisTotal > 0
      ? (item.value / cashflowBasisTotal) * 100
      : 0,
  }));

  return {
    amounts,
    totalAssets,
    netAssets,
    monthlyOutflow,
    monthlyBalance,
    debtPaymentRatio,
    completedFields,
    assetComposition,
    cashflowBasisTotal,
    cashflow,
  };
}

export function parseStoredManualFinance(raw: string | null) {
  if (!raw || raw.length > 20_000) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 || record.remember !== true) return null;
    return normalizeManualFinanceAmounts(record.amounts);
  } catch {
    return null;
  }
}
