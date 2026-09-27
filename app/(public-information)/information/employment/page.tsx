import type { Metadata } from "next";
import { PublicCategoryPage } from "@/app/components/public-information-pages";

export const metadata: Metadata = {
  title: "대상별 취업 통계",
  description: "공식 고용통계에서 청년·고령층·외국인 지표를 기준시점과 함께 확인합니다.",
  alternates: { canonical: "/information/employment" },
};

export default function EmploymentInformationPage() {
  return <PublicCategoryPage category="employment" />;
}
