import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

async function modules(context) {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const server = await createServer({
    root: projectRoot,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  context.after(() => server.close());
  return {
    profile: await server.ssrLoadModule("/lib/auth/youth-policy-profile.ts"),
    matcher: await server.ssrLoadModule("/lib/public-data/youth-policy-matching.ts"),
  };
}

function policy(id, eligibility) {
  return {
    id,
    category: "youth",
    title: `${id} 정책`,
    summary: "공식 정책 설명",
    source: "공식 제공기관",
    sourceUrl: "https://example.go.kr/policy",
    publishedAt: "2026-07-20",
    discoveredAt: "2026-07-20T00:00:00.000Z",
    tags: [],
    ...(eligibility ? { youthPolicyEligibility: eligibility } : {}),
  };
}

function dashboard(items) {
  return {
    exchange: { source: "", sourceUrl: "", asOf: null, rates: [] },
    market: [],
    categories: [
      { id: "youth", items, totalCount: items.length, newCount: items.length },
      { id: "finance", items: [], totalCount: 0, newCount: 0 },
      { id: "startup", items: [], totalCount: 0, newCount: 0 },
    ],
    sources: [],
    status: "live",
    cached: true,
    stale: false,
    lastSuccessfulAt: "2026-07-20T00:00:00.000Z",
    nextRefreshAt: null,
    canRefresh: false,
    refreshInSeconds: 0,
    authenticated: true,
    sourceSchedules: [],
  };
}

function user(profile = {}) {
  return {
    id: "user-1",
    provider: "naver",
    subject: "subject-1",
    displayName: "Bora",
    name: "Bora",
    nickname: "bora",
    displayNameMode: "nickname",
    boraAlias: null,
    email: null,
    emailVerified: null,
    profileImageUrl: null,
    gender: null,
    birthday: null,
    birthYear: null,
    ageRange: null,
    youthPolicyProfile: {
      enabled: true,
      birthYear: null,
      region: null,
      status: null,
      interests: [],
      ...profile,
    },
    createdAt: 0,
    updatedAt: 0,
  };
}

test("policy profile accepts only coarse allow-listed fields", async (context) => {
  const { profile } = await modules(context);
  const normalized = profile.normalizeYouthPolicyProfile({
    enabled: true,
    birthYear: "1998",
    region: "seoul",
    status: "job_seeker",
    interests: ["employment", "employment", "housing"],
  }, new Date("2026-07-22T00:00:00.000Z"));
  assert.deepEqual(normalized, {
    enabled: true,
    birthYear: 1998,
    region: "seoul",
    status: "job_seeker",
    interests: ["employment", "housing"],
  });
  assert.throws(
    () => profile.normalizeYouthPolicyProfile({ ...normalized, exactIncome: 30_000_000 }),
    (error) => error.code === "unsupported_youth_policy_profile_field",
  );
  assert.throws(
    () => profile.normalizeYouthPolicyProfile({ ...normalized, region: "서울시 강남구" }),
    (error) => error.code === "invalid_youth_policy_region",
  );
});

test("server returns only policies matching explicit structured conditions", async (context) => {
  const { matcher } = await modules(context);
  const sourceItems = [
    policy("university", { statuses: ["university"], interests: ["education"] }),
    policy("high-school", { statuses: ["high_school"], interests: ["education"] }),
    policy("seoul-job", { regions: ["seoul"], statuses: ["job_seeker"], interests: ["employment"] }),
    // Even a suggestive title is not mined when the adapter supplied no
    // machine-readable eligibility.
    { ...policy("unstructured"), title: "서울 대학생 맞춤 정책" },
  ];
  const original = dashboard(sourceItems);
  const result = matcher.youthPolicyDashboardForViewer(original, user({
    region: "seoul",
    status: "university",
    interests: ["education"],
  }), new Date("2026-07-22T00:00:00.000Z"));

  const youth = result.categories.find((group) => group.id === "youth");
  assert.deepEqual(youth.items.map((item) => item.id), ["university"]);
  assert.equal(youth.items[0].youthPolicyMatch.fitScore, 80);
  assert.equal(youth.items[0].youthPolicyMatch.requiresOfficialConfirmation, true);
  assert.equal(result.youthPolicyPersonalization.status, "ready");
  assert.equal(result.youthPolicyPersonalization.excludedCount, 2);
  assert.equal(result.youthPolicyPersonalization.unassessedCount, 1);
  assert.equal(result.youthPolicyPersonalization.hiddenCount, 3);
  assert.equal(sourceItems[0].youthPolicyMatch, undefined, "shared cache objects must stay viewer-neutral");
});

test("missing profile details hide candidates and identify only needed fields", async (context) => {
  const { matcher } = await modules(context);
  const source = dashboard([
    policy("regional-student", {
      regions: ["seoul"],
      statuses: ["university"],
      interests: ["education"],
    }),
  ]);
  const result = matcher.youthPolicyDashboardForViewer(source, user({ region: "seoul" }));
  assert.equal(result.categories[0].items.length, 0);
  assert.equal(result.youthPolicyPersonalization.status, "profile_incomplete");
  assert.deepEqual(
    new Set(result.youthPolicyPersonalization.missingProfileFields),
    new Set(["status", "interests"]),
  );
  assert.equal(result.youthPolicyPersonalization.missingInformationCount, 1);
});

test("age matching keeps birth-year boundary overlaps as candidates with an official-check warning", async (context) => {
  const { matcher } = await modules(context);
  const source = dashboard([
    policy("age-and-status", {
      minAge: 19,
      maxAge: 34,
      statuses: ["job_seeker"],
      interests: ["employment"],
    }),
    policy("age-boundary", {
      minAge: 19,
      maxAge: 33,
      interests: ["employment"],
    }),
  ]);
  const viewer = user({
    birthYear: 1992,
    status: "job_seeker",
    interests: ["employment"],
  });
  const result = matcher.youthPolicyDashboardForViewer(
    source,
    viewer,
    new Date("2026-07-22T00:00:00.000Z"),
  );
  assert.deepEqual(result.categories[0].items.map((item) => item.id), ["age-and-status", "age-boundary"]);
  const boundary = result.categories[0].items.find((item) => item.id === "age-boundary");
  assert.deepEqual(boundary.youthPolicyMatch.officialConfirmationFields, ["birthYear"]);
  assert.equal(boundary.youthPolicyMatch.requiresOfficialConfirmation, true);
  assert.equal(result.youthPolicyPersonalization.missingInformationCount, 0);
  assert.deepEqual(result.youthPolicyPersonalization.missingProfileFields, []);
  assert.equal(result.youthPolicyPersonalization.status, "ready");

  const providerYearViewer = user({ status: "job_seeker", interests: ["employment"] });
  providerYearViewer.birthYear = "2000";
  const fallback = matcher.youthPolicyDashboardForViewer(source, providerYearViewer, new Date("2026-07-22T00:00:00.000Z"));
  assert.equal(fallback.categories[0].items.some((item) => item.id === "age-and-status"), true);
});

test("an age-restricted policy asks for birth year only when no age information exists", async (context) => {
  const { matcher } = await modules(context);
  const source = dashboard([
    policy("age-needs-profile", {
      minAge: 19,
      maxAge: 34,
      interests: ["employment"],
    }),
  ]);
  const result = matcher.youthPolicyDashboardForViewer(
    source,
    user({ interests: ["employment"] }),
    new Date("2026-07-22T00:00:00.000Z"),
  );
  assert.deepEqual(result.categories[0].items, []);
  assert.equal(result.youthPolicyPersonalization.status, "profile_incomplete");
  assert.equal(result.youthPolicyPersonalization.missingInformationCount, 1);
  assert.deepEqual(result.youthPolicyPersonalization.missingProfileFields, ["birthYear"]);
});

test("exact provider birthday age is calculated on the Asia/Seoul calendar date", async (context) => {
  const { matcher } = await modules(context);
  const source = dashboard([policy("birthday-age", { minAge: 26, maxAge: 26 })]);
  const viewer = user();
  viewer.birthYear = "2000";
  viewer.birthday = "07-22";

  // July 21 in UTC, but already July 22 in Seoul.
  const result = matcher.youthPolicyDashboardForViewer(
    source,
    viewer,
    new Date("2026-07-21T15:30:00.000Z"),
  );
  assert.deepEqual(result.categories[0].items.map((item) => item.id), ["birthday-age"]);
  assert.deepEqual(result.categories[0].items[0].youthPolicyMatch.matchedFields, ["birthYear"]);
});

test("interest-only structured eligibility is screenable", async (context) => {
  const { matcher } = await modules(context);
  const source = dashboard([
    policy("employment-interest", { interests: ["employment"] }),
    policy("housing-interest", { interests: ["housing"] }),
  ]);
  const result = matcher.youthPolicyDashboardForViewer(source, user({ interests: ["employment"] }));
  assert.deepEqual(result.categories[0].items.map((item) => item.id), ["employment-interest"]);
  assert.equal(result.youthPolicyPersonalization.status, "ready");
  assert.equal(result.youthPolicyPersonalization.excludedCount, 1);
  assert.equal(result.youthPolicyPersonalization.unassessedCount, 0);
});

test("anonymous or opted-out viewers never receive profile-based youth matches", async (context) => {
  const { matcher } = await modules(context);
  const source = dashboard([
    policy("student", { statuses: ["university"], interests: ["education"] }),
  ]);
  const anonymous = matcher.youthPolicyDashboardForViewer(source, null);
  const disabled = matcher.youthPolicyDashboardForViewer(source, user({ enabled: false }));
  assert.equal(anonymous.categories[0].items.length, 0);
  assert.equal(anonymous.youthPolicyPersonalization.status, "sign_in_required");
  assert.equal(disabled.categories[0].items.length, 0);
  assert.equal(disabled.youthPolicyPersonalization.status, "personalization_disabled");
});

test("the public all view returns viewer-neutral official policies", async (context) => {
  const { matcher } = await modules(context);
  const source = dashboard([
    policy("matching", { statuses: ["university"], interests: ["education"] }),
    policy("not-matching", { statuses: ["job_seeker"], interests: ["employment"] }),
    policy("unassessed"),
  ]);
  source.categories[0].totalCount = 3_000;
  const viewer = user({ status: "university", interests: ["education"] });
  const anonymous = matcher.allYouthPoliciesDashboardForViewer(source, null);
  const result = matcher.allYouthPoliciesDashboardForViewer(source, viewer);
  const youth = result.categories.find((group) => group.id === "youth");

  assert.deepEqual(
    anonymous.categories[0].items.map((item) => item.id),
    ["matching", "not-matching", "unassessed"],
  );
  assert.equal(anonymous.categories[0].items.every((item) => item.youthPolicyMatch === undefined), true);
  assert.equal(anonymous.categories[0].totalCount, 3_000);
  assert.equal(anonymous.youthPolicyPersonalization.status, "sign_in_required");
  assert.deepEqual(youth.items.map((item) => item.id), ["matching", "not-matching", "unassessed"]);
  assert.equal(youth.items.every((item) => item.youthPolicyMatch === undefined), true);
  assert.equal(result.youthPolicyPersonalization.recommendedCount, 1);
  assert.equal(result.youthPolicyPersonalization.hiddenCount, 2);
  assert.equal(source.categories[0].items.every((item) => item.youthPolicyMatch === undefined), true);
});

test("legacy eligibility without interests is handled as an empty interest list", async (context) => {
  const { matcher } = await modules(context);
  const source = dashboard([
    policy("legacy-student", { statuses: ["university"] }),
  ]);
  const result = matcher.youthPolicyDashboardForViewer(source, user({ status: "university" }));
  assert.deepEqual(result.categories[0].items.map((item) => item.id), ["legacy-student"]);
  assert.equal(result.youthPolicyPersonalization.status, "ready");
});

test("youth page distinguishes every personalization state in four languages without presenting a score", async () => {
  const component = await readFile(new URL("../app/components/youth-policy-personalization.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/components/public-information-pages.tsx", import.meta.url), "utf8");
  const myPage = await readFile(new URL("../app/mypage/page.tsx", import.meta.url), "utf8");
  for (const locale of ["ko", "en", "ja", "zh"]) assert.match(component, new RegExp(`\\b${locale}: \\{`, "u"));
  for (const status of ["sign_in_required", "personalization_disabled", "profile_incomplete", "ready", "no_matches"]) {
    assert.match(component, new RegExp(status, "u"));
  }
  assert.match(page, /YouthPolicyPersonalizationBanner/u);
  assert.match(page, /YouthPolicyMatchEvidence match=\{item\.youthPolicyMatch\}/u);
  assert.match(component, /ageBoundaryConfirm/u);
  assert.match(component, /officialConfirmationFields/u);
  assert.match(page, /<YouthPolicyFourSections/u);
  assert.match(page, /dashboard=\{dashboard\}/u);
  assert.doesNotMatch(component, /fitScore/u, "the UI should explain matched fields rather than advertise a probability-like score");
  assert.match(myPage, /정확한 소득, 상세주소, 자유서술 내용은 수집하지 않습니다/u);
  assert.match(myPage, /저장된 맞춤 정보 삭제/u);
  assert.match(myPage, /입력값은 삭제 버튼을 누르기 전까지 보관됩니다/u);
  assert.match(myPage, /youthPolicyProfile/u);
  assert.match(myPage, /saveYouthPolicyProfile\(cleared, true\)/u);
  assert.doesNotMatch(myPage, /setPolicyProfile\(cleared\)/u, "deletion must preserve the previous form until the server confirms success");
});
