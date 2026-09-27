"use client";

import { ArrowDown, ArrowRight, CircleAlert, ExternalLink, ShieldCheck, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import type {
  PublicInformationItem,
  StartupAnnouncementPersonalizationSummary,
  StartupRecommendationSignal,
  YouthPolicyProfileField,
} from "@/lib/public-data/types";
import { safePublicHttpUrl } from "@/lib/public-data/urls";
import type { PublicInformationLocale } from "./public-information-layout";
import styles from "./startup-announcement-recommendations.module.css";

const copy = {
  ko: {
    eyebrow: "BORA AI STARTUP MATCH",
    title: "내 정보로 먼저 보는 창업 공고",
    lead: "보리가 저장된 광역지역·현재 상태·관심분야와 공식 공고 태그를 대조해 검토 순서를 정합니다.",
    sign_in_required: ["로그인하면 맞춤 후보를 만들 수 있어요", "공식 창업 공고 전체 목록은 아래에서 로그인 없이도 확인할 수 있습니다."],
    personalization_disabled: ["맞춤 정보 사용이 꺼져 있어요", "마이페이지에서 청년정책·기회 맞춤 정보를 켜면 창업 공고도 함께 선별합니다."],
    profile_incomplete: ["맞춤 정보가 더 필요해요", "광역지역, 현재 상태 또는 관심분야 중 하나 이상을 입력해 주세요."],
    no_matches: ["현재 확인된 맞춤 후보가 없어요", "무관한 공고를 억지로 추천하지 않습니다. 전체 공고를 검색하거나 다음 공식 데이터 갱신 후 다시 확인해 주세요."],
    cta: "마이페이지에서 정보 관리",
    recommended: "우선 검토",
    official: "공식 공고 확인",
    explain: "아래 상세 목록에서 AI 설명 보기",
    deadline: "신청 마감",
    missing: "입력하면 더 정교해지는 정보",
    caution: "이 결과는 신청 자격을 확정하지 않습니다. 상세 자격·지역·업력·제외 조건은 반드시 공식 공고에서 확인하세요.",
    method: "무료 구조화 매칭으로 순위를 만들고, 공고를 펼칠 때 활성 AI가 설명합니다. 유료 AI는 자동 호출하지 않습니다.",
    mascotAlt: "방패를 든 BORA 가이드 마스코트 보리",
    fields: { birthYear: "출생연도", region: "거주 광역지역", status: "현재 상태", interests: "관심분야" },
    signals: {
      preferred_region: "선호 지역",
      nationwide: "전국 대상",
      startup_interest: "창업 관심",
      prospective_founder: "예비창업 단계",
      active_business: "사업 운영 단계",
      youth_focus: "청년 대상",
      recent_notice: "최근 공고",
    },
  },
  en: {
    eyebrow: "BORA AI STARTUP MATCH",
    title: "Startup notices matched to your profile",
    lead: "Bori prioritizes official notices using your saved region, current status and interests.",
    sign_in_required: ["Sign in to create a shortlist", "The complete official startup list remains available below without signing in."],
    personalization_disabled: ["Personalization is off", "Turn on youth-policy and opportunity personalization in My Page to screen startup notices too."],
    profile_incomplete: ["Add a little profile information", "Enter at least one of your region, current status or interests."],
    no_matches: ["No supported match was found", "We do not force unrelated notices into the shortlist. Search all notices or check again after the next official-data update."],
    cta: "Manage profile",
    recommended: "Review first",
    official: "Open official notice",
    explain: "Open AI explanation in the full list",
    deadline: "Closes",
    missing: "Add these for a finer match",
    caution: "This shortlist does not confirm eligibility. Verify detailed eligibility, region, business age and exclusions in the official notice.",
    method: "Free structured matching sets the order, and the active AI explains a notice when you open it. Billable AI is never called automatically.",
    mascotAlt: "Bori, the BORA guide mascot holding a shield",
    fields: { birthYear: "Birth year", region: "Region", status: "Current status", interests: "Interests" },
    signals: {
      preferred_region: "Preferred region",
      nationwide: "Nationwide",
      startup_interest: "Startup interest",
      prospective_founder: "Prospective founder",
      active_business: "Active business",
      youth_focus: "Youth focus",
      recent_notice: "Recent notice",
    },
  },
  ja: {
    eyebrow: "BORA AI STARTUP MATCH",
    title: "自分の情報で先に見る創業公募",
    lead: "ボリが保存済みの地域・現在の状況・関心分野と公式公募タグを照合し、確認順を整理します。",
    sign_in_required: ["ログインすると候補を絞り込めます", "公式の創業公募一覧はログインせずに下で確認できます。"],
    personalization_disabled: ["パーソナライズはオフです", "マイページで政策・機会のパーソナライズをオンにすると創業公募も選別します。"],
    profile_incomplete: ["プロフィール情報がもう少し必要です", "地域、現在の状況、関心分野のいずれかを入力してください。"],
    no_matches: ["確認できた候補はありません", "無関係な公募を無理に推薦しません。全公募を検索するか、次回の公式データ更新後に再確認してください。"],
    cta: "マイページで情報を管理",
    recommended: "優先確認",
    official: "公式公募を確認",
    explain: "下の一覧でAI説明を見る",
    deadline: "申請締切",
    missing: "追加すると精度が上がる情報",
    caution: "この結果は申請資格を確定しません。詳細資格、地域、業歴、除外条件は公式公募で必ず確認してください。",
    method: "無料の構造化照合で順序を作り、公募を開くと有効なAIが説明します。有料AIは自動呼び出ししません。",
    mascotAlt: "盾を持つBORAガイドのマスコット、ボリ",
    fields: { birthYear: "出生年", region: "居住地域", status: "現在の状況", interests: "関心分野" },
    signals: {
      preferred_region: "希望地域",
      nationwide: "全国対象",
      startup_interest: "創業への関心",
      prospective_founder: "創業前段階",
      active_business: "事業運営段階",
      youth_focus: "若者対象",
      recent_notice: "最近の公募",
    },
  },
  zh: {
    eyebrow: "BORA AI STARTUP MATCH",
    title: "根据我的资料优先查看创业公告",
    lead: "Bori会把已保存的地区、当前状态和关注领域与官方公告标签进行核对并安排查看顺序。",
    sign_in_required: ["登录后可生成候选清单", "无需登录也能在下方查看全部官方创业公告。"],
    personalization_disabled: ["个性化功能已关闭", "在我的页面开启政策与机会个性化后，也会筛选创业公告。"],
    profile_incomplete: ["还需要少量资料", "请至少填写地区、当前状态或关注领域中的一项。"],
    no_matches: ["目前没有可确认的候选", "不会勉强推荐无关公告。请搜索全部公告，或等待下一次官方数据更新后重试。"],
    cta: "在我的页面管理资料",
    recommended: "优先查看",
    official: "查看官方公告",
    explain: "在下方列表查看AI说明",
    deadline: "申请截止",
    missing: "补充后可提高精度",
    caution: "此结果不代表已确认申请资格。详细资格、地区、经营年限和排除条件必须以官方公告为准。",
    method: "免费结构化匹配负责排序，展开公告时由当前启用的AI进行说明。付费AI不会被自动调用。",
    mascotAlt: "手持盾牌的BORA向导吉祥物Bori",
    fields: { birthYear: "出生年份", region: "居住地区", status: "当前状态", interests: "关注领域" },
    signals: {
      preferred_region: "偏好地区",
      nationwide: "全国范围",
      startup_interest: "创业关注",
      prospective_founder: "筹备创业",
      active_business: "经营阶段",
      youth_focus: "青年对象",
      recent_notice: "近期公告",
    },
  },
} satisfies Record<PublicInformationLocale, {
  eyebrow: string;
  title: string;
  lead: string;
  sign_in_required: [string, string];
  personalization_disabled: [string, string];
  profile_incomplete: [string, string];
  no_matches: [string, string];
  cta: string;
  recommended: string;
  official: string;
  explain: string;
  deadline: string;
  missing: string;
  caution: string;
  method: string;
  mascotAlt: string;
  fields: Record<YouthPolicyProfileField, string>;
  signals: Record<StartupRecommendationSignal, string>;
}>;

function displayDate(value: string | null | undefined, locale: PublicInformationLocale) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const tag = { ko: "ko-KR", en: "en-US", ja: "ja-JP", zh: "zh-CN" }[locale];
  return new Intl.DateTimeFormat(tag, { year: "numeric", month: "short", day: "numeric" }).format(parsed);
}

export function startupAnnouncementDomId(itemId: string) {
  return `startup-announcement-${itemId.replace(/[^0-9a-z_-]+/giu, "-")}`;
}

export function StartupAnnouncementRecommendations({
  items,
  summary,
  locale,
  loading,
}: {
  items: PublicInformationItem[];
  summary?: StartupAnnouncementPersonalizationSummary;
  locale: PublicInformationLocale;
  loading: boolean;
}) {
  if (loading || !summary) return null;
  const t = copy[locale];
  const recommended = items
    .filter((item) => Boolean(item.startupMatch))
    .sort((left, right) => (left.startupMatch?.rank ?? 99) - (right.startupMatch?.rank ?? 99));
  const attentionStatus = summary.status !== "ready";
  const emptyCopy = summary.status === "ready"
    ? null
    : t[summary.status];

  return <section className={styles.shell} data-state={attentionStatus ? "attention" : "ready"} aria-labelledby="startup-ai-match-title">
    <div className={styles.mascot}>
      <Image src="/bora-mascot.webp" width={128} height={128} sizes="128px" alt={t.mascotAlt} priority={false} unoptimized />
    </div>
    <div className={styles.content}>
      <header>
        <span><Sparkles size={14} />{t.eyebrow}</span>
        <h2 id="startup-ai-match-title">{t.title}</h2>
        <p>{t.lead}</p>
      </header>
      {emptyCopy && <div className={styles.empty}>
        <CircleAlert size={18} />
        <div><strong>{emptyCopy[0]}</strong><p>{emptyCopy[1]}</p></div>
        {summary.status !== "no_matches" && <Link href={summary.profilePath}>{t.cta}<ArrowRight size={14} /></Link>}
      </div>}
      {recommended.length > 0 && <ol className={styles.cards}>
        {recommended.map((item) => {
          const match = item.startupMatch!;
          const officialUrl = safePublicHttpUrl(item.sourceUrl);
          const deadline = displayDate(item.expiresAt, locale);
          return <li key={item.id}>
            <div className={styles.rank}><small>{t.recommended}</small><strong>{match.rank}</strong></div>
            <div className={styles.cardBody}>
              <small>{item.source}</small>
              <h3>{item.title}</h3>
              <div className={styles.signals}>{match.signals.map((signal) => <span key={signal}>{t.signals[signal]}</span>)}</div>
              {deadline && <p><ShieldCheck size={13} />{t.deadline} {deadline}</p>}
              <div className={styles.actions}>
                <a href={`#${startupAnnouncementDomId(item.id)}`}>{t.explain}<ArrowDown size={13} /></a>
                {officialUrl && <a href={officialUrl} target="_blank" rel="noopener noreferrer">{t.official}<ExternalLink size={13} /></a>}
              </div>
            </div>
          </li>;
        })}
      </ol>}
      {summary.missingProfileFields.length > 0 && summary.status === "ready" && <p className={styles.missing}>
        <strong>{t.missing}</strong>
        {summary.missingProfileFields.map((field) => t.fields[field]).join(" · ")}
      </p>}
      <footer><p>{t.caution}</p><small>{t.method}</small></footer>
    </div>
  </section>;
}
