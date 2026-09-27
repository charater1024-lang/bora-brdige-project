import type { Metadata } from "next";
import { PublicCategoryPage } from "@/app/components/public-information-pages";

export const metadata: Metadata = {
  title: "금융 정보",
  description: "공식 API에서 수집한 금융상품, 공시, 시장 정보를 출처와 함께 확인합니다.",
  alternates: { canonical: "/information/finance" },
};

export default function FinanceInformationPage() {
  return <PublicCategoryPage category="finance" />;
}
