import { ArrowRight, BriefcaseBusiness, Globe2, Landmark, UserRound } from "lucide-react";
import Link from "next/link";

import styles from "./information-shortcuts.module.css";

type Locale = "ko" | "en" | "ja" | "zh";

const copy = {
  ko: {
    title: "필요한 정책·공식 정보 바로가기",
    lead: "한 화면에 모두 쌓지 않고 분야별 전용 페이지에서 필요한 정보만 확인하세요.",
    all: "정보 홈 전체 보기",
    links: [
      ["청년 정책", "학자금·금융지원·취업·정책뉴스"],
      ["금융 정보", "기준금리·대출금리·물가"],
      ["창업·상권", "지원 공고·주요 상권 분석"],
      ["외국인 정착", "계좌·송금·보험·세금 안내"],
    ],
  },
  en: {
    title: "Policy and official information shortcuts",
    lead: "Open a focused page for each topic instead of stacking everything on one screen.",
    all: "Open information home",
    links: [
      ["Youth policy", "Scholarships, finance, jobs and news"],
      ["Finance", "Base rate, loan rates and prices"],
      ["Startup & districts", "Support notices and district insights"],
      ["Settlement", "Accounts, transfers, insurance and tax"],
    ],
  },
  ja: {
    title: "政策・公式情報へのショートカット",
    lead: "一つの画面に詰め込まず、分野別ページで必要な情報だけ確認できます。",
    all: "情報ホームを見る",
    links: [
      ["若者政策", "奨学金・金融支援・就職・政策ニュース"],
      ["金融情報", "政策金利・貸出金利・物価"],
      ["創業・商圏", "支援公募・主要商圏分析"],
      ["金融定着", "口座・送金・保険・税金"],
    ],
  },
  zh: {
    title: "政策与官方信息快捷入口",
    lead: "按主题进入独立页面，只查看所需信息，避免内容堆积。",
    all: "查看信息首页",
    links: [
      ["青年政策", "助学、金融支持、就业与政策新闻"],
      ["金融信息", "基准利率、贷款利率与物价"],
      ["创业与商圈", "扶持公告与重点商圈分析"],
      ["金融落地", "账户、汇款、保险与税务"],
    ],
  },
} as const;

const destinations = [
  { href: "/information/youth", icon: UserRound },
  { href: "/information/finance", icon: Landmark },
  { href: "/information/startup", icon: BriefcaseBusiness },
  { href: "/information/settlement", icon: Globe2 },
] as const;

export function InformationShortcuts({
  locale,
  compact = false,
}: {
  locale: Locale;
  compact?: boolean;
}) {
  const t = copy[locale];
  return <section className={`${styles.section} ${compact ? styles.compact : ""}`} aria-labelledby="information-shortcuts-title">
    <div className={styles.heading}>
      <div>
        <h2 id="information-shortcuts-title">{t.title}</h2>
        <p>{t.lead}</p>
      </div>
      <Link href="/information">{t.all}<ArrowRight size={15} /></Link>
    </div>
    <div className={styles.links}>
      {destinations.map(({ href, icon: Icon }, index) => <Link href={href} key={href}>
        <span className={styles.icon}><Icon size={18} /></span>
        <span><strong>{t.links[index][0]}</strong><small>{t.links[index][1]}</small></span>
        <ArrowRight size={15} />
      </Link>)}
    </div>
  </section>;
}
