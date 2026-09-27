import assert from "node:assert/strict";
import { after, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true, hmr: false, watch: null },
});
const { AUTH_SESSION_USER_SELECT_SQL } = await server.ssrLoadModule("/lib/auth/store.ts");

after(async () => {
  await server.close();
});

test("authenticated session lookup is valid SQL and returns its expiry", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE oauth_users (
      id TEXT PRIMARY KEY, provider TEXT, provider_subject TEXT,
      display_name TEXT, email TEXT, email_verified INTEGER,
      profile_image_url TEXT, gender TEXT, birthday TEXT, birth_year TEXT,
      age_range TEXT, created_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE user_profiles (
      user_id TEXT PRIMARY KEY, provider_name TEXT, provider_nickname TEXT,
      display_name_mode TEXT, bora_alias TEXT
    );
    CREATE TABLE youth_policy_profiles (user_id TEXT PRIMARY KEY, profile_json TEXT);
    CREATE TABLE auth_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT, expires_at INTEGER
    );
    INSERT INTO oauth_users VALUES (
      'user-1', 'kakao', 'subject-1', '보라', NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, 1, 1
    );
    INSERT INTO auth_sessions VALUES ('token-hash', 'user-1', 2000);
  `);

  const row = db.prepare(
    `${AUTH_SESSION_USER_SELECT_SQL} WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).get("token-hash", 1000);

  assert.equal(row.id, "user-1");
  assert.equal(row.sessionExpiresAt, 2000);
  db.close();
});
