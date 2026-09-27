import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { absolute: "BORA Bridge란? | 서비스 소개" },
  description:
    "공식 금융·정책 정보와 사용자가 직접 입력한 내용을 바탕으로 청년·외국인·예비창업자의 오늘 할 일을 연결하는 BORA Bridge 서비스 소개입니다.",
  alternates: { canonical: "/challenge" },
  other: { "bora-page-marker": "bora-challenge-2026-v1" },
  openGraph: {
    type: "website",
    url: "/challenge",
    siteName: "BORA Bridge",
    locale: "ko_KR",
    title: "BORA Bridge | 오늘의 금융 행동을 잇는 AI 동반자",
    description: "금융 정보를 공식 근거와 안전한 다음 행동으로 연결합니다.",
    images: [
      {
        url: "/og-challenge.png",
        width: 1731,
        height: 909,
        alt: "BORA Bridge 포용금융 AI 서비스의 네 가지 핵심 경험",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "BORA Bridge | 오늘의 금융 행동을 잇는 AI 동반자",
    description: "금융 정보를 공식 근거와 안전한 다음 행동으로 연결합니다.",
    images: ["/og-challenge.png"],
  },
};

export default function ChallengeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
