export type ManualMoneyUnit = "won" | "manwon";
export type ExchangeDirection = "foreign-to-krw" | "krw-to-foreign";

export const MAX_MANUAL_MONEY_WON = 1_000_000_000_000_000;

function normalizedCharacters(value: string) {
  return value.normalize("NFKC").replaceAll(",", "");
}

function groupedInteger(value: string) {
  const normalized = value.replace(/^0+(?=\d)/u, "") || "0";
  return normalized.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

export function normalizeGroupedDecimalInput(
  value: string,
  maximumFractionDigits: number,
) {
  const safeFractionDigits = Math.max(0, Math.min(8, Math.trunc(maximumFractionDigits)));
  const raw = normalizedCharacters(value);
  const firstDecimalIndex = raw.indexOf(".");
  const decimalIndex = safeFractionDigits > 0 ? firstDecimalIndex : -1;
  const integerSource = firstDecimalIndex >= 0 ? raw.slice(0, firstDecimalIndex) : raw;
  const fractionSource = decimalIndex >= 0 ? raw.slice(decimalIndex + 1) : "";
  const integerDigits = integerSource.replace(/[^\d]/gu, "");
  const fractionDigits = fractionSource.replace(/[^\d]/gu, "").slice(0, safeFractionDigits);

  if (!integerDigits && decimalIndex < 0) return "";
  const integer = groupedInteger(integerDigits || "0");
  if (decimalIndex < 0) return integer;
  return `${integer}.${fractionDigits}`;
}

export function parseGroupedNumber(value: string) {
  const normalized = normalizedCharacters(value).trim();
  if (!normalized || !/^\d+(?:\.\d+)?$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedWon(value: bigint) {
  const maximum = BigInt(MAX_MANUAL_MONEY_WON);
  if (value <= 0n) return value < 0n ? 0n : value;
  return value > maximum ? maximum : value;
}

export function canonicalWonFromMoneyInput(
  value: string,
  unit: ManualMoneyUnit,
) {
  const normalized = normalizeGroupedDecimalInput(value, unit === "manwon" ? 4 : 0)
    .replaceAll(",", "");
  if (!normalized) return "";

  if (unit === "won") {
    return boundedWon(BigInt(normalized || "0")).toString();
  }

  const [integerPart = "0", fractionPart = ""] = normalized.split(".");
  const won = (BigInt(integerPart || "0") * 10_000n)
    + BigInt((fractionPart || "").padEnd(4, "0").slice(0, 4) || "0");
  return boundedWon(won).toString();
}

export function formatCanonicalWonInput(
  canonicalWon: string | number,
  unit: ManualMoneyUnit,
) {
  const digits = String(canonicalWon).replace(/[^\d]/gu, "");
  if (!digits) return "";
  const won = boundedWon(BigInt(digits));

  if (unit === "won") return groupedInteger(won.toString());

  const integerPart = won / 10_000n;
  const remainder = won % 10_000n;
  const fraction = remainder.toString().padStart(4, "0").replace(/0+$/u, "");
  return `${groupedInteger(integerPart.toString())}${fraction ? `.${fraction}` : ""}`;
}

export function normalizeManualMoneyInput(
  value: string,
  unit: ManualMoneyUnit,
) {
  const normalized = normalizeGroupedDecimalInput(value, unit === "manwon" ? 4 : 0);
  const canonical = canonicalWonFromMoneyInput(normalized, unit);
  if (!canonical) return "";
  if (BigInt(canonical) >= BigInt(MAX_MANUAL_MONEY_WON)) {
    return formatCanonicalWonInput(MAX_MANUAL_MONEY_WON, unit);
  }
  return normalized;
}

export function convertExchangeAmount(
  amount: number,
  baseRate: number,
  direction: ExchangeDirection,
) {
  if (
    !Number.isFinite(amount)
    || amount <= 0
    || !Number.isFinite(baseRate)
    || baseRate <= 0
  ) return null;
  const converted = direction === "foreign-to-krw"
    ? amount * baseRate
    : amount / baseRate;
  return Number.isFinite(converted) && converted > 0 ? converted : null;
}
