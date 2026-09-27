export const SERVICE_API_KEYS = [
  { key: "KOREA_EXIM_API_KEY", label: "한국수출입은행 환율", category: "금융 공공데이터", description: "홈 환율과 원화 환산", billingRisk: false },
  { key: "BOK_ECOS_API_KEY", label: "한국은행 ECOS", category: "금융 공공데이터", description: "기준금리·물가·금융 시계열", billingRisk: false },
  { key: "FINLIFE_API_KEY", label: "금융상품 한눈에", category: "금융 공공데이터", description: "예금·적금·대출·연금 비교", billingRisk: false },
  { key: "DATA_GO_KR_API_KEY", label: "공공데이터포털", category: "금융 공공데이터", description: "금융·장학·상권·기업마당·K-Startup API 공용키", billingRisk: false },
  { key: "DART_API_KEY", label: "OpenDART", category: "금융 공공데이터", description: "기업 공시와 재무정보", billingRisk: false },
  { key: "BIZINFO_API_KEY", label: "기업마당", category: "정책·창업", description: "창업·중소기업 지원사업", billingRisk: false },
  { key: "YOUTH_CENTER_API_KEY", label: "온통청년", category: "정책·창업", description: "서버에서만 호출하는 청년정책 정보", billingRisk: false },
  { key: "WORK24_API_KEY", label: "고용24", category: "정책·창업", description: "기업회원·서비스 승인이 필요한 Open API · 개인회원은 OFF 유지", billingRisk: false },
  { key: "SEOUL_OPEN_DATA_API_KEY", label: "서울 상권 공식 파일", category: "정책·창업", description: "API 키 없이 서울시 공식 HTTPS 전체 CSV를 서버에서 수집", billingRisk: false },
  { key: "LAW_OPEN_API_KEY", label: "국가법령정보", category: "포용·안전", description: "공동활용 OC 인증값 · 현행 금융 법령 근거", billingRisk: false },
  { key: "KOSIS_API_KEY", label: "KOSIS", category: "포용·안전", description: "청년·고령층·외국인 통계", billingRisk: false },
  { key: "GOOGLE_SAFE_BROWSING_API_KEY", label: "Google Safe Browsing", category: "포용·안전", description: "피싱·악성 URL 교차검사(비상업적 용도 한정)", billingRisk: false },
  { key: "OPENAI_API_KEY", label: "OpenAI", category: "과금형 AI 모델", description: "GPT 기반 금융 도우미", billingRisk: true },
  { key: "GEMINI_API_KEY", label: "Gemini", category: "과금형 AI 모델", description: "Gemini 기반 금융 도우미", billingRisk: true },
  { key: "CLAUDE_API_KEY", label: "Claude", category: "과금형 AI 모델", description: "Claude 기반 금융 도우미", billingRisk: true },
  { key: "LOCAL_LLM_API_KEY", label: "Local LLM", category: "로컬 AI", description: "직접 운영하는 로컬 호환 서버", billingRisk: false },
] as const;

export type ServiceApiKeyName = (typeof SERVICE_API_KEYS)[number]["key"];

const RUNTIME_INTEGRATED_SERVICE_KEYS = new Set<ServiceApiKeyName>([
  "KOREA_EXIM_API_KEY",
  "BOK_ECOS_API_KEY",
  "FINLIFE_API_KEY",
  "DATA_GO_KR_API_KEY",
  "DART_API_KEY",
  "BIZINFO_API_KEY",
  "YOUTH_CENTER_API_KEY",
  "WORK24_API_KEY",
  "SEOUL_OPEN_DATA_API_KEY",
  "LAW_OPEN_API_KEY",
  "KOSIS_API_KEY",
  "GOOGLE_SAFE_BROWSING_API_KEY",
]);

const SERVICE_INTEGRATION_SURFACES: Partial<Record<ServiceApiKeyName, string>> = {
  KOREA_EXIM_API_KEY: "공식 금융·정책 정보 · 환율",
  BOK_ECOS_API_KEY: "공식 금융·정책 정보 · 경제지표",
  FINLIFE_API_KEY: "공식 금융·정책 정보 · 예금·적금",
  DATA_GO_KR_API_KEY: "공식 금융·정책 정보 · 금융·청년·상권",
  DART_API_KEY: "공식 금융·정책 정보 · 기업공시",
  BIZINFO_API_KEY: "공식 금융·정책 정보 · 창업지원",
  YOUTH_CENTER_API_KEY: "청년 정책 정보 · 서버 전용 보안 호출",
  WORK24_API_KEY: "기업회원 승인 시 최근 1개월 공식 채용공고 · 미승인 키는 주 1회 이하 재확인",
  SEOUL_OPEN_DATA_API_KEY: "창업·상권 정보 · 서울시 공식 HTTPS 전체 CSV 수집",
  LAW_OPEN_API_KEY: "안심 서비스 · 국가법령정보 현행 금융 법령·조문 근거",
  KOSIS_API_KEY: "대상별 취업 통계 · 청년·고령층·외국인 KOSIS 공식 지표",
  GOOGLE_SAFE_BROWSING_API_KEY: "피싱 검사 · 의심 URL 확인",
};

export const AI_MODEL_PROVIDERS = [
  {
    id: "openai",
    keyName: "OPENAI_API_KEY",
    label: "OpenAI",
    billingRisk: true,
    defaultModel: "gpt-5.6-terra",
    models: [
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", hint: "비용 절약" },
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", hint: "균형형" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", hint: "최고 성능" },
    ],
  },
  {
    id: "gemini",
    keyName: "GEMINI_API_KEY",
    label: "Gemini",
    billingRisk: true,
    defaultModel: "gemini-3.5-flash-lite",
    models: [
      { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", hint: "최저 비용" },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", hint: "균형형" },
      { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", hint: "고성능" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", hint: "미리보기" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "안정형" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", hint: "저비용 안정형" },
    ],
  },
  {
    id: "claude",
    keyName: "CLAUDE_API_KEY",
    label: "Claude",
    billingRisk: true,
    defaultModel: "claude-haiku-4-5-20251001",
    models: [
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "최저 비용" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", hint: "균형형" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8", hint: "고성능" },
      { id: "claude-fable-5", label: "Claude Fable 5", hint: "최고 성능" },
    ],
  },
  {
    id: "local",
    keyName: "LOCAL_LLM_API_KEY",
    label: "Local AI",
    billingRisk: false,
    defaultModel: "exaone4.0:1.2b-q4",
    models: [
      { id: "exaone4.0:1.2b-q4", label: "EXAONE 4.0 1.2B Q4", hint: "GTX 1650 추천 · 한/영" },
      { id: "exaone3.5:2.4b", label: "EXAONE 3.5 2.4B Q4", hint: "한국어 품질 우선 · 4GB" },
      { id: "qwen2.5:1.5b", label: "Qwen 2.5 1.5B Q4", hint: "한/영 경량 대안" },
      { id: "gemma3:1b", label: "Gemma 3 1B Q4", hint: "초경량 테스트" },
    ],
  },
] as const;

export type AiModelProviderId = (typeof AI_MODEL_PROVIDERS)[number]["id"];

type StoredCredentialRow = {
  keyName: string;
  encryptedValue: string;
  iv: string;
  maskedSuffix: string;
  updatedAt: number;
};

type StoredAiProviderSettingRow = {
  provider: string;
  enabled: number;
  modelId: string;
  updatedAt: number;
};

type StoredServiceApiSettingRow = {
  keyName: string;
  enabled: number;
  updatedAt: number;
};

type StoredRuntimeServiceSecretRow = {
  keyName: string;
  enabled: number;
  encryptedValue: string | null;
  iv: string | null;
  maskedSuffix: string | null;
  updatedAt: number | null;
};

let schemaReady: Promise<void> | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function isAllowedKey(value: string): value is ServiceApiKeyName {
  return SERVICE_API_KEYS.some((item) => item.key === value);
}

function aiProviderDefinition(value: string) {
  return AI_MODEL_PROVIDERS.find((provider) => provider.id === value);
}

function aiProviderForKey(keyName: ServiceApiKeyName) {
  return AI_MODEL_PROVIDERS.find((provider) => provider.keyName === keyName);
}

function isManagedServiceKey(keyName: ServiceApiKeyName) {
  return !aiProviderForKey(keyName);
}

function isRuntimeIntegratedServiceKey(keyName: ServiceApiKeyName) {
  return RUNTIME_INTEGRATED_SERVICE_KEYS.has(keyName);
}

const ACTIVATION_ONLY_SERVICE_KEYS = new Set<ServiceApiKeyName>([
  "SEOUL_OPEN_DATA_API_KEY",
]);

// This marker is an internal on/off signal, not a credential. It is consumed
// only by adapters that never place the value in an outbound request.
const ACTIVATION_ONLY_RUNTIME_SENTINEL = "__bora_activation_only_enabled__";

function isActivationOnlyServiceKey(keyName: ServiceApiKeyName) {
  return ACTIVATION_ONLY_SERVICE_KEYS.has(keyName);
}

export async function environmentValue(name: string): Promise<string | null> {
  const processValue = process.env[name];
  if (typeof processValue === "string" && processValue.trim()) return processValue.trim();

  try {
    const { env } = await import("cloudflare:workers");
    const workerValue = (env as unknown as Record<string, unknown>)[name];
    return typeof workerValue === "string" && workerValue.trim() ? workerValue.trim() : null;
  } catch {
    return null;
  }
}

export async function billableApisDisabled() {
  const configured = (await environmentValue("DISABLE_BILLABLE_APIS"))?.toLowerCase();
  return !configured || !["0", "false", "no", "off"].includes(configured);
}

async function ensureSettingsSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const db = await getSettingsD1();
    const existing = await db.prepare(`SELECT COUNT(*) AS tableCount FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'service_api_credentials', 'ai_provider_settings', 'service_api_settings'
      )`).first<{ tableCount: number }>();
    if (Number(existing?.tableCount) === 3) return;
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS service_api_credentials (
        key_name TEXT PRIMARY KEY NOT NULL,
        encrypted_value TEXT NOT NULL,
        iv TEXT NOT NULL,
        masked_suffix TEXT NOT NULL,
        updated_by_user_id TEXT NOT NULL REFERENCES oauth_users(id) ON DELETE RESTRICT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS service_api_credentials_updated_by_idx ON service_api_credentials (updated_by_user_id)",
      ),
      db.prepare(`CREATE TABLE IF NOT EXISTS ai_provider_settings (
        provider TEXT PRIMARY KEY NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        model_id TEXT NOT NULL,
        updated_by_user_id TEXT NOT NULL REFERENCES oauth_users(id) ON DELETE RESTRICT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS ai_provider_settings_updated_by_idx ON ai_provider_settings (updated_by_user_id)",
      ),
      db.prepare(`CREATE TABLE IF NOT EXISTS service_api_settings (
        key_name TEXT PRIMARY KEY NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        updated_by_user_id TEXT NOT NULL REFERENCES oauth_users(id) ON DELETE RESTRICT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`),
      db.prepare(
        "CREATE INDEX IF NOT EXISTS service_api_settings_updated_by_idx ON service_api_settings (updated_by_user_id)",
      ),
    ]);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey() {
  const secret = await environmentValue("DEVELOPER_SETTINGS_ENCRYPTION_KEY");
  if (!secret || secret.length < 32) return null;
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encrypt(keyName: ServiceApiKeyName, value: string) {
  const key = await encryptionKey();
  if (!key) throw new Error("settings_encryption_unavailable");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(keyName) },
    key,
    encoder.encode(value),
  );
  return { encryptedValue: base64(new Uint8Array(ciphertext)), iv: base64(iv) };
}

async function decryptWithKey(row: StoredCredentialRow, key: CryptoKey) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(row.iv), additionalData: encoder.encode(row.keyName) },
    key,
    fromBase64(row.encryptedValue),
  );
  return decoder.decode(plaintext);
}

async function decrypt(row: StoredCredentialRow) {
  const key = await encryptionKey();
  if (!key) throw new Error("settings_encryption_unavailable");
  return decryptWithKey(row, key);
}

async function storedCredential(keyName: ServiceApiKeyName) {
  await ensureSettingsSchema();
  return (await getSettingsD1())
    .prepare(`SELECT key_name AS keyName, encrypted_value AS encryptedValue, iv,
      masked_suffix AS maskedSuffix, updated_at AS updatedAt
      FROM service_api_credentials WHERE key_name = ?`)
    .bind(keyName)
    .first<StoredCredentialRow>();
}

async function storedAiProviderSetting(provider: AiModelProviderId) {
  await ensureSettingsSchema();
  return (await getSettingsD1())
    .prepare(`SELECT provider, enabled, model_id AS modelId, updated_at AS updatedAt
      FROM ai_provider_settings WHERE provider = ?`)
    .bind(provider)
    .first<StoredAiProviderSettingRow>();
}

async function storedServiceApiSetting(keyName: ServiceApiKeyName) {
  await ensureSettingsSchema();
  return (await getSettingsD1())
    .prepare(`SELECT key_name AS keyName, enabled, updated_at AS updatedAt
      FROM service_api_settings WHERE key_name = ?`)
    .bind(keyName)
    .first<StoredServiceApiSettingRow>();
}

async function credentialRuntimeState(
  keyName: ServiceApiKeyName,
  knownStored?: StoredCredentialRow | null,
) {
  const stored = knownStored === undefined ? await storedCredential(keyName) : knownStored;
  const environmentConfigured = Boolean(await environmentValue(keyName));
  let storedReadable = false;
  if (stored) {
    try {
      storedReadable = Boolean((await decrypt(stored)).trim());
    } catch {
      // A rotated/missing encryption key must not make an encrypted row look
      // usable. An independently configured environment value may still be
      // used as runtime fallback without exposing either credential.
      storedReadable = false;
    }
  }
  const runtimeSource = storedReadable
    ? "developer" as const
    : environmentConfigured
      ? "environment" as const
      : "none" as const;
  return {
    storedConfigured: Boolean(stored),
    environmentConfigured,
    configured: Boolean(stored || environmentConfigured),
    storedReadable: stored ? storedReadable : null,
    runtimeUsable: runtimeSource !== "none",
    runtimeSource,
    runtimeIssue: stored && !storedReadable ? "stored_credential_unreadable" as const : null,
  };
}

async function aiProviderEnabled(keyName: ServiceApiKeyName) {
  const provider = aiProviderForKey(keyName);
  if (!provider || (provider.billingRisk && await billableApisDisabled())) return false;
  if (provider.billingRisk && !(await credentialRuntimeState(keyName)).runtimeUsable) return false;
  try {
    await ensureSettingsSchema();
    const active = await (await getSettingsD1()).prepare(`SELECT provider FROM ai_provider_settings
      WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 1`).first<{ provider: string }>();
    return active?.provider === provider.id;
  } catch {
    return false;
  }
}

export async function serviceApiEnabled(keyName: ServiceApiKeyName) {
  if (!isManagedServiceKey(keyName) || !isRuntimeIntegratedServiceKey(keyName)) return false;
  try {
    const stored = await storedServiceApiSetting(keyName);
    if (stored) return stored.enabled === 1;
  } catch {
    return false;
  }
  return false;
}

export async function runtimeSecret(keyName: ServiceApiKeyName): Promise<string | null> {
  if (aiProviderForKey(keyName) && !(await aiProviderEnabled(keyName))) return null;
  if (isManagedServiceKey(keyName) && !(await serviceApiEnabled(keyName))) return null;
  if (isActivationOnlyServiceKey(keyName)) return ACTIVATION_ONLY_RUNTIME_SENTINEL;
  try {
    const stored = await storedCredential(keyName);
    if (stored) {
      const value = await decrypt(stored);
      if (value.trim()) return value.trim();
    }
  } catch {
    // Environment values remain a safe operational fallback if D1 is not bound
    // or a stored value cannot be decrypted after a key rotation.
  }
  return environmentValue(keyName);
}

/**
 * Resolves enabled public-service credentials with one settings/credential
 * join. Environment values remain a fallback only for keys whose persisted
 * activation row is ON, matching runtimeSecret's fail-closed behavior.
 */
export async function runtimeServiceSecrets(
  keyNames: readonly ServiceApiKeyName[],
): Promise<Partial<Record<ServiceApiKeyName, string | null>>> {
  const requested = [...new Set(keyNames)].filter((keyName) => (
    isAllowedKey(keyName)
    && isManagedServiceKey(keyName)
    && isRuntimeIntegratedServiceKey(keyName)
  ));
  const resolved: Partial<Record<ServiceApiKeyName, string | null>> = Object.fromEntries(
    requested.map((keyName) => [keyName, null]),
  );
  if (!requested.length) return resolved;
  try {
    await ensureSettingsSchema();
    const placeholders = requested.map(() => "?").join(", ");
    const rows = await (await getSettingsD1()).prepare(`SELECT
      s.key_name AS keyName, s.enabled,
      c.encrypted_value AS encryptedValue, c.iv,
      c.masked_suffix AS maskedSuffix, c.updated_at AS updatedAt
      FROM service_api_settings s
      LEFT JOIN service_api_credentials c ON c.key_name = s.key_name
      WHERE s.enabled = 1 AND s.key_name IN (${placeholders})`)
      .bind(...requested)
      .all<StoredRuntimeServiceSecretRow>();
    const activeRows = (rows.results ?? []).filter((row) => (
      row.enabled === 1 && requested.includes(row.keyName as ServiceApiKeyName)
    ));
    const needsDecryption = activeRows.some((row) => (
      !isActivationOnlyServiceKey(row.keyName as ServiceApiKeyName)
      && Boolean(row.encryptedValue && row.iv)
    ));
    const key = needsDecryption ? await encryptionKey().catch(() => null) : null;
    await Promise.all(activeRows.map(async (row) => {
      const keyName = row.keyName as ServiceApiKeyName;
      if (isActivationOnlyServiceKey(keyName)) {
        resolved[keyName] = ACTIVATION_ONLY_RUNTIME_SENTINEL;
        return;
      }
      let value: string | null = null;
      if (key && row.encryptedValue && row.iv) {
        try {
          value = (await decryptWithKey({
            keyName: row.keyName,
            encryptedValue: row.encryptedValue,
            iv: row.iv,
            maskedSuffix: row.maskedSuffix ?? "",
            updatedAt: row.updatedAt ?? 0,
          }, key)).trim() || null;
        } catch {
          value = null;
        }
      }
      resolved[keyName] = value ?? await environmentValue(keyName);
    }));
  } catch {
    // Without the persisted ON rows, managed public APIs remain disabled even
    // when an environment credential exists.
  }
  return resolved;
}

export async function saveRuntimeSecret(input: {
  keyName: string;
  value: string;
  userId: string;
}) {
  if (!isAllowedKey(input.keyName)) throw new Error("unsupported_key");
  // Seoul's official HTTPS file source has no runtime credential. Ignore a
  // legacy/client-supplied value so existing encrypted rows remain untouched.
  if (isActivationOnlyServiceKey(input.keyName)) return;
  const value = input.value.trim();
  if (value.length < 4 || value.length > 8_192 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error("invalid_key_value");
  }
  await ensureSettingsSchema();
  const encrypted = await encrypt(input.keyName, value);
  const now = Date.now();
  await (await getSettingsD1()).prepare(`INSERT INTO service_api_credentials
    (key_name, encrypted_value, iv, masked_suffix, updated_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key_name) DO UPDATE SET
      encrypted_value = excluded.encrypted_value,
      iv = excluded.iv,
      masked_suffix = excluded.masked_suffix,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at`)
    .bind(input.keyName, encrypted.encryptedValue, encrypted.iv, value.slice(-4), input.userId, now, now)
    .run();
}

export async function deleteRuntimeSecret(keyName: string) {
  if (!isAllowedKey(keyName)) throw new Error("unsupported_key");
  // Do not expose or destroy a legacy Seoul key. It is no longer read by the
  // runtime and the activation-only UI intentionally offers no delete action.
  if (isActivationOnlyServiceKey(keyName)) return;
  await ensureSettingsSchema();
  await (await getSettingsD1()).prepare("DELETE FROM service_api_credentials WHERE key_name = ?").bind(keyName).run();
}

export async function saveAiProviderSetting(input: {
  provider: string;
  enabled: boolean;
  modelId: string;
  userId: string;
}) {
  const definition = aiProviderDefinition(input.provider);
  if (!definition) throw new Error("unsupported_provider");
  if (!definition.models.some((model) => model.id === input.modelId)) throw new Error("unsupported_model");
  if (input.enabled && definition.billingRisk && await billableApisDisabled()) {
    throw new Error("billable_api_globally_disabled");
  }
  if (input.enabled && definition.billingRisk) {
    const credential = await credentialRuntimeState(definition.keyName);
    if (!credential.configured) throw new Error("provider_key_required");
    if (!credential.runtimeUsable) throw new Error("provider_key_unreadable");
  }
  if (input.enabled && definition.id === "local" && !(await environmentValue("LOCAL_LLM_BASE_URL"))) {
    throw new Error("local_endpoint_required");
  }

  await ensureSettingsSchema();
  const now = Date.now();
  const database = await getSettingsD1();
  const save = database.prepare(`INSERT INTO ai_provider_settings
    (provider, enabled, model_id, updated_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(provider) DO UPDATE SET
      enabled = excluded.enabled,
      model_id = excluded.model_id,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at`)
    .bind(definition.id, input.enabled ? 1 : 0, input.modelId, input.userId, now, now);
  if (input.enabled) {
    await database.batch([
      database.prepare("UPDATE ai_provider_settings SET enabled = 0 WHERE enabled = 1"),
      save,
    ]);
  } else {
    await save.run();
  }
}

export async function saveServiceApiSetting(input: {
  keyName: string;
  enabled: boolean;
  userId: string;
}) {
  if (!isAllowedKey(input.keyName)) throw new Error("unsupported_key");
  if (!isManagedServiceKey(input.keyName)) throw new Error("unsupported_service_setting");
  if (input.enabled && !isRuntimeIntegratedServiceKey(input.keyName)) throw new Error("service_adapter_not_ready");
  if (input.enabled && !isActivationOnlyServiceKey(input.keyName)) {
    const credential = await credentialRuntimeState(input.keyName);
    if (!credential.configured) throw new Error("service_key_required");
    if (!credential.runtimeUsable) throw new Error("service_key_unreadable");
  }

  await ensureSettingsSchema();
  const now = Date.now();
  await (await getSettingsD1()).prepare(`INSERT INTO service_api_settings
    (key_name, enabled, updated_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key_name) DO UPDATE SET
      enabled = excluded.enabled,
      updated_by_user_id = excluded.updated_by_user_id,
      updated_at = excluded.updated_at`)
    .bind(input.keyName, input.enabled ? 1 : 0, input.userId, now, now)
    .run();
}

export async function saveAllServiceApiSettings(input: { enabled: boolean; userId: string }) {
  await ensureSettingsSchema();
  const definitions = SERVICE_API_KEYS.filter((definition) => isManagedServiceKey(definition.key));
  const usable = new Map(await Promise.all(definitions
    .filter((definition) => isRuntimeIntegratedServiceKey(definition.key))
    .map(async (definition) => [
      definition.key,
      isActivationOnlyServiceKey(definition.key)
        ? true
        : (await credentialRuntimeState(definition.key)).runtimeUsable,
    ] as const)));
  const now = Date.now();
  const statements = definitions.map((definition) => (awaitableDatabaseStatement(
    definition.key,
    input.enabled && isRuntimeIntegratedServiceKey(definition.key) && usable.get(definition.key) === true,
    input.userId,
    now,
  )));
  const database = await getSettingsD1();
  await database.batch(statements.map((statement) => database.prepare(statement.sql).bind(...statement.values)));
  return definitions.filter((definition) => (
    input.enabled && isRuntimeIntegratedServiceKey(definition.key) && usable.get(definition.key) === true
  )).length;
}

function awaitableDatabaseStatement(keyName: ServiceApiKeyName, enabled: boolean, userId: string, now: number) {
  return {
    sql: `INSERT INTO service_api_settings
      (key_name, enabled, updated_by_user_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key_name) DO UPDATE SET
        enabled = excluded.enabled,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = excluded.updated_at`,
    values: [keyName, enabled ? 1 : 0, userId, now, now] as const,
  };
}

export async function disableServiceApiForKey(keyName: string, userId: string) {
  if (!isAllowedKey(keyName)) throw new Error("unsupported_key");
  if (!isManagedServiceKey(keyName)) return;
  await saveServiceApiSetting({ keyName, enabled: false, userId });
}

export async function disableAiProviderForKey(keyName: string, userId: string) {
  if (!isAllowedKey(keyName)) throw new Error("unsupported_key");
  const provider = aiProviderForKey(keyName);
  if (!provider) return;
  const current = await storedAiProviderSetting(provider.id);
  await saveAiProviderSetting({
    provider: provider.id,
    enabled: false,
    modelId: current?.modelId ?? provider.defaultModel,
    userId,
  });
}

export async function runtimeAiProviderSettings() {
  await ensureSettingsSchema();
  const rows = await (await getSettingsD1()).prepare(`SELECT provider, enabled, model_id AS modelId,
    updated_at AS updatedAt FROM ai_provider_settings`).all<StoredAiProviderSettingRow>();
  const byProvider = new Map((rows.results ?? []).map((row) => [row.provider, row]));
  const billingDisabled = await billableApisDisabled();
  const active = [...(rows.results ?? [])]
    .filter((row) => row.enabled === 1 && AI_MODEL_PROVIDERS.some((provider) => provider.id === row.provider))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];

  return Promise.all(AI_MODEL_PROVIDERS.map(async (definition) => {
    const stored = byProvider.get(definition.id);
    const globallyDisabled = definition.billingRisk && billingDisabled;
    const requestedEnabled = active?.provider === definition.id;
    const localEndpointConfigured = definition.id === "local"
      ? Boolean(await environmentValue("LOCAL_LLM_BASE_URL"))
      : false;
    const credential = definition.id === "local"
      ? null
      : await credentialRuntimeState(definition.keyName);
    const configured = definition.id === "local"
      ? localEndpointConfigured
      : credential!.configured;
    const runtimeUsable = definition.id === "local"
      ? localEndpointConfigured
      : credential!.runtimeUsable;
    return {
      ...definition,
      enabled: !globallyDisabled && requestedEnabled && runtimeUsable,
      requestedEnabled,
      globallyDisabled,
      modelId: stored && definition.models.some((model) => model.id === stored.modelId)
        ? stored.modelId
        : definition.defaultModel,
      configured,
      runtimeUsable,
      storedConfigured: credential?.storedConfigured ?? false,
      environmentConfigured: credential?.environmentConfigured ?? false,
      runtimeSource: credential?.runtimeSource ?? (localEndpointConfigured ? "environment" as const : "none" as const),
      runtimeIssue: credential?.runtimeIssue ?? null,
      endpointConfigured: definition.id === "local" ? localEndpointConfigured : undefined,
      updatedAt: stored ? new Date(stored.updatedAt).toISOString() : null,
    };
  }));
}

export async function runtimeSecretStatuses() {
  await ensureSettingsSchema();
  const database = await getSettingsD1();
  const [rows, settingRows] = await Promise.all([
    database.prepare(`SELECT key_name AS keyName, encrypted_value AS encryptedValue, iv,
      masked_suffix AS maskedSuffix, updated_at AS updatedAt FROM service_api_credentials`).all<StoredCredentialRow>(),
    database.prepare(`SELECT key_name AS keyName, enabled, updated_at AS updatedAt
      FROM service_api_settings`).all<StoredServiceApiSettingRow>(),
  ]);
  const byName = new Map((rows.results ?? []).map((row) => [row.keyName, row]));
  const settingsByName = new Map((settingRows.results ?? []).map((row) => [row.keyName, row]));
  const billingDisabled = await billableApisDisabled();

  return Promise.all(SERVICE_API_KEYS.map(async (definition) => {
    const disabledByPolicy = definition.billingRisk && billingDisabled;
    const stored = byName.get(definition.key);
    const setting = settingsByName.get(definition.key);
    const credentialRequired = !isActivationOnlyServiceKey(definition.key);
    // Never decrypt, mask, expose, or otherwise depend on a legacy Seoul key.
    const credential = credentialRequired
      ? await credentialRuntimeState(definition.key, stored ?? null)
      : {
          storedConfigured: false,
          environmentConfigured: false,
          configured: true,
          storedReadable: null,
          runtimeUsable: true,
          runtimeSource: "none" as const,
          runtimeIssue: null,
        };
    const adapterReady = isRuntimeIntegratedServiceKey(definition.key);
    const activationManaged = isManagedServiceKey(definition.key) && adapterReady;
    const requestedEnabled = activationManaged ? setting?.enabled === 1 : false;
    return {
      ...definition,
      credentialRequired,
      disabledByPolicy,
      configured: credential.configured,
      storedConfigured: credential.storedConfigured,
      environmentConfigured: credential.environmentConfigured,
      runtimeUsable: credential.runtimeUsable,
      runtimeSource: credential.runtimeSource,
      runtimeIssue: credential.runtimeIssue,
      adapterReady,
      integrationSurface: SERVICE_INTEGRATION_SURFACES[definition.key] ?? "어댑터 준비 중",
      activationManaged,
      enabled: activationManaged && credential.runtimeUsable && requestedEnabled,
      requestedEnabled,
      source: credentialRequired
        ? stored
          ? "developer" as const
          : credential.environmentConfigured
            ? "environment" as const
            : "none" as const
        : "none" as const,
      masked: credentialRequired
        ? stored
          ? `••••${stored.maskedSuffix}`
          : credential.environmentConfigured
            ? "환경 변수로 설정됨"
            : null
        : null,
      updatedAt: credentialRequired
        ? stored
          ? new Date(stored.updatedAt).toISOString()
          : null
        : setting
          ? new Date(setting.updatedAt).toISOString()
          : null,
    };
  }));
}

export async function runtimeSecretStorageReady() {
  return Boolean(await encryptionKey());
}
async function getSettingsD1(): Promise<D1Database> {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) throw new Error("settings_storage_unavailable");
  return env.DB;
}
