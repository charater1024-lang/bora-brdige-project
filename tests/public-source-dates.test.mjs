import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const server = await createServer({ root: process.cwd(), configFile: false, appType: "custom", logLevel: "silent",
  resolve: { alias: { "@": process.cwd() } }, server: { middlewareMode: true } });
test.after(() => server.close());
const dates = await server.ssrLoadModule("/lib/public-data/dates.ts");
const retention = await server.ssrLoadModule("/lib/public-data/retention.ts");
const nowIso = "2026-08-31T16:29:15Z";
const now = Date.parse(nowIso);
const old = { id: "youth-center-synthetic", category: "youth", source: "온통청년", publishedAt: "2026-01-01T00:00:00.018Z",
  discoveredAt: "2026-08-01T00:00:00Z", lastVerifiedAt: "2026-08-31T14:58:42.581Z", expiresAt: null, summary: "합성 자료" };

test("portal publication, update and ambiguous DATE preserve separate bounded provenance", () => {
  const item = dates.normalizeYouthPortalSourceDates({ FRST_REG_DT: "20260801", LAST_MDFCN_DT: "2026-08-31 18:33:02.903", DATE: "20260831" }, nowIso);
  assert.equal(item.publishedAt, "2026-08-01");
  assert.equal(item.sourceUpdatedAt, "2026-08-31T09:33:02.903Z");
  assert.equal(item.sourceDateMetadata.rawSourceUpdatedAt, "2026-08-31 18:33:02.903");
  assert.equal(item.sourceDateMetadata.rawPortalDate, "20260831");
  const ambiguous = dates.normalizeYouthPortalSourceDates({ DATE: "20260831", LAST_MDFCN_DT: "20260831" }, nowIso);
  assert.equal(ambiguous.publishedAt, null);
  assert.equal(ambiguous.sourceUpdatedAt, "2026-08-31");
});
test("XML publication and update remain distinct and arbitrary raw text is never retained", () => {
  const item = dates.normalizeYouthPortalSourceDates({ frstRgstDt: "20260801", lastCntcUpdtDt: "20260830" }, nowIso);
  assert.equal(item.publishedAt, "2026-08-01");
  assert.equal(item.sourceUpdatedAt, "2026-08-30");
  assert.equal(item.sourceDateMetadata.sourceUpdatedAtField, "lastCntcUpdtDt");
  const rejected = dates.normalizeYouthPortalSourceDates({ FRST_REG_DT: "contact secret@example.com 2026", LAST_MDFCN_DT: "1".repeat(81), DATE: "0" }, nowIso);
  assert.equal(rejected.sourceDateMetadata.rawPublishedAt, undefined);
  assert.equal(rejected.sourceDateMetadata.rawSourceUpdatedAt, undefined);
  assert.equal(rejected.publishedAt, null);
});
test("future legacy publication is quarantined without timezone guessing and stays idempotent", () => {
  const original = { ...old, publishedAt: "2026-08-31T18:33:02.903Z" };
  const fixed = dates.repairYouthPolicySourceDates(original, now);
  assert.equal(fixed.publishedAt, null);
  assert.equal(fixed.sourceDateMetadata.rawPublishedAt, original.publishedAt);
  assert.equal(fixed.sourceDateMetadata.publishedAtStatus, "future");
  assert.deepEqual(dates.repairYouthPolicySourceDates(fixed, now + 86400000), fixed);
  assert.equal(original.publishedAt, "2026-08-31T18:33:02.903Z");
});
test("valid last verification is the upper bound; discovery is not an update ceiling", () => {
  const tooLate = dates.repairYouthPolicySourceDates({ ...old, publishedAt: "2026-08-31T15:30:00Z" }, now);
  assert.equal(tooLate.sourceDateMetadata.publishedAtStatus, "future");
  const valid = dates.repairYouthPolicySourceDates({ ...old, publishedAt: "2026-08-30T00:00:00Z" }, now);
  assert.equal(valid.publishedAt, "2026-08-30T00:00:00Z");
  const legacy = dates.repairYouthPolicySourceDates(old, now);
  assert.equal(legacy.publishedAt, old.publishedAt);
  assert.equal(legacy.sourceDateMetadata.publishedAtStatus, "legacy-unverified");
});
test("date-only anchors use KST midnight and known update provenance is required", () => {
  assert.equal(dates.publicDateInstant("20260901"), Date.parse("2026-08-31T15:00:00Z"));
  const item = { sourceUpdatedAt: "2026-09-01" };
  assert.equal(dates.publicItemRecency(item, now), 0);
  assert.equal(dates.publicItemRecency({ ...item, sourceDateMetadata: { version: 1, sourceUpdatedAtField: "LAST_MDFCN_DT", sourceUpdatedAtStatus: "valid" } }, now), Date.parse("2026-08-31T15:00:00Z"));
});
test("future verification anchors never become fresh after quarantine", () => {
  const item = dates.repairYouthPolicySourceDates({ ...old, lastVerifiedAt: "2026-09-02T00:00:00Z", discoveredAt: "2026-09-02T00:00:00Z" }, now);
  assert.ok(item.sourceDateMetadata.rejectedAnchors.lastVerifiedAt);
  assert.equal(dates.publicItemRecency(item, now + 7 * 86400000), Date.parse(old.publishedAt));
  assert.deepEqual(retention.filterPublicInformationItems([item], "recent-7d", now), []);
});
test("collector discovery and verification never make undated or old notices recent", () => {
  const undated = { ...old, publishedAt: null, discoveredAt: nowIso, lastVerifiedAt: nowIso };
  const oldButRefetched = { ...old, discoveredAt: nowIso, lastVerifiedAt: nowIso };
  assert.equal(dates.publicItemRecency(undated, now), 0);
  assert.equal(dates.publicItemRecency(oldButRefetched, now), Date.parse(old.publishedAt));
  assert.deepEqual(retention.filterPublicInformationItems(
    [undated, oldButRefetched],
    "recent-30d",
    now,
  ), []);
});
test("same rejected provider raw date cannot revive when refetched later", () => {
  const raw = { FRST_REG_DT: "2026-09-02T00:00:00Z", LAST_MDFCN_DT: "0" };
  const first = dates.normalizeYouthPortalSourceDates(raw, nowIso);
  const later = dates.normalizeYouthPortalSourceDates(raw, "2026-09-03T00:00:00Z", first);
  assert.equal(later.publishedAt, null);
  assert.equal(later.sourceDateMetadata.publishedAtStatus, "future");
  assert.equal(later.sourceDateMetadata.sourceUpdatedAtStatus, "invalid");
});
test("non-youth records and existing zero-period repair semantics are unchanged", () => {
  const item = { ...old, id: "ecos-synthetic" };
  assert.equal(dates.repairYouthPolicySourceDates(item, now), item);
  const zero = { ...old, summary: "신청기간 0 ~ 0", expiresAt: "2000-01-01T00:00:00.000Z" };
  const fixed = dates.repairYouthPolicySourceDates(dates.repairYouthPolicyApplicationDates(zero), now);
  assert.equal(fixed.expiresAt, null);
  assert.equal(fixed.publishedAt, old.publishedAt);
});
