import {
  JUDGE_SESSION_SCHEMA_VERSION,
  READABLE_JUDGE_COVERAGE_PINS,
  validJudgeCoverageRun,
  validStoredJudgeCoverageRun,
  type JudgeArtifactHashes,
  type JudgeSession,
} from "./judge-evaluation";

type JudgeSessionRow = {
  id: string;
  status: string;
  sessionJson: string;
  updatedAt: number;
};

let schemaReady: Promise<D1Database> | null = null;

async function judgeD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("judge_storage_unavailable");
  return env.DB;
}

export async function ensureJudgeSessionSchema(): Promise<D1Database> {
  if (!schemaReady) {
    schemaReady = judgeD1().then(async (db) => {
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS judge_evaluation_sessions (
          id TEXT PRIMARY KEY NOT NULL,
          created_by_user_id TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'sealed')),
          rubric_version TEXT NOT NULL,
          dataset_id TEXT NOT NULL,
          dataset_hash TEXT NOT NULL,
          session_json TEXT NOT NULL,
          total_score INTEGER NOT NULL DEFAULT 0 CHECK (total_score >= 0 AND total_score <= 100),
          gate_status TEXT NOT NULL DEFAULT 'review' CHECK (gate_status IN ('review', 'pass', 'fail')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          sealed_at INTEGER,
          FOREIGN KEY (created_by_user_id) REFERENCES oauth_users(id) ON DELETE CASCADE,
          CHECK (length(title) BETWEEN 1 AND 80),
          CHECK (length(session_json) <= 131072)
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS judge_evaluation_sessions_creator_updated_idx
          ON judge_evaluation_sessions (created_by_user_id, updated_at)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS judge_evaluation_sessions_status_updated_idx
          ON judge_evaluation_sessions (status, updated_at)`),
      ]);
      return db;
    }).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function parseSessionRow(row: JudgeSessionRow | null): JudgeSession | null {
  if (!row || row.sessionJson.length > 131_072) return null;
  try {
    const parsed = JSON.parse(row.sessionJson) as Partial<JudgeSession>;
    if ((parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3 && parsed.schemaVersion !== 4 && parsed.schemaVersion !== 5 && parsed.schemaVersion !== 6 && parsed.schemaVersion !== JUDGE_SESSION_SCHEMA_VERSION)
      || parsed.id !== row.id
      || parsed.status !== row.status
      || typeof parsed.title !== "string"
      || !parsed.summary
      || typeof parsed.runnerVersion !== "string"
      || !parsed.definitions
      || !parsed.datasetPrivacy
      || !parsed.manualReviews
      || !parsed.gateReviews) return null;
    if (parsed.schemaVersion === JUDGE_SESSION_SCHEMA_VERSION) {
      const hashes = parsed.artifactHashes;
      if (!hashes || ![hashes.coreDataset, hashes.apiSnapshots, hashes.evidenceManifest]
        .every((value) => typeof value === "string" && /^[0-9a-f]{64}$/u.test(value))) return null;
      if (!("coverageRun" in parsed)
        || (parsed.automaticRun
          ? !validStoredJudgeCoverageRun(parsed.coverageRun)
          : parsed.coverageRun !== null)) return null;
    }
    return parsed as JudgeSession;
  } catch {
    return null;
  }
}

function serialized(session: JudgeSession) {
  const value = JSON.stringify(session);
  if (value.length > 131_072) throw new Error("judge_session_too_large");
  return value;
}

export async function listJudgeSessions(userId: string, limit = 30): Promise<JudgeSession[]> {
  const cappedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const result = await (await ensureJudgeSessionSchema())
    .prepare(`SELECT id, status, session_json AS sessionJson, updated_at AS updatedAt
      FROM judge_evaluation_sessions
      WHERE created_by_user_id = ?
      ORDER BY updated_at DESC
      LIMIT ?`)
    .bind(userId, cappedLimit)
    .all<JudgeSessionRow>();
  return result.results.flatMap((row) => {
    const session = parseSessionRow(row);
    return session ? [session] : [];
  });
}

export type JudgeSessionDefinitionFilter = {
  schemaVersion: number;
  runnerVersion: string;
  rubricVersion: string;
  datasetId: string;
  datasetHash: string;
  artifactHashes: JudgeArtifactHashes;
};

export type JudgeSessionCursor = {
  createdAt: number;
  id: string;
};

// The listing and its count share the same release pins. A known historical
// 600-case run remains readable; an unknown release is not counted as current.
const READABLE_COVERAGE_SQL = READABLE_JUDGE_COVERAGE_PINS.map(() => `(
  json_extract(session_json, '$.coverageRun.corpusId') = ?
  AND json_extract(session_json, '$.coverageRun.manifestSha256') = ?
  AND json_extract(session_json, '$.coverageRun.definitionSha256') = ?
  AND json_extract(session_json, '$.coverageRun.caseOrderSha256') = ?
)`).join(" OR ");

const CURRENT_DEFINITION_SQL = `rubric_version = ?
  AND dataset_id = ?
  AND dataset_hash = ?
  AND json_extract(session_json, '$.schemaVersion') = ?
  AND json_extract(session_json, '$.runnerVersion') = ?
  AND json_extract(session_json, '$.artifactHashes.coreDataset') = ?
  AND json_extract(session_json, '$.artifactHashes.apiSnapshots') = ?
  AND json_extract(session_json, '$.artifactHashes.evidenceManifest') = ?
  AND ((json_type(session_json, '$.automaticRun') = 'null'
    AND json_type(session_json, '$.coverageRun') = 'null')
    OR (json_type(session_json, '$.automaticRun') = 'object' AND (${READABLE_COVERAGE_SQL})))`;

function definitionBindings(filter: JudgeSessionDefinitionFilter) {
  return [
    filter.rubricVersion,
    filter.datasetId,
    filter.datasetHash,
    filter.schemaVersion,
    filter.runnerVersion,
    filter.artifactHashes.coreDataset,
    filter.artifactHashes.apiSnapshots,
    filter.artifactHashes.evidenceManifest,
    ...READABLE_JUDGE_COVERAGE_PINS.flatMap((pins) => [
      pins.corpusId, pins.manifestSha256, pins.definitionSha256, pins.caseOrderSha256,
    ]),
  ] as const;
}

export async function listJudgeSessionsForDefinition(
  userId: string,
  filter: JudgeSessionDefinitionFilter,
  limit = 30,
  cursor: JudgeSessionCursor | null = null,
): Promise<JudgeSession[]> {
  const cappedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const cursorClause = cursor
    ? "AND (created_at < ? OR (created_at = ? AND id < ?))"
    : "";
  const cursorBindings = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : [];
  const result = await (await ensureJudgeSessionSchema())
    .prepare(`SELECT id, status, session_json AS sessionJson, updated_at AS updatedAt
      FROM judge_evaluation_sessions
      WHERE created_by_user_id = ? AND ${CURRENT_DEFINITION_SQL} ${cursorClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`)
    .bind(userId, ...definitionBindings(filter), ...cursorBindings, cappedLimit)
    .all<JudgeSessionRow>();
  return result.results.flatMap((row) => {
    const session = parseSessionRow(row);
    return session ? [session] : [];
  });
}

export async function countJudgeSessions(userId: string): Promise<number> {
  const row = await (await ensureJudgeSessionSchema())
    .prepare("SELECT COUNT(*) AS total FROM judge_evaluation_sessions WHERE created_by_user_id = ?")
    .bind(userId)
    .first<{ total: number }>();
  return Math.max(0, Number(row?.total ?? 0));
}

export async function countJudgeSessionsForDefinition(
  userId: string,
  filter: JudgeSessionDefinitionFilter,
): Promise<number> {
  const row = await (await ensureJudgeSessionSchema())
    .prepare(`SELECT COUNT(*) AS total FROM judge_evaluation_sessions
      WHERE created_by_user_id = ? AND ${CURRENT_DEFINITION_SQL}`)
    .bind(userId, ...definitionBindings(filter))
    .first<{ total: number }>();
  return Math.max(0, Number(row?.total ?? 0));
}

export async function getJudgeSession(userId: string, sessionId: string): Promise<JudgeSession | null> {
  const row = await (await ensureJudgeSessionSchema())
    .prepare(`SELECT id, status, session_json AS sessionJson, updated_at AS updatedAt
      FROM judge_evaluation_sessions
      WHERE id = ? AND created_by_user_id = ?
      LIMIT 1`)
    .bind(sessionId, userId)
    .first<JudgeSessionRow>();
  return parseSessionRow(row);
}

export async function insertJudgeSession(userId: string, session: JudgeSession): Promise<void> {
  const createdAt = Date.parse(session.createdAt);
  const updatedAt = Date.parse(session.updatedAt);
  if (!Number.isSafeInteger(createdAt) || !Number.isSafeInteger(updatedAt)) {
    throw new Error("judge_session_timestamp_invalid");
  }
  await (await ensureJudgeSessionSchema())
    .prepare(`INSERT INTO judge_evaluation_sessions
      (id, created_by_user_id, title, status, rubric_version, dataset_id, dataset_hash,
       session_json, total_score, gate_status, created_at, updated_at, sealed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      session.id,
      userId,
      session.title,
      session.status,
      session.rubricVersion,
      session.datasetId,
      session.datasetHash,
      serialized(session),
      session.summary.totalScore,
      session.summary.readinessGate,
      createdAt,
      updatedAt,
      session.sealedAt ? Date.parse(session.sealedAt) : null,
    )
    .run();
}

export async function updateJudgeSession(
  userId: string,
  session: JudgeSession,
  expectedUpdatedAt: string,
): Promise<boolean> {
  if (session.coverageRun && !validJudgeCoverageRun(session.coverageRun)) {
    throw new Error("judge_session_version_mismatch");
  }
  const expected = Date.parse(expectedUpdatedAt);
  const updatedAt = Date.parse(session.updatedAt);
  if (!Number.isSafeInteger(expected) || !Number.isSafeInteger(updatedAt)) {
    throw new Error("judge_session_timestamp_invalid");
  }
  const result = await (await ensureJudgeSessionSchema())
    .prepare(`UPDATE judge_evaluation_sessions
      SET title = ?, status = ?, rubric_version = ?, dataset_id = ?, dataset_hash = ?,
          session_json = ?, total_score = ?, gate_status = ?, updated_at = ?, sealed_at = ?
      WHERE id = ? AND created_by_user_id = ? AND status <> 'sealed' AND updated_at = ?`)
    .bind(
      session.title,
      session.status,
      session.rubricVersion,
      session.datasetId,
      session.datasetHash,
      serialized(session),
      session.summary.totalScore,
      session.summary.readinessGate,
      updatedAt,
      session.sealedAt ? Date.parse(session.sealedAt) : null,
      session.id,
      userId,
      expected,
    )
    .run();
  return Number(result.meta.changes ?? 0) === 1;
}
