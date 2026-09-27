import type { PublicInformationItem } from "./types";

function normalizedHostname(value: string) {
  return value.toLocaleLowerCase("en-US")
    .replace(/^\[|\]$/gu, "")
    .replace(/\.+$/gu, "");
}

function ipv4Parts(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return null;
  const values = parts.map(Number);
  return values.every((part) => part >= 0 && part <= 255) ? values : null;
}

function blockedIpv4(hostname: string) {
  const parts = ipv4Parts(hostname);
  if (!parts) return false;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19))
    || first >= 224;
}

function ipv6Parts(hostname: string) {
  const embeddedIpv4 = hostname.includes(".");
  let candidate = hostname;
  const tail = embeddedIpv4 ? candidate.slice(candidate.lastIndexOf(":") + 1) : "";
  if (embeddedIpv4) {
    const ipv4 = ipv4Parts(tail);
    if (!ipv4) return null;
    candidate = `${candidate.slice(0, candidate.lastIndexOf(":") + 1)}${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  if (!candidate.includes(":")) return null;
  const halves = candidate.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const values = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((part) => Number.parseInt(part, 16));
  return values.length === 8 ? values : null;
}

function blockedIpv6(hostname: string) {
  const parts = ipv6Parts(hostname);
  if (!parts) return hostname.includes(":");
  const allZeroBeforeLast = parts.slice(0, 7).every((part) => part === 0);
  const ipv4Mapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  return parts.every((part) => part === 0)
    || (allZeroBeforeLast && parts[7] === 1)
    || (parts[0] & 0xfe00) === 0xfc00
    || (parts[0] & 0xffc0) === 0xfe80
    || (parts[0] & 0xff00) === 0xff00
    || (parts[0] === 0x2001 && parts[1] === 0x0db8)
    || ipv4Mapped;
}

function allowedHostname(hostname: string, allowlist?: readonly string[]) {
  if (!allowlist?.length) return true;
  return allowlist.some((candidate) => {
    const allowed = normalizedHostname(candidate);
    return Boolean(allowed) && (hostname === allowed || hostname.endsWith(`.${allowed}`));
  });
}

/**
 * Canonicalize links before they enter a snapshot or an href. Public-data
 * links never need credentials, loopback hosts, or private network targets.
 */
export function safePublicHttpUrl(
  value: unknown,
  base?: string,
  allowedHosts?: readonly string[],
): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = base ? new URL(value.trim(), base) : new URL(value.trim());
    const hostname = normalizedHostname(url.hostname);
    const blockedHost = hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || blockedIpv4(hostname)
      || blockedIpv6(hostname);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !hostname
      || blockedHost
      || !allowedHostname(hostname, allowedHosts)
    ) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export type OfficialLinkKind = "detail" | "dataset";

export function officialLinkKind(item: Pick<PublicInformationItem, "id" | "sourceLinkKind">): OfficialLinkKind {
  if (item.sourceLinkKind) return item.sourceLinkKind;
  return item.id.startsWith("dart-") || item.id.startsWith("bizinfo-") ? "detail" : "dataset";
}
