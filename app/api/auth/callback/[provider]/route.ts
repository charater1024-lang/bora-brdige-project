import {
  AuthConfigurationError,
  callbackUriForRequest,
  isExternalAuthMode,
  providerCredentials,
  sessionTtlSeconds,
} from "@/lib/auth/config";
import { constantTimeEqual } from "@/lib/auth/crypto";
import {
  AUTH_NO_STORE_HEADERS,
  jsonNoStore,
  oauthStateCookie,
  oauthStateCookieName,
  readCookie,
  redirectNoStore,
  requestUsesHttps,
  sessionCookie,
} from "@/lib/auth/http";
import {
  ProviderResponseError,
  exchangeAuthorizationCode,
  fetchOAuthProfile,
} from "@/lib/auth/providers";
import {
  AuthStoreError,
  consumeOAuthTransaction,
  createAuthSession,
  upsertOAuthUser,
} from "@/lib/auth/store";
import {
  acceptRequiredConsents,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  getRequiredConsentState,
} from "@/lib/auth/account-lifecycle";
import { isCurrentOAuthConsentState } from "@/lib/auth/consent-policy";
import { isAuthProvider } from "@/lib/auth/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ provider: string }> | { provider: string } };

function resultUrl(
  origin: string,
  returnTo: string,
  result: "success" | "cancelled" | "failed",
  reason?: string,
) {
  const url = new URL(returnTo, origin);
  url.searchParams.set("auth", result);
  if (reason) url.searchParams.set("auth_reason", reason);
  return url;
}

function safeFailureCode(error: unknown): string {
  if (error instanceof ProviderResponseError || error instanceof AuthStoreError) return error.code;
  return "unexpected_auth_error";
}

export async function GET(request: Request, context: RouteContext) {
  if (!(await isExternalAuthMode())) {
    return jsonNoStore({ error: "external_auth_disabled" }, 404);
  }

  const { provider: providerValue } = await context.params;
  if (!isAuthProvider(providerValue)) {
    return jsonNoStore({ error: "unsupported_provider" }, 404);
  }

  const secureCookies = await requestUsesHttps(request);
  const clearStateCookie = <T extends Response>(response: T): T => {
    response.headers.append(
      "Set-Cookie",
      oauthStateCookie({
        provider: providerValue,
        state: "",
        maxAgeSeconds: 0,
        secure: secureCookies,
      }),
    );
    return response;
  };

  const credentials = await providerCredentials(providerValue);
  if (!credentials) {
    return clearStateCookie(
      jsonNoStore({ error: "provider_not_configured", provider: providerValue }, 503),
    );
  }

  let redirectUri: string;
  try {
    redirectUri = await callbackUriForRequest(request, providerValue);
  } catch (error) {
    const code = error instanceof AuthConfigurationError ? error.code : "invalid_auth_origin";
    return clearStateCookie(jsonNoStore({ error: code, provider: providerValue }, 400));
  }
  const resultOrigin = new URL(redirectUri).origin;
  const retryRequired = () => clearStateCookie(redirectNoStore(
    resultUrl(resultOrigin, "/mypage", "failed", "login_retry_required"),
  ));

  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const cookieState = readCookie(request, oauthStateCookieName(providerValue)) ?? "";
  if (
    !isCurrentOAuthConsentState(state)
    || !cookieState
    || !constantTimeEqual(state, cookieState)
  ) {
    return retryRequired();
  }

  let transaction;
  try {
    transaction = await consumeOAuthTransaction({
      state,
      provider: providerValue,
      redirectUri,
    });
  } catch {
    // A missing/expired/consumed transaction (or unavailable storage) cannot
    // authorize anyone. Use a fixed local recovery destination, not untrusted
    // callback query parameters or an unconsumed transaction's return path.
    return retryRequired();
  }

  if (url.searchParams.has("error")) {
    return clearStateCookie(
      redirectNoStore(resultUrl(resultOrigin, transaction.returnTo, "cancelled")),
    );
  }

  const code = url.searchParams.get("code") ?? "";
  if (!code || code.length > 4096) {
    return clearStateCookie(redirectNoStore(resultUrl(resultOrigin, transaction.returnTo, "failed")));
  }

  try {
    const accessToken = await exchangeAuthorizationCode({
      provider: providerValue,
      credentials,
      redirectUri,
      state,
      code,
      codeVerifier: transaction.codeVerifier,
    });
    const profile = await fetchOAuthProfile(providerValue, accessToken);
    const user = await upsertOAuthUser(profile);
    await acceptRequiredConsents({
      userId: user.id,
      termsVersion: CURRENT_TERMS_VERSION,
      privacyVersion: CURRENT_PRIVACY_VERSION,
    });
    const ttlSeconds = await sessionTtlSeconds();
    const session = await createAuthSession({
      userId: user.id,
      provider: providerValue,
      ttlSeconds,
    });
    const consent = await getRequiredConsentState(user.id);
    const returnTo = consent.accepted
      ? transaction.returnTo
      : "/mypage?onboarding=required";
    const response = redirectNoStore(resultUrl(resultOrigin, returnTo, "success"));
    response.headers.set(
      "Set-Cookie",
      sessionCookie({
        token: session.token,
        maxAgeSeconds: ttlSeconds,
        secure: secureCookies,
      }),
    );
    return clearStateCookie(response);
  } catch (error) {
    const reason = safeFailureCode(error);
    console.error("BORA OAuth callback failed", { provider: providerValue, reason });
    return clearStateCookie(new Response(null, {
      status: 302,
      headers: {
        ...AUTH_NO_STORE_HEADERS,
        Location: resultUrl(resultOrigin, transaction.returnTo, "failed", reason).toString(),
      },
    }));
  }
}
