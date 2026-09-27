import type { Metadata } from "next";
import { PublicCategoryPage } from "@/app/components/public-information-pages";

export const metadata: Metadata = {
  title: "청년 정책 정보",
  description: "공식 제공기관의 청년 자산형성, 학자금, 금융지원 정보를 확인합니다.",
  alternates: { canonical: "/information/youth" },
};

export default function YouthInformationPage() {
  return <PublicCategoryPage category="youth" />;
}
