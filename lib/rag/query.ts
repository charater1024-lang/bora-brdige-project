const MAX_QUERY_CHARS = 2_400;
const MAX_PRIOR_QUESTION_CHARS = 800;
const MAX_SEARCH_TERMS = 24;

/** General principles need educational evidence, not a list of current offers. */
export function financialConceptRequested(query: string): boolean {
  return /예금|적금|deposit|savings|預金|積金|存款|储蓄/iu.test(query)
    && /차이|원리|개념|무슨\s*뜻|뭐(?:야|예요)|difference|how.{0,20}work|explain|違い|仕組み|区别|原理/iu.test(query)
    && !/추천|상품명|현재|최신|오늘|가입|신청|은행별|recommend|current|latest|apply|best|おすすめ|申込|最新|推荐|申请/iu.test(query);
}

/** Navigation to the responsible official guide, not a request for a live rate. */
export function studentLoanOfficialGuideRequested(query: string): boolean {
  return /학자금\s*대출|student\s*loans?|奨学金|助学贷款/iu.test(query)
    && !/서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주|지역|지자체|이자\s*지원|원금\s*지원|local|municipal/iu.test(query)
    && /공식\s*(?:자료|안내|사이트)|(?:확인|이용).{0,20}(?:자료|사이트|어디)|official.{0,25}(?:guide|source|site)|公式|官方/iu.test(query)
    && !/얼마|몇\s*퍼센트|몇\s*%|how\s*much|what\s*is\s*the\s*(?:current\s*)?rate|何パーセント|多少/iu.test(query);
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "could",
  "did", "do", "does", "for", "from", "had", "has", "have", "help", "how", "i", "if",
  "in", "is", "it", "me", "more", "my", "of", "on", "or", "our", "please", "should",
  "so", "some", "tell", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "those", "to", "us", "was", "we", "were", "what", "when", "where",
  "which", "who", "why", "will", "with", "would", "you", "your",
  "그거", "그건", "그것", "그럼", "그리고", "그래서", "그러면", "나는", "내가", "내게",
  "대한", "대해", "도와줘", "도와주세요", "뭔가", "무엇", "무슨", "뭐가", "어떤", "어떻게",
  "어떡해요", "알려줘", "알려주세요", "알려줄래", "알려줄래요", "궁금해요", "궁금합니다",
  "있나요", "있어요", "있는데", "있을까요", "없나요", "없어요", "인가요", "이거", "이건",
  "저는", "제가", "하는", "하려고", "해주세요", "받을", "받는", "받고", "할까요", "되나요",
  "教えて", "ください", "ですか", "どう", "什么", "如何", "请问", "告诉我",
]);

// This is deliberately a bounded lexical normalizer, not a Korean morphological
// analyser. Keep the original token as well, so a proper name ending in a
// particle-like syllable (for example 카카오페이) is not lost.
const KOREAN_ENDING = /(?:으로부터|에게서|에서는|으로는|이라면|이라도|이라고|까지는|부터는|하거나|하려면|하면|해도|하는|해서|에는|에서|에게|한테|으로|부터|까지|보다|처럼|만큼|하고|이며|이고|이라|라는|라고|이란|인데|인가요|인가|일까요|나요|예요|이에요|이랑|은|는|이|가|을|를|에|의|도|만|로|와|과|랑)$/u;

function withoutKoreanEnding(token: string) {
  if (!/^[가-힣]{3,}$/u.test(token)) return token;
  const stripped = token.replace(KOREAN_ENDING, "");
  return stripped.length >= 2 ? stripped : token;
}

export function normalizeRagText(text: string): string {
  return text.normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

type QueryExpansion = {
  pattern: RegExp;
  terms: readonly string[];
  subject?: boolean;
};

// These aliases expand search intent only. They must never supply product
// eligibility, rates, deadlines, or any other new answer facts.
const QUERY_EXPANSIONS: readonly QueryExpansion[] = [
  {
    pattern: /(?:보이스\s*피싱|피싱|스미싱|사기|안전\s*계좌|검사.{0,30}(?:계좌|돈|송금|이체)|경찰.{0,30}(?:안전계좌|돈을\s*옮)|\b(?:phishing|smishing|scams?|fraud)\b|(?:text|message|sms).{0,50}(?:bank\s+password|otp)|詐欺|フィッシング|诈骗|詐騙|钓鱼)/iu,
    terms: ["피싱"],
  },
  {
    pattern: /(?:문자.{0,30}(?:링크|url)|(?:링크|url).{0,30}문자|택배.{0,35}(?:주소|연락|문자|링크)|기관\s*사칭|발신번호\s*조작|\b(?:suspicious\s+link|spoofing|impersonation)\b|\b(?:text|message|sms)\b.{0,60}\b(?:password|otp|link)\b|なりすまし|不審なリンク|宅配.{0,30}(?:住所|リンク)|冒充|可疑链接|快递.{0,30}(?:地址|链接))/iu,
    terms: ["문자 링크"],
  },
  {
    pattern: /(?:청년|청년도약|미래적금|정책형\s*저축|젊은.{0,40}(?:목돈|저축|모으)|\byouth\s+savings\b|\basset\s+building\b|若者|資産形成|青年|资产形成)/iu,
    terms: ["청년", "자산형성"],
  },
  {
    pattern: /(?:창업|스타트업|사업\s*(?:시작|준비)|가게.{0,20}(?:열|차리)|매장.{0,20}(?:열|차리)|\b(?:startups?|entrepreneurs?)\b|\bstart(?:ing)?\s+(?:a\s+)?(?:business|company|shop)\b|起業|創業|スタートアップ|创业|开店|开公司)/iu,
    terms: ["창업"],
  },
  {
    pattern: /(?:계좌\s*(?:개설|만들)|통장.{0,10}(?:개설|만들)|\b(?:bank|savings|checking)\s+account\b|\bopen(?:ing)?\s+(?:(?:a|an)\s+)?account\b|口座.{0,15}(?:開|作)|开户|開戶)/iu,
    terms: ["계좌개설"],
  },
  {
    pattern: /(?:외국인|체류자격|국내거소|출입국|\b(?:foreigners?|foreign\s+residents?|immigrants?|residents?)\b|外国人|外國人|在留資格|居留资格)/iu,
    terms: ["외국인"],
  },
  {
    pattern: /(?:투자|주식|증시|기업공시|회사.{0,20}돈.{0,10}넣|기업.{0,20}돈.{0,10}넣|\b(?:invest(?:ment|ments|ing)?|stocks?|shares?)\b|投資|株式|投资|股票)/iu,
    terms: ["투자"],
  },
  {
    pattern: /(?:예금|적금|저축|목돈|돈.{0,15}모으|돈.{0,15}모을|\b(?:deposits?|savings?|saving\s+money)\b|預金|貯金|積立|存款|储蓄|定存)/iu,
    terms: ["적금"],
  },
  {
    pattern: /(?:금리|이자율|\binterest\s+rates?\b|金利|利率)/iu,
    terms: ["금리"],
    subject: false,
  },
  {
    pattern: /(?:중도\s*해지|중간에.{0,10}(?:깨|해지)|만기\s*전.{0,15}(?:깨|해지)|(?:적금|예금).{0,15}(?:깨|해약)|\bearly\s+withdrawal\b|中途解約|提前.{0,10}(?:取款|支取))/iu,
    terms: ["중도해지", "중도해지이율"],
    subject: false,
  },
  {
    pattern: /(?:학자금|장학금|대학.{0,15}등록금|등록금.{0,15}(?:빌|대출)|\bstudent\s+loans?\b|\btuition\b|奨学金|学費|学费|助学贷款)/iu,
    terms: ["학자금", "학자금대출", "장학금"],
  },
  {
    pattern: /(?:월세|주거비|\brent(?:al)?\s+(?:support|subsidy|assistance)\b|家賃|房租|租房补贴)/iu,
    terms: ["월세", "주거"],
  },
  {
    pattern: /(?:취업|취직|구직|고용|실업|일자리|\b(?:unemployment|employment|jobs?|job\s*seeking)\b|求職|就職|就業|雇用|失業|就业|失业)/iu,
    terms: ["취업", "일자리"],
  },
];

function originalSearchTerms(normalized: string) {
  const result: string[] = [];
  for (const token of normalized.split(/\s+/u)) {
    if (token.length < 2 || token.length > 64 || STOP_WORDS.has(token)) continue;
    result.push(token);
    const stem = withoutKoreanEnding(token);
    if (stem !== token && !STOP_WORDS.has(stem)) result.push(stem);
  }
  return [...new Set(result)];
}

export function ragSearchTerms(query: string): string[] {
  const normalized = normalizeRagText(query.slice(0, MAX_QUERY_CHARS));
  if (!normalized) return [];
  const original = originalSearchTerms(normalized);
  const expanded = QUERY_EXPANSIONS.flatMap((rule) => rule.pattern.test(normalized) ? [...rule.terms] : []);
  // Reserve space for both the user's actual names/numbers and lexical aliases.
  return [...new Set([...original.slice(0, 12), ...expanded, ...original.slice(12)])]
    .slice(0, MAX_SEARCH_TERMS);
}

const FOLLOW_UP_MARKER = /^(?:그럼|그러면|그래서|그리고|그다음|다음엔|그건|그거|이건|이거|해당|같은|그\s*(?:상품|정책|사업|제도)|\b(?:and|then|so|what\s+about|how\s+about)\b|それ|その|では|じゃあ|那|那么|这个|這個)/iu;
const VAGUE_FOLLOW_UP = /^(?:(?:그럼|그러면|그래서|그리고|그다음|그건|그거|이건|이거|그것|다음|더|자세히|좀|설명|알려줘|알려주세요|어떻게|\b(?:and|then|so|what\s+about|how\s+about|that|it|next|more|details|please)\b|それ|では|じゃあ|その後|那|那么|这个|然后|呢|详细)\s*)+$/iu;
const DETAIL_REQUEST = /(?:신청|서류|자격|조건|대상|기준|준비|제출|기간|마감|언제|얼마|금리|이자|한도|비용|수수료|나이|소득|중복|가입|방법|절차|가능|해지|해약|연락|어디|\b(?:apply|application|documents?|eligibility|requirements?|deadline|fees?|cost|rates?|income|age|limit|when|where|contact|cancel|how\s+much)\b|書類|条件|資格|申請|期限|いつ|いくら|どこ|連絡|解約|材料|条件|资格|申请|截止|费用|利率|多少|什么时候|哪里|联系)/iu;
const DETAIL_WORDS = new Set([
  "신청", "서류", "자격", "조건", "대상", "기준", "준비", "제출", "필요", "필요한", "기간", "마감",
  "언제", "얼마", "금리", "이자", "한도", "비용", "수수료", "나이", "소득", "중복", "가입", "방법",
  "절차", "가능", "가능한가요", "필요한가요", "필요해요", "필요하나요", "돼요", "되나요",
  "신청서류", "제출서류", "신청자격", "가입조건", "소득조건", "나이제한",
  "어디", "어디서", "연락", "해지", "해약", "보나요", "봐요", "중간",
  "apply", "application", "document", "documents", "eligibility", "requirement", "requirements",
  "deadline", "fee", "fees", "cost", "rate", "rates", "income", "age", "limit", "needed", "need",
  "much", "required", "see", "view", "find", "contact", "cancel", "書類", "条件", "資格", "申請", "期限", "いつ", "いくら", "材料", "资格",
  "申请", "截止", "费用", "利率", "多少", "什么时候",
]);
const CJK_DETAIL_ONLY = /^(?:(?:必要な|必要|申請|提出|その|に|の|は|が|を|いつ|いくら|どんな|何|なに|ですか|でしょうか|教えて|ください|書類|条件|資格|期限|費用|手数料|金利|上限|所得|年齢|需要|哪些|什么|多少|怎么|何时|什么时候|申请|提交|材料|资格|截止|费用|利率|收入|年龄|金额|的|是|呢|吗)\s*)+$/u;

function hasExplicitSubject(normalized: string) {
  // Rates, dates and documents are fields, not a new topic on their own.
  return QUERY_EXPANSIONS.some((rule) => rule.subject !== false && rule.pattern.test(normalized))
    || /(?:대출|연금|보험|전세|주택|햇살론|버팀목|장려금|상권|환율|물가|소비자보호|전자금융|채권추심|비트코인|\b(?:loans?|mortgages?|pensions?|insurance|exchange\s+rate|inflation|bitcoin)\b|貸付|保険|年金|贷款|保险|养老金)/iu.test(normalized);
}

/**
 * The caller is responsible for consent before supplying previous questions.
 * This pure function never reads saved messages or creates inferred user facts.
 */
export function resolveRagQuery(
  latest: string,
  priorUserQuestions: readonly string[] = [],
): { query: string; contextualized: boolean; needsClarification: boolean } {
  const query = latest.trim().slice(0, MAX_QUERY_CHARS);
  const normalized = normalizeRagText(query);
  const unchanged = { query, contextualized: false, needsClarification: false };
  if (!normalized || VAGUE_FOLLOW_UP.test(normalized)) {
    return { ...unchanged, needsClarification: true };
  }
  if (hasExplicitSubject(normalized)) return unchanged;

  const contentTerms = originalSearchTerms(normalized).map(withoutKoreanEnding);
  const detailOnly = CJK_DETAIL_ONLY.test(normalized)
    || (contentTerms.length > 0 && contentTerms.every((term) => DETAIL_WORDS.has(term)));
  if (!DETAIL_REQUEST.test(normalized) || (!FOLLOW_UP_MARKER.test(normalized) && !detailOnly)) {
    return unchanged;
  }

  const previous = priorUserQuestions.slice(-3).reverse().find((question) => {
    const candidate = normalizeRagText(question.trim().slice(0, MAX_PRIOR_QUESTION_CHARS));
    return candidate !== normalized && hasExplicitSubject(candidate);
  });
  if (!previous) return { ...unchanged, needsClarification: true };
  const priorLimit = Math.min(MAX_PRIOR_QUESTION_CHARS, MAX_QUERY_CHARS - query.length - 1);
  if (priorLimit < 40) return { ...unchanged, needsClarification: true };
  return {
    query: `${previous.trim().slice(0, priorLimit)}\n${query}`,
    contextualized: true,
    needsClarification: false,
  };
}
