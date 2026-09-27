import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

async function loadSections(context) {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const server = await createServer({
    root: projectRoot,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  context.after(() => server.close());
  return await server.ssrLoadModule("/lib/public-data/youth-policy-sections.ts");
}

async function loadSectionsComponent(context) {
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const server = await createServer({
    root: projectRoot,
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    resolve: { alias: { "@": projectRoot } },
    server: { middlewareMode: true },
  });
  context.after(() => server.close());
  return await server.ssrLoadModule("/app/components/youth-policy-four-sections.tsx");
}

function policy(id, interests = [], extra = {}) {
  return {
    id,
    category: "youth",
    title: `${id} 공식정보`,
    summary: "공식 제공기관 설명",
    source: "공식 제공기관",
    sourceUrl: "https://example.go.kr/policy",
    sourceLinkKind: "detail",
    publishedAt: "2026-07-22",
    discoveredAt: "2026-07-22T00:00:00.000Z",
    tags: [],
    youthPolicyEligibility: { interests },
    youthPolicyMatch: {
      fitScore: 80,
      matchedFields: ["interests"],
      requiresOfficialConfirmation: true,
    },
    ...extra,
  };
}

function dashboard(items, status = "ready") {
  return {
    categories: [
      { id: "youth", items, totalCount: items.length, newCount: items.length },
      { id: "finance", items: [], totalCount: 0, newCount: 0 },
      { id: "startup", items: [], totalCount: 0, newCount: 0 },
    ],
    youthPolicyPersonalization: {
      status,
      sourceCount: items.length,
      recommendedCount: items.length,
      hiddenCount: 0,
      excludedCount: 0,
      missingInformationCount: 0,
      unassessedCount: 0,
      missingProfileFields: [],
      profilePath: "/mypage",
      methodology: "structured-criteria-only",
    },
  };
}

test("personalized youth records are grouped into four structured sections", async (context) => {
  const sectionsModule = await loadSections(context);
  const sections = sectionsModule.personalizedYouthPolicySections(dashboard([
    policy("kosaf-university-1", ["education"]),
    policy("loan-youth-1", ["finance"]),
    policy("work24-job-1", ["employment"]),
    policy("youth-policy-news-1", []),
  ]));

  assert.deepEqual(sections.map((section) => section.id), [
    "scholarship",
    "financial_support",
    "employment",
    "policy_news",
  ]);
  assert.deepEqual(sections.map((section) => section.count), [1, 1, 1, 1]);
  assert.equal(sections.find((section) => section.id === "employment").items[0].id, "work24-job-1");
});

test("a raw or opted-out dashboard cannot expose an indiscriminate youth list", async (context) => {
  const sectionsModule = await loadSections(context);
  const item = policy("work24-job-hidden", ["employment"]);
  const raw = sectionsModule.personalizedYouthPolicySections({
    categories: dashboard([item]).categories,
  });
  const disabled = sectionsModule.personalizedYouthPolicySections(
    dashboard([item], "personalization_disabled"),
  );

  assert.equal(raw.reduce((count, section) => count + section.count, 0), 0);
  assert.equal(disabled.reduce((count, section) => count + section.count, 0), 0);
});

test("the public all-view presentation groups every server-authorized item", async (context) => {
  const sectionsModule = await loadSections(context);
  const items = [
    policy("kosaf-all-1", ["education"], { youthPolicyMatch: undefined }),
    policy("work24-all-1", ["employment"], { youthPolicyMatch: undefined }),
  ];
  const sections = sectionsModule.allYouthPolicySections({
    categories: dashboard(items, "no_matches").categories,
  });
  assert.equal(sections.reduce((count, section) => count + section.count, 0), 2);
  assert.deepEqual(
    sections.find((section) => section.id === "employment").items.map((item) => item.id),
    ["work24-all-1"],
  );
});

test("classification never mines suggestive title or summary text", async (context) => {
  const sectionsModule = await loadSections(context);
  const unstructured = policy("official-record-1", [], {
    title: "취업 장학금 금융지원이라는 자유서술 제목",
    summary: "고용과 학자금이라는 표현이 있지만 구조화 조건은 없음",
    youthPolicyEligibility: {},
  });

  assert.equal(sectionsModule.youthPolicySectionForItem(unstructured), "policy_news");
  assert.equal(
    sectionsModule.youthPolicySectionForItem({
      ...unstructured,
      tags: ["section:employment"],
    }),
    "employment",
  );
});

test("region filters keep nationwide, regional and unknown scopes distinct", async (context) => {
  const sectionsModule = await loadSections(context);
  const nationwide = policy("kosaf-national-1", ["education"], {
    youthPolicyEligibility: {
      regionScope: "nationwide",
      interests: ["education"],
    },
  });
  const seoul = policy("youth-center-seoul-1", ["finance"], {
    youthPolicyEligibility: {
      regionScope: "regional",
      regions: ["seoul"],
      interests: ["finance"],
    },
  });
  const busan = policy("youth-center-busan-1", ["employment"], {
    youthPolicyEligibility: {
      regionScope: "regional",
      regions: ["busan"],
      interests: ["employment"],
    },
  });
  const unknown = policy("official-unknown-region-1", [], {
    youthPolicyEligibility: {
      regionScope: "unknown",
      interests: [],
    },
  });
  const source = dashboard([nationwide, seoul, busan, unknown]);

  const nationwideSections = sectionsModule.allYouthPolicySections(source, {
    mode: "nationwide",
  });
  const seoulOnlySections = sectionsModule.allYouthPolicySections(source, {
    mode: "region",
    region: "seoul",
    includeNationwide: false,
  });
  const seoulApplicableSections = sectionsModule.allYouthPolicySections(source, {
    mode: "region",
    region: "seoul",
    includeNationwide: true,
  });

  assert.equal(nationwideSections.reduce((sum, section) => sum + section.count, 0), 1);
  assert.equal(seoulOnlySections.reduce((sum, section) => sum + section.count, 0), 1);
  assert.equal(seoulApplicableSections.reduce((sum, section) => sum + section.count, 0), 2);
  assert.equal(
    seoulApplicableSections.some((section) =>
      section.items.some((item) => item.id === busan.id || item.id === unknown.id)),
    false,
  );
});

test("recruitment and policy-news resources are safe outbound integrations", async (context) => {
  const sectionsModule = await loadSections(context);
  const urlsModule = await (async () => {
    const projectRoot = fileURLToPath(new URL("..", import.meta.url));
    const server = await createServer({
      root: projectRoot,
      configFile: false,
      appType: "custom",
      logLevel: "silent",
      server: { middlewareMode: true },
    });
    context.after(() => server.close());
    return await server.ssrLoadModule("/lib/public-data/urls.ts");
  })();
  const resources = sectionsModule.YOUTH_OFFICIAL_RESOURCES;
  const jobKorea = resources.find((resource) => resource.id === "jobkorea-recruitment");
  const incruit = resources.find((resource) => resource.id === "incruit-recruitment");
  const work24 = resources.find((resource) => resource.id === "work24-recruitment");
  const work24Training = resources.find((resource) => resource.id === "work24-training-card");
  const work24Events = resources.find((resource) => resource.id === "work24-job-events");
  const governmentJobs = resources.find((resource) => resource.id === "work24-government-jobs-api");
  const wageArrears = resources.find((resource) => resource.id === "work24-wage-arrears-api");

  assert.equal(jobKorea.access, "external-directory");
  assert.equal(incruit.access, "external-directory");
  assert.equal(work24.access, "external-directory");
  assert.equal(work24Training.detail, "work24-training");
  assert.equal(work24Events.detail, "work24-job-events");
  assert.equal(governmentJobs.access, "enterprise-api-only");
  assert.equal(wageArrears.access, "enterprise-api-only");
  assert.equal(resources.filter((resource) => resource.id.startsWith("work24-")).length, 6);
  for (const resource of resources) {
    assert.equal(urlsModule.safePublicHttpUrl(resource.url), resource.url);
  }
});

test("four-section UI is multilingual and contains no scraping or third-party logo implementation", async () => {
  const component = await readFile(
    new URL("../app/components/youth-policy-four-sections.tsx", import.meta.url),
    "utf8",
  );
  for (const locale of ["ko", "en", "ja", "zh"]) {
    assert.match(component, new RegExp(`\\b${locale}: \\{`, "u"));
  }
  for (const section of ["scholarship", "financial_support", "employment", "policy_news"]) {
    assert.match(component, new RegExp(`\\b${section}:`, "u"));
  }
  assert.match(component, /personalizedYouthPolicySections\(dashboard, selection\)/u);
  assert.match(component, /allYouthPolicySections\(dashboard, selection\)/u);
  assert.match(component, /youthFacets\?\.sectionCounts/u);
  assert.match(component, /youthFacets\?\.regionCounts/u);
  assert.match(component, /onSectionChange\(section\.id\)/u);
  assert.match(component, /onRegionSelectionChange/u);
  assert.match(component, /전체 정책 보기/u);
  assert.match(component, /지역으로 정책 찾기/u);
  assert.match(component, /KOREA_MAP_URL/u);
  assert.match(component, /YOUTH_POLICY_REGIONS\.map/u);
  assert.match(component, /includeNationwide/u);
  assert.match(component, /regionCounts/u);
  assert.match(
    component,
    /count\(build\(\{ mode: "region", region, includeNationwide: false \}\)\)/u,
  );
  assert.match(component, /로그인 없이 공식 청년정책 전체 목록/u);
  assert.match(component, /개인 맞춤과 AI 설명만 로그인 후 제공/u);
  assert.match(component, /현재 고용24 채용공고 자동 연동은 제공기관 이용 조건으로 제한/u);
  assert.match(component, /지역·직종·임금·학력·경력·고용형태/u);
  assert.match(component, /기업회원 승인 필요 · 현재 미호출/u);
  assert.match(component, /work24-government-jobs/u);
  assert.match(component, /work24-wage-arrears/u);
  assert.match(component, /resourcePurposeLabel/u);
  assert.match(component, /resourceWhenLabel/u);
  assert.match(component, /className=\{styles\.resourcePreviewCard\}/u);
  assert.match(component, /공식 원문에서 최신 정보 확인/u);
  assert.doesNotMatch(component, /\bfetch\s*\(/u);
  assert.doesNotMatch(component, /jobkorea[^]*logo|incruit[^]*logo/iu);
});

test("loading a new youth scope never renders stale policies or facet counts", async (context) => {
  const { YouthPolicyFourSections } = await loadSectionsComponent(context);
  const stale = policy("stale-seoul-policy", ["employment"], {
    title: "이전 서울 정책 제목",
    youthPolicyEligibility: {
      regionScope: "regional",
      regions: ["seoul"],
      interests: ["employment"],
    },
  });
  const source = {
    ...dashboard([stale]),
    authenticated: true,
    sources: [],
  };
  const html = renderToStaticMarkup(createElement(YouthPolicyFourSections, {
    dashboard: source,
    locale: "ko",
    loading: true,
    viewMode: "personalized",
    selectedSection: "employment",
    regionSelection: { mode: "region", region: "seoul", includeNationwide: true },
    onSectionChange() {},
    onRegionSelectionChange() {},
    onViewModeChange() {},
    renderItems(items) {
      return createElement("div", null, items.map((item) => item.title).join(","));
    },
  }));

  assert.match(html, /aria-busy="true"/u);
  assert.match(html, /role="status"/u);
  assert.match(html, /선택한 청년정책을 확인하고 있어요/u);
  assert.doesNotMatch(html, /이전 서울 정책 제목|stale-seoul-policy/u);
  assert.doesNotMatch(html, /서울특별시 지역 정책 1건|<small>1<\/small>/u);
});

test("an empty filtered scope does not claim that the entire youth catalogue is empty", async (context) => {
  const { YouthPolicyFourSections } = await loadSectionsComponent(context);
  const filteredDashboard = {
    ...dashboard([]),
    authenticated: false,
    sources: [],
  };
  filteredDashboard.categories[0] = {
    ...filteredDashboard.categories[0],
    totalCount: 123,
    filteredTotalCount: 0,
  };
  const commonProps = {
    locale: "ko",
    loading: false,
    viewMode: "all",
    selectedSection: "employment",
    regionSelection: { mode: "region", region: "seoul", includeNationwide: false },
    onSectionChange() {},
    onRegionSelectionChange() {},
    onViewModeChange() {},
  };
  const filteredHtml = renderToStaticMarkup(createElement(YouthPolicyFourSections, {
    ...commonProps,
    dashboard: filteredDashboard,
  }));
  const emptyHtml = renderToStaticMarkup(createElement(YouthPolicyFourSections, {
    ...commonProps,
    dashboard: {
      ...dashboard([]),
      authenticated: false,
      sources: [],
    },
  }));

  assert.match(filteredHtml, /선택한 검색 조건에 맞는 청년정책이 0건입니다/u);
  assert.match(filteredHtml, /검색어·기간·분야·지역 조건을 완화하거나/u);
  assert.match(filteredHtml, /‘지역 조건 전체’를 선택하면/u);
  assert.doesNotMatch(filteredHtml, /현재 수집된 전체 청년정책이 0건입니다/u);
  assert.match(emptyHtml, /현재 수집된 전체 청년정책이 0건입니다/u);
});
