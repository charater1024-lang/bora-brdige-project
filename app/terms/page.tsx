import type { Metadata } from "next";

export const dynamic = "force-dynamic";

import LegalPolicyPage, {
  legalPolicyLocale,
} from "@/app/components/legal-policy-page";

export const metadata: Metadata = {
  title: "이용약관",
  description: "BORA Bridge 금융정보·AI 안내 서비스의 이용 범위, 공식 원문 확인 원칙과 이용자 책임을 안내합니다.",
  alternates: { canonical: "/terms" },
};

export default async function TermsPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const params = await searchParams;
  return <LegalPolicyPage kind="terms" locale={legalPolicyLocale(params.lang)} />;
}
