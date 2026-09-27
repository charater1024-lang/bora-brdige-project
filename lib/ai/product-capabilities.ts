import type { SupportedLocale } from "../rag/knowledge";

const MAX_CAPABILITY_QUERY_CHARS = 600;

const GREETING_ONLY = /^(?:안녕(?:하세요|하십니까)?|반가워(?:요)?|hello|hi|hey|good\s+(?:morning|afternoon|evening)|こんにちは|こんばんは|おはよう(?:ございます)?|你好|您好|嗨)[\s.!?。！？~～]*(?:bora|보라|ボラ)?[\s.!?。！？~～]*$/iu;

const CAPABILITY_REQUEST = /(?:(?:기능|메뉴|할\s*수\s*있는\s*일|이용\s*방법).{0,48}(?:뭐|무엇|어떤|있|알려|소개|이용|사용|가능)|(?:뭐|무엇|어떤\s*것|어떻게).{0,36}(?:할\s*수\s*있|도와|이용|사용)|(?:이용|사용)할\s*수\s*있는\s*서비스.{0,24}(?:뭐|무엇|어떤|있|알려|소개)|what\s+(?:can|do).{0,20}(?:you|bora)|what\s+(?:features?|services?).{0,30}(?:available|offer|have)|what\s+services?\s+can\s+i\s+use|how\s+(?:can|do)\s+i\s+use\s+(?:this|bora)|show\s+me\s+(?:the\s+)?(?:features?|services?)|(?:どんな|何の|利用できる|使える).{0,24}(?:機能|サービス|メニュー)|(?:機能|サービス|メニュー).{0,24}(?:教えて|紹介|あります|使え|利用)|何ができますか|(?:有哪些|有什么|可以使用|能用).{0,24}(?:功能|服务|菜单)|(?:功能|服务|菜单).{0,24}(?:介绍|告诉|有哪些|有什么|使用)|你能做什么)/iu;

const PRODUCT_REFERENCE = /(?:\bbora(?:\s*bridge)?\b|보라(?:\s*브릿지)?|이\s*(?:앱|사이트|서비스)|여기(?:서|에서는)?|너(?:는|가)?|당신(?:은|이)?|\byou\b|this\s+(?:app|site|service)|ボラ(?:ブリッジ)?|この(?:アプリ|サイト|サービス)|あなた|这个(?:应用|网站|服务)|你)/iu;

const PRODUCT_USAGE_REQUEST = /(?:(?:기능|메뉴|사용법|이용\s*방법).{0,40}(?:어떻게|알려|소개|뭐|무엇|어떤|있|써|사용|이용)|(?:어떻게|어디서).{0,32}(?:써|사용|이용|찾)|how.{0,28}(?:use|work|find)|(?:features?|menu).{0,28}(?:use|work|available|show)|(?:機能|メニュー|使い方).{0,28}(?:教えて|使|利用|あります)|(?:どう|どこ).{0,24}(?:使|利用)|(?:功能|菜单|使用方法).{0,28}(?:介绍|告诉|使用|怎么|有哪些)|(?:怎么|哪里).{0,24}(?:用|使用|找))/iu;

// A request for actual financial, legal, policy, or incident facts must keep
// going through the evidence path even when it begins with a greeting.
const FACTUAL_DOMAIN_REQUEST = /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|청년|외국인|정착|고용\s*24|워크넷|취업|채용|창업|상권|금융\s*지원|학자금|공고|신청\s*가능|금리|이자율|환율|환전|대출|예금|적금|투자|주식|펀드|보험|연금|세금|법률|법령|조문|피싱|스미싱|사기|지원금|장학금|정책\s*(?:추천|조건|자격|공고)|신청\s*(?:조건|자격|기간|마감)|\b(?:seoul|busan|daegu|incheon|gwangju|daejeon|ulsan|sejong|gyeonggi|gangwon|chungcheong|jeolla|gyeongsang|jeju|youth|foreigner|foreigners|immigrant|immigrants|policy|support|application)\b|interest\s+rate|exchange\s+rate|loan|deposit|savings|invest|stock|insurance|pension|tax|law|legal|phishing|scam|grant|scholarship|eligibility|deadline|employment|job|startup|settlement|金利|為替|貸付|預金|投資|保険|年金|税|法律|詐欺|支援金|奨学金|就職|創業|定着|若者|青年|外国人|ソウル|利率|汇率|贷款|存款|投资|保险|养老金|税|法律|诈骗|补助|奖学金|就业|创业|定居|青年|外国人|首尔)/iu;

/**
 * Detect only greetings and requests about BORA Bridge itself. This deliberately
 * excludes requests for real financial, legal, policy, or incident facts so the
 * existing evidence and safety paths retain precedence.
 */
export function productCapabilitiesRequested(query: string) {
  const normalized = query.normalize("NFKC").trim();
  if (!normalized || normalized.length > MAX_CAPABILITY_QUERY_CHARS) return false;
  if (GREETING_ONLY.test(normalized)) return true;
  if (PRODUCT_REFERENCE.test(normalized) && PRODUCT_USAGE_REQUEST.test(normalized)) return true;
  if (FACTUAL_DOMAIN_REQUEST.test(normalized)) return false;
  return CAPABILITY_REQUEST.test(normalized);
}

const PRODUCT_CAPABILITY_REPLIES: Readonly<Record<SupportedLocale, string>> = {
  ko: [
    "안녕하세요! BORA Bridge의 주요 기능을 간단히 안내할게요.",
    "",
    "- **자산·현금흐름**: 직접 입력한 자산, 수입·지출을 계정에 저장하고 목표를 계산합니다.",
    "- **안전 점검**: 의심 문자·URL의 위험 신호와 필요한 대응 순서를 확인합니다.",
    "- **기회 탐색**: 청년 정책, 금융 지원, 취업, 창업 공고와 상권 검색을 살펴봅니다.",
    "- **환율**: 원화와 외화를 양방향으로 환산하고 환율 흐름을 확인합니다.",
    "- **근거 기반 AI**: 질문과 관련된 저장된 공식 자료를 찾아 출처와 함께 설명합니다.",
    "",
    "주요 메뉴에서 시작하거나 원하는 기능을 말해 주세요. 최신 자격·금리·법률이 필요한 질문은 공식 근거를 따로 확인해 안내합니다.",
  ].join("\n"),
  en: [
    "Hello! Here are the main things you can do in BORA Bridge.",
    "",
    "- **Assets & cash flow**: Save assets, income, and expenses you enter yourself, then calculate a goal.",
    "- **Safety check**: Review warning signs in suspicious messages or URLs and the next response steps.",
    "- **Opportunity search**: Explore youth policy, financial support, employment and startup notices, plus business-area search.",
    "- **Exchange rates**: Convert between KRW and foreign currencies in both directions and review rate trends.",
    "- **Evidence-based AI**: Find stored official material related to a question and explain it with sources.",
    "",
    "Start from the main menu or tell me which feature you want. Questions about current eligibility, rates, or law will use the separate official-evidence path.",
  ].join("\n"),
  ja: [
    "こんにちは。BORA Bridgeの主な機能を簡単にご案内します。",
    "",
    "- **資産・キャッシュフロー**：自分で入力した資産、収入、支出をアカウントに保存し、目標を計算します。",
    "- **安全チェック**：不審なメッセージやURLの警告サインと、必要な対応手順を確認します。",
    "- **機会を探す**：若者政策、金融支援、雇用・創業公募、商圏検索を確認します。",
    "- **為替**：韓国ウォンと外貨を双方向に換算し、為替の推移を確認します。",
    "- **根拠ベースAI**：質問に関連する保存済みの公式資料を探し、出典付きで説明します。",
    "",
    "メインメニューから始めるか、使いたい機能を教えてください。最新の資格・金利・法令が必要な質問は、公式根拠を別途確認してご案内します。",
  ].join("\n"),
  zh: [
    "您好！下面简要介绍 BORA Bridge 的主要功能。",
    "",
    "- **资产与现金流**：保存您手动输入的资产、收入和支出，并计算目标。",
    "- **安全检查**：查看可疑消息或网址的风险信号以及所需的应对步骤。",
    "- **机会查询**：浏览青年政策、金融支持、就业和创业公告，并查询商圈。",
    "- **汇率**：在韩元与外币之间双向换算，并查看汇率走势。",
    "- **依据型AI**：查找与问题相关的已保存官方资料，并附来源进行说明。",
    "",
    "请从主菜单开始，或告诉我您想使用的功能。涉及最新资格、利率或法规的问题会另行核对官方依据。",
  ].join("\n"),
};

export function productCapabilitiesReply(locale: SupportedLocale) {
  return PRODUCT_CAPABILITY_REPLIES[locale];
}
