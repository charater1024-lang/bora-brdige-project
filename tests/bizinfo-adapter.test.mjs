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
  resolve: { alias: { "@": projectRoot } },
  server: { middlewareMode: true },
});
const { normalizeBizinfoPayload } = await server.ssrLoadModule("/lib/public-data/adapters.ts");
test.after(() => server.close());

test("Bizinfo accepts its current top-level jsonArray response", () => {
  const rows = normalizeBizinfoPayload({
    jsonArray: [
      { pblancId: "NOTICE-1", pblancNm: "창업 지원 공고" },
      { pblancId: "NOTICE-2", pblancNm: "청년 창업 공고" },
    ],
  });

  assert.deepEqual(rows.map((row) => row.pblancId), ["NOTICE-1", "NOTICE-2"]);
});

test("Bizinfo retains compatibility with the legacy jsonArray.item response", () => {
  const rows = normalizeBizinfoPayload({
    jsonArray: { item: { pblancId: "LEGACY-1", pblancNm: "기존 공고" } },
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].pblancId, "LEGACY-1");
});

test("Bizinfo provider authentication errors fail closed", () => {
  assert.throws(
    () => normalizeBizinfoPayload({ reqErr: "존재하지 않는 인증키 입니다." }),
    /bizinfo_authorization/u,
  );
});
