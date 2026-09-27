"use client";

import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  ExternalLink,
  FileWarning,
  Landmark,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  FINANCIAL_MISSION_STATUS_COPY,
  financialMissions,
  financialMissionSelfCheckProgress,
  type FinancialMissionLocale,
  type FinancialMissionStatus,
} from "@/lib/financial-missions";
import styles from "./financial-mission-center.module.css";

export interface FinancialMissionCenterProps {
  locale: FinancialMissionLocale;
  easyMode?: boolean;
  onNavigate: (target: string) => void;
}

const copy = {
  ko: {
    eyebrow: "FINANCIAL MISSION CENTER",
    title: "7가지 금융 미션을 한곳에서 점검하세요",
    lead: "관심 분야를 먼저 선택하면 한 번에 하나의 상세 안내만 보여드립니다.",
    chooseTitle: "확인할 분야를 선택하세요",
    chooseLead: "선택한 미션의 제공 범위·자가 점검·공식 안내만 아래에 펼쳐집니다.",
    stateGuide: "기능 상태 안내",
    selfCheck: "자가 점검",
    selfCheckLead: "직접 확인한 항목만 선택하세요. 선택 결과는 금융 평가나 자격 판정이 아닙니다.",
    completed: "확인 완료",
    evidence: "현재 제공 범위",
    officialPreview: "공식 안내 미리보기",
    officialPreviewLead: "핵심 내용을 먼저 읽고, 최종 조건과 최신 공지는 공식 원문에서 확인하세요.",
    whenToUse: "이럴 때 확인하세요",
    officialCta: "공식 원문에서 최신 조건 확인",
    mission: "미션",
  },
  en: {
    eyebrow: "FINANCIAL MISSION CENTER",
    title: "Review seven financial missions in one place",
    lead: "Choose an area first to focus on one detailed guide at a time.",
    chooseTitle: "Choose an area to review",
    chooseLead: "Only the selected mission's scope, self-check and official guidance opens below.",
    stateGuide: "Feature status guide",
    selfCheck: "Self-check",
    selfCheckLead: "Select only items you personally confirmed. This is not a financial assessment or eligibility decision.",
    completed: "Confirmed",
    evidence: "Current scope",
    officialPreview: "Official guidance preview",
    officialPreviewLead: "Read the key guidance here, then verify final terms and current notices in the official source.",
    whenToUse: "When to use it",
    officialCta: "Check current terms in the official source",
    mission: "Mission",
  },
  ja: {
    eyebrow: "FINANCIAL MISSION CENTER",
    title: "7つの金融ミッションを一か所で確認",
    lead: "関心のある分野を選ぶと、一度に一つの詳細案内だけを表示します。",
    chooseTitle: "確認する分野を選択",
    chooseLead: "選択したミッションの提供範囲・セルフチェック・公式案内だけを下に表示します。",
    stateGuide: "機能状況の案内",
    selfCheck: "セルフチェック",
    selfCheckLead: "自分で確認した項目だけを選んでください。金融評価や資格判定ではありません。",
    completed: "確認済み",
    evidence: "現在の提供範囲",
    officialPreview: "公式案内プレビュー",
    officialPreviewLead: "要点を先に読み、最終条件と最新のお知らせは公式原文で確認してください。",
    whenToUse: "このような時に確認",
    officialCta: "公式原文で最新条件を確認",
    mission: "ミッション",
  },
  zh: {
    eyebrow: "FINANCIAL MISSION CENTER",
    title: "集中查看七项金融任务",
    lead: "先选择关注领域，每次只查看一项详细指引。",
    chooseTitle: "选择要查看的领域",
    chooseLead: "下方仅展开所选任务的服务范围、自检项目和官方指引。",
    stateGuide: "功能状态说明",
    selfCheck: "自我检查",
    selfCheckLead: "请只选择本人已确认的事项；结果并非金融评估或资格判定。",
    completed: "已确认",
    evidence: "当前服务范围",
    officialPreview: "官方指引预览",
    officialPreviewLead: "先阅读核心说明，再到官方原文核对最终条件和最新公告。",
    whenToUse: "适合在此时查看",
    officialCta: "前往官方原文核对最新条件",
    mission: "任务",
  },
} satisfies Record<FinancialMissionLocale, Record<string, string>>;

const missionIcons = [
  WalletCards,
  FileWarning,
  ScanSearch,
  BriefcaseBusiness,
  Building2,
  Landmark,
  Bot,
] as const;

function nextCheckedIds(current: readonly string[], itemId: string, checked: boolean) {
  if (checked) return current.includes(itemId) ? [...current] : [...current, itemId];
  return current.filter((id) => id !== itemId);
}

export function FinancialMissionCenter({
  locale,
  easyMode = false,
  onNavigate,
}: FinancialMissionCenterProps) {
  const t = copy[locale];
  const missions = useMemo(() => financialMissions(locale), [locale]);
  const [checkedByMission, setCheckedByMission] = useState<Record<string, string[]>>({});
  const [activeMissionId, setActiveMissionId] = useState(() => missions[0]?.id ?? "");
  const missionTabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function selectMission(index: number, moveFocus = false) {
    if (missions.length === 0) return;
    const nextIndex = (index + missions.length) % missions.length;
    const mission = missions[nextIndex];
    if (!mission) return;
    setActiveMissionId(mission.id);
    if (moveFocus) {
      window.requestAnimationFrame(() => missionTabRefs.current[nextIndex]?.focus());
    }
  }

  function handleMissionTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = index + 1;
    if (event.key === "ArrowLeft") nextIndex = index - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = missions.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectMission(nextIndex, true);
  }

  return (
    <section
      className={styles.center}
      data-easy-mode={easyMode ? "true" : "false"}
      aria-labelledby="financial-mission-center-title"
    >
      <header className={styles.hero}>
        <div className={styles.heroIcon} aria-hidden="true"><Sparkles size={25} /></div>
        <div>
          <span>{t.eyebrow}</span>
          <h2 id="financial-mission-center-title">{t.title}</h2>
          <p>{t.lead}</p>
        </div>
      </header>

      <details className={styles.statusGuide}>
        <summary>
          <strong id="financial-mission-status-guide">{t.stateGuide}</strong>
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <ul>
          {(Object.keys(FINANCIAL_MISSION_STATUS_COPY[locale]) as FinancialMissionStatus[])
            .map((status) => (
              <li key={status}>
                <span data-status={status}>{FINANCIAL_MISSION_STATUS_COPY[locale][status].label}</span>
                <small>{FINANCIAL_MISSION_STATUS_COPY[locale][status].description}</small>
              </li>
            ))}
        </ul>
      </details>

      <section className={styles.missionPicker} aria-labelledby="financial-mission-picker-title">
        <div className={styles.pickerHeading}>
          <strong id="financial-mission-picker-title">{t.chooseTitle}</strong>
          <small>{t.chooseLead}</small>
        </div>
        <div className={styles.pickerGrid} role="tablist" aria-label={t.chooseTitle}>
          {missions.map((mission, index) => {
            const Icon = missionIcons[index] ?? ShieldCheck;
            const status = FINANCIAL_MISSION_STATUS_COPY[locale][mission.status];
            const checkedIds = checkedByMission[mission.id] ?? [];
            const progress = financialMissionSelfCheckProgress(
              checkedIds,
              mission.readiness.map((item) => item.id),
            );
            const selected = activeMissionId === mission.id;
            return (
              <button
                ref={(node) => { missionTabRefs.current[index] = node; }}
                type="button"
                role="tab"
                id={`${mission.id}-tab`}
                aria-controls={`${mission.id}-panel`}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                key={mission.id}
                onClick={() => selectMission(index)}
                onKeyDown={(event) => handleMissionTabKeyDown(event, index)}
              >
                <span className={styles.pickerIcon}><Icon size={18} /></span>
                <span>
                  <small>{status.label} · {progress.completed}/{progress.total}</small>
                  <strong>{mission.title}</strong>
                </span>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>

      <div className={styles.grid}>
        {missions.map((mission, index) => {
          const Icon = missionIcons[index] ?? ShieldCheck;
          const checkedIds = checkedByMission[mission.id] ?? [];
          const progress = financialMissionSelfCheckProgress(
            checkedIds,
            mission.readiness.map((item) => item.id),
          );
          const status = FINANCIAL_MISSION_STATUS_COPY[locale][mission.status];
          const descriptionId = `${mission.id}-description`;
          const officialPreviewId = `${mission.id}-official-preview`;

          return (
            <article
              className={styles.card}
              data-status={mission.status}
              aria-describedby={descriptionId}
              aria-labelledby={`${mission.id}-tab`}
              id={`${mission.id}-panel`}
              role="tabpanel"
              hidden={activeMissionId !== mission.id}
              key={mission.id}
            >
              <header className={styles.cardHeader}>
                <div className={styles.missionIcon} aria-hidden="true"><Icon size={22} /></div>
                <div>
                  <small>{t.mission} {index + 1}</small>
                  <h3>{mission.title}</h3>
                </div>
                <span className={styles.statusBadge} data-status={mission.status}>
                  {status.label}
                </span>
              </header>

              <p id={descriptionId} className={styles.summary}>{mission.summary}</p>

              <div className={styles.evidence}>
                <strong>{t.evidence}</strong>
                <p>{mission.evidence}</p>
              </div>

              <fieldset className={styles.checklist}>
                <legend>{t.selfCheck}</legend>
                <p>{t.selfCheckLead}</p>
                <div>
                  {mission.readiness.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={checkedIds.includes(item.id)}
                        onChange={(event) => {
                          setCheckedByMission((current) => ({
                            ...current,
                            [mission.id]: nextCheckedIds(
                              current[mission.id] ?? [],
                              item.id,
                              event.target.checked,
                            ),
                          }));
                        }}
                      />
                      <span aria-hidden="true"><ShieldCheck size={15} /></span>
                      <em>{item.label}</em>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className={styles.progress} data-progress-basis="user-self-check">
                <div>
                  <span>{t.selfCheck}</span>
                  <strong>{t.completed} {progress.completed} / {progress.total}</strong>
                </div>
                <div
                  className={styles.progressTrack}
                  role="progressbar"
                  aria-label={`${mission.title} ${t.selfCheck}`}
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.completed}
                  aria-valuetext={`${t.completed} ${progress.completed} / ${progress.total}`}
                >
                  <span style={{ width: `${progress.fraction * 100}%` }} />
                </div>
              </div>

              <div className={styles.actions}>
                <button type="button" onClick={() => onNavigate(mission.target)}>
                  {mission.actionLabel}<ArrowRight size={16} />
                </button>
              </div>

              <section
                className={styles.officialSources}
                aria-labelledby={officialPreviewId}
              >
                <div className={styles.officialHeading}>
                  <h4 id={officialPreviewId}>{t.officialPreview}</h4>
                  <p>{t.officialPreviewLead}</p>
                </div>
                <div className={styles.officialPreviewList}>
                  {mission.officialLinks.map((link) => (
                    <div
                      className={styles.officialPreviewCard}
                      data-official-preview="true"
                      key={link.url}
                    >
                      <h5>{link.label}</h5>
                      <p>{link.summary}</p>
                      <div className={styles.whenToUse}>
                        <strong>{t.whenToUse}</strong>
                        <p>{link.whenToUse}</p>
                      </div>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`${t.officialCta}: ${link.label}`}
                        data-official-current-terms="true"
                      >
                        <span>{t.officialCta}</span>
                        <ExternalLink size={15} aria-hidden="true" />
                      </a>
                    </div>
                  ))}
                </div>
              </section>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default FinancialMissionCenter;
