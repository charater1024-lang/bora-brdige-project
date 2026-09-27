import type { PublicDataPayload } from "./types";

const EXCHANGE_SOURCE_ID = "exchange";
const RETENTION_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1_000;

export const EXCHANGE_HISTORY_CURRENCIES = [
  "USD",
  "JPY",
  "CNY",
  "EUR",
  "GBP",
  "CAD",
  "AUD",
  "SGD",
] as const;

export const EXCHANGE_HISTORY_RANGES = [7, 30, 90, 365] as const;

export type ExchangeHistoryCurrency = (typeof EXCHANGE_HISTORY_CURRENCIES)[number];
export type ExchangeHistoryRange = (typeof EXCHANGE_HISTORY_RANGES)[number];

export interface ExchangeHistoryPoint {
  date: string;
  rate: number;
  quotedUnit: number;
  quotedRate: number;
  capturedAt: number;
}

type StoredExchangeHistoryPoint = {
  date: string;
  rate: number;
  quotedUnit: number;
  quotedRate: number;
  capturedAt: number;
};

let schemaReady: Promise<D1Database> | null = null;

async function database() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const { env } = await import("cloudflare:workers");
      if (!env.DB) throw new Error("public_data_storage_unavailable");
      const db = env.DB;
      const existing = await db.prepare(`SELECT COUNT(*) AS tableCount FROM sqlite_master
        WHERE type = 'table' AND name IN ('public_api_source_state', 'exchange_rate_points')`)
        .first<{ tableCount: number }>();
      if (Number(existing?.tableCount) === 2) return db;
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS public_api_source_state (
          source_id TEXT PRIMARY KEY NOT NULL,
          quota_day TEXT NOT NULL DEFAULT '',
          used_calls INTEGER NOT NULL DEFAULT 0,
          reserved_calls INTEGER NOT NULL DEFAULT 0,
          daily_limit INTEGER NOT NULL DEFAULT 0,
          quota_verified INTEGER NOT NULL DEFAULT 0,
          next_due_at INTEGER NOT NULL DEFAULT 0,
          last_success_at INTEGER,
          last_attempt_at INTEGER NOT NULL DEFAULT 0,
          backoff_until INTEGER NOT NULL DEFAULT 0,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          updated_at INTEGER NOT NULL
        )`),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS public_api_source_state_due_idx ON public_api_source_state (next_due_at, backoff_until)",
        ),
        db.prepare(`CREATE TABLE IF NOT EXISTS exchange_rate_points (
          source_id TEXT NOT NULL,
          currency TEXT NOT NULL,
          base_currency TEXT NOT NULL,
          effective_date TEXT NOT NULL,
          base_rate REAL NOT NULL,
          quoted_unit INTEGER NOT NULL,
          quoted_rate REAL NOT NULL,
          captured_at INTEGER NOT NULL,
          PRIMARY KEY (source_id, currency, effective_date)
        )`),
        db.prepare(
          "CREATE INDEX IF NOT EXISTS exchange_rate_points_currency_date_idx ON exchange_rate_points (currency, effective_date)",
        ),
      ]);
      return db;
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

function isValidEffectiveDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.toISOString().slice(0, 10) === value;
}

function seoulDate(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isExchangeHistoryCurrency(value: string): value is ExchangeHistoryCurrency {
  return (EXCHANGE_HISTORY_CURRENCIES as readonly string[]).includes(value);
}

export function isExchangeHistoryRange(value: number): value is ExchangeHistoryRange {
  return (EXCHANGE_HISTORY_RANGES as readonly number[]).includes(value);
}

export async function saveExchangeHistory(
  exchange: PublicDataPayload["exchange"],
  capturedAt: number,
) {
  if (!Number.isFinite(capturedAt) || !isValidEffectiveDate(exchange.asOf)) return 0;
  const validRates = exchange.rates.filter((rate) => (
    isExchangeHistoryCurrency(rate.currency)
    && rate.baseCurrency === "KRW"
    && Number.isFinite(rate.baseRate)
    && rate.baseRate > 0
    && Number.isInteger(rate.quotedUnit)
    && rate.quotedUnit > 0
    && Number.isFinite(rate.quotedRate)
    && rate.quotedRate > 0
  ));
  if (!validRates.length) return 0;

  const db = await database();
  const cutoffDate = seoulDate(capturedAt - RETENTION_DAYS * DAY_MS);
  // Eight supported currencies × eight bound values stays below D1's
  // 100-parameter ceiling and replaces eight per-currency statements.
  const placeholders = validRates.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
  const values = validRates.flatMap((rate) => [
    EXCHANGE_SOURCE_ID,
    rate.currency,
    rate.baseCurrency,
    exchange.asOf!,
    rate.baseRate,
    rate.quotedUnit,
    rate.quotedRate,
    capturedAt,
  ]);
  await db.prepare(`INSERT INTO exchange_rate_points
    (source_id, currency, base_currency, effective_date, base_rate, quoted_unit, quoted_rate, captured_at)
    VALUES ${placeholders}
    ON CONFLICT(source_id, currency, effective_date) DO UPDATE SET
      base_currency = CASE WHEN excluded.captured_at >= exchange_rate_points.captured_at THEN excluded.base_currency ELSE exchange_rate_points.base_currency END,
      base_rate = CASE WHEN excluded.captured_at >= exchange_rate_points.captured_at THEN excluded.base_rate ELSE exchange_rate_points.base_rate END,
      quoted_unit = CASE WHEN excluded.captured_at >= exchange_rate_points.captured_at THEN excluded.quoted_unit ELSE exchange_rate_points.quoted_unit END,
      quoted_rate = CASE WHEN excluded.captured_at >= exchange_rate_points.captured_at THEN excluded.quoted_rate ELSE exchange_rate_points.quoted_rate END,
      captured_at = MAX(exchange_rate_points.captured_at, excluded.captured_at)`)
    .bind(...values)
    .run();
  await db.prepare("DELETE FROM exchange_rate_points WHERE effective_date < ?")
    .bind(cutoffDate)
    .run();
  return validRates.length;
}

export async function readExchangeHistory(
  currency: string,
  rangeDays: number,
  now = Date.now(),
): Promise<ExchangeHistoryPoint[]> {
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!isExchangeHistoryCurrency(normalizedCurrency)) {
    throw new Error("unsupported_currency");
  }
  if (!isExchangeHistoryRange(rangeDays)) {
    throw new Error("unsupported_range");
  }
  const cutoffDate = seoulDate(now - rangeDays * DAY_MS);
  const db = await database();
  const rows = await db.prepare(`SELECT effective_date AS date, base_rate AS rate,
    quoted_unit AS quotedUnit, quoted_rate AS quotedRate, captured_at AS capturedAt
    FROM exchange_rate_points
    WHERE source_id = ? AND currency = ? AND effective_date >= ?
    ORDER BY effective_date ASC`)
    .bind(EXCHANGE_SOURCE_ID, normalizedCurrency, cutoffDate)
    .all<StoredExchangeHistoryPoint>();
  return rows.results ?? [];
}
