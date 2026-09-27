import {
  MANUAL_FINANCE_FIELDS,
  type ManualFinanceAmounts,
} from "./manual-finance";

export const MANUAL_FINANCE_SNAPSHOT_VERSION = 1 as const;
export const MAX_MANUAL_FINANCE_AMOUNT = 1_000_000_000_000_000;
export const MAX_MANUAL_FINANCE_REQUEST_BYTES = 4_096;
export const MAX_MANUAL_FINANCE_STORED_BYTES = 2_048;
export const MAX_MANUAL_FINANCE_AI_CONTEXT_CHARS = 768;

export type ManualFinanceSnapshotInput = {
  version: typeof MANUAL_FINANCE_SNAPSHOT_VERSION;
  amounts: ManualFinanceAmounts;
  useForAi: boolean;
};

export type ManualFinanceSnapshot = ManualFinanceSnapshotInput & {
  updatedAt: number;
};

export class ManualFinanceSnapshotError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ManualFinanceSnapshotError";
    this.code = code;
  }
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return value as Record<string, unknown>;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  return Object.keys(record).every((key) => allowedSet.has(key));
}

/**
 * Validate the complete persistence payload without coercion. In particular,
 * strings and unknown properties are rejected so identifiers or notes cannot
 * accidentally be stored in this intentionally numeric-only snapshot.
 */
export function parseManualFinanceSnapshotInput(
  value: unknown,
): ManualFinanceSnapshotInput {
  const input = plainRecord(value);
  if (!input || !hasOnlyKeys(input, ["version", "amounts", "useForAi"])) {
    throw new ManualFinanceSnapshotError(
      "invalid_finance_snapshot",
      "Finance snapshot contains an unsupported field.",
    );
  }
  if (input.version !== MANUAL_FINANCE_SNAPSHOT_VERSION) {
    throw new ManualFinanceSnapshotError(
      "unsupported_finance_snapshot_version",
      "Finance snapshot version is unsupported.",
    );
  }

  const rawAmounts = plainRecord(input.amounts);
  if (
    !rawAmounts
    || Object.keys(rawAmounts).length !== MANUAL_FINANCE_FIELDS.length
    || !hasOnlyKeys(rawAmounts, MANUAL_FINANCE_FIELDS)
  ) {
    throw new ManualFinanceSnapshotError(
      "invalid_finance_amounts",
      "Every supported finance amount must be supplied, with no extra fields.",
    );
  }

  if (input.useForAi !== undefined && typeof input.useForAi !== "boolean") {
    throw new ManualFinanceSnapshotError(
      "invalid_finance_ai_consent",
      "AI context consent must be a boolean.",
    );
  }

  const amounts = Object.fromEntries(MANUAL_FINANCE_FIELDS.map((field) => {
    const amount = rawAmounts[field];
    if (
      typeof amount !== "number"
      || !Number.isSafeInteger(amount)
      || amount < 0
      || amount > MAX_MANUAL_FINANCE_AMOUNT
    ) {
      throw new ManualFinanceSnapshotError(
        "invalid_finance_amount",
        `${field} must be a non-negative safe integer within the supported range.`,
      );
    }
    return [field, amount];
  })) as ManualFinanceAmounts;

  const snapshot = {
    version: MANUAL_FINANCE_SNAPSHOT_VERSION,
    amounts,
    useForAi: input.useForAi ?? false,
  };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_MANUAL_FINANCE_STORED_BYTES) {
    throw new ManualFinanceSnapshotError(
      "finance_snapshot_too_large",
      "Finance snapshot exceeds the storage limit.",
    );
  }
  return snapshot;
}

/**
 * Build a small, fixed-field context only after explicit opt-in. The output
 * contains no account identifiers or free text and is safe to append to an AI
 * prompt only after the caller has already authenticated the user.
 */
export function manualFinanceAiContext(
  snapshot: ManualFinanceSnapshot,
): string | null {
  if (!snapshot.useForAi) return null;
  const values = MANUAL_FINANCE_FIELDS
    .map((field) => `${field}=${snapshot.amounts[field]}`)
    .join(", ");
  const context = [
    "User-consented manual finance snapshot.",
    "Currency: KRW. User-entered and not verified by a financial institution.",
    values,
  ].join(" ");
  return context.slice(0, MAX_MANUAL_FINANCE_AI_CONTEXT_CHARS);
}

export function parseStoredManualFinanceSnapshot(
  raw: string,
  updatedAt: number,
): ManualFinanceSnapshot | null {
  if (
    !raw
    || new TextEncoder().encode(raw).byteLength > MAX_MANUAL_FINANCE_STORED_BYTES
    || !Number.isSafeInteger(updatedAt)
    || updatedAt < 0
  ) return null;

  try {
    return {
      ...parseManualFinanceSnapshotInput(JSON.parse(raw) as unknown),
      updatedAt,
    };
  } catch {
    return null;
  }
}
