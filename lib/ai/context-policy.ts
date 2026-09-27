const MAX_USER_EXCERPT_CHARS = 180;
const MAX_ASSISTANT_EXCERPT_CHARS = 260;
const PROMPT_INJECTION_SIGNAL = /(?:ignore\s+(?:all\s+)?(?:previous|prior|earlier)\s+(?:instructions?|messages?|rules?)|(?:reveal|show|print|repeat|override|obey|expose)\s+(?:the\s+)?(?:system|developer|hidden|internal)\s+(?:prompt|message|instructions?|rules?)|system\s+prompt|developer\s+message|hidden\s+instructions?|jailbreak|\bDAN\b|<\|?(?:system|assistant|developer)\|?>|\[(?:system|developer)\]|이전\s*(?:지시|명령|규칙).*무시|(?:시스템|개발자|숨겨진|내부)\s*(?:프롬프트|메시지|지시|규칙).*(?:보여|출력|공개|반복|따라|변경)|前の指示.*無視|システムプロンプト|開発者メッセージ|忽略.*(?:指令|说明|规则)|系统提示词|开发者消息)/iu;
const PROMPT_OVERRIDE_SIGNAL = /(?:disregard\s+(?:everything|all)\s+(?:written\s+)?above|forget\s+(?:all\s+)?(?:previous|prior|earlier)\s+(?:instructions?|messages?|rules?)|act\s+as\s+(?:a\s+|the\s+)?(?:system|developer)|pretend\s+to\s+be|(?:i\s+(?:want|need)\s+you\s+to\s+)?follow\s+(?:these|the\s+following|my)\s+instructions?\s+instead|new\s+(?:system\s+)?instructions?\s*:|do\s+not\s+follow\s+(?:the\s+)?(?:earlier|previous)\s+(?:rules?|instructions?))/iu;
const SENSITIVE_CATEGORY_SIGNAL = /(?:\b(?:HIV|AIDS|cancer|diabetes|diagnos(?:is|ed)|medical\s+(?:condition|history)|mental\s+health|depression|schizophrenia|disability|pregnan(?:t|cy)|religion|religious|Christian|Catholic|Buddhist|Muslim|Hindu|Jewish|political\s+(?:view|belief|party)|Republican|Democrat|voted\s+for)\b|에이즈|암(?:(?:\s*(?:환자|진단|치료|수술|투병|병력|완치|발병|판정))|(?:(?:을|으로|에)\s*(?:진단|치료|수술|투병|판정|걸렸|앓)))|당뇨|고혈압|정신\s*질환|우울증|조현병|장애\s*(?:등급|여부)?|임신|유산|질병|질환|병력|건강\s*정보|종교|신앙|기독교|천주교|불교|이슬람|무슬림|힌두교|유대교|지지\s*정당|정치\s*성향|민주당|국민의힘|정의당|조국혁신당|投票先|政治的信条|宗教|信仰|病歴|診断|障害|妊娠|健康情報|政治倾向|支持政党|宗教信仰|病史|诊断|残疾|怀孕|健康信息)/iu;
const KOREAN_DETAILED_ADDRESS = /(?:\(?\d{5}\)?\s*)?(?:(?:서울|부산|대구|인천|광주|대전|울산|세종)(?:특별시|광역시|특별자치시|시)?|경기(?:도)?|강원(?:특별자치도|도)?|충청[남북]도|전라[남북]도|경상[남북]도|제주(?:특별자치도|도)?)\s+(?:[가-힣0-9·]+(?:시|군|구)\s+){0,2}[가-힣0-9·]+(?:로|길|동|읍|면|리)\s*\d+(?:-\d+)?(?:\s*(?:[가-힣A-Za-z0-9·-]+\s*)?(?:아파트|빌딩|오피스텔|동|호))*/gu;
const SHORT_KOREAN_DETAILED_ADDRESS = /(?:[가-힣0-9·]+(?:시|군|구)\s+){1,2}[가-힣0-9·]+(?:로|길|동|읍|면|리)\s*\d+(?:-\d+)?(?:\s*\d+동\s*\d+호)?/gu;
const ENGLISH_DETAILED_ADDRESS = /\b\d{1,6}\s+[\p{Letter}0-9.' -]{2,60}\s+(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?)\b(?:[^.!?\n]{0,60})/giu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("unexpected_context_field");
  }
}

/** Reject retained text that attempts to become a new instruction. */
export function containsPromptInjection(value: string) {
  const normalized = value.normalize("NFKC");
  return PROMPT_INJECTION_SIGNAL.test(normalized) || PROMPT_OVERRIDE_SIGNAL.test(normalized);
}

function removeSensitiveSentences(value: string) {
  return value
    .split(/(?<=[.!?。！？\n])/u)
    .map((sentence) => SENSITIVE_CATEGORY_SIGNAL.test(sentence) ? " [민감정보 제외] " : sentence)
    .join("");
}

/**
 * Defense-in-depth redaction for opt-in AI context. A sentence containing a
 * diagnosis, belief, or political affiliation is removed as a whole; exact
 * addresses and direct identifiers are independently replaced.
 */
export function redactSensitiveAiText(value: string) {
  return removeSensitiveSentences(value.normalize("NFKC"))
    .replace(KOREAN_DETAILED_ADDRESS, "[상세주소 제외]")
    .replace(SHORT_KOREAN_DETAILED_ADDRESS, "[상세주소 제외]")
    .replace(ENGLISH_DETAILED_ADDRESS, "[상세주소 제외]")
    .replace(/<[^>]*>/gu, " ")
    .replace(/https?:\/\/\S+/giu, "[링크 제외]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[이메일 제외]")
    .replace(/\b01[016789][-\.\s]?\d{3,4}[-\.\s]?\d{4}\b/gu, "[전화번호 제외]")
    .replace(/\b\d{6}[-\s]?\d{7}\b/gu, "[민감정보 제외]")
    .replace(/\b(?:\d[-\s]?){9,18}\d\b/gu, "[계좌·카드번호 제외]")
    .replace(/[*_#>`~]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function parseAiContextPreferenceUpdate(value: unknown) {
  if (!isRecord(value)) throw new Error("invalid_context_preferences");
  assertOnlyKeys(value, [
    "memoryEnabled",
    "conversationContextEnabled",
    "recentActivityEnabled",
    "clearConversationContext",
    "clearRecentActivity",
  ]);
  const memoryEnabled = typeof value.memoryEnabled === "boolean" ? value.memoryEnabled : undefined;
  const conversationContextEnabled = typeof value.conversationContextEnabled === "boolean"
    ? value.conversationContextEnabled
    : undefined;
  const recentActivityEnabled = typeof value.recentActivityEnabled === "boolean"
    ? value.recentActivityEnabled
    : undefined;
  const clearConversationContext = value.clearConversationContext === true;
  const clearRecentActivity = value.clearRecentActivity === true;
  if (
    memoryEnabled === undefined
    && conversationContextEnabled === undefined
    && recentActivityEnabled === undefined
    && !clearConversationContext
    && !clearRecentActivity
  ) {
    throw new Error("context_preference_required");
  }
  return {
    memoryEnabled,
    conversationContextEnabled,
    recentActivityEnabled,
    clearConversationContext,
    clearRecentActivity,
  };
}

function redactedExcerpt(value: string, limit: number): string | null {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || containsPromptInjection(normalized)) return null;
  const safe = redactSensitiveAiText(normalized);
  if (!safe || /^\[민감정보 제외\]$/u.test(safe)) return null;
  return safe.length <= limit ? safe : `${safe.slice(0, limit - 1).trimEnd()}…`;
}

export function sanitizeConversationContext(input: {
  question: string;
  answer: string;
}) {
  const userExcerpt = redactedExcerpt(input.question, MAX_USER_EXCERPT_CHARS);
  const assistantExcerpt = redactedExcerpt(input.answer, MAX_ASSISTANT_EXCERPT_CHARS);
  return userExcerpt && assistantExcerpt ? { userExcerpt, assistantExcerpt } : null;
}
