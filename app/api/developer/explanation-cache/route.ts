import type { AIProviderName } from "@/lib/ai/providers";
import { authenticatedUser } from "@/lib/auth/current-user";
import { isDeveloperUser } from "@/lib/auth/developer-access";
import { jsonNoStore, requireSameOrigin } from "@/lib/auth/http";
import { readBoundedRequestJson, requestBodyErrorResponse } from "@/lib/http/request-body";
import {
  clearItemAnalysisCache,
  itemAnalysisCacheStats,
} from "@/lib/public-data/item-analysis-cache";
import { runtimeAiProviderSettings } from "@/lib/runtime-settings";

export const dynamic = "force-dynamic";

async function developer(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return { error: jsonNoStore({ error: "authentication_required" }, 401) } as const;
  if (!(await isDeveloperUser(user))) {
    return { error: jsonNoStore({ error: "developer_access_denied" }, 403) } as const;
  }
  return { user } as const;
}

async function currentRuntime() {
  const settings = await runtimeAiProviderSettings().catch(() => []);
  const current = settings.find((provider) => provider.enabled && provider.configured);
  return current
    ? { provider: current.id as AIProviderName, configuredModel: current.modelId }
    : null;
}

export async function GET(request: Request) {
  try {
    const access = await developer(request);
    if ("error" in access) return access.error;
    const current = await currentRuntime();
    const stats = await itemAnalysisCacheStats(current);
    return jsonNoStore({
      authorized: true,
      currentRuntime: current
        ? { provider: current.provider, model: current.configuredModel }
        : null,
      ...stats,
    });
  } catch {
    return jsonNoStore({ error: "explanation_cache_unavailable" }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return jsonNoStore({ error: "origin_mismatch" }, 403);
  }
  try {
    const access = await developer(request);
    if ("error" in access) return access.error;
    const body = await readBoundedRequestJson(request, { maxBytes: 8_000 }) as { scope?: unknown } | null;
    if (body?.scope !== "public-item-explanations") {
      return jsonNoStore({ error: "invalid_scope" }, 400);
    }
    return jsonNoStore({
      cleared: true,
      ...(await clearItemAnalysisCache(access.user.id)),
    });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return jsonNoStore({ error: "explanation_cache_reset_failed" }, 503);
  }
}
