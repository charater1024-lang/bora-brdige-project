import { environmentValue } from "@/lib/runtime-settings";

import {
  configuredDeveloperIdentityMatches,
  normalizeDeveloperIdentity,
} from "./developer-policy";
import type { StoredAuthUser } from "./types";

async function configuredDeveloperIdentities() {
  const configuredIdentities = (await environmentValue("DEVELOPER_ADMIN_IDENTITIES"))
    ?.split(",")
    .map(normalizeDeveloperIdentity)
    .filter(Boolean) ?? [];
  return configuredIdentities;
}

export async function isDeveloperUser(user: StoredAuthUser): Promise<boolean> {
  const configuredIdentities = await configuredDeveloperIdentities();
  return configuredDeveloperIdentityMatches(user, configuredIdentities);
}
