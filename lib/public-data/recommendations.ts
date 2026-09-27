import type {
  PublicFinancialProduct,
  PublicFinancialProductTerm,
  PublicInformationItem,
} from "./types";

export const PRODUCT_KINDS = ["deposit", "saving", "either"] as const;
export const LIQUIDITY_NEEDS = ["low", "medium", "high"] as const;
export const JOIN_CHANNELS = ["any", "online", "branch"] as const;
export const PRODUCT_RECOMMENDATION_LOCALES = ["ko", "en", "ja", "zh"] as const;

export type ProductKindPreference = (typeof PRODUCT_KINDS)[number];
export type LiquidityNeed = (typeof LIQUIDITY_NEEDS)[number];
export type JoinChannel = (typeof JOIN_CHANNELS)[number];
export type ProductRecommendationLocale = (typeof PRODUCT_RECOMMENDATION_LOCALES)[number];

export interface ProductRecommendationInput {
  productKind: ProductKindPreference;
  targetTermMonths: number;
  availableLumpSum: number;
  monthlyContribution: number;
  liquidityNeed: LiquidityNeed;
  preferredChannel: JoinChannel;
}

export interface ProductRecommendation {
  itemId: string;
  title: string;
  provider: string;
  kind: "deposit" | "saving";
  score: number;
  termMonths: number | null;
  baseRate: number | null;
  maximumRate: number | null;
  estimate: {
    principal: number;
    grossInterest: number;
    netInterest: number;
    maturityAmount: number;
    annualRate: number;
    rateBasis: "base" | "maximum";
    assumedTaxRate: number;
  } | null;
  reasons: string[];
  checks: string[];
  sourceUrl: string;
  asOf: string | null;
}

function finite(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim().replaceAll(",", "").replace(/\s+/gu, "");
    const match = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(만원|천원|원)?$/u.exec(normalized);
    if (!match) return 0;
    const multiplier = match[2] === "만원" ? 10_000 : match[2] === "천원" ? 1_000 : 1;
    const number = Number(match[1]) * multiplier;
    return Number.isFinite(number) ? number : 0;
  }
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function normalizeRecommendationInput(value: unknown): ProductRecommendationInput {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const productKind = PRODUCT_KINDS.includes(record.productKind as ProductKindPreference)
    ? record.productKind as ProductKindPreference
    : "either";
  const liquidityNeed = LIQUIDITY_NEEDS.includes(record.liquidityNeed as LiquidityNeed)
    ? record.liquidityNeed as LiquidityNeed
    : "medium";
  const preferredChannel = JOIN_CHANNELS.includes(record.preferredChannel as JoinChannel)
    ? record.preferredChannel as JoinChannel
    : "any";
  return {
    productKind,
    targetTermMonths: Math.round(Math.min(120, Math.max(1, finite(record.targetTermMonths) || 12))),
    availableLumpSum: Math.round(Math.min(10_000_000_000, Math.max(0, finite(record.availableLumpSum)))),
    monthlyContribution: Math.round(Math.min(100_000_000, Math.max(0, finite(record.monthlyContribution)))),
    liquidityNeed,
    preferredChannel,
  };
}

function legacyProduct(item: PublicInformationItem): PublicFinancialProduct | null {
  if (!item.id.startsWith("finlife-")) return null;
  const kind = item.id.startsWith("finlife-deposit-") ? "deposit"
    : item.id.startsWith("finlife-saving-") ? "saving"
      : null;
  if (!kind) return null;
  const maximumRate = /최고금리\s*([0-9]+(?:\.[0-9]+)?)%/u.exec(item.summary)?.[1];
  const [provider, ...nameParts] = item.title.split(" · ");
  return {
    kind,
    provider: provider || item.source,
    productName: nameParts.join(" · ") || item.title,
    productCode: item.id,
    joinMethods: item.tags.slice(1),
    eligibility: null,
    specialConditions: null,
    terms: maximumRate ? [{
      termMonths: null,
      baseRate: null,
      maximumRate: Number(maximumRate),
      rateType: null,
    }] : [],
  };
}

function validRate(value: number | null | undefined) {
  return value !== null && value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function rateOf(term: PublicFinancialProductTerm | null) {
  return validRate(term?.maximumRate) ?? validRate(term?.baseRate);
}

function rateBasis(term: PublicFinancialProductTerm | null) {
  if (validRate(term?.maximumRate) !== null) return "maximum" as const;
  if (validRate(term?.baseRate) !== null) return "base" as const;
  return null;
}

function rankingRate(term: PublicFinancialProductTerm | null) {
  if (!term) return null;
  const baseRate = validRate(term.baseRate);
  const maximumRate = validRate(term.maximumRate);
  if (baseRate !== null && maximumRate !== null) {
    // Maximum rates often depend on bonus conditions. Give the disclosed base
    // rate more weight so a difficult-to-earn headline rate cannot dominate.
    return baseRate * 0.7 + maximumRate * 0.3;
  }
  return baseRate ?? maximumRate;
}

function bestTerm(
  terms: PublicFinancialProductTerm[],
  target: number,
  liquidityNeed: LiquidityNeed,
) {
  if (!terms.length) return null;
  return [...terms].sort((left, right) => {
    const leftDistance = left.termMonths === null ? Number.MAX_SAFE_INTEGER : Math.abs(left.termMonths - target);
    const rightDistance = right.termMonths === null ? Number.MAX_SAFE_INTEGER : Math.abs(right.termMonths - target);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    const leftLiquidity = liquidityScore(liquidityNeed, left.termMonths);
    const rightLiquidity = liquidityScore(liquidityNeed, right.termMonths);
    if (leftLiquidity !== rightLiquidity) return rightLiquidity - leftLiquidity;
    const rateDifference = (rankingRate(right) ?? -1) - (rankingRate(left) ?? -1);
    if (rateDifference !== 0) return rateDifference;
    const termDifference = (left.termMonths ?? Number.MAX_SAFE_INTEGER)
      - (right.termMonths ?? Number.MAX_SAFE_INTEGER);
    if (termDifference !== 0) return termDifference;
    const baseRateDifference = (validRate(right.baseRate) ?? -1) - (validRate(left.baseRate) ?? -1);
    if (baseRateDifference !== 0) return baseRateDifference;
    return (validRate(right.maximumRate) ?? -1) - (validRate(left.maximumRate) ?? -1);
  })[0];
}

type ChannelMatch = "match" | "unknown" | "mismatch";

function channelMatch(methods: string[], channel: JoinChannel): ChannelMatch {
  if (channel === "any") return "match";
  const joined = methods.join(" ").normalize("NFKC").toLocaleLowerCase();
  if (!joined.trim()) return "unknown";
  const matches = channel === "online"
    ? /인터넷|스마트폰|모바일|온라인|비대면|텔레뱅킹|전화|online|web|app|앱/u.test(joined)
    : /영업점|창구|방문|branch/u.test(joined)
      || /(?:^|[\s,/()])대면(?:$|[\s,/()])/u.test(joined);
  return matches ? "match" : "mismatch";
}

function liquidityScore(need: LiquidityNeed, termMonths: number | null) {
  if (termMonths === null) return 6;
  if (need === "high") return termMonths <= 6 ? 15 : termMonths <= 12 ? 10 : 2;
  if (need === "medium") return termMonths <= 24 ? 15 : termMonths <= 36 ? 9 : 4;
  return termMonths >= 12 ? 15 : 10;
}

function fundingScore(kind: PublicFinancialProduct["kind"], input: ProductRecommendationInput) {
  const matchingAmount = kind === "deposit"
    ? input.availableLumpSum
    : input.monthlyContribution;
  if (matchingAmount > 0) return 20;
  const otherAmount = kind === "deposit"
    ? input.monthlyContribution
    : input.availableLumpSum;
  return input.productKind === "either" && otherAmount > 0 ? 0 : 5;
}

const GENERAL_INTEREST_TAX_RATE = 0.154;

function estimatedReturn(
  product: PublicFinancialProduct,
  term: PublicFinancialProductTerm | null,
  input: ProductRecommendationInput,
): ProductRecommendation["estimate"] {
  const termMonths = term?.termMonths ?? null;
  const basis = validRate(term?.baseRate) !== null
    ? "base" as const
    : validRate(term?.maximumRate) !== null
      ? "maximum" as const
      : null;
  const annualRate = basis === "base"
    ? validRate(term?.baseRate)
    : basis === "maximum"
      ? validRate(term?.maximumRate)
      : null;
  const fundingAmount = product.kind === "deposit"
    ? input.availableLumpSum
    : input.monthlyContribution;
  if (
    termMonths === null
    || termMonths <= 0
    || annualRate === null
    || fundingAmount <= 0
    || !basis
  ) return null;

  const principal = product.kind === "deposit"
    ? fundingAmount
    : fundingAmount * termMonths;
  const grossInterest = product.kind === "deposit"
    ? principal * (annualRate / 100) * (termMonths / 12)
    // Simple-interest approximation: the first monthly payment accrues for
    // the full term and the final payment for one month.
    : fundingAmount * (annualRate / 100) * (termMonths * (termMonths + 1) / 2 / 12);
  const netInterest = grossInterest * (1 - GENERAL_INTEREST_TAX_RATE);
  return {
    principal: Math.round(principal),
    grossInterest: Math.round(grossInterest),
    netInterest: Math.round(netInterest),
    maturityAmount: Math.round(principal + netInterest),
    annualRate,
    rateBasis: basis,
    assumedTaxRate: GENERAL_INTEREST_TAX_RATE,
  };
}

const RECOMMENDATION_COPY: Record<ProductRecommendationLocale, {
  depositReady: string;
  depositMissing: string;
  savingReady: string;
  savingMissing: string;
  term: (term: number, target: number, difference: number) => string;
  checkTerm: string;
  checkLiquidity: string;
  channelMatch: (channel: Exclude<JoinChannel, "any">) => string;
  channelCheck: (channel: Exclude<JoinChannel, "any">) => string;
  rate: (rate: number, basis: "base" | "maximum") => string;
  estimateAssumption: (kind: "deposit" | "saving", basis: "base" | "maximum", rate: number) => string;
  officialChecks: string;
  eligibility: (value: string) => string;
  specialConditions: (value: string) => string;
  disclaimer: string;
}> = {
  ko: {
    depositReady: "목돈을 한 번에 맡기는 예금 방식과 맞습니다.",
    depositMissing: "예치할 목돈을 입력하면 비교 정확도가 높아집니다.",
    savingReady: "매월 납입하는 적금 방식과 맞습니다.",
    savingMissing: "월 납입 가능액을 입력하면 비교 정확도가 높아집니다.",
    term: (term, target, difference) => `${term}개월 조건이 희망 기간 ${target}개월과 ${difference === 0 ? "일치합니다" : `${difference}개월 차이입니다`}.`,
    checkTerm: "공식 페이지에서 가입 기간을 확인하세요.",
    checkLiquidity: "중도해지 시 적용금리와 긴급 인출 가능 여부를 확인하세요.",
    channelMatch: (channel) => `${channel === "online" ? "비대면" : "영업점"} 가입 경로가 공시돼 있습니다.`,
    channelCheck: (channel) => `원하는 ${channel === "online" ? "비대면" : "영업점"} 가입이 가능한지 확인하세요.`,
    rate: (rate, basis) => `공시된 해당 조건의 ${basis === "base" ? "기본금리" : "최고금리"}는 연 ${rate}%입니다.`,
    estimateAssumption: (kind, basis, rate) => `${kind === "deposit" ? "예치금" : "월 납입액"}과 공시 ${basis === "base" ? "기본금리" : "최고금리"} 연 ${rate}%를 단리로 적용하고 일반과세 15.4%를 가정한 예상치입니다. 실제 납입일·이자계산·세제에 따라 달라질 수 있습니다.`,
    officialChecks: "우대금리 조건, 세전·세후 수령액, 예금자보호 대상 여부를 공식 원문에서 확인하세요.",
    eligibility: (value) => `가입 대상: ${value}`,
    specialConditions: (value) => `우대 조건: ${value}`,
    disclaimer: "이 결과는 입력값과 공시정보를 비교한 교육용 적합도이며 개인 맞춤 금융자문이나 가입 권유가 아닙니다. 금리·우대조건·중도해지 조건은 가입 직전 금융회사 공식 원문에서 다시 확인하세요.",
  },
  en: {
    depositReady: "This matches a deposit funded with a lump sum.",
    depositMissing: "Enter the lump sum you can deposit to improve the comparison.",
    savingReady: "This matches a savings product funded by monthly contributions.",
    savingMissing: "Enter your affordable monthly contribution to improve the comparison.",
    term: (term, target, difference) => `The ${term}-month term ${difference === 0 ? `matches your ${target}-month target` : `is ${difference} months away from your ${target}-month target`}.`,
    checkTerm: "Check the available term on the official product page.",
    checkLiquidity: "Check the early-withdrawal rate and whether emergency access is allowed.",
    channelMatch: (channel) => `${channel === "online" ? "Online" : "Branch"} enrollment is listed for this product.`,
    channelCheck: (channel) => `Confirm whether ${channel === "online" ? "online" : "branch"} enrollment is available.`,
    rate: (rate, basis) => `The disclosed ${basis === "base" ? "base" : "maximum"} annual rate for this term is ${rate}%.`,
    estimateAssumption: (kind, basis, rate) => `The estimate applies the disclosed ${basis} rate of ${rate}% using simple interest to the ${kind === "deposit" ? "lump sum" : "monthly contributions"} and assumes 15.4% general interest tax. Actual payment dates, calculations and tax treatment may differ.`,
    officialChecks: "Check bonus-rate requirements, pre- and after-tax proceeds, and deposit-protection status in the official terms.",
    eligibility: (value) => `Eligibility: ${value}`,
    specialConditions: (value) => `Bonus-rate conditions: ${value}`,
    disclaimer: "This is an educational suitability comparison based on your inputs and disclosed data, not personalized financial advice or a recommendation to enroll. Recheck rates, bonus conditions, and early-withdrawal terms with the financial institution immediately before enrollment.",
  },
  ja: {
    depositReady: "まとまった資金を一括で預ける定期預金方式に合っています。",
    depositMissing: "預入可能な一括金額を入力すると比較精度が上がります。",
    savingReady: "毎月積み立てる積立預金方式に合っています。",
    savingMissing: "毎月積立可能な金額を入力すると比較精度が上がります。",
    term: (term, target, difference) => `${term}か月の条件は、希望する${target}か月と${difference === 0 ? "一致します" : `${difference}か月の差があります`}。`,
    checkTerm: "公式商品ページで加入期間を確認してください。",
    checkLiquidity: "中途解約金利と緊急時の引出し可否を確認してください。",
    channelMatch: (channel) => `${channel === "online" ? "非対面" : "窓口"}での加入経路が公示されています。`,
    channelCheck: (channel) => `希望する${channel === "online" ? "非対面" : "窓口"}加入が可能か確認してください。`,
    rate: (rate, basis) => `この期間で公示された${basis === "base" ? "基本" : "最高"}年利は${rate}%です。`,
    estimateAssumption: (kind, basis, rate) => `${kind === "deposit" ? "一括預入額" : "毎月の積立額"}に公示${basis === "base" ? "基本" : "最高"}年利${rate}%を単利で適用し、一般課税15.4%を仮定した概算です。実際の入金日、利息計算、税制により異なる場合があります。`,
    officialChecks: "優遇金利条件、税引前・税引後受取額、預金保護の対象かを公式原文で確認してください。",
    eligibility: (value) => `加入対象：${value}`,
    specialConditions: (value) => `優遇条件：${value}`,
    disclaimer: "この結果は入力値と公示情報を比較した教育用の適合度であり、個別の金融助言や加入勧誘ではありません。金利・優遇条件・中途解約条件は、加入直前に金融機関の公式原文で再確認してください。",
  },
  zh: {
    depositReady: "该产品适合一次性存入一笔资金的定期存款方式。",
    depositMissing: "输入可一次性存入的金额可提高比较准确度。",
    savingReady: "该产品适合按月缴存的定期储蓄方式。",
    savingMissing: "输入每月可缴存金额可提高比较准确度。",
    term: (term, target, difference) => `${term}个月期限与期望的${target}个月${difference === 0 ? "一致" : `相差${difference}个月`}。`,
    checkTerm: "请在产品官方页面核对可办理期限。",
    checkLiquidity: "请核对提前支取利率以及是否支持紧急取款。",
    channelMatch: (channel) => `该产品公示支持${channel === "online" ? "线上" : "网点"}办理。`,
    channelCheck: (channel) => `请确认是否可以通过${channel === "online" ? "线上" : "网点"}办理。`,
    rate: (rate, basis) => `该期限公示的${basis === "base" ? "基础" : "最高"}年利率为${rate}%。`,
    estimateAssumption: (kind, basis, rate) => `该估算以${kind === "deposit" ? "一次性存款金额" : "每月缴存金额"}按公示${basis === "base" ? "基础" : "最高"}年利率${rate}%计算单利，并假设一般利息税率为15.4%。实际缴存日期、计息方法和税务处理可能不同。`,
    officialChecks: "请在官方条款中核对优惠利率条件、税前及税后金额和存款保障范围。",
    eligibility: (value) => `办理对象：${value}`,
    specialConditions: (value) => `优惠条件：${value}`,
    disclaimer: "该结果仅是基于输入值和公示信息的教育性适合度比较，不构成个性化金融建议或办理推荐。办理前请向金融机构重新核对利率、优惠条件及提前支取条款。",
  },
};

export function recommendFinancialProducts(
  items: readonly PublicInformationItem[],
  input: ProductRecommendationInput,
  localeOrLimit: ProductRecommendationLocale | number = "ko",
  requestedLimit = 5,
): ProductRecommendation[] {
  const locale = typeof localeOrLimit === "string" && PRODUCT_RECOMMENDATION_LOCALES.includes(localeOrLimit)
    ? localeOrLimit
    : "ko";
  const limit = typeof localeOrLimit === "number" ? localeOrLimit : requestedLimit;
  const copy = RECOMMENDATION_COPY[locale];
  const normalizedInput = normalizeRecommendationInput(input);
  const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()];
  const candidates = uniqueItems.flatMap((item) => {
    const product = item.financialProduct ?? legacyProduct(item);
    if (!product || (normalizedInput.productKind !== "either" && product.kind !== normalizedInput.productKind)) return [];
    return [{
      item,
      product,
      term: bestTerm(product.terms, normalizedInput.targetTermMonths, normalizedInput.liquidityNeed),
    }];
  });
  const highestRate = Math.max(0, ...candidates.map((candidate) => rankingRate(candidate.term) ?? 0));

  const scored = candidates.map(({ item, product, term }) => {
    const reasons: string[] = [];
    const checks: string[] = [];
    let score = normalizedInput.productKind === "either" || normalizedInput.productKind === product.kind ? 25 : 0;

    const fundingReady = product.kind === "deposit"
      ? normalizedInput.availableLumpSum > 0
      : normalizedInput.monthlyContribution > 0;
    score += fundingScore(product.kind, normalizedInput);
    reasons.push(product.kind === "deposit"
      ? fundingReady ? copy.depositReady : copy.depositMissing
      : fundingReady ? copy.savingReady : copy.savingMissing);

    if (term?.termMonths !== null && term?.termMonths !== undefined) {
      const difference = Math.abs(term.termMonths - normalizedInput.targetTermMonths);
      const termScore = Math.max(0, 25 * (1 - difference / Math.max(12, normalizedInput.targetTermMonths)));
      score += termScore;
      reasons.push(copy.term(term.termMonths, normalizedInput.targetTermMonths, difference));
    } else {
      score += 8;
      checks.push(copy.checkTerm);
    }

    const liquidity = liquidityScore(normalizedInput.liquidityNeed, term?.termMonths ?? null);
    score += liquidity;
    if (normalizedInput.liquidityNeed === "high") checks.push(copy.checkLiquidity);

    const enrollmentMatch = channelMatch(product.joinMethods, normalizedInput.preferredChannel);
    score += normalizedInput.preferredChannel === "any"
      ? 10
      : enrollmentMatch === "match"
        ? 10
        : enrollmentMatch === "unknown"
          ? 4
          : 2;
    if (normalizedInput.preferredChannel !== "any") {
      const selectedChannel = normalizedInput.preferredChannel as Exclude<JoinChannel, "any">;
      (enrollmentMatch === "match" ? reasons : checks).push(enrollmentMatch === "match"
        ? copy.channelMatch(selectedChannel)
        : copy.channelCheck(selectedChannel));
    }

    const rate = rateOf(term);
    const disclosedRateBasis = rateBasis(term);
    const comparableRate = rankingRate(term);
    score += comparableRate !== null && highestRate > 0 ? 5 * comparableRate / highestRate : 0;
    if (rate !== null && disclosedRateBasis) reasons.push(copy.rate(rate, disclosedRateBasis));
    const estimate = estimatedReturn(product, term, normalizedInput);
    if (estimate) {
      checks.push(copy.estimateAssumption(product.kind, estimate.rateBasis, estimate.annualRate));
    }
    checks.push(copy.officialChecks);
    if (product.eligibility) checks.push(copy.eligibility(product.eligibility));
    if (product.specialConditions) checks.push(copy.specialConditions(product.specialConditions));

    const recommendation: ProductRecommendation = {
      itemId: item.id,
      title: item.title,
      provider: product.provider,
      kind: product.kind,
      score: Math.round(Math.min(100, Math.max(0, score))),
      termMonths: term?.termMonths ?? null,
      baseRate: term?.baseRate ?? null,
      maximumRate: term?.maximumRate ?? null,
      estimate,
      reasons: reasons.slice(0, 4),
      checks: [...new Set(checks)].slice(0, 5),
      sourceUrl: item.sourceUrl,
      asOf: item.publishedAt,
    };
    return { recommendation, enrollmentMatch };
  });

  const channelPriority = (value: ChannelMatch) => (
    normalizedInput.preferredChannel === "any" ? 0 : value === "match" ? 2 : value === "unknown" ? 1 : 0
  );
  return scored.sort((left, right) => (
    channelPriority(right.enrollmentMatch) - channelPriority(left.enrollmentMatch)
    || right.recommendation.score - left.recommendation.score
    || left.recommendation.title.localeCompare(right.recommendation.title, "ko")
    || left.recommendation.itemId.localeCompare(right.recommendation.itemId, "en")
  ))
    .map(({ recommendation }) => recommendation)
    .slice(0, Math.min(200, Math.max(1, Math.floor(limit))));
}

export const PRODUCT_RECOMMENDATION_DISCLAIMER =
  RECOMMENDATION_COPY.ko.disclaimer;

export function productRecommendationDisclaimer(locale: ProductRecommendationLocale = "ko") {
  return RECOMMENDATION_COPY[locale]?.disclaimer ?? RECOMMENDATION_COPY.ko.disclaimer;
}
