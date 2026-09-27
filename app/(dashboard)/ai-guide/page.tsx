import type { Metadata } from "next";
import HomePage from "@/app/page";

export const metadata: Metadata = {
  title: "AI 금융 상담",
  description: "공식 근거를 우선하는 AI 금융 상담과 대화 주제·소비 인사이트를 확인합니다.",
  alternates: { canonical: "/ai-guide" },
};

export default function AiGuidePage() {
  return <HomePage initialView="ai" />;
}
