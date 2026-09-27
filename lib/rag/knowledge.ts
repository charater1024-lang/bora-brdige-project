import { normalizeRagText, ragSearchTerms, studentLoanOfficialGuideRequested } from "./query";

export type SupportedLocale = "ko" | "en" | "ja" | "zh";

export interface KnowledgeSource {
  publisher: string;
  title: string;
  url: string;
  reviewedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  keywords: string[];
  locales: SupportedLocale[];
  source: KnowledgeSource;
}

export interface KnowledgeSearchResult {
  document: KnowledgeDocument;
  score: number;
  matchedKeywords: string[];
}

/**
 * A small, auditable starter corpus. Product eligibility, rates, and response
 * procedures can change, so every answer should preserve the source and review date.
 */
export const FINANCIAL_KNOWLEDGE: readonly KnowledgeDocument[] = [
  {
    id: "phishing-emergency-response",
    title: "보이스피싱·스미싱 의심 또는 피해 시 즉시 대응",
    content:
      "의심 연락의 링크와 첨부파일을 열지 말고 송금·인증번호 공유를 중단한다. 이미 송금했거나 계좌·인증정보가 노출됐다면 금융회사와 경찰 112에 즉시 지급정지와 피해구제를 요청한다. 1394는 24시간 운영되는 전기통신금융사기 통합 신고·상담 번호다. 메시지에 표시된 번호가 아니라 직접 찾은 공식 채널로 기관을 재확인한다.",
    keywords: [
      "보이스피싱",
      "스미싱",
      "피싱",
      "사기",
      "지급정지",
      "악성앱",
      "112",
      "1394",
      "phishing",
      "smishing",
      "scam",
      "fraud",
      "詐欺",
      "フィッシング",
      "诈骗",
      "钓鱼",
    ],
    locales: ["ko", "en", "ja", "zh"],
    source: {
      publisher: "경찰청",
      title: "보이스피싱 통합신고대응센터 1394 안내",
      url: "https://www.police.go.kr/user/bbs/BD_selectBbs.do?q_bbsCode=1007&q_bbscttSn=20260209152732394",
      reviewedAt: "2026-07-21",
    },
  },
  {
    id: "smishing-safe-verification",
    title: "기관 사칭 문자와 링크를 안전하게 확인하는 법",
    content:
      "공공기관·금융회사·거래처를 사칭한 문자도 발신번호가 조작될 수 있다. 문자 속 URL이나 전화번호를 사용하지 말고 공식 홈페이지나 앱에서 고객센터를 별도로 찾아 확인한다. 금융정보 노출이 의심되면 금융감독원 파인과 계좌정보통합관리서비스의 공식 피해예방 기능을 확인한다.",
    keywords: [
      "기관 사칭",
      "문자 링크",
      "발신번호 조작",
      "고객센터",
      "파인",
      "계좌정보통합관리",
      "impersonation",
      "spoofing",
      "suspicious link",
      "なりすまし",
      "不審なリンク",
      "冒充",
      "可疑链接",
    ],
    locales: ["ko", "en", "ja", "zh"],
    source: {
      publisher: "금융위원회",
      title: "스미싱 피해예방 및 대응 안내",
      url: "https://fsc.go.kr/no010101/86271",
      reviewedAt: "2026-07-21",
    },
  },
  {
    id: "youth-asset-building",
    title: "청년 자산형성 지원제도 확인 원칙",
    content:
      "청년 대상 정책형 저축·자산형성 상품은 연령, 소득, 가구 요건, 신청기간과 정부기여 방식이 제도별로 다르다. 서민금융진흥원의 최신 공고에서 신청 가능 여부와 요건을 확인하고, 만기 전 중도해지·세제 조건까지 비교한다. 과거 상품의 소개문만 보고 현재 가입 가능하다고 가정하지 않는다.",
    keywords: [
      "청년",
      "자산형성",
      "정책저축",
      "청년도약",
      "미래적금",
      "정부기여",
      "youth savings",
      "asset building",
      "若者",
      "資産形成",
      "青年",
      "资产形成",
    ],
    locales: ["ko", "en", "ja", "zh"],
    source: {
      publisher: "서민금융진흥원",
      title: "청년 자산형성 지원 공식 안내",
      url: "https://www.kinfa.or.kr/fill4young/financeCommercial/youthLongAsset.do",
      reviewedAt: "2026-07-21",
    },
  },
  {
    id: "startup-support-discovery",
    title: "창업 단계별 정부 지원사업 찾기",
    content:
      "K-Startup에서 예비·초기·도약 등 창업 단계, 사업 분야, 지역과 모집 일정을 기준으로 지원사업을 탐색할 수 있다. 지원 전에는 공고 원문에서 신청자격, 중복수혜 제한, 자부담, 제출서류와 마감시각을 확인하고 사업계획의 문제·고객·검증지표를 구체화한다.",
    keywords: [
      "창업",
      "예비창업",
      "스타트업",
      "지원사업",
      "사업계획",
      "K-Startup",
      "startup",
      "entrepreneur",
      "起業",
      "スタートアップ",
      "创业",
    ],
    locales: ["ko", "en", "ja", "zh"],
    source: {
      publisher: "중소벤처기업부·창업진흥원",
      title: "K-Startup 창업지원포털",
      url: "https://www.k-startup.go.kr/web/main/index.do",
      reviewedAt: "2026-07-21",
    },
  },
  {
    id: "foreign-resident-finance",
    title: "외국인 주민의 금융 정착과 본인확인",
    content:
      "외국인의 계좌개설·본인확인 서류와 이용 가능 서비스는 체류자격, 국내거소, 금융회사 정책에 따라 달라질 수 있다. 출입국·외국인정책본부의 공식 안내와 금융회사 다국어 고객센터에서 최신 요건을 확인한다. 출입국 관련 다국어 상담은 1345에서 제공한다.",
    keywords: [
      "외국인",
      "금융정착",
      "체류자격",
      "본인확인",
      "계좌개설",
      "1345",
      "foreigner",
      "resident",
      "identity verification",
      "外国人",
      "本人確認",
      "外国人",
      "身份验证",
    ],
    locales: ["ko", "en", "ja", "zh"],
    source: {
      publisher: "법무부 출입국·외국인정책본부",
      title: "외국인 신분증 진위확인 및 외국인종합안내센터",
      url: "https://www.immigration.go.kr/immigration/3516/subview.do",
      reviewedAt: "2026-07-21",
    },
  },
  {
    id: "investment-disclosure-check",
    title: "투자 전 공시와 시장경보 확인",
    content:
      "종목이나 기업을 검토할 때 수익을 보장하는 홍보문보다 금융감독원 DART의 기업공시와 한국거래소 KIND의 투자주의·경고·위험종목 정보를 먼저 확인한다. 공시는 손실 가능성을 없애지 않으며, 분산·기간·유동성·감내 가능한 손실 한도를 함께 점검한다.",
    keywords: [
      "주식",
      "증시",
      "투자",
      "공시",
      "DART",
      "KIND",
      "투자경고",
      "investment",
      "disclosure",
      "stock",
      "投資",
      "株式",
      "投资",
      "股票",
    ],
    locales: ["ko", "en", "ja", "zh"],
    source: {
      publisher: "금융감독원·한국거래소",
      title: "DART 기업공시 및 KIND 시장경보",
      url: "https://kind.krx.co.kr/investwarn/investattentwarnrisky.do?method=investattentwarnriskyMain",
      reviewedAt: "2026-07-21",
    },
  },
  {
    id: "financial-product-comparison",
    title: "예·적금과 금융상품 비교 원칙",
    content:
      "정기예금은 보통 목돈을 한 번에 맡겨 일정 기간 운용하고, 적금은 정기적으로 또는 자유롭게 돈을 나누어 납입해 목돈을 모으는 방식이다. 적금은 각 납입금의 예치 기간이 달라 같은 표시금리라도 총 납입액 전체에 전체 계약기간의 이자가 붙는 것은 아니다. 금융상품은 표시금리만 보지 말고 우대금리 충족조건, 중도해지이율, 예금자보호 여부, 수수료, 가입대상과 기간을 함께 비교한다. 금융감독원 금융상품 한눈에에서 후보를 좁힌 뒤 실제 가입 전 해당 금융회사 원문으로 최신 조건을 재확인한다.",
    keywords: [
      "예금",
      "적금",
      "금리",
      "금융상품",
      "예금자보호",
      "금융상품 한눈에",
      "deposit",
      "savings",
      "interest rate",
      "預金",
      "金利",
      "存款",
      "利率",
    ],
    locales: ["ko", "en", "ja", "zh"],
    source: {
      publisher: "금융감독원",
      title: "금융상품 한눈에",
      url: "https://finlife.fss.or.kr/",
      reviewedAt: "2026-07-21",
    },
  },
] as const;

/** Navigation-only evidence: it does not contain a current loan rate. */
export const STUDENT_LOAN_OFFICIAL_GUIDE: KnowledgeDocument = {
  id: "student-loan-official-guide",
  title: "한국장학재단 학자금대출 공식 확인 경로",
  content: "학자금대출 금리를 확인할 공식 자료는 한국장학재단의 ‘학자금대출 한눈에 보기’다. 학자금대출 소개와 취업 후 상환·일반 상환 학자금대출 안내를 구분해 확인한다. 지역별 이자 지원 공고는 별도의 지원사업으로 중앙 학자금대출 금리 안내를 대신하지 않는다. 이 자료는 공식 안내 위치만 제공하며 현재 금리 수치나 개인별 자격을 확인한 자료가 아니다.",
  keywords: ["학자금대출", "공식 자료", "student loan"],
  locales: ["ko", "en", "ja", "zh"],
  source: { publisher: "한국장학재단", title: "학자금대출 한눈에 보기",
    url: "https://www.kosaf.go.kr/ko/tuition.do?pg=tuition_main", reviewedAt: "2026-09-01" },
};

const LOW_SIGNAL_TERMS = new Set([
  "신청", "서류", "조건", "기간", "확인", "방법", "안내", "정보", "자료", "지원", "가입", "대상",
  "기준", "원문", "공식", "금융", "금융회사", "제도", "상품", "준비", "절차", "기관", "정부",
  "application", "documents", "conditions", "official", "support", "program", "information",
  "requirements", "eligibility", "source", "website", "government", "deadline", "verification",
]);

function containsSearchTerm(text: string, term: string) {
  if (/^[a-z0-9 ]+$/iu.test(term)) {
    // Word boundaries avoid matches such as `in` -> `savings` or `me` ->
    // `investment`; CJK compounds still need substring matching.
    return (` ${text} `).includes(` ${term} `);
  }
  return text.includes(term);
}

export function searchKnowledge(query: string, limit = 4): KnowledgeSearchResult[] {
  if (studentLoanOfficialGuideRequested(query)) return [{ document: STUDENT_LOAN_OFFICIAL_GUIDE, score: 100, matchedKeywords: ["학자금대출 공식 자료"] }];
  const normalized = normalizeRagText(query.slice(0, 2_400));
  const terms = ragSearchTerms(query);
  if (!normalized || !terms.length) return [];

  const cappedLimit = Math.min(10, Math.max(1, Math.trunc(limit) || 4));
  return FINANCIAL_KNOWLEDGE.map((document) => {
    const title = normalizeRagText(document.title);
    const content = normalizeRagText(document.content);
    const uniqueKeywords = [...new Set(document.keywords)];
    const keywords = uniqueKeywords.map(normalizeRagText);
    const matchedKeywords = uniqueKeywords.filter((keyword, index) => {
      const normalizedKeyword = keywords[index];
      return containsSearchTerm(normalized, normalizedKeyword)
        || terms.some((term) => term === normalizedKeyword);
    });

    let score = matchedKeywords.length * 8;
    let meaningfulMatches = matchedKeywords.length;
    for (const term of terms) {
      const inTitle = containsSearchTerm(title, term);
      const inKeywords = keywords.some((keyword) => containsSearchTerm(keyword, term));
      const inContent = containsSearchTerm(content, term);
      if (LOW_SIGNAL_TERMS.has(term)) {
        if (inTitle || inKeywords || inContent) score += 1;
      } else {
        if (inTitle) score += 5;
        if (inKeywords) score += 4;
        if (inContent) score += 4;
        if (inTitle || inKeywords || inContent) meaningfulMatches += 1;
      }
    }

    // Shared words such as 신청/서류 must not turn unrelated documents into
    // evidence. Two weak content fragments alone are not enough either.
    if (!meaningfulMatches || score < 6) score = 0;

    return { document, score, matchedKeywords };
  })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id))
    .slice(0, cappedLimit);
}

export function getKnowledgeById(id: string) {
  if (id === STUDENT_LOAN_OFFICIAL_GUIDE.id) return STUDENT_LOAN_OFFICIAL_GUIDE;
  return FINANCIAL_KNOWLEDGE.find((document) => document.id === id);
}

export function formatKnowledgeContext(results: readonly KnowledgeSearchResult[]) {
  if (!results.length) return "No matching verified knowledge was found.";

  return results
    .map(({ document }) =>
      [
        `[${document.id}] ${document.title}`,
        document.content,
        `Source: ${document.source.publisher}, ${document.source.title}`,
        `URL: ${document.source.url}`,
        `Reviewed: ${document.source.reviewedAt}`,
      ].join("\n"),
    )
    .join("\n\n");
}
