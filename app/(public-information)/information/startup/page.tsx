import type { Metadata } from "next";
import { PublicCategoryPage } from "@/app/components/public-information-pages";

export const metadata: Metadata = {
  title: "창업·상권 정보",
  description: "공식 창업 지원사업과 위치 좌표가 제공된 상권 정보를 목록과 지도에서 확인합니다.",
  alternates: { canonical: "/information/startup" },
};

export default function StartupInformationPage() {
  return <PublicCategoryPage category="startup" />;
}
