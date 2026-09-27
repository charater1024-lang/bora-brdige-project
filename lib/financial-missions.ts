export const FINANCIAL_MISSION_LOCALES = ["ko", "en", "ja", "zh"] as const;
export type FinancialMissionLocale = (typeof FINANCIAL_MISSION_LOCALES)[number];

export const FINANCIAL_MISSION_STATUSES = [
  "official-data",
  "direct-input",
  "prototype",
  "partnership-required",
] as const;
export type FinancialMissionStatus = (typeof FINANCIAL_MISSION_STATUSES)[number];

type LocalizedText = Record<FinancialMissionLocale, string>;

export interface FinancialMissionLink {
  label: string;
  summary: string;
  whenToUse: string;
  url: string;
}

export interface FinancialMissionReadinessItem {
  id: string;
  label: string;
}

export interface FinancialMission {
  id: string;
  status: FinancialMissionStatus;
  title: string;
  summary: string;
  evidence: string;
  target: string;
  actionLabel: string;
  readiness: FinancialMissionReadinessItem[];
  officialLinks: FinancialMissionLink[];
}

interface LocalizedMissionDefinition {
  id: string;
  status: FinancialMissionStatus;
  title: LocalizedText;
  summary: LocalizedText;
  evidence: LocalizedText;
  target: string;
  actionLabel: LocalizedText;
  readiness: Array<{ id: string; label: LocalizedText }>;
  officialLinks: LocalizedOfficialLink[];
}

interface LocalizedOfficialLink {
  label: LocalizedText;
  summary: LocalizedText;
  whenToUse: LocalizedText;
  url: string;
}

function officialHttpsUrl(value: string) {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || !parsed.hostname
  ) {
    throw new Error("financial_mission_link_must_be_official_https");
  }
  return parsed.toString();
}

const OFFICIAL_LINK_GUIDANCE = {
  finlife: {
    summary: {
      ko: "금융감독원 공시 기반의 상품 비교 화면에서 공개된 금리와 기본 조건을 살펴볼 수 있습니다.",
      en: "Review published rates and basic terms in the financial product comparison service based on FSS disclosures.",
      ja: "金融監督院の開示に基づく商品比較画面で、公表金利と基本条件を確認できます。",
      zh: "可在基于金融监督院披露的产品比较页面查看已公布的利率和基本条件。",
    },
    whenToUse: {
      ko: "예·적금 등을 비교할 때 기준일, 우대조건, 중도해지 조건을 공식 원문에서 확인하세요.",
      en: "Use it when comparing products, then confirm the reference date, preferential terms, and early-termination terms in the official text.",
      ja: "預貯金などを比較するときに使い、基準日、優遇条件、中途解約条件を公式原文で確認してください。",
      zh: "比较存款等产品时使用，并在官方原文中核对基准日期、优惠条件和提前解约条件。",
    },
  },
  kinfa: {
    summary: {
      ko: "서민금융 지원제도와 상담 창구에 관한 기관의 공식 안내를 확인할 수 있습니다.",
      en: "Review the agency's official guidance on inclusive-finance support programs and counseling channels.",
      ja: "庶民金融の支援制度と相談窓口に関する機関の公式案内を確認できます。",
      zh: "可查看该机构关于普惠金融支持项目和咨询渠道的官方说明。",
    },
    whenToUse: {
      ko: "지원 가능성을 알아볼 때 최신 대상조건, 필요서류, 공식 연락처를 확인하세요.",
      en: "Use it to check current target conditions, required documents, and official contact details; it does not determine eligibility.",
      ja: "支援を検討するときに、最新の対象条件、必要書類、公式連絡先を確認してください。",
      zh: "了解支持项目时，请核对最新适用条件、所需材料和官方联系方式。",
    },
  },
  fine: {
    summary: {
      ko: "금융소비자 유의사항과 금융회사·상품 관련 공식 확인 경로를 안내하는 포털입니다.",
      en: "This portal provides official consumer alerts and routes for checking financial companies and products.",
      ja: "金融消費者向け注意情報と、金融会社・商品を公式に確認する経路を案内するポータルです。",
      zh: "该门户提供金融消费者提示，以及核验金融公司和产品的官方渠道。",
    },
    whenToUse: {
      ko: "의심스러운 권유나 금융상품을 접했을 때 소비자 경보와 공식 확인 창구를 찾아보세요.",
      en: "Use it after a suspicious solicitation or product claim to find consumer alerts and an official verification channel.",
      ja: "不審な勧誘や商品説明を受けたときに、消費者警報と公式確認窓口を探してください。",
      zh: "遇到可疑推销或产品说明时，可查询消费者警示和官方核验渠道。",
    },
  },
  police: {
    summary: {
      ko: "경찰청의 범죄예방 정보와 신고 절차에 대한 공식 안내를 확인할 수 있습니다.",
      en: "Review official Korean National Police Agency information on crime prevention and reporting procedures.",
      ja: "警察庁による犯罪予防情報と通報手順の公式案内を確認できます。",
      zh: "可查看韩国警察厅关于犯罪预防和报案流程的官方说明。",
    },
    whenToUse: {
      ko: "범죄 피해가 의심되거나 신고 절차가 필요할 때 사용하고, 긴급한 경우 112에 연락하세요.",
      en: "Use it when you suspect harm or need reporting steps; contact 112 for an emergency in Korea.",
      ja: "被害が疑われる場合や通報手順が必要なときに使い、韓国で緊急の場合は112へ連絡してください。",
      zh: "怀疑受害或需要报案流程时使用；在韩国遇到紧急情况请拨打112。",
    },
  },
  kStartup: {
    summary: {
      ko: "정부·공공기관의 창업지원 사업 공고와 신청 정보를 확인할 수 있습니다.",
      en: "Review startup-support notices and application information from government and public institutions.",
      ja: "政府・公共機関の創業支援事業の公募と申請情報を確認できます。",
      zh: "可查看政府和公共机构发布的创业支持项目公告及申请信息。",
    },
    whenToUse: {
      ko: "관심 공고를 찾은 뒤 대상지역, 신청자격, 마감일, 제출서류를 공고 원문에서 확인하세요.",
      en: "After finding a relevant notice, confirm the region, eligibility, deadline, and documents in the original notice.",
      ja: "関心のある公募を見つけたら、対象地域、申請条件、締切、提出書類を原文で確認してください。",
      zh: "找到相关公告后，请在原公告中核对地区、申请条件、截止日期和提交材料。",
    },
  },
  bizinfo: {
    summary: {
      ko: "기업과 소상공인을 위한 정부 지원사업 공고를 기관별·분야별로 확인할 수 있습니다.",
      en: "Review government support notices for businesses and small merchants by institution and field.",
      ja: "企業・小規模事業者向けの政府支援公募を、機関別・分野別に確認できます。",
      zh: "可按机构和领域查看面向企业及小微商户的政府支持项目公告。",
    },
    whenToUse: {
      ko: "지원사업을 비교할 때 접수상태와 수행기관 연락처를 공고 원문에서 다시 확인하세요.",
      en: "Use it when comparing support programs, then recheck application status and the implementing agency's contact details.",
      ja: "支援事業を比較するときに使い、受付状況と実施機関の連絡先を原文で再確認してください。",
      zh: "比较支持项目时使用，并在原公告中复核受理状态和执行机构联系方式。",
    },
  },
  dart: {
    summary: {
      ko: "회사가 제출한 공시 원문과 정정공시를 법인별·보고서별로 확인할 수 있습니다.",
      en: "Review company-submitted filing originals and correction filings by legal entity and report.",
      ja: "会社が提出した開示原文と訂正開示を、法人・報告書別に確認できます。",
      zh: "可按法人和报告查看公司提交的披露原文及更正披露。",
    },
    whenToUse: {
      ko: "기업 정보를 검토할 때 정확한 법인명, 보고기간, 최신 정정 여부를 확인하세요.",
      en: "Use it for company research and confirm the exact legal name, reporting period, and latest corrections.",
      ja: "企業情報を調べるときに、正確な法人名、報告期間、最新の訂正有無を確認してください。",
      zh: "研究企业信息时，请核对准确法人名称、报告期和最新更正情况。",
    },
  },
  kind: {
    summary: {
      ko: "상장법인의 거래소 공시와 시장 안내를 확인할 수 있습니다.",
      en: "Review exchange disclosures and market notices for listed companies.",
      ja: "上場法人の取引所開示と市場案内を確認できます。",
      zh: "可查看上市公司的交易所披露和市场公告。",
    },
    whenToUse: {
      ko: "상장·매매 관련 공지를 확인할 때 게시시각과 후속 공지를 함께 살펴보세요.",
      en: "Use it for listing or trading notices and check the publication time and any follow-up notice.",
      ja: "上場・売買関連のお知らせを確認するときに、掲載時刻と後続のお知らせも確認してください。",
      zh: "查询上市或交易公告时，请同时核对发布时间及后续公告。",
    },
  },
  immigration: {
    summary: {
      ko: "외국인의 체류·취업·생활 행정절차에 관한 정부 안내를 확인할 수 있습니다.",
      en: "Review government guidance on immigration status, employment, and administrative procedures for foreign residents.",
      ja: "外国人の在留、就労、生活上の行政手続に関する政府案内を確認できます。",
      zh: "可查看面向外国居民的居留、就业和生活行政手续政府指引。",
    },
    whenToUse: {
      ko: "체류자격이나 제출서류를 준비할 때 최신 절차와 공식 상담번호 1345 안내를 확인하세요.",
      en: "Use it when preparing status or documents, and confirm the latest procedure and official 1345 support information.",
      ja: "在留資格や提出書類を準備するときに、最新手続と公式相談番号1345の案内を確認してください。",
      zh: "准备居留资格或材料时，请核对最新流程及官方1345咨询说明。",
    },
  },
  koreaExim: {
    summary: {
      ko: "한국수출입은행이 게시한 통화별 기준 환율 정보를 확인할 수 있습니다.",
      en: "Review currency reference-rate information published by the Export-Import Bank of Korea.",
      ja: "韓国輸出入銀行が公表する通貨別の基準為替情報を確認できます。",
      zh: "可查看韩国进出口银行公布的各币种参考汇率信息。",
    },
    whenToUse: {
      ko: "환율을 참고할 때 고시일과 통화 단위를 확인하고, 실제 적용환율과 수수료는 거래기관에서 확인하세요.",
      en: "Use it as a reference after checking the date and unit; confirm the applied rate and fees with the transaction provider.",
      ja: "参考にする際は公示日と通貨単位を確認し、実際の適用レートと手数料は取引機関で確認してください。",
      zh: "参考时请核对公布日期和币种单位；实际适用汇率及手续费须向交易机构确认。",
    },
  },
  fsc: {
    summary: {
      ko: "금융정책 보도자료와 제도 관련 공식 발표를 확인할 수 있습니다.",
      en: "Review official Financial Services Commission releases on financial policy and programs.",
      ja: "金融政策の報道資料と制度に関する公式発表を確認できます。",
      zh: "可查看金融政策新闻稿及制度相关官方发布。",
    },
    whenToUse: {
      ko: "정책 내용을 인용하거나 지원제도를 판단하기 전에 발표일, 시행상태, 원문을 확인하세요.",
      en: "Before relying on a policy or support program, confirm its release date, implementation status, and original text.",
      ja: "政策や支援制度を参照する前に、発表日、施行状況、原文を確認してください。",
      zh: "引用政策或判断支持项目之前，请核对发布日期、实施状态和原文。",
    },
  },
  fsec: {
    summary: {
      ko: "금융권 보안 동향과 안전수칙에 관한 전문기관 자료를 확인할 수 있습니다.",
      en: "Review specialist resources on financial-sector security trends and safety practices.",
      ja: "金融分野のセキュリティ動向と安全対策に関する専門機関の資料を確認できます。",
      zh: "可查看专业机构发布的金融行业安全趋势和安全实践资料。",
    },
    whenToUse: {
      ko: "보안 통제나 대응 절차를 설계할 때 참고하고, 개별 사고 판단은 해당 금융기관에 확인하세요.",
      en: "Use it when designing security controls or response steps; confirm case-specific decisions with the relevant institution.",
      ja: "セキュリティ統制や対応手順の設計時に参照し、個別事案の判断は関係機関に確認してください。",
      zh: "设计安全控制或响应流程时参考；个案判断请向相关金融机构确认。",
    },
  },
  nistAiRmf: {
    summary: {
      ko: "AI 위험을 식별·관리하기 위한 NIST 프레임워크와 관련 자료를 확인할 수 있습니다.",
      en: "Review the NIST framework and resources for identifying and managing AI risks.",
      ja: "AIリスクを特定・管理するためのNISTフレームワークと関連資料を確認できます。",
      zh: "可查看用于识别和管理AI风险的NIST框架及相关资料。",
    },
    whenToUse: {
      ko: "AI 서비스의 거버넌스·평가·통제를 설계할 때 조직 환경과 적용 규정을 함께 검토하세요.",
      en: "Use it when designing AI governance, evaluation, and controls, together with your operating context and applicable rules.",
      ja: "AIサービスのガバナンス、評価、統制を設計するときに、組織環境と適用規則も併せて検討してください。",
      zh: "设计AI治理、评估和控制时，请结合组织环境与适用规则一并审视。",
    },
  },
} satisfies Record<string, { summary: LocalizedText; whenToUse: LocalizedText }>;

const DEFINITIONS: readonly LocalizedMissionDefinition[] = [
  {
    id: "youth-asset-building",
    status: "direct-input",
    title: {
      ko: "청년 자산 형성",
      en: "Youth asset building",
      ja: "若者の資産形成",
      zh: "青年资产积累",
    },
    summary: {
      ko: "목표 금액과 현금흐름을 직접 입력해 저축 계획을 점검합니다. 연결되지 않은 잔액이나 소비는 추정하지 않습니다.",
      en: "Check a savings plan with amounts you enter yourself. Unconnected balances and spending are never estimated.",
      ja: "目標額とキャッシュフローを自分で入力して貯蓄計画を確認します。未連携の残高や支出は推定しません。",
      zh: "使用自行输入的目标金额和现金流检查储蓄计划，不估算未连接的余额或消费。",
    },
    evidence: {
      ko: "계산은 사용자가 입력한 금액만 사용하며, 금융상품 조건은 공식 공시에서 별도로 확인합니다.",
      en: "Calculations use only user-entered amounts; product terms must be checked in official disclosures.",
      ja: "計算にはユーザー入力額のみを使い、金融商品の条件は公式開示で別途確認します。",
      zh: "计算仅使用用户输入金额，金融产品条件需另行查看官方披露。",
    },
    target: "assets",
    actionLabel: {
      ko: "자산 계획 열기",
      en: "Open asset planner",
      ja: "資産プランを開く",
      zh: "打开资产计划",
    },
    readiness: [
      {
        id: "amounts-are-mine",
        label: {
          ko: "표시된 금액이 내가 직접 입력한 값인지 확인했습니다.",
          en: "I confirmed that every displayed amount comes from my own input.",
          ja: "表示額が自分で入力した値であることを確認しました。",
          zh: "我已确认显示金额均来自本人输入。",
        },
      },
      {
        id: "terms-checked",
        label: {
          ko: "기간과 금리는 공식 공시 기준일을 다시 확인하겠습니다.",
          en: "I will recheck terms and rates against the dated official disclosure.",
          ja: "期間と金利を公式開示の基準日で再確認します。",
          zh: "我会按官方披露日期重新核对期限与利率。",
        },
      },
      {
        id: "reference-only",
        label: {
          ko: "계산 결과가 계약이나 가입 권유가 아닌 참고값임을 이해했습니다.",
          en: "I understand that the calculation is a reference, not an offer or contract.",
          ja: "計算結果は契約や加入勧誘ではなく参考値だと理解しました。",
          zh: "我理解计算结果仅供参考，并非办理建议或合同。",
        },
      },
    ],
    officialLinks: [
      {
        label: {
          ko: "금융상품 한눈에",
          en: "Financial Products at a Glance",
          ja: "金融商品比較",
          zh: "金融产品一览",
        },
        summary: OFFICIAL_LINK_GUIDANCE.finlife.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.finlife.whenToUse,
        url: officialHttpsUrl("https://finlife.fss.or.kr/"),
      },
    ],
  },
  {
    id: "accessible-finance",
    status: "prototype",
    title: {
      ko: "고령층·장애인 금융 접근성",
      en: "Accessible finance for older and disabled users",
      ja: "高齢者・障害者の金融アクセシビリティ",
      zh: "老年人与残障人士金融无障碍",
    },
    summary: {
      ko: "쉬움 모드, 키보드 탐색, 큰 터치 영역과 네 가지 언어를 제공하는 접근성 프로토타입입니다.",
      en: "An accessibility prototype with Easy Mode, keyboard navigation, larger targets, and four languages.",
      ja: "かんたんモード、キーボード操作、大きな操作領域、4言語に対応したアクセシビリティ試作です。",
      zh: "提供简易模式、键盘导航、大点击区域和四种语言的无障碍原型。",
    },
    evidence: {
      ko: "접근성 기능은 구현 중인 서비스 설계이며, 공인 인증이나 모든 보조기기 호환을 의미하지 않습니다.",
      en: "These features are an evolving service design, not an accessibility certification or a claim of universal assistive-technology support.",
      ja: "実装中のサービス設計であり、公的認証や全支援技術への対応を意味しません。",
      zh: "这些功能仍属服务设计原型，不代表获得无障碍认证或兼容所有辅助技术。",
    },
    target: "opportunity",
    actionLabel: {
      ko: "쉬운 정보 보기",
      en: "Open accessible information",
      ja: "やさしい情報を見る",
      zh: "查看无障碍信息",
    },
    readiness: [
      {
        id: "language-selected",
        label: {
          ko: "이해하기 편한 언어를 선택했습니다.",
          en: "I selected the language that is easiest for me.",
          ja: "理解しやすい言語を選びました。",
          zh: "我已选择最易理解的语言。",
        },
      },
      {
        id: "easy-mode-reviewed",
        label: {
          ko: "필요하면 쉬움 모드를 켜고 설명 차이를 확인했습니다.",
          en: "I tried Easy Mode when needed and reviewed the clearer explanations.",
          ja: "必要に応じてかんたんモードを試し、説明を確認しました。",
          zh: "我已在需要时尝试简易模式并查看简化说明。",
        },
      },
      {
        id: "input-method-reviewed",
        label: {
          ko: "키보드나 보조기기로 주요 버튼에 접근할 수 있는지 확인했습니다.",
          en: "I checked whether I can reach key controls with my keyboard or assistive device.",
          ja: "キーボードや支援機器で主要操作に到達できるか確認しました。",
          zh: "我已确认可通过键盘或辅助设备访问主要控件。",
        },
      },
    ],
    officialLinks: [
      {
        label: {
          ko: "서민금융진흥원",
          en: "Korea Inclusive Finance Agency",
          ja: "庶民金融振興院",
          zh: "韩国普惠金融振兴院",
        },
        summary: OFFICIAL_LINK_GUIDANCE.kinfa.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.kinfa.whenToUse,
        url: officialHttpsUrl("https://www.kinfa.or.kr/"),
      },
    ],
  },
  {
    id: "phishing-protection",
    status: "direct-input",
    title: {
      ko: "금융 피싱 공격 방지",
      en: "Financial phishing protection",
      ja: "金融フィッシング対策",
      zh: "金融钓鱼防护",
    },
    summary: {
      ko: "사용자가 붙여 넣은 문자나 URL의 위험 신호를 점검합니다. 백그라운드 감시나 피해 여부 확정 기능은 아닙니다.",
      en: "Check risk signals in a message or URL you paste. This is not background monitoring or a definitive fraud determination.",
      ja: "貼り付けたメッセージやURLの危険信号を確認します。常時監視や被害確定機能ではありません。",
      zh: "检查用户粘贴的短信或网址中的风险信号，不提供后台监控，也不能确定是否受骗。",
    },
    evidence: {
      ko: "분석은 입력된 내용과 공개된 대응 원칙을 사용하며, 송금 전에는 직접 찾은 공식 채널로 재확인해야 합니다.",
      en: "The check uses only submitted content and public safety guidance; independently verify through an official channel before transferring money.",
      ja: "入力内容と公開された対応原則のみを使い、送金前に自分で調べた公式窓口へ再確認します。",
      zh: "检查仅使用提交内容与公开安全指引，转账前应通过自行查找的官方渠道再次核实。",
    },
    target: "safety",
    actionLabel: {
      ko: "의심 메시지 점검",
      en: "Check a suspicious message",
      ja: "不審メッセージを確認",
      zh: "检查可疑信息",
    },
    readiness: [
      {
        id: "transfer-paused",
        label: {
          ko: "확인 전에는 링크를 열거나 송금하지 않겠습니다.",
          en: "I will not open links or transfer money before verification.",
          ja: "確認前にリンクを開いたり送金したりしません。",
          zh: "核实前我不会打开链接或转账。",
        },
      },
      {
        id: "official-channel",
        label: {
          ko: "메시지 속 번호가 아닌 공식 사이트의 연락처를 사용하겠습니다.",
          en: "I will use contact details from the official site, not from the message.",
          ja: "メッセージ内ではなく公式サイトの連絡先を使います。",
          zh: "我会使用官方网站上的联系方式，而不是信息中的号码。",
        },
      },
      {
        id: "damage-response",
        label: {
          ko: "이미 송금했다면 금융회사와 112에 즉시 연락하겠습니다.",
          en: "If I already transferred money, I will immediately contact my financial institution and 112.",
          ja: "送金済みなら金融機関と112へ直ちに連絡します。",
          zh: "若已转账，我会立即联系金融机构并拨打112。",
        },
      },
    ],
    officialLinks: [
      {
        label: {
          ko: "금융소비자 정보포털 파인",
          en: "FINE financial consumer portal",
          ja: "金融消費者ポータルFINE",
          zh: "FINE金融消费者门户",
        },
        summary: OFFICIAL_LINK_GUIDANCE.fine.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.fine.whenToUse,
        url: officialHttpsUrl("https://fine.fss.or.kr/"),
      },
      {
        label: {
          ko: "경찰청",
          en: "Korean National Police Agency",
          ja: "韓国警察庁",
          zh: "韩国警察厅",
        },
        summary: OFFICIAL_LINK_GUIDANCE.police.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.police.whenToUse,
        url: officialHttpsUrl("https://www.police.go.kr/"),
      },
    ],
  },
  {
    id: "startup-small-business",
    status: "official-data",
    title: {
      ko: "청년 창업·소상공인 금융",
      en: "Youth startup and small-business finance",
      ja: "若者の起業・小規模事業者金融",
      zh: "青年创业与小微经营金融",
    },
    summary: {
      ko: "공식 창업 공고와 상권 데이터를 지역·마감일·업종 기준으로 살펴봅니다. 지원 선정이나 대출 승인을 예측하지 않습니다.",
      en: "Review official startup notices and district data by region, deadline, and industry. Selection or loan approval is never predicted.",
      ja: "公式の創業公募と商圏データを地域・締切・業種別に確認します。採択や融資承認は予測しません。",
      zh: "按地区、截止日期和行业查看官方创业公告与商圈数据，不预测项目入选或贷款审批。",
    },
    evidence: {
      ko: "표시 건수와 상권 그래프는 연결된 공식 공공데이터만 사용하며, 최종 자격은 공고 원문에서 확인합니다.",
      en: "Counts and district charts use connected official public data only; final eligibility must be checked in the original notice.",
      ja: "件数と商圏グラフは連携済み公式データのみを使い、最終資格は公募原文で確認します。",
      zh: "数量与商圈图表仅使用已连接的官方公共数据，最终资格须查看公告原文。",
    },
    target: "/information/startup",
    actionLabel: {
      ko: "창업·상권 정보 열기",
      en: "Open startup and district data",
      ja: "創業・商圏情報を開く",
      zh: "打开创业与商圈信息",
    },
    readiness: [
      {
        id: "region-and-target",
        label: {
          ko: "지원 지역과 대상 조건이 내 상황에 맞는지 확인했습니다.",
          en: "I checked whether the official region and target conditions fit my situation.",
          ja: "支援地域と対象条件が自分に合うか確認しました。",
          zh: "我已核对官方地区与适用对象条件。",
        },
      },
      {
        id: "deadline",
        label: {
          ko: "공식 원문에서 실제 접수 마감시각을 확인했습니다.",
          en: "I checked the exact closing time in the official notice.",
          ja: "公式原文で実際の受付締切時刻を確認しました。",
          zh: "我已在官方公告中核对准确截止时间。",
        },
      },
      {
        id: "no-approval-inference",
        label: {
          ko: "데이터 일치가 선정이나 대출 승인을 뜻하지 않음을 이해했습니다.",
          en: "I understand that a data match does not mean selection or loan approval.",
          ja: "条件一致が採択や融資承認を意味しないと理解しました。",
          zh: "我理解条件匹配不代表项目入选或贷款获批。",
        },
      },
    ],
    officialLinks: [
      {
        label: {
          ko: "K-Startup",
          en: "K-Startup",
          ja: "K-Startup",
          zh: "K-Startup",
        },
        summary: OFFICIAL_LINK_GUIDANCE.kStartup.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.kStartup.whenToUse,
        url: officialHttpsUrl("https://www.k-startup.go.kr/"),
      },
      {
        label: {
          ko: "기업마당",
          en: "Bizinfo",
          ja: "企業広場",
          zh: "企业信息平台",
        },
        summary: OFFICIAL_LINK_GUIDANCE.bizinfo.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.bizinfo.whenToUse,
        url: officialHttpsUrl("https://www.bizinfo.go.kr/"),
      },
    ],
  },
  {
    id: "venture-growth-evidence",
    status: "prototype",
    title: {
      ko: "벤처 성장 근거 점검",
      en: "Venture growth evidence review",
      ja: "ベンチャー成長根拠の確認",
      zh: "创投企业成长依据核查",
    },
    summary: {
      ko: "DART 공시와 시장경보를 확인하는 프로토타입입니다. 성장성 점수, 미래 실적 또는 투자 등급은 만들지 않습니다.",
      en: "A prototype for reviewing DART filings and market alerts. It does not create growth scores, forecasts, or investment grades.",
      ja: "DART開示と市場警報を確認する試作です。成長スコア、業績予測、投資格付けは作りません。",
      zh: "用于查看DART披露与市场警示的原型，不生成成长评分、业绩预测或投资等级。",
    },
    evidence: {
      ko: "현재는 최근 공시 원문 확인 단계이며, 재무 수치가 없으면 그래프나 평가 결과를 표시하지 않습니다.",
      en: "The current scope is original-filing review; no graph or assessment is shown without disclosed financial figures.",
      ja: "現在は開示原文の確認段階で、財務数値がなければグラフや評価を表示しません。",
      zh: "当前仅用于查看披露原文；没有正式财务数据时不显示图表或评估。",
    },
    target: "/information/finance",
    actionLabel: {
      ko: "공시 정보 열기",
      en: "Open disclosure information",
      ja: "開示情報を開く",
      zh: "打开披露信息",
    },
    readiness: [
      {
        id: "company-identity",
        label: {
          ko: "법인명과 기업 식별정보가 정확한지 확인했습니다.",
          en: "I confirmed the legal company name and identifier.",
          ja: "法人名と企業識別情報が正しいか確認しました。",
          zh: "我已核对法定企业名称与企业标识。",
        },
      },
      {
        id: "current-filing",
        label: {
          ko: "최신 공시와 정정공시 여부를 함께 확인했습니다.",
          en: "I reviewed the latest filing and any correction filing.",
          ja: "最新開示と訂正開示の有無を確認しました。",
          zh: "我已同时查看最新披露及更正披露。",
        },
      },
      {
        id: "no-single-metric-decision",
        label: {
          ko: "하나의 공시나 수치만으로 투자 결정을 내리지 않겠습니다.",
          en: "I will not make an investment decision from one filing or metric.",
          ja: "一つの開示や指標だけで投資判断をしません。",
          zh: "我不会仅凭一项披露或指标作出投资决定。",
        },
      },
    ],
    officialLinks: [
      {
        label: {
          ko: "금융감독원 DART",
          en: "FSS DART",
          ja: "金融監督院DART",
          zh: "金融监督院DART",
        },
        summary: OFFICIAL_LINK_GUIDANCE.dart.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.dart.whenToUse,
        url: officialHttpsUrl("https://dart.fss.or.kr/"),
      },
      {
        label: {
          ko: "한국거래소 KIND",
          en: "KRX KIND",
          ja: "韓国取引所KIND",
          zh: "韩国交易所KIND",
        },
        summary: OFFICIAL_LINK_GUIDANCE.kind.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.kind.whenToUse,
        url: officialHttpsUrl("https://kind.krx.co.kr/"),
      },
    ],
  },
  {
    id: "foreign-resident-settlement",
    status: "official-data",
    title: {
      ko: "외국인 금융 정착",
      en: "Financial settlement for foreign residents",
      ja: "外国人住民の金融定着",
      zh: "外国居民金融安家",
    },
    summary: {
      ko: "공식 환율, 외국인 고용통계와 출입국 안내를 네 가지 언어로 연결합니다. 은행별 계좌개설 요건은 별도 확인이 필요합니다.",
      en: "Connect official exchange rates, foreign-resident employment statistics, and immigration guidance in four languages. Bank-specific account requirements need separate confirmation.",
      ja: "公式為替、外国人雇用統計、出入国案内を4言語でつなぎます。銀行別の口座開設要件は別途確認が必要です。",
      zh: "以四种语言连接官方汇率、外国居民就业统计与出入境指南；各银行开户要求需另行确认。",
    },
    evidence: {
      ko: "환율은 수집된 일별 기준값이며 실시간 송금 환율이 아니고, 체류자격별 절차는 1345와 금융회사 공식 창구에서 확인합니다.",
      en: "Rates are collected daily reference values, not live remittance quotes; confirm status-specific procedures with 1345 and the institution's official channel.",
      ja: "為替は収集済み日次基準値でリアルタイム送金レートではありません。資格別手続は1345と金融機関公式窓口で確認します。",
      zh: "汇率为采集的每日参考值，并非实时汇款报价；请通过1345及金融机构官方渠道核对相应手续。",
    },
    target: "/information/settlement",
    actionLabel: {
      ko: "환율·정착 정보 열기",
      en: "Open exchange and settlement data",
      ja: "為替・定着情報を開く",
      zh: "打开汇率与安家信息",
    },
    readiness: [
      {
        id: "residency-documents",
        label: {
          ko: "내 체류자격과 필요한 신분서류를 공식 안내에서 확인했습니다.",
          en: "I checked my status and required identity documents in official guidance.",
          ja: "自分の在留資格と必要書類を公式案内で確認しました。",
          zh: "我已通过官方指南核对居留资格与所需身份证明。",
        },
      },
      {
        id: "exchange-basis",
        label: {
          ko: "표시 환율의 기준일과 실제 송금 수수료가 다를 수 있음을 확인했습니다.",
          en: "I checked the rate date and understand that actual remittance fees may differ.",
          ja: "表示レートの基準日と実際の送金手数料が異なる場合があると確認しました。",
          zh: "我已核对汇率日期，并了解实际汇款手续费可能不同。",
        },
      },
      {
        id: "official-support",
        label: {
          ko: "은행 공식 다국어 창구 또는 1345에서 최종 절차를 확인하겠습니다.",
          en: "I will confirm final steps with an official multilingual bank channel or 1345.",
          ja: "銀行の公式多言語窓口または1345で最終手順を確認します。",
          zh: "我会通过银行官方多语种渠道或1345确认最终流程。",
        },
      },
    ],
    officialLinks: [
      {
        label: {
          ko: "출입국·외국인정책본부",
          en: "Korea Immigration Service",
          ja: "出入国・外国人政策本部",
          zh: "韩国出入境·外国人政策本部",
        },
        summary: OFFICIAL_LINK_GUIDANCE.immigration.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.immigration.whenToUse,
        url: officialHttpsUrl("https://www.immigration.go.kr/"),
      },
      {
        label: {
          ko: "한국수출입은행 환율",
          en: "Korea Eximbank exchange rates",
          ja: "韓国輸出入銀行為替",
          zh: "韩国进出口银行汇率",
        },
        summary: OFFICIAL_LINK_GUIDANCE.koreaExim.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.koreaExim.whenToUse,
        url: officialHttpsUrl("https://www.koreaexim.go.kr/ir/HPHKIR020M01?apino=2&viewtype=C"),
      },
    ],
  },
  {
    id: "consent-based-inclusive-finance",
    status: "direct-input",
    title: {
      ko: "직접 입력 기반 포용금융",
      en: "Manual-first inclusive finance",
      ja: "直接入力型の包摂金融",
      zh: "基于手动输入的普惠金融",
    },
    summary: {
      ko: "사용자가 직접 입력하고 저장한 금액을 바탕으로 자산·현금흐름을 점검합니다. 계좌나 카드 번호는 요청하지 않습니다.",
      en: "Review assets and cash flow using amounts the user enters and saves. Bank account and card numbers are never requested.",
      ja: "利用者が入力して保存した金額をもとに資産とキャッシュフローを確認します。口座番号やカード番号は求めません。",
      zh: "根据用户手动输入并保存的金额检查资产和现金流，不会要求输入银行账号或银行卡号。",
    },
    evidence: {
      ko: "제휴 전에는 개인 금융정보를 호출하지 않으며, 직접 입력한 금액으로만 포용금융 자가 점검을 제공합니다.",
      en: "No personal financial data is requested before partnership; the inclusive checkup uses only amounts entered directly by the user.",
      ja: "提携前は個人金融情報を取得せず、直接入力額のみで包摂金融の自己点検を提供します。",
      zh: "达成合作前不会请求个人金融信息，普惠金融自查仅使用用户直接输入的金额。",
    },
    target: "/information/finance",
    actionLabel: {
      ko: "포용금융 자가 점검",
      en: "Open inclusive-finance checkup",
      ja: "包摂金融の自己点検",
      zh: "打开普惠金融自查",
    },
    readiness: [
      {
        id: "connection-status",
        label: {
          ko: "화면의 금액은 내가 직접 입력하고 저장한 값임을 확인했습니다.",
          en: "I confirmed that displayed amounts come from values I entered and saved.",
          ja: "表示金額が自分で入力して保存した値であることを確認しました。",
          zh: "我已确认页面金额来自本人手动输入并保存的数值。",
        },
      },
      {
        id: "minimum-input",
        label: {
          ko: "자가 점검에는 필요한 범위의 금액만 직접 입력하겠습니다.",
          en: "I will enter only the minimum amounts needed for the self-check.",
          ja: "自己点検には必要最小限の金額だけを入力します。",
          zh: "我只会输入自查所需的最少金额。",
        },
      },
      {
        id: "professional-support",
        label: {
          ko: "채무나 긴급지원이 필요하면 공식 상담기관에 직접 확인하겠습니다.",
          en: "If I need debt or emergency support, I will contact an official counseling organization.",
          ja: "債務や緊急支援が必要なら公式相談機関へ確認します。",
          zh: "若需要债务或紧急援助，我会联系官方咨询机构。",
        },
      },
    ],
    officialLinks: [
      {
        label: {
          ko: "금융위원회",
          en: "Financial Services Commission",
          ja: "金融委員会",
          zh: "韩国金融委员会",
        },
        summary: OFFICIAL_LINK_GUIDANCE.fsc.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.fsc.whenToUse,
        url: officialHttpsUrl("https://www.fsc.go.kr/"),
      },
      {
        label: {
          ko: "서민금융진흥원",
          en: "Korea Inclusive Finance Agency",
          ja: "庶民金融振興院",
          zh: "韩国普惠金融振兴院",
        },
        summary: OFFICIAL_LINK_GUIDANCE.kinfa.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.kinfa.whenToUse,
        url: officialHttpsUrl("https://www.kinfa.or.kr/"),
      },
    ],
  },
] as const;

export const FINANCIAL_MISSION_STATUS_COPY: Record<
  FinancialMissionLocale,
  Record<FinancialMissionStatus, { label: string; description: string }>
> = {
  ko: {
    "official-data": { label: "공식 데이터", description: "연결된 공공기관 자료를 사용합니다." },
    "direct-input": { label: "직접 입력", description: "사용자가 입력한 내용만 사용합니다." },
    prototype: { label: "프로토타입", description: "기능을 검증 중이며 평가·인증 결과가 아닙니다." },
    "partnership-required": { label: "제휴 필요", description: "실제 연결에는 인가 사업자 제휴와 동의가 필요합니다." },
  },
  en: {
    "official-data": { label: "Official data", description: "Uses connected public-institution data." },
    "direct-input": { label: "Direct input", description: "Uses only information entered by the user." },
    prototype: { label: "Prototype", description: "Under validation; not an assessment or certification." },
    "partnership-required": { label: "Partnership required", description: "Live access requires a licensed partner and consent." },
  },
  ja: {
    "official-data": { label: "公式データ", description: "連携済み公的機関データを使用します。" },
    "direct-input": { label: "直接入力", description: "ユーザーが入力した内容のみを使います。" },
    prototype: { label: "プロトタイプ", description: "検証中であり評価・認証結果ではありません。" },
    "partnership-required": { label: "提携が必要", description: "実連携には認可事業者との提携と同意が必要です。" },
  },
  zh: {
    "official-data": { label: "官方数据", description: "使用已连接的公共机构数据。" },
    "direct-input": { label: "直接输入", description: "仅使用用户自行输入的信息。" },
    prototype: { label: "原型", description: "功能仍在验证，并非评估或认证结果。" },
    "partnership-required": { label: "需要合作", description: "真实连接需要持牌合作方与用户同意。" },
  },
};

const SPECIALIZED_MISSION_OVERRIDES: Record<string, {
  id: string;
  status: FinancialMissionStatus;
  title: LocalizedText;
  summary: LocalizedText;
  evidence: LocalizedText;
  target: string;
  actionLabel: LocalizedText;
  readiness: Array<{ id: string; label: LocalizedText }>;
  officialLinks: LocalizedOfficialLink[];
}> = {
  "youth-asset-building": {
    id: "inclusive-asset-accessibility",
    status: "direct-input",
    title: {
      ko: "청년 자산형성과 모두를 위한 포용금융",
      en: "Inclusive asset building for everyone",
      ja: "若者の資産形成と誰もが使える金融",
      zh: "青年资产积累与无障碍金融",
    },
    summary: {
      ko: "사용자가 직접 입력한 금액만 계산하며, 쉬움 모드·큰 조작 영역·다국어 안내를 함께 제공합니다.",
      en: "Calculations use only user-entered amounts with Easy Mode, larger controls, and multilingual guidance.",
      ja: "利用者が入力した金額だけを計算し、やさしいモード、大きな操作領域、多言語案内を提供します。",
      zh: "仅计算用户手动输入的金额，并提供简易模式、大型控件和多语言指引。",
    },
    evidence: {
      ko: "초기값과 미연결 데이터는 모두 0이며, 그래프는 실제 입력이 있을 때만 표시합니다. 장애·질환 여부는 수집하지 않습니다.",
      en: "Unconnected values start at zero and charts appear only after real input. Disability or medical status is not collected.",
      ja: "未連携の値は0から始まり、実際の入力がある場合だけグラフを表示します。障害や病歴は収集しません。",
      zh: "未连接数据从0开始，只有真实输入后才显示图表；不收集残障或健康状况。",
    },
    target: "assets",
    actionLabel: { ko: "자산 워크북 열기", en: "Open asset workbook", ja: "資産ワークブックを開く", zh: "打开资产工作表" },
    readiness: [
      { id: "own-input", label: { ko: "표시 금액이 내가 직접 입력한 값인지 확인했습니다.", en: "I confirmed that displayed amounts come from my input.", ja: "表示額が自分の入力値であることを確認しました。", zh: "我确认显示金额来自本人输入。" } },
      { id: "access-mode", label: { ko: "필요하면 쉬움 모드와 선호 언어를 선택했습니다.", en: "I selected Easy Mode and my preferred language if needed.", ja: "必要に応じてやさしいモードと言語を選びました。", zh: "需要时我已选择简易模式和偏好语言。" } },
      { id: "official-terms", label: { ko: "상품 조건은 날짜가 표시된 공식 원문에서 다시 확인합니다.", en: "I will recheck product terms in the dated official source.", ja: "商品条件は日付付きの公式原文で再確認します。", zh: "我会在标有日期的官方原文中复核产品条款。" } },
    ],
    officialLinks: [
      {
        label: { ko: "금융상품 한눈에", en: "Financial Products at a Glance", ja: "金融商品を一目で", zh: "金融产品一览" },
        summary: OFFICIAL_LINK_GUIDANCE.finlife.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.finlife.whenToUse,
        url: officialHttpsUrl("https://finlife.fss.or.kr/"),
      },
      {
        label: { ko: "서민금융진흥원", en: "Korea Inclusive Finance Agency", ja: "庶民金融振興院", zh: "韩国普惠金融振兴院" },
        summary: OFFICIAL_LINK_GUIDANCE.kinfa.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.kinfa.whenToUse,
        url: officialHttpsUrl("https://www.kinfa.or.kr/"),
      },
    ],
  },
  "accessible-finance": {
    id: "transaction-insurance-triage",
    status: "prototype",
    title: {
      ko: "이상거래·보험청구 검토 우선순위",
      en: "Transaction and insurance review priority",
      ja: "異常取引・保険請求の確認優先度",
      zh: "异常交易与保险理赔审核优先级",
    },
    summary: {
      ko: "거래나 보험청구의 징후를 사용자가 체크하면 추가 확인이 필요한 순서를 설명합니다. 사기 판정이나 자동 차단 기능이 아닙니다.",
      en: "User-selected signals explain what needs review first. This is not fraud detection, claim denial, or transaction blocking.",
      ja: "選択した兆候から追加確認の順番を説明します。不正判定、支払拒否、取引停止ではありません。",
      zh: "根据用户勾选的信号说明复核顺序；这不是欺诈认定、拒赔或交易拦截。",
    },
    evidence: {
      ko: "실제 FDS·보험사기 모델에는 금융기관의 거래·청구 이력과 정답 데이터, 법적 통제와 제휴가 필요합니다.",
      en: "A real FDS or insurance-fraud model requires institutional transaction or claim history, labeled outcomes, governance, and partnership.",
      ja: "実際のFDSや保険不正モデルには、機関の取引・請求履歴、正解データ、統制、提携が必要です。",
      zh: "真实FDS或保险欺诈模型需要机构交易/理赔历史、标签结果、治理和合作。",
    },
    target: "safety",
    actionLabel: { ko: "자가 점검 열기", en: "Open review self-check", ja: "確認セルフチェックを開く", zh: "打开审核自查" },
    readiness: [
      { id: "no-identifiers", label: { ko: "계좌·주민번호·청구번호를 입력하지 않습니다.", en: "I will not enter account, identity, or claim numbers.", ja: "口座・本人確認・請求番号を入力しません。", zh: "我不会输入账户、身份证明或理赔编号。" } },
      { id: "review-only", label: { ko: "결과가 사기 확정이 아닌 검토 순서임을 이해했습니다.", en: "I understand the result is review priority, not a fraud finding.", ja: "結果は不正判定ではなく確認優先度だと理解しました。", zh: "我理解结果只是审核优先级，不是欺诈认定。" } },
      { id: "institution-needed", label: { ko: "실제 차단·심사는 금융기관 확인이 필요합니다.", en: "I understand actual blocking or adjudication requires an institution.", ja: "実際の停止・審査には金融機関が必要です。", zh: "我理解实际拦截或裁定需要金融机构。" } },
    ],
    officialLinks: [
      {
        label: { ko: "금융보안원", en: "Financial Security Institute", ja: "金融保安院", zh: "韩国金融安全院" },
        summary: OFFICIAL_LINK_GUIDANCE.fsec.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.fsec.whenToUse,
        url: officialHttpsUrl("https://www.fsec.or.kr/"),
      },
    ],
  },
  "consent-based-inclusive-finance": {
    id: "frontier-ai-security",
    status: "prototype",
    title: {
      ko: "대화형 AI 공격 방어 비서",
      en: "Conversational AI attack-defense assistant",
      ja: "対話型AI攻撃防御アシスタント",
      zh: "对话式AI攻击防御助手",
    },
    summary: {
      ko: "프롬프트 인젝션, 비밀정보 요구, 권한을 넘는 도구 실행 신호를 체크해 안전한 다음 행동을 안내합니다.",
      en: "Check prompt injection, secret requests, and over-privileged tool actions, then receive a safer next-step checklist.",
      ja: "プロンプトインジェクション、秘密情報要求、過剰権限のツール実行を確認し、安全な次の手順を示します。",
      zh: "检查提示注入、秘密请求和越权工具操作，并给出更安全的下一步清单。",
    },
    evidence: {
      ko: "현재는 입력 없는 규칙 기반 자가점검입니다. 운영 환경에서는 도구 허용목록, 사람 승인, 감사로그, 공격 평가가 추가로 필요합니다.",
      en: "This is a no-text rule-based self-check. Production also needs tool allowlists, human approval, audit logs, and adversarial evaluation.",
      ja: "現在はテキストを収集しないルール型セルフチェックです。運用には許可リスト、人の承認、監査ログ、攻撃評価が必要です。",
      zh: "目前是不收集文本的规则自查；生产环境还需工具白名单、人工批准、审计日志和对抗评估。",
    },
    target: "safety",
    actionLabel: { ko: "AI 보안 점검 열기", en: "Open AI security review", ja: "AIセキュリティ確認を開く", zh: "打开AI安全检查" },
    readiness: [
      { id: "no-secrets", label: { ko: "API 키·비밀번호·내부 프롬프트를 대화에 넣지 않습니다.", en: "I will not paste API keys, passwords, or internal prompts.", ja: "APIキー、パスワード、内部プロンプトを貼りません。", zh: "我不会粘贴API密钥、密码或内部提示。" } },
      { id: "human-approval", label: { ko: "송금·삭제·외부 전송은 사람이 최종 승인합니다.", en: "A person must approve transfers, deletion, and external sending.", ja: "送金・削除・外部送信は人が最終承認します。", zh: "转账、删除和外发必须由人工最终批准。" } },
      { id: "untrusted-context", label: { ko: "검색·RAG 문서는 신뢰되지 않은 입력으로 다룹니다.", en: "I treat search and RAG documents as untrusted input.", ja: "検索・RAG文書を信頼されていない入力として扱います。", zh: "我将搜索和RAG文档视为不可信输入。" } },
    ],
    officialLinks: [
      {
        label: { ko: "NIST AI 위험관리 프레임워크", en: "NIST AI Risk Management Framework", ja: "NIST AIリスク管理フレームワーク", zh: "NIST AI风险管理框架" },
        summary: OFFICIAL_LINK_GUIDANCE.nistAiRmf.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.nistAiRmf.whenToUse,
        url: officialHttpsUrl("https://www.nist.gov/itl/ai-risk-management-framework"),
      },
      {
        label: { ko: "금융보안원", en: "Financial Security Institute", ja: "金融保安院", zh: "韩国金融安全院" },
        summary: OFFICIAL_LINK_GUIDANCE.fsec.summary,
        whenToUse: OFFICIAL_LINK_GUIDANCE.fsec.whenToUse,
        url: officialHttpsUrl("https://www.fsec.or.kr/"),
      },
    ],
  },
};

export function financialMissions(locale: FinancialMissionLocale): FinancialMission[] {
  const selectedLocale = FINANCIAL_MISSION_LOCALES.includes(locale) ? locale : "ko";
  return DEFINITIONS.map((mission) => {
    const specialized = SPECIALIZED_MISSION_OVERRIDES[mission.id];
    const source = specialized ?? mission;
    return {
      id: source.id,
      status: source.status,
      title: source.title[selectedLocale],
      summary: source.summary[selectedLocale],
      evidence: source.evidence[selectedLocale],
      target: source.target,
      actionLabel: source.actionLabel[selectedLocale],
      readiness: source.readiness.map((item) => ({
        id: item.id,
        label: item.label[selectedLocale],
      })),
      officialLinks: source.officialLinks.map((link) => ({
        label: link.label[selectedLocale],
        summary: link.summary[selectedLocale],
        whenToUse: link.whenToUse[selectedLocale],
        url: link.url,
      })),
    };
  });
}

export function financialMissionSelfCheckProgress(
  checkedIds: Iterable<string>,
  readinessIds: readonly string[],
) {
  const available = new Set(readinessIds);
  const completed = new Set(
    [...checkedIds].filter((id) => available.has(id)),
  ).size;
  const total = available.size;
  return {
    completed,
    total,
    fraction: total > 0 ? completed / total : 0,
  };
}
