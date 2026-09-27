"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, CalendarDays } from "lucide-react";
import type {
  PublicEmploymentGroup,
  PublicInformationItem,
} from "@/lib/public-data/types";
import {
  buildEmploymentChartData,
  buildEmploymentMetricOptions,
} from "@/lib/public-data/employment-statistics-view";
import type { PublicInformationLocale } from "./public-information-layout";
import styles from "./employment-statistics-chart.module.css";

const localeTags: Record<PublicInformationLocale, string> = {
  ko: "ko-KR",
  en: "en-US",
  ja: "ja-JP",
  zh: "zh-CN",
};

const colors = ["#6652c2", "#8a71d5", "#b09ae5"];

const copy = {
  ko: {
    eyebrow: "SELECT & COMPARE",
    title: "지표를 선택해 그래프로 비교",
    lead: "KOSIS에서 실제 수집한 최신 값만 사용하며, 서로 다른 단위는 한 그래프에 섞지 않습니다.",
    metric: "통계 지표",
    groups: "확인 가능 집단",
    empty: "선택한 지표로 표시할 실제 통계가 0건입니다.",
    value: "공식 값",
    period: "조사 기준",
    table: "KOSIS 표",
    caution: "집단별 조사 시점과 모집단이 다르므로 이 그래프는 각 집단의 현황 확인용입니다. 순위나 우열로 해석하지 마세요.",
  },
  en: {
    eyebrow: "SELECT & COMPARE",
    title: "Choose a metric to compare",
    lead: "Only the latest values actually collected from KOSIS are used, and different units are never mixed.",
    metric: "Metric",
    groups: "available groups",
    empty: "There are 0 actual records for this metric.",
    value: "Official value",
    period: "Reference period",
    table: "KOSIS table",
    caution: "Survey populations and periods differ by group. Use this chart to review each group, not to rank them.",
  },
  ja: {
    eyebrow: "SELECT & COMPARE",
    title: "指標を選んでグラフで比較",
    lead: "KOSISから実際に収集した最新値のみを使用し、異なる単位は同じグラフに混在させません。",
    metric: "統計指標",
    groups: "確認可能な対象",
    empty: "選択した指標の実データは0件です。",
    value: "公式値",
    period: "基準時点",
    table: "KOSIS表",
    caution: "対象別に調査時点と母集団が異なります。順位ではなく各対象の現況確認に使用してください。",
  },
  zh: {
    eyebrow: "SELECT & COMPARE",
    title: "选择指标并用图表比较",
    lead: "仅使用从KOSIS实际采集的最新值，不会把不同单位混在同一图表中。",
    metric: "统计指标",
    groups: "可查看群体",
    empty: "所选指标的实际统计记录为0条。",
    value: "官方数值",
    period: "统计基准",
    table: "KOSIS表",
    caution: "各群体的调查时期和总体不同。本图仅用于查看现状，请勿解释为排名或优劣。",
  },
} satisfies Record<PublicInformationLocale, Record<string, string>>;

function formatValue(value: number, locale: PublicInformationLocale) {
  return value.toLocaleString(localeTags[locale], { maximumFractionDigits: 2 });
}

const metricLabels: Record<string, Record<PublicInformationLocale, string>> = {
  고용률: { ko: "고용률", en: "Employment rate", ja: "就業率", zh: "就业率" },
  실업률: { ko: "실업률", en: "Unemployment rate", ja: "失業率", zh: "失业率" },
  취업자: { ko: "취업자", en: "Employed persons", ja: "就業者", zh: "就业人数" },
};

const groupLabels: Record<PublicEmploymentGroup, Record<PublicInformationLocale, string>> = {
  youth: { ko: "청년", en: "Youth", ja: "若者", zh: "青年" },
  "older-adult": { ko: "고령층", en: "Older adults", ja: "高齢者", zh: "老年人" },
  foreigner: { ko: "외국인", en: "Foreign residents", ja: "外国人", zh: "外国人" },
};

function localizedMetric(name: string, locale: PublicInformationLocale) {
  return metricLabels[name]?.[locale] ?? name;
}

function localizedUnit(unit: string, locale: PublicInformationLocale) {
  if (unit === "천명") {
    return { ko: "천명", en: "thousand people", ja: "千人", zh: "千人" }[locale];
  }
  return unit;
}

export function EmploymentStatisticsChart({
  items,
  locale,
}: {
  items: PublicInformationItem[];
  locale: PublicInformationLocale;
}) {
  const t = copy[locale];
  const options = useMemo(() => buildEmploymentMetricOptions(items), [items]);
  const [requestedKey, setRequestedKey] = useState("");
  const selected = options.find((option) => option.key === requestedKey) ?? options[0] ?? null;
  const chartData = useMemo(
    () => selected ? buildEmploymentChartData(items, selected.key) : [],
    [items, selected],
  );
  const selectedName = selected ? localizedMetric(selected.name, locale) : "";
  const selectedUnit = selected ? localizedUnit(selected.unit, locale) : "";
  const localizedChartData = chartData.map((row) => ({
    ...row,
    localizedGroupLabel: groupLabels[row.group][locale] ?? row.groupLabel,
  }));

  return <section className={styles.panel} aria-labelledby="employment-chart-title">
    <header>
      <div>
        <span>{t.eyebrow}</span>
        <h3 id="employment-chart-title">{t.title}</h3>
        <p>{t.lead}</p>
      </div>
      <BarChart3 aria-hidden="true" size={24} />
    </header>
    {options.length > 0 && <fieldset className={styles.metricSelector}>
      <legend>{t.metric}</legend>
      <div>
        {options.map((option) => <button
          key={option.key}
          type="button"
          aria-pressed={option.key === selected?.key}
          onClick={() => setRequestedKey(option.key)}
        >
          <strong>{localizedMetric(option.name, locale)}</strong>
          <small>{localizedUnit(option.unit, locale)} · {option.availableGroups} {t.groups}</small>
        </button>)}
      </div>
    </fieldset>}
    {!selected || chartData.length === 0
      ? <div className={styles.empty}><BarChart3 size={26} /><p>{t.empty}</p><strong>0</strong></div>
      : <>
        <div
          className={styles.chart}
          role="img"
          aria-label={`${selectedName}, ${selectedUnit}, ${localizedChartData.map((row) => `${row.localizedGroupLabel} ${formatValue(row.value, locale)}`).join(", ")}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={localizedChartData} margin={{ top: 28, right: 12, bottom: 5, left: 0 }}>
              <CartesianGrid vertical={false} stroke="#ece7f5" />
              <XAxis dataKey="localizedGroupLabel" tickLine={false} axisLine={false} tick={{ fill: "#6f6878", fontSize: 12 }} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                tick={{ fill: "#80788a", fontSize: 11 }}
                tickFormatter={(value) => formatValue(Number(value), locale)}
              />
              <Tooltip
                cursor={{ fill: "#f5f1fd" }}
                formatter={(value) => [`${formatValue(Number(value), locale)} ${selectedUnit}`, t.value]}
                labelFormatter={(label) => String(label)}
                contentStyle={{ border: "1px solid #ded7f1", borderRadius: 12, boxShadow: "0 12px 28px rgba(58,39,110,.13)" }}
              />
              <Bar dataKey="value" radius={[10, 10, 3, 3]} maxBarSize={86}>
                {chartData.map((row, index) => <Cell key={row.itemId} fill={colors[index % colors.length]} />)}
                <LabelList
                  dataKey="value"
                  position="top"
                  formatter={(value: unknown) => `${formatValue(Number(value), locale)} ${selectedUnit}`}
                  fill="#504267"
                  fontSize={11}
                  fontWeight={800}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={styles.evidenceGrid} aria-label={`${selectedName} ${t.value}`}>
          {localizedChartData.map((row) => <article key={row.itemId}>
            <strong>{row.localizedGroupLabel}</strong>
            <span>{formatValue(row.value, locale)} {selectedUnit}</span>
            <small><CalendarDays size={12} />{t.period} {row.period}</small>
            <code>{t.table} {row.tableId}</code>
          </article>)}
        </div>
      </>}
    <p className={styles.caution}>{t.caution}</p>
  </section>;
}
