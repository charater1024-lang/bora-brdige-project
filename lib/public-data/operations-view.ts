import type { PublicDataDashboard, PublicDataPayload, PublicInformationItem } from "./types";

export type PublicSourceActivationState = {
  sourceId: string;
  lastError: string | null;
  lastSuccessAt?: number | null;
  lastAttemptAt?: number;
  consecutiveFailures?: number;
  nextDueAt?: number;
};

const INACTIVE_SOURCE_ERRORS = new Set([
  "credential-unavailable",
  "disabled_by_operator",
]);

const DAY = 24 * 60 * 60 * 1_000;
export const FINANCIAL_COMPANY_SNAPSHOT_MAX_AGE_MS = 30 * DAY;

/** Publish safe freshness facts, never raw errors, credentials or quota data. */
export function projectPublicCollectionHealth(
  payload: PublicDataPayload,
  states: readonly PublicSourceActivationState[],
  now = Date.now(),
): PublicDataPayload {
  const bySource = new Map(states.map((state) => [state.sourceId, state]));
  const timestamp = (value: number | null | undefined) => Number.isSafeInteger(value)
    && Number(value) > 0 && Number(value) <= now ? new Date(Number(value)).toISOString() : null;
  return {
    ...payload,
    sources: payload.sources.map((source) => {
      const state = bySource.get(source.id);
      const lastCollectedAt = timestamp(state?.lastSuccessAt);
      const lastCollectionAttemptAt = timestamp(state?.lastAttemptAt);
      const disabled = state?.lastError && INACTIVE_SOURCE_ERRORS.has(state.lastError);
      // A late scheduler without an explicit failure also must not look fresh.
      // Allow an hour for a normal queue/cadence boundary before marking delay.
      const overdue = Number.isSafeInteger(state?.nextDueAt) && Number(state?.nextDueAt) > 0
        && Number(state?.nextDueAt) + 60 * 60_000 < now;
      const collectionStatus = !state ? "unknown" as const
        : disabled ? "disabled" as const
          : !lastCollectedAt ? "unavailable" as const
            : Number(state.consecutiveFailures ?? 0) > 0 || overdue ? "delayed" as const
              : "current" as const;
      return { ...source, collectionStatus, lastCollectedAt, lastCollectionAttemptAt };
    }),
  };
}

function compactSourceError(value: string | null | undefined) {
  return (value ?? "").replace(/^(?:warning_|source_)/u, "");
}

export function blocksFinancialCompanySnapshot(
  lastError: string | null | undefined,
) {
  // Provider/probe failures describe the latest attempt, not the generation
  // already stored. A date-valid last-known-good snapshot remains safe. Only a
  // future error that explicitly marks the stored generation itself invalid
  // may suppress otherwise recent rows.
  return compactSourceError(lastError) === "financial_company_stored_snapshot_invalid";
}

function exactPublicDay(value: string | null | undefined) {
  if (!value) return null;
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return null;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== day) return null;
  return parsed;
}

export function isRecentFinancialCompanyItem(
  item: PublicInformationItem,
  now = Date.now(),
) {
  if (!item.id.startsWith("company-")) return true;
  const publishedAt = exactPublicDay(item.publishedAt);
  if (publishedAt === null || !Number.isFinite(now)) return false;
  const currentSeoulDay = new Date(now + 9 * 60 * 60 * 1_000)
    .toISOString().slice(0, 10);
  const currentDayAt = Date.parse(`${currentSeoulDay}T00:00:00Z`);
  return publishedAt >= currentDayAt - FINANCIAL_COMPANY_SNAPSHOT_MAX_AGE_MS
    && publishedAt <= currentDayAt + DAY;
}

/**
 * Financial-company rows are point-in-time verification data, not an archival
 * notice feed. Keep a recent last-known-good snapshot through ordinary network
 * failures, but fail closed when current-date validation itself failed or the
 * stored provider date is outside the defensible snapshot window.
 */
export function projectCurrentPublicCatalogItems(
  items: readonly PublicInformationItem[],
  states: readonly Pick<PublicSourceActivationState, "sourceId" | "lastError">[],
  now = Date.now(),
) {
  const financialState = states.find((state) => state.sourceId === "financial-company");
  const blocked = blocksFinancialCompanySnapshot(financialState?.lastError);
  return items.filter((item) => !item.id.startsWith("company-")
    || (!blocked && isRecentFinancialCompanyItem(item, now)));
}

/**
 * A saved snapshot can outlive a provider activation change. Do not keep
 * showing an old authorization/network failure after an operator has turned
 * that provider off. Historical catalogue rows remain untouched; only the
 * connection badge/count reflects the current runtime state.
 */
export function projectInactivePublicSources(
  payload: PublicDataPayload,
  states: readonly PublicSourceActivationState[],
  now = Date.now(),
): PublicDataPayload {
  const inactive = new Set(states
    .filter((state) => state.lastError && INACTIVE_SOURCE_ERRORS.has(state.lastError))
    .map((state) => state.sourceId));
  const originalItems = payload.categories.flatMap((group) => group.items);
  const projectedItems = projectCurrentPublicCatalogItems(originalItems, states, now);
  const projectedIds = new Set(projectedItems.map((item) => item.id));
  const hadFinancialRows = originalItems.some((item) => item.id.startsWith("company-"));
  const hasCurrentFinancialRows = projectedItems.some((item) => item.id.startsWith("company-"));
  const financialState = states.find((state) => state.sourceId === "financial-company");
  const storedFinancialCount = payload.sources.find((source) => source.id === "financial-company")
    ?.itemCount ?? 0;
  const financialBlocked = blocksFinancialCompanySnapshot(financialState?.lastError)
    || (!hasCurrentFinancialRows && (hadFinancialRows || storedFinancialCount > 0));
  if (!inactive.size && !financialBlocked && projectedItems.length === originalItems.length) return payload;
  return {
    ...payload,
    categories: payload.categories.map((group) => {
      const items = group.items.filter((item) => projectedIds.has(item.id));
      const removedPreviewItems = group.items.length - items.length;
      const removedItems = group.id === "finance" && financialBlocked
        ? Math.max(removedPreviewItems, storedFinancialCount)
        : removedPreviewItems;
      return {
        ...group,
        items,
        totalCount: Math.max(items.length, group.totalCount - removedItems),
      };
    }),
    sources: payload.sources.map((source) => {
      if (source.id === "financial-company" && financialBlocked) {
        const safeSource = {
          ...source,
          status: "unavailable" as const,
          itemCount: 0,
          errorCode: compactSourceError(financialState?.lastError)
            || "financial_company_snapshot_stale",
        };
        delete safeSource.providerTotalCount;
        delete safeSource.fetchedCount;
        delete safeSource.completeness;
        return safeSource;
      }
      if (!inactive.has(source.id)) return source;
      const safeSource = {
        ...source,
        status: "not-configured" as const,
        itemCount: 0,
      };
      delete safeSource.errorCode;
      delete safeSource.providerTotalCount;
      delete safeSource.fetchedCount;
      delete safeSource.completeness;
      return safeSource;
    }),
  };
}

export function redactPublicDashboardOperations(
  dashboard: PublicDataDashboard,
  canViewOperations: boolean,
): PublicDataDashboard {
  if (canViewOperations) return dashboard;
  return {
    ...dashboard,
    // Collection coverage is product information: ordinary viewers need to
    // know when a catalogue is partial. Provider errors, credentials, quota
    // usage and scheduler internals remain developer-only.
    sources: dashboard.sources.map((source) => {
      const safeSource = { ...source };
      delete safeSource.errorCode;
      return safeSource;
    }),
    sourceSchedules: [],
  };
}
