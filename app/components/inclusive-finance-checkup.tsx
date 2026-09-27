"use client";

import {
  ExternalLink,
  Landmark,
  RotateCcw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import type { PublicInformationLocale } from "./public-information-layout";
import styles from "./inclusive-finance-checkup.module.css";

type AmountKey =
  | "monthlyIncome"
  | "fixedExpenses"
  | "variableExpenses"
  | "debtPayment"
  | "emergencySavings";

type AmountState = Record<AmountKey, string>;

const emptyAmounts: AmountState = {
  monthlyIncome: "",
  fixedExpenses: "",
  variableExpenses: "",
  debtPayment: "",
  emergencySavings: "",
};

const localeTags: Record<PublicInformationLocale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const copy = {
  ko: {
    eyebrow: "직접 입력으로 시작",
    title: "내 손으로 확인하는 월간 금융 건강",
    lead: "대략적인 금액만 입력해도 소비 구조와 준비할 순서를 확인할 수 있어요.",
    privacyTitle: "이 브라우저 안에서만 계산해요",
    privacyBody: "입력한 금액은 저장하거나 서버로 전송하지 않습니다. 이름, 계좌번호, 카드번호는 입력하지 마세요.",
    inputTitle: "월간 금액 입력",
    inputHint: "정확한 금액이 부담스럽다면 반올림한 금액을 입력해도 됩니다.",
    monthlyIncome: "월 소득",
    monthlyIncomeHelp: "세금 등을 제외하고 실제로 사용할 수 있는 월평균 금액",
    fixedExpenses: "고정 지출",
    fixedExpensesHelp: "주거비, 통신비, 보험료처럼 매달 반복되는 금액",
    variableExpenses: "변동 지출",
    variableExpensesHelp: "식비, 교통비, 쇼핑처럼 달마다 달라지는 금액",
    debtPayment: "월 부채 상환",
    debtPaymentHelp: "대출 원금과 이자를 포함해 매달 갚는 금액",
    emergencySavings: "현재 비상자금",
    emergencySavingsHelp: "갑작스러운 지출에 바로 사용할 수 있는 현금성 자금",
    won: "원",
    clear: "입력 초기화",
    resultTitle: "입력값으로 계산한 결과",
    resultLead: "아래 수치는 금융기관의 심사 결과가 아닌 간단한 생활비 점검입니다.",
    chartTitle: "월간 현금흐름 구성",
    chartEmptyTitle: "소득이나 지출을 입력하면 그래프가 나타나요",
    chartEmptyBody: "예시 데이터는 표시하지 않습니다. 월 소득·지출·부채 상환 중 하나 이상을 입력해 주세요.",
    fixed: "고정 지출",
    variable: "변동 지출",
    debt: "부채 상환",
    available: "저축·가용 잔액",
    deficit: "월 부족액",
    amount: "금액",
    savingsCapacity: "저축·가용 여력",
    debtRatio: "부채 상환 비율",
    emergencyMonths: "비상자금",
    monthUnit: "개월",
    noIncome: "소득 입력 필요",
    expensesNeeded: "생활비 입력 필요",
    interpretationTitle: "쉽게 읽는 다음 순서",
    interpretationEmpty: "월 소득과 지출을 입력하면 지금 먼저 살펴볼 항목을 알려드려요.",
    negativeBalance: "지출과 부채 상환이 소득보다 {amount} 많아요. 먼저 반복 지출과 상환 일정을 함께 확인해 보세요.",
    lowBalance: "소득의 {rate}%가 남아요. 작은 금액이라도 비상자금을 먼저 분리하면 갑작스러운 지출에 대비하기 쉬워요.",
    healthyBalance: "소득의 {rate}%를 저축하거나 다른 목적에 사용할 수 있어요. 실제 결제 내역과 차이가 없는지 한 번 더 확인해 보세요.",
    highDebt: "월 소득의 {rate}%가 부채 상환에 쓰여요. 추가 대출보다 공공 상담을 통해 상환 부담을 먼저 점검해 보세요.",
    mediumDebt: "월 소득의 {rate}%가 부채 상환에 쓰여요. 금리와 만기, 중도상환 조건을 함께 확인해 보세요.",
    lowDebt: "월 소득 대비 부채 상환 비율은 {rate}%예요.",
    emergencyNone: "비상자금이 아직 없거나 생활비를 입력하지 않았어요. 가능하다면 1개월 생활비부터 목표로 잡아 보세요.",
    emergencyLow: "비상자금은 현재 생활비 약 {months}개월분이에요. 우선 1개월분, 다음으로 3개월분을 차근차근 준비해 보세요.",
    emergencyReady: "비상자금은 현재 생활비 약 {months}개월분이에요. 사용 목적과 보관 계좌를 구분해 두면 관리하기 쉬워요.",
    officialHelpTitle: "필요할 때 확인할 공식 도움",
    officialHelpLead: "상품 가입이나 계약 전에 공식 기관의 최신 안내와 조건을 직접 확인하세요.",
    kinfa: "서민금융진흥원",
    kinfaBody: "서민금융 상품과 금융생활 상담",
    fine: "금융감독원 FINE",
    fineBody: "금융상품·금융회사·소비자 정보 확인",
    ccrs: "신용회복위원회",
    ccrsBody: "채무조정 제도와 신용·채무 상담",
    disclaimer: "이 결과는 사용자가 입력한 금액을 단순 계산한 참고 정보이며, 신용평가·대출심사·투자 또는 계약 권유가 아닙니다.",
  },
  en: {
    eyebrow: "Start with your own entries",
    title: "A monthly money check you control",
    lead: "Enter approximate amounts to see your spending structure and a practical order of action.",
    privacyTitle: "Calculated only in this browser",
    privacyBody: "Your entries are not saved or sent to a server. Never enter a name, account number or card number.",
    inputTitle: "Enter monthly amounts",
    inputHint: "Rounded amounts are fine if exact figures feel uncomfortable.",
    monthlyIncome: "Monthly take-home income",
    monthlyIncomeHelp: "Average amount you can actually use after tax and deductions",
    fixedExpenses: "Fixed expenses",
    fixedExpensesHelp: "Recurring costs such as housing, mobile service and insurance",
    variableExpenses: "Variable expenses",
    variableExpensesHelp: "Costs that change, such as food, transport and shopping",
    debtPayment: "Monthly debt payment",
    debtPaymentHelp: "Principal and interest paid each month",
    emergencySavings: "Emergency savings now",
    emergencySavingsHelp: "Cash-like funds available for an unexpected expense",
    won: "KRW",
    clear: "Clear entries",
    resultTitle: "Results from your entries",
    resultLead: "This is a simple household check, not a financial institution's assessment.",
    chartTitle: "Monthly cash-flow composition",
    chartEmptyTitle: "Enter income or an outflow to see the chart",
    chartEmptyBody: "No sample data is shown. Enter income, spending or a debt payment above.",
    fixed: "Fixed expenses",
    variable: "Variable expenses",
    debt: "Debt payment",
    available: "Available to save or use",
    deficit: "Monthly shortfall",
    amount: "Amount",
    savingsCapacity: "Available balance",
    debtRatio: "Debt payment ratio",
    emergencyMonths: "Emergency buffer",
    monthUnit: "months",
    noIncome: "Income needed",
    expensesNeeded: "Living costs needed",
    interpretationTitle: "A simple next-step guide",
    interpretationEmpty: "Enter income and expenses to see which area to review first.",
    negativeBalance: "Outflows exceed income by {amount}. Review recurring costs and repayment schedules together first.",
    lowBalance: "{rate}% of income remains. Setting aside even a small emergency amount can make unexpected costs easier to handle.",
    healthyBalance: "{rate}% of income is available to save or use for other goals. Compare it with actual transactions before acting.",
    highDebt: "{rate}% of monthly income goes to debt payments. Consider official counselling before taking on more debt.",
    mediumDebt: "{rate}% of monthly income goes to debt payments. Review the rate, maturity and early-repayment terms together.",
    lowDebt: "Your debt payment ratio is {rate}% of monthly income.",
    emergencyNone: "There is no emergency buffer yet, or living expenses are missing. If possible, start with one month of living costs.",
    emergencyLow: "Your emergency buffer covers about {months} months of living costs. Build toward one month first, then three.",
    emergencyReady: "Your emergency buffer covers about {months} months of living costs. Keeping it separate by purpose can make it easier to manage.",
    officialHelpTitle: "Official help when you need it",
    officialHelpLead: "Check the latest terms directly with an official institution before applying or signing.",
    kinfa: "Korea Inclusive Finance Agency",
    kinfaBody: "Inclusive finance products and financial-life counselling",
    fine: "FSS FINE",
    fineBody: "Financial products, institutions and consumer information",
    ccrs: "Credit Counseling & Recovery Service",
    ccrsBody: "Debt adjustment and credit or debt counselling",
    disclaimer: "These figures are simple calculations based on your entries. They are not a credit assessment, loan decision, investment recommendation or contract offer.",
  },
  ja: {
    eyebrow: "直接入力から開始",
    title: "自分で確認する毎月のお金の健康度",
    lead: "おおよその金額だけで、支出の構成と見直す順番を確認できます。",
    privacyTitle: "このブラウザ内だけで計算",
    privacyBody: "入力額は保存もサーバー送信もされません。氏名・口座番号・カード番号は入力しないでください。",
    inputTitle: "毎月の金額を入力",
    inputHint: "正確な金額に抵抗がある場合は、丸めた金額でも構いません。",
    monthlyIncome: "月の手取り収入",
    monthlyIncomeHelp: "税金などを除き、実際に使える月平均額",
    fixedExpenses: "固定支出",
    fixedExpensesHelp: "住居費、通信費、保険料など毎月繰り返す金額",
    variableExpenses: "変動支出",
    variableExpensesHelp: "食費、交通費、買い物など月ごとに変わる金額",
    debtPayment: "月の債務返済",
    debtPaymentHelp: "元金と利息を含めて毎月返す金額",
    emergencySavings: "現在の緊急予備資金",
    emergencySavingsHelp: "急な支出にすぐ使える現金性資金",
    won: "ウォン",
    clear: "入力をリセット",
    resultTitle: "入力額から計算した結果",
    resultLead: "金融機関の審査ではなく、家計を簡単に確認するための結果です。",
    chartTitle: "毎月のキャッシュフロー構成",
    chartEmptyTitle: "収入または支出を入力するとグラフが表示されます",
    chartEmptyBody: "サンプルデータは表示しません。月収・支出・返済額のいずれかを入力してください。",
    fixed: "固定支出",
    variable: "変動支出",
    debt: "債務返済",
    available: "貯蓄・利用可能残高",
    deficit: "月の不足額",
    amount: "金額",
    savingsCapacity: "貯蓄・利用余力",
    debtRatio: "債務返済比率",
    emergencyMonths: "緊急予備資金",
    monthUnit: "か月",
    noIncome: "収入の入力が必要",
    expensesNeeded: "生活費の入力が必要",
    interpretationTitle: "やさしい次のステップ",
    interpretationEmpty: "収入と支出を入力すると、最初に確認すべき項目をご案内します。",
    negativeBalance: "支出と返済が収入を{amount}上回っています。まず固定的な支出と返済日程を一緒に確認しましょう。",
    lowBalance: "収入の{rate}%が残ります。少額でも緊急予備資金を先に分けると、急な支出に備えやすくなります。",
    healthyBalance: "収入の{rate}%を貯蓄や別の目的に使えます。実際の決済履歴との差を確認してください。",
    highDebt: "月収の{rate}%が返済に充てられています。追加借入の前に公的相談で返済負担を確認しましょう。",
    mediumDebt: "月収の{rate}%が返済に充てられています。金利・満期・繰上返済条件を一緒に確認してください。",
    lowDebt: "月収に対する債務返済比率は{rate}%です。",
    emergencyNone: "緊急予備資金がないか、生活費が未入力です。可能ならまず1か月分の生活費を目標にしましょう。",
    emergencyLow: "緊急予備資金は生活費の約{months}か月分です。まず1か月分、次に3か月分を目指しましょう。",
    emergencyReady: "緊急予備資金は生活費の約{months}か月分です。用途と保管口座を分けると管理しやすくなります。",
    officialHelpTitle: "必要なときの公的サポート",
    officialHelpLead: "申請や契約の前に、公的機関の最新案内と条件を直接確認してください。",
    kinfa: "韓国包容金融振興院",
    kinfaBody: "庶民向け金融商品と金融生活相談",
    fine: "金融監督院 FINE",
    fineBody: "金融商品・金融会社・消費者情報",
    ccrs: "信用回復委員会",
    ccrsBody: "債務調整制度と信用・債務相談",
    disclaimer: "この結果は入力額を単純計算した参考情報であり、信用評価・融資審査・投資または契約の勧誘ではありません。",
  },
  zh: {
    eyebrow: "从手动输入开始",
    title: "由你掌控的每月财务健康检查",
    lead: "只需输入大致金额，即可了解支出结构和调整顺序。",
    privacyTitle: "仅在此浏览器内计算",
    privacyBody: "输入金额不会保存或发送到服务器。请勿输入姓名、账号或银行卡号。",
    inputTitle: "输入每月金额",
    inputHint: "如果不想填写精确数字，也可以输入四舍五入后的金额。",
    monthlyIncome: "每月到手收入",
    monthlyIncomeHelp: "扣除税费后每月实际可使用的平均金额",
    fixedExpenses: "固定支出",
    fixedExpensesHelp: "住房、通信、保险等每月重复发生的费用",
    variableExpenses: "浮动支出",
    variableExpensesHelp: "餐饮、交通、购物等每月会变化的费用",
    debtPayment: "每月债务偿还",
    debtPaymentHelp: "每月偿还的本金和利息总额",
    emergencySavings: "当前应急储备",
    emergencySavingsHelp: "发生意外支出时可立即使用的现金类资金",
    won: "韩元",
    clear: "清空输入",
    resultTitle: "根据输入计算的结果",
    resultLead: "这是简单的家庭财务检查，并非金融机构的审核结果。",
    chartTitle: "每月现金流构成",
    chartEmptyTitle: "输入收入或支出后会显示图表",
    chartEmptyBody: "不会显示示例数据。请至少输入月收入、支出或还款金额之一。",
    fixed: "固定支出",
    variable: "浮动支出",
    debt: "债务偿还",
    available: "可储蓄或使用余额",
    deficit: "每月缺口",
    amount: "金额",
    savingsCapacity: "可储蓄或使用余额",
    debtRatio: "债务偿还比例",
    emergencyMonths: "应急储备",
    monthUnit: "个月",
    noIncome: "请先输入收入",
    expensesNeeded: "请先输入生活费",
    interpretationTitle: "易懂的下一步",
    interpretationEmpty: "输入收入和支出后，我们会提示应优先检查的项目。",
    negativeBalance: "支出和还款比收入多{amount}。请先一起检查重复支出和还款安排。",
    lowBalance: "收入的{rate}%可以保留。即使金额不大，先单独留出应急资金也更容易应对意外支出。",
    healthyBalance: "收入的{rate}%可用于储蓄或其他目标。采取行动前请与实际交易记录再次核对。",
    highDebt: "月收入的{rate}%用于偿债。增加借款前，建议先通过官方咨询检查还款压力。",
    mediumDebt: "月收入的{rate}%用于偿债。请同时检查利率、期限和提前还款条件。",
    lowDebt: "债务偿还额占月收入的{rate}%。",
    emergencyNone: "目前没有应急储备，或尚未输入生活费。条件允许时，可先以1个月生活费为目标。",
    emergencyLow: "应急储备约可覆盖{months}个月生活费。先准备1个月，再逐步达到3个月。",
    emergencyReady: "应急储备约可覆盖{months}个月生活费。按用途分开保管会更容易管理。",
    officialHelpTitle: "需要时可查看的官方帮助",
    officialHelpLead: "申请或签约前，请直接向官方机构确认最新说明和条件。",
    kinfa: "韩国普惠金融振兴院",
    kinfaBody: "普惠金融产品与金融生活咨询",
    fine: "金融监督院 FINE",
    fineBody: "金融产品、金融机构与消费者信息",
    ccrs: "信用恢复委员会",
    ccrsBody: "债务调整制度与信用、债务咨询",
    disclaimer: "本结果只是基于输入金额的简单计算，不构成信用评估、贷款审核、投资建议或签约邀请。",
  },
} satisfies Record<PublicInformationLocale, Record<string, string>>;

const chartColors = ["#725bd0", "#a48be7", "#d3a56c", "#4f967f"];

function parseAmount(value: string) {
  const parsed = Number(value.replace(/[,\s]/gu, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatWon(value: number, locale: PublicInformationLocale) {
  return new Intl.NumberFormat(localeTags[locale], {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatInput(value: string, locale: PublicInformationLocale) {
  const parsed = parseAmount(value);
  if (!parsed) return "";
  return new Intl.NumberFormat(localeTags[locale], { maximumFractionDigits: 0 }).format(parsed);
}

function replaceTokens(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );
}

export function InclusiveFinanceCheckup({
  locale = "ko",
}: {
  locale?: PublicInformationLocale;
}) {
  const t = copy[locale];
  const fieldsetId = useId();
  const [amounts, setAmounts] = useState<AmountState>(emptyAmounts);

  const result = useMemo(() => {
    const monthlyIncome = parseAmount(amounts.monthlyIncome);
    const fixedExpenses = parseAmount(amounts.fixedExpenses);
    const variableExpenses = parseAmount(amounts.variableExpenses);
    const debtPayment = parseAmount(amounts.debtPayment);
    const emergencySavings = parseAmount(amounts.emergencySavings);
    const livingExpenses = fixedExpenses + variableExpenses;
    const monthlyOutflow = livingExpenses + debtPayment;
    const availableBalance = monthlyIncome - monthlyOutflow;
    const debtRatio = monthlyIncome > 0 ? (debtPayment / monthlyIncome) * 100 : 0;
    const savingsRate = monthlyIncome > 0 ? (availableBalance / monthlyIncome) * 100 : 0;
    const emergencyMonths = livingExpenses > 0 ? emergencySavings / livingExpenses : 0;
    const hasInput = Object.values({
      monthlyIncome,
      fixedExpenses,
      variableExpenses,
      debtPayment,
      emergencySavings,
    }).some((value) => value > 0);
    const hasCashFlowInput = monthlyIncome > 0 || monthlyOutflow > 0;

    const chartEntries = [
      { name: t.fixed, value: fixedExpenses },
      { name: t.variable, value: variableExpenses },
      { name: t.debt, value: debtPayment },
      { name: t.available, value: Math.max(0, availableBalance) },
    ].filter((entry) => entry.value > 0);
    const chartTotal = chartEntries.reduce((total, entry) => total + entry.value, 0);
    const chartData = chartEntries.map((entry) => ({
      ...entry,
      sharePercent: chartTotal > 0 ? (entry.value / chartTotal) * 100 : 0,
    }));

    return {
      monthlyIncome,
      livingExpenses,
      emergencySavings,
      availableBalance,
      debtRatio,
      savingsRate,
      emergencyMonths,
      hasInput,
      hasCashFlowInput,
      chartData,
    };
  }, [amounts, t]);

  const guidance = useMemo(() => {
    if (!result.hasInput || result.monthlyIncome <= 0) return [];

    const balanceText = result.availableBalance < 0
      ? replaceTokens(t.negativeBalance, {
        amount: formatWon(Math.abs(result.availableBalance), locale),
      })
      : result.savingsRate < 10
        ? replaceTokens(t.lowBalance, { rate: Math.max(0, result.savingsRate).toFixed(1) })
        : replaceTokens(t.healthyBalance, { rate: result.savingsRate.toFixed(1) });

    const debtText = result.debtRatio >= 40
      ? replaceTokens(t.highDebt, { rate: result.debtRatio.toFixed(1) })
      : result.debtRatio >= 20
        ? replaceTokens(t.mediumDebt, { rate: result.debtRatio.toFixed(1) })
        : replaceTokens(t.lowDebt, { rate: result.debtRatio.toFixed(1) });

    const emergencyText = result.emergencyMonths <= 0
      ? t.emergencyNone
      : result.emergencyMonths < 3
        ? replaceTokens(t.emergencyLow, { months: result.emergencyMonths.toFixed(1) })
        : replaceTokens(t.emergencyReady, { months: result.emergencyMonths.toFixed(1) });

    return [balanceText, debtText, emergencyText];
  }, [locale, result, t]);

  const fields: Array<{ key: AmountKey; label: string; help: string }> = [
    { key: "monthlyIncome", label: t.monthlyIncome, help: t.monthlyIncomeHelp },
    { key: "fixedExpenses", label: t.fixedExpenses, help: t.fixedExpensesHelp },
    { key: "variableExpenses", label: t.variableExpenses, help: t.variableExpensesHelp },
    { key: "debtPayment", label: t.debtPayment, help: t.debtPaymentHelp },
    { key: "emergencySavings", label: t.emergencySavings, help: t.emergencySavingsHelp },
  ];

  const metricCards = [
    {
      label: t.savingsCapacity,
      value: result.monthlyIncome > 0
        ? formatWon(result.availableBalance, locale)
        : t.noIncome,
      state: result.availableBalance < 0 ? "warning" : "neutral",
    },
    {
      label: t.debtRatio,
      value: result.monthlyIncome > 0 ? `${result.debtRatio.toFixed(1)}%` : t.noIncome,
      state: result.debtRatio >= 40 ? "warning" : "neutral",
    },
    {
      label: t.emergencyMonths,
      value: result.emergencySavings > 0 && result.livingExpenses <= 0
        ? t.expensesNeeded
        : `${result.emergencyMonths.toFixed(1)} ${t.monthUnit}`,
      state: result.emergencyMonths > 0 && result.emergencyMonths < 1 ? "warning" : "neutral",
    },
  ];

  const officialLinks = [
    {
      name: t.kinfa,
      body: t.kinfaBody,
      href: "https://www.kinfa.or.kr/",
    },
    {
      name: t.fine,
      body: t.fineBody,
      href: "https://fine.fss.or.kr/",
    },
    {
      name: t.ccrs,
      body: t.ccrsBody,
      href: "https://www.ccrs.or.kr/",
    },
  ];

  return (
    <section className={styles.checkup} aria-labelledby={`${fieldsetId}-title`}>
      <header className={styles.hero}>
        <div className={styles.heroIcon} aria-hidden="true">
          <WalletCards size={25} />
        </div>
        <div>
          <span>{t.eyebrow}</span>
          <h2 id={`${fieldsetId}-title`}>{t.title}</h2>
          <p>{t.lead}</p>
        </div>
      </header>

      <aside className={styles.privacyNotice}>
        <ShieldCheck size={20} aria-hidden="true" />
        <div>
          <strong>{t.privacyTitle}</strong>
          <p>{t.privacyBody}</p>
        </div>
      </aside>

      <fieldset className={styles.inputs}>
        <legend>{t.inputTitle}</legend>
        <p className={styles.inputHint}>{t.inputHint}</p>
        <div className={styles.fieldGrid}>
          {fields.map((field) => {
            const inputId = `${fieldsetId}-${field.key}`;
            const helpId = `${inputId}-help`;
            return (
              <label className={styles.field} htmlFor={inputId} key={field.key}>
                <span>{field.label}</span>
                <div className={styles.amountInput}>
                  <input
                    id={inputId}
                    aria-describedby={helpId}
                    autoComplete="off"
                    inputMode="numeric"
                    min="0"
                    pattern="[0-9,]*"
                    placeholder="0"
                    spellCheck={false}
                    type="text"
                    value={amounts[field.key]}
                    onBlur={() => {
                      setAmounts((current) => ({
                        ...current,
                        [field.key]: formatInput(current[field.key], locale),
                      }));
                    }}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      if (!/^[0-9,\s]*$/u.test(nextValue)) return;
                      setAmounts((current) => ({ ...current, [field.key]: nextValue }));
                    }}
                  />
                  <em>{t.won}</em>
                </div>
                <small id={helpId}>{field.help}</small>
              </label>
            );
          })}
        </div>
        <button
          className={styles.resetButton}
          disabled={!result.hasInput}
          type="button"
          onClick={() => setAmounts(emptyAmounts)}
        >
          <RotateCcw size={15} aria-hidden="true" />
          {t.clear}
        </button>
      </fieldset>

      <section className={styles.results} aria-labelledby={`${fieldsetId}-results`}>
        <header>
          <h3 id={`${fieldsetId}-results`}>{t.resultTitle}</h3>
          <p>{t.resultLead}</p>
        </header>

        <div className={styles.metrics}>
          {metricCards.map((metric) => (
            <article data-state={metric.state} key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          ))}
        </div>

        <div className={styles.resultGrid}>
          <article className={styles.chartCard}>
            <h4>{t.chartTitle}</h4>
            {!result.hasCashFlowInput || result.chartData.length === 0 ? (
              <div className={styles.emptyChart}>
                <Landmark size={28} aria-hidden="true" />
                <strong>{t.chartEmptyTitle}</strong>
                <p>{t.chartEmptyBody}</p>
              </div>
            ) : (
              <>
                <div
                  className={styles.chart}
                  role="img"
                  aria-label={`${t.chartTitle}: ${result.chartData.map((entry) => `${entry.name} ${formatWon(entry.value, locale)}, ${entry.sharePercent.toFixed(1)}%`).join(", ")}`}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={result.chartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={60}
                        outerRadius={91}
                        paddingAngle={2}
                        stroke="#fff"
                        strokeWidth={2}
                      >
                        {result.chartData.map((entry, index) => (
                          <Cell fill={chartColors[index % chartColors.length]} key={entry.name} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value, _name, item) => [
                          `${formatWon(Number(value), locale)} · ${Number(item.payload.sharePercent).toFixed(1)}%`,
                          item.payload.name,
                        ]}
                        contentStyle={{
                          border: "1px solid #ded7f1",
                          borderRadius: 12,
                          boxShadow: "0 12px 28px rgba(58,39,110,.13)",
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className={styles.legend}>
                  {result.chartData.map((entry, index) => (
                    <li key={entry.name}>
                      <i style={{ background: chartColors[index % chartColors.length] }} />
                      <span>{entry.name}</span>
                      <strong>{formatWon(entry.value, locale)} · {entry.sharePercent.toFixed(1)}%</strong>
                    </li>
                  ))}
                </ul>
                {result.availableBalance < 0 && (
                  <p className={styles.deficit} role="status" aria-live="polite">
                    <span>{t.deficit}</span>
                    <strong>{formatWon(Math.abs(result.availableBalance), locale)}</strong>
                  </p>
                )}
              </>
            )}
          </article>

          <article className={styles.guidance}>
            <h4>{t.interpretationTitle}</h4>
            {guidance.length === 0 ? (
              <p className={styles.guidanceEmpty}>{t.interpretationEmpty}</p>
            ) : (
              <ol>
                {guidance.map((item, index) => (
                  <li key={item}>
                    <span>{index + 1}</span>
                    <p>{item}</p>
                  </li>
                ))}
              </ol>
            )}
          </article>
        </div>
      </section>

      <section className={styles.officialHelp} aria-labelledby={`${fieldsetId}-official-help`}>
        <header>
          <h3 id={`${fieldsetId}-official-help`}>{t.officialHelpTitle}</h3>
          <p>{t.officialHelpLead}</p>
        </header>
        <div className={styles.linkGrid}>
          {officialLinks.map((link) => (
            <a href={link.href} key={link.href} target="_blank" rel="noopener noreferrer">
              <span>{link.name}</span>
              <p>{link.body}</p>
              <ExternalLink size={16} aria-hidden="true" />
            </a>
          ))}
        </div>
      </section>

      <p className={styles.disclaimer}>{t.disclaimer}</p>
    </section>
  );
}
