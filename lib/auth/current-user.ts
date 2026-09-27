import { isExternalAuthMode } from "./config";
import { isDeveloperUser } from "./developer-access";
import { SESSION_COOKIE_NAME, readCookie } from "./http";
import { getUserForSession } from "./store";

export async function authenticatedUser(request: Request) {
  if (!(await isExternalAuthMode())) return null;
  const token = readCookie(request, SESSION_COOKIE_NAME);
  return token ? getUserForSession(token) : null;
}

export async function authenticatedDeveloper(request: Request) {
  const user = await authenticatedUser(request);
  return user && await isDeveloperUser(user) ? user : null;
}
