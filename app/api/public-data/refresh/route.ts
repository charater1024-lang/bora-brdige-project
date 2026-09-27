import { authenticatedUser } from "@/lib/auth/current-user";
import { requireSameOrigin } from "@/lib/auth/http";
import { readBoundedRequestJson, requestBodyErrorResponse } from "@/lib/http/request-body";
import {
  projectPublicDashboardSummary,
  publicDashboardForViewer,
} from "@/lib/public-data/access";
import { refreshPublicDashboard, publicDashboardWithCatalogCounts } from "@/lib/public-data/service";

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
  let input: { trigger?: unknown };
  try {
    const parsed = await readBoundedRequestJson(request, { maxBytes: 8_000 });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    input = parsed as typeof input;
  } catch (error) {
    return requestBodyErrorResponse(error) ?? Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const trigger = input.trigger === "manual" ? "manual" : "login";
  const result = await refreshPublicDashboard(user, trigger);
  const sourceDashboard = await publicDashboardWithCatalogCounts(result.dashboard).catch(() => result.dashboard);
  const dashboard = projectPublicDashboardSummary(
    await publicDashboardForViewer(sourceDashboard, user, { youthPolicyView: "all" }),
  );
  const isCooldown = trigger === "manual" && result.kind === "cooldown";
  const status = result.kind === "storage-unavailable" ? 503 : isCooldown ? 429 : 200;
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
  if (isCooldown) headers["Retry-After"] = String(Math.max(1, dashboard.refreshInSeconds));
  return Response.json({ ...dashboard, refreshResult: result.kind }, { status, headers });
}
