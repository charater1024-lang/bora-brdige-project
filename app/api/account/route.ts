import {
  acceptRequiredConsents,
  AccountLifecycleError,
  deleteAccountAndUserData,
  getAccountDataInventory,
  getRequiredConsentState,
  parseAccountDeletionRequest,
  parseRequiredConsentAcceptance,
  readBoundedAccountJson,
} from "@/lib/auth/account-lifecycle";
import { authenticatedUser } from "@/lib/auth/current-user";
import {
  jsonNoStore,
  requestUsesHttps,
  requireSameOrigin,
  sessionCookie,
} from "@/lib/auth/http";

export const dynamic = "force-dynamic";

function lifecycleErrorResponse(error: unknown) {
  if (!(error instanceof AccountLifecycleError)) {
    return jsonNoStore({ error: "account_lifecycle_unavailable" }, 503);
  }
  const status = error.code === "application_json_required"
    ? 415
    : error.code === "request_too_large"
      ? 413
      : error.code === "account_service_ownership_conflict"
        ? 409
        : error.code === "account_not_found"
          ? 404
          : 400;
  return jsonNoStore({ error: error.code }, status);
}

export async function GET(request: Request) {
  const user = await authenticatedUser(request).catch(() => null);
  if (!user) return jsonNoStore({ error: "authentication_required" }, 401);
  try {
    const [consent, inventory] = await Promise.all([
      getRequiredConsentState(user.id),
      getAccountDataInventory(user.id),
    ]);
    return jsonNoStore({ authenticated: true, consent, inventory });
  } catch (error) {
    return lifecycleErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return jsonNoStore({ error: "origin_mismatch" }, 403);
  }
  const user = await authenticatedUser(request).catch(() => null);
  if (!user) return jsonNoStore({ error: "authentication_required" }, 401);
  try {
    const accepted = parseRequiredConsentAcceptance(
      await readBoundedAccountJson(request),
    );
    const consent = await acceptRequiredConsents({ userId: user.id, ...accepted });
    return jsonNoStore({ saved: true, consent });
  } catch (error) {
    return lifecycleErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return jsonNoStore({ error: "origin_mismatch" }, 403);
  }
  const user = await authenticatedUser(request).catch(() => null);
  if (!user) return jsonNoStore({ error: "authentication_required" }, 401);
  try {
    parseAccountDeletionRequest(await readBoundedAccountJson(request));
    await deleteAccountAndUserData(user.id);
    const response = jsonNoStore({ deleted: true });
    response.headers.append("Set-Cookie", sessionCookie({
      token: "",
      maxAgeSeconds: 0,
      secure: await requestUsesHttps(request),
    }));
    return response;
  } catch (error) {
    return lifecycleErrorResponse(error);
  }
}
