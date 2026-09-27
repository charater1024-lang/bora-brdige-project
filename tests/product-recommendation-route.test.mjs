import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("product recommendations load only the Finlife provider catalogue", () => {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const route = readFileSync(
    `${projectRoot}/app/api/public-data/product-recommendations/route.ts`,
    "utf8",
  );

  assert.match(route, /readPublicSourceCatalog\("finlife"\)/u);
  assert.match(route, /mergeCatalogWithSnapshot\(\s*snapshotProducts,\s*providerCatalog/u);
  assert.match(route, /catalogSource:\s*providerCatalog\.length > 0/u);
  assert.doesNotMatch(route, /publicDashboardWithCategoryCatalog/u);
});

test("product recommendation catalogue excludes unrelated rows and remains public", () => {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const route = readFileSync(
    `${projectRoot}/app/api/public-data/product-recommendations/route.ts`,
    "utf8",
  );

  assert.match(route, /item\.id\.startsWith\("finlife-"\)/u);
  assert.match(route, /item\.category === "finance"/u);
  assert.match(route, /latestProductVerification\(products, baseDashboard\.lastSuccessfulAt\)/u);
  assert.match(route, /recommendFinancialProducts\(products,\s*input,\s*locale,\s*products\.length\)/u);
  assert.match(route, /authenticated:\s*Boolean\(user\)/u);
  assert.doesNotMatch(route, /if\s*\(!user\)[^\n]*authentication_required/u);
});
