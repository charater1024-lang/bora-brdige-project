import { authenticatedUser } from "@/lib/auth/current-user";
import { requireSameOrigin } from "@/lib/auth/http";
import { characterBodyLimits, readBoundedRequestText, requestBodyErrorResponse } from "@/lib/http/request-body";
import {
  AccountLifecycleError,
  requireCurrentRequiredConsent,
} from "@/lib/auth/account-lifecycle";
import {
  AI_TOPIC_CODES,
  deleteAiUserMemory,
  deleteAllAiUserMemories,
  getAiChatAnalytics,
  getAiUserMemories,
} from "@/lib/ai/history";

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const EMPTY_COUNTS = AI_TOPIC_CODES.map((topic) => ({ topic, count: 0 }));

export async function GET(request: Request) {
  const user = await authenticatedUser(request).catch(() => null);
  if (!user) {
    return response({
      authenticated: false,
      demo: false,
      topicStats: EMPTY_COUNTS,
      totalChats: 0,
      last7Days: 0,
      lastChatAt: null,
      memories: [],
      retention: "topic-metadata-only",
      memoryRequiresExplicitConsent: true,
      memoryConsentDefault: false,
    });
  }

  try {
    await requireCurrentRequiredConsent(user.id);
    const [analytics, memories] = await Promise.all([
      getAiChatAnalytics(user.id),
      getAiUserMemories(user.id),
    ]);
    return response({
      authenticated: true,
      demo: false,
      ...analytics,
      topicStats: analytics.totalChats > 0 ? analytics.topicStats : EMPTY_COUNTS,
      memories,
      retention: "topic-metadata-and-opt-in-concise-user-memory",
      memoryRequiresExplicitConsent: true,
      memoryConsentDefault: false,
    });
  } catch (error) {
    if (error instanceof AccountLifecycleError && error.code === "required_consent_missing") {
      return response({ error: error.code, consentRequired: true }, 428);
    }
    return response({ error: "ai_history_unavailable" }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!(await requireSameOrigin(request))) return response({ error: "origin_mismatch" }, 403);
  const user = await authenticatedUser(request).catch(() => null);
  if (!user) return response({ error: "authentication_required" }, 401);

  let body: { memoryId?: unknown; deleteAllMemories?: unknown };
  try {
    const raw = await readBoundedRequestText(request, characterBodyLimits(2_000));
    if (raw.length > 2_000) return response({ error: "request_too_large" }, 413);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return response({ error: "invalid_json" }, 400);
    }
    body = parsed as { memoryId?: unknown; deleteAllMemories?: unknown };
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return response({ error: "invalid_json" }, 400);
  }

  try {
    if (body.deleteAllMemories === true) {
      const deleted = await deleteAllAiUserMemories(user.id);
      return response({ deleted });
    }
    if (typeof body.memoryId !== "string" || !/^[0-9a-f-]{20,64}$/iu.test(body.memoryId)) {
      return response({ error: "memory_id_required" }, 400);
    }
    const deleted = await deleteAiUserMemory(user.id, body.memoryId);
    return response({ deleted });
  } catch {
    return response({ error: "ai_memory_delete_failed" }, 503);
  }
}
