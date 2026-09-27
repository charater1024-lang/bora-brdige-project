#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do";
const SOURCE_UPDATED_AT = "2026-06-11";
const DEFAULT_OUTPUT = path.resolve(
  "public/data/seoul-commercial-boundaries.min.json",
);
const MAX_POINTS = 24;
const COORDINATE_PRECISION = 5;

function decodeZipName(buffer, utf8) {
  if (utf8) return new TextDecoder("utf-8").decode(buffer);

  try {
    return new TextDecoder("euc-kr").decode(buffer);
  } catch {
    return buffer.toString("latin1");
  }
}

function unzipEntries(zipBuffer) {
  const minimumEocdOffset = Math.max(0, zipBuffer.length - 65_557);
  let eocdOffset = -1;

  for (let offset = zipBuffer.length - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) throw new Error("ZIP central directory를 찾을 수 없습니다.");

  const entryCount = zipBuffer.readUInt16LE(eocdOffset + 10);
  let offset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("지원하지 않는 ZIP central directory 형식입니다.");
    }

    const flags = zipBuffer.readUInt16LE(offset + 8);
    const method = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
    const nameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
    const filename = decodeZipName(
      zipBuffer.subarray(offset + 46, offset + 46 + nameLength),
      Boolean(flags & 0x0800),
    ).replaceAll("\\", "/");

    if (flags & 0x0001) throw new Error("암호화된 ZIP은 지원하지 않습니다.");
    if (zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
      throw new Error(`ZIP local header가 올바르지 않습니다: ${filename}`);
    }

    const localNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = zipBuffer.subarray(dataOffset, dataOffset + compressedSize);
    let value;

    if (method === 0) value = Buffer.from(compressed);
    else if (method === 8) value = inflateRawSync(compressed);
    else throw new Error(`지원하지 않는 ZIP 압축 방식(${method})입니다: ${filename}`);

    if (value.length !== uncompressedSize) {
      throw new Error(`ZIP 압축 해제 크기가 일치하지 않습니다: ${filename}`);
    }

    entries.set(filename, value);
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function selectShapeSidecars(entries) {
  const filenames = [...entries.keys()];
  const shpName = filenames.find((name) => name.toLowerCase().endsWith(".shp"));
  if (!shpName) throw new Error("입력 ZIP에 SHP 파일이 없습니다.");

  const base = shpName.slice(0, -4).toLowerCase();
  const find = (extension, required = true) => {
    const name = filenames.find(
      (candidate) => candidate.toLowerCase() === `${base}.${extension}`,
    );
    if (!name && required) throw new Error(`입력 ZIP에 .${extension} 파일이 없습니다.`);
    return name ? entries.get(name) : null;
  };

  return { shp: entries.get(shpName), dbf: find("dbf"), prj: find("prj", false) };
}

function findFilesystemSidecar(shpPath, extension, required = true) {
  const directory = path.dirname(shpPath);
  const base = path.basename(shpPath, path.extname(shpPath)).toLowerCase();
  const filename = fs
    .readdirSync(directory)
    .find(
      (candidate) =>
        path.basename(candidate, path.extname(candidate)).toLowerCase() === base &&
        path.extname(candidate).toLowerCase() === `.${extension}`,
    );

  if (!filename && required) throw new Error(`SHP 옆에 .${extension} 파일이 없습니다.`);
  return filename ? fs.readFileSync(path.join(directory, filename)) : null;
}

function findShpInDirectory(directory) {
  const filename = fs
    .readdirSync(directory)
    .find((candidate) => path.extname(candidate).toLowerCase() === ".shp");
  if (!filename) throw new Error("입력 디렉터리에 SHP 파일이 없습니다.");
  return path.join(directory, filename);
}

function loadShapeFiles(inputPath) {
  const resolved = path.resolve(inputPath);
  const stat = fs.statSync(resolved);
  if (stat.isDirectory()) return loadShapeFiles(findShpInDirectory(resolved));

  if (path.extname(resolved).toLowerCase() === ".zip") {
    return selectShapeSidecars(unzipEntries(fs.readFileSync(resolved)));
  }

  if (path.extname(resolved).toLowerCase() !== ".shp") {
    throw new Error("입력은 공식 ZIP, SHP 또는 SHP가 든 디렉터리여야 합니다.");
  }

  return {
    shp: fs.readFileSync(resolved),
    dbf: findFilesystemSidecar(resolved, "dbf"),
    prj: findFilesystemSidecar(resolved, "prj", false),
  };
}

function validateProjection(prjBuffer) {
  if (!prjBuffer) return;
  const wkt = prjBuffer.toString("utf8");
  const expected = [
    /Korea_2000_Korea_Central_Belt/i,
    /Central_Meridian"\s*,\s*127(?:\.0+)?/i,
    /False_Easting"\s*,\s*200000(?:\.0+)?/i,
    /False_Northing"\s*,\s*500000(?:\.0+)?/i,
  ];
  if (!expected.every((pattern) => pattern.test(wkt))) {
    throw new Error("입력 PRJ가 지원 좌표계(EPSG:5181)와 일치하지 않습니다.");
  }
}

function readDbfRecords(buffer) {
  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];

  for (let offset = 32; offset + 32 <= headerLength && buffer[offset] !== 0x0d; offset += 32) {
    fields.push({
      name: buffer
        .subarray(offset, offset + 11)
        .toString("ascii")
        .replace(/\0.*$/u, "")
        .trim(),
      length: buffer[offset + 16],
    });
  }

  const codeField = fields.find((field) => field.name === "TRDAR_CD");
  if (!codeField) throw new Error("DBF에 TRDAR_CD 필드가 없습니다.");

  return Array.from({ length: recordCount }, (_, index) => {
    const recordOffset = headerLength + index * recordLength;
    if (recordOffset + recordLength > buffer.length) {
      throw new Error(`DBF ${index + 1}번 레코드가 잘렸습니다.`);
    }

    let fieldOffset = recordOffset + 1;
    let code = "";
    for (const field of fields) {
      if (field === codeField) {
        code = buffer
          .subarray(fieldOffset, fieldOffset + field.length)
          .toString("utf8")
          .trim();
      }
      fieldOffset += field.length;
    }

    return buffer[recordOffset] === 0x2a ? null : code;
  });
}

function readPolygonRings(buffer) {
  if (buffer.length < 100 || buffer.readInt32BE(0) !== 9994) {
    throw new Error("올바른 ESRI Shapefile이 아닙니다.");
  }

  const fileShapeType = buffer.readInt32LE(32);
  if (![5, 15, 25].includes(fileShapeType)) {
    throw new Error(`Polygon SHP만 지원합니다. shapeType=${fileShapeType}`);
  }

  const records = [];
  let offset = 100;
  while (offset + 8 <= buffer.length) {
    const contentLength = buffer.readInt32BE(offset + 4) * 2;
    const contentOffset = offset + 8;
    const contentEnd = contentOffset + contentLength;
    if (contentEnd > buffer.length) throw new Error("SHP 레코드가 잘렸습니다.");

    const shapeType = buffer.readInt32LE(contentOffset);
    if (shapeType === 0) {
      records.push([]);
    } else {
      if (![5, 15, 25].includes(shapeType)) {
        throw new Error(`지원하지 않는 SHP 레코드 타입입니다: ${shapeType}`);
      }

      const partCount = buffer.readInt32LE(contentOffset + 36);
      const pointCount = buffer.readInt32LE(contentOffset + 40);
      const partsOffset = contentOffset + 44;
      const pointsOffset = partsOffset + partCount * 4;
      if (pointsOffset + pointCount * 16 > contentEnd) {
        throw new Error("SHP Polygon 좌표가 잘렸습니다.");
      }

      const starts = Array.from({ length: partCount }, (_, index) =>
        buffer.readInt32LE(partsOffset + index * 4),
      );
      starts.push(pointCount);
      const rings = [];
      for (let part = 0; part < partCount; part += 1) {
        const ring = [];
        for (let point = starts[part]; point < starts[part + 1]; point += 1) {
          const pointOffset = pointsOffset + point * 16;
          ring.push([
            buffer.readDoubleLE(pointOffset),
            buffer.readDoubleLE(pointOffset + 8),
          ]);
        }
        rings.push(ring);
      }
      records.push(rings);
    }

    offset = contentEnd;
  }

  return records;
}

function signedArea(points) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return sum / 2;
}

function stripClosingPoint(points) {
  if (points.length < 2) return points;
  const first = points[0];
  const last = points.at(-1);
  return first[0] === last[0] && first[1] === last[1] ? points.slice(0, -1) : points;
}

function triangleArea(a, b, c) {
  return Math.abs(
    (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])) /
      2,
  );
}

function simplifyClosedRing(points, maximumPoints = MAX_POINTS) {
  const simplified = stripClosingPoint(points).map((point) => [...point]);
  while (simplified.length > maximumPoints) {
    let removeIndex = 0;
    let minimumArea = Number.POSITIVE_INFINITY;
    for (let index = 0; index < simplified.length; index += 1) {
      const area = triangleArea(
        simplified[(index - 1 + simplified.length) % simplified.length],
        simplified[index],
        simplified[(index + 1) % simplified.length],
      );
      if (area < minimumArea) {
        minimumArea = area;
        removeIndex = index;
      }
    }
    simplified.splice(removeIndex, 1);
  }
  return simplified;
}

function meridionalArc(latitude, a, e2) {
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  return (
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latitude -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) *
        Math.sin(2 * latitude) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latitude) -
      ((35 * e6) / 3072) * Math.sin(6 * latitude))
  );
}

function epsg5181ToWgs84(easting, northing) {
  const a = 6_378_137;
  const inverseFlattening = 298.257222101;
  const flattening = 1 / inverseFlattening;
  const e2 = flattening * (2 - flattening);
  const ep2 = e2 / (1 - e2);
  const longitudeOrigin = (127 * Math.PI) / 180;
  const latitudeOrigin = (38 * Math.PI) / 180;
  const falseEasting = 200_000;
  const falseNorthing = 500_000;
  const scale = 1;
  const m0 = meridionalArc(latitudeOrigin, a, e2);
  const m = m0 + (northing - falseNorthing) / scale;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const mu =
    m /
    (a *
      (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const n1 = a / Math.sqrt(1 - e2 * sinPhi1 ** 2);
  const r1 = (a * (1 - e2)) / (1 - e2 * sinPhi1 ** 2) ** 1.5;
  const t1 = tanPhi1 ** 2;
  const c1 = ep2 * cosPhi1 ** 2;
  const d = (easting - falseEasting) / (n1 * scale);
  const latitude =
    phi1 -
    ((n1 * tanPhi1) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) *
          d ** 6) /
          720);
  const longitude =
    longitudeOrigin +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) *
        d ** 5) /
        120) /
      cosPhi1;

  return [(longitude * 180) / Math.PI, (latitude * 180) / Math.PI];
}

function roundCoordinate(value) {
  return Number(value.toFixed(COORDINATE_PRECISION));
}

function convertRing(points) {
  const converted = simplifyClosedRing(points).map(([x, y]) =>
    epsg5181ToWgs84(x, y).map(roundCoordinate),
  );
  return converted.filter(
    (point, index) =>
      index === 0 ||
      point[0] !== converted[index - 1][0] ||
      point[1] !== converted[index - 1][1],
  );
}

function buildBoundaryAsset({ shp, dbf, prj }) {
  validateProjection(prj);
  const codes = readDbfRecords(dbf);
  const shapeRecords = readPolygonRings(shp);
  if (codes.length !== shapeRecords.length) {
    throw new Error(
      `DBF/SHP 레코드 수가 다릅니다: DBF=${codes.length}, SHP=${shapeRecords.length}`,
    );
  }

  const boundaries = {};
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if (!code) continue;
    const rings = shapeRecords[index]
      .map(stripClosingPoint)
      .filter((ring) => ring.length >= 3)
      .sort((left, right) => Math.abs(signedArea(right)) - Math.abs(signedArea(left)));
    if (rings.length === 0) continue;

    const points = convertRing(rings[0]);
    if (points.length < 3) throw new Error(`${code} 경계를 3점 이상으로 만들 수 없습니다.`);
    const previous = boundaries[code];
    if (!previous || Math.abs(signedArea(points)) > Math.abs(signedArea(previous))) {
      boundaries[code] = points;
    }
  }

  const sortedBoundaries = Object.fromEntries(
    Object.entries(boundaries).sort(([left], [right]) => left.localeCompare(right)),
  );

  return {
    sourceUrl: SOURCE_URL,
    sourceUpdatedAt: SOURCE_UPDATED_AT,
    metadata: {
      inputCrs: "EPSG:5181",
      outputCrs: "EPSG:4326",
      maxPointsPerBoundary: MAX_POINTS,
      coordinatePrecision: COORDINATE_PRECISION,
      notForLegalSurvey: true,
      note: "화면 시각화를 위해 단순화한 경계이며 법적 측량·경계 판단에 사용할 수 없습니다.",
    },
    boundaries: sortedBoundaries,
  };
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = path.resolve(process.argv[3] ?? DEFAULT_OUTPUT);
  if (!inputPath) {
    console.error(
      "사용법: node scripts/build-seoul-commercial-boundaries.mjs <공식 ZIP|SHP|디렉터리> [출력 JSON]",
    );
    process.exitCode = 1;
    return;
  }

  const asset = buildBoundaryAsset(loadShapeFiles(inputPath));
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(asset)}\n`, "utf8");
  console.log(
    `서울 상권 경계 ${Object.keys(asset.boundaries).length.toLocaleString("ko-KR")}건 생성: ${outputPath}`,
  );
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) main();

export {
  buildBoundaryAsset,
  epsg5181ToWgs84,
  loadShapeFiles,
  simplifyClosedRing,
};
