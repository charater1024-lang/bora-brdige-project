import type { YouthPolicyRegion } from "@/lib/auth/youth-policy-profile";

export type KoreaRegionMapPosition = { x: number; y: number };

/** Geographic overlay positions used when the map has enough room. */
export const KOREA_REGION_MAP_POSITIONS = {
  seoul: { x: 32, y: 21 },
  incheon: { x: 23, y: 24 },
  gyeonggi: { x: 38, y: 27 },
  gangwon: { x: 58, y: 19 },
  chungnam: { x: 31, y: 42 },
  sejong: { x: 40, y: 40 },
  daejeon: { x: 42, y: 48 },
  chungbuk: { x: 49, y: 37 },
  gyeongbuk: { x: 65, y: 43 },
  daegu: { x: 62, y: 54 },
  jeonbuk: { x: 39, y: 57 },
  gwangju: { x: 30, y: 69 },
  jeonnam: { x: 34, y: 76 },
  gyeongnam: { x: 54, y: 67 },
  ulsan: { x: 72, y: 59 },
  busan: { x: 67, y: 70 },
  jeju: { x: 29, y: 92 },
} satisfies Record<YouthPolicyRegion, KoreaRegionMapPosition>;

/**
 * North-to-south schematic order shared by both map button groups. On mobile,
 * CSS lays this DOM order into an accessible three-column grid so visual and
 * keyboard navigation order remain identical in every locale.
 */
export const MOBILE_REGION_ORDER = [
  "incheon", "seoul", "gangwon",
  "gyeonggi", "chungbuk", "gyeongbuk",
  "chungnam", "sejong", "daejeon",
  "jeonbuk", "daegu", "ulsan",
  "gwangju", "jeonnam", "gyeongnam",
  "jeju", "busan",
] as const satisfies readonly YouthPolicyRegion[];
