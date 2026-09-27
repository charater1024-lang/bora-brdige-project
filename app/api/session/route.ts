import { NextResponse } from "next/server";

import {
  AUTH_PROVIDERS,
  type AuthProvider,
} from "../../../lib/auth/types";
import {
  isExternalAuthMode,
  providerIsAvailable,
} from "../../../lib/auth/config";
import {
  SESSION_COOKIE_NAME,
  readCookie,
} from "../../../lib/auth/http";
import { getUserForSession } from "../../../lib/auth/store";
import { isDeveloperUser } from "../../../lib/auth/developer-access";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
} as const;

function externalSignInPath(provider: AuthProvider) {
  return `/api/auth/${provider}?returnTo=%2F`;
}

export async function GET(request: Request) {
  if (await isExternalAuthMode()) {
    const providers = Object.fromEntries(
      await Promise.all(
        AUTH_PROVIDERS.map(async (provider) => [
          provider,
          await providerIsAvailable(request, provider),
        ] as const),
      ),
    ) as Record<AuthProvider, boolean>;
    const signInPaths = Object.fromEntries(
      AUTH_PROVIDERS.map((provider) => [provider, externalSignInPath(provider)]),
    ) as Record<AuthProvider, string>;
    const firstAvailable = AUTH_PROVIDERS.find((provider) => providers[provider]);
    const token = readCookie(request, SESSION_COOKIE_NAME);

    if (!token) {
      return NextResponse.json(
        {
          authenticated: false,
          user: null,
          provider: null,
          providers,
          signInPaths,
          signInPath: firstAvailable ? signInPaths[firstAvailable] : null,
          logoutPath: "/api/auth/logout",
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    try {
      const user = await getUserForSession(token);
      if (!user) {
        return NextResponse.json(
          {
            authenticated: false,
            user: null,
            provider: null,
            providers,
            signInPaths,
            signInPath: firstAvailable ? signInPaths[firstAvailable] : null,
            logoutPath: "/api/auth/logout",
          },
          { headers: NO_STORE_HEADERS },
        );
      }

      return NextResponse.json(
        {
          authenticated: true,
          isDeveloper: await isDeveloperUser(user),
          user: {
            id: user.id,
            provider: user.provider,
            displayName: user.displayName,
            name: user.name,
            nickname: user.nickname,
            displayNameMode: user.displayNameMode,
            boraAlias: user.boraAlias,
            email: user.email,
            emailVerified: user.emailVerified,
            profileImageUrl: user.profileImageUrl,
            gender: user.gender,
            birthday: user.birthday,
            birthYear: user.birthYear,
            ageRange: user.ageRange,
            youthPolicyProfile: user.youthPolicyProfile,
          },
          provider: user.provider,
          expiresAt: user.sessionExpiresAt,
          providers,
          signInPaths,
          signInPath: signInPaths[user.provider],
          logoutPath: "/api/auth/logout",
        },
        { headers: NO_STORE_HEADERS },
      );
    } catch {
      return NextResponse.json(
        {
          authenticated: false,
          user: null,
          provider: null,
          providers,
          signInPaths,
          signInPath: firstAvailable ? signInPaths[firstAvailable] : null,
          logoutPath: "/api/auth/logout",
          error: "auth_storage_unavailable",
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
  }

  return NextResponse.json(
    {
      authenticated: false,
      user: null,
      provider: null,
      providers: { google: false, kakao: false, naver: false },
      signInPaths: {},
      signInPath: null,
    },
    { headers: NO_STORE_HEADERS },
  );
}
