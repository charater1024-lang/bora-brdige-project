"use client";

import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  CircleAlert,
  Clock3,
  PiggyBank,
  UserRound,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import type {
  DailyFinanceGuide,
  DailyFinanceGuideTask,
  DailyFinanceGuideTaskId,
} from "@/lib/daily-finance-guide";
import styles from "./bora-daily-guide.module.css";

type Locale = "ko" | "en" | "ja" | "zh";

const copy = {
  ko: {
    title: "오늘 보리와 확인할 금융 과정",
    loading: "오늘의 확인 항목을 불러오고 있어요.",
    unavailable: "확인 상태를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.",
    allDone: "오늘 확인할 항목을 모두 마쳤어요. 새로운 공식 정보가 생기면 다시 알려드릴게요.",
    remaining: (count: number) => `오늘 놓치지 않도록 ${count}가지를 먼저 확인해 보세요.`,
    complete: "오늘 확인 완료",
    attention: "확인 필요",
    signIn: "로그인하면 다른 기기에서도 확인 상태를 이어갈 수 있어요.",
    primary: "오늘 가장 먼저 할 일",
    queue: "다음 확인 항목",
    queueDescription: "필요할 때 펼쳐서 이어서 확인할 수 있어요.",
    progress: "오늘의 진행률",
    tasks: {
      "finance-review": {
        kicker: "GROW",
        title: "오늘 자산 장부 확인",
        descriptions: {
          "completed-today": "오늘 입력한 자산·현금흐름을 계정에 안전하게 저장했습니다.",
          "finance-entry-needed": "자산과 월 현금흐름을 확인하거나 달라진 값을 업데이트해 주세요.",
          "sign-in-required": "로그인한 뒤 직접 입력한 자산 장부를 계정에 저장할 수 있어요.",
        },
        action: "자산 장부 열기",
      },
      "profile-setup": {
        kicker: "MATCH",
        title: "맞춤 정책 조건 확인",
        descriptions: {
          "profile-ready": "출생연도·지역·현재 상태·관심분야가 맞춤 선별에 반영됩니다.",
          "profile-incomplete": "관련 없는 정책을 줄이려면 마이페이지에서 조건을 보완해 주세요.",
          "sign-in-required": "로그인하면 내 조건에 맞는 청년정책만 먼저 볼 수 있어요.",
        },
        action: "맞춤 정보 설정",
      },
      "official-updates": {
        kicker: "CHANCE",
        title: "새 공식 정보 확인",
        descriptions: {
          "nothing-unread": "현재 읽지 않은 맞춤 정책·금융 정보가 없습니다.",
          "unread-items": "새로 수집된 공식 정책·금융 정보가 있습니다.",
          "public-data-unavailable": "공식 데이터가 준비되면 자동으로 안내합니다.",
          "sign-in-required": "로그인하면 읽지 않은 공식 정보를 계정별로 표시합니다.",
        },
        action: "공식 정보 보기",
      },
    },
  },
  en: {
    title: "Today’s finance check with Bori",
    loading: "Loading today’s checklist.",
    unavailable: "The checklist is temporarily unavailable.",
    allDone: "You have completed today’s checks. I’ll flag new official information when it arrives.",
    remaining: (count: number) => `Review ${count} item${count === 1 ? "" : "s"} so nothing important is missed today.`,
    complete: "Checked today",
    attention: "Needs attention",
    signIn: "Sign in to continue your checklist on another device.",
    primary: "Your first action today",
    queue: "Next checks",
    queueDescription: "Open the list when you are ready to continue.",
    progress: "Today's progress",
    tasks: {
      "finance-review": {
        kicker: "GROW",
        title: "Review today’s money book",
        descriptions: {
          "completed-today": "Today’s asset and cash-flow entries are saved to your account.",
          "finance-entry-needed": "Review your assets and monthly cash flow, then update anything that changed.",
          "sign-in-required": "Sign in to save your manually entered money book to your account.",
        },
        action: "Open money book",
      },
      "profile-setup": {
        kicker: "MATCH",
        title: "Check matching preferences",
        descriptions: {
          "profile-ready": "Year of birth, region, status and interests are used for policy screening.",
          "profile-incomplete": "Complete your profile to reduce unrelated policy results.",
          "sign-in-required": "Sign in to screen youth policies against your own preferences.",
        },
        action: "Manage preferences",
      },
      "official-updates": {
        kicker: "CHANCE",
        title: "Review official updates",
        descriptions: {
          "nothing-unread": "There are no unread matched policy or finance updates.",
          "unread-items": "New official policy or finance information is waiting.",
          "public-data-unavailable": "I’ll notify you when official data is ready.",
          "sign-in-required": "Sign in to track unread official information per account.",
        },
        action: "Open official data",
      },
    },
  },
  ja: {
    title: "今日、ボリと確認する金融チェック",
    loading: "今日の確認項目を読み込んでいます。",
    unavailable: "確認状態を読み込めませんでした。",
    allDone: "今日の確認はすべて完了しました。新しい公式情報が届いたらお知らせします。",
    remaining: (count: number) => `今日見落とさないよう、まず${count}件を確認しましょう。`,
    complete: "本日確認済み",
    attention: "確認が必要",
    signIn: "ログインすると別の端末でも確認状態を引き継げます。",
    primary: "今日最初にすること",
    queue: "次の確認項目",
    queueDescription: "必要なときに開いて続けられます。",
    progress: "今日の進捗",
    tasks: {
      "finance-review": {
        kicker: "GROW",
        title: "今日の資産台帳を確認",
        descriptions: {
          "completed-today": "今日の資産・キャッシュフロー入力をアカウントに保存しました。",
          "finance-entry-needed": "資産と月間キャッシュフローを確認し、変化した値を更新してください。",
          "sign-in-required": "ログインすると手入力の資産台帳を保存できます。",
        },
        action: "資産台帳を開く",
      },
      "profile-setup": {
        kicker: "MATCH",
        title: "おすすめ条件を確認",
        descriptions: {
          "profile-ready": "生年・地域・現在の状態・関心分野が政策の絞り込みに反映されます。",
          "profile-incomplete": "関連性の低い政策を減らすため、プロフィールを補完してください。",
          "sign-in-required": "ログインすると自分の条件に合う政策を先に確認できます。",
        },
        action: "条件を設定",
      },
      "official-updates": {
        kicker: "CHANCE",
        title: "新しい公式情報を確認",
        descriptions: {
          "nothing-unread": "未読のおすすめ政策・金融情報はありません。",
          "unread-items": "新しく収集された公式情報があります。",
          "public-data-unavailable": "公式データの準備後にお知らせします。",
          "sign-in-required": "ログインすると未読情報をアカウントごとに表示します。",
        },
        action: "公式情報を見る",
      },
    },
  },
  zh: {
    title: "今天和Bori一起完成金融检查",
    loading: "正在加载今天的检查项目。",
    unavailable: "暂时无法加载检查状态。",
    allDone: "今天的检查已全部完成。有新的官方信息时我会再次提醒。",
    remaining: (count: number) => `为避免遗漏，请先检查今天的${count}个项目。`,
    complete: "今天已确认",
    attention: "需要确认",
    signIn: "登录后可在其他设备继续使用相同的检查状态。",
    primary: "今天优先完成",
    queue: "接下来的检查",
    queueDescription: "需要继续时再展开查看。",
    progress: "今日进度",
    tasks: {
      "finance-review": {
        kicker: "GROW",
        title: "检查今天的资产账本",
        descriptions: {
          "completed-today": "今天的资产和现金流输入已保存到账户。",
          "finance-entry-needed": "请检查资产与每月现金流，并更新有变化的金额。",
          "sign-in-required": "登录后可将手动输入的资产账本保存到账户。",
        },
        action: "打开资产账本",
      },
      "profile-setup": {
        kicker: "MATCH",
        title: "检查政策匹配条件",
        descriptions: {
          "profile-ready": "出生年份、地区、当前状态和兴趣用于筛选政策。",
          "profile-incomplete": "请补充个人条件，以减少无关政策。",
          "sign-in-required": "登录后可优先查看符合自身条件的青年政策。",
        },
        action: "设置匹配信息",
      },
      "official-updates": {
        kicker: "CHANCE",
        title: "查看新的官方信息",
        descriptions: {
          "nothing-unread": "目前没有未读的匹配政策或金融信息。",
          "unread-items": "有新收集的官方政策或金融信息。",
          "public-data-unavailable": "官方数据准备好后会自动提醒。",
          "sign-in-required": "登录后可按账户追踪未读官方信息。",
        },
        action: "查看官方信息",
      },
    },
  },
} as const;

const taskIcons = {
  "finance-review": PiggyBank,
  "profile-setup": UserRound,
  "official-updates": BriefcaseBusiness,
} satisfies Record<DailyFinanceGuideTaskId, typeof PiggyBank>;

function taskDescription(task: DailyFinanceGuideTask, locale: Locale) {
  const descriptions = copy[locale].tasks[task.id].descriptions as Record<string, string>;
  const base = descriptions[task.reason] ?? "";
  return task.id === "official-updates" && task.reason === "unread-items"
    ? `${base} ${task.count}`
    : base;
}

export function BoraDailyGuide({
  locale,
  userId,
  easyMode,
  onOpenAssets,
}: {
  locale: Locale;
  userId?: string;
  easyMode: boolean;
  onOpenAssets: () => void;
}) {
  const [guide, setGuide] = useState<DailyFinanceGuide | null>(null);
  const [failed, setFailed] = useState(false);
  const t = copy[locale];

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/daily-guide", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("daily_guide_unavailable");
        return await response.json() as DailyFinanceGuide;
      })
      .then((nextGuide) => {
        setGuide(nextGuide);
        setFailed(false);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setFailed(true);
      });
    return () => controller.abort();
  }, [userId]);

  const remaining = useMemo(
    () => guide ? guide.totalCount - guide.completedCount : 0,
    [guide],
  );
  const pendingTasks = useMemo(
    () => guide?.tasks.filter((task) => task.state !== "complete") ?? [],
    [guide],
  );
  const primaryTask = useMemo(() => {
    if (!guide) return null;
    if (!guide.authenticated) {
      return guide.tasks.find((task) => task.id === "profile-setup") ?? guide.tasks[0] ?? null;
    }
    return pendingTasks[0]
      ?? guide.tasks.find((task) => task.id === "official-updates")
      ?? guide.tasks[0]
      ?? null;
  }, [guide, pendingTasks]);
  const queuedTasks = useMemo(
    () => guide?.tasks.filter((task) => task.id !== primaryTask?.id) ?? [],
    [guide, primaryTask?.id],
  );
  const guideMessage = failed
    ? t.unavailable
    : !guide
      ? t.loading
      : guide.completedCount === guide.totalCount
        ? t.allDone
        : t.remaining(remaining);

  function openTask(task: DailyFinanceGuideTask) {
    if (task.id === "finance-review") {
      onOpenAssets();
      return;
    }
    window.location.assign(task.id === "profile-setup" ? "/mypage" : "/information/youth");
  }

  const completionPercent = guide && guide.totalCount > 0
    ? Math.round((guide.completedCount / guide.totalCount) * 100)
    : 0;

  return <section
    className="action-section"
    data-easy-mode={easyMode ? "true" : undefined}
    aria-labelledby="today-actions-title"
  >
    <div className="section-title-row">
      <div>
        <span className={styles.eyebrow}>BORA DAILY ACTION</span>
        <h2 id="today-actions-title">{t.title}</h2>
        <p>{guide?.authenticated ? guideMessage : t.signIn}</p>
      </div>
      <div className={styles.progressSummary} aria-label={t.progress}>
        <strong>{guide?.completedCount ?? 0}/{guide?.totalCount ?? 3}</strong>
        <span>{t.progress}</span>
      </div>
    </div>

    <div className={styles.progressTrack} role="progressbar" aria-label={t.progress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={completionPercent}>
      <span style={{ width: `${completionPercent}%` }} />
    </div>

    {!guide && !failed ? (
      <div className={styles.loading} role="status"><Clock3 size={17} />{t.loading}</div>
    ) : failed ? (
      <div className={styles.loading} role="status"><CircleAlert size={17} />{t.unavailable}</div>
    ) : primaryTask ? (
      <div className={styles.primaryLayout}>
        <div className={styles.mascot} aria-hidden="true">
          <Image
            src="/bora-mascot.webp"
            width={118}
            height={118}
            sizes="118px"
            alt=""
            unoptimized
          />
          <span>BORI</span>
        </div>
        <article className={styles.primaryCard} data-state={primaryTask.state}>
          <div className={styles.primaryHeading}>
            <span className={styles.primaryIcon} aria-hidden="true">
              {(() => {
                const Icon = taskIcons[primaryTask.id];
                return <Icon size={24} />;
              })()}
            </span>
            <div>
              <small>{t.primary} · {t.tasks[primaryTask.id].kicker}</small>
              <h3>{t.tasks[primaryTask.id].title}</h3>
            </div>
            <span className={styles.cardStatus} data-state={primaryTask.state}>
              {primaryTask.state === "complete" ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
              {primaryTask.state === "complete" ? t.complete : t.attention}
            </span>
          </div>
          <p>{taskDescription(primaryTask, locale)}</p>
          <button type="button" onClick={() => openTask(primaryTask)}>
            {t.tasks[primaryTask.id].action}<ArrowRight size={18} />
          </button>
        </article>
      </div>
    ) : null}

    {guide && queuedTasks.length > 0 && !easyMode && (
      <details className={styles.queue}>
        <summary>
          <span><strong>{t.queue}</strong><small>{t.queueDescription}</small></span>
          <span>{queuedTasks.length}</span>
        </summary>
        <ul>
          {queuedTasks.map((task) => {
            const Icon = taskIcons[task.id];
            return <li key={task.id}>
              <button type="button" onClick={() => openTask(task)}>
                <span className={styles.queueIcon}><Icon size={18} /></span>
                <span><strong>{t.tasks[task.id].title}</strong><small>{taskDescription(task, locale)}</small></span>
                <span className={styles.queueState} data-state={task.state}>
                  {task.state === "complete" ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
                  {task.state === "complete" ? t.complete : t.attention}
                </span>
                <ArrowRight size={17} />
              </button>
            </li>;
          })}
        </ul>
      </details>
    )}
  </section>;
}
