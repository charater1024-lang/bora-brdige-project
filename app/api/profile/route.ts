import { isExternalAuthMode } from "@/lib/auth/config";
import {
  AccountLifecycleError,
  readBoundedAccountJson,
  requireCurrentRequiredConsent,
} from "@/lib/auth/account-lifecycle";
import {
  SESSION_COOKIE_NAME,
  jsonNoStore,
  readCookie,
  requireSameOrigin,
} from "@/lib/auth/http";
import {
  getUserForSession,
  updateUserProfile,
  updateYouthPolicyProfile,
} from "@/lib/auth/store";
import { isDisplayNameMode, type StoredAuthUser } from "@/lib/auth/types";
import {
  normalizeYouthPolicyProfile,
  YouthPolicyProfileError,
  type YouthPolicyProfile,
} from "@/lib/auth/youth-policy-profile";

export const dynamic = "force-dynamic";

function profileBodyError(error: unknown) {
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

async function authenticatedUser(request: Request) {
  if (!(await isExternalAuthMode())) return null;
  const token = readCookie(request, SESSION_COOKIE_NAME);
  return token ? getUserForSession(token) : null;
}

export async function GET(request: Request) {
  try {
    const user = await authenticatedUser(request);
    return user
      ? jsonNoStore({ authenticated: true, user })
      : jsonNoStore({ authenticated: false, user: null }, 401);
  } catch {
    return jsonNoStore({ error: "profile_unavailable" }, 503);
  }
}

export async function PATCH(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return jsonNoStore({ error: "origin_mismatch" }, 403);
  }

  let body: {
    displayNameMode?: unknown;
    boraAlias?: unknown;
    youthPolicyProfile?: unknown;
  };
  try {
    const parsed = await readBoundedAccountJson(request);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AccountLifecycleError("invalid_json", "Profile payload is invalid.");
    }
    body = parsed as typeof body;
  } catch (error) {
    return profileBodyError(error);
  }

  const updatesDisplayName = body.displayNameMode !== undefined || body.boraAlias !== undefined;
  const updatesYouthPolicyProfile = body.youthPolicyProfile !== undefined;
  if (!updatesDisplayName && !updatesYouthPolicyProfile) {
    return jsonNoStore({ error: "profile_update_required" }, 400);
  }

  let alias = "";
  if (updatesDisplayName) {
    if (!isDisplayNameMode(body.displayNameMode)) {
      return jsonNoStore({ error: "invalid_display_name_mode" }, 400);
    }
    alias = typeof body.boraAlias === "string" ? body.boraAlias.trim() : "";
    if (alias.length > 30 || /[<>\u0000-\u001f\u007f]/u.test(alias)) {
      return jsonNoStore({ error: "invalid_bora_alias" }, 400);
    }
    if (body.displayNameMode === "bora" && alias.length < 2) {
      return jsonNoStore({ error: "bora_alias_required" }, 400);
    }
  }

  let youthPolicyProfile: YouthPolicyProfile | null = null;
  if (updatesYouthPolicyProfile) {
    try {
      youthPolicyProfile = normalizeYouthPolicyProfile(body.youthPolicyProfile);
    } catch (error) {
      return jsonNoStore({
        error: error instanceof YouthPolicyProfileError
          ? error.code
          : "invalid_youth_policy_profile",
      }, 400);
    }
  }

  try {
    const user = await authenticatedUser(request);
    if (!user) return jsonNoStore({ error: "authentication_required" }, 401);
    await requireCurrentRequiredConsent(user.id);
    let updated: StoredAuthUser = user;
    if (updatesDisplayName && isDisplayNameMode(body.displayNameMode)) {
      updated = await updateUserProfile({
        userId: user.id,
        displayNameMode: body.displayNameMode,
        boraAlias: alias || null,
      });
    }
    if (youthPolicyProfile) {
      updated = await updateYouthPolicyProfile({
        userId: user.id,
        profile: youthPolicyProfile,
      });
    }
    return jsonNoStore({ saved: true, user: updated });
  } catch (error) {
    if (error instanceof AccountLifecycleError && error.code === "required_consent_missing") {
      return jsonNoStore({ error: error.code }, 428);
    }
    return jsonNoStore({ error: "profile_update_failed" }, 503);
  }
}
