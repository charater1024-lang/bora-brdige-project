import {
  EXCHANGE_HISTORY_RANGES,
  isExchangeHistoryCurrency,
  isExchangeHistoryRange,
  readExchangeHistory,
} from "@/lib/public-data/history";
import {
  readExchangeBackfillStatus,
  type ExchangeBackfillStatus,
} from "@/lib/public-data/exchange-backfill";

export const dynamic = "force-dynamic";

const SOURCE = "한국수출입은행 환율 API";
const SOURCE_URL = "https://www.koreaexim.go.kr/ir/HPHKIR020M01?apino=2&viewtype=C";
const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};

function emptySummary() {
  return { latest: 0, change: 0, changeRate: 0, high: 0, low: 0 };
}

const EMPTY_BACKFILL: ExchangeBackfillStatus = {
  phase: "not-started",
  targetStartDate: null,
  targetEndDate: null,
  nextDate: null,
  progressPercent: 0,
  completedAt: null,
  lastAttemptAt: null,
  lastError: null,
};

function emptyResponse(
  currency: string,
  rangeDays: number,
  storageAvailable = true,
  backfill: ExchangeBackfillStatus = EMPTY_BACKFILL,
) {
  return {
    currency,
    baseCurrency: "KRW",
    rangeDays,
    availableRanges: EXCHANGE_HISTORY_RANGES,
    granularity: "daily",
    hasData: false,
    points: [],
    summary: emptySummary(),
    source: SOURCE,
    sourceUrl: SOURCE_URL,
    asOf: null,
    status: "empty",
    cached: false,
    storageAvailable,
    backfill,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const currency = (url.searchParams.get("currency") ?? "USD").trim().toUpperCase();
  const rangeDays = Number(url.searchParams.get("days") ?? url.searchParams.get("range") ?? "30");
  if (!isExchangeHistoryCurrency(currency)) {
    return Response.json({ error: "unsupported_currency" }, { status: 400, headers: RESPONSE_HEADERS });
  }
  if (!Number.isInteger(rangeDays) || !isExchangeHistoryRange(rangeDays)) {
    return Response.json({ error: "unsupported_range" }, { status: 400, headers: RESPONSE_HEADERS });
  }

  try {
    const [storedPoints, backfill] = await Promise.all([
      readExchangeHistory(currency, rangeDays),
      readExchangeBackfillStatus().catch(() => EMPTY_BACKFILL),
    ]);
    if (!storedPoints.length) {
      return Response.json(emptyResponse(currency, rangeDays, true, backfill), { headers: RESPONSE_HEADERS });
    }
    const points = storedPoints.map((point) => ({
      date: point.date,
      rate: point.rate,
      quotedUnit: point.quotedUnit,
      quotedRate: point.quotedRate,
      capturedAt: new Date(point.capturedAt).toISOString(),
    }));
    const rates = points.map((point) => point.rate);
    const first = rates[0];
    const latest = rates.at(-1) ?? 0;
    const change = rates.length > 1 ? latest - first : 0;
    return Response.json({
      currency,
      baseCurrency: "KRW",
      rangeDays,
      availableRanges: EXCHANGE_HISTORY_RANGES,
      granularity: "daily",
      hasData: true,
      points,
      summary: {
        latest,
        change,
        changeRate: rates.length > 1 && first > 0 ? (change / first) * 100 : 0,
        high: Math.max(...rates),
        low: Math.min(...rates),
      },
      source: SOURCE,
      sourceUrl: SOURCE_URL,
      asOf: points.at(-1)?.date ?? null,
      status: "live",
      cached: true,
      storageAvailable: true,
      backfill,
    }, { headers: RESPONSE_HEADERS });
  } catch {
    return Response.json(emptyResponse(currency, rangeDays, false), {
      status: 503,
      headers: RESPONSE_HEADERS,
    });
  }
}
