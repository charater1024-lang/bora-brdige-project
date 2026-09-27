import type { Metadata } from "next";
import { InformationHubPage } from "@/app/components/public-information-pages";

export const metadata: Metadata = {
  title: "공식 금융·정책 정보",
  description: "청년 정책, 금융 정보, 창업·상권 정보와 공식 환율을 분야별로 확인합니다.",
  alternates: { canonical: "/information" },
};

export default function InformationPage() {
  return <InformationHubPage />;
}
