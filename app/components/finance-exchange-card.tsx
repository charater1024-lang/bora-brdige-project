"use client";

import { ArrowRight, Banknote, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ExchangeConverter } from "./exchange-converter";
import type { PublicInformationLocale } from "./public-information-layout";
import styles from "./finance-exchange-card.module.css";

const currencies = ["USD", "JPY", "CNY", "EUR", "GBP", "CAD", "AUD", "SGD"];

const copy = {
  ko: {
    eyebrow: "EXCHANGE QUICK VIEW",
    title: "원화와 외화를 바로 계산해 보세요",
    lead: "서버에 저장된 가장 최근 한국수출입은행 기준 환율을 사용합니다.",
    currency: "통화 선택",
    loading: "저장된 환율 확인 중",
    unavailable: "아직 저장된 공식 환율이 없습니다.",
    detail: "1년 환율 그래프 보기",
    asOf: "기준일",
  },
  en: {
    eyebrow: "EXCHANGE QUICK VIEW",
    title: "Convert KRW and foreign currency now",
    lead: "Uses the latest Export-Import Bank of Korea reference rate saved on the server.",
    currency: "Currency",
    loading: "Checking saved rates",
    unavailable: "No official rate has been saved yet.",
    detail: "View one-year chart",
    asOf: "As of",
  },
  ja: {
    eyebrow: "EXCHANGE QUICK VIEW",
    title: "ウォンと外貨をすぐに換算",
    lead: "サーバーに保存された韓国輸出入銀行の最新基準レートを使用します。",
    currency: "通貨を選択",
    loading: "保存済みレートを確認中",
    unavailable: "保存済みの公式レートはまだありません。",
    detail: "1年チャートを見る",
    asOf: "基準日",
  },
  zh: {
    eyebrow: "EXCHANGE QUICK VIEW",
    title: "立即换算韩元与外币",
    lead: "使用服务器保存的韩国进出口银行最新基准汇率。",
    currency: "选择货币",
    loading: "正在检查已保存汇率",
    unavailable: "尚无已保存的官方汇率。",
    detail: "查看一年走势图",
    asOf: "基准日",
  },
} satisfies Record<PublicInformationLocale, Record<string, string>>;

type LatestRate = {
  currency: string;
  hasData: boolean;
  asOf?: string | null;
  summary?: { latest?: number };
};

export function FinanceExchangeCard({ locale }: { locale: PublicInformationLocale }) {
  const t = copy[locale];
  const [currency, setCurrency] = useState("USD");
  const [preferenceReady, setPreferenceReady] = useState(false);
  const [latestRate, setLatestRate] = useState<number | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem("bora-home-currency");
    const timer = window.setTimeout(() => {
      if (saved && currencies.includes(saved)) setCurrency(saved);
      setPreferenceReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferenceReady) return;
    const controller = new AbortController();
    fetch(`/api/public-data/exchange-history?currency=${encodeURIComponent(currency)}&range=30`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("exchange_history_unavailable");
      return await response.json() as LatestRate;
    }).then((result) => {
      const rate = result.currency === currency && result.hasData
        ? Number(result.summary?.latest)
        : 0;
      setLatestRate(Number.isFinite(rate) && rate > 0 ? rate : null);
      setAsOf(typeof result.asOf === "string" ? result.asOf : null);
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setLatestRate(null);
        setAsOf(null);
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [currency, preferenceReady]);

  function changeCurrency(value: string) {
    setLoading(true);
    setCurrency(value);
    window.localStorage.setItem("bora-home-currency", value);
  }

  return <section className={styles.card} aria-labelledby="finance-exchange-title">
    <header>
      <span><Banknote size={18} /></span>
      <div>
        <small>{t.eyebrow}</small>
        <h2 id="finance-exchange-title">{t.title}</h2>
        <p>{t.lead}</p>
      </div>
      <Link href="/exchange">{t.detail}<ArrowRight size={15} /></Link>
    </header>
    <div className={styles.controls}>
      <label>
        <span>{t.currency}</span>
        <select value={currency} onChange={(event) => changeCurrency(event.target.value)}>
          {currencies.map((item) => <option value={item} key={item}>{item}</option>)}
        </select>
      </label>
      <small>{loading ? <><RefreshCw size={13} className={styles.spin} />{t.loading}</> : latestRate ? `${t.asOf} ${asOf ?? "—"}` : t.unavailable}</small>
    </div>
    <ExchangeConverter
      locale={locale}
      currency={currency}
      baseRate={loading ? null : latestRate}
    />
  </section>;
}
