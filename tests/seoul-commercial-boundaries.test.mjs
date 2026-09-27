import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { epsg5181ToWgs84 } from "../scripts/build-seoul-commercial-boundaries.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetPath = path.join(
  root,
  "public",
  "data",
  "seoul-commercial-boundaries.min.json",
);
const raw = fs.readFileSync(assetPath, "utf8");
const asset = JSON.parse(raw);

test("EPSG:5181 false origin resolves to its documented WGS84 origin", () => {
  const [longitude, latitude] = epsg5181ToWgs84(200_000, 500_000);
  assert.ok(Math.abs(longitude - 127) < 1e-9);
  assert.ok(Math.abs(latitude - 38) < 1e-9);
});

test("서울 상권 경계 자산은 공식 출처와 비측량용 메타데이터를 보존한다", () => {
  assert.equal(
    asset.sourceUrl,
    "https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do",
  );
  assert.equal(asset.sourceUpdatedAt, "2026-06-11");
  assert.equal(asset.metadata.inputCrs, "EPSG:5181");
  assert.equal(asset.metadata.outputCrs, "EPSG:4326");
  assert.equal(asset.metadata.maxPointsPerBoundary, 24);
  assert.equal(asset.metadata.coordinatePrecision, 5);
  assert.equal(asset.metadata.notForLegalSurvey, true);
  assert.match(asset.metadata.note, /법적 측량/u);
});

test("서울 상권 경계 자산은 1,650개 상권을 브라우저용 크기로 제공한다", () => {
  assert.equal(Object.keys(asset.boundaries).length, 1_650);
  assert.ok(Buffer.byteLength(raw) < 900 * 1024, "경계 자산은 900 KiB 미만이어야 합니다.");
});

test("모든 경계는 최대 24개의 유효한 서울 WGS84 좌표만 포함한다", () => {
  for (const [code, points] of Object.entries(asset.boundaries)) {
    assert.match(code, /^\d{7}$/u);
    assert.ok(points.length >= 3 && points.length <= 24, `${code}: ${points.length}점`);

    for (const point of points) {
      assert.equal(point.length, 2);
      const [longitude, latitude] = point;
      assert.ok(Number.isFinite(longitude));
      assert.ok(Number.isFinite(latitude));
      assert.ok(longitude >= 126.7 && longitude <= 127.3, `${code}: 경도 ${longitude}`);
      assert.ok(latitude >= 37.4 && latitude <= 37.75, `${code}: 위도 ${latitude}`);
      assert.ok(
        Math.abs(longitude * 100_000 - Math.round(longitude * 100_000)) < 1e-7,
        `${code}: 경도 소수점 자릿수`,
      );
      assert.ok(
        Math.abs(latitude * 100_000 - Math.round(latitude * 100_000)) < 1e-7,
        `${code}: 위도 소수점 자릿수`,
      );
    }
  }
});
