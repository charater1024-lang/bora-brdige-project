import type { Metadata } from "next";

export const dynamic = "force-dynamic";

import LegalPolicyPage, {
  legalPolicyLocale,
} from "@/app/components/legal-policy-page";

export const metadata: Metadata = {
  title: "개인정보 처리방침",
  description: "BORA Bridge가 처리하는 OAuth 계정, 직접 입력 금융정보와 선택형 AI 맥락의 목적·보유·삭제 방법을 안내합니다.",
  alternates: { canonical: "/privacy" },
};

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const params = await searchParams;
  return <LegalPolicyPage kind="privacy" locale={legalPolicyLocale(params.lang)} />;
}
