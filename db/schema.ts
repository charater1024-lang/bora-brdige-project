import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const oauthUsers = sqliteTable(
  "oauth_users",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    emailVerified: integer("email_verified", { mode: "boolean" }),
    profileImageUrl: text("profile_image_url"),
    gender: text("gender"),
    birthday: text("birthday"),
    birthYear: text("birth_year"),
    ageRange: text("age_range"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("oauth_users_provider_subject_uidx").on(
      table.provider,
      table.providerSubject,
    ),
    index("oauth_users_provider_idx").on(table.provider),
  ],
);

export const oauthTransactions = sqliteTable(
  "oauth_transactions",
  {
    stateHash: text("state_hash").primaryKey(),
    provider: text("provider").notNull(),
    codeVerifier: text("code_verifier").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    returnTo: text("return_to").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
  },
  (table) => [
    index("oauth_transactions_expires_at_idx").on(table.expiresAt),
    index("oauth_transactions_consumed_at_idx")
      .on(table.consumedAt).where(sql`${table.consumedAt} IS NOT NULL`),
  ],
);

export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => oauthUsers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [
    index("auth_sessions_user_id_idx").on(table.userId),
    index("auth_sessions_expires_at_idx").on(table.expiresAt),
  ],
);

export const userProfiles = sqliteTable("user_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => oauthUsers.id, { onDelete: "cascade" }),
  providerName: text("provider_name"),
  providerNickname: text("provider_nickname"),
  displayNameMode: text("display_name_mode").notNull().default("nickname"),
  boraAlias: text("bora_alias"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const youthPolicyProfiles = sqliteTable("youth_policy_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => oauthUsers.id, { onDelete: "cascade" }),
  profileJson: text("profile_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const userFinanceSnapshots = sqliteTable(
  "user_finance_snapshots",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => oauthUsers.id, { onDelete: "cascade" }),
    schemaVersion: integer("schema_version").notNull().default(1),
    snapshotJson: text("snapshot_json").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("user_finance_snapshots_updated_at_idx").on(table.updatedAt),
    check(
      "user_finance_snapshots_version_check",
      sql`${table.schemaVersion} = 1`,
    ),
    check(
      "user_finance_snapshots_payload_size_check",
      sql`length(${table.snapshotJson}) <= 2048`,
    ),
  ],
);

export const userRequiredConsents = sqliteTable(
  "user_required_consents",
  {
    userId: text("user_id")
      .notNull()
      .references(() => oauthUsers.id, { onDelete: "cascade" }),
    termsVersion: text("terms_version").notNull(),
    privacyVersion: text("privacy_version").notNull(),
    acceptedAt: integer("accepted_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "user_required_consents_pk",
      columns: [table.userId, table.termsVersion, table.privacyVersion],
    }),
    index("user_required_consents_user_accepted_idx").on(
      table.userId,
      table.acceptedAt,
    ),
  ],
);

export const developerAdmins = sqliteTable(
  "developer_admins",
  {
    slot: integer("slot").primaryKey(),
    userId: text("user_id").notNull().references(() => oauthUsers.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("developer_admins_user_id_uidx").on(table.userId)],
);

export const serviceApiCredentials = sqliteTable(
  "service_api_credentials",
  {
    keyName: text("key_name").primaryKey(),
    encryptedValue: text("encrypted_value").notNull(),
    iv: text("iv").notNull(),
    maskedSuffix: text("masked_suffix").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull().references(() => oauthUsers.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("service_api_credentials_updated_by_idx").on(table.updatedByUserId)],
);

export const aiProviderSettings = sqliteTable(
  "ai_provider_settings",
  {
    provider: text("provider").primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    modelId: text("model_id").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull().references(() => oauthUsers.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("ai_provider_settings_updated_by_idx").on(table.updatedByUserId)],
);

export const serviceApiSettings = sqliteTable(
  "service_api_settings",
  {
    keyName: text("key_name").primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    updatedByUserId: text("updated_by_user_id").notNull().references(() => oauthUsers.id, { onDelete: "restrict" }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("service_api_settings_updated_by_idx").on(table.updatedByUserId)],
);

export const aiChatEvents = sqliteTable(
  "ai_chat_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => oauthUsers.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    sourceCount: integer("source_count").notNull().default(0),
    locale: text("locale").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("ai_chat_events_user_created_idx").on(table.userId, table.createdAt),
    index("ai_chat_events_user_topic_idx").on(table.userId, table.topic),
  ],
);

export const aiUserMemories = sqliteTable(
  "ai_user_memories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => oauthUsers.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    summary: text("summary").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("ai_user_memories_user_updated_idx").on(table.userId, table.updatedAt),
  ],
);

export const userAiContextPreferences = sqliteTable(
  "user_ai_context_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => oauthUsers.id, { onDelete: "cascade" }),
    memoryEnabled: integer("memory_enabled", { mode: "boolean" }).notNull().default(false),
    conversationContextEnabled: integer("conversation_context_enabled", { mode: "boolean" }).notNull().default(false),
    recentActivityEnabled: integer("recent_activity_enabled", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    check("user_ai_context_preferences_memory_check", sql`${table.memoryEnabled} IN (0, 1)`),
    check("user_ai_context_preferences_conversation_check", sql`${table.conversationContextEnabled} IN (0, 1)`),
    check("user_ai_context_preferences_activity_check", sql`${table.recentActivityEnabled} IN (0, 1)`),
  ],
);

export const userRecentActivities = sqliteTable(
  "user_recent_activities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => oauthUsers.id, { onDelete: "cascade" }),
    activityType: text("activity_type").notNull(),
    targetCode: text("target_code").notNull(),
    referenceId: text("reference_id").notNull().default(""),
    occurredAt: integer("occurred_at").notNull(),
  },
  (table) => [
    uniqueIndex("user_recent_activities_user_target_uidx")
      .on(table.userId, table.activityType, table.targetCode, table.referenceId),
    index("user_recent_activities_user_time_idx").on(table.userId, table.occurredAt),
    index("user_recent_activities_time_idx").on(table.occurredAt),
    check("user_recent_activities_type_check", sql`${table.activityType} IN ('menu', 'information', 'exchange')`),
  ],
);

export const aiConversationContexts = sqliteTable(
  "ai_conversation_contexts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => oauthUsers.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    userExcerpt: text("user_excerpt").notNull(),
    assistantExcerpt: text("assistant_excerpt").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("ai_conversation_contexts_user_time_idx").on(table.userId, table.createdAt),
    index("ai_conversation_contexts_time_idx").on(table.createdAt),
  ],
);

export const aiUserRateLimits = sqliteTable("ai_user_rate_limits", {
  userId: text("user_id")
    .primaryKey()
    .references(() => oauthUsers.id, { onDelete: "cascade" }),
  windowStartedAt: integer("window_started_at").notNull(),
  requestCount: integer("request_count").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const phishingReputationLookupQuotas = sqliteTable(
  "phishing_reputation_lookup_quotas",
  {
    subjectHash: text("subject_hash").primaryKey(),
    windowStartedAt: integer("window_started_at").notNull(),
    requestCount: integer("request_count").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("phishing_reputation_lookup_quotas_updated_idx").on(table.updatedAt),
    check(
      "phishing_reputation_lookup_quotas_subject_check",
      sql`length(${table.subjectHash}) = 64`,
    ),
    check(
      "phishing_reputation_lookup_quotas_count_check",
      sql`${table.requestCount} >= 0`,
    ),
  ],
);

export const publicDataSnapshots = sqliteTable("public_data_snapshots", {
  cacheKey: text("cache_key").primaryKey(),
  payload: text("payload").notNull().default("{}"),
  status: text("status").notNull().default("empty"),
  itemCount: integer("item_count").notNull().default(0),
  lastSuccessfulAt: integer("last_successful_at"),
  nextRefreshAt: integer("next_refresh_at").notNull().default(0),
  lastAttemptAt: integer("last_attempt_at").notNull().default(0),
  lockUntil: integer("lock_until").notNull().default(0),
  lastError: text("last_error"),
  updatedAt: integer("updated_at").notNull(),
});

export const publicYouthPolicyCatalogChunks = sqliteTable(
  "public_youth_policy_catalog_chunks",
  {
    catalogKey: text("catalog_key").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    payload: text("payload").notNull(),
    itemCount: integer("item_count").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "public_youth_policy_catalog_chunks_pk",
      columns: [table.catalogKey, table.chunkIndex],
    }),
  ],
);

export const publicDataCatalogChunks = sqliteTable(
  "public_data_catalog_chunks",
  {
    sourceId: text("source_id").notNull(),
    category: text("category").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    payload: text("payload").notNull(),
    itemCount: integer("item_count").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "public_data_catalog_chunks_pk",
      columns: [table.sourceId, table.category, table.chunkIndex],
    }),
    index("public_data_catalog_chunks_category_idx")
      .on(table.category, table.sourceId, table.chunkIndex),
    index("public_data_catalog_chunks_page_order_idx")
      .on(table.category, table.chunkIndex, table.sourceId),
  ],
);

export const publicDataUserReads = sqliteTable(
  "public_data_user_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => oauthUsers.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    seenAt: integer("seen_at").notNull(),
  },
  (table) => [
    uniqueIndex("public_data_user_reads_user_category_uidx").on(table.userId, table.category),
    index("public_data_user_reads_seen_idx").on(table.userId, table.seenAt),
  ],
);

export const publicApiSourceState = sqliteTable(
  "public_api_source_state",
  {
    sourceId: text("source_id").primaryKey(),
    quotaDay: text("quota_day").notNull().default(""),
    usedCalls: integer("used_calls").notNull().default(0),
    reservedCalls: integer("reserved_calls").notNull().default(0),
    dailyLimit: integer("daily_limit").notNull().default(0),
    quotaVerified: integer("quota_verified", { mode: "boolean" }).notNull().default(false),
    nextDueAt: integer("next_due_at").notNull().default(0),
    lastSuccessAt: integer("last_success_at"),
    lastAttemptAt: integer("last_attempt_at").notNull().default(0),
    backoffUntil: integer("backoff_until").notNull().default(0),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastError: text("last_error"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("public_api_source_state_due_idx").on(table.nextDueAt, table.backoffUntil),
  ],
);

export const publicApiInteractiveReservations = sqliteTable(
  "public_api_interactive_reservations",
  {
    reservationToken: text("reservation_token").primaryKey(),
    sourceId: text("source_id").notNull(),
    quotaDay: text("quota_day").notNull(),
    reservedCalls: integer("reserved_calls").notNull(),
    attemptAt: integer("attempt_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("public_api_interactive_reservations_source_idx")
      .on(table.sourceId, table.quotaDay, table.createdAt),
    check(
      "public_api_interactive_reservations_calls_check",
      sql`${table.reservedCalls} > 0`,
    ),
  ],
);

export const commercialSearchCache = sqliteTable(
  "commercial_search_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    payload: text("payload").notNull(),
    expiresAt: integer("expires_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("commercial_search_cache_expiry_idx").on(table.expiresAt),
  ],
);

export const commercialSearchRateLimits = sqliteTable(
  "commercial_search_rate_limits",
  {
    userId: text("user_id")
      .notNull()
      .references(() => oauthUsers.id, { onDelete: "cascade" }),
    windowStart: integer("window_start").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "commercial_search_rate_limits_pk",
      columns: [table.userId, table.windowStart],
    }),
    index("commercial_search_rate_limits_window_idx").on(table.windowStart),
    check(
      "commercial_search_rate_limits_count_check",
      sql`${table.requestCount} >= 0`,
    ),
  ],
);

export const publicApiBackfillCheckpoints = sqliteTable(
  "public_api_backfill_checkpoints",
  {
    sourceId: text("source_id").primaryKey(),
    querySignature: text("query_signature").notNull(),
    queryState: text("query_state").notNull().default("{}"),
    nextPage: integer("next_page").notNull().default(1),
    pageSize: integer("page_size").notNull(),
    providerTotalCount: integer("provider_total_count"),
    fetchedCount: integer("fetched_count").notNull().default(0),
    completed: integer("completed", { mode: "boolean" }).notNull().default(false),
    latestRefreshAt: integer("latest_refresh_at"),
    completedAt: integer("completed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("public_api_backfill_checkpoint_status_idx")
      .on(table.completed, table.updatedAt),
    check(
      "public_api_backfill_checkpoint_page_check",
      sql`${table.nextPage} >= 1 AND ${table.pageSize} >= 1 AND ${table.fetchedCount} >= 0`,
    ),
  ],
);

export const publicApiBackfillPages = sqliteTable(
  "public_api_backfill_pages",
  {
    sourceId: text("source_id").notNull(),
    querySignature: text("query_signature").notNull(),
    pageNumber: integer("page_number").notNull(),
    payload: text("payload").notNull(),
    itemCount: integer("item_count").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "public_api_backfill_pages_pk",
      columns: [table.sourceId, table.querySignature, table.pageNumber],
    }),
    check(
      "public_api_backfill_pages_values_check",
      sql`${table.pageNumber} >= 0 AND ${table.itemCount} >= 0`,
    ),
  ],
);

export const exchangeRatePoints = sqliteTable(
  "exchange_rate_points",
  {
    sourceId: text("source_id").notNull(),
    currency: text("currency").notNull(),
    baseCurrency: text("base_currency").notNull(),
    effectiveDate: text("effective_date").notNull(),
    baseRate: real("base_rate").notNull(),
    quotedUnit: integer("quoted_unit").notNull(),
    quotedRate: real("quoted_rate").notNull(),
    capturedAt: integer("captured_at").notNull(),
  },
  (table) => [
    primaryKey({
      name: "exchange_rate_points_pk",
      columns: [table.sourceId, table.currency, table.effectiveDate],
    }),
    index("exchange_rate_points_currency_date_idx").on(
      table.currency,
      table.effectiveDate,
    ),
  ],
);

export const exchangeHistoryBackfillCheckpoint = sqliteTable(
  "exchange_history_backfill_checkpoint",
  {
    sourceId: text("source_id").primaryKey(),
    historicalCursorDate: text("historical_cursor_date"),
    historicalFloorDate: text("historical_floor_date").notNull(),
    gapCursorDate: text("gap_cursor_date"),
    gapFloorDate: text("gap_floor_date"),
    latestObservedDate: text("latest_observed_date").notNull(),
    completedAt: integer("completed_at"),
    lastAttemptAt: integer("last_attempt_at"),
    lastError: text("last_error"),
    updatedAt: integer("updated_at").notNull(),
  },
);

export const publicItemAnalysisCache = sqliteTable(
  "public_item_analysis_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    generation: integer("generation").notNull().default(1),
    itemId: text("item_id").notNull(),
    category: text("category").notNull(),
    locale: text("locale").notNull(),
    provider: text("provider").notNull(),
    configuredModel: text("configured_model").notNull(),
    responseModel: text("response_model"),
    promptVersion: text("prompt_version").notNull(),
    contentHash: text("content_hash").notNull(),
    explanation: text("explanation").notNull().default(""),
    sourceName: text("source_name").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceExpiresAt: text("source_expires_at"),
    status: text("status").notNull().default("generating"),
    lockToken: text("lock_token"),
    lockUntil: integer("lock_until").notNull().default(0),
    errorCode: text("error_code"),
    hitCount: integer("hit_count").notNull().default(0),
    generatedAt: integer("generated_at"),
    lastAccessedAt: integer("last_accessed_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("public_item_analysis_cache_runtime_idx").on(
      table.generation,
      table.provider,
      table.configuredModel,
      table.status,
    ),
    index("public_item_analysis_cache_cleanup_idx").on(
      table.generation,
      table.lastAccessedAt,
    ),
  ],
);

export const publicItemAnalysisCacheMeta = sqliteTable("public_item_analysis_cache_meta", {
  slot: integer("slot").primaryKey(),
  generation: integer("generation").notNull().default(1),
  lastClearedAt: integer("last_cleared_at"),
  lastClearedByUserId: text("last_cleared_by_user_id")
    .references(() => oauthUsers.id, { onDelete: "set null" }),
});

export const financialLawSummaryCache = sqliteTable(
  "financial_law_summary_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    topic: text("topic").notNull(),
    locale: text("locale").notNull(),
    provider: text("provider").notNull(),
    configuredModel: text("configured_model").notNull(),
    responseModel: text("response_model"),
    promptVersion: text("prompt_version").notNull(),
    sourceFingerprint: text("source_fingerprint").notNull(),
    lawName: text("law_name").notNull(),
    lawId: text("law_id").notNull(),
    lawVersion: text("law_version").notNull(),
    sourceUrl: text("source_url").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status").notNull().default("generating"),
    lockToken: text("lock_token"),
    lockUntil: integer("lock_until").notNull().default(0),
    errorCode: text("error_code"),
    hitCount: integer("hit_count").notNull().default(0),
    generatedAt: integer("generated_at"),
    lastAccessedAt: integer("last_accessed_at").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("financial_law_summary_runtime_idx").on(
      table.provider,
      table.configuredModel,
      table.locale,
      table.status,
    ),
    index("financial_law_summary_source_idx").on(
      table.topic,
      table.sourceFingerprint,
      table.status,
    ),
  ],
);

export const judgeEvaluationSessions = sqliteTable(
  "judge_evaluation_sessions",
  {
    id: text("id").primaryKey(),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => oauthUsers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    rubricVersion: text("rubric_version").notNull(),
    datasetId: text("dataset_id").notNull(),
    datasetHash: text("dataset_hash").notNull(),
    sessionJson: text("session_json").notNull(),
    totalScore: integer("total_score").notNull().default(0),
    gateStatus: text("gate_status").notNull().default("review"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    sealedAt: integer("sealed_at"),
  },
  (table) => [
    index("judge_evaluation_sessions_creator_updated_idx").on(
      table.createdByUserId,
      table.updatedAt,
    ),
    index("judge_evaluation_sessions_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
    check(
      "judge_evaluation_sessions_status_check",
      sql`${table.status} IN ('draft', 'review', 'sealed')`,
    ),
    check(
      "judge_evaluation_sessions_score_check",
      sql`${table.totalScore} >= 0 AND ${table.totalScore} <= 100`,
    ),
    check(
      "judge_evaluation_sessions_gate_check",
      sql`${table.gateStatus} IN ('review', 'pass', 'fail')`,
    ),
    check(
      "judge_evaluation_sessions_title_size_check",
      sql`length(${table.title}) BETWEEN 1 AND 80`,
    ),
    check(
      "judge_evaluation_sessions_payload_size_check",
      sql`length(${table.sessionJson}) <= 131072`,
    ),
  ],
);
