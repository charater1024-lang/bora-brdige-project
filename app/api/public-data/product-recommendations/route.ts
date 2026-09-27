import { authenticatedUser } from "@/lib/auth/current-user";
import { characterBodyLimits, readBoundedRequestText, requestBodyErrorResponse } from "@/lib/http/request-body";
import {
  normalizeRecommendationInput,
  PRODUCT_RECOMMENDATION_LOCALES,
  productRecommendationDisclaimer,
  recommendFinancialProducts,
  type ProductRecommendationLocale,
} from "@/lib/public-data/recommendations";
import { readPublicSourceCatalog } from "@/lib/public-data/cache";
import {
  getPublicDashboard,
  mergeCatalogWithSnapshot,
} from "@/lib/public-data/service";
import type { PublicInformationItem } from "@/lib/public-data/types";

export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function finlifeProducts(items: readonly PublicInformationItem[]) {
  return items.filter((item) => (
    item.id.startsWith("finlife-")
    && item.category === "finance"
  ));
}

function latestProductVerification(
  products: readonly PublicInformationItem[],
  fallback: string | null,
) {
  const timestamp = Math.max(0, ...products.flatMap((product) => (
    [product.lastVerifiedAt, product.publishedAt, product.discoveredAt]
      .map((value) => value ? Date.parse(value) : Number.NaN)
      .filter(Number.isFinite)
  )));
  return timestamp > 0 ? new Date(timestamp).toISOString() : fallback;
}

export async function POST(request: Request) {
  // Authentication enriches response context when a session exists, but this
  // endpoint neither stores the submitted amounts nor calls a paid provider.
  // Keep the rules-only public comparison usable from the public finance page.
  const user = await authenticatedUser(request).catch(() => null);

  let raw: string;
  try {
    raw = await readBoundedRequestText(request, characterBodyLimits(8_000));
  } catch (error) {
    const bodyError = requestBodyErrorResponse(error);
    if (bodyError) return bodyError;
    return response({ error: "invalid_request" }, 400);
  }
  if (raw.length > 8_000) return response({ error: "request_too_large" }, 413);

  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) as unknown : {};
  } catch {
    return response({ error: "invalid_json" }, 400);
  }
  const input = normalizeRecommendationInput(body);
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const locale: ProductRecommendationLocale = typeof record.locale === "string"
    && PRODUCT_RECOMMENDATION_LOCALES.includes(record.locale as ProductRecommendationLocale)
    ? record.locale as ProductRecommendationLocale
    : "ko";

  try {
    const baseDashboard = await getPublicDashboard(user);
    const snapshotProducts = baseDashboard.categories
      .flatMap((group) => group.items)
      .filter((item) => item.id.startsWith("finlife-"));
    // A finance category can contain tens of thousands of stock, disclosure,
    // and company records. Loading that entire category for a recommendation
    // request made a 96-item Finlife comparison unnecessarily slow and prone
    // to storage/response-size failures. Read the provider's bounded catalogue
    // directly, while retaining the compact snapshot as a migration/outage
    // fallback.
    const providerCatalog = await readPublicSourceCatalog("finlife")
      .catch(() => []);
    const products = finlifeProducts(mergeCatalogWithSnapshot(
      snapshotProducts,
      providerCatalog,
    ));
    return response({
      generatedBy: "rules-v1",
      aiUsed: false,
      authenticated: Boolean(user),
      input,
      // Rank the saved provider catalogue once so result pages can be changed
      // locally without repeating a public API request or changing the order.
      recommendations: recommendFinancialProducts(products, input, locale, products.length),
      productCount: products.length,
      catalogSource: providerCatalog.length > 0
        ? "finlife-source-catalog"
        : "dashboard-snapshot",
      asOf: latestProductVerification(products, baseDashboard.lastSuccessfulAt),
      locale,
      disclaimer: productRecommendationDisclaimer(locale),
    });
  } catch {
    return response({ error: "product_catalog_unavailable" }, 503);
  }
}
