import type { AuthProvider } from "./types";

const LOOPBACK_ORIGIN = "http://127.0.0.1:3000";

const CALLBACK_PATHS: Record<AuthProvider, string> = {
  google: "/api/auth/callback/google",
  kakao: "/api/auth/callback/kakao",
  naver: "/api/auth/callback/naver",
};

const REDIRECT_ENV: Record<AuthProvider, string> = {
  google: "GOOGLE_REDIRECT_URI",
  kakao: "KAKAO_REDIRECT_URI",
  naver: "NAVER_REDIRECT_URI",
};

export type ProviderCredentials = {
  clientId: string;
  clientSecret: string | null;
};

export class AuthConfigurationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AuthConfigurationError";
    this.code = code;
  }
}

async function runtimeValue(name: string): Promise<string | null> {
  const processValue = process.env[name];
  if (typeof processValue === "string" && processValue.trim()) return processValue.trim();

  try {
    const { env } = await import("cloudflare:workers");
    const workerValue = (env as unknown as Record<string, unknown>)[name];
    return typeof workerValue === "string" && workerValue.trim()
      ? workerValue.trim()
      : null;
  } catch {
    return null;
  }
}

export async function authMode(): Promise<"sites" | "external"> {
  return (await runtimeValue("AUTH_MODE"))?.toLowerCase() === "external"
    ? "external"
    : "sites";
}

export async function isExternalAuthMode(): Promise<boolean> {
  return (await authMode()) === "external";
}

export async function providerCredentials(
  provider: AuthProvider,
): Promise<ProviderCredentials | null> {
  if (provider === "google") {
    const [clientId, clientSecret] = await Promise.all([
      runtimeValue("GOOGLE_CLIENT_ID"),
      runtimeValue("GOOGLE_CLIENT_SECRET"),
    ]);
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  if (provider === "kakao") {
    const [clientId, clientSecret] = await Promise.all([
      runtimeValue("KAKAO_REST_API_KEY"),
      runtimeValue("KAKAO_CLIENT_SECRET"),
    ]);
    return clientId
      ? { clientId, clientSecret }
      : null;
  }

  const [clientId, clientSecret] = await Promise.all([
    runtimeValue("NAVER_CLIENT_ID"),
    runtimeValue("NAVER_CLIENT_SECRET"),
  ]);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export async function sessionTtlSeconds(): Promise<number> {
  const raw = Number((await runtimeValue("AUTH_SESSION_TTL_SECONDS")) ?? 28_800);
  return Number.isInteger(raw) && raw >= 900 && raw <= 2_592_000 ? raw : 28_800;
}

export function callbackPath(provider: AuthProvider): string {
  return CALLBACK_PATHS[provider];
}

export async function configuredPublicOrigin(): Promise<string | null> {
  const raw = await runtimeValue("APP_BASE_URL");
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function forwardedProtocol(request: Request): "http:" | "https:" | null {
  const raw = request.headers.get("x-forwarded-proto");
  if (!raw) return null;
  const values = raw.split(",").map((value) => value.trim().toLowerCase());
  if (values.length !== 1) return null;
  if (values[0] === "http") return "http:";
  if (values[0] === "https") return "https:";
  return null;
}

/**
 * Returns the externally visible request origin without trusting a forwarded
 * host. APP_BASE_URL is the only authority for a reverse-proxied public host;
 * X-Forwarded-Proto may only upgrade a request whose direct Host already
 * exactly matches that configured host.
 */
export async function effectiveRequestOrigin(request: Request): Promise<string> {
  const directUrl = new URL(request.url);
  if (directUrl.username || directUrl.password) {
    throw new AuthConfigurationError("origin_not_allowed", "Request origin is not allowed.");
  }

  const directOrigin = directUrl.origin;
  const publicOrigin = await configuredPublicOrigin();
  if (!publicOrigin) return directOrigin;

  const publicUrl = new URL(publicOrigin);
  if (directUrl.host !== publicUrl.host) return directOrigin;
  if (directUrl.protocol === publicUrl.protocol) return publicOrigin;
  return forwardedProtocol(request) === publicUrl.protocol
    ? publicOrigin
    : directOrigin;
}

function normalizedOriginHeader(value: string): string | null {
  const raw = value.trim();
  if (!raw || raw === "null") return null;
  try {
    const url = new URL(raw);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.origin !== raw
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Mutation endpoints use this instead of comparing Origin to request.url.
 * That direct comparison fails behind an HTTPS-terminating tunnel, while
 * trusting X-Forwarded-Host would let a client choose the security boundary.
 */
export async function requireSameOrigin(request: Request): Promise<boolean> {
  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) return false;
  const normalized = normalizedOriginHeader(suppliedOrigin);
  if (!normalized) return false;
  try {
    return normalized === await effectiveRequestOrigin(request);
  } catch {
    return false;
  }
}

function ipv4Octets(hostname: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)) return null;
  const octets = hostname.split(".").map(Number);
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

function isIpv4Loopback(hostname: string): boolean {
  return ipv4Octets(hostname)?.[0] === 127;
}

function isRfc1918(hostname: string): boolean {
  const octets = ipv4Octets(hostname);
  if (!octets) return false;
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

async function insecureLanIsAllowed(): Promise<boolean> {
  const value = (await runtimeValue("AUTH_ALLOW_INSECURE_LAN"))?.toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

export async function allowedOrigins(provider: AuthProvider): Promise<readonly string[]> {
  const origins = new Set<string>([LOOPBACK_ORIGIN]);
  const allowInsecureLan = await insecureLanIsAllowed();

  const publicOrigin = await configuredPublicOrigin();
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    const rawIp = /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(url.hostname) || url.hostname.includes(":");
    const externalProviderOriginAllowed =
      provider !== "google" &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          (isIpv4Loopback(url.hostname) ||
            (isRfc1918(url.hostname) && allowInsecureLan))));
    if (externalProviderOriginAllowed || (url.protocol === "https:" && !rawIp)) {
      origins.add(publicOrigin);
    }
  }
  return [...origins];
}

export async function callbackUriForRequest(
  request: Request,
  provider: AuthProvider,
): Promise<string> {
  const origin = await effectiveRequestOrigin(request);
  if (provider === "google" && origin !== LOOPBACK_ORIGIN) {
    const originUrl = new URL(origin);
    const rawIp =
      /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(originUrl.hostname) ||
      originUrl.hostname.includes(":");
    if (originUrl.protocol !== "https:" || rawIp) {
      throw new AuthConfigurationError(
        "google_https_required",
        "Google login requires loopback development or a non-IP HTTPS public origin.",
      );
    }
  }
  if (!(await allowedOrigins(provider)).includes(origin)) {
    throw new AuthConfigurationError(
      "origin_not_allowed",
      "This origin is not allowed for the provider.",
    );
  }

  const expected = `${origin}${CALLBACK_PATHS[provider]}`;
  const configured = await runtimeValue(REDIRECT_ENV[provider]);
  if (configured) {
    const configuredUris = configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const providerOrigins = await allowedOrigins(provider);
    const allConfiguredUrisAreAllowed = configuredUris.every((value) => {
      try {
        const url = new URL(value);
        return (
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          url.pathname === CALLBACK_PATHS[provider] &&
          providerOrigins.includes(url.origin)
        );
      } catch {
        return false;
      }
    });
    if (!allConfiguredUrisAreAllowed || !configuredUris.includes(expected)) {
      throw new AuthConfigurationError(
        "redirect_uri_mismatch",
        `${REDIRECT_ENV[provider]} must contain the exact callback URI for this origin.`,
      );
    }
  }
  return expected;
}

export async function providerIsAvailable(
  request: Request,
  provider: AuthProvider,
): Promise<boolean> {
  if (!(await providerCredentials(provider))) return false;
  try {
    await callbackUriForRequest(request, provider);
    return true;
  } catch {
    return false;
  }
}

export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";

  try {
    const url = new URL(value, "https://return.local");
    if (url.origin !== "https://return.local") return "/";
    if (url.pathname.startsWith("/api/auth/") || url.pathname === "/callback") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}
