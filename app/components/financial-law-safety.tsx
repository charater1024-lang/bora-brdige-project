"use client";

import {
  BookOpenCheck,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Scale,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./financial-law-safety.module.css";

type Locale = "ko" | "en" | "ja" | "zh";
type Topic =
  | "financial_consumer"
  | "electronic_finance"
  | "credit_information"
  | "voice_phishing"
  | "deposit_protection"
  | "debt_collection";

const LAW_TOPIC_REQUEST_TIMEOUT_MS = 15_000;
const LAW_SUMMARY_REQUEST_TIMEOUT_MS = 45_000;

function AccessibleDisclosure({
  className,
  summary,
  children,
}: {
  className: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return <details
    className={className}
    onToggle={(event) => setExpanded(event.currentTarget.open)}
  >
    <summary aria-expanded={expanded} aria-controls={contentId}>{summary}</summary>
    <div id={contentId}>{children}</div>
  </details>;
}

type LawArticle = {
  id: string;
  articleNumber: string;
  title: string | null;
  text: string;
};

type LawRecord = {
  id: string;
  name: string;
  ministry: string;
  effectiveDate: string;
  retrievedAt: string;
  sourceUrl: string;
  articles: LawArticle[];
};

type GuidanceResponse = {
  status: "verified" | "stale";
  topic: Topic;
  retrievedAt: string;
  laws: LawRecord[];
};

type SummaryResponse = {
  status: "ready" | "approval-required" | "sign-in-required" | "generating" | "unavailable";
  summary?: string;
  generatedAt?: string | null;
  cache?: { hit?: boolean; shared?: boolean };
  contentMode?: "official-excerpts" | "ai-ordered-official-excerpts";
  reason?: string;
  approvalAvailable?: boolean;
  provider?: string | null;
  model?: string | null;
};

const copy = {
  ko: {
    eyebrow: "OFFICIAL LAW SAFETY GUIDE",
    title: "금융 법령 안심 가이드",
    lead: "상황과 가까운 주제를 고르면 국가법령정보에서 확인한 현행 법령과 관련 조문을 보여드립니다.",
    topics: {
      financial_consumer: "설명의무·청약철회",
      electronic_finance: "전자금융 피해",
      credit_information: "개인신용정보",
      voice_phishing: "보이스피싱 피해환급",
      deposit_protection: "예금자보호",
      debt_collection: "채권추심",
    },
    idle: "법률 문제를 자동으로 판정하지 않습니다. 먼저 주제를 선택해 공식 근거를 확인하세요.",
    loading: "현행 법령과 시행일을 확인하고 있습니다…",
    notConfigured: "국가법령정보 공동활용 OC 인증값이 아직 연결되지 않았습니다. 개발자 설정에서 키를 저장하고 사용을 켜면 동작합니다.",
    unavailable: "공식 법령 근거를 현재 확인할 수 없어 설명을 생성하지 않았습니다. 잠시 뒤 다시 확인해 주세요.",
    stale: "최근 정상 조회본이며 최신 여부를 다시 확인해야 합니다.",
    verified: "공식 현행 법령 확인",
    effective: "시행일",
    retrieved: "조회일",
    article: "관련 조문",
    original: "국가법령정보 원문",
    checklistTitle: "결정 전에 확인할 것",
    checklist: [
      "계약서·설명서·문자·이체 내역 등 원본을 보관하세요.",
      "조문의 적용 요건과 예외가 내 거래에 실제로 맞는지 확인하세요.",
      "해지·송금·신고처럼 되돌리기 어려운 행동 전에는 공식 기관이나 법률 전문가에게 사건별 확인을 받으세요.",
    ],
    disclaimer: "이 화면은 일반 정보와 공식 원문 탐색을 돕는 서비스이며 합법·불법, 책임, 승소 가능성 또는 안전을 확정하지 않습니다. 국가법령정보센터의 제공 내용 자체도 법적 효력의 확정 근거가 아니므로 실제 사건은 공포된 관보와 전문가 판단을 확인해야 합니다.",
  },
  en: {
    eyebrow: "OFFICIAL LAW SAFETY GUIDE",
    title: "Financial-law safety guide",
    lead: "Choose a topic to see current Korean laws and related articles verified through the official law service.",
    topics: {
      financial_consumer: "Disclosure & withdrawal",
      electronic_finance: "Electronic-finance loss",
      credit_information: "Personal credit data",
      voice_phishing: "Voice-phishing recovery",
      deposit_protection: "Deposit protection",
      debt_collection: "Debt collection",
    },
    idle: "This service does not decide a legal outcome. Choose a topic and start with official evidence.",
    loading: "Checking current laws and effective dates…",
    notConfigured: "The official Law Open Data OC credential is not connected. Save and enable it in Developer settings.",
    unavailable: "Official legal evidence could not be verified, so no explanation was generated. Please try again later.",
    stale: "This is the latest successful copy and needs a fresh verification.",
    verified: "Current official law verified",
    effective: "Effective",
    retrieved: "Retrieved",
    article: "Relevant articles",
    original: "Official law text",
    checklistTitle: "Check before acting",
    checklist: [
      "Keep original contracts, disclosures, messages and transfer records.",
      "Check whether each article's conditions and exceptions actually fit your transaction.",
      "Before an irreversible cancellation, transfer or report, obtain case-specific guidance from an official body or qualified lawyer.",
    ],
    disclaimer: "This is general information and an official-source finder. It does not determine legality, liability, likely success or safety. The online law service itself is not the final source of legal effect; confirm the promulgated text and case-specific professional advice.",
  },
  ja: {
    eyebrow: "OFFICIAL LAW SAFETY GUIDE",
    title: "金融法令の安心ガイド",
    lead: "テーマを選ぶと、国家法令情報で確認した現行法令と関連条文を表示します。",
    topics: {
      financial_consumer: "説明義務・申込み撤回",
      electronic_finance: "電子金融被害",
      credit_information: "個人信用情報",
      voice_phishing: "ボイスフィッシング被害還付",
      deposit_protection: "預金者保護",
      debt_collection: "債権回収",
    },
    idle: "法的結論を自動判定しません。まずテーマを選び、公式根拠を確認してください。",
    loading: "現行法令と施行日を確認しています…",
    notConfigured: "国家法令情報の共同活用OC認証値が未接続です。開発者設定で保存し、有効にしてください。",
    unavailable: "公式の法令根拠を確認できないため、説明を生成しませんでした。後でもう一度お試しください。",
    stale: "直近の正常取得版であり、最新確認が必要です。",
    verified: "現行公式法令を確認",
    effective: "施行日",
    retrieved: "取得日",
    article: "関連条文",
    original: "国家法令情報の原文",
    checklistTitle: "行動前の確認事項",
    checklist: [
      "契約書・説明書・メッセージ・送金記録などの原本を保存してください。",
      "条文の適用要件と例外が実際の取引に当てはまるか確認してください。",
      "解約・送金・申告などの前に、公的機関または法律専門家へ個別確認してください。",
    ],
    disclaimer: "一般情報と公式原文の確認を支援するもので、適法性・責任・勝訴可能性・安全性を確定しません。オンライン法令情報自体も法的効力の最終根拠ではないため、公布原文と専門家の判断を確認してください。",
  },
  zh: {
    eyebrow: "OFFICIAL LAW SAFETY GUIDE",
    title: "金融法规安心指南",
    lead: "选择主题后，查看通过韩国国家法令信息确认的现行法规与相关条文。",
    topics: {
      financial_consumer: "说明义务与撤回",
      electronic_finance: "电子金融损失",
      credit_information: "个人信用信息",
      voice_phishing: "语音诈骗损失返还",
      deposit_protection: "存款人保护",
      debt_collection: "债务催收",
    },
    idle: "本服务不会自动判定法律结论。请先选择主题并查看官方依据。",
    loading: "正在核对现行法规和施行日期…",
    notConfigured: "尚未连接国家法令信息共同利用OC认证值。请在开发者设置中保存并启用。",
    unavailable: "目前无法核实官方法规依据，因此未生成说明。请稍后重试。",
    stale: "这是最近一次成功查询的副本，需要再次确认是否最新。",
    verified: "已确认现行官方法规",
    effective: "施行日期",
    retrieved: "查询日期",
    article: "相关条文",
    original: "国家法令信息原文",
    checklistTitle: "行动前请确认",
    checklist: [
      "保存合同、说明书、短信和转账记录等原件。",
      "确认条文的适用条件与例外是否真正符合你的交易。",
      "在解除合同、汇款或举报等难以撤回的行动前，向官方机构或法律专业人士进行个案确认。",
    ],
    disclaimer: "本页面仅提供一般信息并帮助查找官方原文，不判定合法性、责任、胜诉可能性或安全性。在线法令信息本身也不是法律效力的最终依据，实际案件应核对正式公布文本并听取专业意见。",
  },
} satisfies Record<Locale, {
  eyebrow: string;
  title: string;
  lead: string;
  topics: Record<Topic, string>;
  idle: string;
  loading: string;
  notConfigured: string;
  unavailable: string;
  stale: string;
  verified: string;
  effective: string;
  retrieved: string;
  article: string;
  original: string;
  checklistTitle: string;
  checklist: string[];
  disclaimer: string;
}>;

const topics = Object.keys(copy.ko.topics) as Topic[];

const summaryCopy = {
  ko: {
    title: "핵심 조항 요약 · 공식 원문 기반",
    lead: "로컬 AI가 사용자 권리·보호와 가까운 조항을 우선 배치하되 법률 문장은 재작성하지 않습니다. 전체 요건과 예외는 원문에서 확인하세요.",
    officialTitle: "공식 조문 발췌 · AI 요약 아님",
    officialLead: "AI 후보가 품질 기준을 통과하지 못했거나 안전한 순서 개선이 없어, 법률 문장을 바꾸지 않은 공식 조문 발췌를 표시합니다.",
    officialBadge: "품질 게이트 적용 · 공식 원문 그대로",
    loading: "공식 원문 발췌를 확인하고 있어요.",
    unavailable: "공식 발췌를 현재 확인할 수 없습니다. 아래 공식 원문을 확인해 주세요.",
    signIn: "로그인하면 무료·로컬 AI로 공용 요약을 한 번 생성할 수 있어요.",
    approvalRequired: "과금 가능 모델은 개발자가 이 법령에 대해 한 번 승인해야 요약을 생성합니다.",
    approvalAction: "비용 확인 후 공용 요약 만들기",
    paidConfirm: "현재 유료 AI 모델로 이 법령 요약을 1회 생성할까요? 생성된 결과는 같은 모델을 쓰는 모든 사용자에게 재사용됩니다.",
    generating: "다른 요청에서 공용 요약을 생성하고 있어요. 잠시 후 다시 선택해 주세요.",
    shared: "모든 사용자에게 공통으로 재사용",
    cached: "저장된 공식 발췌",
    generated: "공식 원문에서 구성한 발췌",
  },
  en: {
    title: "Key-article summary · official text",
    lead: "Local AI may prioritize articles closest to user rights and protection, but never rewrites the legal text. Check the full text for all conditions and exceptions.",
    officialTitle: "Official article excerpts · not an AI summary",
    officialLead: "The AI candidate did not pass the quality gate or offered no safe ordering improvement, so unchanged excerpts from the official articles are shown.",
    officialBadge: "Quality gate applied · official text unchanged",
    loading: "Checking official excerpts.",
    unavailable: "Official excerpts are unavailable. Please check the official text below.",
    signIn: "Sign in to create one shared summary with the free or local AI.",
    approvalRequired: "A developer must approve one generation for a billable model.",
    approvalAction: "Review cost and create summary",
    paidConfirm: "Generate this law summary once with the active billable model? It will be reused for everyone using the same model.",
    generating: "Another request is creating the shared summary. Please select the topic again shortly.",
    shared: "Shared with every user",
    cached: "Saved official excerpts",
    generated: "Excerpts from official text",
  },
  ja: {
    title: "重要条文の要約・公式原文ベース",
    lead: "ローカルAIは利用者の権利・保護に近い条文を優先できますが、法文は書き換えません。全条件・例外は原文で確認してください。",
    officialTitle: "公式条文の抜粋・AI要約ではありません",
    officialLead: "AI候補が品質基準を満たさなかった、または安全な順序改善がなかったため、法文を変更していない公式条文の抜粋を表示します。",
    officialBadge: "品質ゲート適用・公式原文のまま",
    loading: "公式条文の抜粋を確認しています。",
    unavailable: "抜粋を確認できません。以下の公式原文をご確認ください。",
    signIn: "ログインすると、無料・ローカルAIで共通要約を一度生成できます。",
    approvalRequired: "課金対象モデルは、開発者がこの法令の生成を一度承認する必要があります。",
    approvalAction: "費用を確認して共通要約を作成",
    paidConfirm: "現在の課金対象AIでこの法令要約を一度生成しますか。同じモデルを使う全ユーザーに再利用されます。",
    generating: "別のリクエストで共通要約を生成中です。少し後でもう一度選択してください。",
    shared: "全ユーザーで共通利用",
    cached: "保存済み公式抜粋",
    generated: "公式原文からの抜粋",
  },
  zh: {
    title: "重点条款摘要 · 基于官方原文",
    lead: "本地 AI 可优先排列与用户权利和保护最相关的条款，但不会改写法律原文。请核对完整原文的全部条件与例外。",
    officialTitle: "官方条文摘录 · 并非 AI 摘要",
    officialLead: "AI 候选结果未通过质量门槛，或没有提供安全的排序改进，因此显示未改写的官方条文摘录。",
    officialBadge: "已应用质量门槛 · 官方原文未改写",
    loading: "正在检查官方摘录。",
    unavailable: "暂时无法提供摘录，请查看下方官方原文。",
    signIn: "登录后可使用免费或本地 AI 生成一次共享摘要。",
    approvalRequired: "使用可能产生费用的模型时，需要开发者批准一次生成。",
    approvalAction: "确认费用并生成共享摘要",
    paidConfirm: "是否使用当前付费 AI 模型生成一次该法规摘要？同一模型下的所有用户将重复使用此结果。",
    generating: "另一请求正在生成共享摘要，请稍后重新选择该主题。",
    shared: "供所有用户共享使用",
    cached: "已保存官方摘录",
    generated: "来自官方原文的摘录",
  },
} satisfies Record<Locale, Record<string, string>>;

const disclosureCopy = {
  ko: {
    open: "펴기",
    close: "접기",
    summary: "공식 발췌 확인",
    articles: (count: number) => `관련 조문 ${count}개`,
    article: "조문 내용",
    checklist: "결정 전 체크리스트",
  },
  en: {
    open: "Expand",
    close: "Collapse",
    summary: "Read official excerpts",
    articles: (count: number) => `${count} related articles`,
    article: "Article text",
    checklist: "Pre-decision checklist",
  },
  ja: {
    open: "開く",
    close: "閉じる",
    summary: "公式抜粋を確認",
    articles: (count: number) => `関連条文 ${count}件`,
    article: "条文内容",
    checklist: "判断前のチェックリスト",
  },
  zh: {
    open: "展开",
    close: "收起",
    summary: "查看官方摘录",
    articles: (count: number) => `${count}条相关条文`,
    article: "条文内容",
    checklist: "决定前检查清单",
  },
} satisfies Record<Locale, {
  open: string;
  close: string;
  summary: string;
  articles: (count: number) => string;
  article: string;
  checklist: string;
}>;

function displayDate(value: string, locale: Locale) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  const localeTag = locale === "ko" ? "ko-KR" : locale === "ja" ? "ja-JP" : locale === "zh" ? "zh-CN" : "en-US";
  return new Intl.DateTimeFormat(localeTag, { dateStyle: "medium" }).format(new Date(parsed));
}

export function FinancialLawSafety({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const s = summaryCopy[locale];
  const d = disclosureCopy[locale];
  const [selected, setSelected] = useState<Topic | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "not-configured" | "unavailable" | "ready">("idle");
  const [guidance, setGuidance] = useState<GuidanceResponse | null>(null);
  const [summaryState, setSummaryState] = useState<"idle" | "loading" | "ready" | "approval-required" | "sign-in-required" | "generating" | "unavailable">("idle");
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const topicSerial = useRef(0);
  const summarySerial = useRef(0);
  const topicAbort = useRef<AbortController | null>(null);
  const summaryAbort = useRef<AbortController | null>(null);
  const activeTopic = useRef<Topic | null>(null);
  const currentLocale = useRef(locale);
  useLayoutEffect(() => {
    currentLocale.current = locale;
    activeTopic.current = null;
    const owner = topicSerial.current;
    queueMicrotask(() => {
      if (topicSerial.current !== owner || currentLocale.current !== locale) return;
      setSelected(null);
      setState("idle");
      setGuidance(null);
      setSummary(null);
      setSummaryState("idle");
    });
    return () => {
      topicSerial.current += 1;
      summarySerial.current += 1;
      activeTopic.current = null;
      topicAbort.current?.abort();
      summaryAbort.current?.abort();
    };
  }, [locale]);

  async function loadSummary(
    topic: Topic,
    explicitBillableGeneration = false,
    expectedProvider?: string,
    expectedModel?: string,
  ) {
    if (activeTopic.current !== topic || currentLocale.current !== locale) return;
    const owner = topicSerial.current;
    const serial = ++summarySerial.current;
    summaryAbort.current?.abort();
    const controller = new AbortController();
    summaryAbort.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Summary request timed out", "TimeoutError"));
    }, LAW_SUMMARY_REQUEST_TIMEOUT_MS);
    const clearRequestTimeout = () => window.clearTimeout(timeoutId);
    controller.signal.addEventListener("abort", clearRequestTimeout, { once: true });
    const ownsRequest = () => owner === topicSerial.current && serial === summarySerial.current
      && activeTopic.current === topic && currentLocale.current === locale;
    const isCurrent = () => !controller.signal.aborted && ownsRequest();
    setSummaryState("loading");
    setSummary(null);
    try {
      const response = await fetch("/api/legal/financial/summary", {
        signal: controller.signal,
        method: explicitBillableGeneration ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          topic,
          locale,
          ...(explicitBillableGeneration ? {
            scope: "single-financial-law-summary",
            expectedProvider,
            expectedModel,
          } : {}),
        }),
      });
      const payload = await response.json().catch(() => null) as SummaryResponse | null;
      if (!isCurrent()) return;
      if (!payload || !payload.status) {
        setSummaryState("unavailable");
        return;
      }
      setSummary(payload);
      setSummaryState(payload.status);
    } catch {
      if ((timedOut || !controller.signal.aborted) && ownsRequest()) setSummaryState("unavailable");
    } finally {
      window.clearTimeout(timeoutId);
      controller.signal.removeEventListener("abort", clearRequestTimeout);
      if (summaryAbort.current === controller) summaryAbort.current = null;
    }
  }

  function approveBillableSummary() {
    if (!selected || !summary?.approvalAvailable || !summary.provider || !summary.model) return;
    if (!window.confirm(s.paidConfirm)) return;
    void loadSummary(selected, true, summary.provider, summary.model);
  }

  const officialExcerptFallback = summaryState === "ready"
    && summary?.contentMode === "official-excerpts";
  const summaryTitle = officialExcerptFallback ? s.officialTitle : s.title;
  const summaryLead = officialExcerptFallback ? s.officialLead : s.lead;

  async function loadTopic(topic: Topic) {
    if (currentLocale.current !== locale) return;
    const serial = ++topicSerial.current;
    summarySerial.current += 1;
    topicAbort.current?.abort();
    summaryAbort.current?.abort();
    const controller = new AbortController();
    topicAbort.current = controller;
    activeTopic.current = topic;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Law request timed out", "TimeoutError"));
    }, LAW_TOPIC_REQUEST_TIMEOUT_MS);
    const clearRequestTimeout = () => window.clearTimeout(timeoutId);
    controller.signal.addEventListener("abort", clearRequestTimeout, { once: true });
    const ownsRequest = () => serial === topicSerial.current
      && activeTopic.current === topic && currentLocale.current === locale;
    const isCurrent = () => !controller.signal.aborted && ownsRequest();
    setSelected(topic);
    setState("loading");
    setGuidance(null);
    setSummaryState("idle");
    setSummary(null);
    try {
      const response = await fetch("/api/legal/financial", {
        signal: controller.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ topic }),
      });
      const payload = await response.json().catch(() => null) as GuidanceResponse | { error?: string } | null;
      if (!isCurrent()) return;
      if (response.status === 503 && payload && "error" in payload && payload.error === "law_api_not_configured") {
        setState("not-configured");
        return;
      }
      if (!response.ok || !payload || !("laws" in payload) || !Array.isArray(payload.laws) || !payload.laws.length) {
        setState("unavailable");
        return;
      }
      setGuidance(payload);
      setState("ready");
      void loadSummary(topic);
    } catch {
      if ((timedOut || !controller.signal.aborted) && ownsRequest()) setState("unavailable");
    } finally {
      window.clearTimeout(timeoutId);
      controller.signal.removeEventListener("abort", clearRequestTimeout);
      if (topicAbort.current === controller) topicAbort.current = null;
    }
  }

  return <section className={styles.shell} aria-labelledby="financial-law-safety-title">
    <header>
      <span><Scale size={15} />{t.eyebrow}</span>
      <h2 id="financial-law-safety-title">{t.title}</h2>
      <p>{t.lead}</p>
    </header>
    <div className={styles.topicGrid}>
      {topics.map((topic) => <button
        key={topic}
        type="button"
        aria-pressed={selected === topic}
        disabled={state === "loading"}
        onClick={() => void loadTopic(topic)}
      >
        <BookOpenCheck size={17} />
        {t.topics[topic]}
      </button>)}
    </div>
    <div className={styles.result} aria-live="polite">
      {state === "idle" && <div className={styles.message}><ShieldAlert size={23} /><p>{t.idle}</p></div>}
      {state === "loading" && <div className={styles.message}><LoaderCircle className={styles.spin} size={23} /><p>{t.loading}</p></div>}
      {state === "not-configured" && <div className={styles.message} data-tone="warning"><CircleAlert size={23} /><p>{t.notConfigured}</p></div>}
      {state === "unavailable" && <div className={styles.message} data-tone="warning"><CircleAlert size={23} /><p>{t.unavailable}</p></div>}
      {state === "ready" && guidance && <>
        <div className={styles.verification} data-status={guidance.status}>
          <BookOpenCheck size={17} />
          <strong>{guidance.status === "stale" ? t.stale : t.verified}</strong>
          <time dateTime={guidance.retrievedAt}>{t.retrieved} {displayDate(guidance.retrievedAt, locale)}</time>
        </div>
        <section className={styles.aiSummary} aria-labelledby="financial-law-summary-title">
          <div className={styles.aiSummaryHeading}>
            <span>{officialExcerptFallback ? <BookOpenCheck size={16} /> : <Sparkles size={16} />}</span>
            <div>
              <h3 id="financial-law-summary-title">{summaryTitle}</h3>
              <p>{summaryLead}</p>
            </div>
            {summaryState === "ready" && summary?.cache && (
              <small>{summary.contentMode === "ai-ordered-official-excerpts"
                ? ({ ko: "AI 핵심순서 추천 · 원문 전체 블록 보존 (재서술 아님)", en: "AI-suggested order · all original blocks preserved (not rewritten)", ja: "AIによる順序提案・原文ブロック全保持（言い換えなし）", zh: "AI 建议排序 · 保留全部原文块（非改写）" }[locale])
                : s.officialBadge} · {s.shared}</small>
            )}
          </div>
          {summaryState === "loading" && <p className={styles.summaryStatus}><LoaderCircle className={styles.spin} size={16} />{s.loading}</p>}
          {summaryState === "ready" && summary?.summary && <AccessibleDisclosure className={styles.summaryDisclosure} summary={<><span>{d.summary}</span><span className={styles.disclosureState}><i>{d.open}</i><i>{d.close}</i><ChevronDown size={15} /></span></>}>
            <p className={styles.summaryText}>{summary.summary}</p>
          </AccessibleDisclosure>}
          {summaryState === "sign-in-required" && <p className={styles.summaryStatus}>{s.signIn}</p>}
          {summaryState === "generating" && <p className={styles.summaryStatus}>{s.generating}</p>}
          {summaryState === "approval-required" && <div className={styles.summaryApproval}>
            <p>{s.approvalRequired}</p>
            {summary?.approvalAvailable && <button type="button" onClick={approveBillableSummary}>{s.approvalAction}</button>}
          </div>}
          {summaryState === "unavailable" && <p className={styles.summaryStatus}>{s.unavailable}</p>}
        </section>
        <div className={styles.lawList}>{guidance.laws.map((law) => <AccessibleDisclosure className={styles.lawCard} key={law.id} summary={<>
            <div><span>{law.ministry}</span><h3>{law.name}</h3><small>{t.effective} {displayDate(law.effectiveDate, locale)}</small></div>
            <div className={styles.lawDisclosureMeta}><small>{d.articles(law.articles.length)}</small><span className={styles.disclosureState}><i>{d.open}</i><i>{d.close}</i><ChevronDown size={16} /></span></div>
          </>}>
          <div className={styles.lawContent}>
            <a href={law.sourceUrl} target="_blank" rel="noopener noreferrer">{t.original}<ExternalLink size={13} /></a>
            <strong>{t.article}</strong>
            <div className={styles.articleList}>{law.articles.map((article) => <AccessibleDisclosure className={styles.articleDisclosure} key={article.id} summary={<><b>{article.articleNumber}{article.title ? ` · ${article.title}` : ""}</b><span className={styles.disclosureState}><i>{d.article} · {d.open}</i><i>{d.close}</i><ChevronDown size={14} /></span></>}>
              <p>{article.text}</p>
            </AccessibleDisclosure>)}</div>
          </div>
        </AccessibleDisclosure>)}</div>
      </>}
    </div>
    <AccessibleDisclosure className={styles.checklist} summary={<><strong>{d.checklist}</strong><span className={styles.disclosureState}><i>{d.open}</i><i>{d.close}</i><ChevronDown size={15} /></span></>}>
      <ol>{t.checklist.map((item) => <li key={item}>{item}</li>)}</ol>
    </AccessibleDisclosure>
    <footer><CircleAlert size={15} /><p>{t.disclaimer}</p></footer>
  </section>;
}
