import { authenticatedUser } from "@/lib/auth/current-user";
import {
  projectPublicDashboardCategory,
  projectPublicDashboardSummary,
  publicDashboardForViewer,
} from "@/lib/public-data/access";
import {
  filterAndPaginatePublicDashboard,
  publicDashboardWithCatalogCounts,
  publicDashboardWithCategoryCatalog,
  publicDashboardWithYouthCatalog,
  getPublicDashboard,
  readPublicCatalogVersion,
} from "@/lib/public-data/service";
import { compactCommercialAnalyticsDashboard } from "@/lib/public-data/commercial-supplement";
import {
  PUBLIC_CATEGORIES,
  type PublicDataFreshnessFilter,
  type PublicInformationCategory,
} from "@/lib/public-data/types";
import { YOUTH_POLICY_REGIONS } from "@/lib/auth/youth-policy-profile";
import { YOUTH_POLICY_SECTION_IDS } from "@/lib/public-data/youth-policy-sections";

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const requestedCategory = searchParams.get("category");
  const requestedView = searchParams.get("view");
  const requestedFreshness = searchParams.get("freshness") ?? "active";
  const requestedYouthSection = searchParams.get("section");
  const requestedYouthRegion = searchParams.get("region");
  const requestedIncludeNationwide = searchParams.get("includeNationwide");
  const requestedIncludeSupplemental = searchParams.get("includeSupplemental");
  const requestedQuery = searchParams.get("query");
  const requestedCatalogVersion = searchParams.get("catalogVersion");
  if (requestedCatalogVersion !== null && !/^v1-[a-f0-9]{64}$/u.test(requestedCatalogVersion)) {
    return Response.json({ error: "invalid_public_catalog_version" }, { status: 400, headers: RESPONSE_HEADERS });
  }
  const financeSections = ["products", "indicators", "market"] as const;
  if (requestedQuery !== null && ((requestedCategory !== "startup" && requestedCategory !== "finance") || requestedQuery.length > 200)) {
    return Response.json({ error: "invalid_startup_query" }, { status: 400, headers: RESPONSE_HEADERS });
  }
  const allowedFreshness: PublicDataFreshnessFilter[] = [
    "active", "recent-7d", "recent-30d", "expired", "review-needed", "all",
  ];
  if (requestedCategory !== null
    && !PUBLIC_CATEGORIES.includes(requestedCategory as PublicInformationCategory)) {
    return Response.json({ error: "invalid_public_information_category" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  if (requestedView !== null
    && requestedView !== "personalized"
    && requestedView !== "all") {
    return Response.json({ error: "invalid_youth_policy_view" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  if (!allowedFreshness.includes(requestedFreshness as PublicDataFreshnessFilter)) {
    return Response.json({ error: "invalid_public_data_freshness" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  if (requestedYouthSection !== null
    && !(requestedCategory === "finance"
      ? financeSections.includes(requestedYouthSection as (typeof financeSections)[number])
      : YOUTH_POLICY_SECTION_IDS.includes(requestedYouthSection as (typeof YOUTH_POLICY_SECTION_IDS)[number]))) {
    return Response.json({ error: "invalid_youth_policy_section" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  if (requestedYouthRegion !== null
    && requestedYouthRegion !== "nationwide"
    && !YOUTH_POLICY_REGIONS.includes(requestedYouthRegion as (typeof YOUTH_POLICY_REGIONS)[number])) {
    return Response.json({ error: "invalid_youth_policy_region" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  if (requestedIncludeNationwide !== null
    && requestedIncludeNationwide !== "true"
    && requestedIncludeNationwide !== "false") {
    return Response.json({ error: "invalid_youth_policy_nationwide_option" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  if (requestedIncludeSupplemental !== null
    && requestedIncludeSupplemental !== "true"
    && requestedIncludeSupplemental !== "false") {
    return Response.json({ error: "invalid_public_data_supplemental_option" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  const category = requestedCategory as PublicInformationCategory | null;
  const page = Number(searchParams.get("page") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "48");
  if (
    !Number.isSafeInteger(page)
    || page < 1
    || !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > 50
  ) {
    return Response.json({ error: "invalid_public_data_page" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  if (requestedView !== null && category !== "youth") {
    return Response.json({ error: "youth_policy_view_requires_youth_category" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  if ((category !== "youth" && category !== "finance" && requestedYouthSection !== null)
    || (category !== "youth" && category !== "startup" && (
    requestedYouthRegion !== null
    || requestedIncludeNationwide !== null
  ))) {
    return Response.json({ error: "youth_policy_filter_requires_youth_category" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  if (requestedIncludeNationwide !== null
    && (requestedYouthRegion === null || requestedYouthRegion === "nationwide")) {
    return Response.json({ error: "youth_policy_nationwide_option_requires_region" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  if (requestedIncludeSupplemental === "true"
    && category !== "finance"
    && category !== "startup") {
    return Response.json({ error: "public_data_supplemental_requires_supported_category" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  const user = await authenticatedUser(request).catch(() => null);
  // Page reads never wait for upstream collection or consume its quota.
  // The scheduler and authenticated POST refresh keep the shared cache current;
  // viewer-specific projection still happens below, with private/no-store headers.
  let cachedDashboard;
  try {
    cachedDashboard = await getPublicDashboard(user, { failOnStorageError: true });
  } catch {
    return Response.json({ error: "public_data_storage_unavailable" }, {
      status: 503,
      headers: RESPONSE_HEADERS,
    });
  }
  let sourceDashboard;
  let catalogVersion: string | undefined;
  try {
    if (category) {
      catalogVersion = await readPublicCatalogVersion(category, cachedDashboard.lastSuccessfulAt);
      if (requestedCatalogVersion && requestedCatalogVersion !== catalogVersion) {
        return Response.json({ error: "public_catalog_changed", catalogVersion }, { status: 409, headers: RESPONSE_HEADERS });
      }
    }
    const categoryDashboard = category === "youth"
      ? await publicDashboardWithYouthCatalog(cachedDashboard, user)
      : category
        ? await publicDashboardWithCategoryCatalog(cachedDashboard, user, category)
        : cachedDashboard;
    sourceDashboard = category
      ? categoryDashboard
      : await publicDashboardWithCatalogCounts(categoryDashboard);
  } catch (error) {
    if (error instanceof Error && error.message === "public_catalog_changed") {
      return Response.json({ error: "public_catalog_changed" }, { status: 409, headers: RESPONSE_HEADERS });
    }
    // A compact preview is not a successfully loaded complete catalogue.
    return Response.json({ error: "public_data_catalog_unavailable" }, {
      status: 503, headers: RESPONSE_HEADERS,
    });
  }
  const viewerDashboard = await publicDashboardForViewer(sourceDashboard, user, {
    youthPolicyView: !category || requestedView === "all" || !user
      || (requestedView === null && user.youthPolicyProfile?.enabled !== true) ? "all" : "personalized",
  });
  const filteredDashboard = category
    ? filterAndPaginatePublicDashboard(
        viewerDashboard,
        category,
        requestedFreshness as PublicDataFreshnessFilter,
        page,
        pageSize,
        Date.now(),
        {
          section: category === "youth"
            ? requestedYouthSection as (typeof YOUTH_POLICY_SECTION_IDS)[number] | null : null,
          financeSection: category === "finance"
            ? requestedYouthSection as (typeof financeSections)[number] | null : null,
          region: requestedYouthRegion as (typeof YOUTH_POLICY_REGIONS)[number] | "nationwide" | null,
          includeNationwide: requestedIncludeNationwide === null
            ? category !== "startup"
            : requestedIncludeNationwide === "true",
          query: requestedQuery ?? undefined,
        },
        requestedIncludeSupplemental === "true",
      )
    : viewerDashboard;
  const projectedDashboard = category
    ? projectPublicDashboardCategory(filteredDashboard, category)
    : projectPublicDashboardSummary(filteredDashboard);
  const dashboard = category === "startup"
    ? compactCommercialAnalyticsDashboard(projectedDashboard)
    : projectedDashboard;
  if (category) {
    try {
      const current = await readPublicCatalogVersion(category, cachedDashboard.lastSuccessfulAt);
      if (current !== catalogVersion) {
        return Response.json({ error: "public_catalog_changed", catalogVersion: current }, { status: 409, headers: RESPONSE_HEADERS });
      }
    } catch {
      return Response.json({ error: "public_data_catalog_unavailable" }, { status: 503, headers: RESPONSE_HEADERS });
    }
  }
  return Response.json({ ...dashboard, ...(catalogVersion ? { catalogVersion } : {}) }, {
    status: 200,
    headers: RESPONSE_HEADERS,
  });
}
