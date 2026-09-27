import type { YouthPolicyProfile } from "./youth-policy-profile";

export const AUTH_PROVIDERS = ["google", "kakao", "naver"] as const;

export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export const DISPLAY_NAME_MODES = ["nickname", "name", "bora"] as const;
export type DisplayNameMode = (typeof DISPLAY_NAME_MODES)[number];

export type OAuthProfile = {
  provider: AuthProvider;
  subject: string;
  displayName: string;
  name: string | null;
  nickname: string | null;
  email: string | null;
  emailVerified: boolean | null;
  profileImageUrl: string | null;
  gender: string | null;
  birthday: string | null;
  birthYear: string | null;
  ageRange: string | null;
};

export type StoredAuthUser = OAuthProfile & {
  id: string;
  displayNameMode: DisplayNameMode;
  boraAlias: string | null;
  youthPolicyProfile: YouthPolicyProfile;
  createdAt: number;
  updatedAt: number;
};

export function isDisplayNameMode(value: unknown): value is DisplayNameMode {
  return typeof value === "string" && (DISPLAY_NAME_MODES as readonly string[]).includes(value);
}

export type OAuthTransaction = {
  stateHash: string;
  provider: AuthProvider;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
};

export function isAuthProvider(value: string): value is AuthProvider {
  return (AUTH_PROVIDERS as readonly string[]).includes(value);
}
