import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const page = readFileSync(
  `${projectRoot}/app/components/public-information-pages.tsx`,
  "utf8",
);
const styles = readFileSync(
  `${projectRoot}/app/components/public-information-pages.module.css`,
  "utf8",
);

test("product comparison keeps applied conditions and estimates in the visible result", () => {
  assert.match(page, /input:\s*recommendationInput\(value\.input\)/u);
  assert.match(page, /productCount:[\s\S]*value\.productCount/u);
  assert.match(page, /recommendation\.estimate\.maturityAmount/u);
  assert.match(page, /recommendation\.estimate\.grossInterest/u);
  assert.match(page, /copy\.compared\(result\.productCount\)/u);
  assert.match(page, /result\.input\.targetTermMonths/u);
});

test("product comparison formats won input and prevents duplicate loading requests", () => {
  assert.match(page, /function normalizedMoneyInput/u);
  assert.match(page, /formattedMoneyInput\(amount,\s*locale\)/u);
  assert.match(page, /disabled=\{recommendationState === "loading"\}/u);
  assert.match(page, /aria-busy=\{recommendationState === "loading"\}/u);
  assert.match(page, /typeof payload\?\.error === "string"/u);
});

test("missing rates remain undisclosed and recommendation summaries stay responsive", () => {
  assert.match(page, /disclosedRate === null \? copy\.unavailable/u);
  assert.doesNotMatch(page, /recommendation\.maximumRate \?\? recommendation\.baseRate \?\? 0/u);
  assert.match(styles, /\.recommendationApplied > dl/u);
  assert.match(styles, /\.recommendationEstimate/u);
  assert.match(styles, /recommendationApplied > dl,\s*\.recommendationEstimate > dl \{ grid-template-columns: repeat\(2/u);
});

test("finance separates product, indicator and market scopes with one catalogue pagination", () => {
  assert.match(page, /category === "finance" \? <>/u);
  assert.match(page, /<Activity mode=\{!failed && financeSection === "products" \? "visible" : "hidden"\}>/u);
  assert.match(page, /financeSection === "market" && <FinanceCatalogPage/u);
  assert.match(page, /financeSection === "indicators"/u);
  assert.match(page, /&section=\$\{financeSection\}&query=/u);
  assert.match(page, /<FinanceCatalogPage/u);
  assert.match(page, /styles\.catalogPagination/u);
  assert.match(page, /onPageChange\(1\)/u);
  assert.match(page, /onPageChange\(totalPages\)/u);
  assert.match(page, /for \(const item of \[\.\.\.items, \.\.\.supplementalItems\]\)/u);
  assert.match(page, /byId\.set\(item\.id, item\)/u);
  assert.doesNotMatch(page, /FINANCE_PRODUCT_PAGE_SIZE|productPageItems|safeProductPage/u);
  const tools = page.slice(page.indexOf("function FinanceInformation("), page.indexOf("function RecommendationList("));
  assert.doesNotMatch(tools, /supplementalItems|CatalogPagination/u);
  assert.match(tools, /<InformationList items=\{items\}/u);
});

test("finance page and back-navigation retain one stable in-memory tools boundary", () => {
  const start = page.indexOf('{category === "finance" ? <>');
  const end = page.indexOf(': category === "startup"', start);
  assert.ok(start >= 0 && end > start);
  const branch = page.slice(start, end);
  // The finance tools are never conditionally removed or keyed by the outer
  // page, loading state, or result. React Activity retains their local state.
  assert.match(branch, /<Activity mode=\{[^}]+\}>\s*<FinanceInformation[\s\S]*?\/>\s*<\/Activity>/u);
  assert.equal(branch.match(/<FinanceInformation\b/gu)?.length, 1);
  assert.doesNotMatch(branch, /\bkey=|&&\s*<FinanceInformation|\?\s*<FinanceInformation/u);
  const tools = page.slice(page.indexOf("function FinanceInformation("), page.indexOf("function RecommendationList("));
  for (const state of ["amount", "period", "liquidityNeed", "preferredChannel", "recommendationResult"]) {
    assert.match(tools, new RegExp(`const \\[${state},[^\\n]+useState`, "u"));
  }
  assert.doesNotMatch(tools, /localStorage|sessionStorage|history\.state|indexedDB/u);
  assert.match(tools, /<Activity mode=\{showTools \? "visible" : "hidden"\}>/u);
  assert.match(page, /catalogResultsRef\.current[\s\S]*scrollIntoView[\s\S]*focus/u);
});

test("startup keeps bounded analytics on page one and uses a clear catalogue view later", () => {
  assert.match(page, /category === "startup" \? <StartupInformation/u);
  assert.match(page, /supplementalItems=\{supplementalItems\}/u);
  assert.match(page, /showTools=\{currentPage === 1\}/u);
  assert.match(page, /for \(const item of \[\.\.\.items, \.\.\.supplementalItems\]\)/u);
});

test("product recommendations paginate the stable ranked result five at a time", () => {
  assert.match(page, /const recommendationsPerPage = 5/u);
  assert.match(page, /result\.recommendations\.slice\(pageStart,\s*pageStart \+ recommendationsPerPage\)/u);
  assert.match(page, /className=\{styles\.recommendationPagination\}/u);
  assert.match(page, /disabled=\{safeRecommendationPage <= 1\}/u);
  assert.match(page, /disabled=\{safeRecommendationPage >= recommendationPageCount\}/u);
  assert.match(styles, /\.recommendationPagination button:disabled/u);
});
