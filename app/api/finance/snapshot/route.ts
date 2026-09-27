import { authenticatedUser } from "@/lib/auth/current-user";
import {
  AccountLifecycleError,
  requireCurrentRequiredConsent,
} from "@/lib/auth/account-lifecycle";
import { jsonNoStore, requireSameOrigin } from "@/lib/auth/http";
import {
  MAX_MANUAL_FINANCE_REQUEST_BYTES,
  ManualFinanceSnapshotError,
  parseManualFinanceSnapshotInput,
} from "@/lib/manual-finance-snapshot";
import {
  deleteManualFinanceSnapshot,
  getManualFinanceSnapshot,
  saveManualFinanceSnapshot,
} from "@/lib/manual-finance-store";

export const dynamic = "force-dynamic";

function isJsonRequest(request: Request) {
  return request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase() === "application/json";
}

async function boundedJsonBody(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength)
    && declaredLength > MAX_MANUAL_FINANCE_REQUEST_BYTES
  ) {
    throw new ManualFinanceSnapshotError(
      "finance_snapshot_too_large",
      "Finance snapshot request is too large.",
    );
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  const reader = request.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_MANUAL_FINANCE_REQUEST_BYTES) {
        await reader.cancel();
        throw new ManualFinanceSnapshotError(
          "finance_snapshot_too_large",
          "Finance snapshot request is too large.",
        );
      }
      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ManualFinanceSnapshotError(
      "invalid_json",
      "Finance snapshot request is not valid JSON.",
    );
  }
}

export async function GET(request: Request) {
  let user;
  try {
    user = await authenticatedUser(request);
  } catch {
    return jsonNoStore({ error: "finance_snapshot_unavailable" }, 503);
  }
  if (!user) return jsonNoStore({ error: "authentication_required" }, 401);
  try {
    await requireCurrentRequiredConsent(user.id);
    const snapshot = await getManualFinanceSnapshot(user.id);
    return jsonNoStore({ authenticated: true, principalKey: user.id, snapshot });
  } catch (error) {
    if (error instanceof AccountLifecycleError && error.code === "required_consent_missing") {
      return jsonNoStore({ error: error.code }, 428);
    }
    return jsonNoStore({ error: "finance_snapshot_unavailable" }, 503);
  }
}

export async function PUT(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return jsonNoStore({ error: "origin_mismatch" }, 403);
  }
  if (!isJsonRequest(request)) {
    return jsonNoStore({ error: "application_json_required" }, 415);
  }

  let user;
  try {
    user = await authenticatedUser(request);
  } catch {
    return jsonNoStore({ error: "finance_snapshot_unavailable" }, 503);
  }
  if (!user) return jsonNoStore({ error: "authentication_required" }, 401);

  try {
    await requireCurrentRequiredConsent(user.id);
    const input = parseManualFinanceSnapshotInput(await boundedJsonBody(request));
    const snapshot = await saveManualFinanceSnapshot(user.id, input);
    return jsonNoStore({ authenticated: true, principalKey: user.id, saved: true, snapshot });
  } catch (error) {
    if (error instanceof AccountLifecycleError && error.code === "required_consent_missing") {
      return jsonNoStore({ error: error.code }, 428);
    }
    if (error instanceof ManualFinanceSnapshotError) {
      return jsonNoStore(
        { error: error.code },
        error.code === "finance_snapshot_too_large" ? 413 : 400,
      );
    }
    return jsonNoStore({ error: "finance_snapshot_unavailable" }, 503);
  }
}

export async function DELETE(request: Request) {
  if (!(await requireSameOrigin(request))) {
    return jsonNoStore({ error: "origin_mismatch" }, 403);
  }
  let user;
  try {
    user = await authenticatedUser(request);
  } catch {
    return jsonNoStore({ error: "finance_snapshot_unavailable" }, 503);
  }
  if (!user) return jsonNoStore({ error: "authentication_required" }, 401);
  try {
    await requireCurrentRequiredConsent(user.id);
    await deleteManualFinanceSnapshot(user.id);
    return jsonNoStore({ deleted: true, snapshot: null });
  } catch (error) {
    if (error instanceof AccountLifecycleError && error.code === "required_consent_missing") {
      return jsonNoStore({ error: error.code }, 428);
    }
    return jsonNoStore({ error: "finance_snapshot_unavailable" }, 503);
  }
}
