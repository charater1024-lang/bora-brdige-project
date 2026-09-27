import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "마이페이지",
  description: "로그인 계정, 직접 입력한 금융 정보, AI 개인화 및 개인정보 설정을 관리합니다.",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

export default function MyPageLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
