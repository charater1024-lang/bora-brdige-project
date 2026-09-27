import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ root: process.cwd(), configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": process.cwd() } }, server: { middlewareMode: true, hmr: { host: "127.0.0.1", port: 0 } } });
const dates = await server.ssrLoadModule("/lib/public-data/dates.ts");
const youth = await server.ssrLoadModule("/lib/public-data/youth-adapters.ts");
const retention = await server.ssrLoadModule("/lib/public-data/retention.ts");
const rag = await server.ssrLoadModule("/lib/rag/public-catalog.ts");
test.after(() => server.close());
const nowIso = "2026-09-01T00:00:00+09:00";
const now = Date.parse(nowIso);

function item(start, end, extra = {}) {
  return { ...youth.normalizeYouthCenterPortalJson({ result: [{ DOCID: "synthetic-date-case", PLCY_NM: "청년 멘토링 지원",
    PLCY_EXPLN_CN: "합성 일정 6/25, 6/26. 실제 정책이 아닙니다.",
    APLY_PRD_BGNG_YMD: start, APLY_PRD_END_YMD: end }] }, nowIso, new Map()).items[0], ...extra };
}

test("sentinels, partial dates and impossible dates never become application dates", () => {
  for (const value of [0, "0", "00000000", "알수없음", "미정", "상시", "6/25", "26.06.25", "2026", "2026-02-29", "2026-04-31", "2026-13-01", "2026-06-26T25:00:00", "2026-02-30T09:00:00Z", "31 Feb 2026 09:00:00 +0900", null, undefined]) {
    assert.equal(dates.normalizePublicDate(value), null, String(value));
  }
  assert.equal(dates.normalizePublicDate("2024-02-29"), "2024-02-29");
});

test("compact, separated and timestamp dates share strict KST day semantics", () => {
  for (const value of [20260626, "20260626", "2026-06-26", "2026.6.26", "2026/6/26", "2026년 6월 26일", "20260626090000", "2026.6.26 09:00:00", "2026-06-26T00:00:00", "2026-06-25T15:00:00Z", "2026-06-26T00:00:00+09:00"]) {
    assert.equal(dates.normalizePublicDate(value), "2026-06-26", String(value));
  }
  assert.equal(dates.normalizePublicDateTime("2026-07-23T09:00:00+09:00"), "2026-07-23T00:00:00.000Z");
  assert.equal(dates.normalizePublicDateTime("Thu, 23 Jul 2026 09:00:00 +0900"), "2026-07-23T00:00:00.000Z");
});

test("provider zero fields are displayed as unknown, with no fabricated 2000 expiry", () => {
  for (const value of [0, "0", "00000000", "알수없음", ""]) {
    const record = item(value, value);
    assert.equal(record.expiresAt, null);
    assert.equal(record.applicationStartsAt, null);
    assert.match(record.summary, /신청기간 미확인/u);
    assert.doesNotMatch(record.summary, /신청기간 0|1999|2000/u);
  }
});

test("long provider descriptions cannot truncate the complete application-period footer", () => {
  for (const [start, end] of [[0, 0], ["20260915", "20261015"], [0, "20261015"], ["20261015", "20260915"]]) {
    const record = youth.normalizeYouthCenterPortalJson({ result: [{
      DOCID: "synthetic-long-description", PLCY_NM: "합성 정책 긴 설명",
      PLCY_EXPLN_CN: "긴 소개 설명입니다. ".repeat(80), PLCY_SPRT_CN: "긴 지원 설명입니다. ".repeat(80),
      APLY_PRD_BGNG_YMD: start, APLY_PRD_END_YMD: end,
    }] }, nowIso, new Map()).items[0];
    assert.ok(record.summary.length <= 900);
    assert.ok(record.summary.endsWith(dates.publicApplicationPeriodLabel(start, end)));
    assert.match(record.summary, /… · 신청/u);
  }
  const xml = `<youthPolicyList><resultCode>00</resultCode><youthPolicy><bizId>synthetic-long-xml</bizId><polyBizSjnm>합성 정책</polyBizSjnm><polyItcnCn>${"소개 ".repeat(200)}</polyItcnCn><sporCn>${"지원 ".repeat(200)}</sporCn><rqutPrdCn>0 ~ 0</rqutPrdCn></youthPolicy></youthPolicyList>`;
  const xmlItem = youth.normalizeYouthCenterXml(xml, "employment", nowIso, new Map())[0];
  assert.ok(xmlItem.summary.length <= 900);
  assert.ok(xmlItem.summary.endsWith("신청기간 미확인 (원문 확인 필요)"));
});

test("XML periods reject zero values and preserve non-calendar provider guidance without claiming dates", () => {
  const xml = (period) => `<youthPolicyList><resultCode>00</resultCode><youthPolicy><bizId>synthetic-xml</bizId><polyBizSjnm>청년 지원 합성자료</polyBizSjnm><rqutPrdCn>${period}</rqutPrdCn></youthPolicy></youthPolicyList>`;
  const unknown = youth.normalizeYouthCenterXml(xml("0 ~ 0"), "employment", nowIso, new Map())[0];
  assert.equal(unknown.expiresAt, null);
  assert.match(unknown.summary, /신청기간 미확인/u);
  assert.doesNotMatch(unknown.summary, /0 ~ 0/u);
  const ongoingText = youth.normalizeYouthCenterXml(xml("예산 소진 시까지"), "employment", nowIso, new Map())[0];
  assert.equal(ongoingText.expiresAt, null);
  assert.match(ongoingText.summary, /예산 소진 시까지/u);
  const scheduled = youth.normalizeYouthCenterXml(xml("2026.09.15 ~ 2026.10.15"), "employment", nowIso, new Map())[0];
  assert.equal(scheduled.applicationStartsAt, "2026-09-15");
  assert.equal(dates.publicApplicationPeriod(scheduled, now).status, "upcoming");
});

test("explicit starts and deadlines expose upcoming, bounded, partial and conflicting states", () => {
  const check = (start, end) => dates.publicApplicationPeriod(item(start, end), now).status;
  assert.equal(check("20260915", "20261015"), "upcoming");
  assert.equal(check("20260815", "20260915"), "within-period");
  assert.equal(check("0", "20260915"), "deadline-known");
  assert.equal(check("20260815", "0"), "unknown");
  assert.equal(check("20260915", "20260615"), "unknown");
  assert.equal(check("20260601", "20260626"), "expired");
  const closing = item("20260801", "20260901");
  assert.equal(dates.publicApplicationPeriod(closing, Date.parse("2026-09-01T23:59:59.999+09:00")).status, "within-period");
  assert.equal(dates.publicApplicationPeriod(closing, Date.parse("2026-09-02T00:00:00+09:00")).status, "expired");
});

test("legacy zero repair is narrow, pure and idempotent; old legitimate deadlines survive", () => {
  for (const expiry of ["1999-12-31T15:00:00.000Z", "2000-01-01T00:00:00.000Z", "2000-01-01"]) {
    const legacy = Object.freeze(item(null, null, { summary: "합성 일정 6/25 · 신청기간 0 ~ 0", expiresAt: expiry }));
    const repaired = dates.repairYouthPolicyApplicationDates(legacy);
    assert.equal(legacy.expiresAt, expiry);
    assert.equal(repaired.expiresAt, null);
    assert.match(repaired.summary, /신청기간 미확인/u);
    assert.deepEqual(dates.repairYouthPolicyApplicationDates(repaired), repaired);
  }
  const legitimate = item(null, null, { summary: "2000년 정책의 역사 자료", expiresAt: "2000-01-01" });
  assert.equal(dates.repairYouthPolicyApplicationDates(legitimate).expiresAt, "2000-01-01");
  const other = { ...legitimate, id: "other-provider-1", summary: "신청기간 0 ~ 0" };
  assert.equal(dates.repairYouthPolicyApplicationDates(other), other);
  const noDates = { id: "youth-center-unknown", summary: "합성 행사 일정 6/25, 6/26" };
  assert.deepEqual(dates.repairYouthPolicyApplicationDates(noDates), noDates);
  const explicit = dates.repairYouthPolicyApplicationDates({ id: "youth-center-range", summary: "합성 정책 · 신청기간 20260915 ~ 20261015" });
  assert.equal(explicit.applicationStartsAt, "2026-09-15");
  assert.equal(explicit.expiresAt, "2026-10-15");
});

test("list and RAG agree on expiry for date, compact, ISO, unknown and legacy sentinel records", () => {
  const records = [
    item("0", "0"), item("", ""), item("20260601", "20260626"),
    item("2026-06-01", "2026-06-26"), item("", "", { expiresAt: "2026-06-26T00:00:00" }),
    item("", "", { expiresAt: "20260626" }), item("20260915", "20261015"),
    item("20260915", "20260615"), item("", "", { expiresAt: "2026-02-30" }),
    item("", "", { summary: "청년 멘토링 지원 · 신청기간 0 ~ 0", expiresAt: "1999-12-31T15:00:00.000Z" }),
  ];
  for (const record of records) {
    const active = retention.publicItemFreshness(record, now).active;
    const document = rag.publicItemRagDocument(record);
    assert.equal(rag.rankPublicRagDocuments("청년 멘토링 지원", [document], { now }).length > 0, active, JSON.stringify(record));
  }
  const upcoming = rag.rankPublicRagDocuments("청년 멘토링 지원", [rag.publicItemRagDocument(records[6])], { now });
  assert.match(upcoming[0].document.excerpt, /접수 예정/u);
});

test("SQL does not discard malformed/sentinel dates before common reranking can normalize them", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE public_data_catalog_chunks (source_id TEXT, category TEXT, chunk_index INTEGER,payload TEXT,item_count INTEGER,updated_at INTEGER,PRIMARY KEY(source_id,category,chunk_index)); CREATE TABLE public_api_source_state(source_id TEXT PRIMARY KEY,last_error TEXT);");
    db.exec(readFileSync(new URL("../drizzle/0023_public_rag_index.sql", import.meta.url), "utf8"));
    for (const expiry of ["0", "1000-01-01", "2026-02-30", "1999-12-31T15:00:00.000Z", "20260626", "2026-06-26T00:00:00", "2026-06-26"]) {
      const record = item("", "", { summary: "청년 멘토링 지원 · 신청기간 0 ~ 0", expiresAt: expiry });
      db.prepare("INSERT OR REPLACE INTO public_data_catalog_chunks VALUES(?,?,?,?,?,?)").run("synthetic-date", "youth", 0, JSON.stringify({ categories: [{ id: "youth", items: [record] }] }), 1, now);
      const rows = db.prepare(rag.PUBLIC_RAG_SEARCH_SQL).all(rag.publicRagMatchExpression("청년 멘토링 지원"), 0, "2026-09-01", 0);
      const docs = rows.map(({ payload }) => rag.publicItemRagDocument(JSON.parse(payload)));
      const included = rag.rankPublicRagDocuments("청년 멘토링 지원", docs, { now }).length > 0;
      assert.equal(included, retention.publicItemFreshness(record, now).active, expiry);
    }
    const ended = item("20260601", "20260626");
    db.prepare("INSERT OR REPLACE INTO public_data_catalog_chunks VALUES(?,?,?,?,?,?)").run("synthetic-date", "youth", 0, JSON.stringify({ categories: [{ id: "youth", items: [ended] }] }), 1, now);
    // Simulate the optional field carried by the new projection, while keeping
    // this regression runnable against the immutable 0023 base migration too.
    db.prepare("UPDATE public_rag_documents SET payload=json_set(payload,'$.applicationStartsAt',?)").run(ended.applicationStartsAt);
    assert.equal(db.prepare(rag.PUBLIC_RAG_SEARCH_SQL).all(rag.publicRagMatchExpression("청년 멘토링 지원"), 0, "2026-09-01", 0).length, 0);
  } finally { db.close(); }
});
