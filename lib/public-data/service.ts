import type { StoredAuthUser } from "@/lib/auth/types";
import {
  boundPublicCatalogItems,
  CATEGORY_CATALOG_MAX_ITEMS,
  claimPublicRefresh,
  commitPublicBackfillPage,
  completePublicSourceRun,
  deferPublicSources,
  ensurePublicSnapshot,
  ensurePublicSourceStates,
  failPublicRefresh,
  markCategorySeen,
  parseSnapshotPayload,
  parseSnapshotViewPayload,
  readCategorySeenAt,
  readPublicCategoryCatalog,
  readPublicCategoryCatalogCounts,
  readPublicCategoryCatalogNewCounts,
  readPublicBackfillCheckpoints,
  readPublicBackfillStagedItems,
  shouldReadPublicBackfillStaging,
  readPublicSnapshot,
  readPublicSourceCatalog,
  readPublicSourceStates,
  readYouthPolicyCatalog,
  recoverPublicSourcesAfterSnapshotFailure,
  releasePublicRefresh,
  reservePublicSourceCalls,
  savePublicSnapshot,
  savePublicSourceCatalog,
  saveYouthPolicyCatalog,
  serializePublicDataPayload,
  SOURCE_CATALOG_MAX_ITEMS,
  type PublicApiSourceStateRow,
  type SnapshotRow,
  YOUTH_CATALOG_MAX_ITEMS,
} from "./cache";
import {
  collectPublicData,
  configuredPublicDataSourceIds,
  publicDataSourceCredentialKey,
  resolvePublicDataSourceKeys,
  type PublicDataSourceId,
} from "./adapters";
import {
  acceleratedPolicyDueAt,
  eligiblePolicyDueAt,
  failureBackoffMs,
  isPublicCatalogBackfillInProgress,
  kstQuotaDay,
  nextKstQuotaDayStart,
  nextPolicyDueAt,
  PUBLIC_API_AUTOMATIC_RATIO,
  PUBLIC_API_HARD_STOP_RATIO,
  PUBLIC_API_MANUAL_RATIO,
  PUBLIC_SOURCE_POLICIES,
  selectPublicRefreshBatch,
  sourceFailureBackoffMs,
  type PublicSourcePolicy,
} from "./policies";
import {
  backfillExchangeHistory,
  EXCHANGE_BACKFILL_REFRESH_MS,
} from "./exchange-backfill";
import { saveExchangeHistory } from "./history";
import { publicItemRecency } from "./dates";
import {
  prunePublicDataPayload,
  prunePublicInformationArchive,
} from "./retention";
import {
  deduplicatePublicCatalogItems,
  mergeCatalogWithSnapshot,
  publicNewItemCutoff,
  projectCatalogRetentionCoverage,
  selectPublicCatalogSummaryCounts,
  withPublicNewItemScope,
} from "./catalog-view";
import {
  projectCurrentPublicCatalogItems,
  projectPublicCollectionHealth,
  projectInactivePublicSources,
} from "./operations-view";
import {
  emptyPublicDataPayload,
  PUBLIC_CATEGORIES,
  type PublicDataDashboard,
  type PublicDataPayload,
  type PublicInformationCategory,
  type PublicInformationItem,
  type PublicSourceSchedule,
} from "./types";

export {
  deduplicatePublicCatalogItems,
  filterAndPaginatePublicDashboard,
  mergeCatalogWithSnapshot,
  projectCatalogRetentionCoverage,
} from "./catalog-view";
export { readPublicCatalogVersion } from "./cache";

const UNCONFIGURED_RECHECK_MS = 5 * 60 * 1_000;
const PUBLIC_CATALOG_BACKFILL_REFRESH_MS = 2 * 60 * 1_000;

type PublicRefreshStage = "reservation" | "checkpoint_read" | "staging_read" | "catalog_read"
  | "provider_collect" | "catalog_prepare" | "catalog_save" | "legacy_save"
  | "snapshot_prepare" | "history_save" | "source_complete" | "snapshot_save";

/** Diagnostic vocabulary is closed: never persist provider messages or URLs. */
export function publicRefreshFailureCode(stage: PublicRefreshStage, error: unknown) {
  const reasons: Record<string, string> = {
    public_backfill_complete_missing_page: "staging_missing_page",
    public_backfill_complete_cardinality_invalid: "staging_cardinality",
    public_backfill_complete_invalid: "staging_incomplete",
    public_backfill_page_invalid: "staging_invalid",
    public_backfill_page_too_large: "staging_limit",
    public_source_catalog_invalid: "catalog_invalid",
    public_source_catalog_too_large: "catalog_limit",
    public_snapshot_too_large: "snapshot_limit",
    public_snapshot_invalid_seoul_analytics: "snapshot_invalid",
    public_source_completion_conflict: "completion_conflict",
    public_snapshot_save_conflict: "snapshot_conflict",
  };
  const reason = error instanceof Error && Object.hasOwn(reasons, error.message)
    ? reasons[error.message] : undefined;
  return `refresh_failed_${stage}_${reason ?? "unknown"}`;
}
const SNAPSHOT_YOUTH_PREVIEW_LIMIT = 255;
const SNAPSHOT_PREVIEW_LIMITS: Record<PublicInformationCategory, number> = {
  youth: SNAPSHOT_YOUTH_PREVIEW_LIMIT,
  finance: 300,
  startup: 500,
  employment: 100,
};
export const INACTIVE_PUBLIC_SOURCE_RECHECK_MS = 6 * 60 * 60 * 1_000;

type PublicRefreshTrigger = "login" | "manual" | "scheduled" | "opportunistic";

function iso(value: number | null | undefined) {
  return value && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

async function withNewCounts(payload: PublicDataPayload, user: StoredAuthUser | null) {
  if (!user) {
    return payload.categories.map((group) => withPublicNewItemScope(group, null));
  }
  const seen = await readCategorySeenAt(user.id).catch(() => new Map<string, number>());
  return payload.categories.map((group) => {
    const seenAt = seen.get(group.id) ?? 0;
    return withPublicNewItemScope(group, seenAt);
  });
}

function stateBySource(states: PublicApiSourceStateRow[]) {
  return new Map(states.map((state) => [state.sourceId, state]));
}

function policyDueAt(policy: PublicSourcePolicy, state: PublicApiSourceStateRow, now: number) {
  const acceleratedExchangeBackfill = policy.sourceId === "exchange"
    && state.lastError?.startsWith("warning_exchange_backfill_");
  const acceleratedCatalogBackfill = isPublicCatalogBackfillInProgress(state.lastError);
  let dueAt = acceleratedExchangeBackfill || acceleratedCatalogBackfill
    ? acceleratedPolicyDueAt(
        policy,
        now,
        state.nextDueAt,
        state.backoffUntil,
      )
    : eligiblePolicyDueAt(
        policy,
        now,
        state.nextDueAt,
        state.backoffUntil,
        state.lastSuccessAt,
      );
  const hardStop = Math.floor(state.dailyLimit * PUBLIC_API_HARD_STOP_RATIO);
  if (state.reservedCalls > 0 || state.usedCalls + state.reservedCalls + policy.estimatedCalls > hardStop) {
    dueAt = Math.max(dueAt, nextKstQuotaDayStart(now));
  }
  return dueAt;
}

function sourceSchedules(
  states: PublicApiSourceStateRow[],
  user: StoredAuthUser | null,
  now: number,
) {
  const bySource = stateBySource(states);
  return PUBLIC_SOURCE_POLICIES.flatMap((policy): PublicSourceSchedule[] => {
    const state = bySource.get(policy.sourceId);
    if (!state) return [];
    const dueAt = policyDueAt(policy, state, now);
    const refreshInSeconds = Math.max(0, Math.ceil((dueAt - now) / 1_000));
    const manualLimit = Math.min(
      Math.floor(state.dailyLimit * PUBLIC_API_MANUAL_RATIO),
      Math.floor(state.dailyLimit * PUBLIC_API_HARD_STOP_RATIO),
    );
    return [{
      sourceId: policy.sourceId,
      serviceKey: publicDataSourceCredentialKey(policy.sourceId),
      nextDueAt: iso(dueAt),
      lastSuccessAt: iso(state.lastSuccessAt),
      lastAttemptAt: iso(state.lastAttemptAt),
      dailyLimit: state.dailyLimit,
      usedCalls: state.usedCalls,
      reservedCalls: state.reservedCalls,
      quotaVerified: Boolean(state.quotaVerified),
      quotaBasis: policy.quotaBasis,
      refreshInSeconds,
      canRefresh: Boolean(user)
        && refreshInSeconds === 0
        && state.reservedCalls === 0
        && state.usedCalls + policy.estimatedCalls <= manualLimit,
      lastError: state.lastError,
    }];
  });
}

function earliestScheduleAt(schedules: PublicSourceSchedule[], fallback = 0) {
  const candidates = schedules
    .map((schedule) => schedule.nextDueAt ? Date.parse(schedule.nextDueAt) : Number.NaN)
    .filter(Number.isFinite);
  return candidates.length ? Math.min(...candidates) : fallback;
}

async function dashboardFrom(
  row: SnapshotRow | null,
  user: StoredAuthUser | null,
  now: number,
  states: PublicApiSourceStateRow[] = [],
): Promise<PublicDataDashboard> {
  const storedPayload = parseSnapshotPayload(row);
  const activePayload = projectInactivePublicSources(
    prunePublicDataPayload(
      storedPayload ?? parseSnapshotViewPayload(row) ?? emptyPublicDataPayload(),
      now,
    ),
    states,
  );
  const payload = projectPublicCollectionHealth({
    ...activePayload,
    categories: activePayload.categories.map((group) => {
      const items = deduplicatePublicCatalogItems(group.items);
      return { ...group, items, totalCount: items.length };
    }),
    sources: activePayload.sources.map((source) => (
      projectCatalogRetentionCoverage(source, SOURCE_CATALOG_MAX_ITEMS)
    )),
  }, states, now);
  const schedules = sourceSchedules(states, user, now);
  const nextRefreshAt = earliestScheduleAt(schedules, row?.nextRefreshAt ?? 0);
  const refreshInSeconds = Math.max(0, Math.ceil((nextRefreshAt - now) / 1_000));
  const stale = row?.status === "stale";
  const status = !storedPayload
    ? "empty"
    : stale
      ? "stale"
      : row?.status === "partial"
        ? "partial"
        : "live";
  return {
    ...payload,
    categories: await withNewCounts(payload, user),
    status,
    cached: Boolean(storedPayload),
    stale,
    lastSuccessfulAt: iso(row?.lastSuccessfulAt),
    nextRefreshAt: iso(nextRefreshAt),
    canRefresh: Boolean(user) && schedules.some((schedule) => schedule.canRefresh),
    refreshInSeconds,
    authenticated: Boolean(user),
    sourceSchedules: schedules,
  };
}

async function initializedState(now: number) {
  const row = await ensurePublicSnapshot(now);
  await ensurePublicSourceStates(PUBLIC_SOURCE_POLICIES, kstQuotaDay(now), now);
  return { row, states: await readPublicSourceStates() };
}

export async function getPublicDashboard(
  user: StoredAuthUser | null,
  options: { failOnStorageError?: boolean } = {},
) {
  const now = Date.now();
  try {
    return await currentDashboard(user, now);
  } catch (error) {
    if (options.failOnStorageError) throw error;
    return dashboardFrom(null, user, now);
  }
}

export async function publicDashboardWithYouthCatalog(
  dashboard: PublicDataDashboard,
  user: StoredAuthUser | null,
) {
  const [categoryCatalog, legacyCatalog] = await Promise.all([
    readPublicCategoryCatalog("youth"),
    readYouthPolicyCatalog(),
  ]);
  const catalog = mergeCatalogWithSnapshot(categoryCatalog, legacyCatalog);
  if (!catalog.length) return dashboard;
  const fallbackSeenAt = user
    ? (await readCategorySeenAt(user.id).catch(() => new Map<string, number>())).get("youth") ?? 0
    : null;
  return {
    ...dashboard,
    categories: dashboard.categories.map((group) => group.id === "youth"
      ? (() => {
        const items = mergeCatalogWithSnapshot(group.items, catalog);
        const scopedCutoff = publicNewItemCutoff(group);
        const cutoff = scopedCutoff === undefined ? fallbackSeenAt : scopedCutoff;
        return withPublicNewItemScope({
          ...group,
          items,
          totalCount: items.length,
          newCount: group.newCount,
        }, cutoff);
      })()
      : group),
  };
}

export async function publicDashboardWithCategoryCatalog(
  dashboard: PublicDataDashboard,
  user: StoredAuthUser | null,
  category: PublicInformationCategory,
) {
  const [loadedCatalog, counts] = await Promise.all([
    readPublicCategoryCatalog(category),
    readPublicCategoryCatalogCounts(category),
  ]);
  let catalog = projectCurrentPublicCatalogItems(
    loadedCatalog,
    dashboard.sourceSchedules,
  );
  if (category === "youth" && catalog.length === 0) {
    catalog = await readYouthPolicyCatalog();
  }
  if (!catalog.length) return dashboard;
  const fallbackSeenAt = user
    ? (await readCategorySeenAt(user.id).catch(() => new Map<string, number>())).get(category) ?? 0
    : null;
  // Counts use the same financial snapshot-age projection in SQL, including
  // rows beyond this bounded response body; do not subtract hidden rows twice.
  const categoryStoredCount = counts.get(category) ?? 0;
  return {
    ...dashboard,
    // A category may aggregate several individually bounded sources. Keep the
    // response memory-bounded, but never present that bounded preview as full.
    status: categoryStoredCount > CATEGORY_CATALOG_MAX_ITEMS ? "partial" : dashboard.status,
    categories: dashboard.categories.map((group) => group.id === category
      ? (() => {
        const items = mergeCatalogWithSnapshot(group.items, catalog)
          .slice(0, CATEGORY_CATALOG_MAX_ITEMS);
        const scopedCutoff = publicNewItemCutoff(group);
        const cutoff = scopedCutoff === undefined ? fallbackSeenAt : scopedCutoff;
        return withPublicNewItemScope({
          ...group,
          items,
          // The response body is bounded at 100k items, while totalCount keeps
          // the complete server-side row count instead of silently shrinking.
          totalCount: Math.max(items.length, categoryStoredCount),
          newCount: group.newCount,
        }, cutoff);
      })()
      : group),
  };
}

export async function publicDashboardWithCatalogCounts(
  dashboard: PublicDataDashboard,
) {
  const cutoffs = new Map<PublicInformationCategory, number>();
  for (const group of dashboard.categories) {
    const cutoff = publicNewItemCutoff(group);
    if (cutoff !== undefined && cutoff !== null) cutoffs.set(group.id, cutoff);
  }
  const [counts, newCounts] = await Promise.all([
    readPublicCategoryCatalogCounts(),
    readPublicCategoryCatalogNewCounts(cutoffs),
  ]);
  if (!counts.size) return dashboard;
  return {
    ...dashboard,
    categories: dashboard.categories.map((group) => {
      const cutoff = publicNewItemCutoff(group);
      const catalogTotal = counts.get(group.id);
      const selected = selectPublicCatalogSummaryCounts(group, catalogTotal === undefined
        ? null
        : {
            totalCount: catalogTotal,
            newCount: cutoff === undefined
              ? group.newCount
              : cutoff === null
                ? 0
                : newCounts.get(group.id) ?? 0,
          });
      return {
        ...group,
        totalCount: selected.totalCount,
        newCount: selected.newCount,
      };
    }),
  };
}

export function snapshotPayloadWithYouthPreview(payload: PublicDataPayload, now = Date.now()) {
  const orderedByCategory = new Map(payload.categories.map((group) => {
    const recency = new Map(group.items.map((item) => [item, publicItemRecency(item, now)]));
    const ordered = [...group.items].sort((left, right) => (recency.get(right) ?? 0) - (recency.get(left) ?? 0));
    const sharedSources = group.id === "youth"
      ? ordered.filter((item) => !item.id.startsWith("youth-center-"))
      : [];
    const providerItems = group.id === "youth"
      ? ordered.filter((item) => item.id.startsWith("youth-center-"))
      : ordered;
    return [group.id, [...sharedSources, ...providerItems]] as const;
  }));

  let scale = 1;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = {
      ...payload,
      categories: payload.categories.map((group) => {
        const limit = Math.max(1, Math.floor(SNAPSHOT_PREVIEW_LIMITS[group.id] * scale));
        const items = (orderedByCategory.get(group.id) ?? group.items).slice(0, limit);
        return { ...group, items, totalCount: items.length };
      }),
    };
    try {
      serializePublicDataPayload(candidate);
      return candidate;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (![
        "public_snapshot_too_large",
        "public_snapshot_compact_dictionary_full",
        "public_snapshot_too_many_seoul_areas",
      ].includes(code)) {
        throw error;
      }
      scale *= 0.7;
    }
  }
  const metadataOnly = {
    ...payload,
    categories: payload.categories.map((group) => ({
      ...group,
      items: [],
      totalCount: 0,
      newCount: 0,
    })),
  };
  serializePublicDataPayload(metadataOnly);
  return metadataOnly;
}

function dueSourcePolicies(states: PublicApiSourceStateRow[], now: number) {
  const bySource = stateBySource(states);
  return PUBLIC_SOURCE_POLICIES.filter((policy) => {
    const state = bySource.get(policy.sourceId);
    return Boolean(state)
      && state!.reservedCalls === 0
      && policyDueAt(policy, state!, now) <= now;
  });
}

function allowedCallsForTrigger(state: PublicApiSourceStateRow, trigger: PublicRefreshTrigger) {
  const requestedRatio = trigger === "manual" ? PUBLIC_API_MANUAL_RATIO : PUBLIC_API_AUTOMATIC_RATIO;
  return Math.min(
    Math.floor(state.dailyLimit * requestedRatio),
    Math.floor(state.dailyLimit * PUBLIC_API_HARD_STOP_RATIO),
  );
}

async function currentDashboard(user: StoredAuthUser | null, now = Date.now()) {
  const [row, states] = await Promise.all([readPublicSnapshot(), readPublicSourceStates()]);
  return dashboardFrom(row, user, now, states);
}

export async function refreshPublicDashboard(
  user: StoredAuthUser | null,
  trigger: PublicRefreshTrigger,
) {
  const now = Date.now();
  let row: SnapshotRow | null;
  let states: PublicApiSourceStateRow[];
  try {
    ({ row, states } = await initializedState(now));
  } catch {
    return { kind: "storage-unavailable" as const, dashboard: await dashboardFrom(null, user, now) };
  }

  let candidates = dueSourcePolicies(states, now);
  if (!candidates.length) {
    return { kind: "cooldown" as const, dashboard: await dashboardFrom(row, user, now, states) };
  }
  const leaseUntil = await claimPublicRefresh(now);
  if (!leaseUntil) {
    return { kind: "cooldown" as const, dashboard: await currentDashboard(user, now) };
  }

  const reserved = new Map<string, { policy: PublicSourcePolicy; state: PublicApiSourceStateRow }>();
  const completedSourceRuns = new Map<string, { successful: boolean; completedAt: number }>();
  let stage: PublicRefreshStage = "reservation";
  try {
    states = await readPublicSourceStates();
    candidates = dueSourcePolicies(states, now);
    const candidateIds = candidates.map((policy) => policy.sourceId);
    const resolvedKeys = await resolvePublicDataSourceKeys(candidateIds);
    const configured = new Set(configuredPublicDataSourceIds(candidateIds, resolvedKeys));
    const bySource = stateBySource(states);
    const batchIds = new Set(selectPublicRefreshBatch(
      candidates.filter((policy) => configured.has(policy.sourceId as PublicDataSourceId)),
      states,
    ).map((policy) => policy.sourceId));
    const deferredSources = new Map<string, {
      sourceId: string;
      nextDueAt: number;
      errorCode: string | null;
    }>();

    for (const policy of candidates) {
      const state = bySource.get(policy.sourceId);
      if (!state) continue;
      if (!configured.has(policy.sourceId as PublicDataSourceId)) {
        deferredSources.set(policy.sourceId, {
          sourceId: policy.sourceId,
          nextDueAt: now + INACTIVE_PUBLIC_SOURCE_RECHECK_MS,
          errorCode: "credential-unavailable",
        });
        continue;
      }
      if (!batchIds.has(policy.sourceId)) continue;
      const allowedCalls = allowedCallsForTrigger(state, trigger);
      if (state.usedCalls + state.reservedCalls + policy.estimatedCalls > allowedCalls) {
        deferredSources.set(policy.sourceId, {
          sourceId: policy.sourceId,
          nextDueAt: nextKstQuotaDayStart(now),
          errorCode: trigger === "manual"
            ? "manual-budget-exhausted"
            : "automatic-budget-exhausted",
        });
        continue;
      }
      const claimed = await reservePublicSourceCalls({
        sourceId: policy.sourceId,
        estimatedCalls: policy.estimatedCalls,
        allowedCalls,
        now,
      });
      if (claimed) {
        reserved.set(policy.sourceId, { policy, state });
        continue;
      }
      // An interactive lookup may briefly own this provider's call
      // reservation. Keep next_due_at unchanged so a user search can never
      // postpone the scheduled catalogue refresh.
    }
    if (deferredSources.size) {
      await deferPublicSources([...deferredSources.values()], now);
    }

    if (!reserved.size) {
      states = await readPublicSourceStates();
      const dashboard = await dashboardFrom(row, user, now, states);
      await releasePublicRefresh({
        now,
        nextRefreshAt: dashboard.nextRefreshAt ? Date.parse(dashboard.nextRefreshAt) : now + UNCONFIGURED_RECHECK_MS,
        leaseUntil,
      });
      return { kind: "cooldown" as const, dashboard };
    }

    const selectedIds = [...reserved.keys()];
    const previousPayload = parseSnapshotPayload(row) ?? parseSnapshotViewPayload(row);
    stage = "checkpoint_read";
    const checkpoints = await readPublicBackfillCheckpoints(selectedIds);
    stage = "staging_read";
    const stagedItems = new Map<string, readonly PublicInformationItem[]>();
    await Promise.all([...checkpoints.values()].map(async (checkpoint) => {
      if (!shouldReadPublicBackfillStaging(checkpoint, now)) return;
      stagedItems.set(
        checkpoint.sourceId,
        await readPublicBackfillStagedItems(checkpoint),
      );
    }));
    // Detail-hydrating incremental adapters and the Seoul host-import state
    // adapter must see their full retained catalogue rather than the compact
    // home preview. The Seoul adapter never performs an upstream request here;
    // it verifies and exposes the atomically imported full snapshot.
    const previousSourceCatalogs = new Map<string, readonly PublicInformationItem[]>();
    stage = "catalog_read";
    await Promise.all(selectedIds
      .filter((sourceId) => (
        sourceId === "moel-policy-news"
        || sourceId === "moel-press-releases"
        || sourceId === "seoul-commercial"
      ))
      .map(async (sourceId) => {
        previousSourceCatalogs.set(sourceId, await readPublicSourceCatalog(sourceId));
      }));
    stage = "provider_collect";
    const collected = await collectPublicData(previousPayload, {
      sourceIds: selectedIds,
      resolvedKeys,
      previousSourceItems: previousSourceCatalogs,
      backfill: {
        checkpoints,
        stagedItems,
        // One latest page plus at most four historical pages stays well below
        // every startup/DART source reservation and makes cursor progress
        // visible without monopolizing a scheduler tick.
        maxBackfillPagesPerRun: 4,
        commitPage: commitPublicBackfillPage,
        readCommittedItems: readPublicBackfillStagedItems,
      },
    });
    for (const catalog of collected.sourceCatalogs) {
      stage = "catalog_prepare";
      let items = catalog.items;
      const fullSnapshot = catalog.sourceId === "seoul-commercial";
      if (!fullSnapshot && !catalog.completeGeneration
        && (catalog.status !== "live" || catalog.incremental)) {
        const previousCatalog = previousSourceCatalogs.get(catalog.sourceId)
          ?? await readPublicSourceCatalog(catalog.sourceId);
        items = [...new Map(
          [...previousCatalog, ...items].map((item) => [item.id, item]),
        ).values()];
      }
      // A complete provider generation is authoritative, but it may include
      // decades of expired rows. Keep a bounded archive for every generation;
      // the default viewer still shows active rows only.
      const offeredItems = prunePublicInformationArchive(items, Date.now());
      const retainedItems = boundPublicCatalogItems(
        offeredItems,
        SOURCE_CATALOG_MAX_ITEMS,
      );
      const sourceResult = collected.sourceResults.find((source) => (
        source.id === catalog.sourceId
      ));
      if (sourceResult) {
        const projected = projectCatalogRetentionCoverage(
          sourceResult,
          SOURCE_CATALOG_MAX_ITEMS,
          offeredItems.length,
          retainedItems.length,
        );
        Object.assign(sourceResult, projected);
        const payloadSource = collected.payload.sources.find((source) => (
          source.id === catalog.sourceId
        ));
        if (payloadSource) {
          Object.assign(payloadSource, projectCatalogRetentionCoverage(
            payloadSource,
            SOURCE_CATALOG_MAX_ITEMS,
            offeredItems.length,
            retainedItems.length,
          ));
        }
        if (projected.status === "truncated") collected.status = "partial";
      }
      stage = "catalog_save";
      await savePublicSourceCatalog(
        catalog.sourceId,
        retainedItems,
        Date.now(),
      );
    }
    if (selectedIds.includes("youth-center")) {
      stage = "legacy_save";
      const youthItems = collected.payload.categories
        .find((group) => group.id === "youth")
        ?.items.filter((item) => item.id.startsWith("youth-center-")) ?? [];
      await saveYouthPolicyCatalog(
        boundPublicCatalogItems(youthItems, YOUTH_CATALOG_MAX_ITEMS),
        Date.now(),
      );
    }
    stage = "snapshot_prepare";
    const snapshotPayload = snapshotPayloadWithYouthPreview(collected.payload);
    // Validate and size-check the exact D1 wire format before source
    // reservations are released as successful. The write serializes again so
    // it remains the sole mutation boundary.
    serializePublicDataPayload(snapshotPayload);
    const resultBySource = new Map(collected.sourceResults.map((result) => [result.id, result]));
    const completedAt = Date.now();
    let exchangeBackfillIncomplete = false;
    let exchangeBackfillFailureKind: "authorization" | "quota" | "transient" | null = null;

    if (selectedIds.includes("exchange")
      && resultBySource.get("exchange")?.status === "live") {
      stage = "history_save";
      const exchangeResult = resultBySource.get("exchange")!;
      let historyError: string | null = null;
      try {
        await saveExchangeHistory(collected.payload.exchange, completedAt);
        const backfill = await backfillExchangeHistory({
          apiKey: resolvedKeys.KOREA_EXIM_API_KEY ?? null,
          latestObservedDate: collected.payload.exchange.asOf,
          capturedAt: completedAt,
        });
        collected.requestCounts.exchange = (collected.requestCounts.exchange ?? 0)
          + backfill.requestCount;
        historyError = backfill.errorCode;
        exchangeBackfillIncomplete = !backfill.completed && !backfill.errorCode;
        if (backfill.failureKind) {
          exchangeBackfillFailureKind = backfill.failureKind;
          exchangeResult.failureKind = backfill.failureKind;
        }
      } catch {
        historyError = "exchange_backfill_persistence_failed";
        exchangeBackfillFailureKind = "transient";
      }
      if (historyError) {
        exchangeResult.status = "partial";
        exchangeResult.errorCode = historyError;
        const payloadSource = collected.payload.sources.find((source) => source.id === "exchange");
        if (payloadSource) {
          payloadSource.status = "partial";
          payloadSource.errorCode = historyError;
        }
      } else if (exchangeBackfillIncomplete) {
        exchangeResult.status = "partial";
        exchangeResult.errorCode = "exchange_backfill_incomplete";
      }
    }

    stage = "source_complete";
    for (const [sourceId, reservation] of reserved) {
      const result = resultBySource.get(sourceId);
      const catalogBackfillIncomplete = isPublicCatalogBackfillInProgress(result?.errorCode);
      const terminalFailure = result?.failureKind === "authorization"
        || result?.failureKind === "quota";
      const successful = (
        result?.status === "live"
        || result?.status === "partial"
        || result?.status === "truncated"
      ) && !terminalFailure
        && !(sourceId === "exchange" && exchangeBackfillFailureKind);
      const failureKind = result?.failureKind
        ?? (result?.status === "authorization-pending" ? "authorization" : "transient");
      const backoffUntil = successful
        ? 0
        : failureKind === "quota"
          ? nextKstQuotaDayStart(completedAt)
          : completedAt + sourceFailureBackoffMs(
            sourceId,
            reservation.state.consecutiveFailures,
            failureKind,
          );
      const nextDueAt = successful
        ? sourceId === "exchange" && exchangeBackfillIncomplete
          ? completedAt + EXCHANGE_BACKFILL_REFRESH_MS
          : catalogBackfillIncomplete
            ? completedAt + PUBLIC_CATALOG_BACKFILL_REFRESH_MS
            : nextPolicyDueAt(reservation.policy, completedAt, completedAt)
        : backoffUntil;
      const completed = await completePublicSourceRun({
        sourceId,
        reservedCalls: reservation.policy.estimatedCalls,
        actualCalls: collected.requestCounts[sourceId as PublicDataSourceId] ?? 0,
        now: completedAt,
        nextDueAt,
        successful,
        backoffUntil,
        errorCode: successful
          ? result?.status === "live" && !result.errorCode
            ? null
            : `warning_${result?.errorCode ?? result?.status ?? "partial"}`
          : `source_${result?.errorCode ?? result?.status ?? "unavailable"}`,
      });
      if (!completed) throw new Error("public_source_completion_conflict");
      completedSourceRuns.set(sourceId, { successful, completedAt });
    }

    states = await readPublicSourceStates();
    const schedules = sourceSchedules(states, user, completedAt);
    const nextRefreshAt = earliestScheduleAt(schedules, completedAt + UNCONFIGURED_RECHECK_MS);
    if (collected.liveSourceCount > 0) {
      stage = "snapshot_save";
      const saved = await savePublicSnapshot({
        payload: snapshotPayload,
        status: collected.status,
        now: completedAt,
        nextRefreshAt,
        leaseUntil,
      });
      if (!saved) throw new Error("public_snapshot_save_conflict");
      row = await readPublicSnapshot();
      return { kind: "refreshed" as const, dashboard: await dashboardFrom(row, user, completedAt, states) };
    }

    const failed = await failPublicRefresh({
      now: completedAt,
      nextRefreshAt,
      errorCode: "no_enabled_or_available_source",
      leaseUntil,
      attemptedPayload: snapshotPayload,
    });
    if (!failed) throw new Error("public_snapshot_fail_conflict");
    row = await readPublicSnapshot();
    return { kind: "unavailable" as const, dashboard: await dashboardFrom(row, user, completedAt, states) };
  } catch (error) {
    const failedAt = Date.now();
    const failureCode = publicRefreshFailureCode(stage, error);
    const snapshotRecoveries: Array<{
      sourceId: string;
      previousLastSuccessAt: number | null;
      expectedLastSuccessAt: number;
      nextDueAt: number;
    }> = [];
    for (const [sourceId, reservation] of reserved) {
      const completed = completedSourceRuns.get(sourceId);
      if (completed?.successful) {
        snapshotRecoveries.push({
          sourceId,
          previousLastSuccessAt: reservation.state.lastSuccessAt,
          expectedLastSuccessAt: completed.completedAt,
          nextDueAt: failedAt + UNCONFIGURED_RECHECK_MS,
        });
        continue;
      }
      if (completed) continue;
      const backoffUntil = failedAt + failureBackoffMs(
        reservation.state.consecutiveFailures,
        "transient",
      );
      await completePublicSourceRun({
        sourceId,
        reservedCalls: reservation.policy.estimatedCalls,
        // The failure can happen after an upstream request but before its
        // response is accounted for. Charging the full reservation avoids a
        // retry from exceeding the provider's real daily quota.
        actualCalls: reservation.policy.estimatedCalls,
        now: failedAt,
        nextDueAt: backoffUntil,
        successful: false,
        backoffUntil,
        errorCode: failureCode,
      }).catch(() => undefined);
    }
    if (snapshotRecoveries.length) {
      await recoverPublicSourcesAfterSnapshotFailure(snapshotRecoveries, failedAt)
        .catch(() => undefined);
    }
    await failPublicRefresh({
      now: failedAt,
      nextRefreshAt: failedAt + UNCONFIGURED_RECHECK_MS,
      errorCode: failureCode,
      leaseUntil,
    }).catch(() => undefined);
    return { kind: "unavailable" as const, dashboard: await currentDashboard(user, failedAt).catch(() => dashboardFrom(row, user, failedAt)) };
  }
}

export async function markPublicCategoryRead(
  user: StoredAuthUser,
  category: string,
  seenThrough: string,
) {
  if (!PUBLIC_CATEGORIES.includes(category as PublicInformationCategory)) {
    throw new Error("unsupported_category");
  }
  const parsedSeenThrough = Date.parse(seenThrough);
  if (!Number.isFinite(parsedSeenThrough)) throw new Error("invalid_seen_through");
  await markCategorySeen(
    user.id,
    category as PublicInformationCategory,
    Math.min(parsedSeenThrough, Date.now()),
  );
}
