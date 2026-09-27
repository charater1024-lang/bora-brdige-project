import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: { alias: { "@": projectRoot } },
  server: { middlewareMode: true },
});
const { startupAnnouncementsForViewer } = await server.ssrLoadModule(
  "/lib/public-data/startup-recommendations.ts",
);
const { STARTUP_PROVINCE_BY_REGION } = await server.ssrLoadModule(
  "/lib/public-data/startup-region-view.ts",
);
test.after(() => server.close());

function item(id, overrides = {}) {
  return {
    id,
    category: "startup",
    title: "공식 창업 지원 공고",
    summary: "공식 지원사업 요약",
    source: "K-Startup",
    sourceUrl: `https://www.k-startup.go.kr/web/notice/${id}`,
    sourceLinkKind: "detail",
    publishedAt: "2026-07-26",
    discoveredAt: "2026-07-26T00:00:00.000Z",
    lastVerifiedAt: "2026-07-28T00:00:00.000Z",
    tags: [],
    ...overrides,
  };
}

function dashboard(items) {
  return {
    exchange: { source: "official", sourceUrl: "https://example.com", asOf: null, rates: [] },
    market: [],
    categories: [
      { id: "youth", items: [], totalCount: 0, newCount: 0 },
      { id: "finance", items: [], totalCount: 0, newCount: 0 },
      { id: "startup", items, totalCount: items.length, newCount: 0 },
      { id: "employment", items: [], totalCount: 0, newCount: 0 },
    ],
    sources: [],
    status: "live",
    cached: true,
    stale: false,
    lastSuccessfulAt: "2026-07-28T00:00:00.000Z",
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
    birthYear: "2000",
    ageRange: null,
    youthPolicyProfile: {
      enabled: true,
      birthYear: 2000,
      region: "seoul",
      status: "job_seeker",
      interests: ["startup"],
      ...profile,
    },
    createdAt: 0,
    updatedAt: 0,
  };
}

test("startup notices receive a viewer-only shortlist while commercial areas stay untouched", () => {
  const source = dashboard([
    item("kstartup-seoul", {
      title: "서울 예비창업자 청년 사업화 지원",
      tags: ["서울특별시", "예비창업자", "청년"],
    }),
    item("bizinfo-nationwide", {
      title: "전국 창업기업 지원",
      tags: ["전국", "창업기업"],
    }),
    item("commercial-zone-1", {
      title: "공식 상권",
      commercialArea: {
        areaSquareMeters: 100,
        referenceDate: "2026-06-30",
        coordinateCount: 0,
      },
    }),
  ]);
  const result = startupAnnouncementsForViewer(
    source,
    user(),
    new Date("2026-07-28T00:00:00.000Z"),
  );
  const startup = result.categories.find((group) => group.id === "startup");
  const ranked = startup.items.filter((entry) => entry.startupMatch);

  assert.deepEqual(ranked.map((entry) => entry.id), ["kstartup-seoul", "bizinfo-nationwide"]);
  assert.equal(ranked[0].startupMatch.rank, 1);
  assert.ok(ranked[0].startupMatch.signals.includes("preferred_region"));
  assert.ok(ranked[0].startupMatch.signals.includes("prospective_founder"));
  assert.equal(startup.items.find((entry) => entry.id === "commercial-zone-1").startupMatch, undefined);
  assert.equal(result.startupAnnouncementPersonalization.status, "ready");
  assert.equal(result.startupAnnouncementPersonalization.recommendedCount, 2);
  assert.equal(source.categories[2].items.every((entry) => entry.startupMatch === undefined), true);
});

test("provider-wide province taxonomy never creates a preferred-region recommendation signal", () => {
  const allProvinceTags = Object.values(STARTUP_PROVINCE_BY_REGION);
  const source = dashboard([
    item("kstartup-trusted-seoul", {
      tags: ["서울특별시", "창업", "예비창업자", "청년"],
    }),
    item("kstartup-provider-taxonomy", {
      title: "영월군 청년 예비창업자 지원",
      tags: [...allProvinceTags, "창업", "예비창업자", "청년", "영월군"],
    }),
    item("kstartup-taxonomy-nationwide", {
      tags: [...allProvinceTags, "전국", "창업", "예비창업자", "청년"],
    }),
  ]);
  const result = startupAnnouncementsForViewer(
    source,
    user(),
    new Date("2026-07-28T00:00:00.000Z"),
  );
  const startup = result.categories.find((group) => group.id === "startup");
  const matches = new Map(startup.items.map((entry) => [entry.id, entry.startupMatch]));

  assert.ok(matches.get("kstartup-trusted-seoul").signals.includes("preferred_region"));
  assert.equal(
    matches.get("kstartup-provider-taxonomy").signals.includes("preferred_region"),
    false,
  );
  assert.equal(matches.get("kstartup-provider-taxonomy").signals.includes("nationwide"), false);
  assert.ok(matches.get("kstartup-taxonomy-nationwide").signals.includes("nationwide"));
  assert.ok(
    matches.get("kstartup-trusted-seoul").rank
      < matches.get("kstartup-provider-taxonomy").rank,
  );
});

test("collector discovery does not make an old or undated startup notice look recent", () => {
  const now = new Date("2026-07-28T00:00:00.000Z");
  const source = dashboard([
    item("kstartup-officially-recent", {
      publishedAt: "2026-07-26",
      discoveredAt: "2026-07-28T00:00:00.000Z",
    }),
    item("kstartup-old-newly-seen", {
      publishedAt: "2024-01-01",
      discoveredAt: "2026-07-28T00:00:00.000Z",
      lastVerifiedAt: "2026-07-28T00:00:00.000Z",
    }),
    item("kstartup-undated-newly-seen", {
      publishedAt: null,
      discoveredAt: "2026-07-28T00:00:00.000Z",
      lastVerifiedAt: "2026-07-28T00:00:00.000Z",
    }),
  ]);
  const result = startupAnnouncementsForViewer(source, user(), now);
  const startup = result.categories.find((group) => group.id === "startup");
  const signalsById = new Map(startup.items.map((entry) => [
    entry.id,
    entry.startupMatch?.signals ?? [],
  ]));

  assert.equal(signalsById.get("kstartup-officially-recent").includes("recent_notice"), true);
  assert.equal(signalsById.get("kstartup-old-newly-seen").includes("recent_notice"), false);
  assert.equal(signalsById.get("kstartup-undated-newly-seen").includes("recent_notice"), false);
});

test("historical undated K-Startup editions cannot consume the viewer shortlist", () => {
  const result = startupAnnouncementsForViewer(dashboard([
    item("kstartup-14326", {
      title: "2012년 전국창업경진대회 왕중왕전 SUPER STAR V",
      publishedAt: null,
      sourceUpdatedAt: null,
      applicationStartsAt: null,
      expiresAt: null,
      discoveredAt: "2026-08-31T00:00:00.000Z",
      lastVerifiedAt: "2026-08-31T00:00:00.000Z",
      tags: ["서울특별시", "예비창업자", "청년"],
    }),
    item("kstartup-current", {
      title: "2026년 서울 예비창업자 청년 지원",
      tags: ["서울특별시", "예비창업자", "청년"],
    }),
  ]), user(), new Date("2026-09-01T00:00:00.000Z"));
  const startup = result.categories.find((group) => group.id === "startup");

  assert.equal(startup.items.find(({ id }) => id === "kstartup-14326").startupMatch, undefined);
  assert.equal(startup.items.find(({ id }) => id === "kstartup-current").startupMatch.rank, 1);
  assert.equal(result.startupAnnouncementPersonalization.sourceCount, 1);
  assert.equal(result.startupAnnouncementPersonalization.recommendedCount, 1);
});

test("startup matching reports authentication, opt-in and incomplete-profile states", () => {
  const source = dashboard([item("kstartup-1")]);
  assert.equal(
    startupAnnouncementsForViewer(source, null).startupAnnouncementPersonalization.status,
    "sign_in_required",
  );
  assert.equal(
    startupAnnouncementsForViewer(source, user({ enabled: false })).startupAnnouncementPersonalization.status,
    "personalization_disabled",
  );
  const incomplete = startupAnnouncementsForViewer(source, user({
    birthYear: null,
    region: null,
    status: null,
    interests: [],
  }));
  assert.equal(incomplete.startupAnnouncementPersonalization.status, "profile_incomplete");
  assert.deepEqual(
    incomplete.startupAnnouncementPersonalization.missingProfileFields,
    ["region", "status", "interests"],
  );
});

test("startup UI includes K-Startup, the mascot and an explicit no-auto-billing explanation", async () => {
  const page = await readFile(
    new URL("../app/components/public-information-pages.tsx", import.meta.url),
    "utf8",
  );
  const component = await readFile(
    new URL("../app/components/startup-announcement-recommendations.tsx", import.meta.url),
    "utf8",
  );
  const myPage = await readFile(new URL("../app/mypage/page.tsx", import.meta.url), "utf8");
  const mascot = await stat(new URL("../public/bora-mascot.webp", import.meta.url));

  assert.match(page, /items\.filter\(isStartupAnnouncementItem\)/u);
  const { isStartupAnnouncementItem } = await server.ssrLoadModule("/lib/public-data/startup-region-view.ts");
  assert.equal(isStartupAnnouncementItem(item("kstartup-synthetic")), true);
  assert.equal(isStartupAnnouncementItem(item("commercial-synthetic")), false);
  assert.equal(isStartupAnnouncementItem(item("seoul-commercial-synthetic")), false);
  assert.equal(isStartupAnnouncementItem(item("arbitrary-geometry", { commercialArea: { areaSquareMeters: 100 } })), false);
  assert.match(page, /StartupAnnouncementRecommendations/u);
  assert.match(component, /src="\/bora-mascot\.webp"/u);
  assert.match(component, /유료 AI는 자동 호출하지 않습니다/u);
  assert.match(myPage, /정책·창업 기회 맞춤 정보/u);
  assert.match(myPage, /입력값은 정책·창업 공고 후보를 좁히는 데만 쓰며/u);
  assert.ok(mascot.size > 10_000 && mascot.size < 200_000);
});
