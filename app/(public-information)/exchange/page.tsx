import type { Metadata } from "next";
import ExchangeHistoryChart from "@/app/components/exchange-history-chart";

export const metadata: Metadata = {
  title: "공식 환율 시계열",
  description: "한국수출입은행에서 실제 수집한 일별 공식 환율 이력을 확인합니다.",
  alternates: { canonical: "/exchange" },
};

export default function ExchangePage() {
  return <ExchangeHistoryChart />;
}
