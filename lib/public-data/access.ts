import { isDeveloperUser } from "@/lib/auth/developer-access";
import type { StoredAuthUser } from "@/lib/auth/types";

import { redactPublicDashboardOperations } from "./operations-view";
import type { PublicDataDashboard, PublicInformationCategory } from "./types";
import {
  allYouthPoliciesDashboardForViewer,
  youthPolicyDashboardForViewer,
} from "./youth-policy-matching";
import { startupAnnouncementsForViewer } from "./startup-recommendations";

export type YouthPolicyDashboardView = "personalized" | "all";

export function projectPublicDashboardCategory(
  dashboard: PublicDataDashboard,
  category: PublicInformationCategory | null,
) {
  if (!category) return dashboard;
  return {
    ...dashboard,
    categories: dashboard.categories.filter((group) => group.id === category),
  };
}

/**
 * The home and information-hub surfaces use category counts, exchange rates,
 * market points, and source status only. Returning the compact snapshot's
 * catalogue preview on those routes wastes bandwidth and makes workerd retain
 * a second large response graph during JSON serialization.
 *
 * Keep this projection after viewer personalization/redaction so the existing
 * count semantics remain unchanged, while ensuring catalogue records and
 * detail-only facets never leave the server for summary consumers.
 */
export function projectPublicDashboardSummary(
  dashboard: PublicDataDashboard,
): PublicDataDashboard {
  return {
    ...dashboard,
    categories: dashboard.categories.map((group) => ({
      id: group.id,
      items: [],
      totalCount: group.totalCount,
      newCount: group.newCount,
    })),
  };
}

/**
 * API schedules, quota usage, provider failures, and adapter state are
 * operational metadata. Redact them server-side instead of trusting the UI to
 * hide them from ordinary members.
 */
export async function publicDashboardForViewer(
  dashboard: PublicDataDashboard,
  user: StoredAuthUser | null,
  options: { youthPolicyView?: YouthPolicyDashboardView } = {},
) {
  const canViewOperations = user
    ? await isDeveloperUser(user).catch(() => false)
    : false;
  // Official policy records are public reference information. Anonymous
  // viewers receive the neutral catalogue, while profile-based screening
  // remains available only to an authenticated viewer.
  const showAllYouthPolicies = options.youthPolicyView === "all" || !user;
  const youthDashboard = showAllYouthPolicies
    ? allYouthPoliciesDashboardForViewer(dashboard, user)
    : youthPolicyDashboardForViewer(dashboard, user);
  const viewerDashboard = startupAnnouncementsForViewer(youthDashboard, user);
  return redactPublicDashboardOperations(viewerDashboard, canViewOperations);
}
