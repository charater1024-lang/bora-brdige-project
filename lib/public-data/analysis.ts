import { publicItemFreshness } from "./retention";
import { containsPromptInjection } from "../ai/context-policy.ts";
import type { PublicInformationItem } from "./types";

export const PUBLIC_INFORMATION_LOCALES = ["ko", "en", "ja", "zh"] as const;
export type PublicInformationLocale = (typeof PUBLIC_INFORMATION_LOCALES)[number];

const CATEGORY_PURPOSE: Record<PublicInformationLocale, Record<PublicInformationItem["category"], string>> = {
  ko: {
    youth: "청년 대상 자금·교육·금융지원 기회를 확인하는 자료입니다.",
    finance: "금리·물가·금융상품·공시 등 금융 판단에 필요한 공식 참고자료입니다.",
    startup: "창업 지원사업 또는 지역 상권을 탐색할 때 참고하는 자료입니다.",
    employment: "청년·고령층·외국인의 취업 상황을 기준시점별로 확인하는 공식 통계자료입니다.",
  },
  en: {
    youth: "This information helps you find funding, education, and financial-support opportunities for young people.",
    finance: "This is official reference information about rates, prices, financial products, or disclosures.",
    startup: "This information helps you explore startup support programs or local commercial districts.",
    employment: "This is official reference data for employment conditions among youth, older adults, and foreign residents.",
  },
  ja: {
    youth: "若者向けの資金・教育・金融支援の機会を確認するための資料です。",
    finance: "金利・物価・金融商品・開示情報など、金融判断に必要な公式参考資料です。",
    startup: "創業支援事業や地域商圏を調べる際の参考資料です。",
    employment: "若者・高齢層・外国人の就業状況を基準時点別に確認する公式統計資料です。",
  },
  zh: {
    youth: "这是用于查询青年资金、教育及金融支持机会的资料。",
    finance: "这是关于利率、物价、金融产品或信息披露的官方参考资料。",
    startup: "这是用于了解创业扶持项目或地区商圈的参考资料。",
    employment: "这是按基准时期查看青年、高龄群体及外国居民就业情况的官方统计资料。",
  },
};

const PURPOSE_BY_KIND: Record<string, Record<PublicInformationLocale, string>> = {
  finlife: {
    ko: "예금·적금의 공시금리와 가입 조건을 다른 상품과 비교할 때 쓰는 정보입니다.",
    en: "This information is used to compare disclosed deposit or savings rates and enrollment terms.",
    ja: "預金・積立商品の公示金利と加入条件を他の商品と比較するための情報です。",
    zh: "该信息用于比较存款或定期储蓄产品的公示利率与办理条件。",
  },
  ecos: {
    ko: "기준금리·대출금리·소비자물가처럼 경제 환경의 방향을 이해하는 지표입니다.",
    en: "This indicator helps explain the economic environment, such as policy rates, lending rates, or consumer prices.",
    ja: "政策金利・貸出金利・消費者物価など、経済環境の方向を理解するための指標です。",
    zh: "该指标用于了解基准利率、贷款利率或消费价格等经济环境的变化方向。",
  },
  loan: {
    ko: "공공·서민금융 대출의 대상과 제공기관을 확인하는 출발점입니다.",
    en: "This is a starting point for checking the target group and provider of a public or inclusive-finance loan.",
    ja: "公的・庶民金融ローンの対象者と提供機関を確認するための出発点です。",
    zh: "这是查询公共或普惠金融贷款适用对象及提供机构的起点。",
  },
  dart: {
    ko: "기업이 공식 제출한 최근 공시의 제목과 제출일을 확인하는 자료입니다.",
    en: "This information shows the title and filing date of a recent official corporate disclosure.",
    ja: "企業が公式に提出した最近の開示資料の題名と提出日を確認する情報です。",
    zh: "该信息用于查看企业近期正式披露文件的标题和提交日期。",
  },
  bizinfo: {
    ko: "신청 가능한 창업·중소기업 지원사업의 대상과 마감일을 확인하는 공고입니다.",
    en: "This notice helps you check the target group and deadline of a startup or small-business support program.",
    ja: "申請可能な創業・中小企業支援事業の対象者と締切を確認する公募情報です。",
    zh: "该公告用于查询可申请的创业或中小企业扶持项目的对象与截止日期。",
  },
  commercial: {
    ko: "공식 주요상권의 영역과 위치를 파악하는 참고자료이며 수익성을 보장하지 않습니다.",
    en: "This is official reference data for the boundary and location of a major commercial district; it does not guarantee profitability.",
    ja: "公式の主要商圏の範囲と位置を把握する参考資料であり、収益性を保証するものではありません。",
    zh: "这是用于了解官方主要商圈范围和位置的参考数据，不保证经营收益。",
  },
  kosaf: {
    ko: "학생 대상 장학·학자금 지원 제도의 대상과 내용을 확인하는 자료입니다.",
    en: "This information helps students check the target group and terms of a scholarship or education-finance program.",
    ja: "学生向け奨学金・学資支援制度の対象者と内容を確認する資料です。",
    zh: "这是供学生查询奖学金或助学资金项目对象与内容的资料。",
  },
  employment: {
    ko: "고용률·실업률·취업자 수 등 대상별 공식 수치를 기준시점과 단위까지 함께 확인하는 자료입니다.",
    en: "This information presents official group-level employment figures together with their period and unit.",
    ja: "雇用率・失業率・就業者数などの対象別公式値を基準時点と単位とともに確認する資料です。",
    zh: "该资料同时展示就业率、失业率、就业人数等分群官方数值及其基准时期和单位。",
  },
};

function itemKind(item: PublicInformationItem) {
  if (item.id.startsWith("finlife-")) return "finlife";
  if (item.id.startsWith("ecos-")) return "ecos";
  if (item.id.startsWith("loan-")) return "loan";
  if (item.id.startsWith("dart-")) return "dart";
  if (item.id.startsWith("bizinfo-")) return "bizinfo";
  if (item.id.startsWith("commercial-") || item.id.startsWith("seoul-commercial-")) return "commercial";
  if (item.id.startsWith("kosaf-")) return "kosaf";
  if (item.id.startsWith("kosis-employment-")) return "employment";
  return null;
}

function itemPurpose(item: PublicInformationItem, locale: PublicInformationLocale) {
  const kind = itemKind(item);
  return kind ? PURPOSE_BY_KIND[kind][locale] : CATEGORY_PURPOSE[locale][item.category];
}

const RELEVANCE_BY_KIND: Record<string, Record<PublicInformationLocale, string>> = {
  youth: {
    ko: "나이·재학·소득 등 지원 자격이 맞는지 확인할 때 유용합니다.",
    en: "It is useful for checking whether age, enrollment, income, and other eligibility rules fit your situation.",
    ja: "年齢・在学状況・所得などの支援資格が合うか確認する際に役立ちます。",
    zh: "可用于核对年龄、在读情况、收入等申请资格是否符合自身情况。",
  },
  finlife: {
    ko: "희망 가입기간, 목돈 또는 월 납입액, 중도해지 가능성을 함께 비교해야 합니다.",
    en: "Compare the desired term, lump-sum or monthly contribution, and the possibility of early withdrawal together.",
    ja: "希望期間、預入一括額または毎月の積立額、中途解約の可能性を合わせて比較してください。",
    zh: "应同时比较期望期限、一次性或每月存入金额，以及提前支取的可能性。",
  },
  ecos: {
    ko: "개별 상품 추천이 아니라 대출·저축 환경이 어떻게 변하는지 이해하는 데 적합합니다.",
    en: "It is suitable for understanding changes in the borrowing and savings environment, not for selecting a specific product.",
    ja: "個別商品の推薦ではなく、借入・貯蓄環境の変化を理解するための情報です。",
    zh: "该信息适合用于了解借贷与储蓄环境的变化，并非具体产品推荐。",
  },
  dart: {
    ko: "투자 결론이 아니라 기업의 최근 사건과 위험요인을 추가 확인하는 단서입니다.",
    en: "It is a lead for checking recent corporate events and risks, not an investment conclusion.",
    ja: "投資判断の結論ではなく、企業の最近の出来事やリスクを追加確認する手掛かりです。",
    zh: "它是进一步核查企业近期事项和风险的线索，并非投资结论。",
  },
  bizinfo: {
    ko: "업력·지역·업종·신청기간이 본인 사업과 맞는지 빠르게 선별할 수 있습니다.",
    en: "It helps you quickly screen whether business age, location, industry, and application period fit your business.",
    ja: "業歴・地域・業種・申請期間が自分の事業に合うか素早く絞り込めます。",
    zh: "可快速筛选企业年限、地区、行业及申请期限是否与自身业务相符。",
  },
  commercial: {
    ko: "후보 지역을 비교하기 위한 위치 정보이며 유동인구·매출·임대료 자료와 함께 봐야 합니다.",
    en: "This is location data for comparing candidate areas and should be reviewed with footfall, sales, and rent data.",
    ja: "候補地域を比較する位置情報であり、通行量・売上・賃料データと合わせて確認してください。",
    zh: "这是用于比较候选地区的位置数据，应结合客流、销售额和租金资料查看。",
  },
  employment: {
    ko: "조사 대상·연령 정의·주기와 단위가 다른 통계끼리는 직접 비교하지 않고 각 집단의 흐름을 이해하는 데 사용해야 합니다.",
    en: "Use it to understand each group's pattern; do not directly compare surveys with different populations, age definitions, frequencies, or units.",
    ja: "調査対象・年齢定義・周期・単位が異なる統計を直接比較せず、各集団の傾向を理解するために使用してください。",
    zh: "应用于了解各群体趋势，不应直接比较调查对象、年龄定义、频率或单位不同的统计。",
  },
  default: {
    ko: "공식 원문의 대상·기준일·적용 조건이 현재 상황과 맞는지 확인할 때 유용합니다.",
    en: "It is useful for checking whether the official target group, reference date, and conditions fit the current situation.",
    ja: "公式原文の対象者・基準日・適用条件が現在の状況に合うか確認する際に役立ちます。",
    zh: "可用于核对官方原文中的适用对象、基准日期和条件是否符合当前情况。",
  },
};

function relevance(item: PublicInformationItem, locale: PublicInformationLocale) {
  if (item.category === "youth") return RELEVANCE_BY_KIND.youth[locale];
  const kind = itemKind(item);
  return RELEVANCE_BY_KIND[kind ?? "default"]?.[locale] ?? RELEVANCE_BY_KIND.default[locale];
}

const CHECK_COPY: Record<PublicInformationLocale, {
  latest: string;
  deadline: (date: string) => string;
  finlife: string;
  policy: string;
  commercial: string;
  dart: string;
  general: string;
  disclaimer: string;
}> = {
  ko: {
    latest: "기준일과 공식 원문의 최신 상태를 확인하세요.",
    deadline: (date) => `신청 또는 유효 마감일은 ${date}로 저장돼 있습니다.`,
    finlife: "우대금리 조건, 중도해지금리, 세후 수령액과 예금자보호 여부를 확인하세요.",
    policy: "지원 대상, 제외 조건, 제출서류와 실제 접수 마감시각을 확인하세요.",
    commercial: "공식 상권 영역과 위치만으로 판단하지 말고 유동인구·매출·임대료를 추가 확인하세요.",
    dart: "공시 본문과 정정공시 여부를 함께 확인하세요.",
    general: "수치의 단위와 조사·공시 기준을 확인하세요.",
    disclaimer: "일반 정보 설명이며 개인 맞춤 금융·투자·법률 자문이 아닙니다.",
  },
  en: {
    latest: "Check the reference date and the latest status on the official source.",
    deadline: (date) => `The stored application or validity deadline is ${date}.`,
    finlife: "Check bonus-rate requirements, early-withdrawal rates, after-tax proceeds, and deposit-protection status.",
    policy: "Check eligibility, exclusions, required documents, and the exact application closing time.",
    commercial: "Do not judge an area from its official boundary and location alone; also check footfall, sales, and rent.",
    dart: "Review the full disclosure and check whether a correction filing exists.",
    general: "Check the unit and the survey or disclosure basis of each figure.",
    disclaimer: "This is general information, not personalized financial, investment, or legal advice.",
  },
  ja: {
    latest: "基準日と公式原文の最新状態を確認してください。",
    deadline: (date) => `保存されている申請または有効期限は${date}です。`,
    finlife: "優遇金利条件、中途解約金利、税引後受取額、預金保護の対象かを確認してください。",
    policy: "支援対象、除外条件、提出書類、実際の受付締切時刻を確認してください。",
    commercial: "公式の商圏範囲と位置だけで判断せず、通行量・売上・賃料も確認してください。",
    dart: "開示本文と訂正開示の有無を合わせて確認してください。",
    general: "数値の単位と調査・開示基準を確認してください。",
    disclaimer: "これは一般情報の説明であり、個別の金融・投資・法律助言ではありません。",
  },
  zh: {
    latest: "请核对基准日期及官方原文的最新状态。",
    deadline: (date) => `系统保存的申请或有效截止日期为${date}。`,
    finlife: "请核对优惠利率条件、提前支取利率、税后金额及存款保障范围。",
    policy: "请核对支持对象、排除条件、提交材料及实际申请截止时间。",
    commercial: "请勿仅凭官方商圈范围和位置作出判断，还应核查客流、销售额和租金。",
    dart: "请同时查看披露正文及是否存在更正公告。",
    general: "请核对数值单位以及调查或披露口径。",
    disclaimer: "这是一般信息说明，不构成个性化金融、投资或法律建议。",
  },
};

function checks(item: PublicInformationItem, locale: PublicInformationLocale) {
  const copy = CHECK_COPY[locale];
  const common = [copy.latest];
  if (item.expiresAt) common.push(copy.deadline(item.expiresAt));
  if (item.id.startsWith("finlife-")) common.push(copy.finlife);
  else if (item.id.startsWith("bizinfo-") || item.category === "youth") common.push(copy.policy);
  else if (item.id.startsWith("commercial-")) common.push(copy.commercial);
  else if (item.id.startsWith("dart-")) common.push(copy.dart);
  else common.push(copy.general);
  return common;
}

function normalizedLocale(value: unknown): PublicInformationLocale {
  return typeof value === "string" && PUBLIC_INFORMATION_LOCALES.includes(value as PublicInformationLocale)
    ? value as PublicInformationLocale
    : "ko";
}

export function deterministicItemAnalysis(
  item: PublicInformationItem,
  nowOrLocale: number | PublicInformationLocale = Date.now(),
  requestedLocale: PublicInformationLocale = "ko",
) {
  const now = typeof nowOrLocale === "number" ? nowOrLocale : Date.now();
  const locale = normalizedLocale(typeof nowOrLocale === "string" ? nowOrLocale : requestedLocale);
  const freshness = publicItemFreshness(item, now);
  const purpose = itemPurpose(item, locale);
  const itemRelevance = relevance(item, locale);
  return {
    itemId: item.id,
    title: item.title,
    plainLanguageSummary: item.summary,
    fallbackExplanation: `${purpose} ${itemRelevance}`,
    purpose,
    relevance: itemRelevance,
    checks: checks(item, locale),
    freshness: {
      active: freshness.active,
      reason: freshness.reason,
      publishedAt: item.publishedAt,
      expiresAt: item.expiresAt ?? null,
      lastVerifiedAt: item.lastVerifiedAt ?? item.discoveredAt,
    },
    source: { name: item.source, url: item.sourceUrl },
    locale,
    disclaimer: CHECK_COPY[locale].disclaimer,
  };
}

export function plainTextAiAnswer(value: string) {
  return value
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/\*\*([^*]+)\*\*/gu, "$1")
    .replace(/__([^_]+)__/gu, "$1")
    .replace(/^\s*[-*]\s+/gmu, "• ")
    .trim()
    .slice(0, 4_000);
}

const ASSERTIVE_ELIGIBILITY_SIGNAL = /(?:(?:신청|지원|가입)(?:이|가)?\s*(?:가능|불가)(?:합니다|하다|해요)?|(?:지원|신청)\s*대상(?:입니다|이다|이에요)|자격(?:이|을)?\s*(?:있|없|충족)|\b(?:is|are)\s+(?:not\s+)?eligible\b|\bcan(?:not|'t)?\s+apply\b|\bqualif(?:y|ies)\b|申請(?:できます|できません)|対象です|資格があります|可以申请|无法申请|符合资格|不符合资格)/iu;
const PRIVATE_CREDENTIAL_SIGNAL = /(?:비밀번호|일회용\s*비밀번호|인증번호|보안코드|주민번호|계좌번호|카드번호|\bOTP\b|password|passcode|verification\s+code|API\s*key|access\s*token)/iu;
const OUTPUT_REQUEST_SIGNAL = /(?:입력|전송|회신|보내|공유|제공|enter|send|reply|share|provide)/iu;
const DATE_SIGNAL = /\b(20\d{2})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})(?:일)?\b/gu;
const NUMBER_SIGNAL = /[-+]?\d+(?:,\d{3})*(?:\.\d+)?/gu;

type HighRiskClaimRule = {
  output: RegExp;
  source: RegExp;
  sourceDenial?: RegExp;
};

// These are non-numeric claims with material financial or eligibility impact.
// Numeric/date matching alone cannot validate them, so the same positive claim
// family must appear in the official title or source summary. Boilerplate
// purpose/check text is deliberately excluded because it often says that a
// benefit is *not* guaranteed.
const HIGH_RISK_CLAIM_RULES: readonly HighRiskClaimRule[] = [
  {
    output: /(?:(?:전액|100\s*%).{0,16}(?:지원|보조|지급|보전|부담)|(?:지원|보조|지급|보전).{0,16}(?:전액|100\s*%)|(?:fully|entirely)\s+(?:funded|covered|subsidized)|covers?\s+(?:all|100\s*%)|全額.{0,12}(?:支援|補助|負担)|全额.{0,12}(?:支持|资助|补贴|承担))/iu,
    source: /(?:(?:전액|100\s*%).{0,16}(?:지원|보조|지급|보전|부담)|(?:지원|보조|지급|보전).{0,16}(?:전액|100\s*%)|(?:fully|entirely)\s+(?:funded|covered|subsidized)|covers?\s+(?:all|100\s*%)|全額.{0,12}(?:支援|補助|負担)|全额.{0,12}(?:支持|资助|补贴|承担))/iu,
    sourceDenial: /(?:(?:전액|100\s*%).{0,20}(?:지원|보조|지급|보전|부담).{0,12}(?:아니|않|불가|제외)|(?:지원|보조|지급|보전).{0,20}(?:전액|100\s*%).{0,12}(?:아니|않|불가|제외)|\b(?:not\s+(?:fully|entirely)\s+(?:funded|covered|subsidized)|does\s+not\s+cover\s+all)\b|全額.{0,12}(?:ではない|対象外)|并非全额|不(?:是|会)全额)/iu,
  },
  {
    output: /(?:상환.{0,16}(?:의무.{0,8})?(?:없|불필요|면제)|갚을\s*필요.{0,8}없|반환.{0,16}(?:불필요|의무.{0,8}없)|\b(?:no\s+repayment|repayment\s+(?:is\s+)?(?:not\s+required|waived)|non[- ]repayable|no\s+obligation\s+to\s+repay)\b|返済(?:不要|義務.{0,6}なし|免除)|无需偿还|无还款义务|免于偿还)/iu,
    source: /(?:상환.{0,16}(?:의무.{0,8})?(?:없|불필요|면제)|갚을\s*필요.{0,8}없|반환.{0,16}(?:불필요|의무.{0,8}없)|\b(?:no\s+repayment|repayment\s+(?:is\s+)?(?:not\s+required|waived)|non[- ]repayable|no\s+obligation\s+to\s+repay)\b|返済(?:不要|義務.{0,6}なし|免除)|无需偿还|无还款义务|免于偿还)/iu,
  },
  {
    output: /(?:(?:수익|수익률|원금|승인|선정|대출|지급|지원).{0,20}(?:보장(?:됩니다|합니다|된다|함)|확실(?:합니다|하다))|보장된\s*(?:수익|수익률|원금|승인|선정)|(?:무조건|반드시)\s*(?:승인|선정|지급|지원)|\b(?:guaranteed\s+(?:return|returns|profit|principal|approval|selection|funding)|(?:return|returns|approval|selection|funding)\s+(?:is|are)\s+guaranteed|risk[- ]free)\b|(?:収益|元本|承認|採択).{0,12}保証|必ず(?:承認|採択|支給)|(?:收益|本金|批准|入选|资助).{0,12}保证|一定(?:批准|入选|发放))/iu,
    source: /(?:(?:수익|수익률|원금|승인|선정|대출|지급|지원).{0,20}(?:보장(?:됩니다|합니다|된다|함)|확실(?:합니다|하다))|보장된\s*(?:수익|수익률|원금|승인|선정)|(?:무조건|반드시)\s*(?:승인|선정|지급|지원)|\b(?:guaranteed\s+(?:return|returns|profit|principal|approval|selection|funding)|(?:return|returns|approval|selection|funding)\s+(?:is|are)\s+guaranteed|risk[- ]free)\b|(?:収益|元本|承認|採択).{0,12}保証|必ず(?:承認|採択|支給)|(?:收益|本金|批准|入选|资助).{0,12}保证|一定(?:批准|入选|发放))/iu,
    sourceDenial: /(?:보장.{0,10}(?:아니|않|불가|없)|\b(?:not\s+guaranteed|not\s+risk[- ]free|no\s+guarantee)\b|保証(?:しない|されない|なし)|不保证|无法保证)/iu,
  },
  {
    output: /(?:무이자|수수료.{0,8}(?:없|면제)|비용.{0,8}(?:없|무료)|\b(?:interest[- ]free|fee[- ]free|no\s+(?:fees?|cost))\b|無利息|手数料無料|无息|免手续费|零费用)/iu,
    source: /(?:무이자|수수료.{0,8}(?:없|면제)|비용.{0,8}(?:없|무료)|\b(?:interest[- ]free|fee[- ]free|no\s+(?:fees?|cost))\b|無利息|手数料無料|无息|免手续费|零费用)/iu,
    sourceDenial: /(?:무이자.{0,10}(?:아니|않|불가)|(?:수수료|비용).{0,8}(?:있|발생)|\b(?:not\s+interest[- ]free|fees?\s+(?:apply|required)|costs?\s+(?:apply|required))\b|無利息.{0,8}(?:ではない|対象外)|并非无息|需要手续费)/iu,
  },
];

function canonicalDates(value: string) {
  return new Set([...value.normalize("NFKC").matchAll(DATE_SIGNAL)].map((match) => {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }));
}

function canonicalNumbers(value: string) {
  return new Set([...value.normalize("NFKC").matchAll(NUMBER_SIGNAL)].flatMap((match) => {
    const parsed = Number(match[0].replaceAll(",", ""));
    return Number.isFinite(parsed) ? [String(parsed)] : [];
  }));
}

function requestsPrivateCredential(value: string) {
  const normalized = value.normalize("NFKC");
  const credential = normalized.match(PRIVATE_CREDENTIAL_SIGNAL);
  if (!credential || credential.index === undefined) return false;
  const start = Math.max(0, credential.index - 40);
  const end = Math.min(normalized.length, credential.index + credential[0].length + 40);
  return OUTPUT_REQUEST_SIGNAL.test(normalized.slice(start, end));
}

function hasUnsupportedHighRiskClaim(
  value: string,
  analysis: ReturnType<typeof deterministicItemAnalysis>,
) {
  const output = value.normalize("NFKC");
  const sourceEvidence = `${analysis.title}\n${analysis.plainLanguageSummary}`.normalize("NFKC");
  return HIGH_RISK_CLAIM_RULES.some((rule) => rule.output.test(output)
    && (!rule.source.test(sourceEvidence) || Boolean(rule.sourceDenial?.test(sourceEvidence))));
}

/** Source fields are data, never instructions. Quarantine obvious attempts before invoking a model. */
export function publicItemSourceUnsafeForAi(
  item: Pick<PublicInformationItem, "title" | "summary" | "source" | "tags">,
) {
  return [item.title, item.summary, item.source, ...item.tags].some((value) => containsPromptInjection(value));
}

/**
 * Accept a shared model explanation only when every numeric/date token is
 * present in the deterministic record and it makes no affirmative eligibility
 * decision. Any uncertainty falls back to the deterministic explanation.
 */
export function safePublicItemAiExplanation(
  value: string,
  analysis: ReturnType<typeof deterministicItemAnalysis>,
) {
  const plain = plainTextAiAnswer(value);
  if (
    !plain
    || containsPromptInjection(plain)
    || ASSERTIVE_ELIGIBILITY_SIGNAL.test(plain)
    || requestsPrivateCredential(plain)
    || hasUnsupportedHighRiskClaim(plain, analysis)
    || /https?:\/\//iu.test(plain)
  ) return null;

  const trustedText = JSON.stringify(analysis);
  const trustedDates = canonicalDates(trustedText);
  if ([...canonicalDates(plain)].some((date) => !trustedDates.has(date))) return null;
  const trustedNumbers = canonicalNumbers(trustedText);
  if ([...canonicalNumbers(plain)].some((number) => !trustedNumbers.has(number))) return null;
  return plain;
}
