import type { Metadata, Viewport } from "next";
import { configuredPublicOrigin } from "@/lib/auth/config";
import { BoraFloatingGuide } from "./components/bora-floating-guide";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = new URL(
    (await configuredPublicOrigin()) ?? "https://borabridge.com",
  );
  const title = "BORA Bridge | 오늘의 금융 행동을 잇는 AI 동반자";
  const description =
    "공식 공공정보와 사용자가 직접 입력한 금융 프로필을 바탕으로 오늘의 자산·정책·안심 행동 하나를 안내하는 포용적 AI 금융 서비스입니다.";
  const socialImage = new URL("/og-action-home.png", metadataBase).toString();

  return {
    metadataBase,
    title: { default: title, template: "%s | BORA Bridge" },
    description,
    applicationName: "BORA Bridge",
    alternates: { canonical: "/" },
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
      shortcut: "/favicon.svg",
      apple: "/favicon.svg",
    },
    keywords: ["포용금융", "AI 금융", "금융사기 예방", "청년 자산형성", "외국인 금융정착", "RAG"],
    openGraph: {
      type: "website",
      url: "/",
      title,
      description,
      siteName: "BORA Bridge",
      images: [
        {
          url: socialImage,
          width: 1733,
          height: 908,
          alt: "오늘 해야 할 금융 행동 하나부터 시작하는 BORA Bridge",
        },
      ],
    },
    twitter: { card: "summary_large_image", title, description, images: [socialImage] },
  };
}

export const viewport: Viewport = {
  themeColor: "#f7f4ff",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        {children}
        <BoraFloatingGuide />
      </body>
    </html>
  );
}
