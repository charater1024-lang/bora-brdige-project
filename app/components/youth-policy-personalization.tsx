"use client";

import { ArrowRight, CircleAlert, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

import type {
  PublicYouthPolicyMatch,
  YouthPolicyPersonalizationSummary,
  YouthPolicyProfileField,
} from "@/lib/public-data/types";
import type { PublicInformationLocale } from "./public-information-layout";
import styles from "./youth-policy-personalization.module.css";

const copy = {
  ko: {
    sign_in_required: ["로그인 후 정책을 선별해 드려요", "청년정책을 한꺼번에 보여주지 않고, 내가 직접 입력한 정보로 조건을 확인합니다."],
    personalization_disabled: ["청년정책 개인화가 꺼져 있어요", "개인화를 켜기 전에는 조건이 맞는지 확인되지 않은 정책을 표시하지 않습니다."],
    profile_incomplete: ["맞춤 정보를 조금 더 입력해 주세요", "아래 항목이 있어야 조건을 확인할 수 있습니다:"],
    ready: ["조건이 확인된 정책만 모았어요", "입력 정보와 공식 데이터의 구조화 조건이 일치한 후보만 표시합니다."],
    no_matches: ["현재 확인된 정책 후보가 없어요", "무관한 정책을 대신 보여주지 않습니다. 맞춤 정보를 확인하거나 공식 데이터 갱신 후 다시 확인해 주세요."],
    cta: "마이페이지에서 맞춤 정보 관리",
    shown: "선별 후보",
    hidden: "조건 불일치·확인 불가로 숨김",
    matched: "확인된 조건",
    ageBoundaryConfirm: "출생연도만으로 연령 경계가 겹칩니다. 생일 기준 만 나이를 공식 공고에서 확인해 주세요.",
    confirm: "최종 신청 자격과 제외 조건은 공식 공고에서 다시 확인해 주세요.",
    fields: { birthYear: "출생연도", region: "거주 광역지역", status: "현재 상태", interests: "관심분야" },
  },
  en: {
    sign_in_required: ["Sign in to screen youth policies", "Instead of showing every policy, we compare structured conditions with information you enter yourself."],
    personalization_disabled: ["Youth-policy personalization is off", "Unscreened policies stay hidden until you turn personalization on."],
    profile_incomplete: ["Add a little more profile information", "These fields are needed to check the available conditions:"],
    ready: ["Only screened policy candidates are shown", "These candidates match the structured official-data conditions and your entered profile."],
    no_matches: ["No screened policy candidates right now", "We will not fill the page with unrelated policies. Review your profile or check again after an official-data update."],
    cta: "Manage policy profile",
    shown: "Screened",
    hidden: "Hidden as mismatched or unverified",
    matched: "Matched fields",
    ageBoundaryConfirm: "Your birth year overlaps an age boundary. Confirm age as of your birthday in the official notice.",
    confirm: "Confirm final eligibility and exclusions in the official notice.",
    fields: { birthYear: "Birth year", region: "Region", status: "Current status", interests: "Interests" },
  },
  ja: {
    sign_in_required: ["ログイン後に青年政策を絞り込みます", "すべての政策を並べず、自分で入力した情報と構造化された条件を照合します。"],
    personalization_disabled: ["青年政策のパーソナライズはオフです", "オンにするまでは、条件を確認できない政策を表示しません。"],
    profile_incomplete: ["プロフィール情報を少し追加してください", "条件確認には次の項目が必要です："],
    ready: ["条件を確認できた政策候補だけを表示しています", "入力情報と公式データの構造化条件が一致した候補です。"],
    no_matches: ["現在、確認済みの政策候補はありません", "無関係な政策で埋めず、プロフィール確認または公式データ更新後に再確認してください。"],
    cta: "マイページで情報を管理",
    shown: "候補",
    hidden: "不一致・確認不可で非表示",
    matched: "一致した項目",
    ageBoundaryConfirm: "出生年だけでは年齢条件の境界が重なります。誕生日基準の満年齢を公式公告で確認してください。",
    confirm: "最終的な申請資格と除外条件は公式公告で再確認してください。",
    fields: { birthYear: "出生年", region: "居住地域", status: "現在の状況", interests: "関心分野" },
  },
  zh: {
    sign_in_required: ["登录后为你筛选青年政策", "不会一次展示所有政策，而是用你主动填写的信息核对结构化条件。"],
    personalization_disabled: ["青年政策个性化已关闭", "开启前，不展示尚未确认是否符合条件的政策。"],
    profile_incomplete: ["请再补充少量资料", "核对条件需要以下项目："],
    ready: ["仅显示已核对条件的政策候选", "这些候选与你填写的资料及官方数据中的结构化条件相符。"],
    no_matches: ["目前没有已确认的政策候选", "不会用无关政策填充页面。请检查资料，或在官方数据更新后重试。"],
    cta: "在我的页面管理资料",
    shown: "筛选候选",
    hidden: "因不符或无法确认而隐藏",
    matched: "已匹配项目",
    ageBoundaryConfirm: "仅凭出生年份会落在年龄条件边界，请按生日计算周岁并在官方公告中确认。",
    confirm: "最终申请资格和排除条件请以官方公告为准。",
    fields: { birthYear: "出生年份", region: "居住地区", status: "当前状态", interests: "关注领域" },
  },
} satisfies Record<PublicInformationLocale, {
  sign_in_required: [string, string];
  personalization_disabled: [string, string];
  profile_incomplete: [string, string];
  ready: [string, string];
  no_matches: [string, string];
  cta: string;
  shown: string;
  hidden: string;
  matched: string;
  ageBoundaryConfirm: string;
  confirm: string;
  fields: Record<YouthPolicyProfileField, string>;
}>;

export function YouthPolicyPersonalizationBanner({
  summary,
  locale,
  loading,
}: {
  summary?: YouthPolicyPersonalizationSummary;
  locale: PublicInformationLocale;
  loading: boolean;
}) {
  if (loading || !summary) return null;
  const t = copy[locale];
  const [title, description] = t[summary.status];
  const active = summary.status === "ready";
  const Icon = active ? Sparkles : CircleAlert;
  return <section className={styles.banner} data-state={active ? "ready" : "attention"} aria-live="polite">
    <span className={styles.icon}><Icon size={20} /></span>
    <div className={styles.message}>
      <h2>{title}</h2>
      <p>{description}{summary.status === "profile_incomplete" && summary.missingProfileFields.length ? ` ${summary.missingProfileFields.map((field) => t.fields[field]).join(", ")}` : ""}</p>
      <dl><div><dt>{t.shown}</dt><dd>{summary.recommendedCount}</dd></div><div><dt>{t.hidden}</dt><dd>{summary.hiddenCount}</dd></div></dl>
    </div>
    <Link href={summary.profilePath}>{t.cta}<ArrowRight size={14} /></Link>
  </section>;
}

export function YouthPolicyMatchEvidence({
  match,
  locale,
}: {
  match?: PublicYouthPolicyMatch;
  locale: PublicInformationLocale;
}) {
  if (!match) return null;
  const t = copy[locale];
  const officialConfirmationFields = match.officialConfirmationFields ?? [];
  return <aside className={styles.evidence} aria-label={t.matched}>
    {match.matchedFields.length > 0 && <div><strong><Sparkles size={14} />{t.matched}</strong><span>{match.matchedFields.map((field) => t.fields[field]).join(" · ")}</span></div>}
    {officialConfirmationFields.includes("birthYear") && <p><CircleAlert size={14} />{t.ageBoundaryConfirm}</p>}
    <p><ShieldCheck size={14} />{t.confirm}</p>
  </aside>;
}
