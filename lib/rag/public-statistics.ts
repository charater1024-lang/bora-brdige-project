import { safePublicHttpUrl } from "../public-data/urls";
import type {
  PublicDataDashboard,
  PublicInformationItem,
} from "../public-data/types";
import { normalizeRagText } from "./query";

const EMPLOYMENT_TOPIC = /(?:취업|취직|고용|실업|경제활동|일자리|\b(?:employment|unemployment|labou?r|jobs?|out\s+of\s+work)\b|雇用|就業|就職|失業|就业|失业)/iu;
const STATISTICS_INTENT = /(?:통계|수치|비율|비중|현황|추이|흐름|지표|퍼센트|몇\s*프로|얼마나|몇\s*명|숫자|(?:고용|실업|경제활동|취업)\s*자료|\b(?:rates?|statistics?|figures?|trends?|percent(?:age)?|how\s+many|how\s+much)\b|\b(?:employment|unemployment|labou?r)\s+data\b|統計|数値|比率|推移|何人|何パーセント|どのくらい|统计|数值|比例|趋势|多少|百分之)/iu;
const EXPLICIT_EMPLOYMENT_METRIC = /(?:고용률|취업률|실업률|경제활동참가율|(?:취업자|고용자|실업자)\s*수|就業率|就職率|雇用率|失業率|就业率|失业率|就业人数|失业人数)/iu;

export type PublicEmploymentStatisticsSource = {
  id: string;
  title: string;
  publisher: "KOSIS 국가통계포털";
  url: string;
  reviewedAt: string;
};

export function detectEmploymentStatisticsIntent(message: string) {
  const normalized = normalizeRagText(message.slice(0, 24_000));
  return EXPLICIT_EMPLOYMENT_METRIC.test(normalized)
    || (EMPLOYMENT_TOPIC.test(normalized)
      && (STATISTICS_INTENT.test(normalized) || /%/u.test(message.slice(0, 24_000).normalize("NFKC"))));
}

function employmentItems(dashboard: Pick<PublicDataDashboard, "categories">) {
  return (dashboard.categories
    .find((category) => category.id === "employment")
    ?.items ?? [])
    .filter((item): item is PublicInformationItem & {
      employmentStatistic: NonNullable<PublicInformationItem["employmentStatistic"]>;
    } => Boolean(item.employmentStatistic))
    .slice(0, 12);
}

export function formatPublicEmploymentStatisticsContext(
  dashboard: Pick<PublicDataDashboard, "categories" | "cached" | "stale" | "lastSuccessfulAt">,
) {
  const items = employmentItems(dashboard);
  if (!dashboard.cached || !items.length) {
    return [
      "CURRENT KOSIS EMPLOYMENT STATISTICS",
      "No validated employment-statistics record is available in the shared cache.",
      "Do not guess a current value. Direct the user to the official KOSIS source.",
    ].join("\n");
  }
  return [
    "CURRENT KOSIS EMPLOYMENT STATISTICS (SHARED CACHE ONLY)",
    `Cache status: ${dashboard.stale ? "last-valid" : "current"}; last successful collection: ${dashboard.lastSuccessfulAt ?? "unknown"}.`,
    "Youth/older-adult supplementary surveys and the foreigner annual survey use different populations and reference periods. Never compare them as one common denominator.",
    ...items.map((item) => {
      const statistic = item.employmentStatistic;
      const metrics = statistic.metrics
        .map((metric) => `${metric.name}=${metric.value}${metric.unit}`)
        .join("; ");
      return [
        `[${item.id}]`,
        `group=${statistic.groupLabel}; period=${statistic.period}; table=${statistic.tableId}`,
        `metrics=${metrics}`,
        `definition=${item.summary.slice(0, 800)}`,
        `source=${item.sourceUrl}`,
      ].join("\n");
    }),
  ].join("\n\n");
}

export function publicEmploymentStatisticsSources(
  dashboard: Pick<PublicDataDashboard, "categories">,
): PublicEmploymentStatisticsSource[] {
  return employmentItems(dashboard).flatMap((item) => {
    const url = safePublicHttpUrl(item.sourceUrl);
    if (!url) return [];
    return [{
      id: item.id,
      title: item.title,
      publisher: "KOSIS 국가통계포털" as const,
      url,
      reviewedAt: (item.lastVerifiedAt ?? item.discoveredAt).slice(0, 10),
    }];
  });
}
