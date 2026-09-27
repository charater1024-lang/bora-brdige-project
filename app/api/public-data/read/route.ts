import { authenticatedUser } from "@/lib/auth/current-user";
import { requireSameOrigin } from "@/lib/auth/http";
import { readBoundedRequestJson, requestBodyErrorResponse } from "@/lib/http/request-body";
import { markPublicCategoryRead } from "@/lib/public-data/service";

export const dynamic = "force-dynamic";

function isJsonRequest(request: Request) {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    === "application/json";
}

export async function POST(request: Request) {
  const user = await authenticatedUser(request).catch(() => null);
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401 });
  if (!(await requireSameOrigin(request))) {
    return Response.json({ error: "origin_mismatch" }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return Response.json({ error: "json_content_type_required" }, { status: 415 });
  }
  let input: { category?: unknown; seenThrough?: unknown };
  try {
    const parsed = await readBoundedRequestJson(request, { maxBytes: 8_000 });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    input = parsed as typeof input;
  } catch (error) {
    return requestBodyErrorResponse(error) ?? Response.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    await markPublicCategoryRead(
      user,
      String(input.category ?? ""),
      typeof input.seenThrough === "string" ? input.seenThrough : "",
    );
    return Response.json({ ok: true }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "read_state_unavailable";
    const status = message === "unsupported_category" || message === "invalid_seen_through" ? 400 : 503;
    return Response.json({ error: message }, { status });
  }
}
