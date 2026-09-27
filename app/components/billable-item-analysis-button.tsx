"use client";

import type { PublicInformationLocale } from "./public-information-layout";

const copy: Record<PublicInformationLocale, { label: string; confirm: (runtime: string) => string }> = {
  ko: {
    label: "유료 AI 설명 1회 생성",
    confirm: (runtime) => `${runtime}을(를) 이 항목에 한해 1회 호출합니다. 실제 API 요금이 청구될 수 있습니다. 생성할까요?`,
  },
  en: {
    label: "Generate once with paid AI",
    confirm: (runtime) => `This makes one ${runtime} call for this item. The API provider may charge a fee. Continue?`,
  },
  ja: {
    label: "有料AIで1回だけ生成",
    confirm: (runtime) => `この項目に限り${runtime}を1回呼び出します。API料金が発生する場合があります。生成しますか？`,
  },
  zh: {
    label: "使用付费AI生成一次",
    confirm: (runtime) => `仅针对本项目调用一次${runtime}，可能产生实际API费用。是否生成？`,
  },
};

export function BillableItemAnalysisButton({
  locale,
  pending,
  provider,
  model,
  onApprove,
}: {
  locale: PublicInformationLocale;
  pending: boolean;
  provider: string;
  model: string;
  onApprove: () => void;
}) {
  const text = copy[locale];
  return <button
    type="button"
    disabled={pending}
    onClick={() => {
      if (window.confirm(text.confirm(`${provider} · ${model}`))) onApprove();
    }}
  >{text.label}</button>;
}
