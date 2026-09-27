import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
const adapters = await server.ssrLoadModule("/lib/public-data/startup-adapters.ts");
const policies = await server.ssrLoadModule("/lib/public-data/policies.ts");
test.after(() => server.close());

const NOW = "2026-07-24T03:00:00.000Z";
const SECRET = "DATA_GO_SECRET_%2B_FOR_TEST";

function response(payload, status = 200, contentType = "application/json") {
  return new Response(
    typeof payload === "string" ? payload : JSON.stringify(payload),
    { status, headers: { "content-type": contentType } },
  );
}

function standardPage(items, totalCount, pageNo, numOfRows) {
  return {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
      body: {
        items: { item: items },
        totalCount,
        pageNo,
        numOfRows,
      },
    },
  };
}

function bizinfoRow(id, overrides = {}) {
  return {
    pblancId: id,
    pblancNm: `기업마당 공고 ${id}`,
    bsnsSumryCn: "공식 사업 개요",
    creatPnttm: "2026-07-20 09:00:00",
    lastUpdtPnttm: "2026-07-21 10:00:00",
    reqstBeginEndDe: "20260720 ~ 20260831",
    trgetNm: "예비창업자",
    jrsdInsttNm: "중소벤처기업부",
    excInsttNm: "서울지방중소벤처기업청",
    pldirSportRealmLclasCodeNm: "창업",
    hashTags: "창업,서울,2026",
    reqstMthPapersCn: "온라인 신청",
    refrncNm: "공식 공고 문의처",
    pblancUrl: `https://www.bizinfo.go.kr/web/notice/${id}`,
    rceptEngnHmpgUrl: "https://apply.attacker.example/steal",
    ...overrides,
  };
}

function kstartupRow(id, overrides = {}) {
  return {
    pbanc_sn: id,
    biz_pbanc_nm: `K-Startup 공고 ${id}`,
    pbanc_ctnt: "공식 창업지원 공고 내용",
    pbanc_rcpt_bgng_dt: "20260701",
    pbanc_rcpt_end_dt: "20260731",
    aply_trgt: "예비창업자",
    sprv_inst: "공공기관",
    supt_biz_clsfc: "사업화",
    supt_regin: "경기",
    detl_pg_url: `https://www.k-startup.go.kr/web/notice/${id}`,
    aply_mthd_onli_rcpt_istc: `https://www.k-startup.go.kr/apply/${id}`,
    ...overrides,
  };
}

test("only official province tokens become structured startup regions", () => {
  assert.deepEqual(
    adapters.startupRegionsFromOfficialFields("서울, 경기", "창업,충북"),
    ["서울특별시", "경기도", "충청북도"],
  );
  assert.deepEqual(
    adapters.startupRegionsFromOfficialFields("전남광주"),
    ["광주광역시", "전라남도"],
  );
  assert.deepEqual(
    adapters.startupRegionsFromOfficialFields("전국", "서울 강남구", "미정"),
    [],
  );
});

test("provider taxonomy hashtags cannot override trusted startup region fields", () => {
  const normalize = (overrides) => adapters.normalizeDataGoBizinfoAnnouncement(
    bizinfoRow(`taxonomy-${overrides.pblancNm}`, overrides),
    { nowIso: NOW, previous: new Map(), allowedApplicationHosts: [] },
  );
  const allProvinceTags = adapters.STARTUP_PROVINCES.join(",");
  const hashOnlyTaxonomy = normalize({
    pblancNm: "hash-only",
    hashTags: `${allProvinceTags},영월군`,
  });
  const explicitNationwide = normalize({
    pblancNm: "nationwide",
    hashTags: `${allProvinceTags},전국`,
  });
  const trustedGangwon = normalize({
    pblancNm: "trusted-gangwon",
    sprtTrgtRgnCn: "강원특별자치도",
    hashTags: allProvinceTags,
  });
  const trustedNationwide = normalize({
    pblancNm: "trusted-nationwide",
    sprtTrgtRgnCn: "전국",
    hashTags: "서울특별시",
  });
  const mixedTrustedNationwide = normalize({
    pblancNm: "mixed-trusted-nationwide",
    sprtTrgtRgnCn: "전국,서울특별시",
    hashTags: "강원특별자치도",
  });
  const mixedHashNationwide = normalize({
    pblancNm: "mixed-hash-nationwide",
    hashTags: "전국,서울특별시",
  });
  const trustedGangwonWithNoisyHash = normalize({
    pblancNm: "trusted-gangwon-noisy-hash",
    sprtTrgtRgnCn: "강원특별자치도",
    hashTags: "전국,서울특별시",
  });
  const sixteenRegions = normalize({
    pblancNm: "sixteen-regions",
    hashTags: adapters.STARTUP_PROVINCES.slice(0, -1).join(","),
  });

  assert.equal(hashOnlyTaxonomy.scope, "unknown");
  assert.deepEqual(hashOnlyTaxonomy.targetRegions, []);
  assert.equal(hashOnlyTaxonomy.item.location, undefined);
  assert.equal(
    adapters.STARTUP_PROVINCES.some((province) => hashOnlyTaxonomy.item.tags.includes(province)),
    false,
  );
  assert.equal(explicitNationwide.scope, "nationwide");
  assert.deepEqual(explicitNationwide.targetRegions, []);
  assert.equal(trustedGangwon.scope, "regional");
  assert.deepEqual(trustedGangwon.targetRegions, ["강원특별자치도"]);
  assert.equal(trustedGangwon.item.location?.province, "강원특별자치도");
  assert.equal(trustedNationwide.scope, "nationwide");
  assert.deepEqual(trustedNationwide.targetRegions, []);
  assert.equal(mixedTrustedNationwide.scope, "nationwide");
  assert.deepEqual(mixedTrustedNationwide.targetRegions, []);
  assert.equal(mixedHashNationwide.scope, "nationwide");
  assert.deepEqual(mixedHashNationwide.targetRegions, []);
  assert.equal(trustedGangwonWithNoisyHash.scope, "regional");
  assert.deepEqual(trustedGangwonWithNoisyHash.targetRegions, ["강원특별자치도"]);
  assert.equal(sixteenRegions.scope, "regional");
  assert.deepEqual(sixteenRegions.targetRegions, adapters.STARTUP_PROVINCES.slice(0, -1));
});

test("the 2026 data.go Bizinfo adapter paginates, deduplicates and preserves official region evidence", async () => {
  const calls = [];
  const firstRows = [
    bizinfoRow("PBLN-1"),
    bizinfoRow("PBLN-2", {
      hashTags: "창업,서울,경기",
      pblancUrl: "https://attacker.example/not-official",
      rceptEngnHmpgUrl: "https://www.bizinfo.go.kr/apply/PBLN-2",
    }),
  ];
  const secondRows = [
    bizinfoRow("PBLN-2", {
      hashTags: "창업,서울,경기",
      pblancUrl: "https://attacker.example/not-official",
      rceptEngnHmpgUrl: "https://www.bizinfo.go.kr/apply/PBLN-2",
    }),
    bizinfoRow("PBLN-3", {
      hashTags: "창업,전국",
      pblancUrl: "/web/notice/PBLN-3",
    }),
  ];
  const result = await adapters.dataGoBizinfoStartupAdapter({
    apiKey: SECRET,
    nowIso: NOW,
    pageSize: 2,
    fetchImpl: async (input, init) => {
      const endpoint = new URL(input);
      calls.push(endpoint);
      assert.equal(init.redirect, "manual");
      assert.equal(endpoint.origin + endpoint.pathname, adapters.DATA_GO_BIZINFO_ENDPOINT);
      assert.equal(endpoint.searchParams.get("searchLclasId"), "06");
      assert.equal(endpoint.searchParams.get("numOfRows"), "2");
      assert.equal(endpoint.searchParams.get("serviceKey"), "DATA_GO_SECRET_+_FOR_TEST");
      const page = Number(endpoint.searchParams.get("pageNo"));
      return response(standardPage(page === 1 ? firstRows : secondRows, 4, page, 2));
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(result.requestCount, 2);
  assert.equal(result.totalCount, 4);
  assert.equal(result.fetchedCount, 4);
  assert.equal(result.completeness, "complete");
  assert.equal(result.source.status, "live");
  assert.deepEqual(result.items.map((item) => item.id), [
    "bizinfo-data-go-PBLN-1",
    "bizinfo-data-go-PBLN-2",
    "bizinfo-data-go-PBLN-3",
  ]);

  const singleRegion = result.records[0];
  assert.deepEqual(singleRegion.targetRegions, ["서울특별시"]);
  assert.deepEqual(singleRegion.item.location, {
    label: "서울특별시",
    province: "서울특별시",
    precision: "administrative",
  });
  assert.equal(singleRegion.applicationStartsAt, "2026-07-20");
  assert.equal(singleRegion.applicationEndsAt, "2026-08-31");
  assert.equal(singleRegion.item.expiresAt, "2026-08-31");
  assert.equal(singleRegion.applicationUrl, null, "unlisted application host must be rejected");

  const multipleRegions = result.records[1];
  assert.deepEqual(multipleRegions.targetRegions, ["서울특별시", "경기도"]);
  assert.equal(multipleRegions.item.location, undefined, "one point must not represent several regions");
  assert.equal(multipleRegions.detailUrl, null);
  assert.equal(multipleRegions.item.sourceUrl, adapters.DATA_GO_BIZINFO_SOURCE_URL);
  assert.equal(multipleRegions.applicationUrl, "https://www.bizinfo.go.kr/apply/PBLN-2");
  assert.ok(multipleRegions.item.tags.includes("서울특별시"));
  assert.ok(multipleRegions.item.tags.includes("경기도"));

  const nationwide = result.records[2];
  assert.equal(nationwide.scope, "nationwide");
  assert.deepEqual(nationwide.targetRegions, []);
  assert.equal(nationwide.item.location, undefined);
  assert.equal(nationwide.detailUrl, "https://www.bizinfo.go.kr/web/notice/PBLN-3");
  assert.doesNotMatch(JSON.stringify(result), /DATA_GO_SECRET|serviceKey/u);
});

test("K-Startup accepts XML col rows and keeps only allowlisted detail and application URLs", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <results>
      <currentCount>1</currentCount>
      <data>
        <item>
          <col name="pbanc_sn">KS-1</col>
          <col name="biz_pbanc_nm"><![CDATA[공식 K-Startup 공고]]></col>
          <col name="pbanc_ctnt">사업화 지원</col>
          <col name="pbanc_rcpt_bgng_dt">20260701</col>
          <col name="pbanc_rcpt_end_dt">20260731</col>
          <col name="aply_trgt">예비창업자</col>
          <col name="sprv_inst">창업진흥원</col>
          <col name="supt_biz_clsfc">사업화</col>
          <col name="supt_regin">제주</col>
          <col name="detl_pg_url">https://www.k-startup.go.kr/web/notice/KS-1#section</col>
          <col name="aply_mthd_onli_rcpt_istc">https://outside.example/apply</col>
        </item>
      </data>
      <page>1</page>
      <pPage>2</pPage>
      <totalCount>1</totalCount>
    </results>`;

  const result = await adapters.kStartupAnnouncementAdapter({
    apiKey: SECRET,
    nowIso: NOW,
    pageSize: 2,
    fetchImpl: async (input) => {
      const endpoint = new URL(input);
      assert.equal(endpoint.origin + endpoint.pathname, adapters.K_STARTUP_ANNOUNCEMENT_ENDPOINT);
      assert.equal(endpoint.searchParams.get("returnType"), "json");
      assert.equal(endpoint.searchParams.get("page"), "1");
      assert.equal(endpoint.searchParams.get("perPage"), "2");
      return response(xml, 200, "application/xml");
    },
  });

  assert.equal(result.source.status, "live");
  assert.equal(result.requestCount, 1);
  assert.equal(result.completeness, "complete");
  assert.equal(result.items[0].id, "kstartup-KS-1");
  assert.equal(result.records[0].detailUrl, "https://www.k-startup.go.kr/web/notice/KS-1");
  assert.equal(result.records[0].applicationUrl, null);
  assert.deepEqual(result.records[0].targetRegions, ["제주특별자치도"]);
  assert.equal(result.items[0].location.province, "제주특별자치도");
  assert.doesNotMatch(JSON.stringify(result), /DATA_GO_SECRET|serviceKey/u);
});

test("a valid first page survives a second-page outage as an explicit partial result", async () => {
  let calls = 0;
  const result = await adapters.dataGoBizinfoStartupAdapter({
    apiKey: SECRET,
    nowIso: NOW,
    pageSize: 2,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? response(standardPage([bizinfoRow("P-1"), bizinfoRow("P-2")], 3, 1, 2))
        : response({ error: "upstream unavailable" }, 503);
    },
  });

  assert.equal(result.source.status, "live");
  assert.equal(result.source.errorCode, "startup_upstream_http_503");
  assert.equal(result.failureKind, "transient");
  assert.equal(result.completeness, "partial");
  assert.equal(result.requestCount, 2);
  assert.equal(result.totalCount, 3);
  assert.equal(result.fetchedCount, 2);
  assert.equal(result.items.length, 2);
});

test("pagination follows every available page below the bounded maximum", async () => {
  const calls = [];
  const rows = Array.from({ length: 6 }, (_, index) => kstartupRow(`KS-${index + 1}`));
  const result = await adapters.kStartupAnnouncementAdapter({
    apiKey: SECRET,
    nowIso: NOW,
    pageSize: 2,
    fetchImpl: async (input) => {
      const endpoint = new URL(input);
      const page = Number(endpoint.searchParams.get("page"));
      calls.push(page);
      return response({
        currentCount: 2,
        data: rows.slice((page - 1) * 2, page * 2),
        page,
        perPage: 2,
        totalCount: 6,
      });
    },
  });

  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.requestCount, 3);
  assert.equal(result.totalCount, 6);
  assert.equal(result.fetchedCount, 6);
  assert.equal(result.items.length, 6);
  assert.equal(result.completeness, "complete");
});

test("checkpointed startup collection resumes remaining pages and reuses stored items", async () => {
  const rows = Array.from({ length: 8 }, (_, index) => kstartupRow(`RESUME-${index + 1}`));
  const storedByPage = new Map();
  let checkpoint = null;
  const calls = [];
  const commitPage = async (commit) => {
    checkpoint = structuredClone(commit.checkpoint);
    storedByPage.set(commit.pageNumber, structuredClone(commit.items));
  };
  const fetchImpl = async (input) => {
    const endpoint = new URL(input);
    const page = Number(endpoint.searchParams.get("page"));
    calls.push(page);
    return response({
      currentCount: 2,
      data: rows.slice((page - 1) * 2, page * 2),
      page,
      perPage: 2,
      totalCount: 8,
    });
  };

  const first = await adapters.kStartupAnnouncementAdapter({
    apiKey: SECRET,
    nowIso: NOW,
    pageSize: 2,
    fetchImpl,
    backfill: {
      checkpoint: null,
      stagedItems: [],
      maxBackfillPagesPerRun: 2,
      commitPage,
    },
  });

  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(first.incremental, true);
  assert.equal(first.completeness, "truncated");
  assert.equal(first.source.errorCode, "startup_backfill_in_progress");
  assert.equal(checkpoint.nextPage, 4);
  assert.equal(checkpoint.completed, false);
  assert.equal(first.items.length, 6);

  calls.length = 0;
  const stagedItems = [...storedByPage.values()].flat();
  const second = await adapters.kStartupAnnouncementAdapter({
    apiKey: SECRET,
    nowIso: "2026-07-24T03:02:00.000Z",
    pageSize: 2,
    fetchImpl,
    backfill: {
      checkpoint,
      stagedItems,
      maxBackfillPagesPerRun: 2,
      commitPage,
    },
  });

  assert.deepEqual(calls, [1, 4]);
  assert.equal(second.completeness, "complete");
  assert.equal(second.source.errorCode, undefined);
  assert.equal(checkpoint.completed, true);
  assert.equal(checkpoint.nextPage, 5);
  assert.deepEqual(
    second.items.map((item) => item.id).sort(),
    rows.map((row) => `kstartup-${row.pbanc_sn}`).sort(),
  );
});

test("startup catalog starts a clean reconciliation generation on the next KST day", async () => {
  let rows = [
    kstartupRow("OLD-1"),
    kstartupRow("OLD-2"),
    kstartupRow("OLD-3"),
    kstartupRow("REMOVED"),
  ];
  let checkpoint = null;
  let stagedItems = [];
  const calls = [];
  const commitPage = async (commit) => {
    checkpoint = structuredClone(commit.checkpoint);
    stagedItems = [...stagedItems, ...structuredClone(commit.items)];
  };
  const fetchImpl = async (input) => {
    const page = Number(new URL(input).searchParams.get("page"));
    calls.push(page);
    return response({
      currentCount: 2,
      data: rows.slice((page - 1) * 2, page * 2),
      page,
      perPage: 2,
      totalCount: rows.length,
    });
  };

  await adapters.kStartupAnnouncementAdapter({
    apiKey: SECRET,
    nowIso: "2026-07-24T14:59:00.000Z",
    pageSize: 2,
    fetchImpl,
    backfill: { checkpoint: null, stagedItems: [], maxBackfillPagesPerRun: 2, commitPage },
  });
  assert.equal(checkpoint.completed, true);
  const oldSignature = checkpoint.querySignature;

  calls.length = 0;
  rows = [
    kstartupRow("NEW"),
    kstartupRow("OLD-1"),
    kstartupRow("OLD-2"),
    kstartupRow("OLD-3"),
  ];
  const result = await adapters.kStartupAnnouncementAdapter({
    apiKey: SECRET,
    nowIso: "2026-07-24T15:01:00.000Z",
    pageSize: 2,
    fetchImpl,
    backfill: { checkpoint, stagedItems, maxBackfillPagesPerRun: 2, commitPage },
  });

  assert.deepEqual(calls, [1, 2]);
  assert.notEqual(checkpoint.querySignature, oldSignature);
  assert.ok(result.items.some((item) => item.id === "kstartup-NEW"));
  assert.ok(!result.items.some((item) => item.id === "kstartup-REMOVED"));
});

test("same-day startup total changes restart offset pages and a failed first commit preserves the old generation", async () => {
  let rows = Array.from({ length: 4 }, (_, index) => kstartupRow(`OLD-${index}`));
  let checkpoint = null;
  let failReset = false;
  const saved = new Map();
  const commits = [];
  const calls = [];
  const commitPage = async (commit) => {
    commits.push(structuredClone(commit));
    if (failReset && commit.resetGeneration) throw new Error("synthetic first-page commit failure");
    if (commit.resetGeneration) saved.clear();
    saved.set(commit.pageNumber, structuredClone(commit.items));
    checkpoint = structuredClone(commit.checkpoint);
  };
  const run = () => adapters.kStartupAnnouncementAdapter({
    apiKey: SECRET, nowIso: NOW, pageSize: 2,
    fetchImpl: async (input) => {
      const page = Number(new URL(input).searchParams.get("page"));
      calls.push(page);
      return response({ currentCount: rows.slice((page - 1) * 2, page * 2).length,
        data: rows.slice((page - 1) * 2, page * 2), page, perPage: 2, totalCount: rows.length });
    },
    backfill: { checkpoint, stagedItems: [...saved.values()].flat(), maxBackfillPagesPerRun: 2, commitPage },
  });
  const first = await run();
  assert.equal(first.completeness, "complete");
  const before = { checkpoint: structuredClone(checkpoint), saved: structuredClone([...saved]) };
  rows = Array.from({ length: 5 }, (_, index) => kstartupRow(`NEW-${index}`));
  failReset = true;
  commits.length = 0;
  calls.length = 0;
  const failed = await run();
  assert.deepEqual(calls, [1]);
  assert.equal(failed.source.errorCode, "startup_checkpoint_commit_failed");
  assert.equal(failed.items.length, 0, "a failed durable reset must not expose a replacement catalogue");
  assert.equal(commits[0].resetGeneration, true);
  assert.deepEqual({ checkpoint, saved: [...saved] }, before);
  failReset = false;
  calls.length = 0;
  const recovered = await run();
  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(recovered.completeness, "complete");
  assert.equal(recovered.items.length, 5);
  assert.equal(recovered.items.some((item) => item.id.includes("OLD-")), false);
  assert.deepEqual([...saved.keys()], [1, 2, 3]);
  assert.equal(checkpoint.providerTotalCount, 5);
  assert.equal(checkpoint.fetchedCount, 5);
});

test("incomplete startup and DART catalogues are requeued without bypassing quota guards", async () => {
  assert.equal(policies.isPublicCatalogBackfillInProgress("startup_backfill_in_progress"), true);
  assert.equal(policies.isPublicCatalogBackfillInProgress("warning_dart_backfill_in_progress"), true);
  assert.equal(policies.isPublicCatalogBackfillInProgress("bizinfo_backfill_in_progress"), true);
  assert.equal(policies.isPublicCatalogBackfillInProgress("work24_backfill_in_progress"), true);
  assert.equal(policies.isPublicCatalogBackfillInProgress("youth_center_backfill_in_progress"), true);
  assert.equal(policies.isPublicCatalogBackfillInProgress("moel_press_backfill_in_progress"), true);
  assert.equal(policies.isPublicCatalogBackfillInProgress("startup_upstream_http_503"), false);

  const service = await readFile(
    new URL("../lib/public-data/service.ts", import.meta.url),
    "utf8",
  );
  assert.match(service, /PUBLIC_CATALOG_BACKFILL_REFRESH_MS = 2 \* 60 \* 1_000/u);
  assert.match(service, /catalogBackfillIncomplete[\s\S]*PUBLIC_CATALOG_BACKFILL_REFRESH_MS/u);
  assert.match(service, /acceleratedCatalogBackfill[\s\S]*acceleratedPolicyDueAt/u);
  assert.match(service, /PUBLIC_API_HARD_STOP_RATIO/u);
});

test("authorization and malformed first pages fail closed without leaking the key", async () => {
  const unauthorized = await adapters.kStartupAnnouncementAdapter({
    apiKey: SECRET,
    nowIso: NOW,
    pageSize: 2,
    fetchImpl: async () => response(`
      <OpenAPI_ServiceResponse>
        <cmmMsgHeader>
          <returnReasonCode>30</returnReasonCode>
          <errMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</errMsg>
        </cmmMsgHeader>
      </OpenAPI_ServiceResponse>
    `, 200, "application/xml"),
  });
  assert.equal(unauthorized.source.status, "authorization-pending");
  assert.equal(unauthorized.failureKind, "authorization");
  assert.equal(unauthorized.requestCount, 1);
  assert.deepEqual(unauthorized.items, []);

  const malformed = await adapters.dataGoBizinfoStartupAdapter({
    apiKey: SECRET,
    nowIso: NOW,
    pageSize: 2,
    fetchImpl: async () => response("<html>maintenance</html>", 200, "text/html"),
  });
  assert.equal(malformed.source.status, "unavailable");
  assert.equal(malformed.source.errorCode, "startup_invalid_xml_shape");
  assert.equal(malformed.requestCount, 1);
  assert.deepEqual(malformed.records, []);
  assert.doesNotMatch(JSON.stringify({ unauthorized, malformed }), /DATA_GO_SECRET|serviceKey/u);
});
