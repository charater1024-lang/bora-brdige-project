const MANUAL_FINANCE_CONTEXT_PHRASES = [
  "내 자산",
  "자산 현황",
  "순자산",
  "월 현금흐름",
  "월 현금 흐름",
  "월 소득",
  "월 수입",
  "월 지출",
  "고정 지출",
  "변동 지출",
  "월 잔액",
  "내 저축",
  "저축 계획",
  "부채 상환",
  "가계 예산",
  "내 예산",
  "my assets",
  "my net worth",
  "monthly cash flow",
  "monthly income",
  "monthly expenses",
  "fixed expenses",
  "variable expenses",
  "monthly balance",
  "my savings",
  "savings plan",
  "debt payment",
  "household budget",
  "my budget",
  "私の資産",
  "資産状況",
  "純資産",
  "毎月の収支",
  "月収",
  "月間支出",
  "固定支出",
  "変動支出",
  "貯蓄計画",
  "返済計画",
  "家計予算",
  "我的资产",
  "资产状况",
  "净资产",
  "每月现金流",
  "月收入",
  "月支出",
  "固定支出",
  "浮动支出",
  "储蓄计划",
  "还款计划",
  "家庭预算",
] as const;

/**
 * Keep sensitive manual totals out of unrelated chats. Consent in the saved
 * snapshot is necessary but not sufficient: the current user message must
 * also ask about a concrete personal money-flow topic.
 */
export function manualFinanceContextRequested(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLocaleLowerCase().slice(0, 4_000);
  if (!normalized) return false;
  return MANUAL_FINANCE_CONTEXT_PHRASES.some((phrase) =>
    normalized.includes(phrase.toLocaleLowerCase()),
  );
}
