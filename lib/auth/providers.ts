import type { AuthProvider, OAuthProfile } from "./types";
import type { ProviderCredentials } from "./config";

const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;
const PROVIDER_TIMEOUT_MS = 10_000;

type RecordValue = Record<string, unknown>;

type AuthorizationInput = {
  provider: AuthProvider;
  credentials: ProviderCredentials;
  redirectUri: string;
  state: string;
  codeChallenge: string;
};

type TokenInput = {
  provider: AuthProvider;
  credentials: ProviderCredentials;
  redirectUri: string;
  state: string;
  code: string;
  codeVerifier: string;
};

export class ProviderResponseError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProviderResponseError";
    this.code = code;
  }
}

export function authorizationUrl(input: AuthorizationInput): URL {
  const endpoint =
    input.provider === "google"
      ? "https://accounts.google.com/o/oauth2/v2/auth"
      : input.provider === "kakao"
        ? "https://kauth.kakao.com/oauth/authorize"
        : "https://nid.naver.com/oauth2.0/authorize";
  const url = new URL(endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.credentials.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  if (input.provider === "google") {
    url.searchParams.set(
      "scope",
      ["openid", "email", "profile"].join(" "),
    );
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
  }

  return url;
}

export async function exchangeAuthorizationCode(input: TokenInput): Promise<string> {
  const endpoint =
    input.provider === "google"
      ? "https://oauth2.googleapis.com/token"
      : input.provider === "kakao"
        ? "https://kauth.kakao.com/oauth/token"
        : "https://nid.naver.com/oauth2.0/token";
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.credentials.clientId,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.codeVerifier,
  });
  if (input.credentials.clientSecret) body.set("client_secret", input.credentials.clientSecret);
  if (input.provider === "naver") body.set("state", input.state);

  const payload = await fetchJson(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
  });
  const token = cleanString(payload.access_token, 4096);
  if (!token) throw new ProviderResponseError("token_exchange_failed", "No access token returned.");
  return token;
}

export async function fetchOAuthProfile(
  provider: AuthProvider,
  accessToken: string,
): Promise<OAuthProfile> {
  if (provider === "google") return fetchGoogleProfile(accessToken);
  if (provider === "kakao") return fetchKakaoProfile(accessToken);
  return fetchNaverProfile(accessToken);
}

async function fetchGoogleProfile(accessToken: string): Promise<OAuthProfile> {
  const basic = await fetchJson("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: bearerHeaders(accessToken),
  });
  const subject = requiredSubject(basic.sub);

  return {
    provider: "google",
    subject,
    displayName: cleanString(basic.name, 160) ?? cleanString(basic.email, 254) ?? "Google member",
    name: cleanString(basic.name, 160),
    nickname: null,
    email: normalizedEmail(basic.email),
    emailVerified: typeof basic.email_verified === "boolean" ? basic.email_verified : null,
    profileImageUrl: normalizedImageUrl(basic.picture),
    gender: null,
    birthday: null,
    birthYear: null,
    ageRange: null,
  };
}

async function fetchKakaoProfile(accessToken: string): Promise<OAuthProfile> {
  const payload = await fetchJson("https://kapi.kakao.com/v2/user/me?secure_resource=true", {
    headers: bearerHeaders(accessToken),
  });
  const account = asRecord(payload.kakao_account);
  const profile = asRecord(account.profile);
  const name = cleanString(account.name, 160);
  const nickname = cleanString(profile.nickname, 160);
  const birthYear = validBirthYear(account.birthyear);
  const compactBirthday = cleanString(account.birthday, 4);
  const birthdayType = cleanString(account.birthday_type, 16)?.toUpperCase();
  const birthday = birthdayType === "SOLAR" && compactBirthday && /^\d{4}$/u.test(compactBirthday)
    ? normalizedBirthday(
        Number(compactBirthday.slice(0, 2)),
        Number(compactBirthday.slice(2)),
        birthYear,
      )
    : null;

  return {
    provider: "kakao",
    subject: requiredSubject(payload.id),
    displayName:
      nickname ??
      name ??
      normalizedEmail(account.email) ??
      "Kakao member",
    name,
    nickname,
    email: normalizedEmail(account.email),
    emailVerified:
      typeof account.is_email_verified === "boolean" &&
      typeof account.is_email_valid === "boolean"
        ? account.is_email_verified && account.is_email_valid
        : null,
    profileImageUrl: normalizedImageUrl(profile.profile_image_url),
    gender: normalizedGender(account.gender),
    birthday,
    birthYear,
    ageRange: normalizedAgeRange(account.age_range) ?? ageRangeFromBirthYear(birthYear),
  };
}

async function fetchNaverProfile(accessToken: string): Promise<OAuthProfile> {
  const payload = await fetchJson("https://openapi.naver.com/v1/nid/me", {
    headers: bearerHeaders(accessToken),
  });
  if (String(payload.resultcode ?? "") !== "00") {
    throw new ProviderResponseError("profile_fetch_failed", "Naver profile request failed.");
  }
  const profile = asRecord(payload.response);
  const name = cleanString(profile.name, 160);
  const nickname = cleanString(profile.nickname, 160);
  const birthYear = validBirthYear(profile.birthyear);
  const birthdayPart = cleanString(profile.birthday, 5);
  const birthday = birthdayPart && /^\d{2}-\d{2}$/u.test(birthdayPart)
    ? normalizedBirthday(
        Number(birthdayPart.slice(0, 2)),
        Number(birthdayPart.slice(3)),
        birthYear,
      )
    : null;

  return {
    provider: "naver",
    subject: requiredSubject(profile.id),
    displayName:
      nickname ??
      name ??
      normalizedEmail(profile.email) ??
      "Naver member",
    name,
    nickname,
    email: normalizedEmail(profile.email),
    emailVerified: null,
    profileImageUrl: normalizedImageUrl(profile.profile_image),
    gender: normalizedGender(profile.gender),
    birthday,
    birthYear,
    ageRange: normalizedAgeRange(profile.age) ?? ageRangeFromBirthYear(birthYear),
  };
}

function bearerHeaders(accessToken: string): HeadersInit {
  return { Accept: "application/json", Authorization: `Bearer ${accessToken}` };
}

async function fetchJson(url: string, init: RequestInit): Promise<RecordValue> {
  let response: Response;
  const signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  try {
    response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal,
    });
  } catch (error) {
    console.error("OAuth provider request failed", {
      host: new URL(url).hostname,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message.slice(0, 180) : "Unknown provider error",
    });
    throw new ProviderResponseError("provider_unavailable", "OAuth provider is unavailable.");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ProviderResponseError("provider_redirect_rejected", "OAuth provider redirected unexpectedly.");
  }
  if (!response.ok) {
    throw new ProviderResponseError("provider_rejected_request", "OAuth provider rejected the request.");
  }
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new ProviderResponseError("provider_response_too_large", "OAuth response is too large.");
  }

  const text = await readBoundedProviderText(response, signal);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ProviderResponseError("provider_invalid_response", "OAuth response is not JSON.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ProviderResponseError("provider_invalid_response", "OAuth response is invalid.");
  }
  return payload as RecordValue;
}

async function readBoundedProviderText(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  let complete = false;
  let rejectCancelled: (reason: unknown) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
  const cancel = () => rejectCancelled(new ProviderResponseError("provider_unavailable", "OAuth response timed out."));
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), cancelled]);
      if (chunk.done) { complete = true; break; }
      bytes += chunk.value.byteLength;
      if (bytes > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new ProviderResponseError("provider_response_too_large", "OAuth response is too large.");
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function asRecord(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim().slice(0, maxLength);
  return cleaned || null;
}

function requiredSubject(value: unknown): string {
  const subject = cleanString(value, 255);
  if (!subject) throw new ProviderResponseError("profile_missing_subject", "Profile has no subject.");
  return subject;
}

function normalizedEmail(value: unknown): string | null {
  const email = cleanString(value, 254)?.toLowerCase() ?? null;
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : null;
}

function normalizedImageUrl(value: unknown): string | null {
  const raw = cleanString(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizedGender(value: unknown): string | null {
  const gender = cleanString(value, 24)?.toLowerCase();
  if (!gender) return null;
  if (["m", "male"].includes(gender)) return "male";
  if (["f", "female"].includes(gender)) return "female";
  return ["u", "unknown", "other"].includes(gender) ? "unknown" : null;
}

function validBirthYear(value: unknown): string | null {
  const year = Number(value);
  const currentYear = new Date().getUTCFullYear();
  return Number.isInteger(year) && year >= 1900 && year <= currentYear
    ? String(year)
    : null;
}

function normalizedBirthday(
  monthValue: unknown,
  dayValue: unknown,
  birthYear: string | null,
): string | null {
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const validationYear = birthYear ? Number(birthYear) : 2000;
  const date = new Date(Date.UTC(validationYear, month - 1, day));
  if (
    date.getUTCFullYear() !== validationYear ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const datePart = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return birthYear ? `${birthYear}-${datePart}` : datePart;
}

function normalizedAgeRange(value: unknown): string | null {
  const ageRange = cleanString(value, 24)?.replace("~", "-") ?? null;
  return ageRange && /^\d{1,3}(?:-\d{1,3})?\+?$/u.test(ageRange) ? ageRange : null;
}

function ageRangeFromBirthYear(birthYear: string | null): string | null {
  if (!birthYear) return null;
  const age = new Date().getUTCFullYear() - Number(birthYear);
  if (!Number.isInteger(age) || age < 0 || age > 130) return null;
  const lower = Math.floor(age / 10) * 10;
  return lower >= 100 ? "100+" : `${lower}-${lower + 9}`;
}
