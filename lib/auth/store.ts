import { randomBase64Url, sha256Hex } from "./crypto";
import type {
  AuthProvider,
  DisplayNameMode,
  OAuthProfile,
  OAuthTransaction,
  StoredAuthUser,
} from "./types";
import {
  normalizeYouthPolicyProfile,
  parseStoredYouthPolicyProfile,
  type YouthPolicyProfile,
} from "./youth-policy-profile";

const AUTH_TRANSACTION_TTL_MS = 10 * 60 * 1_000;
const CONSUMED_TRANSACTION_RETENTION_MS = 24 * 60 * 60 * 1_000;

let schemaReady: Promise<void> | null = null;
let readinessProbe: Promise<boolean> | null = null;

async function getAuthD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new AuthStoreError("storage_unavailable", "D1 binding is unavailable.");
  return env.DB;
}

export class AuthStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthStoreError";
    this.code = code;
  }
}

export async function ensureAuthSchema(): Promise<void> {
  if (schemaReady) return schemaReady;

  schemaReady = initializeSchema().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

export async function authStorageIsReady(): Promise<boolean> {
  // Coalesce a hung query as well as concurrent health requests: timing out a
  // D1 promise cannot cancel it, so never enqueue an unbounded probe backlog.
  if (!readinessProbe) {
    readinessProbe = (async () => {
      await ensureAuthSchema();
      const db = await getAuthD1();
      const result = await db.prepare(`SELECT COUNT(*) AS tableCount FROM sqlite_master
        WHERE type = 'table' AND name IN ('oauth_users', 'oauth_transactions',
          'auth_sessions', 'user_profiles', 'youth_policy_profiles')`)
        .first<{ tableCount: number }>();
      return Number(result?.tableCount) === 5;
    })().catch(() => false).finally(() => { readinessProbe = null; });
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readinessProbe,
      new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), 1_500); }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function initializeSchema(): Promise<void> {
  const db = await getAuthD1();
  const existing = await db.prepare(`SELECT COUNT(*) AS tableCount FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'oauth_users', 'oauth_transactions', 'auth_sessions',
      'user_profiles', 'youth_policy_profiles'
    )`).first<{ tableCount: number }>();
  if (Number(existing?.tableCount) === 5) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS oauth_users (
      id TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT,
      email_verified INTEGER,
      profile_image_url TEXT,
      gender TEXT,
      birthday TEXT,
      birth_year TEXT,
      age_range TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS oauth_users_provider_subject_uidx ON oauth_users (provider, provider_subject)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS oauth_users_provider_idx ON oauth_users (provider)",
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS oauth_transactions (
      state_hash TEXT PRIMARY KEY NOT NULL,
      provider TEXT NOT NULL,
      code_verifier TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      return_to TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    )`),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS oauth_transactions_expires_at_idx ON oauth_transactions (expires_at)",
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES oauth_users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )`),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at)",
    ),
    db.prepare(`CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES oauth_users(id) ON DELETE CASCADE,
      provider_name TEXT,
      provider_nickname TEXT,
      display_name_mode TEXT NOT NULL DEFAULT 'nickname',
      bora_alias TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS youth_policy_profiles (
      user_id TEXT PRIMARY KEY NOT NULL REFERENCES oauth_users(id) ON DELETE CASCADE,
      profile_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
  ]);
}

export async function createOAuthTransaction(input: {
  state: string;
  provider: AuthProvider;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
}): Promise<void> {
  await ensureAuthSchema();
  const db = await getAuthD1();
  const now = Date.now();
  const stateHash = await sha256Hex(input.state);

  await db.batch([
    db.prepare(
      "DELETE FROM oauth_transactions WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)",
    ).bind(now, now - CONSUMED_TRANSACTION_RETENTION_MS),
    db.prepare(
      `INSERT INTO oauth_transactions
        (state_hash, provider, code_verifier, redirect_uri, return_to, created_at, expires_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      stateHash,
      input.provider,
      input.codeVerifier,
      input.redirectUri,
      input.returnTo,
      now,
      now + AUTH_TRANSACTION_TTL_MS,
    ),
  ]);
}

type TransactionRow = {
  stateHash: string;
  provider: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
};

export async function consumeOAuthTransaction(input: {
  state: string;
  provider: AuthProvider;
  redirectUri: string;
}): Promise<OAuthTransaction> {
  await ensureAuthSchema();
  const db = await getAuthD1();
  const now = Date.now();
  const stateHash = await sha256Hex(input.state);
  const row = await db
    .prepare(
      `SELECT
        state_hash AS stateHash,
        provider,
        code_verifier AS codeVerifier,
        redirect_uri AS redirectUri,
        return_to AS returnTo,
        created_at AS createdAt,
        expires_at AS expiresAt,
        consumed_at AS consumedAt
       FROM oauth_transactions
       WHERE state_hash = ?`,
    )
    .bind(stateHash)
    .first<TransactionRow>();

  if (!row || row.consumedAt !== null) {
    throw new AuthStoreError("invalid_state", "OAuth transaction is missing or already used.");
  }
  if (row.provider !== input.provider || row.redirectUri !== input.redirectUri) {
    throw new AuthStoreError("invalid_state", "OAuth transaction does not match the callback.");
  }
  if (row.expiresAt <= now) {
    throw new AuthStoreError("expired_state", "OAuth transaction has expired.");
  }

  const consumed = await db
    .prepare(
      "UPDATE oauth_transactions SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL",
    )
    .bind(now, stateHash)
    .run();
  if ((consumed.meta.changes ?? 0) !== 1) {
    throw new AuthStoreError("invalid_state", "OAuth transaction was already used.");
  }

  return {
    ...row,
    provider: input.provider,
    consumedAt: now,
  };
}

type UserRow = {
  id: string;
  provider: AuthProvider;
  providerSubject: string;
  providerDisplayName: string;
  name: string | null;
  nickname: string | null;
  displayNameMode: DisplayNameMode | null;
  boraAlias: string | null;
  youthPolicyProfileJson: string | null;
  email: string | null;
  emailVerified: number | null;
  profileImageUrl: string | null;
  gender: string | null;
  birthday: string | null;
  birthYear: string | null;
  ageRange: string | null;
  createdAt: number;
  updatedAt: number;
};

function effectiveDisplayNameMode(row: UserRow): DisplayNameMode {
  if (row.displayNameMode === "bora" && row.boraAlias?.trim()) return "bora";
  if (row.displayNameMode === "name" && row.name?.trim()) return "name";
  if (row.nickname?.trim()) return "nickname";
  if (row.name?.trim()) return "name";
  return "nickname";
}

function resolvedDisplayName(row: UserRow): string {
  const mode = effectiveDisplayNameMode(row);
  if (mode === "bora" && row.boraAlias?.trim()) return row.boraAlias.trim();
  if (mode === "name" && row.name?.trim()) return row.name.trim();
  return row.nickname?.trim() || row.name?.trim() || row.providerDisplayName;
}

function storedUser(row: UserRow): StoredAuthUser {
  return {
    id: row.id,
    provider: row.provider,
    subject: row.providerSubject,
    displayName: resolvedDisplayName(row),
    name: row.name,
    nickname: row.nickname,
    displayNameMode: effectiveDisplayNameMode(row),
    boraAlias: row.boraAlias,
    youthPolicyProfile: parseStoredYouthPolicyProfile(row.youthPolicyProfileJson),
    email: row.email,
    emailVerified: row.emailVerified === null ? null : row.emailVerified === 1,
    profileImageUrl: row.profileImageUrl,
    gender: row.gender,
    birthday: row.birthday,
    birthYear: row.birthYear,
    ageRange: row.ageRange,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function upsertOAuthUser(profile: OAuthProfile): Promise<StoredAuthUser> {
  await ensureAuthSchema();
  const db = await getAuthD1();
  const now = Date.now();
  const proposedId = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO oauth_users (
        id, provider, provider_subject, display_name, email, email_verified,
        profile_image_url, gender, birthday, birth_year, age_range, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, provider_subject) DO UPDATE SET
        display_name = excluded.display_name,
        email = excluded.email,
        email_verified = excluded.email_verified,
        profile_image_url = excluded.profile_image_url,
        gender = excluded.gender,
        birthday = excluded.birthday,
        birth_year = excluded.birth_year,
        age_range = excluded.age_range,
        updated_at = excluded.updated_at`,
    )
    .bind(
      proposedId,
      profile.provider,
      profile.subject,
      profile.displayName,
      profile.email,
      profile.emailVerified === null ? null : profile.emailVerified ? 1 : 0,
      profile.profileImageUrl,
      profile.gender,
      profile.birthday,
      profile.birthYear,
      profile.ageRange,
      now,
      now,
    )
    .run();

  const identity = await db
    .prepare(
      `SELECT
        id
       FROM oauth_users
       WHERE provider = ? AND provider_subject = ?`,
    )
    .bind(profile.provider, profile.subject)
    .first<{ id: string }>();
  if (!identity) throw new AuthStoreError("user_write_failed", "OAuth user could not be stored.");

  await db
    .prepare(
      `INSERT INTO user_profiles (
        user_id, provider_name, provider_nickname, display_name_mode, bora_alias, created_at, updated_at
      ) VALUES (?, ?, ?, 'nickname', NULL, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        provider_name = excluded.provider_name,
        provider_nickname = excluded.provider_nickname,
        updated_at = excluded.updated_at`,
    )
    .bind(identity.id, profile.name, profile.nickname, now, now)
    .run();

  const user = await getUserById(identity.id);
  if (!user) throw new AuthStoreError("user_write_failed", "OAuth profile could not be stored.");
  return user;
}

const USER_SELECT_COLUMNS = `
  u.id,
  u.provider,
  u.provider_subject AS providerSubject,
  u.display_name AS providerDisplayName,
  u.email,
  u.email_verified AS emailVerified,
  u.profile_image_url AS profileImageUrl,
  u.gender,
  u.birthday,
  u.birth_year AS birthYear,
  u.age_range AS ageRange,
  u.created_at AS createdAt,
  u.updated_at AS updatedAt,
  p.provider_name AS name,
  p.provider_nickname AS nickname,
  p.display_name_mode AS displayNameMode,
  p.bora_alias AS boraAlias,
  yp.profile_json AS youthPolicyProfileJson`;

const USER_SELECT_FROM = `FROM oauth_users u
 LEFT JOIN user_profiles p ON p.user_id = u.id
 LEFT JOIN youth_policy_profiles yp ON yp.user_id = u.id`;

const USER_SELECT = `SELECT${USER_SELECT_COLUMNS}
 ${USER_SELECT_FROM}`;

export const AUTH_SESSION_USER_SELECT_SQL = `SELECT${USER_SELECT_COLUMNS},
  s.expires_at AS sessionExpiresAt
 ${USER_SELECT_FROM}
 INNER JOIN auth_sessions s ON s.user_id = u.id`;

async function getUserById(userId: string): Promise<StoredAuthUser | null> {
  const db = await getAuthD1();
  const row = await db
    .prepare(`${USER_SELECT} WHERE u.id = ?`)
    .bind(userId)
    .first<UserRow>();
  return row ? storedUser(row) : null;
}

export async function updateUserProfile(input: {
  userId: string;
  displayNameMode: DisplayNameMode;
  boraAlias: string | null;
}): Promise<StoredAuthUser> {
  await ensureAuthSchema();
  const db = await getAuthD1();
  const now = Date.now();
  const updated = await db
    .prepare(
      `UPDATE user_profiles
       SET display_name_mode = ?, bora_alias = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .bind(input.displayNameMode, input.boraAlias, now, input.userId)
    .run();
  if ((updated.meta.changes ?? 0) !== 1) {
    throw new AuthStoreError("profile_update_failed", "User profile could not be updated.");
  }
  const user = await getUserById(input.userId);
  if (!user) throw new AuthStoreError("profile_update_failed", "User profile is unavailable.");
  return user;
}

export async function updateYouthPolicyProfile(input: {
  userId: string;
  profile: YouthPolicyProfile;
}): Promise<StoredAuthUser> {
  await ensureAuthSchema();
  const db = await getAuthD1();
  const now = Date.now();
  // Normalize again at the persistence boundary so internal callers cannot
  // accidentally store unsupported or overly detailed fields.
  const profile = normalizeYouthPolicyProfile(input.profile);
  await db
    .prepare(
      `INSERT INTO youth_policy_profiles (user_id, profile_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         profile_json = excluded.profile_json,
         updated_at = excluded.updated_at`,
    )
    .bind(input.userId, JSON.stringify(profile), now, now)
    .run();
  const user = await getUserById(input.userId);
  if (!user) throw new AuthStoreError("profile_update_failed", "User profile is unavailable.");
  return user;
}

export async function createAuthSession(input: {
  userId: string;
  provider: AuthProvider;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: number }> {
  await ensureAuthSchema();
  const db = await getAuthD1();
  const token = randomBase64Url(32);
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const expiresAt = now + input.ttlSeconds * 1_000;

  await db.batch([
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now),
    db.prepare(
      `INSERT INTO auth_sessions
        (token_hash, user_id, provider, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(tokenHash, input.userId, input.provider, now, expiresAt, now),
  ]);
  return { token, expiresAt };
}

export type StoredSessionUser = StoredAuthUser & {
  sessionExpiresAt: number;
};

export async function getUserForSession(token: string): Promise<StoredSessionUser | null> {
  if (!token || token.length > 256) return null;
  await ensureAuthSchema();
  const db = await getAuthD1();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const row = await db
    .prepare(
      `${AUTH_SESSION_USER_SELECT_SQL}
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<UserRow & { sessionExpiresAt: number }>();
  if (!row) return null;

  await db
    .prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?")
    .bind(now, tokenHash)
    .run();
  return { ...storedUser(row), sessionExpiresAt: row.sessionExpiresAt };
}

export async function deleteAuthSession(token: string): Promise<void> {
  if (!token || token.length > 256) return;
  await ensureAuthSchema();
  const tokenHash = await sha256Hex(token);
  const db = await getAuthD1();
  await db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(tokenHash).run();
}
