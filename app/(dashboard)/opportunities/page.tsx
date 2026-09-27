import type { Metadata } from "next";
import HomePage from "@/app/page";

export const metadata: Metadata = {
  title: "맞춤 기회",
  description: "청년 정책, 창업 지원, 금융 정착 정보를 분야별 전용 페이지와 함께 확인합니다.",
  alternates: { canonical: "/opportunities" },
};

export default function OpportunitiesPage() {
  return <HomePage initialView="opportunity" />;
}
