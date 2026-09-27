export type RecentActivityClientInput =
  | { activityType: "menu"; targetCode: "home" | "assets" | "safety" | "opportunity" | "ai" }
  | { activityType: "information"; targetCode: "youth" | "finance" | "startup" | "employment"; referenceId: string }
  | { activityType: "exchange"; targetCode: "USD" | "JPY" | "CNY" | "EUR" | "GBP" | "CAD" | "AUD" | "SGD" };

let recentActivityConsent: boolean | null = null;
let consentRequest: Promise<boolean> | null = null;
let consentRevision = 0;
const recentActivitySentAt = new Map<string, number>();
const ACTIVITY_DEDUPE_MS = 60_000;

export function setRecentActivityClientConsent(enabled: boolean | null) {
  consentRevision += 1;
  recentActivityConsent = enabled;
  consentRequest = null;
}

async function recentActivityAllowed() {
  if (recentActivityConsent !== null) return recentActivityConsent;
  if (!consentRequest) {
    const requestRevision = consentRevision;
    consentRequest = fetch("/api/ai/context", {
      cache: "no-store",
      credentials: "same-origin",
    }).then(async (response) => {
      if (!response.ok) return false;
      const body = await response.json() as {
        preferences?: { recentActivityEnabled?: unknown };
      };
      return body.preferences?.recentActivityEnabled === true;
    }).catch(() => false).then((enabled) => {
      if (requestRevision !== consentRevision) return recentActivityConsent === true;
      recentActivityConsent = enabled;
      return enabled;
    }).finally(() => {
      if (requestRevision === consentRevision) consentRequest = null;
    });
  }
  return await consentRequest;
}

/** Best-effort; the browser does not POST while the persisted opt-in is off. */
export async function recordRecentActivity(input: RecentActivityClientInput) {
  if (!(await recentActivityAllowed())) return undefined;
  const body = input.activityType === "information"
    ? input
    : { ...input, referenceId: "" };
  const key = `${body.activityType}:${body.targetCode}:${body.referenceId}`;
  const now = Date.now();
  if (now - (recentActivitySentAt.get(key) ?? 0) < ACTIVITY_DEDUPE_MS) return undefined;
  recentActivitySentAt.set(key, now);
  return await fetch("/api/ai/context", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    keepalive: true,
    body: JSON.stringify(body),
  }).catch(() => undefined);
}
