import { authenticatedUser } from "@/lib/auth/current-user";
import { isDeveloperUser } from "@/lib/auth/developer-access";
import { jsonNoStore, requireSameOrigin } from "@/lib/auth/http";
import { readBoundedRequestJson, requestBodyErrorResponse } from "@/lib/http/request-body";
import { activateLocalModel, localModelStatus, type LocalModelActivation } from "@/lib/ai/local-model-control";
import { publicDataSourceIdsForCredential } from "@/lib/public-data/adapters";
import { ensurePublicSourceStates, setPublicSourceActivation } from "@/lib/public-data/cache";
import { kstQuotaDay, PUBLIC_SOURCE_POLICIES } from "@/lib/public-data/policies";
import { INACTIVE_PUBLIC_SOURCE_RECHECK_MS } from "@/lib/public-data/service";
import {
  AI_MODEL_PROVIDERS,
  billableApisDisabled,
  deleteRuntimeSecret,
  disableAiProviderForKey,
  disableServiceApiForKey,
  runtimeAiProviderSettings,
  runtimeSecretStatuses,
  runtimeSecretStorageReady,
  saveAiProviderSetting,
  saveAllServiceApiSettings,
  saveRuntimeSecret,
  saveServiceApiSetting,
  type ServiceApiKeyName,
} from "@/lib/runtime-settings";

export const dynamic = "force-dynamic";

async function developer(request: Request) {
  const user = await authenticatedUser(request);
  if (!user) return { error: jsonNoStore({ error: "authentication_required" }, 401) } as const;
  if (!(await isDeveloperUser(user))) return { error: jsonNoStore({ error: "developer_access_denied" }, 403) } as const;
  return { user } as const;
}

async function synchronizePublicSourceSwitch(keyName: string, enabled: boolean) {
  const sourceIds = publicDataSourceIdsForCredential(keyName as ServiceApiKeyName);
  if (!sourceIds.length) return;
  const now = Date.now();
  await ensurePublicSourceStates(PUBLIC_SOURCE_POLICIES, kstQuotaDay(now), now);
  await setPublicSourceActivation({
    sourceIds,
    enabled,
    now,
    inactiveUntil: now + INACTIVE_PUBLIC_SOURCE_RECHECK_MS,
  });
}

async function synchronizeAllPublicSourceSwitches() {
  const services = await runtimeSecretStatuses();
  const activeSourceIds = services
    .filter((service) => service.activationManaged && service.enabled)
    .flatMap((service) => publicDataSourceIdsForCredential(service.key));
  const inactiveSourceIds = services
    .filter((service) => service.activationManaged && !service.enabled)
    .flatMap((service) => publicDataSourceIdsForCredential(service.key));
  const now = Date.now();
  await ensurePublicSourceStates(PUBLIC_SOURCE_POLICIES, kstQuotaDay(now), now);
  if (activeSourceIds.length) {
    await setPublicSourceActivation({
      sourceIds: activeSourceIds,
      enabled: true,
      now,
      inactiveUntil: now + INACTIVE_PUBLIC_SOURCE_RECHECK_MS,
    });
  }
  if (inactiveSourceIds.length) {
    await setPublicSourceActivation({
      sourceIds: inactiveSourceIds,
      enabled: false,
      now,
      inactiveUntil: now + INACTIVE_PUBLIC_SOURCE_RECHECK_MS,
    });
  }
}

async function publicSourceSynchronization(
  synchronize: () => Promise<void>,
) {
  try {
    await synchronize();
    return "applied" as const;
  } catch {
    // The credential/activation setting is already durably saved. Report the
    // source-state lag explicitly instead of returning a misleading complete
    // failure. Disabled credentials still cannot be resolved by an adapter,
    // so a pending OFF synchronization cannot create an external API call.
    return "pending" as const;
  }
}

export async function GET(request: Request) {
  try {
    const access = await developer(request);
    if ("error" in access) return access.error;
    const [services, storageReady, billingDisabled, aiProviders, localRuntime] = await Promise.all([
      runtimeSecretStatuses(),
      runtimeSecretStorageReady(),
      billableApisDisabled(),
      runtimeAiProviderSettings(),
      localModelStatus().catch(() => null),
    ]);
    return jsonNoStore({
      authorized: true,
      administrator: { displayName: access.user.displayName, provider: access.user.provider },
      storageReady,
      billableApisDisabled: billingDisabled,
      aiProviders,
      localRuntime,
      services,
    });
  } catch {
    return jsonNoStore({ error: "developer_settings_unavailable" }, 503);
  }
}

export async function PUT(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return jsonNoStore({ error: "origin_mismatch" }, 403);
  }
  try {
    const access = await developer(request);
    if ("error" in access) return access.error;
    const parsed = await readBoundedRequestJson(request, { maxBytes: 64 * 1024 });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonNoStore({ error: "invalid_request" }, 400);
    }
    const body = parsed as {
      action?: unknown;
      key?: unknown;
      value?: unknown;
      provider?: unknown;
      enabled?: unknown;
      modelId?: unknown;
    };
    if (body.action === "service_api") {
      if (typeof body.key !== "string" || typeof body.enabled !== "boolean") {
        return jsonNoStore({ error: "invalid_request" }, 400);
      }
      const key = body.key;
      const enabled = body.enabled;
      if (typeof body.value === "string" && body.value.trim()) {
        await saveRuntimeSecret({ keyName: key, value: body.value, userId: access.user.id });
      }
      await saveServiceApiSetting({ keyName: key, enabled, userId: access.user.id });
      const sourceSynchronization = await publicSourceSynchronization(
        () => synchronizePublicSourceSwitch(key, enabled),
      );
      return jsonNoStore({
        saved: true,
        key,
        enabled,
        sourceSynchronization,
      });
    }
    if (body.action === "service_api_bulk") {
      if (typeof body.enabled !== "boolean") return jsonNoStore({ error: "invalid_request" }, 400);
      const enabledCount = await saveAllServiceApiSettings({ enabled: body.enabled, userId: access.user.id });
      const sourceSynchronization = await publicSourceSynchronization(
        synchronizeAllPublicSourceSwitches,
      );
      return jsonNoStore({
        saved: true,
        enabled: body.enabled,
        enabledCount,
        sourceSynchronization,
      });
    }
    if (body.action === "ai_provider") {
      if (typeof body.provider !== "string" || typeof body.enabled !== "boolean" || typeof body.modelId !== "string") {
        return jsonNoStore({ error: "invalid_request" }, 400);
      }
      const definition = AI_MODEL_PROVIDERS.find((provider) => provider.id === body.provider);
      if (!definition) return jsonNoStore({ error: "unsupported_provider" }, 400);
      if (typeof body.value === "string" && body.value.trim()) {
        await saveRuntimeSecret({ keyName: definition.keyName, value: body.value, userId: access.user.id });
      }
      let localActivation: LocalModelActivation | null = null;
      if (definition.id === "local" && body.enabled) {
        localActivation = await activateLocalModel(body.modelId);
      }
      await saveAiProviderSetting({
        provider: body.provider,
        enabled: body.enabled,
        modelId: body.modelId,
        userId: access.user.id,
      });
      return jsonNoStore({ saved: true, provider: body.provider, enabled: body.enabled, modelId: body.modelId, localActivation });
    }
    if (typeof body.key !== "string" || typeof body.value !== "string") {
      return jsonNoStore({ error: "invalid_request" }, 400);
    }
    await saveRuntimeSecret({ keyName: body.key, value: body.value, userId: access.user.id });
    return jsonNoStore({ saved: true, key: body.key });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    const code = error instanceof Error ? error.message : "save_failed";
    const status = code === "billable_api_globally_disabled"
      ? 403
      : code.startsWith("local_model_")
        ? 502
      : code === "settings_encryption_unavailable"
        ? 503
        : code.startsWith("invalid") || code.startsWith("unsupported") || code === "provider_key_required" || code === "provider_key_unreadable" || code === "local_endpoint_required" || code === "service_key_required" || code === "service_key_unreadable" || code === "service_adapter_not_ready"
          ? 400
          : 503;
    return jsonNoStore({ error: code }, status);
  }
}

export async function DELETE(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return jsonNoStore({ error: "origin_mismatch" }, 403);
  }
  try {
    const access = await developer(request);
    if ("error" in access) return access.error;
    const parsed = await readBoundedRequestJson(request, { maxBytes: 8_000 });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonNoStore({ error: "invalid_request" }, 400);
    }
    const body = parsed as { key?: unknown };
    if (typeof body.key !== "string") return jsonNoStore({ error: "invalid_request" }, 400);
    const key = body.key;
    await deleteRuntimeSecret(key);
    await disableAiProviderForKey(key, access.user.id);
    await disableServiceApiForKey(key, access.user.id);
    const sourceSynchronization = await publicSourceSynchronization(
      () => synchronizePublicSourceSwitch(key, false),
    );
    return jsonNoStore({ deleted: true, key, sourceSynchronization });
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    const code = error instanceof Error ? error.message : "delete_failed";
    return jsonNoStore({ error: code }, code === "unsupported_key" ? 400 : 503);
  }
}
