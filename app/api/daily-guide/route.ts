import { authenticatedUser } from "@/lib/auth/current-user";
import { jsonNoStore } from "@/lib/auth/http";
import { buildDailyFinanceGuide } from "@/lib/daily-finance-guide";
import { getManualFinanceSnapshot } from "@/lib/manual-finance-store";
import { publicDashboardForViewer } from "@/lib/public-data/access";
import { getPublicDashboard } from "@/lib/public-data/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await authenticatedUser(request).catch(() => null);
  try {
    const [snapshot, dashboard] = await Promise.all([
      user ? getManualFinanceSnapshot(user.id) : Promise.resolve(null),
      getPublicDashboard(user),
    ]);
    const viewerDashboard = await publicDashboardForViewer(dashboard, user);
    const unreadOfficialItems = viewerDashboard.categories.reduce(
      (total, category) => total + category.newCount,
      0,
    );
    const publicDataAvailable = viewerDashboard.status !== "empty"
      && viewerDashboard.categories.some((category) => category.totalCount > 0);

    return jsonNoStore(buildDailyFinanceGuide({
      authenticated: Boolean(user),
      snapshot,
      youthPolicyProfile: user?.youthPolicyProfile ?? null,
      unreadOfficialItems,
      publicDataAvailable,
    }));
  } catch {
    return jsonNoStore({ error: "daily_guide_unavailable" }, 503);
  }
}
