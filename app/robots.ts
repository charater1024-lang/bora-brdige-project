import type { MetadataRoute } from "next";

import { configuredPublicOrigin } from "@/lib/auth/config";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = (await configuredPublicOrigin()) ?? "https://borabridge.com";

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/developer", "/mypage", "/_sites-preview"],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
