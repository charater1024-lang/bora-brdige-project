import { ensureAuthSchema } from "./store";
import { characterBodyLimits, readBoundedRequestJson, RequestBodyError } from "../http/request-body";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  AccountLifecycleError,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "./consent-policy";

export {
  ACCOUNT_DELETION_CONFIRMATION,
  AccountLifecycleError,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  currentOAuthConsentStatePrefix,
  isCurrentOAuthConsentState,
  parseRequiredConsentAcceptance,
} from "./consent-policy";

const MAX_ACCOUNT_REQUEST_CHARS = 2_000;

const INVENTORY_TABLES = [
  { key: "displayProfiles", table: "user_profiles", column: "user_id" },
  { key: "opportunityProfiles", table: "youth_policy_profiles", column: "user_id" },
  { key: "financeSnapshots", table: "user_finance_snapshots", column: "user_id" },
  { key: "aiChatEvents", table: "ai_chat_events", column: "user_id" },
  { key: "aiMemories", table: "ai_user_memories", column: "user_id" },
  { key: "aiContextPreferences", table: "user_ai_context_preferences", column: "user_id" },
  { key: "aiConversationContexts", table: "ai_conversation_contexts", column: "user_id" },
  { key: "recentActivities", table: "user_recent_activities", column: "user_id" },
  { key: "categoryReadMarkers", table: "public_data_user_reads", column: "user_id" },
  { key: "activeSessions", table: "auth_sessions", column: "user_id" },
  { key: "consentRecords", table: "user_required_consents", column: "user_id" },
  { key: "serviceUsageCounters", table: "ai_user_rate_limits", column: "user_id" },
  { key: "serviceUsageCounters", table: "commercial_search_rate_limits", column: "user_id" },
] as const;

const ACCOUNT_DELETE_TABLES = [
  "ai_chat_events",
  "ai_user_memories",
  "ai_conversation_contexts",
  "user_recent_activities",
  "user_ai_context_preferences",
  "ai_user_rate_limits",
  "user_finance_snapshots",
  "youth_policy_profiles",
  "user_profiles",
  "public_data_user_reads",
  "commercial_search_rate_limits",
  "auth_sessions",
  "user_required_consents",
] as const;

const SERVICE_OWNERSHIP_TABLES = [
  { table: "developer_admins", column: "user_id" },
  { table: "service_api_credentials", column: "updated_by_user_id" },
  { table: "ai_provider_settings", column: "updated_by_user_id" },
  { table: "service_api_settings", column: "updated_by_user_id" },
] as const;

type InventoryKey = (typeof INVENTORY_TABLES)[number]["key"];

export type AccountDataInventory = Record<InventoryKey, number> & {
  accountIdentity: 1;
};

export type RequiredConsentState = {
  accepted: boolean;
  requiresAcceptance: boolean;
  termsVersion: string;
  privacyVersion: string;
  acceptedAt: string | null;
};

let schemaReady: Promise<void> | null = null;

async function getAccountD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new AccountLifecycleError(
      "account_storage_unavailable",
      "Account storage is unavailable.",
    );
  }
  return env.DB;
}

export async function ensureAccountLifecycleSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await ensureAuthSchema();
    const db = await getAccountD1();
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS user_required_consents (
        user_id TEXT NOT NULL REFERENCES oauth_users(id) ON DELETE CASCADE,
        terms_version TEXT NOT NULL,
        privacy_version TEXT NOT NULL,
        accepted_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, terms_version, privacy_version)
      )`),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS user_required_consents_user_accepted_idx ON user_required_consents (user_id, accepted_at)",
      ),
    ]);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseAccountDeletionRequest(value: unknown) {
  if (!isRecord(value)) {
    throw new AccountLifecycleError("invalid_json", "Deletion payload is invalid.");
  }
  if (
    value.confirmation !== ACCOUNT_DELETION_CONFIRMATION
    || value.acknowledgePermanentDeletion !== true
  ) {
    throw new AccountLifecycleError(
      "account_deletion_confirmation_required",
      "Permanent account deletion was not explicitly confirmed.",
    );
  }
  return { confirmed: true as const };
}

export async function readBoundedAccountJson(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new AccountLifecycleError(
      "application_json_required",
      "An application/json request body is required.",
    );
  }
  try {
    return await readBoundedRequestJson(request, characterBodyLimits(MAX_ACCOUNT_REQUEST_CHARS));
  } catch (error) {
    if (error instanceof RequestBodyError && error.status === 413) {
      throw new AccountLifecycleError("request_too_large", "Account request is too large.");
    }
    throw new AccountLifecycleError("invalid_json", "Account request is not valid JSON.");
  }
}

export async function getRequiredConsentState(
  userId: string,
): Promise<RequiredConsentState> {
  await ensureAccountLifecycleSchema();
  const row = await (await getAccountD1())
    .prepare(`SELECT accepted_at AS acceptedAt
      FROM user_required_consents
      WHERE user_id = ? AND terms_version = ? AND privacy_version = ?`)
    .bind(userId, CURRENT_TERMS_VERSION, CURRENT_PRIVACY_VERSION)
    .first<{ acceptedAt: number }>();
  return {
    accepted: Boolean(row?.acceptedAt),
    requiresAcceptance: !row?.acceptedAt,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    acceptedAt: row?.acceptedAt ? new Date(row.acceptedAt).toISOString() : null,
  };
}

export async function requireCurrentRequiredConsent(
  userId: string,
): Promise<RequiredConsentState> {
  const state = await getRequiredConsentState(userId);
  if (!state.accepted) {
    throw new AccountLifecycleError(
      "required_consent_missing",
      "The current required terms and privacy policy have not been accepted.",
    );
  }
  return state;
}

export async function acceptRequiredConsents(input: {
  userId: string;
  termsVersion: string;
  privacyVersion: string;
}): Promise<RequiredConsentState> {
  if (
    input.termsVersion !== CURRENT_TERMS_VERSION
    || input.privacyVersion !== CURRENT_PRIVACY_VERSION
  ) {
    throw new AccountLifecycleError(
      "required_consent_version_mismatch",
      "Consent versions do not match the current required versions.",
    );
  }
  await ensureAccountLifecycleSchema();
  const acceptedAt = Date.now();
  await (await getAccountD1())
    .prepare(`INSERT INTO user_required_consents
      (user_id, terms_version, privacy_version, accepted_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, terms_version, privacy_version) DO UPDATE SET
        accepted_at = excluded.accepted_at`)
    .bind(input.userId, input.termsVersion, input.privacyVersion, acceptedAt)
    .run();
  return {
    accepted: true,
    requiresAcceptance: false,
    termsVersion: input.termsVersion,
    privacyVersion: input.privacyVersion,
    acceptedAt: new Date(acceptedAt).toISOString(),
  };
}

async function existingTables(
  db: D1Database,
  names: readonly string[],
): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  const placeholders = names.map(() => "?").join(", ");
  const rows = await db
    .prepare(`SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (${placeholders})`)
    .bind(...names)
    .all<{ name: string }>();
  return new Set(rows.results.map((row) => row.name));
}

export async function getAccountDataInventory(
  userId: string,
): Promise<AccountDataInventory> {
  await ensureAccountLifecycleSchema();
  const db = await getAccountD1();
  const present = await existingTables(
    db,
    INVENTORY_TABLES.map((item) => item.table),
  );
  const inventory: AccountDataInventory = {
    accountIdentity: 1,
    displayProfiles: 0,
    opportunityProfiles: 0,
    financeSnapshots: 0,
    aiChatEvents: 0,
    aiMemories: 0,
    aiContextPreferences: 0,
    aiConversationContexts: 0,
    recentActivities: 0,
    categoryReadMarkers: 0,
    activeSessions: 0,
    consentRecords: 0,
    serviceUsageCounters: 0,
  };
  await Promise.all(INVENTORY_TABLES.map(async ({ key, table, column }) => {
    if (!present.has(table)) return;
    const row = await db
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`)
      .bind(userId)
      .first<{ count: number }>();
    inventory[key] += Number(row?.count) || 0;
  }));
  return inventory;
}

async function assertNoServiceOwnership(db: D1Database, userId: string) {
  const present = await existingTables(
    db,
    SERVICE_OWNERSHIP_TABLES.map((item) => item.table),
  );
  for (const { table, column } of SERVICE_OWNERSHIP_TABLES) {
    if (!present.has(table)) continue;
    const row = await db
      .prepare(`SELECT 1 AS found FROM ${table} WHERE ${column} = ? LIMIT 1`)
      .bind(userId)
      .first<{ found: number }>();
    if (row?.found) {
      throw new AccountLifecycleError(
        "account_service_ownership_conflict",
        "Service administration ownership must be transferred before deletion.",
      );
    }
  }
}

export async function deleteAccountAndUserData(userId: string): Promise<void> {
  await ensureAccountLifecycleSchema();
  const db = await getAccountD1();
  await assertNoServiceOwnership(db, userId);
  const present = await existingTables(db, ACCOUNT_DELETE_TABLES);
  const statements = ACCOUNT_DELETE_TABLES
    .filter((table) => present.has(table))
    .map((table) => db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(userId));
  statements.push(db.prepare("DELETE FROM oauth_users WHERE id = ?").bind(userId));
  const results = await db.batch(statements);
  const userDelete = results.at(-1);
  if (Number(userDelete?.meta.changes) !== 1) {
    throw new AccountLifecycleError("account_not_found", "Account could not be deleted.");
  }
}
