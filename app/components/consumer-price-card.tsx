"use client";

import { ChevronDown, ExternalLink, ShoppingBasket } from "lucide-react";

import { consumerPriceInsight } from "@/lib/public-data/consumer-price";
import type { PublicInformationItem } from "@/lib/public-data/types";
import { safePublicHttpUrl } from "@/lib/public-data/urls";
import type { PublicInformationLocale } from "./public-information-layout";
import styles from "./consumer-price-card.module.css";

const localeTags: Record<PublicInformationLocale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const asOfCopy: Record<PublicInformationLocale, string> = {
  ko: "기준",
  en: "As of",
  ja: "基準",
  zh: "截至",
};

function formatDate(value: string | null | undefined, locale: PublicInformationLocale) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(localeTags[locale], {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

export function ConsumerPriceCard({
  item,
  locale,
}: {
  item: PublicInformationItem | null;
  locale: PublicInformationLocale;
}) {
  const insight = consumerPriceInsight(item, locale);
  const publishedAt = item ? formatDate(item.publishedAt, locale) : null;
  const sourceUrl = item ? safePublicHttpUrl(item.sourceUrl) : null;

  return (
    <details className={styles.card} data-measure={insight.measure}>
      <summary className={styles.summary}>
        <span className={styles.icon} aria-hidden="true"><ShoppingBasket size={21} /></span>
        <span className={styles.metric}>
          <small>{insight.label}</small>
          <strong>{insight.displayValue}</strong>
          <em>{publishedAt ? `${asOfCopy[locale]} ${publishedAt}` : insight.unavailableLabel}</em>
        </span>
        <ChevronDown className={styles.chevron} size={18} aria-hidden="true" />
      </summary>
      <div className={styles.body}>
        <p className={styles.headline}>{insight.headline}</p>
        <dl className={styles.explanations}>
          <div>
            <dt>{insight.meaningLabel}</dt>
            <dd>{insight.meaning}</dd>
          </div>
          <div>
            <dt>{insight.comparisonLabel}</dt>
            <dd>{insight.comparison}</dd>
          </div>
          <div className={styles.caution}>
            <dt>{insight.cautionLabel}</dt>
            <dd>{insight.caution}</dd>
          </div>
        </dl>
        {sourceUrl && (
          <a className={styles.source} href={sourceUrl} target="_blank" rel="noopener noreferrer">
            {insight.sourceLabel}<ExternalLink size={13} aria-hidden="true" />
          </a>
        )}
      </div>
    </details>
  );
}
