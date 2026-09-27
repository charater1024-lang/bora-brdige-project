import { authenticatedUser } from "@/lib/auth/current-user";
import { publicDashboardForViewer } from "@/lib/public-data/access";
import { getPublicDashboard } from "@/lib/public-data/service";

// Backward-compatible cache-only endpoint. External providers are contacted
// exclusively through the authenticated, cooldown-protected refresh route.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const source = url.searchParams.get("source") ?? "dashboard";
  const user = await authenticatedUser(request).catch(() => null);
  const dashboard = await getPublicDashboard(user);
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Content-Type-Options": "nosniff",
  };
  if (source === "dashboard") {
    return Response.json(await publicDashboardForViewer(dashboard, user), { headers });
  }
  if (source === "exim") {
    return Response.json({
      source: dashboard.exchange.source,
      sourceUrl: dashboard.exchange.sourceUrl,
      date: dashboard.exchange.asOf?.replaceAll("-", "") ?? "",
      demo: false,
      integrationStatus: dashboard.exchange.rates.length ? dashboard.status : "empty",
      rates: dashboard.exchange.rates,
      cached: dashboard.cached,
      lastSuccessfulAt: dashboard.lastSuccessfulAt,
      nextRefreshAt: dashboard.nextRefreshAt,
    }, { headers });
  }
  return Response.json({
    error: "unsupported_source",
    message: "Use /api/public-data/dashboard for cached public information.",
  }, { status: 400, headers });
}
