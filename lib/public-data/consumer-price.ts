import type { PublicInformationItem } from "./types";

export type ConsumerPriceLocale = "ko" | "en" | "ja" | "zh";
export type ConsumerPriceMeasure = "index" | "rate" | "value" | "unavailable";

export interface ConsumerPriceInsight {
  available: boolean;
  measure: ConsumerPriceMeasure;
  numericValue: number | null;
  displayValue: string;
  baseYear: number | null;
  differenceFromBase: number | null;
  label: string;
  unavailableLabel: string;
  headline: string;
  meaningLabel: string;
  meaning: string;
  comparisonLabel: string;
  comparison: string;
  cautionLabel: string;
  caution: string;
  sourceLabel: string;
}

const localeTags: Record<ConsumerPriceLocale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const copy: Record<ConsumerPriceLocale, {
  label: string;
  unavailable: string;
  unavailableHeadline: string;
  unavailableMeaning: string;
  unavailableComparison: string;
  unavailableCaution: string;
  meaningLabel: string;
  comparisonLabel: string;
  cautionLabel: string;
  sourceLabel: string;
  indexMeaning: string;
  indexNoBase: string;
  indexComparison: string;
  indexAbove: (difference: string, year: number) => string;
  indexBelow: (difference: string, year: number) => string;
  indexSame: (year: number) => string;
  indexCaution: string;
  rateMeaning: string;
  rateAbove: (value: string) => string;
  rateBelow: (value: string) => string;
  rateSame: string;
  rateComparison: string;
  rateCaution: string;
  valueMeaning: string;
  valueHeadline: (value: string) => string;
  valueComparison: string;
  valueCaution: string;
}> = {
  ko: {
    label: "소비자물가",
    unavailable: "미제공",
    unavailableHeadline: "아직 확인할 수 있는 소비자물가 값이 없어요.",
    unavailableMeaning: "공식 데이터가 들어오면 생활물가의 전반적인 수준을 쉬운 문장으로 설명해 드려요.",
    unavailableComparison: "값이 없을 때는 상승·하락을 추정하지 않습니다.",
    unavailableCaution: "새로고침 이후에도 값이 없으면 한국은행 ECOS 연결 상태를 확인해 주세요.",
    meaningLabel: "무슨 숫자인가요?",
    comparisonLabel: "어떻게 읽나요?",
    cautionLabel: "꼭 알아두세요",
    sourceLabel: "한국은행 공식 자료 확인",
    indexMeaning: "여러 가구가 자주 구매하는 상품과 서비스의 전체 가격 수준을 하나의 숫자로 나타낸 지수예요.",
    indexNoBase: "기준 시점을 100으로 두고 현재 가격 수준을 비교하는 지수예요. 정확한 기준연도는 공식 자료에서 확인해 주세요.",
    indexComparison: "100보다 크면 기준연도보다 전반적인 가격 수준이 높고, 100보다 작으면 낮다는 뜻이에요.",
    indexAbove: (difference, year) => `${year}년 평균을 100으로 볼 때, 대표 소비 품목의 가격 수준이 약 ${difference}% 높다는 뜻이에요.`,
    indexBelow: (difference, year) => `${year}년 평균을 100으로 볼 때, 대표 소비 품목의 가격 수준이 약 ${difference}% 낮다는 뜻이에요.`,
    indexSame: (year) => `${year}년 평균을 100으로 볼 때, 대표 소비 품목의 가격 수준이 기준과 비슷하다는 뜻이에요.`,
    indexCaution: "이 지수는 전월 대비 상승률이 아니며, 개인의 실제 생활비가 같은 비율로 변했다는 뜻도 아니에요.",
    rateMeaning: "공식 통계가 정한 비교 기간과 비교해 소비자물가가 얼마나 변했는지를 백분율로 나타낸 값이에요.",
    rateAbove: (value) => `공식 통계의 비교 기간보다 소비자물가가 약 ${value}% 높아졌다는 뜻이에요.`,
    rateBelow: (value) => `공식 통계의 비교 기간보다 소비자물가가 약 ${value}% 낮아졌다는 뜻이에요.`,
    rateSame: "공식 통계의 비교 기간과 소비자물가 수준이 거의 같다는 뜻이에요.",
    rateComparison: "전월 대비인지 전년 같은 달 대비인지는 지표 이름과 공식 원문에서 확인해 주세요.",
    rateCaution: "평균적인 물가 움직임이므로 개인의 소비 품목과 지출 변화는 다를 수 있어요.",
    valueMeaning: "한국은행이 제공한 소비자물가 관련 공식 표시값이에요.",
    valueHeadline: (value) => `현재 공식 표시값은 ${value}입니다.`,
    valueComparison: "단위나 비교 기준이 확인되지 않아 상승·하락으로 해석하지 않았어요.",
    valueCaution: "정확한 단위와 기준은 한국은행 공식 자료에서 확인해 주세요.",
  },
  en: {
    label: "Consumer prices",
    unavailable: "Not available",
    unavailableHeadline: "No consumer-price value is available yet.",
    unavailableMeaning: "When official data arrives, this card explains the overall price level in plain language.",
    unavailableComparison: "We do not infer an increase or decrease when no value is available.",
    unavailableCaution: "If it remains empty after a refresh, check the Bank of Korea ECOS connection.",
    meaningLabel: "What is this?",
    comparisonLabel: "How do I read it?",
    cautionLabel: "Keep in mind",
    sourceLabel: "Check Bank of Korea data",
    indexMeaning: "It combines the prices of goods and services commonly bought by households into one index.",
    indexNoBase: "The index compares the current price level with a reference period set to 100. Check the official source for the exact base year.",
    indexComparison: "A value above 100 means the overall price level is higher than in the base year; below 100 means it is lower.",
    indexAbove: (difference, year) => `With the ${year} average set to 100, the representative basket's price level is about ${difference}% higher.`,
    indexBelow: (difference, year) => `With the ${year} average set to 100, the representative basket's price level is about ${difference}% lower.`,
    indexSame: (year) => `With the ${year} average set to 100, the representative basket's price level is close to the reference level.`,
    indexCaution: "This index is not a month-over-month inflation rate, and your own living costs may change differently.",
    rateMeaning: "It shows the consumer-price change over the comparison period defined by the official statistic.",
    rateAbove: (value) => `Consumer prices are about ${value}% higher than in the statistic's comparison period.`,
    rateBelow: (value) => `Consumer prices are about ${value}% lower than in the statistic's comparison period.`,
    rateSame: "Consumer prices are nearly unchanged from the statistic's comparison period.",
    rateComparison: "Check the indicator name and official source to see whether the comparison is monthly or annual.",
    rateCaution: "This is an average movement; your spending mix and actual expenses can differ.",
    valueMeaning: "This is the official consumer-price value supplied by the Bank of Korea.",
    valueHeadline: (value) => `The current official value is ${value}.`,
    valueComparison: "The unit or comparison basis is unclear, so no upward or downward interpretation is shown.",
    valueCaution: "Check the Bank of Korea source for the exact unit and reference period.",
  },
  ja: {
    label: "消費者物価",
    unavailable: "未提供",
    unavailableHeadline: "確認できる消費者物価の値がまだありません。",
    unavailableMeaning: "公式データが届くと、物価全体の水準を分かりやすく説明します。",
    unavailableComparison: "値がない場合、上昇・下落を推測しません。",
    unavailableCaution: "更新後も値がない場合は、韓国銀行ECOSの接続状態をご確認ください。",
    meaningLabel: "どんな数字ですか？",
    comparisonLabel: "どう読みますか？",
    cautionLabel: "ご注意ください",
    sourceLabel: "韓国銀行の公式資料を確認",
    indexMeaning: "家庭がよく購入する商品・サービスの価格水準を一つの数字で表した指数です。",
    indexNoBase: "基準時点を100として現在の価格水準を比べる指数です。正確な基準年は公式資料でご確認ください。",
    indexComparison: "100より大きければ基準年より全体の価格水準が高く、100より小さければ低いという意味です。",
    indexAbove: (difference, year) => `${year}年平均を100とすると、代表的な消費品目の価格水準が約${difference}%高いという意味です。`,
    indexBelow: (difference, year) => `${year}年平均を100とすると、代表的な消費品目の価格水準が約${difference}%低いという意味です。`,
    indexSame: (year) => `${year}年平均を100とすると、代表的な消費品目の価格水準が基準とほぼ同じという意味です。`,
    indexCaution: "この指数は前月比の上昇率ではなく、個人の生活費が同じ割合で変化したという意味でもありません。",
    rateMeaning: "公式統計が定めた比較期間に対する消費者物価の変化を百分率で示した値です。",
    rateAbove: (value) => `公式統計の比較期間より消費者物価が約${value}%上昇したという意味です。`,
    rateBelow: (value) => `公式統計の比較期間より消費者物価が約${value}%低下したという意味です。`,
    rateSame: "公式統計の比較期間と消費者物価の水準がほぼ同じという意味です。",
    rateComparison: "前月比か前年同月比かは、指標名と公式資料でご確認ください。",
    rateCaution: "平均的な物価の動きであり、個人の購入品目や支出の変化とは異なる場合があります。",
    valueMeaning: "韓国銀行が提供する消費者物価関連の公式表示値です。",
    valueHeadline: (value) => `現在の公式表示値は${value}です。`,
    valueComparison: "単位や比較基準を確認できないため、上昇・下落として解釈していません。",
    valueCaution: "正確な単位と基準は韓国銀行の公式資料でご確認ください。",
  },
  zh: {
    label: "消费者价格",
    unavailable: "暂无数据",
    unavailableHeadline: "目前还没有可确认的消费者价格数据。",
    unavailableMeaning: "官方数据到达后，本卡片会用简单语言说明整体物价水平。",
    unavailableComparison: "没有数据时，不推测上涨或下降。",
    unavailableCaution: "刷新后仍无数据时，请检查韩国银行ECOS的连接状态。",
    meaningLabel: "这是什么数字？",
    comparisonLabel: "应该怎样理解？",
    cautionLabel: "请注意",
    sourceLabel: "查看韩国银行官方资料",
    indexMeaning: "这是把家庭常买的商品和服务的整体价格水平合并成一个数字的指数。",
    indexNoBase: "该指数把基准时期设为100，用来比较当前价格水平。准确基准年度请查看官方资料。",
    indexComparison: "高于100表示整体价格水平高于基准年度，低于100则表示低于基准年度。",
    indexAbove: (difference, year) => `以${year}年平均为100时，代表性消费项目的价格水平约高${difference}%。`,
    indexBelow: (difference, year) => `以${year}年平均为100时，代表性消费项目的价格水平约低${difference}%。`,
    indexSame: (year) => `以${year}年平均为100时，代表性消费项目的价格水平与基准大致相同。`,
    indexCaution: "该指数不是环比涨幅，也不表示个人生活费按相同比例变化。",
    rateMeaning: "它表示与官方统计规定的比较期相比，消费者价格变化了多少。",
    rateAbove: (value) => `消费者价格较该统计的比较期约上涨${value}%。`,
    rateBelow: (value) => `消费者价格较该统计的比较期约下降${value}%。`,
    rateSame: "消费者价格与该统计的比较期基本持平。",
    rateComparison: "属于环比还是同比，请查看指标名称和官方原文。",
    rateCaution: "这是平均物价走势，个人的消费结构和实际支出变化可能不同。",
    valueMeaning: "这是韩国银行提供的消费者价格相关官方显示值。",
    valueHeadline: (value) => `当前官方显示值为${value}。`,
    valueComparison: "由于无法确认单位或比较基准，因此不解释为上涨或下降。",
    valueCaution: "准确单位和基准请查看韩国银行官方资料。",
  },
};

function leadingNumber(value: string) {
  const matched = value.trim().match(/^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/u);
  if (!matched) return null;
  const parsed = Number(matched[1].replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function detectedBaseYear(corpus: string) {
  const match = corpus.match(/\b((?:19|20)\d{2})\s*=\s*100\b/u);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isInteger(year) ? year : null;
}

function formatted(value: number, locale: ConsumerPriceLocale) {
  return new Intl.NumberFormat(localeTags[locale], { maximumFractionDigits: 2 }).format(value);
}

export function consumerPriceInsight(
  item: Pick<PublicInformationItem, "title" | "summary" | "tags"> | null,
  locale: ConsumerPriceLocale = "ko",
): ConsumerPriceInsight {
  const t = copy[locale];
  const numericValue = item ? leadingNumber(item.summary) : null;
  if (numericValue === null) {
    return {
      available: false,
      measure: "unavailable",
      numericValue: null,
      displayValue: "—",
      baseYear: null,
      differenceFromBase: null,
      label: t.label,
      unavailableLabel: t.unavailable,
      headline: t.unavailableHeadline,
      meaningLabel: t.meaningLabel,
      meaning: t.unavailableMeaning,
      comparisonLabel: t.comparisonLabel,
      comparison: t.unavailableComparison,
      cautionLabel: t.cautionLabel,
      caution: t.unavailableCaution,
      sourceLabel: t.sourceLabel,
    };
  }

  const corpus = `${item?.title ?? ""} ${item?.summary ?? ""} ${(item?.tags ?? []).join(" ")}`;
  const baseYear = detectedBaseYear(corpus);
  const rate = /(?:%|퍼센트|상승률|증감률|inflation\s*rate|change\s*rate|変動率|上昇率|涨幅|同比|环比)/iu.test(corpus);
  const index = baseYear !== null || /(?:소비자물가지수|consumer\s*price\s*index|\bcpi\b|消費者物価指数|居民消费价格指数|消费者价格指数)/iu.test(corpus);
  const valueText = formatted(numericValue, locale);

  if (rate) {
    const absolute = formatted(Math.abs(numericValue), locale);
    return {
      available: true,
      measure: "rate",
      numericValue,
      displayValue: `${valueText}%`,
      baseYear: null,
      differenceFromBase: null,
      label: t.label,
      unavailableLabel: t.unavailable,
      headline: numericValue > 0 ? t.rateAbove(absolute) : numericValue < 0 ? t.rateBelow(absolute) : t.rateSame,
      meaningLabel: t.meaningLabel,
      meaning: t.rateMeaning,
      comparisonLabel: t.comparisonLabel,
      comparison: t.rateComparison,
      cautionLabel: t.cautionLabel,
      caution: t.rateCaution,
      sourceLabel: t.sourceLabel,
    };
  }

  if (index) {
    const difference = baseYear === null ? null : numericValue - 100;
    const absolute = difference === null ? "" : formatted(Math.abs(difference), locale);
    return {
      available: true,
      measure: "index",
      numericValue,
      displayValue: baseYear === null ? valueText : `${valueText} (${baseYear}=100)`,
      baseYear,
      differenceFromBase: difference,
      label: t.label,
      unavailableLabel: t.unavailable,
      headline: baseYear === null
        ? t.indexNoBase
        : difference! > 0
          ? t.indexAbove(absolute, baseYear)
          : difference! < 0
            ? t.indexBelow(absolute, baseYear)
            : t.indexSame(baseYear),
      meaningLabel: t.meaningLabel,
      meaning: t.indexMeaning,
      comparisonLabel: t.comparisonLabel,
      comparison: baseYear === null ? t.indexNoBase : t.indexComparison,
      cautionLabel: t.cautionLabel,
      caution: t.indexCaution,
      sourceLabel: t.sourceLabel,
    };
  }

  return {
    available: true,
    measure: "value",
    numericValue,
    displayValue: valueText,
    baseYear: null,
    differenceFromBase: null,
    label: t.label,
    unavailableLabel: t.unavailable,
    headline: t.valueHeadline(valueText),
    meaningLabel: t.meaningLabel,
    meaning: t.valueMeaning,
    comparisonLabel: t.comparisonLabel,
    comparison: t.valueComparison,
    cautionLabel: t.cautionLabel,
    caution: t.valueCaution,
    sourceLabel: t.sourceLabel,
  };
}
