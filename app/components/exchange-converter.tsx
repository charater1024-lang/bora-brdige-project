"use client";

import { ArrowLeftRight, Calculator } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import {
  convertExchangeAmount,
  normalizeGroupedDecimalInput,
  parseGroupedNumber,
  type ExchangeDirection,
} from "@/lib/money-input";
import styles from "./exchange-converter.module.css";

type Locale = "ko" | "en" | "ja" | "zh";

const localeTags: Record<Locale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const copy = {
  ko: {
    title: "양방향 환율 계산",
    direction: "환산 방향",
    foreignToKrw: "외화 → 원화",
    krwToForeign: "원화 → 외화",
    amount: "환산할 금액",
    result: "예상 환산 금액",
    swap: "환산 방향 바꾸기",
    unavailable: "공식 환율이 수집되면 계산할 수 있어요.",
    note: "공식 기준 환율 참고값이며 실제 환전 수수료와 적용 환율은 다를 수 있습니다.",
  },
  en: {
    title: "Two-way currency converter",
    direction: "Conversion direction",
    foreignToKrw: "Foreign → KRW",
    krwToForeign: "KRW → Foreign",
    amount: "Amount to convert",
    result: "Estimated conversion",
    swap: "Swap conversion direction",
    unavailable: "Conversion becomes available after an official rate is collected.",
    note: "This official reference rate may differ from the actual rate and fees applied by your provider.",
  },
  ja: {
    title: "双方向為替計算",
    direction: "換算方向",
    foreignToKrw: "外貨 → ウォン",
    krwToForeign: "ウォン → 外貨",
    amount: "換算する金額",
    result: "換算目安",
    swap: "換算方向を切り替える",
    unavailable: "公式レートが収集されると計算できます。",
    note: "公式基準レートの参考値であり、実際の適用レートや手数料とは異なる場合があります。",
  },
  zh: {
    title: "双向汇率换算",
    direction: "换算方向",
    foreignToKrw: "外币 → 韩元",
    krwToForeign: "韩元 → 外币",
    amount: "换算金额",
    result: "预计换算金额",
    swap: "切换换算方向",
    unavailable: "采集到官方汇率后即可换算。",
    note: "此为官方基准汇率参考值，实际适用汇率及手续费可能不同。",
  },
} satisfies Record<Locale, Record<string, string>>;

function formattedResult(
  value: number | null,
  target: "KRW" | string,
  locale: Locale,
) {
  if (value === null) return "—";
  const fractionDigits = target === "KRW" && Math.abs(value) < 100 ? 2 : target === "KRW" ? 0 : 4;
  return new Intl.NumberFormat(localeTags[locale], {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: 0,
  }).format(value);
}

function caretFromLogicalRight(value: string, logicalRight: number) {
  let position = value.length;
  let remaining = Math.max(0, logicalRight);
  while (position > 0 && remaining > 0) {
    position -= 1;
    if (value[position] !== ",") remaining -= 1;
  }
  return position;
}

export function ExchangeConverter({
  locale,
  currency,
  baseRate,
  compact = false,
}: {
  locale: Locale;
  currency: string;
  baseRate: number | null;
  compact?: boolean;
}) {
  const t = copy[locale];
  const noteId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [direction, setDirection] = useState<ExchangeDirection>("foreign-to-krw");
  const [amount, setAmount] = useState("1");
  const sourceCurrency = direction === "foreign-to-krw" ? currency : "KRW";
  const targetCurrency = direction === "foreign-to-krw" ? "KRW" : currency;
  const parsedAmount = parseGroupedNumber(amount);
  const converted = useMemo(
    () => convertExchangeAmount(parsedAmount ?? 0, baseRate ?? 0, direction),
    [baseRate, direction, parsedAmount],
  );
  const oneForeignInKrw = baseRate && baseRate > 0 ? baseRate : null;
  const thousandKrwInForeign = useMemo(
    () => convertExchangeAmount(1_000, baseRate ?? 0, "krw-to-foreign"),
    [baseRate],
  );

  function changeAmount(value: string, selectionStart: number | null) {
    const normalized = normalizeGroupedDecimalInput(
      value,
      sourceCurrency === "KRW" ? 0 : 4,
    );
    const logicalRight = value.slice(selectionStart ?? value.length).replaceAll(",", "").length;
    setAmount(normalized);
    window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || document.activeElement !== input) return;
      const nextCaret = caretFromLogicalRight(normalized, logicalRight);
      input.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function changeDirection(nextDirection: ExchangeDirection) {
    if (nextDirection === direction) return;
    const nextSource = nextDirection === "foreign-to-krw" ? currency : "KRW";
    const carriedAmount = converted === null
      ? nextSource === "KRW" ? "1,000,000" : "1"
      : normalizeGroupedDecimalInput(
        new Intl.NumberFormat("en-US", {
          useGrouping: false,
          maximumFractionDigits: nextSource === "KRW" ? 0 : 4,
        }).format(converted),
        nextSource === "KRW" ? 0 : 4,
      );
    setDirection(nextDirection);
    setAmount(carriedAmount);
  }

  return (
    <section className={`${styles.converter} ${compact ? styles.compact : ""}`} aria-labelledby={`${noteId}-title`}>
      <div className={styles.heading}>
        <span><Calculator size={15} /></span>
        <strong id={`${noteId}-title`}>{t.title}</strong>
      </div>
      <div className={styles.direction} role="group" aria-label={t.direction}>
        <button
          type="button"
          aria-pressed={direction === "foreign-to-krw"}
          onClick={() => changeDirection("foreign-to-krw")}
        >
          {currency} → KRW
        </button>
        <button
          type="button"
          aria-pressed={direction === "krw-to-foreign"}
          onClick={() => changeDirection("krw-to-foreign")}
        >
          KRW → {currency}
        </button>
      </div>
      <div className={styles.ratePair} aria-label={`${currency} KRW ${t.title}`}>
        <span>1 {currency} = <strong>{oneForeignInKrw === null ? "—" : `₩${formattedResult(oneForeignInKrw, "KRW", locale)}`}</strong></span>
        <span>₩1,000 = <strong>{thousandKrwInForeign === null ? "—" : `${formattedResult(thousandKrwInForeign, currency, locale)} ${currency}`}</strong></span>
      </div>
      <div className={styles.calculation}>
        <label>
          <span>{t.amount}</span>
          <span className={styles.amountField}>
            <input
              ref={inputRef}
              type="text"
              inputMode={sourceCurrency === "KRW" ? "numeric" : "decimal"}
              autoComplete="off"
              value={amount}
              onChange={(event) => changeAmount(event.target.value, event.target.selectionStart)}
              aria-describedby={noteId}
            />
            <em>{sourceCurrency}</em>
          </span>
        </label>
        <button
          className={styles.swap}
          type="button"
          onClick={() => changeDirection(direction === "foreign-to-krw" ? "krw-to-foreign" : "foreign-to-krw")}
          aria-label={t.swap}
          title={t.swap}
        >
          <ArrowLeftRight size={17} />
        </button>
        <div className={styles.result} role="status" aria-live="polite">
          <span>{t.result}</span>
          <strong>{formattedResult(converted, targetCurrency, locale)}</strong>
          <em>{targetCurrency}</em>
        </div>
      </div>
      <p id={noteId}>{baseRate && baseRate > 0 ? t.note : t.unavailable}</p>
    </section>
  );
}
