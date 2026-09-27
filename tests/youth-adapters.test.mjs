import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: projectRoot,
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const {
  MOEL_PRESS_MAX_DETAILS,
  MOEL_PRESS_MAX_LIST_PAGES,
  MOEL_PRESS_MAX_REQUESTS,
  moelPressReleasesAdapter,
  normalizeMoelPressDetailHtml,
  normalizeMoelPressListHtml,
  normalizeMoelPolicyRss,
  normalizeWork24Xml,
  normalizeYouthCenterPortalJson,
  normalizeYouthCenterXml,
  work24Adapter,
  youthCenterAdapter,
} = await server.ssrLoadModule("/lib/public-data/youth-adapters.ts");
test.after(() => server.close());

const nowIso = "2026-07-23T00:00:00.000Z";

function xmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}

function backfillSignatureForTest(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  });
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function work24Wanted({ id, title, company = "보라테크" }) {
  return `<wanted>
    <wantedAuthNo>${id}</wantedAuthNo>
    <company>${company}</company>
    <title>${title}</title>
    <region>서울 강남구</region>
    <regDt>20260723</regDt>
    <closeDt>20260815</closeDt>
    <wantedInfoUrl>https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchList.do?wantedAuthNo=${id}</wantedInfoUrl>
  </wanted>`;
}

function youthCenterPolicyXml({
  id,
  title,
  total = 1,
  major = "",
  middle = "",
  keywords = "",
}) {
  return `<youthPolicyList>
    <respResult>200</respResult>
    <totalCnt>${total}</totalCnt>
    <youthPolicy>
      <plcyNo>${id}</plcyNo>
      <plcyNm>${title}</plcyNm>
      ${major ? `<lclsfNm>${major}</lclsfNm>` : ""}
      ${middle ? `<mclsfNm>${middle}</mclsfNm>` : ""}
      ${keywords ? `<plcyKywdNm>${keywords}</plcyKywdNm>` : ""}
      <sprtTrgtRgnCn>전국</sprtTrgtRgnCn>
      <aplyUrlAddr>https://www.youthcenter.go.kr/youthPolicy/ythPlcyTotalSearch</aplyUrlAddr>
    </youthPolicy>
  </youthPolicyList>`;
}

test("Work24 XML becomes structured employment information with the official detail link", () => {
  const items = normalizeWork24Xml(`
    <wantedRoot><total>1</total><wanted>
      <wantedAuthNo>K120032607230001</wantedAuthNo>
      <company><![CDATA[보라테크]]></company>
      <title><![CDATA[청년 서비스 개발자 채용]]></title>
      <indTpNm>소프트웨어 개발업</indTpNm>
      <salTpNm>연봉</salTpNm><sal>3,600만원 이상</sal>
      <region>서울 강남구</region><career>신입</career><minEdubg>대졸(4년)</minEdubg>
      <holidayTpNm>주 5일 근무</holidayTpNm><empTpCd>10</empTpCd>
      <regDt>20260723</regDt><closeDt>20260815</closeDt>
      <wantedInfoUrl>https://www.work24.go.kr/wk/a/b/1200/retriveDtlEmpSrchList.do?wantedAuthNo=K120032607230001</wantedInfoUrl>
    </wanted></wantedRoot>`, nowIso, new Map());

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "work24-K120032607230001");
  assert.equal(items[0].tags.includes("section:employment"), true);
  assert.deepEqual(items[0].youthPolicyEligibility.regions, ["seoul"]);
  assert.equal(items[0].youthPolicyEligibility.regionScope, "regional");
  assert.deepEqual(items[0].youthPolicyEligibility.interests, ["employment"]);
  assert.match(items[0].sourceUrl, /^https:\/\/www\.work24\.go\.kr\//u);
  assert.equal(items[0].expiresAt, "2026-08-15");
  assert.match(items[0].summary, /소프트웨어 개발업/u);
  assert.match(items[0].summary, /학력 대졸\(4년\)/u);
  assert.match(items[0].summary, /기간의 정함이 없는 근로계약/u);
  assert.equal(items[0].tags.includes("주 5일 근무"), true);
});

test("Work24 personal-member API denial is reported as authorization pending", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => xmlResponse("<GO24><error>개인회원은 사용할 수 없는 OPEN-API입니다.</error></GO24>"),
  );

  const result = await work24Adapter("personal-member-key", nowIso, new Map());

  assert.equal(result.source.status, "authorization-pending");
  assert.equal(result.source.errorCode, "work24_authorization");
  assert.equal(result.failureKind, "authorization");
  assert.equal(result.requestCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /personal-member-key/u);
});

test("Work24 adapter follows total for at most two 100-item pages and deduplicates records", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    requests.push(endpoint);
    const page = endpoint.searchParams.get("startPage");
    if (page === "1") {
      return xmlResponse(`<wantedRoot><total>101</total>
        ${work24Wanted({ id: "DUPLICATE-1", title: "중복 채용" })}
      </wantedRoot>`);
    }
    return xmlResponse(`<wantedRoot><total>101</total>
      ${work24Wanted({ id: "DUPLICATE-1", title: "중복 채용" })}
      ${work24Wanted({ id: "SECOND-2", title: "두 번째 채용" })}
    </wantedRoot>`);
  });

  const result = await work24Adapter("work24-test-secret", nowIso, new Map());

  assert.equal(result.source.status, "live");
  assert.equal(result.requestCount, 2);
  assert.equal(result.items.length, 2);
  assert.deepEqual(
    requests.map((request) => request.searchParams.get("startPage")),
    ["1", "2"],
  );
  assert.equal(requests.every((request) => request.searchParams.get("display") === "100"), true);
  assert.equal(requests.every((request) => request.searchParams.get("regDate") === "M-1"), true);
  assert.doesNotMatch(JSON.stringify(result), /work24-test-secret/u);
});

test("Work24 checkpoint collection refreshes page one first and durably resumes older pages", async (t) => {
  const requests = [];
  const rows = Array.from({ length: 201 }, (_, index) => ({
    id: `CHECKPOINT-${index + 1}`,
    title: `채용 공고 ${index + 1}`,
  }));
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    const page = Number(endpoint.searchParams.get("startPage"));
    requests.push(page);
    const pageRows = rows.slice((page - 1) * 100, page * 100);
    return xmlResponse(`<wantedRoot><total>201</total>
      ${pageRows.map(work24Wanted).join("")}
    </wantedRoot>`);
  });

  let checkpoint = null;
  const storedPages = new Map();
  const commitPage = async (commit) => {
    checkpoint = structuredClone(commit.checkpoint);
    storedPages.set(commit.pageNumber, structuredClone(commit.items));
  };
  const first = await work24Adapter(
    "work24-checkpoint-secret",
    nowIso,
    new Map(),
    {
      checkpoint: null,
      stagedItems: [],
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );

  assert.deepEqual(requests, [1, 2]);
  assert.equal(first.incremental, true);
  assert.equal(first.source.status, "truncated");
  assert.equal(first.source.errorCode, "work24_backfill_in_progress");
  assert.equal(first.requestCount, 2);
  assert.equal(checkpoint.completed, false);
  assert.equal(checkpoint.nextPage, 3);
  assert.equal(storedPages.has(1), true);
  assert.equal(storedPages.has(2), true);

  requests.length = 0;
  const second = await work24Adapter(
    "work24-checkpoint-secret",
    "2026-07-23T00:02:00.000Z",
    new Map(),
    {
      checkpoint,
      stagedItems: [...storedPages.values()].flat(),
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );

  assert.deepEqual(requests, [1, 3]);
  assert.equal(second.source.status, "live");
  assert.equal(second.source.completeness, "complete");
  assert.equal(second.source.errorCode, undefined);
  assert.equal(second.items.length, 201);
  assert.equal(checkpoint.completed, true);
  assert.doesNotMatch(JSON.stringify(second), /work24-checkpoint-secret/u);
});

test("Work24 restarts shifted incomplete pages when the provider total changes across a KST day", async (t) => {
  const originalRows = Array.from({ length: 301 }, (_, index) => ({
    id: `CROSS-DAY-${index + 1}`,
    title: `기존 채용 ${index + 1}`,
  }));
  let currentRows = originalRows;
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    const page = Number(endpoint.searchParams.get("startPage"));
    requests.push(page);
    const pageRows = currentRows.slice((page - 1) * 100, page * 100);
    return xmlResponse(`<wantedRoot><total>${currentRows.length}</total>
      ${pageRows.map(work24Wanted).join("")}
    </wantedRoot>`);
  });

  let checkpoint = null;
  let generationChanges = 0;
  const storedPages = new Map();
  const commitPage = async (commit) => {
    if (checkpoint && checkpoint.querySignature !== commit.checkpoint.querySignature) {
      generationChanges += 1;
      storedPages.clear();
    }
    checkpoint = structuredClone(commit.checkpoint);
    storedPages.set(commit.pageNumber, structuredClone(commit.items));
  };
  const first = await work24Adapter(
    "work24-cross-day-secret",
    "2026-07-23T14:50:00.000Z",
    new Map(),
    {
      checkpoint: null,
      stagedItems: [],
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );
  const firstSignature = checkpoint.querySignature;
  assert.deepEqual(requests, [1, 2]);
  assert.equal(checkpoint.completed, false);
  assert.equal(checkpoint.nextPage, 3);

  currentRows = [
    ...Array.from({ length: 100 }, (_, index) => ({
      id: `CROSS-DAY-NEW-${index + 1}`,
      title: `다음 날 신규 채용 ${index + 1}`,
    })),
    ...originalRows,
  ];
  requests.length = 0;
  const second = await work24Adapter(
    "work24-cross-day-secret",
    "2026-07-23T15:10:00.000Z",
    new Map(first.items.map((item) => [item.id, item])),
    {
      checkpoint,
      stagedItems: [...storedPages.values()].flat(),
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );

  assert.deepEqual(requests, [1, 2]);
  assert.equal(generationChanges, 1);
  assert.notEqual(checkpoint.querySignature, firstSignature);
  assert.equal(checkpoint.providerTotalCount, 401);
  assert.equal(checkpoint.nextPage, 3);
  assert.equal(checkpoint.completed, false);
  assert.equal(second.source.completeness, "truncated");
  assert.equal(second.source.errorCode, "work24_backfill_in_progress");
  assert.equal(storedPages.get(1).some((item) => item.id === "work24-CROSS-DAY-NEW-1"), true);
  assert.doesNotMatch(JSON.stringify(second), /work24-cross-day-secret/u);
});

test("Work24 rewalks a shrinking generation before publishing its exact remaining rows", async (t) => {
  let currentRows = Array.from({ length: 301 }, (_, index) => ({
    id: `SHRINK-${index + 1}`,
    title: `감소 전 채용 ${index + 1}`,
  }));
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    const page = Number(endpoint.searchParams.get("startPage"));
    requests.push(page);
    const pageRows = currentRows.slice((page - 1) * 100, page * 100);
    return xmlResponse(`<wantedRoot><total>${currentRows.length}</total>
      ${pageRows.map(work24Wanted).join("")}
    </wantedRoot>`);
  });

  let checkpoint = null;
  const storedPages = new Map();
  const commitPage = async (commit) => {
    checkpoint = structuredClone(commit.checkpoint);
    storedPages.set(commit.pageNumber, structuredClone(commit.items));
  };
  const first = await work24Adapter(
    "work24-shrink-secret",
    "2026-07-23T14:50:00.000Z",
    new Map(),
    {
      checkpoint: null,
      stagedItems: [],
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );
  const firstSignature = checkpoint.querySignature;
  assert.deepEqual(requests, [1, 2]);
  assert.equal(checkpoint.nextPage, 3);
  assert.equal(checkpoint.completed, false);

  currentRows = currentRows.slice(0, 150);
  requests.length = 0;
  const second = await work24Adapter(
    "work24-shrink-secret",
    "2026-07-23T15:10:00.000Z",
    new Map(first.items.map((item) => [item.id, item])),
    {
      checkpoint,
      stagedItems: [...storedPages.values()].flat(),
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );

  assert.deepEqual(requests, [1, 2]);
  assert.notEqual(checkpoint.querySignature, firstSignature);
  assert.equal(checkpoint.providerTotalCount, 150);
  assert.equal(checkpoint.fetchedCount, 150);
  assert.equal(checkpoint.nextPage, 3);
  assert.equal(checkpoint.completed, true);
  assert.equal(second.source.status, "live");
  assert.equal(second.source.completeness, "complete");
  assert.equal(second.source.errorCode, undefined);
  assert.equal(second.items.length, 150);
  assert.doesNotMatch(JSON.stringify(second), /work24-shrink-secret/u);
});

test("Work24 resumes a valid legacy v2 checkpoint instead of resetting its generation", async (t) => {
  const queryState = JSON.stringify({
    version: 2,
    endpoint: "https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo210L01.do",
    pageSize: 100,
    registrationWindow: "M-1",
    sort: "DESC",
    reconciliationDay: "2026-07-23",
    providerTotalCount: 301,
  });
  const legacySignature = `work24-v3-${backfillSignatureForTest(queryState)}`;
  const legacyCheckpoint = {
    sourceId: "work24",
    querySignature: legacySignature,
    queryState,
    nextPage: 3,
    pageSize: 100,
    providerTotalCount: 301,
    fetchedCount: 200,
    completed: false,
    latestRefreshAt: Date.parse("2026-07-23T14:50:00.000Z"),
    completedAt: null,
    updatedAt: Date.parse("2026-07-23T14:50:00.000Z"),
  };
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    const page = Number(endpoint.searchParams.get("startPage"));
    requests.push(page);
    return xmlResponse(`<wantedRoot><total>301</total>
      ${work24Wanted({ id: `LEGACY-${page}`, title: `레거시 이어받기 ${page}` })}
    </wantedRoot>`);
  });

  let checkpoint = null;
  const result = await work24Adapter(
    "work24-legacy-secret",
    "2026-07-23T15:10:00.000Z",
    new Map(),
    {
      checkpoint: legacyCheckpoint,
      stagedItems: [],
      maxBackfillPagesPerRun: 1,
      commitPage: async (commit) => {
        checkpoint = structuredClone(commit.checkpoint);
      },
    },
  );

  assert.deepEqual(requests, [1, 3]);
  assert.equal(checkpoint.querySignature, legacySignature);
  assert.equal(checkpoint.queryState, queryState);
  assert.equal(checkpoint.providerTotalCount, 301);
  assert.equal(checkpoint.nextPage, 4);
  assert.equal(checkpoint.completed, false);
  assert.equal(result.source.errorCode, "work24_backfill_in_progress");
  assert.doesNotMatch(JSON.stringify(result), /work24-legacy-secret/u);
});

test("Work24 restarts a changed same-day total and reconciles again the next day", async (t) => {
  const originalRows = Array.from({ length: 200 }, (_, index) => ({
    id: `ORIGINAL-${index + 1}`,
    title: `기존 채용 ${index + 1}`,
  }));
  let currentRows = originalRows;
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    const page = Number(endpoint.searchParams.get("startPage"));
    requests.push(page);
    const pageRows = currentRows.slice((page - 1) * 100, page * 100);
    return xmlResponse(`<wantedRoot><total>${currentRows.length}</total>
      ${pageRows.map(work24Wanted).join("")}
    </wantedRoot>`);
  });

  let checkpoint = null;
  const storedPages = new Map();
  const commitPage = async (commit) => {
    if (checkpoint && checkpoint.querySignature !== commit.checkpoint.querySignature) {
      storedPages.clear();
    }
    checkpoint = structuredClone(commit.checkpoint);
    storedPages.set(commit.pageNumber, structuredClone(commit.items));
  };
  const first = await work24Adapter(
    "work24-generation-secret",
    nowIso,
    new Map(),
    {
      checkpoint: null,
      stagedItems: [],
      maxBackfillPagesPerRun: 2,
      commitPage,
    },
  );
  const firstSignature = checkpoint.querySignature;
  assert.deepEqual(requests, [1, 2]);
  assert.equal(first.source.completeness, "complete");

  currentRows = [
    ...Array.from({ length: 50 }, (_, index) => ({
      id: `NEW-${index + 1}`,
      title: `신규 채용 ${index + 1}`,
    })),
    ...originalRows,
  ];
  requests.length = 0;
  const sameDay = await work24Adapter(
    "work24-generation-secret",
    "2026-07-23T01:00:00.000Z",
    new Map(first.items.map((item) => [item.id, item])),
    {
      checkpoint,
      stagedItems: [...storedPages.values()].flat(),
      maxBackfillPagesPerRun: 3,
      commitPage,
    },
  );

  assert.equal(checkpoint.querySignature, firstSignature);
  assert.deepEqual(requests, [1, 2, 3]);
  assert.equal(sameDay.source.completeness, "complete");
  assert.equal(sameDay.source.errorCode, undefined);
  assert.equal(sameDay.source.providerTotalCount, 250);
  assert.equal(sameDay.source.fetchedCount, 250);
  assert.equal(sameDay.items.length, 250);
  assert.equal(checkpoint.completed, true);

  requests.length = 0;
  const second = await work24Adapter(
    "work24-generation-secret",
    "2026-07-24T00:00:00.000Z",
    new Map(sameDay.items.map((item) => [item.id, item])),
    {
      checkpoint,
      stagedItems: [...storedPages.values()].flat(),
      maxBackfillPagesPerRun: 3,
      commitPage,
    },
  );

  assert.notEqual(checkpoint.querySignature, firstSignature);
  assert.deepEqual(requests, [1, 2, 3]);
  assert.equal(second.source.completeness, "complete");
  assert.equal(second.items.length, 250);
  assert.equal(second.items.some((item) => item.id === "work24-ORIGINAL-51"), true);
  assert.equal(second.items.some((item) => item.id === "work24-NEW-50"), true);
  assert.doesNotMatch(JSON.stringify(second), /work24-generation-secret/u);
});

test("Work24 stops the current run when a resumed page reports a different total", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    const page = Number(endpoint.searchParams.get("startPage"));
    requests.push(page);
    const total = page === 1 ? 201 : 202;
    return xmlResponse(`<wantedRoot><total>${total}</total>
      ${work24Wanted({ id: `TOTAL-CHANGED-${page}`, title: `총계 변경 ${page}` })}
    </wantedRoot>`);
  });

  let checkpoint = null;
  const storedPages = new Map();
  const result = await work24Adapter(
    "work24-total-change-secret",
    nowIso,
    new Map(),
    {
      checkpoint: null,
      stagedItems: [],
      maxBackfillPagesPerRun: 2,
      commitPage: async (commit) => {
        checkpoint = structuredClone(commit.checkpoint);
        storedPages.set(commit.pageNumber, structuredClone(commit.items));
      },
    },
  );

  assert.deepEqual(requests, [1, 2]);
  assert.equal(result.source.status, "partial");
  assert.equal(result.source.completeness, "partial");
  assert.equal(result.source.errorCode, "work24_total_changed");
  assert.equal(result.failureKind, "transient");
  assert.equal(checkpoint.nextPage, 2);
  assert.equal(checkpoint.completed, false);
  assert.deepEqual([...storedPages.keys()], [1]);
  assert.doesNotMatch(JSON.stringify(result), /work24-total-change-secret/u);
});

test("Work24 keeps provider page-cap results truthfully truncated after completion", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    const page = Number(endpoint.searchParams.get("startPage"));
    requests.push(page);
    return xmlResponse(`<wantedRoot><total>100001</total>
      ${work24Wanted({ id: `PAGE-CAP-${page}`, title: `페이지 한도 ${page}` })}
    </wantedRoot>`);
  });

  let checkpoint = null;
  const storedPages = new Map();
  const commitPage = async (commit) => {
    checkpoint = structuredClone(commit.checkpoint);
    storedPages.set(commit.pageNumber, structuredClone(commit.items));
  };
  await work24Adapter(
    "work24-page-cap-secret",
    nowIso,
    new Map(),
    {
      checkpoint: null,
      stagedItems: [],
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );
  const completedCheckpoint = {
    ...checkpoint,
    nextPage: 1001,
    fetchedCount: 100000,
    completed: true,
    completedAt: Date.parse(nowIso),
  };

  requests.length = 0;
  const result = await work24Adapter(
    "work24-page-cap-secret",
    "2026-07-23T00:05:00.000Z",
    new Map(),
    {
      checkpoint: completedCheckpoint,
      stagedItems: [...storedPages.values()].flat(),
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );

  assert.deepEqual(requests, [1]);
  assert.equal(result.source.status, "truncated");
  assert.equal(result.source.completeness, "truncated");
  assert.equal(result.source.errorCode, "work24_provider_page_limit");
  assert.equal(result.source.providerTotalCount, 100001);
  assert.equal(result.source.fetchedCount, 100000);
  assert.equal(checkpoint.completed, true);
  assert.doesNotMatch(JSON.stringify(result), /work24-page-cap-secret/u);
});

test("YouthCenter records retain official criteria and deterministic four-section tags", () => {
  const payload = `<youthPolicyList><respResult>200</respResult><youthPolicy>
    <bizId>R20260723001</bizId><polyBizSjnm>서울 청년 직무훈련</polyBizSjnm>
    <polyItcnCn>공식 직무훈련 정책입니다.</polyItcnCn><sporCn>교육과 취업 연계를 지원합니다.</sporCn>
    <rqutPrdCn>2026.07.01 ~ 2026.08.31</rqutPrdCn>
    <bgnAge>18</bgnAge><endAge>34</endAge><polyBizIscd>서울특별시</polyBizIscd>
    <rqutUrla>https://www.youthcenter.go.kr/youthPolicy/ythPlcyTotalSearch</rqutUrla>
    <lastUpdtDt>20260723</lastUpdtDt>
  </youthPolicy></youthPolicyList>`;
  const [item] = normalizeYouthCenterXml(payload, "employment", nowIso, new Map());

  assert.equal(item.source, "온통청년");
  assert.equal(item.tags.includes("section:employment"), true);
  assert.equal(item.youthPolicyEligibility.minAge, 18);
  assert.equal(item.youthPolicyEligibility.maxAge, 34);
  assert.deepEqual(item.youthPolicyEligibility.regions, ["seoul"]);
  assert.equal(item.youthPolicyEligibility.regionScope, "regional");
  assert.equal(item.expiresAt, "2026-08-31");

  const [withoutAge] = normalizeYouthCenterXml(payload
    .replace("<bgnAge>18</bgnAge>", "")
    .replace("<endAge>34</endAge>", ""), "employment", nowIso, new Map());
  assert.equal("minAge" in withoutAge.youthPolicyEligibility, false);
  assert.equal("maxAge" in withoutAge.youthPolicyEligibility, false);
});

test("YouthCenter classifies nationwide scope from the full official region field", () => {
  const longRegionalPrefix = Array.from({ length: 40 }, () => "서울특별시 강남구").join(",");
  assert.ok(longRegionalPrefix.length > 220);
  const payload = `<youthPolicyList><respResult>200</respResult><youthPolicy>
    <bizId>LONG-REGION-XML</bizId><polyBizSjnm>전국 청년 지원</polyBizSjnm>
    <sprtTrgtRgnCn>${longRegionalPrefix},전국</sprtTrgtRgnCn>
  </youthPolicy></youthPolicyList>`;
  const [xmlItem] = normalizeYouthCenterXml(payload, "policy_news", nowIso, new Map());
  assert.equal(xmlItem.youthPolicyEligibility.regionScope, "nationwide");
  assert.deepEqual(xmlItem.youthPolicyEligibility.regions ?? [], []);
  assert.equal(xmlItem.tags.includes("전국"), true);

  const portal = normalizeYouthCenterPortalJson({ response: { totalCount: 1, resultList: [{
    DOCID: "LONG-REGION-JSON",
    PLCY_NM: "전국 청년 지원 JSON",
    STDG_NM: `${longRegionalPrefix},전국`,
  }] } }, nowIso, new Map());
  assert.equal(portal.items[0].youthPolicyEligibility.regionScope, "nationwide");
  assert.deepEqual(portal.items[0].youthPolicyEligibility.regions ?? [], []);
  assert.equal(portal.items[0].tags.includes("전국"), true);
});

test("YouthCenter official portal JSON becomes linked and classified policy records", () => {
  const result = normalizeYouthCenterPortalJson({
    response: {
      totalCount: 2,
      resultList: [
        {
          DOCID: "202607290001",
          PLCY_NM: "청년 금융 역량 지원",
          PLCY_EXPLN_CN: "청년의 안정적인 자산 형성을 돕습니다.",
          PLCY_SPRT_CN: "금융교육과 상담을 지원합니다.",
          APLY_PRD_BGNG_YMD: "20260701",
          APLY_PRD_END_YMD: "20260831",
          LAST_MDFCN_DT: "20260729",
          USER_LCLSF_NM: "금융복지문화",
          USER_MCLSF_NM: "취약계층 및 금융지원",
          PLCY_KYWD_NM: "금융지원,신용회복",
          STDG_NM: "서울특별시",
          SPRT_TRGT_MIN_AGE: 19,
          SPRT_TRGT_MAX_AGE: 34,
        },
        {
          DOCID: "202607290002",
          PLCY_NM: "청년 취업 프로그램",
          PLCY_EXPLN_CN: "직무 경험을 제공합니다.",
          USER_LCLSF_NM: "일자리",
          USER_MCLSF_NM: "취업",
          PLCY_KYWD_NM: "인턴",
          STDG_NM: "전국",
        },
      ],
    },
  }, nowIso, new Map());

  assert.equal(result.total, 2);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].tags.includes("section:financial-support"), true);
  assert.equal(result.items[0].youthPolicyEligibility.regionScope, "regional");
  assert.deepEqual(result.items[0].youthPolicyEligibility.regions, ["seoul"]);
  assert.equal(result.items[0].expiresAt, "2026-08-31");
  assert.match(
    result.items[0].sourceUrl,
    /^https:\/\/www\.youthcenter\.go\.kr\/youthPolicy\/ythPlcyTotalSearch\/ythPlcyDetail\//u,
  );
  assert.equal(result.items[1].tags.includes("section:employment"), true);
});

test("YouthCenter uses official classification fields for all four structural sections", () => {
  const cases = [
    {
      fallback: "policy_news",
      major: "일자리",
      middle: "취업",
      expectedTag: "section:employment",
      expectedInterests: ["employment"],
    },
    {
      fallback: "employment",
      major: "교육",
      middle: "교육비지원",
      expectedTag: "section:scholarship",
      expectedInterests: ["education"],
    },
    {
      fallback: "employment",
      major: "복지문화",
      middle: "취약계층 및 금융지원",
      expectedTag: "section:financial-support",
      expectedInterests: ["finance", "welfare"],
    },
    {
      fallback: "employment",
      major: "주거",
      middle: "주택 및 거주지",
      expectedTag: "section:policy-news",
      expectedInterests: ["housing"],
    },
  ];

  for (const [index, policyCase] of cases.entries()) {
    const [item] = normalizeYouthCenterXml(youthCenterPolicyXml({
      id: `STRUCTURED-${index}`,
      title: `구조 정책 ${index}`,
      major: policyCase.major,
      middle: policyCase.middle,
    }), policyCase.fallback, nowIso, new Map());

    assert.equal(item.tags.includes(policyCase.expectedTag), true);
    assert.equal(item.tags.includes(policyCase.major), true);
    assert.equal(item.tags.includes(policyCase.middle), true);
    assert.deepEqual(item.youthPolicyEligibility.interests, policyCase.expectedInterests);
  }
});

test("YouthCenter adapter preserves successful sections and first pages when other requests fail", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    requests.push(endpoint);
    const policyCodes = endpoint.searchParams.get("bizTycdSel");
    const page = endpoint.searchParams.get("pageIndex");

    if (policyCodes === "023010") {
      if (page === "2") return xmlResponse("<error>temporary</error>", 503);
      return xmlResponse(youthCenterPolicyXml({
        id: "EMPLOYMENT-1",
        title: "청년 취업 지원",
        total: 500,
        major: "일자리",
        middle: "취업",
      }));
    }
    if (policyCodes === "023030") {
      return xmlResponse(youthCenterPolicyXml({
        id: "SCHOLARSHIP-1",
        title: "청년 교육비 지원",
        major: "교육",
        middle: "교육비지원",
      }));
    }
    if (policyCodes === "023040") {
      return xmlResponse("<error>temporary</error>", 503);
    }
    return xmlResponse(youthCenterPolicyXml({
      id: "HOUSING-1",
      title: "청년 주거 지원",
      major: "주거",
      middle: "주택 및 거주지",
    }));
  });

  const result = await youthCenterAdapter("youth-center-test-secret", nowIso, new Map());

  assert.equal(result.source.status, "partial");
  assert.equal(result.source.completeness, "partial");
  assert.equal(result.requestCount, 5);
  assert.equal(result.items.length, 3);
  assert.deepEqual(
    new Set(result.items.flatMap((item) => item.tags.filter((tag) => tag.startsWith("section:")))),
    new Set(["section:employment", "section:scholarship", "section:policy-news"]),
  );
  assert.deepEqual(
    new Set(requests
      .filter((request) => request.searchParams.get("pageIndex") === "1")
      .map((request) => request.searchParams.get("bizTycdSel"))),
    new Set(["023010", "023030", "023040", "023020,023050"]),
  );
  assert.equal(
    requests.filter((request) => request.searchParams.get("bizTycdSel") === "023010").length,
    2,
  );
  assert.doesNotMatch(JSON.stringify(result), /youth-center-test-secret/u);
});

test("YouthCenter checkpoint collection keeps four section cursors and never treats a run cap as complete", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    const policyCodes = endpoint.searchParams.get("bizTycdSel");
    const page = Number(endpoint.searchParams.get("pageIndex"));
    requests.push({ policyCodes, page });
    const total = policyCodes === "023010" ? 81 : 1;
    return xmlResponse(youthCenterPolicyXml({
      id: `${policyCodes}-${page}`,
      title: `${policyCodes} 정책 ${page}`,
      total,
    }));
  });

  let checkpoint = null;
  const storedPages = new Map();
  const commitPage = async (commit) => {
    checkpoint = structuredClone(commit.checkpoint);
    storedPages.set(commit.pageNumber, structuredClone(commit.items));
  };
  const first = await youthCenterAdapter(
    "youth-center-checkpoint-secret",
    nowIso,
    new Map(),
    {
      checkpoint: null,
      stagedItems: [],
      maxBackfillPagesPerRun: 1,
      commitPage,
      readCommittedItems: async () => [...new Map([...storedPages.values()].flat().map((item) => [item.id, item])).values()],
    },
  );

  assert.deepEqual(
    requests.slice(0, 4).map(({ page }) => page),
    [1, 1, 1, 1],
    "every structural section must refresh its latest page before historical work",
  );
  assert.deepEqual(requests.at(-1), { policyCodes: "023010", page: 2 });
  assert.equal(first.requestCount, 5);
  assert.equal(first.incremental, true);
  assert.equal(first.source.status, "truncated");
  assert.equal(first.source.errorCode, "youth_center_backfill_in_progress");
  assert.equal(checkpoint.completed, false);
  assert.match(checkpoint.queryState, /"mode":"open-api"/u);
  assert.doesNotMatch(checkpoint.queryState, /youth-center-checkpoint-secret/u);

  requests.length = 0;
  const second = await youthCenterAdapter(
    "youth-center-checkpoint-secret",
    "2026-07-23T00:02:00.000Z",
    new Map(),
    {
      checkpoint,
      stagedItems: [...storedPages.values()].flat(),
      maxBackfillPagesPerRun: 1,
      commitPage,
      readCommittedItems: async () => [...new Map([...storedPages.values()].flat().map((item) => [item.id, item])).values()],
    },
  );

  assert.deepEqual(requests.slice(0, 4).map(({ page }) => page), [1, 1, 1, 1]);
  assert.deepEqual(requests.at(-1), { policyCodes: "023010", page: 3 });
  assert.equal(second.requestCount, 5);
  assert.equal(second.source.status, "live");
  assert.equal(second.source.completeness, "complete");
  assert.equal(second.source.errorCode, undefined);
  assert.equal(checkpoint.completed, true);
  assert.equal(second.items.length, 6);
  assert.doesNotMatch(JSON.stringify(second), /youth-center-checkpoint-secret/u);
});

test("YouthCenter Open API rewalks shifted section pages in each KST daily generation", async (t) => {
  let generation = "DAY1";
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    const policyCodes = endpoint.searchParams.get("bizTycdSel");
    const page = Number(endpoint.searchParams.get("pageIndex"));
    requests.push({ policyCodes, page });
    const total = policyCodes === "023010" ? 80 : 1;
    return xmlResponse(youthCenterPolicyXml({
      id: `${generation}-${policyCodes}-${page}`,
      title: `${generation} ${policyCodes} 정책 ${page}`,
      total,
    }));
  });

  let checkpoint = null;
  const storedPages = new Map();
  const commitPage = async (commit) => {
    if (checkpoint && checkpoint.querySignature !== commit.checkpoint.querySignature) {
      storedPages.clear();
    }
    checkpoint = structuredClone(commit.checkpoint);
    storedPages.set(commit.pageNumber, structuredClone(commit.items));
  };
  const first = await youthCenterAdapter(
    "youth-center-generation-secret",
    nowIso,
    new Map(),
    {
      checkpoint: null,
      stagedItems: [],
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );
  const firstSignature = checkpoint.querySignature;
  assert.equal(first.source.completeness, "complete");
  assert.deepEqual(
    requests.map(({ page }) => page),
    [1, 1, 1, 1, 2],
  );

  generation = "DAY2";
  requests.length = 0;
  const second = await youthCenterAdapter(
    "youth-center-generation-secret",
    "2026-07-24T00:00:00.000Z",
    new Map(first.items.map((item) => [item.id, item])),
    {
      checkpoint,
      stagedItems: [...storedPages.values()].flat(),
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );

  assert.notEqual(checkpoint.querySignature, firstSignature);
  assert.deepEqual(
    requests.map(({ page }) => page),
    [1, 1, 1, 1, 2],
  );
  assert.equal(second.source.completeness, "complete");
  assert.equal(second.items.every((item) => item.title.includes("DAY2")), true);
  assert.equal(second.items.some((item) => item.title.includes("DAY1")), false);
  assert.doesNotMatch(JSON.stringify(second), /youth-center-generation-secret/u);
});

test("YouthCenter adapter fails closed only when every structural section fails", async (t) => {
  t.mock.method(globalThis, "fetch", async () => xmlResponse("<error>forbidden</error>", 403));

  const result = await youthCenterAdapter("rejected-secret", nowIso, new Map());

  assert.equal(result.source.status, "authorization-pending");
  assert.equal(result.failureKind, "authorization");
  assert.equal(result.requestCount, 4);
  assert.deepEqual(result.items, []);
  assert.doesNotMatch(JSON.stringify(result), /rejected-secret/u);
});

test("YouthCenter follows only a bounded same-origin HTTPS redirect", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const endpoint = new URL(String(input));
    requests.push(endpoint);
    if (endpoint.pathname === "/opi/youthPlcyList.do") {
      const redirected = new URL("/opi/v2/youthPlcyList.do", endpoint);
      redirected.search = endpoint.search;
      return new Response(null, {
        status: 307,
        headers: { Location: redirected.toString() },
      });
    }
    return xmlResponse(youthCenterPolicyXml({
      id: endpoint.searchParams.get("bizTycdSel") ?? "POLICY",
      title: "청년 정책",
    }));
  });

  const result = await youthCenterAdapter("same-origin-secret", nowIso, new Map());

  assert.equal(result.source.status, "live");
  assert.equal(requests.length, 8);
  assert.equal(requests.every((request) => request.protocol === "https:"), true);
  assert.equal(requests.every((request) => request.origin === "https://www.youthcenter.go.kr"), true);
  assert.doesNotMatch(JSON.stringify(result), /same-origin-secret/u);
});

test("YouthCenter never follows the provider HTTP downgrade and uses its official HTTPS portal without the key", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const endpoint = new URL(String(input));
    requests.push({ endpoint, init });
    if (endpoint.pathname === "/opi/youthPlcyList.do") {
      return new Response(null, {
        status: 302,
        headers: { Location: "http://www.youthcenter.go.kr:8080/" },
      });
    }
    if (endpoint.pathname === "/youthPolicy/ythPlcyTotalSearch") {
      return htmlResponse("<html><body>공식 정책 검색</body></html>", 200, {
        "Set-Cookie": "ygt=anonymous-session; Path=/; Secure; HttpOnly",
      });
    }
    return jsonResponse({
      data: {
        totalCount: 2,
        records: [
          {
            DOCID: "SAFE-EMPLOYMENT",
            PLCY_NM: "청년 취업 지원",
            USER_LCLSF_NM: "일자리",
            USER_MCLSF_NM: "취업",
          },
          {
            DOCID: "SAFE-FINANCE",
            PLCY_NM: "청년 금융 지원",
            USER_LCLSF_NM: "금융복지문화",
            USER_MCLSF_NM: "취약계층 및 금융지원",
          },
        ],
      },
    });
  });

  const result = await youthCenterAdapter("must-not-leak", nowIso, new Map());

  assert.equal(result.source.status, "live");
  assert.equal(result.source.completeness, "complete");
  assert.equal(result.items.length, 2);
  assert.equal(result.requestCount, 3);
  assert.equal(requests.length, 3);
  assert.equal(requests.every(({ endpoint }) =>
    endpoint.protocol === "https:"
    && endpoint.origin === "https://www.youthcenter.go.kr"), true);
  assert.equal(
    requests.slice(1).every(({ endpoint, init }) =>
      !endpoint.toString().includes("must-not-leak")
      && !JSON.stringify(init ?? {}).includes("must-not-leak")),
    true,
  );
  assert.equal(requests[2].init?.method, "POST");
  assert.equal(requests[2].init?.headers?.Cookie, "ygt=anonymous-session");
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak/u);
});

test("YouthCenter safe portal fallback follows the official total beyond three pages", async (t) => {
  const portalPages = [];
  const requests = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const endpoint = new URL(String(input));
    requests.push({ endpoint, init });
    if (endpoint.pathname === "/opi/youthPlcyList.do") {
      return new Response(null, {
        status: 302,
        headers: { Location: "http://www.youthcenter.go.kr:8080/" },
      });
    }
    if (endpoint.pathname === "/youthPolicy/ythPlcyTotalSearch") {
      return htmlResponse("<html><body>공식 정책 검색</body></html>", 200, {
        "Set-Cookie": "ygt=anonymous-session; Path=/; Secure; HttpOnly",
      });
    }
    const page = JSON.parse(String(init?.body ?? "{}")).pageNum;
    portalPages.push(page);
    const start = (page - 1) * 100;
    const count = page < 5 ? 100 : 50;
    return jsonResponse({
      data: {
        totalCount: 450,
        records: Array.from({ length: count }, (_, index) => ({
          DOCID: `SAFE-${start + index + 1}`,
          PLCY_NM: `청년 정책 ${start + index + 1}`,
          USER_LCLSF_NM: "일자리",
          USER_MCLSF_NM: "취업",
          STDG_CTPV_NM: "서울특별시",
        })),
      },
    });
  });

  const result = await youthCenterAdapter("must-not-leak-many", nowIso, new Map());

  assert.equal(result.source.status, "live");
  assert.equal(result.items.length, 450);
  assert.equal(result.requestCount, 7);
  assert.deepEqual(portalPages, [1, 2, 3, 4, 5]);
  assert.equal(
    requests.slice(1).every(({ endpoint, init }) =>
      !endpoint.toString().includes("must-not-leak-many")
      && !JSON.stringify(init ?? {}).includes("must-not-leak-many")),
    true,
  );
});

test("YouthCenter portal fallback resumes beyond its per-run page budget without exposing the key", async (t) => {
  const portalPages = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const endpoint = new URL(String(input));
    if (endpoint.pathname === "/opi/youthPlcyList.do") {
      return new Response(null, {
        status: 302,
        headers: { Location: "http://www.youthcenter.go.kr:8080/" },
      });
    }
    if (endpoint.pathname === "/youthPolicy/ythPlcyTotalSearch") {
      return htmlResponse("<html><body>공식 정책 검색</body></html>", 200, {
        "Set-Cookie": "ygt=anonymous-session; Path=/; Secure; HttpOnly",
      });
    }
    const page = JSON.parse(String(init?.body ?? "{}")).pageNum;
    portalPages.push(page);
    const count = page < 3 ? 100 : 50;
    return jsonResponse({
      data: {
        totalCount: 250,
        records: Array.from({ length: count }, (_, index) => ({
          DOCID: `PORTAL-${page}-${index}`,
          PLCY_NM: `포털 정책 ${page}-${index}`,
          USER_LCLSF_NM: "일자리",
          USER_MCLSF_NM: "취업",
        })),
      },
    });
  });

  let checkpoint = null;
  const storedPages = new Map();
  const commitPage = async (commit) => {
    checkpoint = structuredClone(commit.checkpoint);
    storedPages.set(commit.pageNumber, structuredClone(commit.items));
  };
  const first = await youthCenterAdapter(
    "portal-checkpoint-secret",
    nowIso,
    new Map(),
    {
      checkpoint: null,
      stagedItems: [],
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );

  assert.deepEqual(portalPages, [1, 2]);
  assert.equal(first.requestCount, 4);
  assert.equal(first.source.errorCode, "youth_center_backfill_in_progress");
  assert.equal(checkpoint.completed, false);
  assert.match(checkpoint.queryState, /"mode":"portal"/u);

  portalPages.length = 0;
  const second = await youthCenterAdapter(
    "portal-checkpoint-secret",
    "2026-07-23T00:02:00.000Z",
    new Map(),
    {
      checkpoint,
      stagedItems: [...storedPages.values()].flat(),
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );

  assert.deepEqual(portalPages, [1, 3]);
  assert.equal(second.requestCount, 3);
  assert.equal(second.source.status, "live");
  assert.equal(second.source.completeness, "complete");
  assert.equal(second.items.length, 250);
  assert.doesNotMatch(JSON.stringify(second), /portal-checkpoint-secret/u);
});

test("YouthCenter portal restarts a changed same-day total before claiming completeness", async (t) => {
  let total = 150;
  let prefix = "OLD";
  let checkpoint = null;
  const pages = new Map();
  const calls = [];
  const resets = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const endpoint = new URL(String(input));
    if (endpoint.pathname === "/opi/youthPlcyList.do") {
      return new Response(null, { status: 302, headers: { Location: "http://www.youthcenter.go.kr:8080/" } });
    }
    if (endpoint.pathname === "/youthPolicy/ythPlcyTotalSearch") {
      return htmlResponse("<html>policy search</html>", 200, { "Set-Cookie": "ygt=test; Path=/; Secure" });
    }
    const page = JSON.parse(String(init?.body ?? "{}")).pageNum;
    calls.push(page);
    return jsonResponse({ data: { totalCount: total,
      records: Array.from({ length: Math.min(100, total - (page - 1) * 100) }, (_, index) => ({
        DOCID: `${prefix}-${page}-${index}`, PLCY_NM: `${prefix} policy ${page}-${index}`,
        USER_LCLSF_NM: "일자리", USER_MCLSF_NM: "취업",
      })) } });
  });
  const run = () => youthCenterAdapter("test-portal-key", nowIso, new Map(), {
    checkpoint, stagedItems: [...pages.values()].flat(), maxBackfillPagesPerRun: 2,
    commitPage: async (commit) => {
      resets.push(commit.resetGeneration === true);
      if (commit.resetGeneration) pages.clear();
      pages.set(commit.pageNumber, structuredClone(commit.items));
      checkpoint = structuredClone(commit.checkpoint);
    },
  });
  assert.equal((await run()).source.completeness, "complete");
  total = 160;
  prefix = "NEW";
  calls.length = 0;
  resets.length = 0;
  const result = await run();
  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual(resets, [true, false]);
  assert.equal(result.source.completeness, "complete");
  assert.equal(result.items.length, 160);
  assert.equal(result.items.some((item) => item.title.includes("OLD")), false);
  assert.deepEqual([...pages.keys()], [1, 2]);
});

test("YouthCenter section reconciliation publishes committed pages instead of stale merged section rows", async (t) => {
  let prefix = "OLD";
  let checkpoint = null;
  let committedReads = 0;
  const pages = new Map();
  t.mock.method(globalThis, "fetch", async (input) => {
    const code = new URL(String(input)).searchParams.get("bizTycdSel");
    return xmlResponse(youthCenterPolicyXml({ id: `${prefix}-${code}`, title: `${prefix} section`, total: 1 }));
  });
  const run = () => youthCenterAdapter("test-section-key", nowIso, new Map(), {
    checkpoint, stagedItems: [...pages.values()].flat(), maxBackfillPagesPerRun: 1,
    commitPage: async (commit) => {
      if (commit.resetSection !== undefined) {
        const index = commit.resetSection;
        for (const slot of pages.keys()) {
          if (slot === index || slot >= (index + 1) * 100000 + 1 && slot < (index + 2) * 100000) pages.delete(slot);
        }
      }
      pages.set(commit.pageNumber, structuredClone(commit.items));
      checkpoint = structuredClone(commit.checkpoint);
    },
    readCommittedItems: async () => {
      committedReads += 1;
      return [...new Map([...pages.values()].flat().map((item) => [item.id, item])).values()];
    },
  });
  assert.equal((await run()).source.completeness, "complete");
  prefix = "NEW";
  const result = await run();
  assert.equal(result.source.completeness, "complete");
  assert.equal(committedReads, 2);
  assert.equal(result.items.length, 4);
  assert.equal(result.items.every((item) => item.title.startsWith("NEW")), true);
  assert.deepEqual([...pages.keys()], [100001, 200001, 300001, 400001]);
});

test("YouthCenter portal fallback discards stale offset pages on the next KST day", async (t) => {
  let generation = "DAY1";
  const portalPages = [];
  t.mock.method(globalThis, "fetch", async (input, init) => {
    const endpoint = new URL(String(input));
    if (endpoint.pathname === "/opi/youthPlcyList.do") {
      return new Response(null, {
        status: 302,
        headers: { Location: "http://www.youthcenter.go.kr:8080/" },
      });
    }
    if (endpoint.pathname === "/youthPolicy/ythPlcyTotalSearch") {
      return htmlResponse("<html><body>공식 정책 검색</body></html>", 200, {
        "Set-Cookie": "ygt=anonymous-session; Path=/; Secure; HttpOnly",
      });
    }
    const page = JSON.parse(String(init?.body ?? "{}")).pageNum;
    portalPages.push(page);
    const count = page === 1 ? 100 : 50;
    return jsonResponse({
      data: {
        totalCount: 150,
        records: Array.from({ length: count }, (_, index) => ({
          DOCID: `${generation}-PORTAL-${page}-${index}`,
          PLCY_NM: `${generation} 포털 정책 ${page}-${index}`,
          USER_LCLSF_NM: "일자리",
          USER_MCLSF_NM: "취업",
        })),
      },
    });
  });

  let checkpoint = null;
  const storedPages = new Map();
  const commitPage = async (commit) => {
    if (checkpoint && checkpoint.querySignature !== commit.checkpoint.querySignature) {
      storedPages.clear();
    }
    checkpoint = structuredClone(commit.checkpoint);
    storedPages.set(commit.pageNumber, structuredClone(commit.items));
  };
  const first = await youthCenterAdapter(
    "portal-generation-secret",
    nowIso,
    new Map(),
    {
      checkpoint: null,
      stagedItems: [],
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );
  const firstSignature = checkpoint.querySignature;
  assert.deepEqual(portalPages, [1, 2]);
  assert.equal(first.source.completeness, "complete");

  generation = "DAY2";
  portalPages.length = 0;
  const second = await youthCenterAdapter(
    "portal-generation-secret",
    "2026-07-24T00:00:00.000Z",
    new Map(first.items.map((item) => [item.id, item])),
    {
      checkpoint,
      stagedItems: [...storedPages.values()].flat(),
      maxBackfillPagesPerRun: 1,
      commitPage,
    },
  );

  assert.notEqual(checkpoint.querySignature, firstSignature);
  assert.deepEqual(portalPages, [1, 2]);
  assert.equal(second.source.completeness, "complete");
  assert.equal(second.items.length, 150);
  assert.equal(second.items.every((item) => item.title.includes("DAY2")), true);
  assert.equal(second.items.some((item) => item.title.includes("DAY1")), false);
  assert.doesNotMatch(JSON.stringify(second), /portal-generation-secret/u);
});

test("MOEL policy RSS keeps only youth-related official news and classifies employment help", () => {
  const items = normalizeMoelPolicyRss(`<rss><channel>
    <item><title><![CDATA[청년 채용박람회를 개최합니다]]></title>
      <description><![CDATA[청년 취업지원 정책자료]]></description>
      <link>https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=1</link>
      <dc:date>2026-07-23T09:00:00+09:00</dc:date></item>
    <item><title>산업안전 일반 안내</title><description>일반 공지</description>
      <link>https://www.moel.go.kr/news/other</link></item>
  </channel></rss>`, nowIso, new Map());

  assert.equal(items.length, 1);
  assert.equal(items[0].tags.includes("section:employment"), true);
  assert.deepEqual(items[0].youthPolicyEligibility.interests, ["employment"]);
  assert.match(items[0].sourceUrl, /^https:\/\/www\.moel\.go\.kr\//u);
  assert.equal(items[0].summary, "청년 취업지원 정책자료");
  assert.equal(items[0].publishedAt, "2026-07-23T00:00:00.000Z");
});

test("MOEL press list keeps youth records and canonicalizes every detail URL", () => {
  const candidates = normalizeMoelPressListHtml(`<!doctype html><html><body>
    <table><tbody>
      <tr>
        <td><a href="enewsView.do?news_seq=19706&amp;redirect=https%3A%2F%2Fevil.example"
          title="청년 일자리 회복 &amp; 맞춤 지원">첫 번째 보도자료</a></td>
        <td aria-label="등록일">2026.07.28</td>
      </tr>
      <tr>
        <td><a href="enewsView.do?news_seq=19705" title="산업안전 일반 안내">일반 안내</a></td>
        <td aria-label="등록일">2026.07.27</td>
      </tr>
      <tr>
        <td><a href="/news/enews/report/enewsView.do?news_seq=19704"
          title="청년 고용 지원 사업 안내">두 번째 보도자료</a></td>
        <td aria-label="등록일">2026.07.26</td>
      </tr>
      <tr>
        <td><a href="enewsView.do?news_seq=19703"
          title="지역 기업이 크고, 청년이 머물도록">세 번째 보도자료</a></td>
        <td aria-label="등록일">2026.07.25</td>
      </tr>
    </tbody></table>
  </body></html>`);

  assert.equal(candidates.length, 3);
  assert.deepEqual(
    candidates.map(({ newsSequence, title, publishedAt, sourceUrl }) => ({
      newsSequence,
      title,
      publishedAt,
      sourceUrl,
    })),
    [
      {
        newsSequence: "19706",
        title: "청년 일자리 회복 & 맞춤 지원",
        publishedAt: "2026-07-28",
        sourceUrl: "https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=19706",
      },
      {
        newsSequence: "19704",
        title: "청년 고용 지원 사업 안내",
        publishedAt: "2026-07-26",
        sourceUrl: "https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=19704",
      },
      {
        newsSequence: "19703",
        title: "지역 기업이 크고, 청년이 머물도록",
        publishedAt: "2026-07-25",
        sourceUrl: "https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=19703",
      },
    ],
  );
  assert.equal(candidates.every(({ sourceUrl }) => {
    const url = new URL(sourceUrl);
    return url.protocol === "https:"
      && url.origin === "https://www.moel.go.kr"
      && url.pathname === "/news/enews/report/enewsView.do"
      && [...url.searchParams.keys()].join(",") === "news_seq";
  }), true);
  assert.doesNotMatch(JSON.stringify(candidates), /evil\.example/u);
});

test("MOEL press detail becomes a concise official item without markup or contact data", () => {
  const [candidate] = normalizeMoelPressListHtml(`<html><body><table><tbody><tr>
    <td><a href="enewsView.do?news_seq=19706" title="청년 일자리 회복 지원">보도자료</a></td>
    <td aria-label="등록일">2026.07.28</td>
  </tr></tbody></table></body></html>`);
  const previous = new Map([[
    "moel-report-19706",
    {
      id: "moel-report-19706",
      category: "youth",
      title: "이전 제목",
      summary: "이전 요약",
      source: "고용노동부 보도자료",
      sourceUrl: candidate.sourceUrl,
      sourceLinkKind: "detail",
      publishedAt: candidate.publishedAt,
      discoveredAt: "2026-07-20T00:00:00.000Z",
      lastVerifiedAt: "2026-07-20T00:00:00.000Z",
      tags: [],
    },
  ]]);

  const item = normalizeMoelPressDetailHtml(`<html><body>
    <div class="board_view_wrap">
      <div class="b_info">고용노동부</div>
      <div class="b_content news_content">
        <strong>청년에게 양질의 일자리와 맞춤형 취업 지원을 확대하며 현장 중심의 고용 서비스를 제공합니다. &amp; 참여 기회를 넓힙니다. 문의 : 홍길동 044-000-0000</strong>
        <p>상세한 사업 일정과 신청 방법을 안내합니다.</p>
      </div>
    </div>
  </body></html>`, candidate, nowIso, previous);

  assert.equal(item.id, "moel-report-19706");
  assert.equal(item.source, "고용노동부 보도자료");
  assert.equal(item.sourceLinkKind, "detail");
  assert.equal(item.sourceUrl, "https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=19706");
  assert.equal(item.publishedAt, "2026-07-28");
  assert.equal(item.discoveredAt, "2026-07-20T00:00:00.000Z");
  assert.equal(item.lastVerifiedAt, nowIso);
  assert.equal(item.tags.includes("section:policy-news"), true);
  assert.equal("youthPolicyEligibility" in item, false);
  assert.match(item.summary, /청년에게 양질의 일자리/u);
  assert.doesNotMatch(item.summary, /<[^>]+>|&amp;|문의|044-/u);
});

test("MOEL press adapter paginates the recent 30-day window and incrementally hydrates uncached details", async () => {
  const candidates = Array.from({ length: MOEL_PRESS_MAX_DETAILS + 2 }, (_, index) => ({
    sequence: 19700 + index,
    title: `청년 일자리 지원 ${index + 1}`,
    date: index < 10 ? "2026.07.22" : "2026.07.21",
  }));
  const row = ({ sequence, title, date }) => `<tr>
    <td><a href="enewsView.do?news_seq=${sequence}" title="${title}">보도자료</a></td>
    <td aria-label="등록일">${date}</td>
  </tr>`;
  const pages = new Map([
    [1, candidates.slice(0, 10).map(row).join("")],
    [2, candidates.slice(10).map(row).join("")],
    [3, row({ sequence: 19000, title: "청년 정책 과거 보도자료", date: "2026.06.01" })],
  ]);
  const createFetch = (requests) => async (input, init) => {
    const endpoint = new URL(String(input));
    requests.push({ endpoint, init });
    if (endpoint.pathname.endsWith("/enewsList.do")) {
      const page = Number(endpoint.searchParams.get("pageIndex"));
      return htmlResponse(`<html><body><table><tbody>${pages.get(page)}</tbody></table></body></html>`);
    }
    return htmlResponse(`<html><body>
      <div class="board_view_wrap"><div class="b_content news_content">
        <strong>청년 구직자의 취업 준비와 일경험을 지원하는 공식 고용 정책을 자세히 안내합니다.</strong>
      </div></div>
    </body></html>`);
  };

  const firstRequests = [];
  const first = await moelPressReleasesAdapter(nowIso, new Map(), createFetch(firstRequests));

  assert.equal(first.source.status, "truncated");
  assert.equal(first.source.errorCode, "moel_press_backfill_in_progress");
  assert.equal(first.source.completeness, "truncated");
  assert.equal(first.incremental, true);
  assert.equal(first.items.length, MOEL_PRESS_MAX_DETAILS);
  assert.equal(first.requestCount, 3 + MOEL_PRESS_MAX_DETAILS);
  assert.equal(first.requestCount <= MOEL_PRESS_MAX_REQUESTS, true);
  assert.equal(firstRequests.length, first.requestCount);
  assert.deepEqual(
    firstRequests
      .filter(({ endpoint }) => endpoint.pathname.endsWith("/enewsList.do"))
      .map(({ endpoint }) => Number(endpoint.searchParams.get("pageIndex"))),
    [1, 2, 3],
  );
  assert.equal(firstRequests[0].endpoint.searchParams.get("searchField"), "3");
  assert.equal(firstRequests[0].endpoint.searchParams.get("searchText"), "청년");
  assert.equal(firstRequests[0].endpoint.searchParams.get("pageUnit"), "10");

  const secondRequests = [];
  const previous = new Map(first.items.map((item) => [item.id, item]));
  const second = await moelPressReleasesAdapter(nowIso, previous, createFetch(secondRequests));

  assert.equal(second.source.status, "live");
  assert.equal(second.source.completeness, "complete");
  assert.equal(second.source.errorCode, undefined);
  assert.equal(second.incremental, true);
  assert.equal(second.items.length, candidates.length);
  assert.equal(second.requestCount, 3 + 2);
  assert.equal(
    secondRequests.filter(({ endpoint }) => endpoint.pathname.endsWith("/enewsView.do")).length,
    2,
  );
  assert.equal(second.items.every((item) =>
    item.sourceLinkKind === "detail"
    && new URL(item.sourceUrl).origin === "https://www.moel.go.kr"), true);
});

test("MOEL press adapter never claims completeness when the safe list-page cap is reached", async () => {
  const requests = [];
  const result = await moelPressReleasesAdapter(nowIso, new Map(), async (input, init) => {
    const endpoint = new URL(String(input));
    requests.push({ endpoint, init });
    if (endpoint.pathname.endsWith("/enewsList.do")) {
      const page = Number(endpoint.searchParams.get("pageIndex"));
      return htmlResponse(`<html><body><table><tbody><tr>
        <td><a href="enewsView.do?news_seq=${19800 + page}" title="청년 고용 지원 ${page}">보도자료</a></td>
        <td aria-label="등록일">2026.07.22</td>
      </tr></tbody></table></body></html>`);
    }
    return htmlResponse(`<html><body>
      <div class="board_view_wrap"><div class="b_content news_content">
        <strong>청년 구직자의 일자리 탐색을 지원하는 고용 정책 보도자료의 상세 내용입니다.</strong>
      </div></div>
    </body></html>`);
  });

  assert.equal(result.source.status, "truncated");
  assert.equal(result.source.errorCode, "moel_press_recent_window_truncated");
  assert.equal(result.source.completeness, "truncated");
  assert.equal(result.requestCount, MOEL_PRESS_MAX_LIST_PAGES * 2);
  assert.equal(result.requestCount <= MOEL_PRESS_MAX_REQUESTS, true);
  assert.equal(
    requests.filter(({ endpoint }) => endpoint.pathname.endsWith("/enewsList.do")).length,
    MOEL_PRESS_MAX_LIST_PAGES,
  );
});

test("MOEL press adapter fails closed on a changed list envelope", async () => {
  const requests = [];
  const result = await moelPressReleasesAdapter(nowIso, new Map(), async (input) => {
    requests.push(new URL(String(input)));
    return htmlResponse("<html><body><main>로그인 또는 변경된 응답</main></body></html>");
  });

  assert.equal(result.source.status, "unavailable");
  assert.equal(result.source.errorCode, "moel_press_list_shape");
  assert.equal(result.failureKind, "transient");
  assert.equal(result.requestCount, 1);
  assert.deepEqual(result.items, []);
  assert.equal(requests.length, 1);
});

test("MOEL press list accepts only an explicit official empty-result state", () => {
  assert.deepEqual(normalizeMoelPressListHtml(`<html><body><table><tbody>
    <tr><td>검색된 결과가 없습니다.</td></tr>
  </tbody></table></body></html>`), []);
  assert.throws(
    () => normalizeMoelPressListHtml(`<html><body><table><tbody>
      <tr><td>예상하지 못한 목록 구조</td></tr>
    </tbody></table></body></html>`),
    /moel_press_list_shape/u,
  );
});

test("MOEL press adapter never follows a cross-origin redirect", async () => {
  const requests = [];
  const result = await moelPressReleasesAdapter(nowIso, new Map(), async (input) => {
    requests.push(new URL(String(input)));
    return new Response(null, {
      status: 302,
      headers: { Location: "https://evil.example/collect" },
    });
  });

  assert.equal(result.source.status, "unavailable");
  assert.equal(result.source.errorCode, "moel_press_redirect");
  assert.equal(result.requestCount, 1);
  assert.deepEqual(result.items, []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].origin, "https://www.moel.go.kr");
});

test("MOEL press adapter rejects even same-origin redirects so request accounting stays exact", async () => {
  const requests = [];
  const result = await moelPressReleasesAdapter(nowIso, new Map(), async (input) => {
    requests.push(new URL(String(input)));
    return new Response(null, {
      status: 302,
      headers: { Location: "/news/enews/report/enewsList.do?pageIndex=1" },
    });
  });

  assert.equal(result.source.status, "unavailable");
  assert.equal(result.source.errorCode, "moel_press_redirect");
  assert.equal(result.requestCount, 1);
  assert.equal(requests.length, 1);
});

test("MOEL press adapter keeps the source unavailable when every fresh detail fails", async () => {
  const candidateUrl = "https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=19706";
  const previous = new Map([[
    "moel-report-19706",
    {
      id: "moel-report-19706",
      category: "youth",
      title: "이전 제목",
      summary: "이전 요약",
      source: "고용노동부 보도자료",
      sourceUrl: candidateUrl,
      sourceLinkKind: "detail",
      publishedAt: "2026-07-28",
      discoveredAt: "2026-07-20T00:00:00.000Z",
      lastVerifiedAt: "2026-07-20T00:00:00.000Z",
      tags: ["section:policy-news"],
    },
  ]]);
  let requestCount = 0;
  const result = await moelPressReleasesAdapter(nowIso, previous, async (input) => {
    requestCount += 1;
    const endpoint = new URL(String(input));
    if (endpoint.pathname.endsWith("/enewsList.do")) {
      return htmlResponse(`<html><body><table><tbody><tr>
        <td><a href="enewsView.do?news_seq=19706" title="청년 일자리 지원">보도자료</a></td>
        <td aria-label="등록일">2026.07.28</td>
      </tr></tbody></table></body></html>`);
    }
    return htmlResponse("<html><body><main>상세 구조 변경</main></body></html>");
  });

  assert.equal(result.source.status, "unavailable");
  assert.equal(result.source.errorCode, "moel_press_details_unavailable");
  assert.equal(result.failureKind, "transient");
  assert.equal(result.requestCount, requestCount);
  assert.deepEqual(result.items, []);
});

test("MOEL press page denial is transient because the keyless source needs no approval", async () => {
  const result = await moelPressReleasesAdapter(
    nowIso,
    new Map(),
    async () => htmlResponse("<html><body>접근 제한</body></html>", 403),
  );

  assert.equal(result.source.status, "unavailable");
  assert.equal(result.failureKind, "transient");
  assert.equal(result.source.errorCode, "moel_press_http_403");
});

test("MOEL press detail rejects untrusted candidates and changed detail markup", () => {
  const trustedCandidate = {
    newsSequence: "19706",
    title: "청년 일자리 지원",
    publishedAt: "2026-07-28",
    sourceUrl: "https://www.moel.go.kr/news/enews/report/enewsView.do?news_seq=19706",
  };
  assert.throws(
    () => normalizeMoelPressDetailHtml(
      "<html><body><div class=\"board_view_wrap\"></div></body></html>",
      trustedCandidate,
      nowIso,
      new Map(),
    ),
    /moel_press_detail_shape/u,
  );
  assert.throws(
    () => normalizeMoelPressDetailHtml(
      "<html><body><div class=\"board_view_wrap\"><div class=\"b_content news_content\">내용</div></div></body></html>",
      { ...trustedCandidate, sourceUrl: "https://evil.example/report" },
      nowIso,
      new Map(),
    ),
    /moel_press_candidate/u,
  );
});

test("official XML adapters reject a 200-shaped login page or changed envelope", () => {
  assert.throws(
    () => normalizeWork24Xml("<html><body>login</body></html>", nowIso, new Map()),
    /work24_shape/u,
  );
  assert.throws(
    () => normalizeYouthCenterXml("<response><respResult>200</respResult></response>", "employment", nowIso, new Map()),
    /youth_center_shape/u,
  );
  assert.throws(
    () => normalizeMoelPolicyRss("<html><channel></channel></html>", nowIso, new Map()),
    /moel_rss_shape/u,
  );
});
