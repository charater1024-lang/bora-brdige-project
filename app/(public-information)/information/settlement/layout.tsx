import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "외국인 금융 정착 안내",
  description: "국내 체류 외국인이 계좌·송금·환율·취업 정보를 공식 출처와 함께 확인할 수 있습니다.",
  alternates: { canonical: "/information/settlement" },
};

export default function SettlementLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
