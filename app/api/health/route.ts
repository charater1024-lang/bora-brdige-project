import { authMode, providerCredentials, providerIsAvailable } from "@/lib/auth/config";
import { authenticatedDeveloper } from "@/lib/auth/current-user";
import { AUTH_NO_STORE_HEADERS } from "@/lib/auth/http";
import { authStorageIsReady } from "@/lib/auth/store";
import { AUTH_PROVIDERS, type AuthProvider } from "@/lib/auth/types";

export const dynamic = "force-dynamic";

type ProviderHealth = {
  configured: boolean;
  available: boolean;
  reason: "missing_credentials" | "origin_or_redirect_mismatch" | null;
};

export async function GET(request: Request) {
  const mode = await authMode();
  const providerEntries = await Promise.all(
    AUTH_PROVIDERS.map(async (provider) => {
      const configured = Boolean(await providerCredentials(provider));
      const available = mode === "external" && configured
        ? await providerIsAvailable(request, provider)
        : false;
      const reason: ProviderHealth["reason"] = !configured
        ? "missing_credentials"
        : available || mode !== "external"
          ? null
          : "origin_or_redirect_mismatch";
      return [provider, { configured, available, reason }] as const;
    }),
  );
  const providers = Object.fromEntries(providerEntries) as Record<AuthProvider, ProviderHealth>;
  const configuredProviders = AUTH_PROVIDERS.filter((provider) => providers[provider].configured);
  const storageReady = mode === "external" ? await authStorageIsReady() : null;
  const authReady = mode === "sites" || (
    storageReady === true &&
    configuredProviders.length > 0 &&
    configuredProviders.every((provider) => providers[provider].available)
  );
  const status = authReady ? "ok" : "degraded";
  const developer = await authenticatedDeveloper(request).catch(() => null);
  const headers = {
    ...AUTH_NO_STORE_HEADERS,
    Vary: "Cookie",
  };

  return Response.json(
    developer
      ? {
          status,
          service: "bora-bridge",
          timestamp: new Date().toISOString(),
          auth: {
            mode,
            ready: authReady,
            storage: storageReady === null ? "not-required" : storageReady ? "ready" : "unavailable",
            providers,
          },
        }
      : { status },
    { status: authReady ? 200 : 503, headers },
  );
}
