export const CURRENT_TERMS_VERSION = "2026-08-08-v1";
export const CURRENT_PRIVACY_VERSION = "2026-08-08-v1";
export const OAUTH_CONSENT_TRANSACTION_VERSION = "consent-v2";
export const ACCOUNT_DELETION_CONFIRMATION = "회원탈퇴";

export function currentOAuthConsentStatePrefix(): string {
  return `${OAUTH_CONSENT_TRANSACTION_VERSION}.${CURRENT_TERMS_VERSION}.${CURRENT_PRIVACY_VERSION}.`;
}

/**
 * OAuth callbacks may record required consent only for a one-time transaction
 * created after the current documents were explicitly accepted. Including the
 * document versions in state invalidates unfinished transactions after a
 * policy update without adding another persistent schema.
 */
export function isCurrentOAuthConsentState(value: string): boolean {
  const prefix = currentOAuthConsentStatePrefix();
  if (!value.startsWith(prefix) || value.length > 512) return false;
  const nonce = value.slice(prefix.length);
  return /^[A-Za-z0-9_-]{43,128}$/u.test(nonce);
}

export class AccountLifecycleError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AccountLifecycleError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseRequiredConsentAcceptance(value: unknown) {
  if (!isRecord(value)) {
    throw new AccountLifecycleError("invalid_json", "Consent payload is invalid.");
  }
  if (
    value.termsAccepted !== true
    || value.privacyAccepted !== true
    || value.termsVersion !== CURRENT_TERMS_VERSION
    || value.privacyVersion !== CURRENT_PRIVACY_VERSION
  ) {
    throw new AccountLifecycleError(
      "required_consent_incomplete",
      "The current required terms and privacy policy must both be accepted.",
    );
  }
  return {
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
  };
}
