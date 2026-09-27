import type { Metadata } from "next";
import HomePage from "@/app/page";

export const metadata: Metadata = {
  title: "금융 안전",
  description: "피싱 의심 메시지와 이상 징후를 점검하고 공식 금융 법령 안내를 확인합니다.",
  alternates: { canonical: "/safety" },
};

export default function SafetyPage() {
  return <HomePage initialView="safety" />;
}
