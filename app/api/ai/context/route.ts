import {
  clearRecentAiContext,
  getAiContextPreferences,
  getRecentAiContext,
  parseAiContextPreferenceUpdate,
  parseRecentActivity,
  recordRecentActivity,
  updateAiContextPreferences,
  AI_CONTEXT_MAX_ACTIVITIES,
  AI_CONTEXT_MAX_CONVERSATIONS,
  AI_CONTEXT_RETENTION_DAYS,
} from "@/lib/ai/context-store";
import { authenticatedUser } from "@/lib/auth/current-user";
import { AccountLifecycleError, requireCurrentRequiredConsent } from "@/lib/auth/account-lifecycle";
import { requireSameOrigin } from "@/lib/auth/http";
import { characterBodyLimits, readBoundedRequestText, requestBodyErrorResponse } from "@/lib/http/request-body";

export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 2_000;

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function boundedJson(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new Error("json_content_type_required");
  }
  const raw = await readBoundedRequestText(request, characterBodyLimits(MAX_BODY_CHARS));
  if (raw.length > MAX_BODY_CHARS) throw new Error("request_too_large");
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("invalid_json");
  }
}

function errorResponse(error: unknown) {
  const bodyError = requestBodyErrorResponse(error);
  if (bodyError) return bodyError;
  const code = error instanceof Error ? error.message : "ai_context_unavailable";
  if (error instanceof AccountLifecycleError && error.code === "required_consent_missing") {
    return json({ error: error.code }, 403);
  }
  const status = code === "json_content_type_required"
    ? 415
    : code === "request_too_large"
      ? 413
      : code.startsWith("invalid_") || code === "unexpected_context_field"
        || code === "context_preference_required" || code === "activity_reference_not_allowed"
        ? 400
        : 503;
  return json({ error: status === 503 ? "ai_context_unavailable" : code }, status);
}

async function contextUser(request: Request, requireConsent = false) {
  const user = await authenticatedUser(request).catch(() => null);
  if (!user) return null;
  if (requireConsent) await requireCurrentRequiredConsent(user.id);
  return user;
}

export async function GET(request: Request) {
  try {
    const user = await contextUser(request);
    if (!user) return json({ error: "authentication_required" }, 401);
    const [preferences, inventory] = await Promise.all([
      getAiContextPreferences(user.id),
      getRecentAiContext(user.id, { includeActivities: true, includeConversations: true }),
    ]);
    return json({
      preferences,
      inventory: {
        activities: inventory.activityCount,
        conversations: inventory.conversationCount,
      },
      retention: {
        days: AI_CONTEXT_RETENTION_DAYS,
        maximumActivities: AI_CONTEXT_MAX_ACTIVITIES,
        maximumConversations: AI_CONTEXT_MAX_CONVERSATIONS,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  if (!(await requireSameOrigin(request))) return json({ error: "origin_mismatch" }, 403);
  try {
    const user = await contextUser(request);
    if (!user) return json({ error: "authentication_required" }, 401);
    const update = parseAiContextPreferenceUpdate(await boundedJson(request));
    if (update.memoryEnabled === true
      || update.conversationContextEnabled === true
      || update.recentActivityEnabled === true) {
      await requireCurrentRequiredConsent(user.id);
    }
    const preferences = await updateAiContextPreferences({
      userId: user.id,
      memoryEnabled: update.memoryEnabled,
      conversationContextEnabled: update.conversationContextEnabled,
      recentActivityEnabled: update.recentActivityEnabled,
    });
    const deletedConversations = update.clearConversationContext
      ? await clearRecentAiContext(user.id, "conversations")
      : 0;
    const deletedActivities = update.clearRecentActivity
      ? await clearRecentAiContext(user.id, "activities")
      : 0;
    return json({ saved: true, preferences, deletedConversations, deletedActivities });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return json({ error: "origin_mismatch" }, 403);
  try {
    const user = await contextUser(request, true);
    if (!user) return json({ error: "authentication_required" }, 401);
    const activity = parseRecentActivity(await boundedJson(request));
    const stored = await recordRecentActivity(user.id, activity);
    return json({ stored });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  if (!(await requireSameOrigin(request))) return json({ error: "origin_mismatch" }, 403);
  try {
    const user = await contextUser(request);
    if (!user) return json({ error: "authentication_required" }, 401);
    const deleted = await clearRecentAiContext(user.id);
    return json({ deleted });
  } catch (error) {
    return errorResponse(error);
  }
}
