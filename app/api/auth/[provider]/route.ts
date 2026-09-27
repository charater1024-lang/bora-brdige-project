import {
  AuthConfigurationError,
  callbackUriForRequest,
  isExternalAuthMode,
  providerCredentials,
  safeReturnPath,
} from "@/lib/auth/config";
import { randomBase64Url, sha256Base64Url } from "@/lib/auth/crypto";
import {
  jsonNoStore,
  oauthStateCookie,
  redirectNoStore,
  requireSameOrigin,
  requestUsesHttps,
} from "@/lib/auth/http";
import { authorizationUrl } from "@/lib/auth/providers";
import { createOAuthTransaction } from "@/lib/auth/store";
import { claimLoginStartRateLimit } from "@/lib/auth/login-start-rate-limit";
import { isAuthProvider } from "@/lib/auth/types";
import {
  AccountLifecycleError,
  parseRequiredConsentAcceptance,
  readBoundedAccountJson,
} from "@/lib/auth/account-lifecycle";
import {
  currentOAuthConsentStatePrefix,
} from "@/lib/auth/consent-policy";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> | { provider: string } };

function consentRequestError(error: unknown): Response {
  if (!(error instanceof AccountLifecycleError)) {
    return jsonNoStore({ error: "invalid_json" }, 400);
  }
  const status = error.code === "application_json_required"
    ? 415
    : error.code === "request_too_large"
      ? 413
      : 400;
  return jsonNoStore({ error: error.code }, status);
}

export async function GET(request: Request, context: RouteContext) {
  if (!(await isExternalAuthMode())) {
    return jsonNoStore({ error: "external_auth_disabled" }, 404);
  }

  const { provider: providerValue } = await context.params;
  if (!isAuthProvider(providerValue)) {
    return jsonNoStore({ error: "unsupported_provider" }, 404);
  }

  const credentials = await providerCredentials(providerValue);
  if (!credentials) {
    return jsonNoStore({ error: "provider_not_configured", provider: providerValue }, 503);
  }

  let redirectUri: string;
  try {
    redirectUri = await callbackUriForRequest(request, providerValue);
  } catch (error) {
    const code = error instanceof AuthConfigurationError ? error.code : "invalid_auth_origin";
    return jsonNoStore({ error: code, provider: providerValue }, 400);
  }

  // A navigational GET never creates a consented OAuth transaction. This is
  // intentional: query parameters are not proof that the person checked the
  // current legal documents.
  const requestUrl = new URL(request.url);
  const consentUrl = new URL("/mypage", new URL(redirectUri).origin);
  consentUrl.searchParams.set("login_consent", "required");
  consentUrl.searchParams.set("provider", providerValue);
  consentUrl.searchParams.set("returnTo", safeReturnPath(
    requestUrl.searchParams.get("returnTo") ?? requestUrl.searchParams.get("return_to"),
  ));
  return redirectNoStore(consentUrl);
}

export async function POST(request: Request, context: RouteContext) {
  if (!(await isExternalAuthMode())) {
    return jsonNoStore({ error: "external_auth_disabled" }, 404);
  }
  if (!(await requireSameOrigin(request))) {
    return jsonNoStore({ error: "origin_mismatch" }, 403);
  }

  const { provider: providerValue } = await context.params;
  if (!isAuthProvider(providerValue)) {
    return jsonNoStore({ error: "unsupported_provider" }, 404);
  }

  let payload: unknown;
  try {
    payload = await readBoundedAccountJson(request);
    parseRequiredConsentAcceptance(payload);
  } catch (error) {
    return consentRequestError(error);
  }

  const credentials = await providerCredentials(providerValue);
  if (!credentials) {
    return jsonNoStore({ error: "provider_not_configured", provider: providerValue }, 503);
  }

  let redirectUri: string;
  try {
    redirectUri = await callbackUriForRequest(request, providerValue);
  } catch (error) {
    const code = error instanceof AuthConfigurationError ? error.code : "invalid_auth_origin";
    return jsonNoStore({ error: code, provider: providerValue }, 400);
  }

  const input = payload as Record<string, unknown>;
  const returnTo = safeReturnPath(typeof input.returnTo === "string" ? input.returnTo : null);
  try {
    const claim = await claimLoginStartRateLimit(request);
    if (!claim.allowed) {
      const response = jsonNoStore({ error: "login_start_rate_limit_exceeded" }, 429);
      response.headers.set("Retry-After", String(claim.retryAfterSeconds));
      return response;
    }
  } catch {
    const response = jsonNoStore({ error: "login_start_rate_limit_unavailable" }, 503);
    response.headers.set("Retry-After", "60");
    return response;
  }
  // The exact current document versions are bound to the one-time transaction
  // state stored server-side. Old or query-forged states cannot reach callback
  // consent persistence.
  const state = `${currentOAuthConsentStatePrefix()}${randomBase64Url(32)}`;
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  try {
    await createOAuthTransaction({
      state,
      provider: providerValue,
      codeVerifier,
      redirectUri,
      returnTo,
    });
  } catch {
    return jsonNoStore({ error: "auth_storage_unavailable" }, 503);
  }

  const response = jsonNoStore({
    authorizationUrl: authorizationUrl({
      provider: providerValue,
      credentials,
      redirectUri,
      state,
      codeChallenge,
    }),
  });
  response.headers.set(
    "Set-Cookie",
    oauthStateCookie({
      provider: providerValue,
      state,
      maxAgeSeconds: 600,
      secure: await requestUsesHttps(request),
    }),
  );
  return response;
}
