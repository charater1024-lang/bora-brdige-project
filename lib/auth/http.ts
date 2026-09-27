import {
  effectiveRequestOrigin,
  requireSameOrigin,
} from "./config";

export const SESSION_COOKIE_NAME = "bora_session";

export function oauthStateCookieName(provider: string): string {
  return `bora_oauth_state_${provider.replace(/[^a-z]/gu, "")}`;
}

export const AUTH_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCookie(input: {
  token: string;
  maxAgeSeconds: number;
  secure: boolean;
}): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(input.token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(input.maxAgeSeconds))}`,
  ];
  if (input.secure) parts.push("Secure");
  return parts.join("; ");
}

export function oauthStateCookie(input: {
  provider: string;
  state: string;
  maxAgeSeconds: number;
  secure: boolean;
}): string {
  const parts = [
    `${oauthStateCookieName(input.provider)}=${encodeURIComponent(input.state)}`,
    `Path=/api/auth/callback/${input.provider}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(input.maxAgeSeconds))}`,
  ];
  if (input.secure) parts.push("Secure");
  return parts.join("; ");
}

export async function requestUsesHttps(request: Request): Promise<boolean> {
  try {
    return new URL(await effectiveRequestOrigin(request)).protocol === "https:";
  } catch {
    return false;
  }
}

export { requireSameOrigin };

export function jsonNoStore(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: AUTH_NO_STORE_HEADERS });
}

export function redirectNoStore(location: URL | string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { ...AUTH_NO_STORE_HEADERS, Location: String(location) },
  });
}
