import type { StoredAuthUser } from "./types";

export function normalizeDeveloperIdentity(value: string | null | undefined) {
  const match = value?.trim().match(/^(google|kakao|naver):([^\s,]+)$/iu);
  if (!match) return "";
  // Provider subjects are opaque, case-sensitive identifiers. Never normalize
  // their case or Unicode form: doing so can authorize a different account.
  return `${match[1].toLowerCase()}:${match[2]}`;
}

export function configuredDeveloperIdentityMatches(
  user: StoredAuthUser,
  configuredIdentities: readonly string[],
) {
  const identities = new Set(
    configuredIdentities.map(normalizeDeveloperIdentity).filter(Boolean),
  );
  const immutableIdentity = normalizeDeveloperIdentity(`${user.provider}:${user.subject}`);
  return immutableIdentity !== "" && identities.has(immutableIdentity);
}
