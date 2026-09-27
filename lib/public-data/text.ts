import type { PublicInformationItem } from "./types";

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  middot: "·",
  nbsp: " ",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
};

function decodedCodePoint(decimal: string | undefined, hexadecimal: string | undefined) {
  const codePoint = Number.parseInt(decimal ?? hexadecimal ?? "", hexadecimal ? 16 : 10);
  if (!Number.isSafeInteger(codePoint)
    || codePoint < 0
    || codePoint > 0x10ffff
    || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return "�";
  if (codePoint === 0xa0) return " ";
  if (codePoint < 0x20 && ![0x09, 0x0a, 0x0d].includes(codePoint)) return " ";
  return String.fromCodePoint(codePoint);
}

/** Decode the small, bounded HTML/XML entity surface used by public feeds. */
export function decodePublicTextEntities(value: unknown) {
  let output = String(value ?? "");
  // Some providers return `&amp;apos;`; two bounded passes handle it without
  // accepting an unbounded recursive entity expansion.
  for (let pass = 0; pass < 2; pass += 1) {
    const decoded = output.replace(
      /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z][a-z0-9]+));/giu,
      (entity, decimal: string | undefined, hexadecimal: string | undefined, named: string | undefined) => {
        if (decimal || hexadecimal) return decodedCodePoint(decimal, hexadecimal);
        return NAMED_ENTITIES[named?.toLocaleLowerCase("en-US") ?? ""] ?? entity;
      },
    );
    if (decoded === output) break;
    output = decoded;
  }
  return output;
}

export function cleanPublicText(value: unknown, maximumLength = 500) {
  return decodePublicTextEntities(String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replace(/<script[\s\S]*?<\/script>/giu, " ")
    .replace(/<style[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]*>/gu, " "))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, Math.max(0, maximumLength));
}

/** Repair already-stored rows while the next provider refresh catches up. */
export function normalizePublicInformationItemText(item: PublicInformationItem): PublicInformationItem {
  const location = item.location ? {
    ...item.location,
    label: cleanPublicText(item.location.label, 500),
    ...(item.location.roadAddress ? { roadAddress: cleanPublicText(item.location.roadAddress, 500) } : {}),
    ...(item.location.province ? { province: cleanPublicText(item.location.province, 120) } : {}),
    ...(item.location.city ? { city: cleanPublicText(item.location.city, 120) } : {}),
    ...(item.location.neighborhood ? { neighborhood: cleanPublicText(item.location.neighborhood, 160) } : {}),
  } : undefined;
  const analytics = item.commercialArea?.analytics;
  const commercialArea = item.commercialArea ? {
    ...item.commercialArea,
    ...(analytics ? {
      analytics: {
        ...analytics,
        areaType: analytics.areaType ? cleanPublicText(analytics.areaType, 160) : analytics.areaType,
        industrySalesComposition: analytics.industrySalesComposition.map((entry) => ({
          ...entry,
          name: cleanPublicText(entry.name, 160),
        })),
      },
    } : {}),
  } : undefined;
  return {
    ...item,
    title: cleanPublicText(item.title, 500),
    summary: cleanPublicText(item.summary, 20_000),
    source: cleanPublicText(item.source, 300),
    tags: item.tags.map((tag) => cleanPublicText(tag, 160)).filter(Boolean),
    ...(location ? { location } : {}),
    ...(commercialArea ? { commercialArea } : {}),
  };
}
