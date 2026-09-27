import type { YouthPolicyProfile } from "./auth/youth-policy-profile";
import type { ManualFinanceSnapshot } from "./manual-finance-snapshot";
import { manualFinanceSummary } from "./manual-finance";

export type DailyFinanceGuideTaskId =
  | "finance-review"
  | "profile-setup"
  | "official-updates";

export type DailyFinanceGuideTaskState = "complete" | "attention";

export type DailyFinanceGuideTask = {
  id: DailyFinanceGuideTaskId;
  state: DailyFinanceGuideTaskState;
  reason:
    | "completed-today"
    | "finance-entry-needed"
    | "sign-in-required"
    | "profile-ready"
    | "profile-incomplete"
    | "nothing-unread"
    | "unread-items"
    | "public-data-unavailable";
  count: number;
  updatedAt: number | null;
};

export type DailyFinanceGuide = {
  authenticated: boolean;
  completedCount: number;
  totalCount: number;
  tasks: DailyFinanceGuideTask[];
};

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

function kstDay(value: number) {
  const date = new Date(value + KST_OFFSET_MS);
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}-${date.getUTCDate()}`;
}

function profileIsReady(profile: YouthPolicyProfile | null) {
  return Boolean(
    profile?.enabled
    && profile.birthYear
    && profile.region
    && profile.status
    && profile.interests.length,
  );
}

export function buildDailyFinanceGuide(input: {
  authenticated: boolean;
  snapshot: ManualFinanceSnapshot | null;
  youthPolicyProfile: YouthPolicyProfile | null;
  unreadOfficialItems: number;
  publicDataAvailable: boolean;
  now?: number;
}): DailyFinanceGuide {
  const now = input.now ?? Date.now();
  const financeSummary = input.snapshot
    ? manualFinanceSummary(input.snapshot.amounts)
    : null;
  const financeReviewedToday = Boolean(
    input.authenticated
    && input.snapshot
    && financeSummary
    && financeSummary.completedFields > 0
    && kstDay(input.snapshot.updatedAt) === kstDay(now),
  );
  const profileReady = input.authenticated
    && profileIsReady(input.youthPolicyProfile);
  const officialUpdatesReviewed = input.authenticated
    && input.publicDataAvailable
    && input.unreadOfficialItems === 0;

  const tasks: DailyFinanceGuideTask[] = [
    {
      id: "finance-review",
      state: financeReviewedToday ? "complete" : "attention",
      reason: financeReviewedToday
        ? "completed-today"
        : input.authenticated
          ? "finance-entry-needed"
          : "sign-in-required",
      count: financeSummary?.completedFields ?? 0,
      updatedAt: input.snapshot?.updatedAt ?? null,
    },
    {
      id: "profile-setup",
      state: profileReady ? "complete" : "attention",
      reason: profileReady
        ? "profile-ready"
        : input.authenticated
          ? "profile-incomplete"
          : "sign-in-required",
      count: profileReady ? 1 : 0,
      updatedAt: null,
    },
    {
      id: "official-updates",
      state: officialUpdatesReviewed ? "complete" : "attention",
      reason: !input.authenticated
        ? "sign-in-required"
        : !input.publicDataAvailable
          ? "public-data-unavailable"
          : input.unreadOfficialItems > 0
            ? "unread-items"
            : "nothing-unread",
      count: Math.max(0, Math.trunc(input.unreadOfficialItems)),
      updatedAt: null,
    },
  ];

  return {
    authenticated: input.authenticated,
    completedCount: tasks.filter((task) => task.state === "complete").length,
    totalCount: tasks.length,
    tasks,
  };
}
