export const YOUTH_POLICY_REGIONS = [
  "seoul",
  "busan",
  "daegu",
  "incheon",
  "gwangju",
  "daejeon",
  "ulsan",
  "sejong",
  "gyeonggi",
  "gangwon",
  "chungbuk",
  "chungnam",
  "jeonbuk",
  "jeonnam",
  "gyeongbuk",
  "gyeongnam",
  "jeju",
] as const;

export type YouthPolicyRegion = (typeof YOUTH_POLICY_REGIONS)[number];

export const YOUTH_POLICY_STATUSES = [
  "high_school",
  "university",
  "graduate_school",
  "job_seeker",
  "employed",
  "self_employed",
  "not_working",
  "other",
] as const;

export type YouthPolicyStatus = (typeof YOUTH_POLICY_STATUSES)[number];

export const YOUTH_POLICY_INTERESTS = [
  "asset_building",
  "education",
  "employment",
  "housing",
  "startup",
  "finance",
  "welfare",
] as const;

export type YouthPolicyInterest = (typeof YOUTH_POLICY_INTERESTS)[number];

export type YouthPolicyProfile = {
  enabled: boolean;
  birthYear: number | null;
  region: YouthPolicyRegion | null;
  status: YouthPolicyStatus | null;
  interests: YouthPolicyInterest[];
};

export const EMPTY_YOUTH_POLICY_PROFILE: YouthPolicyProfile = {
  enabled: false,
  birthYear: null,
  region: null,
  status: null,
  interests: [],
};

export class YouthPolicyProfileError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "YouthPolicyProfileError";
    this.code = code;
  }
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}

/**
 * Accept only the coarse, explicitly supported fields. This keeps accidental
 * free-form notes, exact income, addresses, and other unnecessary personal
 * data out of the profile store.
 */
export function normalizeYouthPolicyProfile(
  value: unknown,
  now = new Date(),
): YouthPolicyProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new YouthPolicyProfileError("invalid_youth_policy_profile");
  }
  const input = value as Record<string, unknown>;
  const allowedKeys = new Set(["enabled", "birthYear", "region", "status", "interests"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new YouthPolicyProfileError("unsupported_youth_policy_profile_field");
  }
  if (typeof input.enabled !== "boolean") {
    throw new YouthPolicyProfileError("invalid_youth_policy_profile_enabled");
  }

  let birthYear: number | null = null;
  if (input.birthYear !== null && input.birthYear !== undefined && input.birthYear !== "") {
    const candidate = typeof input.birthYear === "number"
      ? input.birthYear
      : Number(input.birthYear);
    const currentYear = now.getUTCFullYear();
    if (!Number.isInteger(candidate) || candidate < 1900 || candidate > currentYear) {
      throw new YouthPolicyProfileError("invalid_youth_policy_birth_year");
    }
    birthYear = candidate;
  }

  const region = input.region === null || input.region === undefined || input.region === ""
    ? null
    : isOneOf(input.region, YOUTH_POLICY_REGIONS)
      ? input.region
      : null;
  if (input.region !== null && input.region !== undefined && input.region !== "" && region === null) {
    throw new YouthPolicyProfileError("invalid_youth_policy_region");
  }

  const status = input.status === null || input.status === undefined || input.status === ""
    ? null
    : isOneOf(input.status, YOUTH_POLICY_STATUSES)
      ? input.status
      : null;
  if (input.status !== null && input.status !== undefined && input.status !== "" && status === null) {
    throw new YouthPolicyProfileError("invalid_youth_policy_status");
  }

  if (!Array.isArray(input.interests) || input.interests.length > YOUTH_POLICY_INTERESTS.length) {
    throw new YouthPolicyProfileError("invalid_youth_policy_interests");
  }
  const interests: YouthPolicyInterest[] = [];
  for (const interest of input.interests) {
    if (!isOneOf(interest, YOUTH_POLICY_INTERESTS)) {
      throw new YouthPolicyProfileError("invalid_youth_policy_interests");
    }
    if (!interests.includes(interest)) interests.push(interest);
  }

  return { enabled: input.enabled, birthYear, region, status, interests };
}

export function parseStoredYouthPolicyProfile(value: string | null | undefined): YouthPolicyProfile {
  if (!value) return { ...EMPTY_YOUTH_POLICY_PROFILE, interests: [] };
  try {
    return normalizeYouthPolicyProfile(JSON.parse(value));
  } catch {
    // A malformed historical row must not break authentication. It is treated
    // as personalization being off until the member saves a valid profile.
    return { ...EMPTY_YOUTH_POLICY_PROFILE, interests: [] };
  }
}
