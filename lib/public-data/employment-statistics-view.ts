import type { PublicEmploymentGroup, PublicInformationItem } from "./types";

export interface EmploymentMetricOption {
  key: string;
  name: string;
  unit: string;
  availableGroups: number;
}

export interface EmploymentChartDatum {
  group: PublicEmploymentGroup;
  groupLabel: string;
  period: string;
  value: number;
  unit: string;
  tableId: string;
  itemId: string;
}

const GROUP_ORDER: PublicEmploymentGroup[] = ["youth", "older-adult", "foreigner"];
const PREFERRED_METRICS = ["고용률", "실업률", "취업자"];
const FIXED_EMPLOYMENT_TABLES = new Set([
  "DT_1DE9046S",
  "DT_1DE8031S",
  "DT_2FA002F",
]);

function fixedMetricUnit(name: string) {
  if (name === "취업자") return "천명";
  if (name === "고용률" || name === "실업률") return "%";
  return null;
}

/**
 * Repairs previously cached rows written before per-item units were enforced.
 * Values are untouched; only the unit for a fixed, verified table/item pair is
 * normalized. A later source refresh persists the same corrected shape.
 */
export function normalizeEmploymentStatisticItem(
  item: PublicInformationItem,
): PublicInformationItem {
  const statistic = item.employmentStatistic;
  if (!statistic || !FIXED_EMPLOYMENT_TABLES.has(statistic.tableId)) return item;
  let changed = false;
  const metrics = statistic.metrics.map((metric) => {
    const fixedUnit = fixedMetricUnit(metric.name);
    if (!fixedUnit || fixedUnit === metric.unit) return metric;
    changed = true;
    return { ...metric, unit: fixedUnit };
  });
  return changed
    ? { ...item, employmentStatistic: { ...statistic, metrics } }
    : item;
}

export function employmentMetricKey(name: string, unit: string) {
  return `${name.trim()}\u0000${unit.trim()}`;
}

export function buildEmploymentMetricOptions(items: PublicInformationItem[]): EmploymentMetricOption[] {
  const options = new Map<string, {
    key: string;
    name: string;
    unit: string;
    groups: Set<PublicEmploymentGroup>;
  }>();

  for (const item of items) {
    const statistic = item.employmentStatistic;
    if (!statistic) continue;
    for (const metric of statistic.metrics) {
      const name = metric.name.trim();
      const unit = metric.unit.trim();
      if (!name || !unit || !Number.isFinite(metric.value)) continue;
      const key = employmentMetricKey(name, unit);
      const previous = options.get(key);
      options.set(key, {
        key,
        name,
        unit,
        groups: new Set([...(previous?.groups ?? []), statistic.group]),
      });
    }
  }

  return [...options.values()].map(({ groups, ...option }) => ({
    ...option,
    availableGroups: groups.size,
  })).sort((left, right) => {
    const leftPreferred = PREFERRED_METRICS.indexOf(left.name);
    const rightPreferred = PREFERRED_METRICS.indexOf(right.name);
    if (leftPreferred !== rightPreferred) {
      if (leftPreferred < 0) return 1;
      if (rightPreferred < 0) return -1;
      return leftPreferred - rightPreferred;
    }
    return left.name.localeCompare(right.name, "ko") || left.unit.localeCompare(right.unit, "ko");
  });
}

export function buildEmploymentChartData(
  items: PublicInformationItem[],
  selectedKey: string,
): EmploymentChartDatum[] {
  const rowsByGroup = new Map<PublicEmploymentGroup, EmploymentChartDatum>();

  for (const item of items) {
    const statistic = item.employmentStatistic;
    if (!statistic) continue;
    const metric = statistic.metrics.find((candidate) => (
      employmentMetricKey(candidate.name, candidate.unit) === selectedKey
      && Number.isFinite(candidate.value)
    ));
    if (!metric) continue;
    const row = {
      group: statistic.group,
      groupLabel: statistic.groupLabel,
      period: statistic.period,
      value: metric.value,
      unit: metric.unit.trim(),
      tableId: statistic.tableId,
      itemId: item.id,
    };
    const previous = rowsByGroup.get(statistic.group);
    const nextPeriod = row.period.replace(/[^0-9]/gu, "");
    const previousPeriod = previous?.period.replace(/[^0-9]/gu, "") ?? "";
    if (
      !previous
      || nextPeriod.localeCompare(previousPeriod) > 0
      || (nextPeriod === previousPeriod && row.itemId.localeCompare(previous.itemId) > 0)
    ) {
      rowsByGroup.set(statistic.group, row);
    }
  }

  return [...rowsByGroup.values()]
    .sort((left, right) => GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group));
}
