import { authenticatedUser } from "@/lib/auth/current-user";
import { requireSameOrigin } from "@/lib/auth/http";
import { readBoundedRequestJson, requestBodyErrorResponse } from "@/lib/http/request-body";
import {
  CommercialSearchError,
  listCommercialIndustries,
  searchCommercialAreas,
  searchCommercialStores,
} from "@/lib/public-data/commercial-store-search";

export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
} as const;

function isJsonRequest(request: Request) {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    === "application/json";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function integerParameter(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : Number.NaN;
}

function stringParameter(value: unknown) {
  return typeof value === "string" ? value : null;
}

export async function POST(request: Request) {
  const user = await authenticatedUser(request).catch(() => null);
  if (!user) {
    return Response.json({ error: "authentication_required" }, {
      status: 401,
      headers: RESPONSE_HEADERS,
    });
  }
  if (!(await requireSameOrigin(request))) {
    return Response.json({ error: "origin_mismatch" }, {
      status: 403,
      headers: RESPONSE_HEADERS,
    });
  }
  if (!isJsonRequest(request)) {
    return Response.json({ error: "json_content_type_required" }, {
      status: 415,
      headers: RESPONSE_HEADERS,
    });
  }

  let body: Record<string, unknown> | null;
  try {
    body = record(await readBoundedRequestJson(request, { maxBytes: 16_000 }));
  } catch (error) {
    return requestBodyErrorResponse(error) ?? Response.json(
      { error: "invalid_commercial_search_request" },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }
  if (!body) {
    return Response.json({ error: "invalid_commercial_search_request" }, {
      status: 400,
      headers: RESPONSE_HEADERS,
    });
  }
  const kind = stringParameter(body.kind) ?? "stores";
  const page = integerParameter(body.page, 1);
  const pageSize = integerParameter(body.pageSize, kind === "areas" ? 20 : 24);

  try {
    const result = kind === "industries"
      ? await listCommercialIndustries(user.id)
      : kind === "areas"
        ? await searchCommercialAreas({
            provinceCode: stringParameter(body.provinceCode) ?? "",
            query: stringParameter(body.query) ?? "",
            page,
            pageSize,
            userId: user.id,
          })
        : kind === "stores"
          ? await searchCommercialStores({
              provinceCode: stringParameter(body.provinceCode),
              areaCode: stringParameter(body.areaCode),
              industryCode: stringParameter(body.industryCode),
              page,
              pageSize,
              userId: user.id,
            })
          : null;
    if (!result) {
      return Response.json({ error: "invalid_commercial_search_kind" }, {
        status: 400,
        headers: RESPONSE_HEADERS,
      });
    }
    return Response.json(result, { headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof CommercialSearchError) {
      // Codes are generated locally. Never log upstream URLs, keys or raw errors.
      if (error.status >= 500) {
        console.warn("[commercial-search] request failed", { code: error.code, status: error.status });
      }
      return Response.json({ error: error.code }, {
        status: error.status,
        headers: {
          ...RESPONSE_HEADERS,
          ...(error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : {}),
        },
      });
    }
    console.error("[commercial-search] request failed", {
      code: "commercial_search_internal_error",
      status: 503,
    });
    return Response.json({ error: "commercial_search_unavailable" }, {
      status: 503,
      headers: RESPONSE_HEADERS,
    });
  }
}
