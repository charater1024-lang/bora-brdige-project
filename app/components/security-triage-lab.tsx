"use client";

import {
  Bot,
  Building2,
  FileCheck2,
  LockKeyhole,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";

import {
  evaluateSecurityTriage,
  SECURITY_TRIAGE_DOMAINS,
  securityTriageSignalsFor,
  type SecurityReviewPriority,
  type SecurityTriageDomain,
  type SecurityTriageLocale,
} from "@/lib/security-triage";
import styles from "./security-triage-lab.module.css";

const domainIcons = {
  transaction: ReceiptText,
  insurance_document: FileCheck2,
  ai_agent: Bot,
} satisfies Record<SecurityTriageDomain, typeof ReceiptText>;

const copy = {
  ko: {
    eyebrow: "EXPLAINABLE SECURITY TRIAGE",
    title: "검토 우선순위 자가점검",
    lead: "자유 입력이나 파일 업로드 없이, 내가 직접 확인한 신호만 체크해 사람이 먼저 살펴볼 순서를 정합니다.",
    domains: {
      transaction: {
        title: "거래 이상 징후",
        lead: "송금·결제 전에 사용자가 직접 본 변화와 요청 방식을 점검합니다.",
        boundary: "실시간 계좌 감시, 수취계좌 평판 조회, 거래 중단 기능은 포함하지 않습니다.",
        stopAction: "송금·결제, 화면 공유, 앱 설치, 비밀번호·인증번호 전달을 즉시 멈추세요.",
        verifyAction: "메시지 속 연락처가 아닌, 직접 찾은 금융회사·거래처 공식 채널로 수취인과 요청 내용을 다시 확인하세요.",
      },
      insurance_document: {
        title: "보험청구 문서 일관성",
        lead: "문서를 업로드하지 않고 날짜·금액·서식 차이를 눈으로 비교한 결과만 체크합니다.",
        boundary: "문서 진위, 사고 사실, 책임, 보험금 지급 여부를 결정하지 않습니다.",
        stopAction: "해당 문서의 제출·보완·외부 공유를 잠시 멈추고 원본을 별도로 보관하세요.",
        verifyAction: "보험사·병원·발급기관의 직접 찾은 공식 채널로 문서 식별번호와 발급 내용을 확인하세요.",
      },
      ai_agent: {
        title: "AI 에이전트 공격",
        lead: "외부 지시, 비밀 요청, 권한 확대, 반복 도구 실행을 사람이 검토할 신호로 정리합니다.",
        boundary: "실행 중인 에이전트를 감시하거나 자동으로 차단하는 보안 제품이 아닙니다.",
        stopAction: "도구 실행, 외부 전송, 권한 변경과 비밀·토큰 공개를 즉시 보류하세요.",
        verifyAction: "승인된 담당자가 작업 목적·대상·권한·감사 로그를 확인한 뒤 격리된 환경이나 새 세션에서만 재개하세요.",
      },
    },
    checklistTitle: "직접 확인한 항목만 선택",
    checklistHelp: "체크하지 않은 사실은 추정하지 않습니다.",
    selected: "선택",
    score: "검토 우선순위 점수",
    scoreHelp: "확률이 아니라 선택한 신호의 고정 가중치 합계입니다.",
    notStarted: "선택 전",
    reviewPriority: "검토 우선순위",
    priorities: {
      low: ["낮음", "선택된 신호가 적습니다. 이 결과만으로 문제없음을 뜻하지는 않습니다."],
      medium: ["보통", "중요 행동 전에 다른 담당자나 공식 채널의 재확인을 권합니다."],
      high: ["높음", "외부 행동을 잠시 멈추고 사람의 검토와 독립적인 재확인을 먼저 진행하세요."],
    },
    immediatePauseTitle: "즉시 멈춤·독립 확인",
    immediatePauseLead: "선택한 신호에는 점수와 별개로 먼저 행동을 보류해야 하는 항목이 있습니다.",
    immediatePauseSignals: "멈춤을 우선하는 신호",
    stopLabel: "1. 지금 멈추기",
    verifyLabel: "2. 독립 확인",
    immediatePauseBoundary: "자동 차단이나 사실 판정이 아니라, 사람이 확인할 때까지 관련 행동을 보류하라는 안전 안내입니다.",
    signalBars: "선택한 신호별 검토 가중치",
    points: "점",
    reset: "현재 탭 초기화",
    privacyTitle: "텍스트·문서·개인식별정보를 받지 않습니다",
    privacyBody: "체크 상태는 현재 화면의 브라우저 메모리에서만 계산하며 서버로 보내거나 자동 저장하지 않습니다. 이름, 계좌번호, 보험 문서, 프롬프트 원문은 입력할 수 없습니다.",
    disclaimerTitle: "결과의 경계",
    disclaimerBody: "이 결과는 교육용 검토 순서입니다. 사실관계, 위법성, 보상 가능성, 거래 승인·차단 또는 시스템 안전성을 결정하지 않습니다. 낮은 우선순위도 안전을 보장하지 않습니다.",
    partnershipTitle: "실제 운영에는 제휴와 통제가 필요합니다",
    partnershipBody: "실시간 거래 분석은 금융회사와 동의된 거래 데이터가, 보험 문서 검증은 보험사·발급기관 연계가, AI 에이전트 차단은 승인 정책·감사 로그·도구 권한 통제가 필요합니다.",
  },
  en: {
    eyebrow: "EXPLAINABLE SECURITY TRIAGE",
    title: "Self-check for review priority",
    lead: "Without free text or file uploads, select only signals you observed and decide what a person should review first.",
    domains: {
      transaction: {
        title: "Transaction warning signs",
        lead: "Review changes and request patterns you personally observed before a transfer or payment.",
        boundary: "This does not monitor accounts in real time, check recipient reputation, or stop a transaction.",
        stopAction: "Stop the transfer or payment, screen sharing, app installation, and disclosure of passwords or verification codes.",
        verifyAction: "Use a financial institution or counterparty channel you found independently—not a contact in the message—to verify the recipient and request.",
      },
      insurance_document: {
        title: "Insurance-claim document consistency",
        lead: "Upload nothing. Check only date, amount, and formatting differences you observed yourself.",
        boundary: "This does not determine document authenticity, events, liability, or claim payment.",
        stopAction: "Pause submission, correction, and external sharing of the document, and keep the original separately.",
        verifyAction: "Use an independently found official insurer, hospital, or issuer channel to verify the document reference and issuance details.",
      },
      ai_agent: {
        title: "AI-agent attacks",
        lead: "Organize external instructions, secret requests, permission expansion, and repeated tool use for human review.",
        boundary: "This is not a security product that monitors or automatically blocks a running agent.",
        stopAction: "Suspend tool calls, external transmission, permission changes, and disclosure of secrets or tokens.",
        verifyAction: "Resume only in an isolated environment or new session after an approved reviewer checks the purpose, destination, permissions, and audit log.",
      },
    },
    checklistTitle: "Select only what you observed",
    checklistHelp: "Unchecked facts are never inferred.",
    selected: "selected",
    score: "Review-priority score",
    scoreHelp: "This is a sum of fixed signal weights, not a probability.",
    notStarted: "Not started",
    reviewPriority: "Review priority",
    priorities: {
      low: ["Low", "Few signals are selected. This does not establish that no issue exists."],
      medium: ["Medium", "Before an important action, verify with another reviewer or an official channel."],
      high: ["High", "Pause external actions and perform human review and independent verification first."],
    },
    immediatePauseTitle: "Pause now · verify independently",
    immediatePauseLead: "One or more selected signals require pausing the related action regardless of the numeric score.",
    immediatePauseSignals: "Signals requiring a pause",
    stopLabel: "1. Pause now",
    verifyLabel: "2. Verify independently",
    immediatePauseBoundary: "This is a safety instruction to hold the related action for human review, not an automatic block or a factual determination.",
    signalBars: "Review weight for each selected signal",
    points: "points",
    reset: "Reset this tab",
    privacyTitle: "No text, documents, or personal identifiers are collected",
    privacyBody: "Checks are calculated only in this page's browser memory and are not sent to a server or saved automatically. Names, account numbers, insurance files, and original prompts cannot be entered.",
    disclaimerTitle: "Result boundary",
    disclaimerBody: "This result is an educational review order. It does not decide facts, legality, compensation, transaction approval or blocking, or system safety. A low priority does not guarantee safety.",
    partnershipTitle: "Real operation requires partnerships and controls",
    partnershipBody: "Live transaction analysis requires a financial-institution partnership and consented data; document verification requires insurer and issuer links; agent protection requires approval policy, audit logs, and tool-permission controls.",
  },
  ja: {
    eyebrow: "EXPLAINABLE SECURITY TRIAGE",
    title: "確認優先度セルフチェック",
    lead: "自由入力やファイル送信なしで、自分が確認した兆候だけを選び、人が先に見る順序を決めます。",
    domains: {
      transaction: {
        title: "取引の異常兆候",
        lead: "送金・決済前に、本人が確認した変化と要求方法を点検します。",
        boundary: "口座のリアルタイム監視、受取口座の評判照会、取引停止機能はありません。",
        stopAction: "送金・決済、画面共有、アプリ導入、パスワード・認証番号の提供を直ちに停止してください。",
        verifyAction: "メッセージ内の連絡先ではなく、自分で調べた金融機関・取引先の公式窓口で受取人と依頼内容を再確認してください。",
      },
      insurance_document: {
        title: "保険請求書類の整合性",
        lead: "書類を送信せず、日付・金額・書式の差を目視比較した結果だけを選びます。",
        boundary: "書類の真正性、事故事実、責任、保険金支払可否を決定しません。",
        stopAction: "該当書類の提出・補完・外部共有を一時停止し、原本を別に保管してください。",
        verifyAction: "自分で調べた保険会社・病院・発行機関の公式窓口で、書類番号と発行内容を確認してください。",
      },
      ai_agent: {
        title: "AIエージェント攻撃",
        lead: "外部指示、秘密要求、権限拡大、反復ツール実行を人が確認する兆候として整理します。",
        boundary: "稼働中のエージェントを監視・自動遮断するセキュリティ製品ではありません。",
        stopAction: "ツール実行、外部送信、権限変更、秘密・トークンの公開を直ちに保留してください。",
        verifyAction: "承認された担当者が目的・送信先・権限・監査ログを確認した後、隔離環境または新しいセッションでのみ再開してください。",
      },
    },
    checklistTitle: "自分で確認した項目だけを選択",
    checklistHelp: "未選択の事実は推測しません。",
    selected: "選択",
    score: "確認優先度スコア",
    scoreHelp: "確率ではなく、選択した兆候の固定重みの合計です。",
    notStarted: "選択前",
    reviewPriority: "確認優先度",
    priorities: {
      low: ["低", "選択された兆候は少数です。この結果だけで問題がないとは判断できません。"],
      medium: ["中", "重要な行動の前に、別の担当者または公式窓口で再確認してください。"],
      high: ["高", "外部操作を一時停止し、人による確認と独立した再検証を先に行ってください。"],
    },
    immediatePauseTitle: "今すぐ停止・独立確認",
    immediatePauseLead: "選択した兆候には、点数に関係なく関連操作を先に保留すべき項目があります。",
    immediatePauseSignals: "停止を優先する兆候",
    stopLabel: "1. 今すぐ停止",
    verifyLabel: "2. 独立して確認",
    immediatePauseBoundary: "自動遮断や事実認定ではなく、人が確認するまで関連操作を保留するための安全案内です。",
    signalBars: "選択した兆候ごとの確認重み",
    points: "点",
    reset: "このタブをリセット",
    privacyTitle: "文章・書類・個人識別情報を収集しません",
    privacyBody: "チェック状態は現在画面のブラウザメモリだけで計算し、サーバー送信や自動保存はしません。氏名、口座番号、保険書類、プロンプト原文は入力できません。",
    disclaimerTitle: "結果の範囲",
    disclaimerBody: "これは教育目的の確認順序です。事実、違法性、補償可能性、取引の承認・遮断、システムの安全性を決定しません。低い優先度でも安全を保証しません。",
    partnershipTitle: "実運用には連携と統制が必要です",
    partnershipBody: "リアルタイム取引分析には金融機関との連携と同意済みデータ、書類検証には保険会社・発行機関との連携、エージェント保護には承認方針・監査ログ・ツール権限制御が必要です。",
  },
  zh: {
    eyebrow: "EXPLAINABLE SECURITY TRIAGE",
    title: "审查优先级自查",
    lead: "无需自由文本或文件上传，只勾选你亲自观察到的信号，用于安排人工先审查什么。",
    domains: {
      transaction: {
        title: "交易异常信号",
        lead: "在转账或支付前，检查你亲自看到的变化和对方的请求方式。",
        boundary: "不提供账户实时监控、收款账户信誉查询或交易拦截。",
        stopAction: "立即停止转账或支付、屏幕共享、安装应用以及提供密码或验证码。",
        verifyAction: "不要使用消息中的联系方式；请通过自行查找的金融机构或交易方官方渠道核实收款人和请求内容。",
      },
      insurance_document: {
        title: "保险理赔文件一致性",
        lead: "无需上传文件，只勾选你目视比较到的日期、金额和格式差异。",
        boundary: "不决定文件真伪、事故事实、责任或理赔支付结果。",
        stopAction: "暂停提交、补充或对外共享该文件，并单独保存原件。",
        verifyAction: "通过自行查找的保险公司、医院或出具机构官方渠道核实文件编号和出具内容。",
      },
      ai_agent: {
        title: "AI 智能体攻击",
        lead: "把外部指令、密钥请求、权限扩大和重复工具执行整理为人工审查信号。",
        boundary: "这不是监控或自动阻止运行中智能体的安全产品。",
        stopAction: "立即暂停工具调用、外部传输、权限变更以及公开密钥或令牌。",
        verifyAction: "由获批审查人员核对任务目的、目标、权限和审计日志后，只在隔离环境或新会话中恢复。",
      },
    },
    checklistTitle: "只选择你亲自确认的项目",
    checklistHelp: "不会推测未勾选的事实。",
    selected: "已选",
    score: "审查优先级分数",
    scoreHelp: "这是所选信号固定权重之和，不是概率。",
    notStarted: "尚未选择",
    reviewPriority: "审查优先级",
    priorities: {
      low: ["低", "目前选择的信号较少，但这并不代表不存在问题。"],
      medium: ["中", "执行重要操作前，请由另一位审查人员或官方渠道再次核实。"],
      high: ["高", "请先暂停外部操作，进行人工审查和独立核实。"],
    },
    immediatePauseTitle: "立即暂停·独立核实",
    immediatePauseLead: "所选信号中有需要不受分数影响、优先暂停相关操作的项目。",
    immediatePauseSignals: "需要优先暂停的信号",
    stopLabel: "1. 立即暂停",
    verifyLabel: "2. 独立核实",
    immediatePauseBoundary: "这只是要求在人工核实前暂停相关操作的安全提示，不是自动拦截或事实认定。",
    signalBars: "各已选信号的审查权重",
    points: "分",
    reset: "重置当前标签",
    privacyTitle: "不收集文本、文件或个人身份信息",
    privacyBody: "勾选状态只在当前页面的浏览器内存中计算，不发送到服务器，也不自动保存。无法输入姓名、账号、保险文件或原始提示词。",
    disclaimerTitle: "结果边界",
    disclaimerBody: "本结果只是教育用途的审查顺序，不决定事实、违法性、赔付可能性、交易批准或拦截，也不判断系统安全。低优先级同样不能保证安全。",
    partnershipTitle: "实际运营需要机构合作与控制措施",
    partnershipBody: "实时交易分析需要金融机构合作和经同意的数据；文件核验需要保险公司与出具机构连接；智能体防护需要审批策略、审计日志和工具权限控制。",
  },
} satisfies Record<SecurityTriageLocale, {
  eyebrow: string;
  title: string;
  lead: string;
  domains: Record<SecurityTriageDomain, {
    title: string;
    lead: string;
    boundary: string;
    stopAction: string;
    verifyAction: string;
  }>;
  checklistTitle: string;
  checklistHelp: string;
  selected: string;
  score: string;
  scoreHelp: string;
  notStarted: string;
  reviewPriority: string;
  priorities: Record<SecurityReviewPriority, [string, string]>;
  immediatePauseTitle: string;
  immediatePauseLead: string;
  immediatePauseSignals: string;
  stopLabel: string;
  verifyLabel: string;
  immediatePauseBoundary: string;
  signalBars: string;
  points: string;
  reset: string;
  privacyTitle: string;
  privacyBody: string;
  disclaimerTitle: string;
  disclaimerBody: string;
  partnershipTitle: string;
  partnershipBody: string;
}>;

const priorityNoticeCopy = {
  ko: {
    transaction: "거래 이상 징후 점수는 이상거래를 확정하는 결과가 아닙니다. 점수가 높은 항목부터 담당자가 사실관계를 확인하도록 검토 순서를 정하는 보조 지표입니다.",
    insurance_document: "보험청구 문서 일관성 점수는 허위 청구나 보험사기 여부에 관한 결론을 내리지 않습니다. 불일치 신호가 많은 문서부터 원본과 발급기관을 확인하도록 검토 순서를 정하는 보조 지표입니다.",
    ai_agent: "AI 에이전트 공격 점수는 침해나 공격 성공을 확정하지 않습니다. 위험 신호가 큰 입력부터 실행을 보류하고 사람이 검토하도록 대응 순서를 정하는 보조 지표입니다.",
  },
  en: {
    transaction: "The transaction-anomaly score is not a finding of suspicious activity. It only helps reviewers decide which items to verify first.",
    insurance_document: "The insurance-document consistency score does not establish a false claim or fraud. It only orders which documents should be checked against originals and issuers first.",
    ai_agent: "The AI-agent attack score does not establish a compromise or successful attack. It only orders which inputs should be paused and reviewed by a person first.",
  },
  ja: {
    transaction: "取引異常シグナルの点数は異常取引の確定ではありません。点数の高い項目から担当者が事実確認するための確認順序を示す補助指標です。",
    insurance_document: "保険請求書類の整合性点数は、虚偽請求・保険詐欺についての結論を出すものではありません。不一致が多い書類から原本・発行元を確認する順序を示す補助指標です。",
    ai_agent: "AIエージェント攻撃の点数は侵害や攻撃成功を確定しません。危険シグナルの大きい入力から実行を保留し、人が確認する順序を示す補助指標です。",
  },
  zh: {
    transaction: "交易异常信号分数并不认定存在异常交易，仅用于安排工作人员优先核实高分项目。",
    insurance_document: "保险理赔文件一致性分数不认定虚假理赔或保险欺诈，仅用于安排优先核对原件和签发机构的文件。",
    ai_agent: "AI 智能体攻击分数不认定系统已被入侵或攻击成功，仅用于安排优先暂停并由人工审核高风险输入。",
  },
} satisfies Record<
  SecurityTriageLocale,
  Record<SecurityTriageDomain, string>
>;

const emptySelections = (): Record<SecurityTriageDomain, string[]> => ({
  transaction: [],
  insurance_document: [],
  ai_agent: [],
});

function tabId(domain: SecurityTriageDomain) {
  return `security-triage-tab-${domain}`;
}

export function SecurityTriageLab({
  locale = "ko",
}: {
  locale?: SecurityTriageLocale;
}) {
  const [activeDomain, setActiveDomain] = useState<SecurityTriageDomain>("transaction");
  const [selectedByDomain, setSelectedByDomain] = useState(emptySelections);
  const t = copy[locale];
  const signals = useMemo(() => securityTriageSignalsFor(activeDomain), [activeDomain]);
  const result = useMemo(
    () => evaluateSecurityTriage(activeDomain, selectedByDomain[activeDomain]),
    [activeDomain, selectedByDomain],
  );
  const priorityCopy = t.priorities[result.priority];
  const immediatePauseSignals = result.selectedSignals.filter((signal) =>
    result.immediatePauseSignalIds.includes(signal.id),
  );
  const ActiveIcon = domainIcons[activeDomain];

  function toggleSignal(signalId: string) {
    setSelectedByDomain((current) => {
      const selected = current[activeDomain];
      const next = selected.includes(signalId)
        ? selected.filter((id) => id !== signalId)
        : [...selected, signalId];
      return { ...current, [activeDomain]: next };
    });
  }

  function resetActiveDomain() {
    setSelectedByDomain((current) => ({ ...current, [activeDomain]: [] }));
  }

  function selectTab(domain: SecurityTriageDomain) {
    setActiveDomain(domain);
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    domain: SecurityTriageDomain,
  ) {
    const index = SECURITY_TRIAGE_DOMAINS.indexOf(domain);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % SECURITY_TRIAGE_DOMAINS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + SECURITY_TRIAGE_DOMAINS.length) % SECURITY_TRIAGE_DOMAINS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = SECURITY_TRIAGE_DOMAINS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextDomain = SECURITY_TRIAGE_DOMAINS[nextIndex];
    setActiveDomain(nextDomain);
    window.requestAnimationFrame(() => document.getElementById(tabId(nextDomain))?.focus());
  }

  return (
    <section className={styles.shell} aria-labelledby="security-triage-title">
      <header className={styles.hero}>
        <div className={styles.heroIcon}><ShieldCheck aria-hidden="true" /></div>
        <div>
          <span>{t.eyebrow}</span>
          <h2 id="security-triage-title">{t.title}</h2>
          <p>{t.lead}</p>
        </div>
      </header>

      <div className={styles.privacy}>
        <LockKeyhole aria-hidden="true" />
        <div><strong>{t.privacyTitle}</strong><p>{t.privacyBody}</p></div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label={t.title}>
        {SECURITY_TRIAGE_DOMAINS.map((domain) => {
          const Icon = domainIcons[domain];
          const selected = activeDomain === domain;
          return (
            <button
              key={domain}
              id={tabId(domain)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="security-triage-panel"
              tabIndex={selected ? 0 : -1}
              className={selected ? styles.activeTab : undefined}
              onClick={() => selectTab(domain)}
              onKeyDown={(event) => handleTabKeyDown(event, domain)}
            >
              <Icon aria-hidden="true" />
              <span>{t.domains[domain].title}</span>
              <small>{selectedByDomain[domain].length}</small>
            </button>
          );
        })}
      </div>

      <div className={styles.priorityNotice} role="note" aria-live="polite">
        <TriangleAlert aria-hidden="true" />
        <p>{priorityNoticeCopy[locale][activeDomain]}</p>
      </div>

      <div
        id="security-triage-panel"
        className={styles.panel}
        role="tabpanel"
        aria-labelledby={tabId(activeDomain)}
      >
        <div className={styles.domainHeading}>
          <div className={styles.domainIcon}><ActiveIcon aria-hidden="true" /></div>
          <div>
            <h3>{t.domains[activeDomain].title}</h3>
            <p>{t.domains[activeDomain].lead}</p>
            <small>{t.domains[activeDomain].boundary}</small>
          </div>
        </div>

        <div className={styles.workspace}>
          <div className={styles.checklist}>
            <div className={styles.checklistHeading}>
              <div><strong>{t.checklistTitle}</strong><p>{t.checklistHelp}</p></div>
              <span>{result.selectedCount}/{result.allowedCount} {t.selected}</span>
            </div>
            <div className={styles.signalOptions}>
              {signals.map((signal) => {
                const checked = result.selectedSignalIds.includes(signal.id);
                return (
                  <label key={signal.id} className={styles.signalOption} data-checked={checked}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSignal(signal.id)}
                    />
                    <span className={styles.customCheck} aria-hidden="true" />
                    <span>
                      <strong>{signal.label[locale]}</strong>
                      <small>{signal.description[locale]}</small>
                    </span>
                    <em>+{signal.weight}</em>
                  </label>
                );
              })}
            </div>
          </div>

          <aside className={styles.result}>
            {result.immediatePause && (
              <section
                className={styles.immediatePause}
                data-domain={activeDomain}
                role="alert"
              >
                <header>
                  <TriangleAlert aria-hidden="true" />
                  <div>
                    <span>{t.immediatePauseTitle}</span>
                    <strong>{t.immediatePauseLead}</strong>
                  </div>
                </header>
                <div className={styles.pauseSignals}>
                  <span>{t.immediatePauseSignals}</span>
                  <ul>
                    {immediatePauseSignals.map((signal) => (
                      <li key={signal.id}>{signal.label[locale]}</li>
                    ))}
                  </ul>
                </div>
                <ol className={styles.pauseActions}>
                  <li>
                    <strong>{t.stopLabel}</strong>
                    <p>{t.domains[activeDomain].stopAction}</p>
                  </li>
                  <li>
                    <strong>{t.verifyLabel}</strong>
                    <p>{t.domains[activeDomain].verifyAction}</p>
                  </li>
                </ol>
                <small>{t.immediatePauseBoundary}</small>
              </section>
            )}
            <div className={styles.scoreCard} data-priority={result.selectedCount ? result.priority : "idle"}>
              <span>{t.score}</span>
              <strong>{result.score}<small>/100</small></strong>
              <p>{t.scoreHelp}</p>
            </div>
            <div className={styles.priority} aria-live="polite">
              <span>{t.reviewPriority}</span>
              <strong>{result.selectedCount ? priorityCopy[0] : t.notStarted}</strong>
              <p>{result.selectedCount ? priorityCopy[1] : t.checklistHelp}</p>
            </div>

            {result.selectedCount > 0 && (
              <div
                className={styles.signalChart}
                role="img"
                aria-label={`${t.signalBars}: ${result.selectedSignals
                  .map((signal) => `${signal.label[locale]} ${signal.weight} ${t.points}`)
                  .join(", ")}`}
              >
                <strong>{t.signalBars}</strong>
                <ul>
                  {result.selectedSignals.map((signal) => (
                    <li key={signal.id}>
                      <span>{signal.label[locale]}</span>
                      <div><i style={{ width: `${Math.max(8, (signal.weight / 30) * 100)}%` }} /></div>
                      <em>{signal.weight}</em>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              className={styles.reset}
              type="button"
              onClick={resetActiveDomain}
              disabled={result.selectedCount === 0}
            >
              <RotateCcw aria-hidden="true" />{t.reset}
            </button>
          </aside>
        </div>
      </div>

      <div className={styles.boundaries}>
        <article>
          <TriangleAlert aria-hidden="true" />
          <div><strong>{t.disclaimerTitle}</strong><p>{t.disclaimerBody}</p></div>
        </article>
        <article>
          <Building2 aria-hidden="true" />
          <div><strong>{t.partnershipTitle}</strong><p>{t.partnershipBody}</p></div>
        </article>
      </div>
    </section>
  );
}

export default SecurityTriageLab;
