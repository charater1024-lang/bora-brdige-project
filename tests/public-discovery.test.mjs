import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  layout,
  challengeLayout,
  robots,
  sitemap,
  manifest,
  myPageLayout,
  employmentPage,
  settlementLayout,
] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/challenge/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/robots.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/sitemap.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/manifest.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/mypage/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/(public-information)/information/employment/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/(public-information)/information/settlement/layout.tsx", import.meta.url), "utf8"),
]);

test("public discovery metadata exposes the canonical app assets", () => {
  assert.match(layout, /manifest: "\/manifest\.webmanifest"/u);
  assert.match(layout, /url: "\/favicon\.svg"/u);
  assert.match(layout, /https:\/\/borabridge\.com/u);
  assert.match(layout, /alternates: \{ canonical: "\/" \}/u);
  assert.match(manifest, /name: "BORA Bridge"/u);
  assert.match(manifest, /start_url: "\/"/u);
  assert.match(manifest, /display: "standalone"/u);
  assert.match(manifest, /src: "\/favicon\.svg"/u);
  assert.match(manifest, /purpose: "any"/u);
});

test("challenge sharing uses its dedicated image and canonical route", () => {
  assert.match(challengeLayout, /alternates: \{ canonical: "\/challenge" \}/u);
  assert.match(challengeLayout, /url: "\/og-challenge\.png"/u);
  assert.match(challengeLayout, /width: 1731/u);
  assert.match(challengeLayout, /height: 909/u);
  assert.match(challengeLayout, /images: \["\/og-challenge\.png"\]/u);
});

test("robots keeps private surfaces out of search while publishing a sitemap", () => {
  for (const privatePath of ["/api/", "/developer", "/mypage", "/_sites-preview"]) {
    assert.match(robots, new RegExp(privatePath.replace("/", "\\/"), "u"));
  }
  assert.match(robots, /sitemap: `\$\{origin\}\/sitemap\.xml`/u);
  assert.match(robots, /host: origin/u);
  assert.match(myPageLayout, /index: false/u);
  assert.match(myPageLayout, /noimageindex: true/u);
});

test("sitemap includes every public decision path and excludes account surfaces", () => {
  for (const publicPath of [
    "/challenge",
    "/safety",
    "/assets",
    "/opportunities",
    "/ai-guide",
    "/information/youth",
    "/information/finance",
    "/information/startup",
    "/information/employment",
    "/information/settlement",
    "/exchange",
    "/privacy",
    "/terms",
  ]) {
    assert.match(sitemap, new RegExp(`"${publicPath.replaceAll("/", "\\/")}"`, "u"));
  }
  assert.doesNotMatch(sitemap, /"\/mypage"|"\/developer"|"\/api\//u);
  assert.doesNotMatch(sitemap, /lastModified: new Date|const now = new Date/u);
});

test("previously metadata-less public information routes have stable canonicals", () => {
  assert.match(employmentPage, /alternates: \{ canonical: "\/information\/employment" \}/u);
  assert.match(settlementLayout, /alternates: \{ canonical: "\/information\/settlement" \}/u);
});
