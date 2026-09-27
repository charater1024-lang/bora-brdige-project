import type { PublicDataDashboard } from "../public-data/types";
import type { RagEvidenceSource } from "./context";
import { safePublicHttpUrl } from "../public-data/urls";

export function publicIndicatorsRequested(query: string) {
  return /환율|원달러|달러|엔화|유로|exchange rate|usd|krw|jpy|cny|為替|汇率|코스피|코스닥|kospi|kosdaq/iu.test(query);
}

export function publicIndicatorSources(query: string, dashboard: PublicDataDashboard): RagEvidenceSource[] {
  if (!dashboard.cached) return [];
  const sources: RagEvidenceSource[] = [];
  const currencies: Array<[string, RegExp]> = [
    ["USD", /달러|미국|usd|dollar|ドル|美元/iu], ["JPY", /엔화|일본|jpy|yen|円|日元/iu],
    ["CNY", /위안|중국|cny|yuan|人民元|人民币/iu], ["EUR", /유로|eur|euro|ユーロ|欧元/iu],
    ["GBP", /파운드|gbp|pound|英镑/iu], ["CAD", /캐나다|cad|canadian/iu],
    ["AUD", /호주|aud|australian/iu], ["SGD", /싱가포르|sgd|singapore/iu],
  ];
  const requested = currencies.filter(([, pattern]) => pattern.test(query)).map(([currency]) => currency);
  const exchangeIntent = /환율|원달러|달러|엔화|유로|exchange|usd|krw|jpy|cny|為替|汇率/iu.test(query);
  if (exchangeIntent) {
    const selected = requested.length ? requested : ["USD"];
    const url = safePublicHttpUrl(dashboard.exchange.sourceUrl);
    for (const rate of dashboard.exchange.rates.filter((rate) => selected.includes(rate.currency)).slice(0, 2)) {
      if (!url || !Number.isFinite(rate.baseRate) || rate.baseRate <= 0) continue;
      const inverse = (1 / rate.baseRate).toFixed(8);
      const value = rate.baseRate.toLocaleString("en-US", { maximumFractionDigits: 6 });
      sources.push({ id: `exchange:${rate.currency}`, title: `${rate.currency}/KRW 환율`,
        excerpt: `기준일: ${dashboard.exchange.asOf ?? "미확인"}\n1 ${rate.currency} = ${value} KRW\n1 KRW = ${inverse} ${rate.currency}\n최근 수집된 매매기준율. 실시간 체결 환율이나 환전 수수료 포함 금액이 아닙니다.`,
        publisher: dashboard.exchange.source, url, reviewedAt: "",
        publishedAt: dashboard.exchange.asOf, kind: "indicator" });
    }
  }
  for (const point of dashboard.market.filter((point) =>
    /코스피|kospi/iu.test(query) && /코스피|kospi/iu.test(`${point.id} ${point.name}`)
      || /코스닥|kosdaq/iu.test(query) && /코스닥|kosdaq/iu.test(`${point.id} ${point.name}`)).slice(0, 2)) {
    const url = safePublicHttpUrl(point.sourceUrl);
    if (!url || !Number.isFinite(point.value) || !Number.isFinite(point.change) || !Number.isFinite(point.changeRate)) continue;
    sources.push({ id: `market:${point.id}`, title: point.name,
      excerpt: `기준일: ${point.asOf ?? "미확인"}\n지수: ${point.value}; 등락: ${point.change}; 등락률: ${point.changeRate}%\n최근 수집 관측값이며 실시간 시세가 아닙니다.`,
      publisher: "공식 시장 지표", url, reviewedAt: "",
      publishedAt: point.asOf, kind: "indicator" });
  }
  return sources;
}
