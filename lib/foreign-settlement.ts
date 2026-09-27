export const FOREIGN_SETTLEMENT_BUDGET_FIELDS = [
  "monthlyIncome",
  "housing",
  "food",
  "transport",
  "telecom",
  "insurance",
  "remittance",
  "other",
] as const;

export const FOREIGN_SETTLEMENT_EXPENSE_FIELDS = [
  "housing",
  "food",
  "transport",
  "telecom",
  "insurance",
  "remittance",
  "other",
] as const;

export const FOREIGN_SETTLEMENT_GUIDE_STEP_IDS = [
  "identity",
  "account",
  "telecom",
  "taxInsurance",
  "remittanceSafety",
] as const;

export type ForeignSettlementBudgetField =
  (typeof FOREIGN_SETTLEMENT_BUDGET_FIELDS)[number];
export type ForeignSettlementExpenseField =
  (typeof FOREIGN_SETTLEMENT_EXPENSE_FIELDS)[number];
export type ForeignSettlementGuideStepId =
  (typeof FOREIGN_SETTLEMENT_GUIDE_STEP_IDS)[number];
export type ForeignSettlementBudget =
  Record<ForeignSettlementBudgetField, number>;

export const EMPTY_FOREIGN_SETTLEMENT_BUDGET: ForeignSettlementBudget = {
  monthlyIncome: 0,
  housing: 0,
  food: 0,
  transport: 0,
  telecom: 0,
  insurance: 0,
  remittance: 0,
  other: 0,
};

const MAX_SAFE_MONTHLY_AMOUNT = 1_000_000_000_000;

function normalizeAmount(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.replaceAll(",", ""))
      : 0;

  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(MAX_SAFE_MONTHLY_AMOUNT, Math.round(parsed));
}

export function normalizeForeignSettlementBudget(
  value: unknown,
): ForeignSettlementBudget {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return Object.fromEntries(
    FOREIGN_SETTLEMENT_BUDGET_FIELDS.map((field) => [
      field,
      normalizeAmount(input[field]),
    ]),
  ) as unknown as ForeignSettlementBudget;
}

export function foreignSettlementBudgetSummary(value: unknown) {
  const amounts = normalizeForeignSettlementBudget(value);
  const totalExpenses = FOREIGN_SETTLEMENT_EXPENSE_FIELDS.reduce(
    (total, field) => total + amounts[field],
    0,
  );
  const remaining = amounts.monthlyIncome - totalExpenses;
  const expenseRatio = amounts.monthlyIncome > 0
    ? Math.min(999, (totalExpenses / amounts.monthlyIncome) * 100)
    : null;
  const completedFields = FOREIGN_SETTLEMENT_BUDGET_FIELDS.filter(
    (field) => amounts[field] > 0,
  ).length;

  return {
    amounts,
    totalExpenses,
    remaining,
    expenseRatio,
    completedFields,
    hasAnyInput: completedFields > 0,
    hasExpenseInput: totalExpenses > 0,
    expenses: FOREIGN_SETTLEMENT_EXPENSE_FIELDS.map((field) => ({
      id: field,
      value: amounts[field],
      share: totalExpenses > 0 ? (amounts[field] / totalExpenses) * 100 : 0,
    })),
  };
}
