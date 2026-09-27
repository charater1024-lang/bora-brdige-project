import type { PublicInformationItem } from "./types";
import { safePublicHttpUrl } from "./urls";

const SEOUL_BOUNDARY_SOURCE = "https://data.seoul.go.kr/dataList/OA-15560/S/1/datasetView.do";
const MAX_BOUNDARIES = 2_000;
const MAX_POINTS = 24;

export interface SeoulCommercialBoundaryAsset {
  sourceUrl: string;
  sourceUpdatedAt: string;
  metadata: {
    inputCrs: "EPSG:5181";
    outputCrs: "EPSG:4326";
    maxPointsPerBoundary: number;
    coordinatePrecision: number;
    notForLegalSurvey: true;
    note: string;
  };
  boundaries: Record<string, Array<[longitude: number, latitude: number]>>;
}

function safeBoundaryPoint(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (!Number.isFinite(longitude) || longitude < 126.7 || longitude > 127.3) return null;
  if (!Number.isFinite(latitude) || latitude < 37.4 || latitude > 37.75) return null;
  return [longitude, latitude];
}

export function normalizeSeoulCommercialBoundaryAsset(
  value: unknown,
): SeoulCommercialBoundaryAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (safePublicHttpUrl(row.sourceUrl) !== SEOUL_BOUNDARY_SOURCE) return null;
  if (typeof row.sourceUpdatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(row.sourceUpdatedAt)) return null;
  if (!row.metadata || typeof row.metadata !== "object" || Array.isArray(row.metadata)) return null;
  const metadata = row.metadata as Record<string, unknown>;
  if (metadata.inputCrs !== "EPSG:5181" || metadata.outputCrs !== "EPSG:4326") return null;
  if (metadata.notForLegalSurvey !== true) return null;
  if (!row.boundaries || typeof row.boundaries !== "object" || Array.isArray(row.boundaries)) return null;

  const entries = Object.entries(row.boundaries as Record<string, unknown>);
  if (!entries.length || entries.length > MAX_BOUNDARIES) return null;
  const boundaries: SeoulCommercialBoundaryAsset["boundaries"] = {};
  for (const [code, candidate] of entries) {
    if (!/^\d{7}$/u.test(code) || !Array.isArray(candidate) || candidate.length < 3 || candidate.length > MAX_POINTS) {
      return null;
    }
    const points = candidate.map(safeBoundaryPoint);
    if (points.some((point) => point === null)) return null;
    boundaries[code] = points as Array<[number, number]>;
  }

  return {
    sourceUrl: SEOUL_BOUNDARY_SOURCE,
    sourceUpdatedAt: row.sourceUpdatedAt,
    metadata: {
      inputCrs: "EPSG:5181",
      outputCrs: "EPSG:4326",
      maxPointsPerBoundary: MAX_POINTS,
      coordinatePrecision: Number(metadata.coordinatePrecision) || 5,
      notForLegalSurvey: true,
      note: typeof metadata.note === "string" ? metadata.note.slice(0, 300) : "",
    },
    boundaries,
  };
}

function seoulCommercialCode(item: PublicInformationItem) {
  return /^(?:seoul-commercial|commercial-seoul)-(\d{7,10})$/u.exec(item.id)?.[1] ?? null;
}

/**
 * Adds only the official, pre-built display boundary in the browser. The
 * shared D1 snapshot stays compact and the complete static asset is cached by
 * the normal static-file layer instead of being duplicated into every item.
 */
export function applySeoulCommercialBoundaries(
  items: PublicInformationItem[],
  asset: SeoulCommercialBoundaryAsset | null,
) {
  if (!asset) return items;
  return items.map((item) => {
    const code = seoulCommercialCode(item);
    const points = code ? asset.boundaries[code] : null;
    if (!points) return item;
    return {
      ...item,
      commercialArea: {
        ...item.commercialArea,
        areaSquareMeters: item.commercialArea?.areaSquareMeters ?? null,
        referenceDate: item.commercialArea?.referenceDate ?? asset.sourceUpdatedAt,
        coordinateCount: item.commercialArea?.coordinateCount ?? null,
        displayBoundary: {
          points,
          simplified: true,
          sourceUrl: asset.sourceUrl,
          referenceDate: asset.sourceUpdatedAt,
        },
      },
    };
  });
}
