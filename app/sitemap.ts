import type { MetadataRoute } from "next";

import { configuredPublicOrigin } from "@/lib/auth/config";

const PUBLIC_ROUTES = [
  "",
  "/challenge",
  "/safety",
  "/assets",
  "/opportunities",
  "/ai-guide",
  "/information",
  "/information/youth",
  "/information/finance",
  "/information/startup",
  "/information/employment",
  "/information/settlement",
  "/exchange",
  "/privacy",
  "/terms",
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = (await configuredPublicOrigin()) ?? "https://borabridge.com";

  return PUBLIC_ROUTES.map((path) => ({
    url: `${origin}${path || "/"}`,
    changeFrequency: path === "" ? "daily" : path.startsWith("/information") ? "daily" : "weekly",
    priority: path === "" ? 1 : path === "/challenge" ? 0.9 : 0.7,
  }));
}
