export interface GeographicCenter {
  latitude: number;
  longitude: number;
}

export type CommercialBoundaryCoordinate = [longitude: number, latitude: number];

type Coordinate = CommercialBoundaryCoordinate;

function koreanWgs84Pair(first: number, second: number): Coordinate | null {
  if (first >= 124 && first <= 132 && second >= 32 && second <= 40) return [first, second];
  if (second >= 124 && second <= 132 && first >= 32 && first <= 40) return [second, first];
  return null;
}

function coordinatesFrom(value: unknown, output: Coordinate[], depth = 0) {
  if (depth > 12 || output.length >= 20_000 || value === null || value === undefined) return;
  if (typeof value === "string") {
    const numbers = value.match(/-?\d+(?:\.\d+)?/gu)?.map(Number).filter(Number.isFinite) ?? [];
    for (let index = 0; index + 1 < numbers.length; index += 2) {
      const pair = koreanWgs84Pair(numbers[index], numbers[index + 1]);
      if (pair) output.push(pair);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      const pair = koreanWgs84Pair(value[0], value[1]);
      if (pair) output.push(pair);
      return;
    }
    for (const child of value) coordinatesFrom(child, output, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const geometry = record.coordinates ?? record.coords ?? record.geometry;
    if (geometry !== undefined) coordinatesFrom(geometry, output, depth + 1);
  }
}

function closeRing(points: Coordinate[]) {
  if (points.length < 3) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const closed = first[0] === last[0] && first[1] === last[1]
    ? points
    : [...points, first];
  return closed.length >= 4 ? closed : null;
}

function coordinateRingsFrom(value: unknown, output: Coordinate[][], depth = 0) {
  if (depth > 12 || output.length >= 100 || value === null || value === undefined) return;
  if (typeof value === "string") {
    const groups = [...value.matchAll(/\(([^()]+)\)/gu)];
    for (const group of groups) {
      const points: Coordinate[] = [];
      coordinatesFrom(group[1], points);
      const ring = closeRing(points);
      if (ring) output.push(ring);
    }
    if (!groups.length) {
      const points: Coordinate[] = [];
      coordinatesFrom(value, points);
      const ring = closeRing(points);
      if (ring) output.push(ring);
    }
    return;
  }
  if (!Array.isArray(value)) {
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      coordinateRingsFrom(record.coordinates ?? record.coords ?? record.geometry, output, depth + 1);
    }
    return;
  }
  const isRing = value.length >= 3 && value.every((candidate) => (
    Array.isArray(candidate)
    && candidate.length >= 2
    && typeof candidate[0] === "number"
    && typeof candidate[1] === "number"
  ));
  if (isRing) {
    const points = value.flatMap((candidate) => {
      const pair = koreanWgs84Pair(candidate[0], candidate[1]);
      return pair ? [pair] : [];
    });
    const ring = closeRing(points);
    if (ring) output.push(ring);
    return;
  }
  for (const child of value) coordinateRingsFrom(child, output, depth + 1);
}

function ringArea(points: Coordinate[]) {
  let areaTwice = 0;
  for (let index = 0; index + 1 < points.length; index += 1) {
    const [longitude, latitude] = points[index];
    const [nextLongitude, nextLatitude] = points[index + 1];
    areaTwice += longitude * nextLatitude - nextLongitude * latitude;
  }
  return Math.abs(areaTwice / 2);
}

function roundedCoordinate([longitude, latitude]: Coordinate): Coordinate {
  return [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))];
}

function simplifyClosedRing(points: Coordinate[], maximumPoints: number) {
  const unique = points.slice(0, -1);
  const targetUniqueCount = Math.max(3, maximumPoints - 1);
  if (unique.length <= targetUniqueCount) {
    const rounded = unique.map(roundedCoordinate);
    return [...rounded, rounded[0]];
  }
  const simplified = Array.from({ length: targetUniqueCount }, (_, index) => {
    const sourceIndex = Math.floor(index * unique.length / targetUniqueCount);
    return roundedCoordinate(unique[sourceIndex]);
  });
  return [...simplified, simplified[0]];
}

/**
 * Returns one official outer boundary prepared for compact display storage.
 * Multi-polygons use their largest valid ring. Points are evenly sampled and
 * rounded only for display; the result must not be used for legal surveying.
 */
export function displayCommercialBoundary(
  value: unknown,
  maximumPoints = 24,
): { points: CommercialBoundaryCoordinate[]; simplified: boolean } | null {
  const rings: Coordinate[][] = [];
  coordinateRingsFrom(value, rings);
  const largest = rings.sort((left, right) => ringArea(right) - ringArea(left))[0];
  if (!largest) return null;
  const safeMaximum = Math.min(96, Math.max(4, Math.floor(maximumPoints)));
  return {
    points: simplifyClosedRing(largest, safeMaximum),
    simplified: largest.length > safeMaximum,
  };
}

function polygonCentroid(points: Coordinate[]): GeographicCenter | null {
  if (points.length < 3) return null;
  let areaTwice = 0;
  let longitudeSum = 0;
  let latitudeSum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [longitude, latitude] = points[index];
    const [nextLongitude, nextLatitude] = points[(index + 1) % points.length];
    const cross = longitude * nextLatitude - nextLongitude * latitude;
    areaTwice += cross;
    longitudeSum += (longitude + nextLongitude) * cross;
    latitudeSum += (latitude + nextLatitude) * cross;
  }
  if (Math.abs(areaTwice) < 1e-10) return null;
  const longitude = longitudeSum / (3 * areaTwice);
  const latitude = latitudeSum / (3 * areaTwice);
  return longitude >= 124 && longitude <= 132 && latitude >= 32 && latitude <= 40
    ? { latitude, longitude }
    : null;
}

/** Accepts WKT or nested GeoJSON-like coordinates and rejects non-WGS84 data. */
export function centerOfCommercialPolygon(value: unknown): GeographicCenter | null {
  const points: Coordinate[] = [];
  coordinatesFrom(value, points);
  if (!points.length) return null;
  const centroid = polygonCentroid(points);
  if (centroid) return centroid;
  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  return {
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
  };
}
