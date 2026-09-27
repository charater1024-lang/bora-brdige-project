import {
  containsPromptInjection,
  redactSensitiveAiText,
} from "./context-policy.ts";

export const AI_TOPIC_CODES = [
  "saving",
  "spending",
  "safety",
  "startup",
  "investment",
  "settlement",
  "other",
] as const;

export type AiTopicCode = (typeof AI_TOPIC_CODES)[number];

type TopicCountRow = { topic: string; count: number };
type SummaryRow = { totalChats: number; last7Days: number; lastChatAt: number | null };
type MemoryRow = {
  id: string;
  topic: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
};

export type AiUserMemory = {
  id: string;
  topic: AiTopicCode;
  summary: string;
  createdAt: string;
  updatedAt: string;
};

const MAX_MEMORIES_PER_USER = 8;
const MAX_MEMORY_CHARS = 240;

let schemaReady: Promise<void> | null = null;

async function getAiHistoryD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("ai_history_storage_unavailable");
  return env.DB;
}

async function ensureAiHistorySchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = await getAiHistoryD1();
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS ai_chat_events (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES oauth_users(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        source_count INTEGER NOT NULL DEFAULT 0,
        locale TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS ai_chat_events_user_created_idx ON ai_chat_events (user_id, created_at)"),
      db.prepare("CREATE INDEX IF NOT EXISTS ai_chat_events_user_topic_idx ON ai_chat_events (user_id, topic)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS ai_user_memories (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES oauth_users(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        summary TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS ai_user_memories_user_updated_idx ON ai_user_memories (user_id, updated_at)"),
    ]);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

const TOPIC_KEYWORDS: Record<Exclude<AiTopicCode, "other">, string[]> = {
  saving: ["저축", "적금", "예금", "모으", "비상금", "save", "saving", "deposit", "貯金", "預金", "储蓄", "存款"],
  spending: ["소비", "지출", "예산", "구독", "외식", "배달", "spend", "budget", "expense", "支出", "予算", "消费", "预算"],
  safety: ["피싱", "사기", "스미싱", "문자", "송금", "phishing", "scam", "fraud", "詐欺", "诈骗", "钓鱼"],
  startup: ["창업", "사업", "지원금", "스타트업", "startup", "grant", "business", "起業", "创业", "补助"],
  investment: ["주식", "증시", "투자", "공시", "ETF", "stock", "investment", "market", "投資", "株式", "投资", "股票"],
  settlement: ["외국인", "정착", "환율", "환전", "송금", "계좌개설", "foreigner", "settlement", "exchange", "remittance", "外国人", "両替", "外国人", "换汇"],
};

export function classifyAiTopic(message: string): AiTopicCode {
  const normalized = message.normalize("NFKC").toLocaleLowerCase();
  let best: AiTopicCode = "other";
  let bestScore = 0;
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS) as Array<[Exclude<AiTopicCode, "other">, string[]]>) {
    const score = keywords.reduce((sum, keyword) => sum + (normalized.includes(keyword.toLocaleLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) {
      best = topic;
      bestScore = score;
    }
  }
  return best;
}

export async function recordAiChatEvent(input: {
  userId: string;
  topic: AiTopicCode;
  sourceCount: number;
  locale: string;
}) {
  await ensureAiHistorySchema();
  const now = Date.now();
  await (await getAiHistoryD1()).prepare(`INSERT INTO ai_chat_events
    (id, user_id, topic, source_count, locale, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), input.userId, input.topic, Math.max(0, Math.min(10, input.sourceCount)), input.locale, now)
    .run();
}

const MEMORY_SIGNAL = /(?:\b(?:my|i\s+(?:am|have|prefer|want|need|plan)|goal|budget|income|expense|saving|debt|risk\s+tolerance|startup|retirement)\b|(?:저는|나는|제가|내\s|나의|목표|계획|선호|관심|예산|소득|지출|저축|비상금|부채|대출|계좌|창업|거주|직업|연령|위험\s*성향|투자\s*경험|(?:하고|모으고)\s*싶|필요해|원해)|(?:私は|目標|予算|収入|支出|貯蓄|借金|起業|希望|好み)|(?:我是|我的|目标|预算|收入|支出|储蓄|负债|创业|偏好|希望))/iu;
/** Extracts a short preference/goal note without retaining the full chat. */
export function extractAiMemorySummary(message: string): string | null {
  const normalized = message.normalize("NFKC").trim();
  if (
    !normalized ||
    !MEMORY_SIGNAL.test(normalized) ||
    containsPromptInjection(normalized)
  ) return null;

  const safe = redactSensitiveAiText(normalized)
    .replaceAll("[링크 제외]", "[링크]")
    .replaceAll("[이메일 제외]", "[이메일]")
    .replaceAll("[전화번호 제외]", "[전화번호]")
    .replaceAll("[계좌·카드번호 제외]", "[계좌·카드번호]");
  if (!safe || /^\[민감정보 제외\]$/u.test(safe)) return null;
  const sentences = safe
    .split(/(?<=[.!?。！？])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  if (!sentences) return null;
  return sentences.length <= MAX_MEMORY_CHARS
    ? sentences
    : `${sentences.slice(0, MAX_MEMORY_CHARS - 1).trimEnd()}…`;
}

function memoryFromRow(row: MemoryRow): AiUserMemory | null {
  if (containsPromptInjection(row.summary)) return null;
  const summary = redactSensitiveAiText(row.summary)
    .replaceAll("[링크 제외]", "[링크]")
    .replaceAll("[이메일 제외]", "[이메일]")
    .replaceAll("[전화번호 제외]", "[전화번호]")
    .replaceAll("[계좌·카드번호 제외]", "[계좌·카드번호]");
  if (!summary || /^\[민감정보 제외\]$/u.test(summary)) return null;
  return {
    id: row.id,
    topic: AI_TOPIC_CODES.includes(row.topic as AiTopicCode)
      ? (row.topic as AiTopicCode)
      : "other",
    summary,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function getAiUserMemories(userId: string): Promise<AiUserMemory[]> {
  await ensureAiHistorySchema();
  const rows = await (await getAiHistoryD1())
    .prepare(`SELECT id, topic, summary, created_at AS createdAt, updated_at AS updatedAt
      FROM ai_user_memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?`)
    .bind(userId, MAX_MEMORIES_PER_USER)
    .all<MemoryRow>();
  return rows.results.flatMap((row) => {
    const memory = memoryFromRow(row);
    return memory ? [memory] : [];
  });
}

export async function recordAiUserMemory(input: {
  userId: string;
  topic: AiTopicCode;
  message: string;
}): Promise<boolean> {
  const summary = extractAiMemorySummary(input.message);
  if (!summary) return false;
  await ensureAiHistorySchema();
  const db = await getAiHistoryD1();
  const now = Date.now();
  const existing = await db
    .prepare("SELECT id FROM ai_user_memories WHERE user_id = ? AND summary = ? LIMIT 1")
    .bind(input.userId, summary)
    .first<{ id: string }>();

  if (existing) {
    await db.prepare("UPDATE ai_user_memories SET topic = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(input.topic, now, existing.id, input.userId)
      .run();
  } else {
    await db.prepare(`INSERT INTO ai_user_memories
      (id, user_id, topic, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), input.userId, input.topic, summary, now, now)
      .run();
  }

  const overflow = await db
    .prepare(`SELECT id FROM ai_user_memories WHERE user_id = ?
      ORDER BY updated_at DESC LIMIT -1 OFFSET ?`)
    .bind(input.userId, MAX_MEMORIES_PER_USER)
    .all<{ id: string }>();
  if (overflow.results.length) {
    await db.batch(
      overflow.results.map((row) =>
        db.prepare("DELETE FROM ai_user_memories WHERE id = ? AND user_id = ?")
          .bind(row.id, input.userId),
      ),
    );
  }
  return true;
}

export async function deleteAiUserMemory(userId: string, memoryId: string) {
  await ensureAiHistorySchema();
  const result = await (await getAiHistoryD1())
    .prepare("DELETE FROM ai_user_memories WHERE id = ? AND user_id = ?")
    .bind(memoryId, userId)
    .run();
  return Number(result.meta.changes) || 0;
}

export async function deleteAllAiUserMemories(userId: string) {
  await ensureAiHistorySchema();
  const result = await (await getAiHistoryD1())
    .prepare("DELETE FROM ai_user_memories WHERE user_id = ?")
    .bind(userId)
    .run();
  return Number(result.meta.changes) || 0;
}

export async function getAiChatAnalytics(userId: string) {
  await ensureAiHistorySchema();
  const db = await getAiHistoryD1();
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1_000;
  const [topics, summary] = await Promise.all([
    db.prepare(`SELECT topic, COUNT(*) AS count FROM ai_chat_events
      WHERE user_id = ? GROUP BY topic ORDER BY count DESC`)
      .bind(userId)
      .all<TopicCountRow>(),
    db.prepare(`SELECT COUNT(*) AS totalChats,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS last7Days,
      MAX(created_at) AS lastChatAt
      FROM ai_chat_events WHERE user_id = ?`)
      .bind(sevenDaysAgo, userId)
      .first<SummaryRow>(),
  ]);

  const counts = new Map(topics.results.map((row) => [row.topic, Number(row.count) || 0]));
  return {
    topicStats: AI_TOPIC_CODES.map((topic) => ({ topic, count: counts.get(topic) ?? 0 })),
    totalChats: Number(summary?.totalChats) || 0,
    last7Days: Number(summary?.last7Days) || 0,
    lastChatAt: summary?.lastChatAt ? new Date(summary.lastChatAt).toISOString() : null,
  };
}
