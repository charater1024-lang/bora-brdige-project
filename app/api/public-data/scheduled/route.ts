import { isAiContextCleanupDue, purgeAllExpiredAiContext } from "@/lib/ai/context-store";
import { refreshPublicDashboard } from "@/lib/public-data/service";
import { environmentValue } from "@/lib/runtime-settings";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

function constantTimeEqual(left: string, right: string) {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

async function isAuthorized(request: Request, secret: string) {
  const authorization = request.headers.get("authorization") ?? "";
  return constantTimeEqual(authorization, `Bearer ${secret}`);
}

export async function POST(request: Request) {
  const secret = await environmentValue("SCHEDULER_SECRET");
  if (!secret || secret.length < 32) {
    return Response.json(
      { error: "scheduler_secret_missing" },
      { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  }
  if (!(await isAuthorized(request, secret))) {
    return Response.json(
      { error: "invalid_scheduler_secret" },
      { status: 401 },
    );
  }

  const cleanupDue = isAiContextCleanupDue(new Date());
  const cleanupPromise = cleanupDue
    ? purgeAllExpiredAiContext().then(() => "completed" as const).catch(() => "unavailable" as const)
    : Promise.resolve("not-due" as const);
  const [result, aiContextCleanup] = await Promise.all([
    refreshPublicDashboard(null, "scheduled"),
    cleanupPromise,
  ]);
  const status = result.kind === "storage-unavailable"
    ? 503
    : result.kind === "unavailable"
      ? 502
      : 200;
  return Response.json({
    refreshResult: result.kind,
    aiContextCleanup,
    status: result.dashboard.status,
    lastSuccessfulAt: result.dashboard.lastSuccessfulAt,
    nextRefreshAt: result.dashboard.nextRefreshAt,
    sources: result.dashboard.sources.map((source) => ({
      id: source.id,
      status: source.status,
      itemCount: source.itemCount,
      errorCode: source.errorCode ?? null,
    })),
  }, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
