import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "자동평가 센터",
  description: "저장형 금융 평가 데이터셋과 별도 API 진단으로 제출 준비도를 재현합니다.",
  robots: { index: false, follow: false },
  other: { "bora-page-marker": "bora-developer-evaluation-v1" },
};

export default function EvaluationLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
