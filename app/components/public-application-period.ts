import { publicApplicationPeriod } from "@/lib/public-data/dates";
import type { PublicInformationItem } from "@/lib/public-data/types";

const copy = {
  ko: { heading: "신청기간", start: "시작", end: "마감", missing: "미확인", verify: "공식 원문 확인 필요",
    upcoming: "모집 예정", "within-period": "기재된 신청기간 내 · 원문 확인", "deadline-known": "마감일 확인 · 시작일 미확인", expired: "마감", unknown: "신청기간 확인 필요" },
  en: { heading: "Application period", start: "Starts", end: "Deadline", missing: "Unknown", verify: "Check the official notice",
    upcoming: "Upcoming", "within-period": "Within stated dates · verify officially", "deadline-known": "Deadline known · start unknown", expired: "Closed", unknown: "Application dates need checking" },
  ja: { heading: "申込期間", start: "開始", end: "締切", missing: "未確認", verify: "公式原文で確認してください",
    upcoming: "募集予定", "within-period": "記載の申込期間内・原文確認", "deadline-known": "締切確認・開始日未確認", expired: "締切済み", unknown: "申込期間の確認が必要" },
  zh: { heading: "申请期间", start: "开始", end: "截止", missing: "未确认", verify: "请核实官方原文",
    upcoming: "即将开始", "within-period": "在所载申请期间内 · 请核实原文", "deadline-known": "截止日已知 · 开始日未知", expired: "已截止", unknown: "申请日期需确认" },
} as const;

/** Only application-like records get an application label, never news or indicators. */
export function applicationPeriodView(item: PublicInformationItem, locale: keyof typeof copy, now = Date.now()) {
  if (!["youth", "startup", "employment"].includes(item.category)
    || item.commercialArea || item.employmentStatistic || item.financialProduct
    || /^(?:youth-policy-news-|moel-news-)/u.test(item.id)) return null;
  const period = publicApplicationPeriod(item, now);
  const text = copy[locale];
  const invalidOrder = period.startsAt && period.expiresAt && period.startsAt > period.expiresAt;
  const dates = invalidOrder || (!period.startsAt && !period.expiresAt)
    ? text.verify
    : `${text.start} ${period.startsAt ?? text.missing} · ${text.end} ${period.expiresAt ?? text.missing}`;
  return { status: period.status, heading: text.heading, label: text[period.status], dates };
}
