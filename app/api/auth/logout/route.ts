import { isExternalAuthMode } from "@/lib/auth/config";
import {
  AUTH_NO_STORE_HEADERS,
  SESSION_COOKIE_NAME,
  jsonNoStore,
  readCookie,
  requireSameOrigin,
  requestUsesHttps,
  sessionCookie,
} from "@/lib/auth/http";
import { deleteAuthSession } from "@/lib/auth/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await isExternalAuthMode())) {
    return jsonNoStore({ error: "sites_auth_is_dispatch_managed" }, 409);
  }

  if (!(await requireSameOrigin(request))) {
    return jsonNoStore({ error: "origin_mismatch" }, 403);
  }

  const token = readCookie(request, SESSION_COOKIE_NAME);
  let storageAvailable = true;
  if (token) {
    try {
      await deleteAuthSession(token);
    } catch {
      storageAvailable = false;
    }
  }

  const response = Response.json(
    { loggedOut: true, storageAvailable },
    { status: storageAvailable ? 200 : 503, headers: AUTH_NO_STORE_HEADERS },
  );
  response.headers.set(
    "Set-Cookie",
    sessionCookie({ token: "", maxAgeSeconds: 0, secure: await requestUsesHttps(request) }),
  );
  return response;
}
