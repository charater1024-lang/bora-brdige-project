import { environmentValue } from "@/lib/runtime-settings";

export type LocalModelActivation = {
  state: string;
  selectedModel: string;
  resolvedRepository: string | null;
  fallbackReason: string | null;
};

function privateBaseUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    const privateIpv4 = /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./u.test(host);
    if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]" && !privateIpv4) return null;
    return url;
  } catch {
    return null;
  }
}

export async function activateLocalModel(modelId: string): Promise<LocalModelActivation> {
  const [configuredBaseUrl, adminToken] = await Promise.all([
    environmentValue("LOCAL_LLM_BASE_URL"),
    environmentValue("LOCAL_LLM_ADMIN_TOKEN"),
  ]);
  const baseUrl = privateBaseUrl(configuredBaseUrl);
  if (!baseUrl) throw new Error("local_endpoint_required");
  if (!adminToken || adminToken.length < 16) throw new Error("local_admin_token_required");

  baseUrl.pathname = `${baseUrl.pathname.replace(/\/v1\/?$/u, "").replace(/\/$/u, "")}/admin/models/activate`;
  baseUrl.search = "";
  baseUrl.hash = "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(baseUrl, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: modelId }),
    });
    const result = await response.json().catch(() => null) as null | Record<string, unknown>;
    if (!response.ok || !result) throw new Error("local_model_activation_failed");
    return {
      state: typeof result.state === "string" ? result.state : "loading",
      selectedModel: typeof result.selected_model === "string" ? result.selected_model : modelId,
      resolvedRepository: typeof result.resolved_repository === "string" ? result.resolved_repository : null,
      fallbackReason: typeof result.fallback_reason === "string" ? result.fallback_reason : null,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "local_model_activation_failed") throw error;
    throw new Error("local_model_control_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export async function localModelStatus(): Promise<LocalModelActivation & { loadedModel: string | null }> {
  const [configuredBaseUrl, adminToken] = await Promise.all([
    environmentValue("LOCAL_LLM_BASE_URL"),
    environmentValue("LOCAL_LLM_ADMIN_TOKEN"),
  ]);
  const baseUrl = privateBaseUrl(configuredBaseUrl);
  if (!baseUrl || !adminToken) throw new Error("local_model_control_unavailable");
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/v1\/?$/u, "").replace(/\/$/u, "")}/admin/status`;
  baseUrl.search = "";
  baseUrl.hash = "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(baseUrl, {
      redirect: "manual",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const result = await response.json().catch(() => null) as null | Record<string, unknown>;
    if (!response.ok || !result) throw new Error("local_model_control_unavailable");
    return {
      state: typeof result.state === "string" ? result.state : "unknown",
      selectedModel: typeof result.selected_model === "string" ? result.selected_model : "unknown",
      loadedModel: typeof result.loaded_model === "string" ? result.loaded_model : null,
      resolvedRepository: typeof result.resolved_repository === "string" ? result.resolved_repository : null,
      fallbackReason: typeof result.fallback_reason === "string" ? result.fallback_reason : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
