import { saveExchangeHistory } from "./history";
import type { ExchangeRate, PublicDataPayload } from "./types";

const EXIM_ENDPOINT = "https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON";
const EXCHANGE_SOURCE_ID = "exchange";
const DAY_MS = 24 * 60 * 60 * 1_000;
const HISTORY_DAYS = 365;
const FETCH_TIMEOUT_MS = 6_000;
const FETCH_CONCURRENCY = 2;

/**
 * The regular exchange adapter may spend up to three requests finding the
 * latest published business day. Four additional, checkpointed requests keep
 * one refresh small while filling a year in the background.
 */
export const EXCHANGE_BACKFILL_CALLS_PER_REFRESH = 4;
export const EXCHANGE_BACKFILL_REFRESH_MS = 2 * 60 * 1_000;

const CURRENCY_NAMES: Record<string, string> = {
  USD: "미국 달러",
  JPY: "일본 엔",
  CNY: "중국 위안",
  EUR: "유로",
  GBP: "영국 파운드",
  CAD: "캐나다 달러",
  AUD: "호주 달러",
  SGD: "싱가포르 달러",
};

type BackfillPhase = "gap" | "history";

export type ExchangeBackfillCheckpoint = {
  sourceId: string;
  historicalCursorDate: string | null;
  historicalFloorDate: string;
  gapCursorDate: string | null;
  gapFloorDate: string | null;
  latestObservedDate: string;
  completedAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  updatedAt: number;
};

export type ExchangeBackfillAction = {
  date: string;
  kind: "already-stored" | "non-business-day" | "fetch";
};

export type ExchangeBackfillStatus = {
  phase: "not-started" | "gap" | "history" | "complete";
  targetStartDate: string | null;
  targetEndDate: string | null;
  nextDate: string | null;
  progressPercent: number;
  completedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
};

type ProviderResult =
  | { kind: "stored"; exchange: PublicDataPayload["exchange"] }
  | { kind: "empty" }
  | { kind: "error"; errorCode: string; failureKind: "authorization" | "quota" | "transient" };

type StoredCheckpointRow = {
  sourceId: string;
  historicalCursorDate: string | null;
  historicalFloorDate: string;
  gapCursorDate: string | null;
  gapFloorDate: string | null;
  latestObservedDate: string;
  completedAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  updatedAt: number;
};

let schemaReady: Promise<D1Database> | null = null;

async function database() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const { env } = await import("cloudflare:workers");
      if (!env.DB) throw new Error("public_data_storage_unavailable");
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS exchange_history_backfill_checkpoint (
        source_id TEXT PRIMARY KEY NOT NULL,
        historical_cursor_date TEXT,
        historical_floor_date TEXT NOT NULL,
        gap_cursor_date TEXT,
        gap_floor_date TEXT,
        latest_observed_date TEXT NOT NULL,
        completed_at INTEGER,
        last_attempt_at INTEGER,
        last_error TEXT,
        updated_at INTEGER NOT NULL
      )`).run();
      return env.DB;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function validDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateValue(value: string) {
  return Date.parse(`${value}T00:00:00Z`);
}

export function addExchangeDateDays(value: string, days: number) {
  if (!validDate(value) || !Number.isSafeInteger(days)) throw new Error("invalid_exchange_date");
  return new Date(dateValue(value) + days * DAY_MS).toISOString().slice(0, 10);
}

function laterDate(left: string, right: string) {
  return left.localeCompare(right) >= 0 ? left : right;
}

function earlierDate(left: string, right: string) {
  return left.localeCompare(right) <= 0 ? left : right;
}

function isWeekday(value: string) {
  const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

function phaseInterval(checkpoint: ExchangeBackfillCheckpoint) {
  if (
    checkpoint.gapCursorDate
    && checkpoint.gapFloorDate
    && checkpoint.gapCursorDate.localeCompare(checkpoint.gapFloorDate) >= 0
  ) {
    return {
      phase: "gap" as const,
      cursor: checkpoint.gapCursorDate,
      floor: checkpoint.gapFloorDate,
    };
  }
  if (
    checkpoint.historicalCursorDate
    && checkpoint.historicalCursorDate.localeCompare(checkpoint.historicalFloorDate) >= 0
  ) {
    return {
      phase: "history" as const,
      cursor: checkpoint.historicalCursorDate,
      floor: checkpoint.historicalFloorDate,
    };
  }
  return null;
}

export function initialExchangeBackfillCheckpoint(
  latestObservedDate: string,
  now = Date.now(),
): ExchangeBackfillCheckpoint {
  if (!validDate(latestObservedDate)) throw new Error("invalid_exchange_date");
  return {
    sourceId: EXCHANGE_SOURCE_ID,
    historicalCursorDate: addExchangeDateDays(latestObservedDate, -1),
    historicalFloorDate: addExchangeDateDays(latestObservedDate, -HISTORY_DAYS),
    gapCursorDate: null,
    gapFloorDate: null,
    latestObservedDate,
    completedAt: null,
    lastAttemptAt: null,
    lastError: null,
    updatedAt: now,
  };
}

export function advanceExchangeBackfillWindow(
  checkpoint: ExchangeBackfillCheckpoint,
  latestObservedDate: string,
  now = Date.now(),
) {
  if (!validDate(latestObservedDate)) throw new Error("invalid_exchange_date");
  const next = { ...checkpoint, updatedAt: now };
  const rollingFloor = addExchangeDateDays(latestObservedDate, -HISTORY_DAYS);
  next.historicalFloorDate = laterDate(next.historicalFloorDate, rollingFloor);
  if (next.gapFloorDate) {
    // Never spend quota on a stale downtime gap that is already outside the
    // retained one-year chart window.
    next.gapFloorDate = laterDate(next.gapFloorDate, rollingFloor);
  }

  if (latestObservedDate.localeCompare(next.latestObservedDate) > 0) {
    const gapFloor = laterDate(
      addExchangeDateDays(next.latestObservedDate, 1),
      rollingFloor,
    );
    const gapCursor = addExchangeDateDays(latestObservedDate, -1);
    next.gapFloorDate = next.gapFloorDate
      ? earlierDate(next.gapFloorDate, gapFloor)
      : gapFloor;
    next.gapCursorDate = next.gapCursorDate
      ? laterDate(next.gapCursorDate, gapCursor)
      : gapCursor;
    next.latestObservedDate = latestObservedDate;
    next.completedAt = null;
  }

  if (
    next.historicalCursorDate
    && next.historicalCursorDate.localeCompare(next.historicalFloorDate) < 0
  ) {
    next.historicalCursorDate = null;
  }
  if (
    next.gapCursorDate
    && next.gapFloorDate
    && next.gapCursorDate.localeCompare(next.gapFloorDate) < 0
  ) {
    next.gapCursorDate = null;
    next.gapFloorDate = null;
  }
  return next;
}

export function planExchangeBackfillActions(
  checkpoint: ExchangeBackfillCheckpoint,
  storedDates: ReadonlySet<string>,
  maximumCalls = EXCHANGE_BACKFILL_CALLS_PER_REFRESH,
) {
  const interval = phaseInterval(checkpoint);
  if (!interval) {
    return { phase: null, actions: [] as ExchangeBackfillAction[] };
  }
  const safeMaximum = Number.isSafeInteger(maximumCalls) && maximumCalls > 0
    ? maximumCalls
    : EXCHANGE_BACKFILL_CALLS_PER_REFRESH;
  const actions: ExchangeBackfillAction[] = [];
  let cursor = interval.cursor;
  let calls = 0;
  while (cursor.localeCompare(interval.floor) >= 0 && calls < safeMaximum) {
    if (!isWeekday(cursor)) {
      actions.push({ date: cursor, kind: "non-business-day" });
    } else if (storedDates.has(cursor)) {
      actions.push({ date: cursor, kind: "already-stored" });
    } else {
      actions.push({ date: cursor, kind: "fetch" });
      calls += 1;
    }
    cursor = addExchangeDateDays(cursor, -1);
  }
  return { phase: interval.phase, actions };
}

export function shouldStopExchangeBackfillBatch(
  outcomes: readonly { kind: "stored" | "empty" | "error" }[],
) {
  return outcomes.some((outcome) => outcome.kind === "error");
}

function normalizedNumber(value: unknown) {
  const parsed = Number(String(value ?? "").replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeProviderRates(payload: unknown): ExchangeRate[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((raw): ExchangeRate[] => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const sourceUnit = String(item.cur_unit ?? "").trim().toUpperCase();
    const match = /^([A-Z]{3})(?:\((\d+)\))?$/u.exec(sourceUnit);
    if (!match) return [];
    const currency = match[1] === "CNH" ? "CNY" : match[1];
    if (!Object.hasOwn(CURRENCY_NAMES, currency)) return [];
    const quotedUnit = match[2] ? Number(match[2]) : 1;
    const quotedRate = normalizedNumber(item.deal_bas_r);
    if (!Number.isInteger(quotedUnit) || quotedUnit <= 0 || quotedRate <= 0) return [];
    return [{
      currency,
      name: CURRENCY_NAMES[currency],
      baseCurrency: "KRW",
      unit: 1,
      baseRate: Number((quotedRate / quotedUnit).toFixed(6)),
      quotedUnit,
      quotedRate,
      sourceUnit,
    }];
  });
}

function providerResultCode(payload: unknown) {
  if (!Array.isArray(payload)) return "";
  const first = payload[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return "";
  return String((first as Record<string, unknown>).result ?? "").trim().slice(0, 10);
}

async function fetchOfficialExchangeDate(apiKey: string, effectiveDate: string): Promise<ProviderResult> {
  const endpoint = new URL(EXIM_ENDPOINT);
  endpoint.searchParams.set("authkey", apiKey);
  endpoint.searchParams.set("searchdate", effectiveDate.replaceAll("-", ""));
  endpoint.searchParams.set("data", "AP01");
  try {
    const response = await fetch(endpoint, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: "error", errorCode: "exchange_backfill_redirect", failureKind: "transient" };
    }
    if (!response.ok) {
      return {
        kind: "error",
        errorCode: `exchange_backfill_http_${response.status}`,
        failureKind: response.status === 429 ? "quota" : response.status === 401 || response.status === 403 ? "authorization" : "transient",
      };
    }
    const raw = await response.text();
    if (raw.length > 1_000_000) {
      return { kind: "error", errorCode: "exchange_backfill_body_too_large", failureKind: "transient" };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return { kind: "error", errorCode: "exchange_backfill_non_json", failureKind: "transient" };
    }
    if (!Array.isArray(payload)) {
      return { kind: "error", errorCode: "exchange_backfill_shape", failureKind: "transient" };
    }
    const resultCode = providerResultCode(payload);
    if (resultCode === "3") {
      return { kind: "error", errorCode: "exchange_backfill_invalid_key", failureKind: "authorization" };
    }
    if (resultCode === "4") {
      return { kind: "error", errorCode: "exchange_backfill_quota_exceeded", failureKind: "quota" };
    }
    if (resultCode && resultCode !== "1") {
      return { kind: "error", errorCode: `exchange_backfill_result_${resultCode}`, failureKind: "transient" };
    }
    const rates = normalizeProviderRates(payload);
    if (!rates.length) return { kind: "empty" };
    return {
      kind: "stored",
      exchange: {
        source: "한국수출입은행 환율 API",
        sourceUrl: "https://www.koreaexim.go.kr/ir/HPHKIR020M01?apino=2&viewtype=C",
        asOf: effectiveDate,
        rates,
      },
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      kind: "error",
      errorCode: name === "TimeoutError" || name === "AbortError"
        ? "exchange_backfill_timeout"
        : "exchange_backfill_network",
      failureKind: "transient",
    };
  }
}

async function readCheckpoint(db: D1Database) {
  return db.prepare(`SELECT source_id AS sourceId,
    historical_cursor_date AS historicalCursorDate,
    historical_floor_date AS historicalFloorDate,
    gap_cursor_date AS gapCursorDate,
    gap_floor_date AS gapFloorDate,
    latest_observed_date AS latestObservedDate,
    completed_at AS completedAt,
    last_attempt_at AS lastAttemptAt,
    last_error AS lastError,
    updated_at AS updatedAt
    FROM exchange_history_backfill_checkpoint WHERE source_id = ?`)
    .bind(EXCHANGE_SOURCE_ID)
    .first<StoredCheckpointRow>();
}

async function saveCheckpoint(db: D1Database, checkpoint: ExchangeBackfillCheckpoint) {
  await db.prepare(`INSERT INTO exchange_history_backfill_checkpoint
    (source_id, historical_cursor_date, historical_floor_date, gap_cursor_date,
      gap_floor_date, latest_observed_date, completed_at, last_attempt_at,
      last_error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET
      historical_cursor_date = excluded.historical_cursor_date,
      historical_floor_date = excluded.historical_floor_date,
      gap_cursor_date = excluded.gap_cursor_date,
      gap_floor_date = excluded.gap_floor_date,
      latest_observed_date = excluded.latest_observed_date,
      completed_at = excluded.completed_at,
      last_attempt_at = excluded.last_attempt_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at`)
    .bind(
      checkpoint.sourceId,
      checkpoint.historicalCursorDate,
      checkpoint.historicalFloorDate,
      checkpoint.gapCursorDate,
      checkpoint.gapFloorDate,
      checkpoint.latestObservedDate,
      checkpoint.completedAt,
      checkpoint.lastAttemptAt,
      checkpoint.lastError,
      checkpoint.updatedAt,
    )
    .run();
}

async function storedExchangeDates(db: D1Database, floor: string, cursor: string) {
  const rows = await db.prepare(`SELECT DISTINCT effective_date AS date
    FROM exchange_rate_points
    WHERE source_id = ? AND effective_date >= ? AND effective_date <= ?`)
    .bind(EXCHANGE_SOURCE_ID, floor, cursor)
    .all<{ date: string }>();
  return new Set((rows.results ?? []).map((row) => row.date).filter(validDate));
}

function advanceCursor(
  checkpoint: ExchangeBackfillCheckpoint,
  phase: BackfillPhase,
  actions: readonly ExchangeBackfillAction[],
  outcomes: ReadonlyMap<string, ProviderResult>,
) {
  let cursor = phase === "gap" ? checkpoint.gapCursorDate : checkpoint.historicalCursorDate;
  for (const action of actions) {
    const outcome = action.kind === "fetch" ? outcomes.get(action.date) : null;
    if (action.kind === "fetch" && (!outcome || outcome.kind === "error")) break;
    cursor = addExchangeDateDays(action.date, -1);
  }
  if (phase === "gap") {
    checkpoint.gapCursorDate = cursor;
    if (
      checkpoint.gapCursorDate
      && checkpoint.gapFloorDate
      && checkpoint.gapCursorDate.localeCompare(checkpoint.gapFloorDate) < 0
    ) {
      checkpoint.gapCursorDate = null;
      checkpoint.gapFloorDate = null;
    }
  } else {
    checkpoint.historicalCursorDate = cursor;
    if (
      checkpoint.historicalCursorDate
      && checkpoint.historicalCursorDate.localeCompare(checkpoint.historicalFloorDate) < 0
    ) {
      checkpoint.historicalCursorDate = null;
    }
  }
}

export async function backfillExchangeHistory(input: {
  apiKey: string | null;
  latestObservedDate: string | null;
  capturedAt?: number;
}) {
  const apiKey = input.apiKey?.trim() ?? "";
  const capturedAt = input.capturedAt ?? Date.now();
  if (!apiKey || !validDate(input.latestObservedDate)) {
    return {
      requestCount: 0,
      storedDates: 0,
      completed: false,
      errorCode: apiKey ? "exchange_backfill_date_unavailable" : "exchange_backfill_key_unavailable",
      failureKind: apiKey ? "transient" as const : "authorization" as const,
    };
  }

  let requestCount = 0;
  try {
    const db = await database();
    const stored = await readCheckpoint(db);
    const checkpoint = stored
      ? advanceExchangeBackfillWindow(stored, input.latestObservedDate!, capturedAt)
      : initialExchangeBackfillCheckpoint(input.latestObservedDate!, capturedAt);
    const interval = phaseInterval(checkpoint);
    if (!interval) {
      checkpoint.completedAt ??= capturedAt;
      checkpoint.lastError = null;
      checkpoint.updatedAt = capturedAt;
      await saveCheckpoint(db, checkpoint);
      return { requestCount: 0, storedDates: 0, completed: true, errorCode: null, failureKind: null };
    }

    const existing = await storedExchangeDates(db, interval.floor, interval.cursor);
    const plan = planExchangeBackfillActions(checkpoint, existing);
    const fetchActions = plan.actions.filter((action) => action.kind === "fetch");
    const outcomes = new Map<string, ProviderResult>();
    for (let offset = 0; offset < fetchActions.length; offset += FETCH_CONCURRENCY) {
      const chunk = fetchActions.slice(offset, offset + FETCH_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (action) => ({
        date: action.date,
        result: await fetchOfficialExchangeDate(apiKey, action.date),
      })));
      requestCount += results.length;
      for (const result of results) outcomes.set(result.date, result.result);
      // Requests within this small chunk are already in flight together, but
      // no later chunk should consume quota after any provider/storage-class
      // failure has been observed.
      if (shouldStopExchangeBackfillBatch(results.map((result) => result.result))) {
        break;
      }
    }

    let storedDates = 0;
    for (const [date, outcome] of outcomes) {
      if (outcome.kind !== "stored") continue;
      try {
        await saveExchangeHistory(outcome.exchange, capturedAt);
        storedDates += 1;
      } catch {
        outcomes.set(date, {
          kind: "error",
          errorCode: "exchange_backfill_persistence_failed",
          failureKind: "transient",
        });
      }
    }

    advanceCursor(checkpoint, plan.phase!, plan.actions, outcomes);
    const firstError = plan.actions
      .filter((action) => action.kind === "fetch")
      .map((action) => outcomes.get(action.date))
      .find((outcome): outcome is Extract<ProviderResult, { kind: "error" }> => outcome?.kind === "error");
    checkpoint.lastAttemptAt = capturedAt;
    checkpoint.lastError = firstError?.errorCode ?? null;
    checkpoint.updatedAt = capturedAt;
    const completed = phaseInterval(checkpoint) === null;
    checkpoint.completedAt = completed ? capturedAt : null;
    await saveCheckpoint(db, checkpoint);
    return {
      requestCount,
      storedDates,
      completed,
      errorCode: firstError?.errorCode ?? null,
      failureKind: firstError?.failureKind ?? null,
    };
  } catch {
    return {
      requestCount,
      storedDates: 0,
      completed: false,
      errorCode: "exchange_backfill_storage_unavailable",
      failureKind: "transient" as const,
    };
  }
}

function businessDaysBetween(floor: string, cursor: string | null) {
  if (!cursor || cursor.localeCompare(floor) < 0) return 0;
  let count = 0;
  for (let date = cursor; date.localeCompare(floor) >= 0; date = addExchangeDateDays(date, -1)) {
    if (isWeekday(date)) count += 1;
  }
  return count;
}

export async function readExchangeBackfillStatus(): Promise<ExchangeBackfillStatus> {
  const db = await database();
  const checkpoint = await readCheckpoint(db);
  if (!checkpoint) {
    return {
      phase: "not-started",
      targetStartDate: null,
      targetEndDate: null,
      nextDate: null,
      progressPercent: 0,
      completedAt: null,
      lastAttemptAt: null,
      lastError: null,
    };
  }
  const interval = phaseInterval(checkpoint);
  const total = businessDaysBetween(
    checkpoint.historicalFloorDate,
    addExchangeDateDays(checkpoint.latestObservedDate, -1),
  );
  const remaining = businessDaysBetween(
    checkpoint.historicalFloorDate,
    checkpoint.historicalCursorDate,
  ) + (
    checkpoint.gapFloorDate
      ? businessDaysBetween(checkpoint.gapFloorDate, checkpoint.gapCursorDate)
      : 0
  );
  return {
    phase: interval?.phase ?? "complete",
    targetStartDate: checkpoint.historicalFloorDate,
    targetEndDate: checkpoint.latestObservedDate,
    nextDate: interval?.cursor ?? null,
    progressPercent: total > 0 ? Math.min(100, Math.max(0, Math.round(((total - remaining) / total) * 100))) : 100,
    completedAt: checkpoint.completedAt ? new Date(checkpoint.completedAt).toISOString() : null,
    lastAttemptAt: checkpoint.lastAttemptAt ? new Date(checkpoint.lastAttemptAt).toISOString() : null,
    lastError: checkpoint.lastError,
  };
}
