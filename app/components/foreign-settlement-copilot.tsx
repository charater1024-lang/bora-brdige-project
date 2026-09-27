"use client";

import {
  Banknote,
  BriefcaseBusiness,
  Check,
  Clock3,
  ExternalLink,
  FileCheck2,
  FileStack,
  HeartPulse,
  Info,
  Landmark,
  Languages,
  LockKeyhole,
  Phone,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import { useId, useMemo, useState } from "react";

import {
  FOREIGN_SETTLEMENT_BUDGET_FIELDS,
  FOREIGN_SETTLEMENT_EXPENSE_FIELDS,
  FOREIGN_SETTLEMENT_GUIDE_STEP_IDS,
  foreignSettlementBudgetSummary,
  type ForeignSettlementBudgetField,
  type ForeignSettlementGuideStepId,
} from "@/lib/foreign-settlement";
import type { PublicInformationLocale } from "./public-information-layout";
import styles from "./foreign-settlement-copilot.module.css";

type OfficialResourceId =
  | "immigration"
  | "fss"
  | "tax"
  | "nhis"
  | "telecom";

type ForeignSettlementCopilotProps = {
  locale: PublicInformationLocale;
  exchangeHref?: string;
  employmentHref?: string;
  className?: string;
};

type AmountInputs = Record<ForeignSettlementBudgetField, string>;

const EMPTY_AMOUNT_INPUTS = Object.fromEntries(
  FOREIGN_SETTLEMENT_BUDGET_FIELDS.map((field) => [field, ""]),
) as AmountInputs;

const localeTags: Record<PublicInformationLocale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const stepMeta: Record<ForeignSettlementGuideStepId, {
  icon: LucideIcon;
  resourceIds: OfficialResourceId[];
}> = {
  identity: {
    icon: FileCheck2,
    resourceIds: ["immigration"],
  },
  account: {
    icon: Landmark,
    resourceIds: ["fss"],
  },
  telecom: {
    icon: Smartphone,
    resourceIds: ["telecom"],
  },
  taxInsurance: {
    icon: ReceiptText,
    resourceIds: ["tax", "nhis"],
  },
  remittanceSafety: {
    icon: ShieldCheck,
    resourceIds: ["fss"],
  },
};

const resourceMeta: Record<OfficialResourceId, {
  icon: LucideIcon;
  href: string;
}> = {
  immigration: {
    icon: Phone,
    href: "https://www.immigration.go.kr/moj/196/subview.do",
  },
  fss: {
    icon: Landmark,
    href: "https://fine.fss.or.kr/main/index.jsp",
  },
  tax: {
    icon: ReceiptText,
    href: "https://www.nts.go.kr/english/main.do",
  },
  nhis: {
    icon: HeartPulse,
    href: "https://www.nhis.or.kr/english/index.do",
  },
  telecom: {
    icon: Smartphone,
    href: "https://www.wiseuser.go.kr/",
  },
};

const stepIds = FOREIGN_SETTLEMENT_GUIDE_STEP_IDS;
const resourceIds = Object.keys(resourceMeta) as OfficialResourceId[];

const copy = {
  ko: {
    eyebrow: "KOREA SETTLEMENT COPILOT",
    title: "한국 금융생활, 한 단계씩 준비해요",
    lead: "체류 형태와 기관에 따라 필요한 서류와 조건이 달라질 수 있습니다. 확인할 질문을 정리하고, 최신 내용은 공식 기관에서 직접 확인하세요.",
    languageSupport: "한국어 · English · 日本語 · 简体中文",
    privacyTitle: "이 탭 안에서만 계산해요",
    privacyBody: "입력 금액과 체크 상태는 서버로 보내거나 저장하지 않습니다. 새로고침하면 모두 초기화됩니다. 이름, 외국인등록번호, 계좌번호, 카드번호는 입력하지 마세요.",
    checklistTitle: "금융 정착 체크리스트",
    checklistLead: "완료를 인증하는 절차가 아니라, 기관에 확인할 질문을 잊지 않기 위한 임시 목록입니다.",
    progress: (done: number, total: number) => `${total}개 중 ${done}개 확인`,
    clearChecklist: "체크 해제",
    officialCheck: "공식 안내 확인",
    steps: {
      identity: {
        title: "체류·신원확인 조건 확인",
        body: "현재 체류 형태에서 사용할 수 있는 신분증과 증명서는 1345 또는 하이코리아에서 먼저 확인하세요. 실제 번호는 이 화면에 입력하지 않습니다.",
      },
      telecom: {
        title: "본인 명의 통신 수단 준비",
        body: "가입 가능한 신분확인 방식, 요금, 약정 기간, 해지 조건을 통신사와 확인하세요. 조건은 사업자와 체류 형태에 따라 달라질 수 있습니다.",
      },
      account: {
        title: "은행 계좌 조건 비교",
        body: "선택한 은행에 인정 서류, 거래 한도, 해외송금 수수료와 해지 조건을 직접 물어보세요. 계좌 개설 가능 여부는 은행이 판단합니다.",
      },
      tax: {
        title: "세금 안내와 신고 일정 확인",
        body: "거주자 구분과 소득 형태에 따라 세금 처리가 달라질 수 있습니다. 국세청의 최신 외국인 안내와 필요 시 전문가 상담을 확인하세요.",
      },
      security: {
        title: "금융사기 예방 설정",
        body: "인증번호·비밀번호를 공유하지 말고, 문자 링크 대신 은행 공식 앱이나 직접 입력한 주소를 이용하세요. 의심되면 송금 전에 공식 기관에 확인하세요.",
      },
    },
    budgetTitle: "저장하지 않는 월 예산 점검",
    budgetLead: "원 단위의 대략적인 금액만 입력해도 됩니다. 입력 전 모든 값은 0이며 예시 데이터는 표시하지 않습니다.",
    fields: {
      monthlyIncome: "월 사용 가능 소득",
      housing: "주거비",
      food: "식비",
      transport: "교통비",
      telecom: "통신비",
      insurance: "보험·의료비",
      remittance: "해외송금 예정액",
      other: "기타 지출",
    },
    won: "원",
    clearBudget: "입력 초기화",
    resultTitle: "입력값 계산 결과",
    income: "월 소득",
    expenses: "월 지출 합계",
    remaining: "남는 금액",
    shortfall: "부족 금액",
    expenseRatio: "소득 대비 지출",
    chartTitle: "월 지출 구성",
    chartEmptyTitle: "지출을 입력하면 그래프가 나타납니다",
    chartEmptyBody: "예시 그래프는 사용하지 않습니다. 아래 표의 초기값도 모두 0입니다.",
    tableCaption: "입력한 월 지출의 항목별 금액과 비중",
    category: "항목",
    amount: "금액",
    share: "비중",
    total: "합계",
    noIncomeRatio: "소득을 입력하면 계산",
    nextTitle: "공식 정보로 이어서 확인",
    nextLead: "환율과 고용 통계는 별도 공식 데이터 페이지에서 기준일과 출처를 함께 확인할 수 있습니다.",
    exchangeLink: "공식 환율 정보 보기",
    exchangeBody: "환율 기준일, 통화별 값과 시계열 확인",
    employmentLink: "외국인 고용 통계 보기",
    employmentBody: "대상과 기준시점이 표시된 공공 통계 확인",
    resourcesTitle: "공식 도움과 확인처",
    resourcesLead: "외부 사이트의 지원 언어와 운영 시간은 바뀔 수 있으니 해당 페이지에서 최신 정보를 확인하세요.",
    resources: {
      immigration: {
        title: "외국인종합안내센터 1345",
        body: "출입국·체류와 국내 생활을 위한 다국어 공식 안내",
      },
      fss: {
        title: "금융감독원 FINE",
        body: "금융회사·금융상품·금융소비자 정보를 확인하는 공식 포털",
      },
      tax: {
        title: "국세청 외국인 세금 안내",
        body: "외국인 납세자를 위한 최신 안내서와 신고 정보",
      },
      telecom: {
        title: "와이즈유저",
        body: "방송통신 이용 계약과 피해예방을 위한 공식 정보",
      },
    },
    call1345: "1345 전화",
    openOfficial: "공식 사이트",
    disclaimer: "이 도구는 일반 정보와 사용자가 직접 입력한 금액의 단순 계산만 제공합니다. 체류자격, 세금 의무, 계좌 개설 가능 여부, 금융상품 적합성을 판단하거나 법률·세무·금융 자문을 제공하지 않습니다. 신청이나 계약 전 해당 기관의 최신 안내를 확인하세요.",
  },
  en: {
    eyebrow: "KOREA SETTLEMENT COPILOT",
    title: "Prepare your financial life in Korea, one step at a time",
    lead: "Required documents and conditions can vary by immigration status and institution. Organize what to ask here, then confirm the latest details with an official source.",
    languageSupport: "한국어 · English · 日本語 · 简体中文",
    privacyTitle: "Calculated only in this tab",
    privacyBody: "Amounts and checklist status are neither sent to a server nor saved. Refreshing clears everything. Never enter a name, foreign resident number, account number or card number.",
    checklistTitle: "Financial settlement checklist",
    checklistLead: "This temporary list does not certify completion. It simply helps you remember what to confirm with each institution.",
    progress: (done: number, total: number) => `${done} of ${total} checked`,
    clearChecklist: "Clear checks",
    officialCheck: "Check official guidance",
    steps: {
      identity: {
        title: "Confirm stay and identity requirements",
        body: "Ask 1345 or HiKorea which identity documents may apply to your current status. Do not enter any document number on this screen.",
      },
      telecom: {
        title: "Prepare a mobile service in your name",
        body: "Confirm accepted identity methods, fees, contract duration and cancellation terms with the provider. Conditions can vary by provider and status.",
      },
      account: {
        title: "Compare bank-account conditions",
        body: "Ask the chosen bank about accepted documents, transaction limits, overseas remittance fees and closure terms. The bank decides whether an account can be opened.",
      },
      tax: {
        title: "Check tax guidance and filing dates",
        body: "Tax treatment can depend on residency classification and income type. Review the latest NTS guide for foreigners and seek professional advice when needed.",
      },
      security: {
        title: "Set up fraud-safe habits",
        body: "Never share verification codes or passwords. Use the bank's official app or a typed address instead of a message link, and verify doubts before sending money.",
      },
    },
    budgetTitle: "A monthly budget check that is not saved",
    budgetLead: "Approximate KRW amounts are enough. Every value starts at zero and no sample data is displayed.",
    fields: {
      monthlyIncome: "Monthly usable income",
      housing: "Housing",
      food: "Food",
      transport: "Transport",
      telecom: "Mobile and internet",
      insurance: "Insurance and medical",
      remittance: "Planned overseas remittance",
      other: "Other spending",
    },
    won: "KRW",
    clearBudget: "Clear entries",
    resultTitle: "Results from your entries",
    income: "Monthly income",
    expenses: "Monthly expenses",
    remaining: "Remaining",
    shortfall: "Shortfall",
    expenseRatio: "Expenses to income",
    chartTitle: "Monthly expense composition",
    chartEmptyTitle: "Enter an expense to see the chart",
    chartEmptyBody: "No example chart is used. Every initial value in the table below is also zero.",
    tableCaption: "Amounts and shares of the monthly expenses you entered",
    category: "Category",
    amount: "Amount",
    share: "Share",
    total: "Total",
    noIncomeRatio: "Enter income to calculate",
    nextTitle: "Continue with official information",
    nextLead: "The exchange-rate and employment pages show public data together with its source and reference date.",
    exchangeLink: "View official exchange rates",
    exchangeBody: "Check the reference date, currencies and rate history",
    employmentLink: "View foreign-resident employment statistics",
    employmentBody: "Check public statistics with population and reference dates",
    resourcesTitle: "Official help and verification",
    resourcesLead: "Language support and service hours on external sites can change. Check each official page for the latest details.",
    resources: {
      immigration: {
        title: "Immigration Contact Center 1345",
        body: "Official multilingual help for immigration, stay and daily life",
      },
      fss: {
        title: "FSS FINE",
        body: "Official portal for financial institutions, products and consumer information",
      },
      tax: {
        title: "NTS guidance for foreign taxpayers",
        body: "Current guides and filing information for foreign taxpayers",
      },
      telecom: {
        title: "Wiseuser",
        body: "Official information on telecom contracts and consumer protection",
      },
    },
    call1345: "Call 1345",
    openOfficial: "Official site",
    disclaimer: "This tool provides general information and simple calculations from amounts you enter. It does not decide immigration status, tax obligations, account eligibility or product suitability, and it is not legal, tax or financial advice. Verify current official guidance before applying or signing.",
  },
  ja: {
    eyebrow: "KOREA SETTLEMENT COPILOT",
    title: "韓国での金融生活を、一歩ずつ準備",
    lead: "在留状況や機関によって、必要書類や条件が異なる場合があります。確認する質問を整理し、最新情報は公式機関で直接確認してください。",
    languageSupport: "한국어 · English · 日本語 · 简体中文",
    privacyTitle: "このタブ内だけで計算します",
    privacyBody: "入力金額とチェック状況は、サーバーへ送信・保存されません。再読み込みするとすべて初期化されます。氏名、外国人登録番号、口座番号、カード番号は入力しないでください。",
    checklistTitle: "金融生活スタート・チェックリスト",
    checklistLead: "手続き完了を証明するものではなく、各機関への確認事項を忘れないための一時的なリストです。",
    progress: (done: number, total: number) => `${total}項目中${done}項目を確認`,
    clearChecklist: "チェックを解除",
    officialCheck: "公式案内を確認",
    steps: {
      identity: {
        title: "在留・本人確認の条件を確認",
        body: "現在の在留状況で利用できる本人確認書類を、1345またはHiKoreaで確認してください。書類番号はこの画面に入力しません。",
      },
      telecom: {
        title: "本人名義の通信手段を準備",
        body: "本人確認方法、料金、契約期間、解約条件を通信会社に確認してください。条件は会社や在留状況により異なる場合があります。",
      },
      account: {
        title: "銀行口座の条件を比較",
        body: "必要書類、取引限度、海外送金手数料、解約条件を選んだ銀行に確認してください。口座開設の可否は銀行が判断します。",
      },
      tax: {
        title: "税務案内と申告日程を確認",
        body: "居住者区分や所得の種類によって税務処理が異なる場合があります。国税庁の最新外国人向け案内と、必要に応じて専門家への相談を確認してください。",
      },
      security: {
        title: "金融詐欺を防ぐ習慣を設定",
        body: "認証番号やパスワードを共有せず、メッセージのリンクではなく銀行の公式アプリや直接入力したURLを利用してください。送金前に不審点を確認しましょう。",
      },
    },
    budgetTitle: "保存しない月間予算チェック",
    budgetLead: "おおよそのウォン金額で構いません。初期値はすべて0で、サンプルデータは表示しません。",
    fields: {
      monthlyIncome: "月の手取り収入",
      housing: "住居費",
      food: "食費",
      transport: "交通費",
      telecom: "通信費",
      insurance: "保険・医療費",
      remittance: "海外送金予定額",
      other: "その他の支出",
    },
    won: "ウォン",
    clearBudget: "入力を初期化",
    resultTitle: "入力値の計算結果",
    income: "月収",
    expenses: "月間支出",
    remaining: "残額",
    shortfall: "不足額",
    expenseRatio: "収入に対する支出",
    chartTitle: "月間支出の構成",
    chartEmptyTitle: "支出を入力するとグラフが表示されます",
    chartEmptyBody: "サンプルグラフは使用しません。下の表も初期値はすべて0です。",
    tableCaption: "入力した月間支出の項目別金額と割合",
    category: "項目",
    amount: "金額",
    share: "割合",
    total: "合計",
    noIncomeRatio: "収入を入力すると計算",
    nextTitle: "公式情報を続けて確認",
    nextLead: "為替と雇用統計のページでは、出典と基準日を含む公的データを確認できます。",
    exchangeLink: "公式為替情報を見る",
    exchangeBody: "基準日、通貨別の値、推移を確認",
    employmentLink: "外国人雇用統計を見る",
    employmentBody: "対象と基準時点が明記された公的統計を確認",
    resourcesTitle: "公式の相談・確認先",
    resourcesLead: "外部サイトの対応言語や利用時間は変更される場合があります。各公式ページで最新情報をご確認ください。",
    resources: {
      immigration: {
        title: "外国人総合案内センター 1345",
        body: "出入国・在留と韓国生活のための公式多言語案内",
      },
      fss: {
        title: "金融監督院 FINE",
        body: "金融会社・商品・消費者情報を確認する公式ポータル",
      },
      tax: {
        title: "国税庁の外国人向け税務案内",
        body: "外国人納税者向けの最新ガイドと申告情報",
      },
      telecom: {
        title: "Wiseuser",
        body: "通信契約と消費者保護に関する公式情報",
      },
    },
    call1345: "1345に電話",
    openOfficial: "公式サイト",
    disclaimer: "このツールは一般情報と入力金額の単純計算のみを提供します。在留資格、納税義務、口座開設の可否、金融商品の適合性を判断するものではなく、法律・税務・金融助言ではありません。申請・契約前に公式の最新案内をご確認ください。",
  },
  zh: {
    eyebrow: "KOREA SETTLEMENT COPILOT",
    title: "逐步准备在韩国的金融生活",
    lead: "所需材料和条件可能因居留情况及机构而异。请先整理需要确认的问题，再向官方机构核实最新信息。",
    languageSupport: "한국어 · English · 日本語 · 简体中文",
    privacyTitle: "仅在当前标签页中计算",
    privacyBody: "输入金额和勾选状态不会发送到服务器，也不会保存。刷新页面后将全部清除。请勿输入姓名、外国人登记号码、账户号码或银行卡号码。",
    checklistTitle: "金融安居清单",
    checklistLead: "这不是手续完成证明，只是一份临时清单，帮助您记住需要向各机构确认的问题。",
    progress: (done: number, total: number) => `已确认 ${done}/${total} 项`,
    clearChecklist: "清除勾选",
    officialCheck: "查看官方说明",
    steps: {
      identity: {
        title: "确认居留与身份验证条件",
        body: "请先通过1345或HiKorea确认适用于当前居留情况的身份证明材料。不要在本页面输入证件号码。",
      },
      telecom: {
        title: "准备本人名下的通信服务",
        body: "请向运营商确认身份验证方式、费用、合约期限和解约条件。具体条件可能因运营商及居留情况而异。",
      },
      account: {
        title: "比较银行账户条件",
        body: "请向所选银行确认认可材料、交易限额、海外汇款手续费和销户条件。是否可以开户由银行决定。",
      },
      tax: {
        title: "确认税务说明和申报日期",
        body: "税务处理可能因居民身份分类和收入类型而异。请查看韩国国税厅面向外国人的最新指南，必要时咨询专业人士。",
      },
      security: {
        title: "设置防范金融诈骗的习惯",
        body: "不要分享验证码或密码。请使用银行官方应用或手动输入官方网址，不要直接打开短信链接；汇款前先核实可疑情况。",
      },
    },
    budgetTitle: "不保存的月度预算检查",
    budgetLead: "输入大致的韩元金额即可。所有初始值均为0，不显示示例数据。",
    fields: {
      monthlyIncome: "每月可用收入",
      housing: "住房",
      food: "饮食",
      transport: "交通",
      telecom: "通信",
      insurance: "保险与医疗",
      remittance: "计划海外汇款",
      other: "其他支出",
    },
    won: "韩元",
    clearBudget: "清除输入",
    resultTitle: "输入金额的计算结果",
    income: "月收入",
    expenses: "月支出合计",
    remaining: "剩余金额",
    shortfall: "不足金额",
    expenseRatio: "支出占收入",
    chartTitle: "月度支出构成",
    chartEmptyTitle: "输入支出后显示图表",
    chartEmptyBody: "本页面不使用示例图表，下方表格的初始值也全部为0。",
    tableCaption: "所输入月度支出的分类金额与占比",
    category: "类别",
    amount: "金额",
    share: "占比",
    total: "合计",
    noIncomeRatio: "输入收入后计算",
    nextTitle: "继续查看官方信息",
    nextLead: "汇率和就业页面会同时显示公共数据的来源与基准日期。",
    exchangeLink: "查看官方汇率信息",
    exchangeBody: "查看基准日期、各币种汇率和历史走势",
    employmentLink: "查看外国人就业统计",
    employmentBody: "查看注明统计对象与基准时间的公共数据",
    resourcesTitle: "官方帮助与核实渠道",
    resourcesLead: "外部网站支持的语言和服务时间可能变化，请在各官方网站确认最新信息。",
    resources: {
      immigration: {
        title: "外国人综合咨询中心 1345",
        body: "提供出入境、居留和韩国生活信息的官方多语种咨询",
      },
      fss: {
        title: "金融监督院 FINE",
        body: "查询金融机构、金融产品和消费者信息的官方平台",
      },
      tax: {
        title: "韩国国税厅外国人税务指南",
        body: "面向外国纳税人的最新指南和申报信息",
      },
      telecom: {
        title: "Wiseuser",
        body: "有关通信合约与消费者保护的官方信息",
      },
    },
    call1345: "拨打1345",
    openOfficial: "官方网站",
    disclaimer: "本工具仅提供一般信息及基于用户输入金额的简单计算。它不会判断居留资格、纳税义务、开户资格或金融产品适合度，也不构成法律、税务或金融建议。申请或签约前，请核实官方最新说明。",
  },
} as const;

const guideCopy = {
  ko: {
    mapTitle: "한눈에 보는 5단계 진행 맵",
    mapLead: "단계 이름을 누르면 같은 페이지의 자세한 설명으로 이동합니다. 체크 상태는 이 탭을 닫거나 새로고침하면 사라집니다.",
    mapLabel: "한국 금융 정착 5단계",
    prepareLabel: "미리 확인할 준비물",
    cautionLabel: "주의할 점",
    contextLabel: "처리 맥락",
    contextBadge: "기간·비용은 기관별 상이",
    sourcePreview: "공식 원문 미리보기",
    sourcePreviewLead: "바로 외부로 이동하지 않고, 아래에서 확인할 내용과 원문을 열 시점을 먼저 살펴보세요.",
    whatToCheck: "여기서 확인할 것",
    whenToOpen: "원문을 열 때",
    seeSourcePreview: "공식 확인처 미리보기로 이동",
    documentsTitle: "단계별 준비서류 비교표",
    documentsLead: "아래 항목은 제출 확정 목록이 아니라 기관에 필요 여부를 물어볼 문서 유형입니다. 원본·사본 요구와 인정 범위는 기관마다 다릅니다.",
    stepColumn: "단계",
    prepareColumn: "준비하거나 필요 여부를 물어볼 것",
    cautionColumn: "먼저 주의할 점",
    contextColumn: "처리 시간·비용 맥락",
    steps: {
      identity: {
        shortTitle: "본인확인",
        title: "본인확인·체류 서류",
        body: "은행과 통신사는 먼저 본인과 체류 상태를 확인합니다. 사용할 수 있는 문서는 체류 형태와 기관에 따라 달라집니다.",
        materials: ["유효한 여권", "보유 중인 외국인등록증·국내거소신고증 등 체류 신분 서류", "주소나 체류 상태를 확인하는 추가 서류가 필요한지 질문"],
        caution: "문서 번호나 사본을 이 사이트에 입력·업로드하지 마세요. 이름 표기가 문서마다 다르면 신청 전에 기관에 알리세요.",
        context: "방문 또는 온라인 처리 가능 여부, 추가 확인과 처리 시간은 기관별로 다릅니다. 먼저 1345와 이용할 기관에서 확인하세요.",
      },
      account: {
        shortTitle: "계좌",
        title: "은행 계좌 개설 조건",
        body: "필요 서류뿐 아니라 거래 목적, 이체 한도, 수수료와 해외송금 조건까지 함께 확인해야 합니다.",
        materials: ["본인확인·체류 서류", "국내 연락처", "주소·직업·거래 목적을 설명하는 추가 자료가 필요한지 은행에 질문"],
        caution: "계좌 개설을 대신해 준다는 사람에게 서류, 인증번호나 돈을 보내지 마세요. 개설 가능 여부와 한도는 은행이 정합니다.",
        context: "추가 확인, 거래 한도, 수수료와 처리 시간은 은행·계좌 종류·체류 형태별로 다릅니다. 선택한 은행에서 최종 확인하세요.",
      },
      telecom: {
        shortTitle: "통신",
        title: "본인 명의 통신 서비스",
        body: "본인 명의 휴대전화는 금융 인증에 자주 쓰입니다. 선불·후불, 약정과 해지 조건을 함께 비교하세요.",
        materials: ["통신사가 인정하는 본인확인 서류", "사용할 요금 납부 수단", "선불·후불 여부와 약정·해지 조건"],
        caution: "다른 사람에게 명의를 빌려주거나 인증문자를 전달하지 마세요. 기기 대금과 통신요금을 나누어 확인하세요.",
        context: "개통 방식, 보증금 여부, 요금과 처리 시간은 통신사·요금제·체류 형태별로 다릅니다.",
      },
      taxInsurance: {
        shortTitle: "세금·보험",
        title: "세금 신고와 건강보험",
        body: "세금과 건강보험은 소득, 근로 형태, 거주·체류 상황에 따라 적용이 달라질 수 있습니다. 두 기관의 안내를 따로 확인하세요.",
        materials: ["고용주나 지급처가 제공하는 소득·근로 서류", "국세청 안내에서 확인할 소득 유형", "건강보험 자격·보험료 확인에 필요한 서류 목록"],
        caution: "세법상 거주자 구분과 출입국상 체류자격은 같은 판단이 아닐 수 있습니다. 이 도구의 설명만으로 신고 의무를 결정하지 마세요.",
        context: "신고 의무, 보험 적용, 부과 시점과 금액은 개인 상황과 기관 기준에 따라 다릅니다. 국세청과 국민건강보험공단에서 최신 내용을 확인하세요.",
      },
      remittanceSafety: {
        shortTitle: "송금·안전",
        title: "해외송금과 사기 예방",
        body: "표시 환율만 보지 말고 송금수수료, 중개수수료와 실제 수취액을 확인하세요. 송금 전 상대와 계좌를 다시 확인하세요.",
        materials: ["받는 사람 이름·계좌 정보를 본인이 다시 확인", "적용 환율과 송금·중개 수수료", "송금 목적이나 자금 출처 자료가 필요한지 금융회사에 질문"],
        caution: "인증번호 공유, 원격제어 앱 설치, ‘안전계좌’ 송금을 요구하면 중단하세요. 문자 링크 대신 금융회사 공식 앱이나 직접 입력한 주소를 이용하세요.",
        context: "송금 한도, 확인 서류, 실제 수취액과 처리 시간은 금융회사·국가·통화별로 다릅니다. 결제 확정 화면에서 최종 금액을 확인하세요.",
      },
    },
    resources: {
      immigration: {
        title: "외국인종합안내센터 1345",
        body: "출입국·체류와 국내 생활을 위한 다국어 공식 안내입니다.",
        what: "현재 체류 형태에서 확인할 신분·체류 서류와 다국어 상담 이용 방법",
        when: "어떤 문서를 사용할 수 있는지 모르거나 체류 관련 확인이 먼저 필요할 때",
      },
      fss: {
        title: "금융감독원 FINE",
        body: "금융회사·금융상품·금융소비자 정보를 확인하는 공식 포털입니다.",
        what: "등록 금융회사 여부, 금융소비자 정보, 금융사기 예방과 대응 안내",
        when: "은행·송금 서비스를 선택하기 전 또는 의심스러운 금융 요청을 받았을 때",
      },
      tax: {
        title: "국세청 외국인 세금 안내",
        body: "외국인 납세자를 위한 안내서와 신고 정보를 제공합니다.",
        what: "소득 유형별 안내, 외국인 납세 자료와 최신 신고 일정",
        when: "소득이 생기거나 형태가 바뀌었을 때, 신고·연말정산을 준비할 때",
      },
      nhis: {
        title: "국민건강보험공단 외국인 안내",
        body: "외국인 건강보험 자격·보험료·급여 관련 공식 안내입니다.",
        what: "외국인 가입 대상, 자격과 보험료·급여 안내, 외국인 지원 창구",
        when: "건강보험 적용이나 보험료가 낯설거나 근로·체류 상황이 바뀌었을 때",
      },
      telecom: {
        title: "와이즈유저",
        body: "방송통신 계약과 소비자 보호를 위한 공식 정보 포털입니다.",
        what: "통신 계약, 약정·해지 조건, 명의도용과 이용자 피해예방 정보",
        when: "개통·약정 전에 조건을 비교하거나 통신 이용 문제를 확인할 때",
      },
    },
  },
  en: {
    mapTitle: "Your five-step settlement map",
    mapLead: "Select a step name to move to its explanation on this page. Checks disappear when this tab is refreshed or closed.",
    mapLabel: "Five steps for financial settlement in Korea",
    prepareLabel: "What to prepare or ask about",
    cautionLabel: "What to watch for",
    contextLabel: "Processing context",
    contextBadge: "Timing and cost vary by institution",
    sourcePreview: "Official-source preview",
    sourcePreviewLead: "Before leaving this site, see what each source can confirm and when opening the original is useful.",
    whatToCheck: "What to check here",
    whenToOpen: "When to open the original",
    seeSourcePreview: "Go to the official-source preview",
    documentsTitle: "Preparation document comparison",
    documentsLead: "These are document types to ask about, not a confirmed submission list. Each institution decides whether originals or copies are needed and what it accepts.",
    stepColumn: "Step",
    prepareColumn: "Prepare or ask whether it is needed",
    cautionColumn: "Check first",
    contextColumn: "Timing and cost context",
    steps: {
      identity: {
        shortTitle: "Identity",
        title: "Identity and stay documents",
        body: "Banks and mobile providers first verify identity and stay status. Accepted documents vary by status and institution.",
        materials: ["A valid passport", "A foreign resident card, residence report card or other stay-status document you already hold", "Ask whether an extra address or stay-status document is needed"],
        caution: "Do not enter or upload document numbers or copies here. Tell the institution before applying if your name is written differently across documents.",
        context: "Online or in-person availability, extra verification and processing time vary by institution. Confirm with 1345 and the institution you plan to use.",
      },
      account: {
        shortTitle: "Account",
        title: "Bank-account opening conditions",
        body: "Check the purpose of the account, transfer limits, fees and overseas-remittance conditions as well as required documents.",
        materials: ["Identity and stay documents", "A Korean contact method", "Ask whether address, occupation or transaction-purpose evidence is needed"],
        caution: "Do not send documents, verification codes or money to someone claiming they can open an account for you. The bank decides eligibility and limits.",
        context: "Extra checks, limits, fees and processing time vary by bank, account type and status. Confirm the final details with the chosen bank.",
      },
      telecom: {
        shortTitle: "Mobile",
        title: "Mobile service in your name",
        body: "A mobile number in your name is often used for financial verification. Compare prepaid or postpaid service, contract length and cancellation terms.",
        materials: ["Identity documents accepted by the provider", "The payment method you plan to use", "Prepaid or postpaid service and contract or cancellation terms"],
        caution: "Do not lend your identity or forward verification messages. Check device instalments separately from mobile-service charges.",
        context: "Activation method, any deposit, fees and processing time vary by provider, plan and stay status.",
      },
      taxInsurance: {
        shortTitle: "Tax & insurance",
        title: "Tax filing and health insurance",
        body: "Tax and health-insurance treatment can vary with income, work arrangement and residence or stay circumstances. Check the two institutions separately.",
        materials: ["Income or work records provided by an employer or payer", "The income type to check in NTS guidance", "Ask which documents are needed to confirm health-insurance eligibility and contributions"],
        caution: "Tax residency and immigration status are not necessarily the same decision. Do not decide a filing obligation from this guide alone.",
        context: "Filing duties, insurance coverage, assessment timing and amounts depend on personal circumstances and institutional rules. Check current NTS and NHIS guidance.",
      },
      remittanceSafety: {
        shortTitle: "Transfer & safety",
        title: "Overseas remittance and fraud safety",
        body: "Check transfer and intermediary fees and the amount received, not only the displayed rate. Verify the recipient and account again before sending.",
        materials: ["Recheck the recipient name and account yourself", "The applied rate plus transfer and intermediary fees", "Ask whether purpose-of-transfer or source-of-funds evidence is needed"],
        caution: "Stop if anyone asks for verification codes, remote-control software or a transfer to a ‘safe account’. Use the provider's official app or a typed address instead of a message link.",
        context: "Limits, verification documents, the received amount and processing time vary by provider, country and currency. Check the final amount on the confirmation screen.",
      },
    },
    resources: {
      immigration: {
        title: "Immigration Contact Center 1345",
        body: "Official multilingual guidance for immigration, stay and daily life in Korea.",
        what: "Identity or stay documents to ask about for your current status and how to use multilingual help",
        when: "When you do not know which document can be used or need to confirm stay information first",
      },
      fss: {
        title: "FSS FINE",
        body: "The official portal for financial institutions, products and consumer information.",
        what: "Whether a company is registered, financial-consumer information, and official fraud prevention or response guidance",
        when: "Before choosing a bank or transfer service, or when a financial request looks suspicious",
      },
      tax: {
        title: "NTS guidance for foreign taxpayers",
        body: "Guides and filing information for foreign taxpayers.",
        what: "Guidance by income type, foreign-taxpayer materials and current filing schedules",
        when: "When income starts or changes, or before preparing a return or year-end settlement",
      },
      nhis: {
        title: "NHIS guidance for foreign residents",
        body: "Official information on health-insurance eligibility, contributions and benefits.",
        what: "Who may be covered, eligibility, contributions and benefits, and support for foreign residents",
        when: "When coverage or a contribution is unclear, or your work or stay circumstances change",
      },
      telecom: {
        title: "Wiseuser",
        body: "The official portal for telecom contracts and consumer protection.",
        what: "Service contracts, cancellation terms, identity misuse and user-protection information",
        when: "Before activation or a contract, or when checking a mobile-service problem",
      },
    },
  },
  ja: {
    mapTitle: "5段階の進行マップ",
    mapLead: "段階名を選ぶと、このページ内の詳しい説明へ移動します。チェック状態は再読み込みまたはタブを閉じると消えます。",
    mapLabel: "韓国での金融生活を始める5段階",
    prepareLabel: "準備・必要か確認するもの",
    cautionLabel: "注意点",
    contextLabel: "手続きの目安",
    contextBadge: "期間・費用は機関ごとに異なります",
    sourcePreview: "公式情報のプレビュー",
    sourcePreviewLead: "外部サイトを開く前に、そこで確認できることと原文を開くタイミングを確認してください。",
    whatToCheck: "ここで確認すること",
    whenToOpen: "原文を開くタイミング",
    seeSourcePreview: "公式確認先のプレビューへ",
    documentsTitle: "段階別・準備書類の比較表",
    documentsLead: "提出が確定した書類一覧ではなく、必要かどうかを各機関に尋ねるための種類です。原本・写しや認められる範囲は機関ごとに異なります。",
    stepColumn: "段階",
    prepareColumn: "準備・必要か確認するもの",
    cautionColumn: "先に注意すること",
    contextColumn: "期間・費用の考え方",
    steps: {
      identity: {
        shortTitle: "本人確認",
        title: "本人確認・在留書類",
        body: "銀行や通信会社は、まず本人と在留状況を確認します。利用できる書類は在留状況と機関によって異なります。",
        materials: ["有効なパスポート", "現在持っている外国人登録証・国内居所申告証などの在留書類", "住所や在留状況を示す追加書類が必要か確認"],
        caution: "書類番号や写しをこのサイトに入力・アップロードしないでください。書類ごとに氏名表記が違う場合は申請前に伝えてください。",
        context: "オンライン・来店の可否、追加確認、処理時間は機関ごとに異なります。1345と利用予定の機関で確認してください。",
      },
      account: {
        shortTitle: "口座",
        title: "銀行口座の開設条件",
        body: "必要書類だけでなく、利用目的、振込限度、手数料、海外送金の条件も確認します。",
        materials: ["本人確認・在留書類", "韓国内の連絡先", "住所・職業・取引目的の追加資料が必要か銀行に確認"],
        caution: "口座を代わりに開くという人へ書類、認証番号、お金を送らないでください。開設可否と限度は銀行が判断します。",
        context: "追加確認、限度、手数料、処理時間は銀行・口座種類・在留状況で異なります。選んだ銀行で最終確認してください。",
      },
      telecom: {
        shortTitle: "通信",
        title: "本人名義の通信サービス",
        body: "本人名義の携帯番号は金融認証によく使われます。プリペイド・後払い、契約期間、解約条件を比較してください。",
        materials: ["通信会社が認める本人確認書類", "利用予定の支払方法", "プリペイド・後払いと契約・解約条件"],
        caution: "名義を貸したり認証メッセージを転送したりしないでください。端末代金と通信料金は分けて確認します。",
        context: "開通方法、保証金の有無、料金、処理時間は通信会社・プラン・在留状況で異なります。",
      },
      taxInsurance: {
        shortTitle: "税・保険",
        title: "税務申告と健康保険",
        body: "税と健康保険は、所得、働き方、居住・在留状況によって扱いが異なる場合があります。二つの機関を別々に確認します。",
        materials: ["雇用主・支払者から受け取る所得・勤務書類", "国税庁の案内で確認する所得の種類", "健康保険の資格・保険料確認に必要な書類を確認"],
        caution: "税務上の居住者区分と出入国上の在留資格は同じ判断とは限りません。この案内だけで申告義務を決めないでください。",
        context: "申告義務、保険適用、賦課時期、金額は個人状況と機関基準で異なります。国税庁と国民健康保険公団の最新案内を確認してください。",
      },
      remittanceSafety: {
        shortTitle: "送金・安全",
        title: "海外送金と詐欺予防",
        body: "表示レートだけでなく、送金・仲介手数料と受取額を確認します。送金前に相手と口座を再確認してください。",
        materials: ["受取人名と口座を自分で再確認", "適用レートと送金・仲介手数料", "送金目的・資金原資の資料が必要か金融会社に確認"],
        caution: "認証番号、遠隔操作アプリ、「安全口座」への送金を求められたら中止してください。メッセージのリンクではなく公式アプリや直接入力したURLを使います。",
        context: "限度、確認書類、実際の受取額、処理時間は金融会社・国・通貨で異なります。確定画面で最終金額を確認してください。",
      },
    },
    resources: {
      immigration: {
        title: "外国人総合案内センター 1345",
        body: "出入国・在留と韓国生活のための公式多言語案内です。",
        what: "現在の在留状況で確認する本人・在留書類と多言語相談の利用方法",
        when: "どの書類が使えるか分からない、または在留情報の確認が先に必要なとき",
      },
      fss: {
        title: "金融監督院 FINE",
        body: "金融会社・商品・消費者情報を確認する公式ポータルです。",
        what: "登録金融会社か、金融消費者情報、詐欺の予防・対応に関する公式案内",
        when: "銀行・送金サービスを選ぶ前、または不審な金融要求を受けたとき",
      },
      tax: {
        title: "国税庁の外国人向け税務案内",
        body: "外国人納税者向けの案内書と申告情報です。",
        what: "所得種類別の案内、外国人向け資料、最新の申告日程",
        when: "所得が発生・変更したとき、申告・年末調整を準備するとき",
      },
      nhis: {
        title: "国民健康保険公団の外国人向け案内",
        body: "健康保険の資格・保険料・給付に関する公式情報です。",
        what: "外国人の加入対象、資格、保険料・給付、外国人向け支援窓口",
        when: "保険適用や保険料が分からない、または勤務・在留状況が変わったとき",
      },
      telecom: {
        title: "Wiseuser",
        body: "通信契約と消費者保護の公式情報ポータルです。",
        what: "通信契約、解約条件、名義の不正利用、利用者保護情報",
        when: "開通・契約前に条件を比べる、または通信利用の問題を確認するとき",
      },
    },
  },
  zh: {
    mapTitle: "五步安居进度图",
    mapLead: "选择步骤名称可跳转到本页面的详细说明。刷新或关闭标签页后，勾选状态会清除。",
    mapLabel: "在韩国开始金融生活的五个步骤",
    prepareLabel: "准备或询问是否需要",
    cautionLabel: "注意事项",
    contextLabel: "办理说明",
    contextBadge: "时间和费用因机构而异",
    sourcePreview: "官方原文预览",
    sourcePreviewLead: "离开本网站前，请先了解每个来源可以确认什么，以及何时需要打开原文。",
    whatToCheck: "在这里确认",
    whenToOpen: "何时打开原文",
    seeSourcePreview: "前往官方来源预览",
    documentsTitle: "各步骤准备材料对照表",
    documentsLead: "以下不是确定的提交清单，而是需要向机构询问是否必要的材料类型。是否接受原件或复印件以及认可范围由各机构决定。",
    stepColumn: "步骤",
    prepareColumn: "准备或询问是否需要",
    cautionColumn: "先注意",
    contextColumn: "时间与费用说明",
    steps: {
      identity: {
        shortTitle: "身份验证",
        title: "身份验证与居留材料",
        body: "银行和通信公司会先核实本人及居留情况。可使用的材料因居留情况和机构而异。",
        materials: ["有效护照", "已经持有的外国人登记证、国内居所申报证等居留材料", "询问是否需要额外的地址或居留状态材料"],
        caution: "不要在本网站输入或上传证件号码或复印件。如果不同证件上的姓名写法不同，请在申请前告知机构。",
        context: "能否线上或到店办理、额外核验和处理时间因机构而异。请先向1345及计划使用的机构确认。",
      },
      account: {
        shortTitle: "账户",
        title: "银行账户开立条件",
        body: "除所需材料外，还应确认账户用途、转账限额、手续费及海外汇款条件。",
        materials: ["身份验证与居留材料", "韩国境内联系方式", "询问银行是否需要地址、职业或交易目的证明"],
        caution: "不要向声称可以代开账户的人发送材料、验证码或金钱。开户资格和限额由银行决定。",
        context: "额外核验、限额、手续费和处理时间因银行、账户类型及居留情况而异。请向所选银行最终确认。",
      },
      telecom: {
        shortTitle: "通信",
        title: "本人名下的通信服务",
        body: "本人名下的手机号码经常用于金融验证。请比较预付费或后付费、合约期限及解约条件。",
        materials: ["运营商认可的身份证明材料", "计划使用的付款方式", "预付费或后付费以及合约、解约条件"],
        caution: "不要出借实名身份或转发验证短信。请分别确认设备分期金额和通信费用。",
        context: "开通方式、是否需要保证金、费用和处理时间因运营商、套餐及居留情况而异。",
      },
      taxInsurance: {
        shortTitle: "税务与保险",
        title: "纳税申报与健康保险",
        body: "税务和健康保险的处理可能因收入、工作方式以及居住或居留情况而异。请分别查看两个机构的说明。",
        materials: ["雇主或付款方提供的收入、工作材料", "在国税厅说明中需要确认的收入类型", "询问确认健康保险资格和保费需要哪些材料"],
        caution: "税法上的居民分类与出入境居留资格不一定相同。请勿仅根据本指南判断申报义务。",
        context: "申报义务、保险适用、计费时间和金额取决于个人情况及机构规则。请查看国税厅和国民健康保险公团的最新说明。",
      },
      remittanceSafety: {
        shortTitle: "汇款与安全",
        title: "海外汇款与防范诈骗",
        body: "不要只看显示汇率，还要确认汇款、中介手续费和实际到账金额。汇款前再次核对收款人及账户。",
        materials: ["自行再次核对收款人姓名和账户", "适用汇率以及汇款、中介手续费", "询问金融机构是否需要汇款目的或资金来源材料"],
        caution: "若有人要求验证码、安装远程控制软件或向“安全账户”汇款，请立即停止。不要打开短信链接，应使用官方应用或手动输入官方网址。",
        context: "汇款限额、核验材料、实际到账金额及处理时间因金融机构、国家和币种而异。请在确认付款页面核对最终金额。",
      },
    },
    resources: {
      immigration: {
        title: "外国人综合咨询中心 1345",
        body: "提供出入境、居留及韩国生活信息的官方多语种咨询。",
        what: "当前居留情况下需要确认的身份、居留材料及多语种咨询使用方式",
        when: "不清楚可以使用哪种材料，或需要先确认居留信息时",
      },
      fss: {
        title: "金融监督院 FINE",
        body: "查询金融机构、产品和消费者信息的官方平台。",
        what: "是否为注册金融机构、金融消费者信息以及防范和应对诈骗的官方说明",
        when: "选择银行或汇款服务之前，或收到可疑金融要求时",
      },
      tax: {
        title: "韩国国税厅外国人税务指南",
        body: "面向外国纳税人的指南和申报信息。",
        what: "不同收入类型的说明、外国人纳税资料及最新申报日程",
        when: "开始取得收入或收入类型变化，以及准备申报、年末结算时",
      },
      nhis: {
        title: "国民健康保险公团外国人指南",
        body: "有关健康保险资格、保费及待遇的官方信息。",
        what: "外国人参保对象、资格、保费与待遇以及外国人支持窗口",
        when: "不清楚保险适用或保费，或者工作、居留情况发生变化时",
      },
      telecom: {
        title: "Wiseuser",
        body: "有关通信合约和消费者保护的官方信息平台。",
        what: "通信合约、解约条件、冒用身份及用户保护信息",
        when: "开通、签约前比较条件，或需要确认通信服务问题时",
      },
    },
  },
} as const;

function formatWon(value: number, locale: PublicInformationLocale) {
  return `${new Intl.NumberFormat(localeTags[locale], {
    maximumFractionDigits: 0,
  }).format(value)} ${copy[locale].won}`;
}

function cleanAmountInput(value: string) {
  return value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "").slice(0, 13);
}

function formatAmountInput(value: string, locale: PublicInformationLocale) {
  if (!value) return "";
  return new Intl.NumberFormat(localeTags[locale], {
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function ForeignSettlementCopilot({
  locale,
  exchangeHref = "/exchange",
  employmentHref = "/information/employment",
  className,
}: ForeignSettlementCopilotProps) {
  const t = copy[locale];
  const g = guideCopy[locale];
  const baseId = useId();
  const idPrefix = `foreign-settlement-${baseId.replaceAll(":", "")}`;
  const [completedSteps, setCompletedSteps] = useState<ForeignSettlementGuideStepId[]>([]);
  const [amountInputs, setAmountInputs] = useState<AmountInputs>(
    () => ({ ...EMPTY_AMOUNT_INPUTS }),
  );

  const budget = useMemo(
    () => foreignSettlementBudgetSummary(amountInputs),
    [amountInputs],
  );
  const completionPercent = (completedSteps.length / stepIds.length) * 100;
  const remainingLabel = budget.remaining < 0 ? t.shortfall : t.remaining;
  const remainingValue = Math.abs(budget.remaining);

  function toggleStep(stepId: ForeignSettlementGuideStepId) {
    setCompletedSteps((current) => current.includes(stepId)
      ? current.filter((id) => id !== stepId)
      : [...current, stepId]);
  }

  function updateAmount(
    field: ForeignSettlementBudgetField,
    value: string,
  ) {
    setAmountInputs((current) => ({
      ...current,
      [field]: cleanAmountInput(value),
    }));
  }

  function clearBudget() {
    setAmountInputs({ ...EMPTY_AMOUNT_INPUTS });
  }

  return (
    <section
      className={`${styles.copilot}${className ? ` ${className}` : ""}`}
      aria-labelledby={`${baseId}-title`}
    >
      <header className={styles.hero}>
        <div className={styles.heroIcon} aria-hidden="true">
          <Languages size={27} />
        </div>
        <div>
          <span>{t.eyebrow}</span>
          <h1 id={`${baseId}-title`}>{t.title}</h1>
          <p>{t.lead}</p>
          <small><Languages size={14} />{t.languageSupport}</small>
        </div>
      </header>

      <div className={styles.privacyNotice} role="note">
        <LockKeyhole size={21} aria-hidden="true" />
        <div>
          <strong>{t.privacyTitle}</strong>
          <p>{t.privacyBody}</p>
        </div>
      </div>

      <section
        className={styles.checklist}
        aria-labelledby={`${baseId}-checklist-title`}
      >
        <div className={styles.sectionHeading}>
          <div role="region" aria-label={g.documentsTitle} tabIndex={0}>
            <h3 id={`${baseId}-checklist-title`}>{t.checklistTitle}</h3>
            <p>{t.checklistLead}</p>
          </div>
          <button
            type="button"
            onClick={() => setCompletedSteps([])}
            disabled={completedSteps.length === 0}
          >
            <RotateCcw size={17} aria-hidden="true" />
            {t.clearChecklist}
          </button>
        </div>

        <div className={styles.progressBlock}>
          <div aria-live="polite">
            <strong>{t.progress(completedSteps.length, stepIds.length)}</strong>
            <span>{Math.round(completionPercent)}%</span>
          </div>
          <progress
            max={stepIds.length}
            value={completedSteps.length}
            aria-label={t.progress(completedSteps.length, stepIds.length)}
          />
        </div>

        <section
          className={styles.journey}
          aria-labelledby={`${idPrefix}-journey-title`}
        >
          <header>
            <h4 id={`${idPrefix}-journey-title`}>{g.mapTitle}</h4>
            <p>{g.mapLead}</p>
          </header>
          <ol className={styles.journeyMap} aria-label={g.mapLabel}>
            {stepIds.map((stepId, index) => {
              const step = g.steps[stepId];
              const checked = completedSteps.includes(stepId);
              return (
                <li key={stepId} data-complete={checked || undefined}>
                  <a href={`#${idPrefix}-guide-${stepId}`}>
                    <span aria-hidden="true">
                      {checked ? <Check size={18} /> : index + 1}
                    </span>
                    <strong>{step.shortTitle}</strong>
                  </a>
                </li>
              );
            })}
          </ol>
        </section>

        <ol className={styles.stepList}>
          {stepIds.map((stepId, index) => {
            const meta = stepMeta[stepId];
            const step = g.steps[stepId];
            const Icon = meta.icon;
            const checked = completedSteps.includes(stepId);
            const checkboxId = `${baseId}-step-${stepId}`;

            return (
              <li
                key={stepId}
                id={`${idPrefix}-guide-${stepId}`}
                data-complete={checked || undefined}
              >
                <div className={styles.stepCheck}>
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleStep(stepId)}
                  />
                  <label htmlFor={checkboxId}>
                    <span aria-hidden="true">
                      {checked ? <Check size={19} /> : index + 1}
                    </span>
                    <Icon size={21} aria-hidden="true" />
                    <span className={styles.srOnly}>{step.title}</span>
                  </label>
                </div>
                <div className={styles.stepBody}>
                  <h4>{step.title}</h4>
                  <p>{step.body}</p>
                  <div className={styles.stepDetailGrid}>
                    <section>
                      <strong>
                        <FileStack size={17} aria-hidden="true" />
                        {g.prepareLabel}
                      </strong>
                      <ul>
                        {step.materials.map((material) => (
                          <li key={material}>{material}</li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <strong>
                        <Info size={17} aria-hidden="true" />
                        {g.cautionLabel}
                      </strong>
                      <p>{step.caution}</p>
                    </section>
                    <section>
                      <strong>
                        <Clock3 size={17} aria-hidden="true" />
                        {g.contextLabel}
                      </strong>
                      <p>{step.context}</p>
                      <span>{g.contextBadge}</span>
                    </section>
                  </div>
                  <nav className={styles.sourceJump} aria-label={g.sourcePreview}>
                    {meta.resourceIds.map((resourceId) => (
                      <a
                        key={resourceId}
                        href={`#${idPrefix}-source-${resourceId}`}
                      >
                        {g.seeSourcePreview}
                        <span>{g.resources[resourceId].title}</span>
                      </a>
                    ))}
                  </nav>
                </div>
              </li>
            );
          })}
        </ol>

        <section
          className={styles.documentComparison}
          aria-labelledby={`${idPrefix}-documents-title`}
        >
          <header>
            <h4 id={`${idPrefix}-documents-title`}>{g.documentsTitle}</h4>
            <p>{g.documentsLead}</p>
          </header>
          <div>
            <table>
              <thead>
                <tr>
                  <th scope="col">{g.stepColumn}</th>
                  <th scope="col">{g.prepareColumn}</th>
                  <th scope="col">{g.cautionColumn}</th>
                  <th scope="col">{g.contextColumn}</th>
                </tr>
              </thead>
              <tbody>
                {stepIds.map((stepId, index) => {
                  const step = g.steps[stepId];
                  return (
                    <tr key={stepId}>
                      <th scope="row">
                        <span>{index + 1}</span>
                        {step.shortTitle}
                      </th>
                      <td>
                        <ul>
                          {step.materials.map((material) => (
                            <li key={material}>{material}</li>
                          ))}
                        </ul>
                      </td>
                      <td>{step.caution}</td>
                      <td>
                        <p>{step.context}</p>
                        <strong>{g.contextBadge}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section
        className={styles.budget}
        aria-labelledby={`${baseId}-budget-title`}
      >
        <div className={styles.sectionHeading}>
          <div>
            <h3 id={`${baseId}-budget-title`}>{t.budgetTitle}</h3>
            <p>{t.budgetLead}</p>
          </div>
          <button
            type="button"
            onClick={clearBudget}
            disabled={!budget.hasAnyInput}
          >
            <RotateCcw size={17} aria-hidden="true" />
            {t.clearBudget}
          </button>
        </div>

        <fieldset className={styles.amountFields}>
          <legend className={styles.srOnly}>{t.budgetTitle}</legend>
          {FOREIGN_SETTLEMENT_BUDGET_FIELDS.map((field) => {
            const inputId = `${baseId}-amount-${field}`;
            return (
              <label key={field} htmlFor={inputId}>
                <span>{t.fields[field]}</span>
                <span className={styles.amountInput}>
                  <input
                    id={inputId}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={17}
                    value={formatAmountInput(amountInputs[field], locale)}
                    placeholder="0"
                    onChange={(event) => updateAmount(field, event.target.value)}
                    aria-label={`${t.fields[field]} (${t.won})`}
                  />
                  <em>{t.won}</em>
                </span>
              </label>
            );
          })}
        </fieldset>

        <section
          className={styles.results}
          aria-labelledby={`${baseId}-results-title`}
        >
          <h4 id={`${baseId}-results-title`}>{t.resultTitle}</h4>
          <div className={styles.metrics} aria-live="polite">
            <article>
              <span>{t.income}</span>
              <strong>{formatWon(budget.amounts.monthlyIncome, locale)}</strong>
            </article>
            <article>
              <span>{t.expenses}</span>
              <strong>{formatWon(budget.totalExpenses, locale)}</strong>
            </article>
            <article data-state={budget.remaining < 0 ? "warning" : undefined}>
              <span>{remainingLabel}</span>
              <strong>{formatWon(remainingValue, locale)}</strong>
            </article>
            <article>
              <span>{t.expenseRatio}</span>
              <strong>
                {budget.expenseRatio === null
                  ? budget.hasExpenseInput ? t.noIncomeRatio : "0%"
                  : `${Math.round(budget.expenseRatio)}%`}
              </strong>
            </article>
          </div>

          <div className={styles.resultGrid}>
            <article className={styles.chartCard}>
              <h5>{t.chartTitle}</h5>
              {budget.hasExpenseInput ? (
                <div
                  className={styles.chart}
                  role="img"
                  aria-label={`${t.chartTitle}: ${budget.expenses
                    .filter((item) => item.value > 0)
                    .map((item) => `${t.fields[item.id]} ${formatWon(item.value, locale)}`)
                    .join(", ")}`}
                >
                  {budget.expenses.map((item) => (
                    <div key={item.id}>
                      <span>{t.fields[item.id]}</span>
                      <div aria-hidden="true">
                        <i style={{ width: `${item.share}%` }} />
                      </div>
                      <strong>{Math.round(item.share)}%</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.chartEmpty} role="status">
                  <WalletCards size={28} aria-hidden="true" />
                  <strong>{t.chartEmptyTitle}</strong>
                  <p>{t.chartEmptyBody}</p>
                </div>
              )}
            </article>

            <div className={styles.tableWrap} role="region" aria-label={t.tableCaption} tabIndex={0}>
              <table>
                <caption>{t.tableCaption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t.category}</th>
                    <th scope="col">{t.amount}</th>
                    <th scope="col">{t.share}</th>
                  </tr>
                </thead>
                <tbody>
                  {FOREIGN_SETTLEMENT_EXPENSE_FIELDS.map((field) => {
                    const item = budget.expenses.find(
                      (expense) => expense.id === field,
                    );
                    return (
                      <tr key={field}>
                        <th scope="row">{t.fields[field]}</th>
                        <td>{formatWon(budget.amounts[field], locale)}</td>
                        <td>{Math.round(item?.share ?? 0)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">{t.total}</th>
                    <td>{formatWon(budget.totalExpenses, locale)}</td>
                    <td>{budget.hasExpenseInput ? "100%" : "0%"}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </section>
      </section>

      <section
        className={styles.nextLinks}
        aria-labelledby={`${baseId}-next-title`}
      >
        <header>
          <h3 id={`${baseId}-next-title`}>{t.nextTitle}</h3>
          <p>{t.nextLead}</p>
        </header>
        <div>
          <a href={exchangeHref}>
            <Banknote size={22} aria-hidden="true" />
            <span>
              <strong>{t.exchangeLink}</strong>
              <small>{t.exchangeBody}</small>
            </span>
          </a>
          <a href={employmentHref}>
            <BriefcaseBusiness size={22} aria-hidden="true" />
            <span>
              <strong>{t.employmentLink}</strong>
              <small>{t.employmentBody}</small>
            </span>
          </a>
        </div>
      </section>

      <section
        className={styles.resources}
        aria-labelledby={`${baseId}-resources-title`}
      >
        <header>
          <h3 id={`${baseId}-resources-title`}>{g.sourcePreview}</h3>
          <p>{g.sourcePreviewLead}</p>
        </header>
        <ul>
          {resourceIds.map((resourceId) => {
            const meta = resourceMeta[resourceId];
            const resource = g.resources[resourceId];
            const Icon = meta.icon;
            return (
              <li key={resourceId} id={`${idPrefix}-source-${resourceId}`}>
                <Icon size={22} aria-hidden="true" />
                <div>
                  <strong>{resource.title}</strong>
                  <p>{resource.body}</p>
                  <dl className={styles.resourcePreview}>
                    <div>
                      <dt>{g.whatToCheck}</dt>
                      <dd>{resource.what}</dd>
                    </div>
                    <div>
                      <dt>{g.whenToOpen}</dt>
                      <dd>{resource.when}</dd>
                    </div>
                  </dl>
                  <div>
                    {resourceId === "immigration" && (
                      <a href="tel:1345">
                        <Phone size={14} aria-hidden="true" />
                        {t.call1345}
                      </a>
                    )}
                    <a href={meta.href} target="_blank" rel="noopener noreferrer">
                      {t.openOfficial}
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className={styles.disclaimer} role="note">
        <ShieldCheck size={20} aria-hidden="true" />
        <p>{t.disclaimer}</p>
      </div>
    </section>
  );
}

export default ForeignSettlementCopilot;
