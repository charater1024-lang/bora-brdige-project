import type { Metadata } from "next";
import HomePage from "@/app/page";

export const metadata: Metadata = {
  title: "자산 장부",
  description: "직접 입력한 자산과 월 현금흐름을 계정에 저장하고 자산 형성 목표를 확인합니다.",
  alternates: { canonical: "/assets" },
};

export default function AssetsPage() {
  return <HomePage initialView="assets" />;
}
