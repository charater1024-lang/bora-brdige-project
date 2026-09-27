"use client";

import { ForeignSettlementCopilot } from "@/app/components/foreign-settlement-copilot";
import { usePublicInformationLocale } from "@/app/components/public-information-layout";

export default function ForeignSettlementPage() {
  const locale = usePublicInformationLocale();
  return (
    <ForeignSettlementCopilot
      locale={locale}
      exchangeHref="/exchange"
      employmentHref="/information/employment"
    />
  );
}
