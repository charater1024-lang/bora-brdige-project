import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "자동평가 센터로 이동",
  description: "이전 심사 경로를 별도 자동평가 센터로 연결합니다.",
  robots: { index: false, follow: false },
};

export default function DeveloperJudgeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
