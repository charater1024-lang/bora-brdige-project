export const SECURITY_TRIAGE_LOCALES = ["ko", "en", "ja", "zh"] as const;
export type SecurityTriageLocale = (typeof SECURITY_TRIAGE_LOCALES)[number];

export const SECURITY_TRIAGE_DOMAINS = [
  "transaction",
  "insurance_document",
  "ai_agent",
] as const;
export type SecurityTriageDomain = (typeof SECURITY_TRIAGE_DOMAINS)[number];

export const SECURITY_REVIEW_PRIORITIES = ["low", "medium", "high"] as const;
export type SecurityReviewPriority = (typeof SECURITY_REVIEW_PRIORITIES)[number];

type LocalizedText = Record<SecurityTriageLocale, string>;

export interface SecurityTriageSignal {
  id: string;
  domain: SecurityTriageDomain;
  weight: number;
  /**
   * A directly observed signal that should pause the related external action
   * until a person verifies it through an independent channel. This is a
   * deterministic safety rule, not a fraud or compromise determination.
   */
  immediatePause?: true;
  label: LocalizedText;
  description: LocalizedText;
}

export interface SecurityTriageResult {
  domain: SecurityTriageDomain;
  score: number;
  priority: SecurityReviewPriority;
  selectedCount: number;
  allowedCount: number;
  selectedSignalIds: string[];
  selectedSignals: SecurityTriageSignal[];
  immediatePause: boolean;
  immediatePauseSignalIds: string[];
}

/**
 * This allowlist is deliberately finite. The lab accepts check states only;
 * it never receives free-form messages, document contents, account numbers,
 * model prompts, or other personal information.
 */
export const SECURITY_TRIAGE_SIGNALS: readonly SecurityTriageSignal[] = [
  {
    id: "transaction-unfamiliar-recipient",
    domain: "transaction",
    weight: 18,
    label: {
      ko: "처음 보거나 확인되지 않은 수취인",
      en: "Unfamiliar or unverified recipient",
      ja: "初めて、または未確認の受取人",
      zh: "首次出现或尚未核实的收款人",
    },
    description: {
      ko: "직접 찾은 공식 연락처나 별도 채널로 수취인을 재확인하지 않았습니다.",
      en: "The recipient has not been verified through an independently found official channel.",
      ja: "自分で調べた公式窓口や別経路で受取人を再確認していません。",
      zh: "尚未通过自行查找的官方渠道或独立方式核实收款人。",
    },
  },
  {
    id: "transaction-recipient-details-changed",
    domain: "transaction",
    weight: 24,
    immediatePause: true,
    label: {
      ko: "기존 거래처의 계좌 정보가 갑자기 변경됨",
      en: "A known counterparty suddenly changed payment details",
      ja: "既存の取引先が振込先情報を突然変更",
      zh: "已知交易方突然更改收款信息",
    },
    description: {
      ko: "기존에 확인한 연락처로 변경 사실을 별도로 검증하지 않았습니다.",
      en: "The change has not been verified using previously trusted contact details.",
      ja: "以前から確認済みの連絡先で変更事実を別途検証していません。",
      zh: "尚未使用此前可信的联系方式另行核实该变更。",
    },
  },
  {
    id: "transaction-unusual-amount",
    domain: "transaction",
    weight: 16,
    label: {
      ko: "평소와 크게 다른 금액",
      en: "Amount is far outside the usual range",
      ja: "通常範囲から大きく外れた金額",
      zh: "金额明显偏离平时范围",
    },
    description: {
      ko: "본인이 알고 있는 평소 거래 범위와 비교했을 때 차이가 큽니다.",
      en: "The amount differs substantially from the range the user normally expects.",
      ja: "本人が把握する通常の取引範囲と比べて大きな差があります。",
      zh: "与用户本人了解的日常交易范围相比差异较大。",
    },
  },
  {
    id: "transaction-rapid-repeat",
    domain: "transaction",
    weight: 18,
    label: {
      ko: "짧은 시간에 반복 요청됨",
      en: "Repeated requests in a short period",
      ja: "短時間に繰り返し要求された",
      zh: "短时间内被反复要求操作",
    },
    description: {
      ko: "같거나 비슷한 송금·결제 요청이 짧은 시간에 이어졌습니다.",
      en: "Similar transfer or payment requests arrived close together.",
      ja: "同一または類似する送金・決済要求が短時間に続きました。",
      zh: "相同或相似的转账、支付请求在短时间内连续出现。",
    },
  },
  {
    id: "transaction-new-device-or-location",
    domain: "transaction",
    weight: 14,
    label: {
      ko: "새 기기·지역에서 시작된 것으로 보임",
      en: "Appears to originate from a new device or location",
      ja: "新しい端末・地域から開始されたように見える",
      zh: "看起来来自新的设备或地区",
    },
    description: {
      ko: "사용자가 직접 확인한 화면에서 평소와 다른 접속 정보가 보였습니다.",
      en: "The user observed access information that differs from their normal activity.",
      ja: "本人が確認した画面で通常と異なるアクセス情報が表示されました。",
      zh: "用户在自行查看的页面中发现了不同于平时的登录信息。",
    },
  },
  {
    id: "transaction-remote-control-or-code",
    domain: "transaction",
    weight: 30,
    immediatePause: true,
    label: {
      ko: "원격제어·인증번호 공유를 함께 요구함",
      en: "Remote control or a verification code was requested",
      ja: "遠隔操作・認証番号の共有も要求された",
      zh: "同时要求远程控制或提供验证码",
    },
    description: {
      ko: "거래 진행을 이유로 화면 공유, 앱 설치, 비밀번호 또는 인증번호를 요구받았습니다.",
      en: "The transaction request also asks for screen sharing, app installation, a password, or a one-time code.",
      ja: "取引を理由に画面共有、アプリ導入、パスワードまたは認証番号を求められました。",
      zh: "对方以办理交易为由要求共享屏幕、安装应用、提供密码或验证码。",
    },
  },
  {
    id: "insurance-date-sequence-conflict",
    domain: "insurance_document",
    weight: 18,
    label: {
      ko: "문서 사이의 날짜 순서가 맞지 않음",
      en: "Dates conflict across documents",
      ja: "書類間の日付順序が一致しない",
      zh: "不同文件之间的日期顺序不一致",
    },
    description: {
      ko: "발생일·진료일·발급일·청구일의 순서에 사람이 다시 확인할 차이가 있습니다.",
      en: "The event, treatment, issue, or claim dates need a human consistency review.",
      ja: "発生日・診療日・発行日・請求日の順序を人が再確認する必要があります。",
      zh: "事故日、就诊日、开具日或理赔申请日需要人工复核一致性。",
    },
  },
  {
    id: "insurance-amount-mismatch",
    domain: "insurance_document",
    weight: 20,
    label: {
      ko: "합계 금액이 문서별로 일치하지 않음",
      en: "Totals do not agree across documents",
      ja: "書類ごとの合計金額が一致しない",
      zh: "不同文件中的合计金额不一致",
    },
    description: {
      ko: "영수증·세부내역·청구서에 적힌 합계가 서로 다르게 보입니다.",
      en: "The receipt, itemized statement, and claim form appear to show different totals.",
      ja: "領収書・明細書・請求書の合計額が異なって見えます。",
      zh: "收据、明细和理赔申请表上的合计金额看起来不一致。",
    },
  },
  {
    id: "insurance-duplicate-reference",
    domain: "insurance_document",
    weight: 22,
    immediatePause: true,
    label: {
      ko: "같은 문서 식별번호가 중복됨",
      en: "A document reference appears more than once",
      ja: "同じ書類識別番号が重複している",
      zh: "同一文件编号重复出现",
    },
    description: {
      ko: "사용자가 직접 비교한 문서에서 동일한 접수·영수증 번호가 반복됩니다.",
      en: "The user observed the same claim or receipt reference in more than one document.",
      ja: "本人が比較した書類で同一の受付・領収番号が複数回現れます。",
      zh: "用户自行比对时发现同一申请号或收据号在多份文件中出现。",
    },
  },
  {
    id: "insurance-party-field-mismatch",
    domain: "insurance_document",
    weight: 18,
    immediatePause: true,
    label: {
      ko: "기관·계약 역할 표기가 서로 다름",
      en: "Organization or policy-role fields differ",
      ja: "機関名・契約上の役割表記が異なる",
      zh: "机构或保单角色字段不一致",
    },
    description: {
      ko: "문서 원문을 업로드하지 않고, 사용자가 눈으로 비교한 역할·기관 표기 차이만 체크합니다.",
      en: "Only the user's observation is checked; no document names or personal fields are collected.",
      ja: "書類原文は収集せず、本人が目視比較した役割・機関表記の差だけを確認します。",
      zh: "不收集文件原文，只记录用户目视比较到的角色或机构标注差异。",
    },
  },
  {
    id: "insurance-missing-page-or-field",
    domain: "insurance_document",
    weight: 12,
    label: {
      ko: "필수 페이지·서명·항목이 빠져 보임",
      en: "A required page, signature, or field appears missing",
      ja: "必須ページ・署名・項目が欠けているように見える",
      zh: "看起来缺少必要页面、签名或字段",
    },
    description: {
      ko: "제출 안내와 비교했을 때 사람이 보완 여부를 확인할 항목이 있습니다.",
      en: "A human should compare the package with the insurer's current submission guide.",
      ja: "保険会社の最新提出案内と照合し、人が補完要否を確認する項目があります。",
      zh: "需要人工对照保险机构最新提交说明，确认是否需要补充。",
    },
  },
  {
    id: "insurance-edit-or-format-conflict",
    domain: "insurance_document",
    weight: 16,
    label: {
      ko: "서식·수정 흔적이 문서 안에서 일관되지 않음",
      en: "Formatting or visible edits are inconsistent",
      ja: "書式・目視できる修正跡が一貫しない",
      zh: "格式或可见修改痕迹前后不一致",
    },
    description: {
      ko: "글꼴·정렬·수정 표시처럼 사람이 원본 기관에 확인할 차이가 보입니다.",
      en: "Visible differences such as fonts, alignment, or edit marks should be checked with the issuer.",
      ja: "字体・配置・修正表示などの差を発行元へ確認する必要があります。",
      zh: "字体、对齐或修改标记等可见差异应向出具机构核实。",
    },
  },
  {
    id: "agent-instruction-override",
    domain: "ai_agent",
    weight: 22,
    immediatePause: true,
    label: {
      ko: "기존 지시를 무시하라는 입력",
      en: "Input asks the agent to ignore prior instructions",
      ja: "以前の指示を無視するよう求める入力",
      zh: "输入要求智能体忽略既有指令",
    },
    description: {
      ko: "외부 콘텐츠가 시스템·개발자 정책보다 자신을 우선하라고 요구합니다.",
      en: "External content asks to take priority over system or developer policy.",
      ja: "外部コンテンツがシステム・開発者方針より自分を優先するよう要求します。",
      zh: "外部内容要求其优先级高于系统或开发者策略。",
    },
  },
  {
    id: "agent-secret-request",
    domain: "ai_agent",
    weight: 30,
    immediatePause: true,
    label: {
      ko: "비밀·토큰·내부 프롬프트를 요구함",
      en: "Requests secrets, tokens, or internal prompts",
      ja: "秘密・トークン・内部プロンプトを要求",
      zh: "索取密钥、令牌或内部提示词",
    },
    description: {
      ko: "API 키, 세션, 환경 변수, 내부 지시문을 출력하거나 전달하라고 요구합니다.",
      en: "The input asks to reveal or transmit API keys, sessions, environment values, or hidden instructions.",
      ja: "APIキー、セッション、環境変数、内部指示の出力・送信を求めます。",
      zh: "输入要求输出或传送 API 密钥、会话、环境变量或内部指令。",
    },
  },
  {
    id: "agent-untrusted-external-instruction",
    domain: "ai_agent",
    weight: 18,
    immediatePause: true,
    label: {
      ko: "웹·문서 속 명령을 그대로 실행하려 함",
      en: "Attempts to execute instructions found in web or document content",
      ja: "ウェブ・文書内の命令をそのまま実行しようとする",
      zh: "试图直接执行网页或文件中的指令",
    },
    description: {
      ko: "데이터로 취급해야 할 외부 콘텐츠가 도구 실행 명령처럼 사용됩니다.",
      en: "Untrusted content that should be treated as data is being used as a tool command.",
      ja: "データとして扱うべき外部コンテンツがツール実行命令として使われています。",
      zh: "本应作为数据处理的不可信内容被当成了工具执行命令。",
    },
  },
  {
    id: "agent-unbounded-tool-loop",
    domain: "ai_agent",
    weight: 24,
    immediatePause: true,
    label: {
      ko: "횟수·비용 제한 없이 도구를 반복 실행함",
      en: "Repeats tool calls without a count or cost bound",
      ja: "回数・費用上限なしにツールを繰り返す",
      zh: "在没有次数或费用上限时反复调用工具",
    },
    description: {
      ko: "종료 조건, 호출 상한, 사람 승인 없이 외부 작업이 반복될 수 있습니다.",
      en: "External actions can repeat without a stop condition, call ceiling, or human approval.",
      ja: "終了条件、呼出上限、人の承認なしに外部操作が反復される可能性があります。",
      zh: "外部操作可能在没有停止条件、调用上限或人工批准的情况下反复执行。",
    },
  },
  {
    id: "agent-unexpected-destination",
    domain: "ai_agent",
    weight: 22,
    immediatePause: true,
    label: {
      ko: "예상하지 않은 대상에게 데이터·메시지를 보냄",
      en: "Sends data or messages to an unexpected destination",
      ja: "予期しない宛先へデータ・メッセージを送る",
      zh: "向非预期目标发送数据或消息",
    },
    description: {
      ko: "사용자가 지정하지 않은 도메인·수신자·저장소로 외부 전송을 시도합니다.",
      en: "The agent attempts transmission to a domain, recipient, or store the user did not select.",
      ja: "利用者が指定していないドメイン・受信者・保存先へ送信しようとします。",
      zh: "智能体试图向用户未指定的域名、接收方或存储位置传送数据。",
    },
  },
  {
    id: "agent-permission-escalation",
    domain: "ai_agent",
    weight: 28,
    immediatePause: true,
    label: {
      ko: "필요 범위를 넘는 권한·변경을 요구함",
      en: "Requests permissions or changes beyond the task",
      ja: "作業範囲を超える権限・変更を要求",
      zh: "请求超出任务范围的权限或变更",
    },
    description: {
      ko: "읽기 작업이 삭제·결제·배포·계정 변경 같은 중요한 행동으로 확대됩니다.",
      en: "A read task expands into deletion, payment, deployment, or account changes.",
      ja: "読み取り作業が削除・決済・配布・アカウント変更へ拡大します。",
      zh: "只读任务扩展为删除、支付、部署或账户变更等重要操作。",
    },
  },
] as const;

const SIGNALS_BY_DOMAIN = new Map(
  SECURITY_TRIAGE_DOMAINS.map((domain) => [
    domain,
    SECURITY_TRIAGE_SIGNALS.filter((signal) => signal.domain === domain),
  ]),
);

export function securityTriageSignalsFor(domain: SecurityTriageDomain) {
  return SIGNALS_BY_DOMAIN.get(domain) ?? [];
}

export function securityReviewPriority(score: number): SecurityReviewPriority {
  if (!Number.isFinite(score)) return "low";
  if (score >= 55) return "high";
  if (score >= 25) return "medium";
  return "low";
}

/**
 * Calculate a review queue priority from allowlisted checkbox IDs only.
 * Unknown, cross-domain, duplicate, and non-string values are ignored.
 * The score is a deterministic triage weight, not a probability.
 */
export function evaluateSecurityTriage(
  domain: SecurityTriageDomain,
  selectedSignalIds: unknown,
): SecurityTriageResult {
  const allowedSignals = securityTriageSignalsFor(domain);
  const allowedById = new Map(allowedSignals.map((signal) => [signal.id, signal]));
  const selectedIds = Array.isArray(selectedSignalIds)
    ? [...new Set(selectedSignalIds.filter((value): value is string => (
      typeof value === "string" && allowedById.has(value)
    )))]
    : [];
  const selectedSignals = selectedIds.flatMap((id) => {
    const signal = allowedById.get(id);
    return signal ? [signal] : [];
  });
  const score = Math.min(
    100,
    selectedSignals.reduce((sum, signal) => sum + signal.weight, 0),
  );
  const immediatePauseSignalIds = selectedSignals
    .filter((signal) => signal.immediatePause === true)
    .map((signal) => signal.id);

  return {
    domain,
    score,
    priority: securityReviewPriority(score),
    selectedCount: selectedSignals.length,
    allowedCount: allowedSignals.length,
    selectedSignalIds: selectedIds,
    selectedSignals,
    immediatePause: immediatePauseSignalIds.length > 0,
    immediatePauseSignalIds,
  };
}
