"use client";

import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Database,
  PiggyBank,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { manualFinanceSummary } from "@/lib/manual-finance";
import type { ManualFinanceSnapshot } from "@/lib/manual-finance-snapshot";
import styles from "./home-finance-status.module.css";

type Locale = "ko" | "en" | "ja" | "zh";
type SessionState = "checking" | "signed-in" | "signed-out" | "unavailable";
type LoadState = "signed-out" | "session-unavailable" | "loading" | "ready" | "empty" | "consent-required" | "error";
type SnapshotResult = {
  userId: string;
  snapshot: ManualFinanceSnapshot | null;
  state: Exclude<LoadState, "loading">;
};

const localeTags: Record<Locale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const copy = {
  ko: {
    eyebrow: "MY MONEY PLAN",
    title: "내 금융 상태",
    lead: "직접 입력해 계정에 저장한 금액만 계산합니다.",
    loading: "저장된 금융 상태를 확인하고 있어요.",
    signedOutTitle: "저장된 금융 상태를 확인하려면 로그인을 진행해 주세요",
    signedOutBody: "로그인하면 이전에 저장한 금액을 불러오고, 새로 입력한 자산과 월 현금흐름도 다른 기기에서 이어서 볼 수 있어요.",
    signIn: "로그인 진행하기",
    emptyTitle: "아직 한 번도 저장한 금융 정보가 없네요",
    emptyBody: "자산과 월 현금흐름을 처음 저장해서 순자산, 월 잔여금과 지출 비중 계산에 활용해 보실래요? 계좌번호 없이 금액만 입력하면 됩니다.",
    setup: "처음 저장해 보기",
    setupTime: "약 2분",
    setupSteps: ["자산과 부채", "월수입과 지출", "저축 목표"],
    consentTitle: "금융 상태 이용 동의를 확인해 주세요",
    consentBody: "로그인은 확인됐지만 필수 이용 동의가 완료되지 않았어요. 동의를 확인한 뒤 안전하게 저장할 수 있습니다.",
    consentAction: "동의 확인하기",
    sessionErrorTitle: "로그인 상태를 잠시 확인하지 못했어요",
    sessionErrorBody: "페이지를 새로고침하거나 잠시 후 로그인을 다시 확인해 주세요.",
    errorTitle: "금융 상태 연결을 잠시 확인하지 못했어요",
    errorBody: "로그인은 확인됐지만 저장 서비스 연결이 원활하지 않아요. 잠시 후 다시 시도해 주세요.",
    openWorkbook: "자산 장부 열기",
    netAssets: "순자산",
    monthlyBalance: "이번 달 남길 수 있는 돈",
    savingRate: "월수입 대비 잔여금",
    complete: "프로필 완성도",
    fields: "개 항목 입력",
    inputOnly: "사용자 직접 입력",
    updated: "마지막 저장",
    composition: "월 현금흐름 구성",
    fixed: "고정지출",
    variable: "변동지출",
    debt: "부채상환",
    available: "남길 수 있는 돈",
    nextTitle: "지금 할 일",
    nextNoIncome: "월수입을 입력하면 지출 비중과 저축 가능 금액을 계산할 수 있어요.",
    nextNegative: "지출이 수입보다 많아요. 고정지출과 부채상환액부터 확인해 보세요.",
    nextNoAssets: "자산 금액을 추가하면 부채를 반영한 순자산을 확인할 수 있어요.",
    nextReady: "입력값이 준비됐어요. 목표 금액을 정해 월 저축 계획으로 연결해 보세요.",
    disclaimer: "금융회사에서 확인한 잔액이 아닌 사용자가 직접 입력한 참고용 정보입니다.",
  },
  en: {
    eyebrow: "MY MONEY PLAN",
    title: "My money status",
    lead: "Only amounts you enter and save to your account are calculated.",
    loading: "Checking your saved money status.",
    signedOutTitle: "Please sign in to check your saved money status",
    signedOutBody: "After signing in, you can load earlier entries and continue new asset and cash-flow entries on another device.",
    signIn: "Continue to sign in",
    emptyTitle: "You have not saved money information yet",
    emptyBody: "Would you like to save your first asset and cash-flow amounts and use them to calculate net assets, monthly balance and spending shares? Account numbers are not needed.",
    setup: "Save for the first time",
    setupTime: "About 2 minutes",
    setupSteps: ["Assets and debt", "Income and spending", "Savings goal"],
    consentTitle: "Please review the required consent",
    consentBody: "You are signed in, but the required service consent is incomplete. Review it before saving money information.",
    consentAction: "Review consent",
    sessionErrorTitle: "We could not check your sign-in status",
    sessionErrorBody: "Refresh the page or check your sign-in again shortly.",
    errorTitle: "We could not check the money-status connection",
    errorBody: "You are signed in, but the saved-data service is temporarily unavailable. Please try again shortly.",
    openWorkbook: "Open money book",
    netAssets: "Net assets",
    monthlyBalance: "Left this month",
    savingRate: "Share of monthly income",
    complete: "Profile progress",
    fields: "fields entered",
    inputOnly: "Manually entered",
    updated: "Last saved",
    composition: "Monthly cash-flow mix",
    fixed: "Fixed",
    variable: "Variable",
    debt: "Debt payment",
    available: "Available",
    nextTitle: "Next action",
    nextNoIncome: "Add monthly income to calculate spending shares and the amount available to save.",
    nextNegative: "Outflow is above income. Review fixed costs and debt payments first.",
    nextNoAssets: "Add asset amounts to see net assets after liabilities.",
    nextReady: "Your inputs are ready. Add a goal and turn the monthly balance into a savings plan.",
    disclaimer: "These are user-entered reference values, not balances verified by a financial institution.",
  },
  ja: {
    eyebrow: "MY MONEY PLAN",
    title: "私のお金の状態",
    lead: "自分で入力し、アカウントに保存した金額だけを計算します。",
    loading: "保存済みの金融状態を確認しています。",
    signedOutTitle: "保存済みの金融状態を確認するにはログインしてください",
    signedOutBody: "ログインすると以前の入力を読み込み、新しい資産・月間収支も別の端末で続けられます。",
    signIn: "ログインへ進む",
    emptyTitle: "まだ一度も金融情報を保存していません",
    emptyBody: "資産と月間収支を初めて保存し、純資産・月間残高・支出割合の計算に活用しませんか。口座番号は不要です。",
    setup: "初めて保存する",
    setupTime: "約2分",
    setupSteps: ["資産と負債", "収入と支出", "貯蓄目標"],
    consentTitle: "金融状態の利用同意を確認してください",
    consentBody: "ログインは確認できましたが、必須の利用同意が完了していません。同意後に安全に保存できます。",
    consentAction: "同意を確認",
    sessionErrorTitle: "ログイン状態を一時的に確認できません",
    sessionErrorBody: "ページを再読み込みするか、しばらくしてからログイン状態をご確認ください。",
    errorTitle: "金融状態への接続を確認できませんでした",
    errorBody: "ログインは確認できましたが、保存サービスに一時的に接続できません。しばらくしてから再度お試しください。",
    openWorkbook: "資産台帳を開く",
    netAssets: "純資産",
    monthlyBalance: "今月残せる金額",
    savingRate: "月収に対する残額",
    complete: "プロフィール完成度",
    fields: "項目入力済み",
    inputOnly: "本人による直接入力",
    updated: "最終保存",
    composition: "月間キャッシュフロー構成",
    fixed: "固定支出",
    variable: "変動支出",
    debt: "債務返済",
    available: "残せる金額",
    nextTitle: "次にすること",
    nextNoIncome: "月収を入力すると、支出割合と貯蓄可能額を計算できます。",
    nextNegative: "支出が収入を上回っています。固定費と返済額から確認しましょう。",
    nextNoAssets: "資産額を追加すると、負債を反映した純資産を確認できます。",
    nextReady: "入力が完了しました。目標額を決めて月間貯蓄計画につなげましょう。",
    disclaimer: "金融機関が確認した残高ではなく、本人が入力した参考情報です。",
  },
  zh: {
    eyebrow: "MY MONEY PLAN",
    title: "我的金融状态",
    lead: "仅计算您手动输入并保存到账户中的金额。",
    loading: "正在检查已保存的金融状态。",
    signedOutTitle: "请先登录以查看已保存的金融状态",
    signedOutBody: "登录后可读取以前保存的金额，并在其他设备继续填写新的资产与每月现金流。",
    signIn: "前往登录",
    emptyTitle: "您还没有保存过金融信息",
    emptyBody: "是否要首次保存资产与每月现金流，用于计算净资产、月结余和支出占比？无需填写银行账号。",
    setup: "首次保存",
    setupTime: "约2分钟",
    setupSteps: ["资产与负债", "收入与支出", "储蓄目标"],
    consentTitle: "请确认金融状态使用同意",
    consentBody: "已确认登录，但尚未完成必需的服务同意。确认后即可安全保存。",
    consentAction: "确认同意",
    sessionErrorTitle: "暂时无法确认登录状态",
    sessionErrorBody: "请刷新页面，或稍后重新确认登录状态。",
    errorTitle: "暂时无法确认金融状态连接",
    errorBody: "已确认登录，但保存服务暂时无法连接，请稍后重试。",
    openWorkbook: "打开资产账本",
    netAssets: "净资产",
    monthlyBalance: "本月可结余",
    savingRate: "占月收入比例",
    complete: "资料完成度",
    fields: "项已填写",
    inputOnly: "用户手动输入",
    updated: "最后保存",
    composition: "每月现金流构成",
    fixed: "固定支出",
    variable: "变动支出",
    debt: "偿还负债",
    available: "可结余",
    nextTitle: "下一步",
    nextNoIncome: "填写月收入后，即可计算支出占比与可储蓄金额。",
    nextNegative: "支出高于收入，请优先检查固定支出与偿债金额。",
    nextNoAssets: "添加资产金额后，即可查看扣除负债后的净资产。",
    nextReady: "输入已准备好。请设置目标，把每月结余转为储蓄计划。",
    disclaimer: "这是用户手动输入的参考信息，并非金融机构核实的余额。",
  },
} as const;

function formatMoney(value: number, locale: Locale) {
  return new Intl.NumberFormat(localeTags[locale], {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatUpdatedAt(value: number, locale: Locale) {
  return new Intl.DateTimeFormat(localeTags[locale], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function HomeFinanceStatus({
  locale,
  userId,
  sessionState,
  easyMode,
}: {
  locale: Locale;
  userId?: string | null;
  sessionState: SessionState;
  easyMode: boolean;
}) {
  const [result, setResult] = useState<SnapshotResult | null>(null);
  const t = copy[locale];

  useEffect(() => {
    if (!userId) return;

    const controller = new AbortController();
    fetch("/api/finance/snapshot", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response): Promise<Pick<SnapshotResult, "snapshot" | "state">> => {
        if (response.status === 401) return { snapshot: null, state: "signed-out" };
        if (response.status === 428) return { snapshot: null, state: "consent-required" };
        if (!response.ok) throw new Error("finance_snapshot_unavailable");
        const data = await response.json() as {
          authenticated?: boolean;
          snapshot?: ManualFinanceSnapshot | null;
        };
        const snapshot = data.snapshot ?? null;
        return {
          snapshot,
          state: snapshot ? "ready" : "empty",
        };
      })
      .then((nextResult) => {
        if (controller.signal.aborted) return;
        setResult({
          userId,
          ...nextResult,
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setResult({ userId, snapshot: null, state: "error" });
        }
      });

    return () => controller.abort();
  }, [userId]);

  const state: LoadState = sessionState === "checking"
    ? "loading"
    : sessionState === "unavailable"
      ? "session-unavailable"
      : sessionState === "signed-out" || !userId
        ? "signed-out"
        : result?.userId === userId
          ? result.state
          : "loading";
  const snapshot = result && result.userId === userId ? result.snapshot : null;
  const summary = useMemo(
    () => snapshot ? manualFinanceSummary(snapshot.amounts) : null,
    [snapshot],
  );
  const completion = summary ? Math.round((summary.completedFields / 8) * 100) : 0;
  const savingRate = summary && summary.amounts.monthlyIncome > 0
    ? (summary.monthlyBalance / summary.amounts.monthlyIncome) * 100
    : null;
  const nextAction = !summary || summary.amounts.monthlyIncome <= 0
    ? t.nextNoIncome
    : summary.monthlyBalance < 0
      ? t.nextNegative
      : summary.totalAssets <= 0
        ? t.nextNoAssets
        : t.nextReady;
  const cashflowLabels = summary ? [
    [t.fixed, summary.cashflow.find((item) => item.id === "fixedExpenses")?.sharePercent ?? 0, "#6d5bd0"],
    [t.variable, summary.cashflow.find((item) => item.id === "variableExpenses")?.sharePercent ?? 0, "#9b87e6"],
    [t.debt, summary.cashflow.find((item) => item.id === "debtPayment")?.sharePercent ?? 0, "#d49335"],
    [t.available, summary.cashflow.find((item) => item.id === "available")?.sharePercent ?? 0, "#1c8a6d"],
  ] as const : [];

  return (
    <section
      className={styles.card}
      data-easy-mode={easyMode ? "true" : undefined}
      aria-labelledby="home-finance-status-title"
    >
      <div className={styles.heading}>
        <div>
          <span>{t.eyebrow}</span>
          <h2 id="home-finance-status-title">{t.title}</h2>
          <p>{t.lead}</p>
        </div>
        <span className={styles.inputBadge}><ShieldCheck size={14} />{t.inputOnly}</span>
      </div>

      {state === "loading" && (
        <div className={styles.loading} role="status">
          <Clock3 size={21} />
          <span>{t.loading}</span>
        </div>
      )}

      {state === "signed-out" && (
        <div className={styles.setup}>
          <span className={styles.setupIcon}><WalletCards size={25} /></span>
          <div>
            <small>{t.setupTime}</small>
            <h3>{t.signedOutTitle}</h3>
            <p>{t.signedOutBody}</p>
            <ol>{t.setupSteps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
          </div>
          <Link href="/mypage">{t.signIn}<ArrowRight size={17} /></Link>
        </div>
      )}

      {state === "empty" && (
        <div className={styles.setup}>
          <span className={styles.setupIcon}><PiggyBank size={25} /></span>
          <div>
            <small>{t.setupTime}</small>
            <h3>{t.emptyTitle}</h3>
            <p>{t.emptyBody}</p>
            <ol>{t.setupSteps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
          </div>
          <Link href="/assets">{t.setup}<ArrowRight size={17} /></Link>
        </div>
      )}

      {state === "consent-required" && (
        <div className={styles.setup}>
          <span className={styles.setupIcon}><ShieldCheck size={25} /></span>
          <div>
            <h3>{t.consentTitle}</h3>
            <p>{t.consentBody}</p>
          </div>
          <Link href="/mypage">{t.consentAction}<ArrowRight size={17} /></Link>
        </div>
      )}

      {state === "session-unavailable" && (
        <div className={styles.error} role="alert">
          <Database size={22} />
          <div><strong>{t.sessionErrorTitle}</strong><p>{t.sessionErrorBody}</p></div>
          <Link href="/mypage">{t.signIn}<ArrowRight size={16} /></Link>
        </div>
      )}

      {state === "error" && (
        <div className={styles.error} role="alert">
          <Database size={22} />
          <div><strong>{t.errorTitle}</strong><p>{t.errorBody}</p></div>
          <Link href="/assets">{t.openWorkbook}<ArrowRight size={16} /></Link>
        </div>
      )}

      {state === "ready" && summary && snapshot && (
        <>
          <div className={styles.progressRow}>
            <div>
              <span>{t.complete}</span>
              <strong>{completion}%</strong>
              <small>{summary.completedFields}/8 {t.fields}</small>
            </div>
            <div className={styles.progressTrack} role="progressbar" aria-label={t.complete} aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}>
              <span style={{ width: `${completion}%` }} />
            </div>
            <small>{t.updated} {formatUpdatedAt(snapshot.updatedAt, locale)}</small>
          </div>

          <div className={styles.metrics}>
            <article>
              <span><WalletCards size={17} />{t.netAssets}</span>
              <strong>{formatMoney(summary.netAssets, locale)}</strong>
            </article>
            <article className={summary.monthlyBalance < 0 ? styles.negative : undefined}>
              <span><CircleDollarSign size={17} />{t.monthlyBalance}</span>
              <strong>{formatMoney(summary.monthlyBalance, locale)}</strong>
              <small>{t.savingRate} {savingRate === null ? "—" : `${savingRate.toFixed(1)}%`}</small>
            </article>
          </div>

          <div className={styles.cashflow}>
            <div className={styles.cashflowHeading}>
              <strong>{t.composition}</strong>
              <span>{formatMoney(summary.amounts.monthlyIncome, locale)}</span>
            </div>
            <div className={styles.stackedBar} role="img" aria-label={cashflowLabels.map(([label, share]) => `${label} ${share.toFixed(1)}%`).join(", ")}>
              {cashflowLabels.map(([label, share, color]) => share > 0 && (
                <span key={label} style={{ width: `${share}%`, background: color }} />
              ))}
            </div>
            <ul>
              {cashflowLabels.map(([label, share, color]) => (
                <li key={label}><i style={{ background: color }} /><span>{label}</span><strong>{share.toFixed(1)}%</strong></li>
              ))}
            </ul>
          </div>

          <div className={styles.nextAction}>
            <span><CheckCircle2 size={18} /></span>
            <div><strong>{t.nextTitle}</strong><p>{nextAction}</p></div>
            <Link href="/assets">{t.openWorkbook}<ArrowRight size={16} /></Link>
          </div>
          <p className={styles.disclaimer}>{t.disclaimer}</p>
        </>
      )}
    </section>
  );
}
