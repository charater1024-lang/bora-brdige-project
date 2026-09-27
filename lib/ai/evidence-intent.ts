const FINANCIAL_OR_POLICY_SIGNAL = /(?:금융|금리|예금|적금|대출|부채|투자|주식|펀드|ETF|보험|연금|세금|환율|환전|송금|물가|예산|저축|신용|지원금|장학금|정책|공고|취업|고용|상권|창업|finance|financial|interest\s+rate|deposit|savings?|loan|debt|invest|stock|fund|insurance|pension|tax|exchange\s+rate|remittance|inflation|budget|credit|grant|scholarship|policy|employment|commercial\s+district|startup|金融|金利|預金|ローン|投資|保険|年金|税金|為替|物価|政策|雇用|創業|利率|存款|贷款|投资|保险|养老金|税费|汇率|通胀|政策|就业|创业)/iu;

/** Harmless general chat may skip retrieval; financial and policy claims may not. */
export function evidenceRequiredForAiQuery(query: string) {
  return FINANCIAL_OR_POLICY_SIGNAL.test(query.normalize("NFKC"));
}
