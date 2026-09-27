import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";
import { createServer } from "vite";

let modulePromise;

async function lifecycleModule() {
  if (!modulePromise) {
    modulePromise = (async () => {
      const server = await createServer({
        root: fileURLToPath(new URL("..", import.meta.url)),
        configFile: false,
        appType: "custom",
        logLevel: "silent",
        server: { middlewareMode: true },
      });
      return {
        server,
        lifecycle: await server.ssrLoadModule("/lib/auth/account-lifecycle.ts"),
      };
    })();
  }
  return (await modulePromise).lifecycle;
}

after(async () => {
  if (modulePromise) await (await modulePromise).server.close();
});

test("required consent accepts only both current versioned documents", async () => {
  const {
    CURRENT_PRIVACY_VERSION,
    CURRENT_TERMS_VERSION,
    currentOAuthConsentStatePrefix,
    isCurrentOAuthConsentState,
    parseRequiredConsentAcceptance,
  } = await lifecycleModule();
  assert.deepEqual(parseRequiredConsentAcceptance({
    termsAccepted: true,
    privacyAccepted: true,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
  }), {
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
  });
  for (const invalid of [
    {},
    { termsAccepted: true, privacyAccepted: false },
    {
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: "old",
      privacyVersion: CURRENT_PRIVACY_VERSION,
    },
  ]) {
    assert.throws(() => parseRequiredConsentAcceptance(invalid), {
      code: "required_consent_incomplete",
    });
  }
  const currentState = `${currentOAuthConsentStatePrefix()}${"A".repeat(43)}`;
  assert.equal(isCurrentOAuthConsentState(currentState), true);
  assert.equal(isCurrentOAuthConsentState(`consent-v1.${"A".repeat(43)}`), false);
  assert.equal(
    isCurrentOAuthConsentState(`${currentOAuthConsentStatePrefix()}short`),
    false,
  );
});

test("current consent guard rejects an account that has not accepted the active versions", async () => {
  const lifecycle = await readFile(
    new URL("../lib/auth/account-lifecycle.ts", import.meta.url),
    "utf8",
  );
  assert.match(lifecycle, /export async function requireCurrentRequiredConsent/u);
  assert.match(lifecycle, /required_consent_missing/u);
});

test("account deletion requires the exact Korean phrase and permanent acknowledgement", async () => {
  const {
    ACCOUNT_DELETION_CONFIRMATION,
    parseAccountDeletionRequest,
  } = await lifecycleModule();
  assert.equal(ACCOUNT_DELETION_CONFIRMATION, "회원탈퇴");
  assert.deepEqual(parseAccountDeletionRequest({
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
    acknowledgePermanentDeletion: true,
  }), { confirmed: true });
  assert.throws(() => parseAccountDeletionRequest({
    confirmation: "탈퇴",
    acknowledgePermanentDeletion: true,
  }), { code: "account_deletion_confirmation_required" });
  assert.throws(() => parseAccountDeletionRequest({
    confirmation: ACCOUNT_DELETION_CONFIRMATION,
    acknowledgePermanentDeletion: false,
  }), { code: "account_deletion_confirmation_required" });
});

test("consent migration preserves version history and cascades on account deletion", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("CREATE TABLE oauth_users (id TEXT PRIMARY KEY NOT NULL)");
    database.exec("INSERT INTO oauth_users (id) VALUES ('user-1')");
    const migration = await readFile(
      new URL("../drizzle/0018_account_privacy_lifecycle.sql", import.meta.url),
      "utf8",
    );
    database.exec(migration.replaceAll("--> statement-breakpoint", ""));
    const insert = database.prepare(`INSERT INTO user_required_consents
      (user_id, terms_version, privacy_version, accepted_at) VALUES (?, ?, ?, ?)`);
    insert.run("user-1", "v1", "v1", 1);
    insert.run("user-1", "v2", "v2", 2);
    assert.throws(() => insert.run("user-1", "v2", "v2", 3), /UNIQUE constraint failed/u);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM user_required_consents").get().count,
      2,
    );
    database.exec("DELETE FROM oauth_users WHERE id = 'user-1'");
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM user_required_consents").get().count,
      0,
    );
  } finally {
    database.close();
  }
});

test("account endpoint is session-bound, same-origin, bounded and clears the session", async () => {
  const [route, lifecycle] = await Promise.all([
    readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/account-lifecycle.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /authenticatedUser\(request\)/u);
  assert.match(route, /await requireSameOrigin\(request\)/u);
  assert.match(route, /readBoundedAccountJson\(request\)/u);
  assert.match(route, /deleteAccountAndUserData\(user\.id\)/u);
  assert.match(route, /sessionCookie\(\{/u);
  assert.match(route, /maxAgeSeconds: 0/u);
  assert.doesNotMatch(route, /body\.userId|input\.userId|console\./u);
  assert.match(lifecycle, /account_service_ownership_conflict/u);
  assert.match(lifecycle, /developer_admins/u);
  assert.match(lifecycle, /service_api_credentials/u);
  assert.doesNotMatch(lifecycle, /\{ table: "judge_evaluation_sessions", column: "created_by_user_id" \}/u);
  assert.match(lifecycle, /db\.batch\(statements\)/u);
  for (const table of [
    "user_finance_snapshots",
    "user_profiles",
    "youth_policy_profiles",
    "ai_chat_events",
    "ai_user_memories",
    "auth_sessions",
  ]) {
    assert.match(lifecycle, new RegExp(`"${table}"`, "u"));
  }
});

test("My Page exposes consent inventory and layered destructive confirmation", async () => {
  const page = await readFile(new URL("../app/mypage/page.tsx", import.meta.url), "utf8");
  assert.match(page, /fetchMyPageRequest<AccountLifecycleResponse>\("\/api\/account"/u);
  assert.match(page, /termsAccepted: true/u);
  assert.match(page, /privacyAccepted: true/u);
  assert.match(page, /내 계정에 저장된 항목/u);
  assert.match(page, /ACCOUNT_DELETION_CONFIRMATION = "회원탈퇴"/u);
  assert.match(page, /acknowledgePermanentDeletion: true/u);
  assert.match(page, /window\.confirm/u);
  assert.match(page, /계정과 모든 사용자 데이터 삭제/u);
});

test("OAuth sends users missing current consent to the focused onboarding surface", async () => {
  const [start, callback, myPage, profile] = await Promise.all([
    readFile(new URL("../app/api/auth/[provider]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/callback/[provider]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/mypage/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/profile/route.ts", import.meta.url), "utf8"),
  ]);
  const getHandler = start.slice(
    start.indexOf("export async function GET"),
    start.indexOf("export async function POST"),
  );
  assert.doesNotMatch(getHandler, /createOAuthTransaction|authorizationUrl\(/u);
  assert.doesNotMatch(start, /searchParams\.get\("termsAccepted"\)|searchParams\.get\("privacyAccepted"\)/u);
  assert.match(start, /export async function POST[\s\S]*await requireSameOrigin\(request\)/u);
  assert.match(start, /readBoundedAccountJson\(request\)[\s\S]*parseRequiredConsentAcceptance\(payload\)/u);
  assert.match(start, /currentOAuthConsentStatePrefix\(\)[\s\S]*randomBase64Url\(32\)/u);
  assert.match(start, /createOAuthTransaction\(\{[\s\S]*state,[\s\S]*returnTo/u);
  assert.match(callback, /isCurrentOAuthConsentState\(state\)/u);
  assert.match(callback, /acceptRequiredConsents\(\{[\s\S]*userId: user\.id/u);
  assert.match(callback, /getRequiredConsentState\(user\.id\)/u);
  assert.match(callback, /\/mypage\?onboarding=required/u);
  assert.match(callback, /consent\.accepted/u);
  assert.match(myPage, /beginOAuth\(provider: Provider\)[\s\S]*method: "POST"/u);
  assert.match(myPage, /termsVersion: CURRENT_TERMS_VERSION[\s\S]*privacyVersion: CURRENT_PRIVACY_VERSION/u);
  assert.doesNotMatch(myPage, /consentedSignInPath|searchParams\.set\("termsAccepted"/u);
  assert.match(myPage, /href="\/terms"[\s\S]*href="\/privacy"/u);
  assert.match(profile, /readBoundedAccountJson\(request\)/u);
  assert.match(profile, /application_json_required[\s\S]*415/u);
  assert.match(profile, /request_too_large[\s\S]*413/u);
});
