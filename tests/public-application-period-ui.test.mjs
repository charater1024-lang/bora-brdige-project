import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent",
  optimizeDeps: { noDiscovery: true, include: [] }, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
test.after(() => vite.close());
const { applicationPeriodView } = await vite.ssrLoadModule("/app/components/public-application-period.ts");
const now = Date.parse("2026-09-01T03:00:00Z");
const item = (extra = {}) => ({ id: "youth-center-synthetic", category: "youth", ...extra });

test("missing and invalid application dates never become an open application claim", () => {
  for (const extra of [{}, { expiresAt: "0" }, { applicationStartsAt: "0", expiresAt: "0" },
    { applicationStartsAt: "2026-10-01", expiresAt: "2026-09-15" }]) {
    const view = applicationPeriodView(item(extra), "ko", now);
    assert.equal(view.status, "unknown");
    assert.equal(view.label, "신청기간 확인 필요");
    assert.equal(view.dates, "공식 원문 확인 필요");
  }
});

test("cards distinguish upcoming, stated date range, deadline-only and expired records", () => {
  for (const [extra, status, label] of [
    [{ applicationStartsAt: "2026-09-10", expiresAt: "2026-09-30" }, "upcoming", "모집 예정"],
    [{ applicationStartsAt: "2026-08-01", expiresAt: "2026-09-30" }, "within-period", "기재된 신청기간 내 · 원문 확인"],
    [{ expiresAt: "2026-09-30" }, "deadline-known", "마감일 확인 · 시작일 미확인"],
    [{ expiresAt: "2026-08-31" }, "expired", "마감"],
  ]) {
    const view = applicationPeriodView(item(extra), "ko", now);
    assert.equal(view.status, status);
    assert.equal(view.label, label);
    assert.ok(view.dates.includes(extra.expiresAt));
  }
});

test("all supported locales distinguish missing dates and never label news or indicators as applications", () => {
  for (const locale of ["ko", "en", "ja", "zh"]) {
    assert.equal(applicationPeriodView(item(), locale, now).status, "unknown");
    assert.ok(applicationPeriodView(item(), locale, now).label.length > 0);
    for (const extra of [{ category: "finance" }, { employmentStatistic: {} }, { commercialArea: {} },
      { id: "moel-news-synthetic" }, { id: "youth-policy-news-synthetic" }]) {
      assert.equal(applicationPeriodView(item(extra), locale, now), null);
    }
  }
});

test("the active filter and existing card facts disclose their date boundaries", async () => {
  const source = await readFile(new URL("../app/components/public-information-pages.tsx", import.meta.url), "utf8");
  assert.match(source, /active: "마감되지 않은 정보"/u);
  assert.match(source, /모집 예정·마감일 미확인 자료도 포함/u);
  assert.doesNotMatch(source, /active: "(?:진행 중·유효|Active|受付中・有効|进行中·有效)"/u);
  assert.match(source, /applicationPeriodView\(item, locale\)/u);
  assert.match(source, /applicationPeriod\.label/u);
  assert.match(source, /applicationPeriod\.dates/u);
});
