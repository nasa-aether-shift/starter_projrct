"use client";

import { BarChart3, Table2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { decimalsFor, formatMonth, formatNumber, formatUnits } from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import { NEUTRAL, directionStyle, polarityFor } from "@/lib/polarity";
import type { TrendResult } from "@/lib/schemas";

import { CHART, escapeHtml, type ChartOption } from "./echarts";
import { SeriesTable } from "./series-table";
import { useEChart } from "./use-echart";

export interface TimeSeriesChartProps {
  result: TrendResult;
  palettePolarity?: string;
  height?: number;
}

function buildOption(result: TrendResult, palettePolarity: string | undefined): ChartOption {
  const { series, change_point: cp, trend } = result;
  const units = formatUnits(result.variable.units);
  const unitSuffix = units ? ` ${units}` : "";
  const trendColor =
    trend.direction === "no_significant_trend"
      ? NEUTRAL
      : directionStyle(trend.direction, polarityFor(palettePolarity)).color;
  const dRaw = decimalsFor(series.raw);
  const dAnom = decimalsFor(series.anomaly);
  // Band drawn as a stacked area: transparent base at ci_low plus (ci_high − ci_low). Geometry only;
  // the tooltip and table always show the API's own ci_low / ci_high values.
  const bandHeight = series.ci_high.map((h, i) => {
    const l = series.ci_low[i];
    return h === null || l === null ? null : h - l;
  });
  const yearTick = (_: number, value: string) => value.endsWith("-01") && Number(value.slice(0, 4)) % 5 === 0;
  const animation = !prefersReducedMotion();

  const fmt = (v: number | null | undefined, d: number) =>
    v === null || v === undefined ? "–" : `${formatNumber(v, d)}${unitSuffix}`;

  return {
    animation,
    backgroundColor: "transparent",
    textStyle: { color: CHART.text, fontSize: 14 },
    aria: { enabled: true },
    legend: {
      top: 0,
      textStyle: { color: CHART.text, fontSize: 14 },
      data: ["Monthly value", "Anomaly", "Trend (Sen)", "95% range"],
    },
    axisPointer: { link: [{ xAxisIndex: "all" }] },
    tooltip: {
      trigger: "axis",
      backgroundColor: CHART.tooltipBg,
      borderColor: CHART.axis,
      textStyle: { color: CHART.text, fontSize: 14 },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const i = first?.dataIndex ?? 0;
        const rows: [string, string][] = [
          ["Monthly value", fmt(series.raw[i], dRaw)],
          ["Anomaly", fmt(series.anomaly[i], dAnom)],
          ["Trend line", fmt(series.trend_line[i], dAnom)],
          ["95% range", `${fmt(series.ci_low[i], dAnom)} to ${fmt(series.ci_high[i], dAnom)}`],
        ];
        return [
          `<strong>${escapeHtml(formatMonth(series.time[i] ?? ""))}</strong>`,
          ...rows.map(([k, v]) => `${escapeHtml(k)}: <strong>${escapeHtml(v)}</strong>`),
        ].join("<br/>");
      },
    },
    grid: [
      { left: 72, right: 24, top: 44, height: "22%" },
      { left: 72, right: 24, top: "38%", bottom: 72 },
    ],
    xAxis: [
      {
        type: "category",
        gridIndex: 0,
        data: series.time,
        boundaryGap: false,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: CHART.axis } },
      },
      {
        type: "category",
        gridIndex: 1,
        data: series.time,
        boundaryGap: false,
        axisLabel: { color: CHART.text, fontSize: 14, interval: yearTick, formatter: (v: string) => v.slice(0, 4) },
        axisTick: { interval: yearTick },
        axisLine: { lineStyle: { color: CHART.axis } },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        scale: true,
        name: `Monthly value${unitSuffix ? ` (${units})` : ""}`,
        nameTextStyle: { color: CHART.muted, align: "left", fontSize: 13 },
        axisLabel: { color: CHART.muted, fontSize: 12 },
        splitLine: { lineStyle: { color: CHART.grid } },
        splitNumber: 2,
      },
      {
        type: "value",
        gridIndex: 1,
        scale: true,
        name: `Season-removed anomaly${unitSuffix ? ` (${units})` : ""}`,
        nameTextStyle: { color: CHART.text, align: "left", fontSize: 14 },
        axisLabel: { color: CHART.text, fontSize: 14 },
        splitLine: { lineStyle: { color: CHART.grid } },
      },
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: [0, 1] },
      {
        type: "slider",
        xAxisIndex: [0, 1],
        bottom: 12,
        height: 26,
        textStyle: { color: CHART.muted },
        borderColor: CHART.axis,
        labelFormatter: (_: number, value: string) => value.slice(0, 4),
      },
    ],
    series: [
      {
        name: "Monthly value",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: series.raw,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1, color: CHART.raw, opacity: 0.7 },
        itemStyle: { color: CHART.raw },
      },
      {
        name: "95% range base",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: series.ci_low,
        stack: "ci",
        showSymbol: false,
        silent: true,
        lineStyle: { opacity: 0 },
        tooltip: { show: false },
      },
      {
        name: "95% range",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: bandHeight,
        stack: "ci",
        showSymbol: false,
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { color: trendColor, opacity: 0.22 },
        itemStyle: { color: trendColor },
      },
      {
        name: "Anomaly",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: series.anomaly,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.6, color: CHART.anomaly },
        itemStyle: { color: CHART.anomaly },
        markLine:
          cp?.detected && cp.date
            ? {
                symbol: "none",
                silent: true,
                lineStyle: { color: CHART.changePoint, type: "dashed", width: 2 },
                label: {
                  color: CHART.changePoint,
                  fontSize: 14,
                  formatter: `Possible shift ${formatMonth(cp.date)}`,
                },
                data: [{ xAxis: cp.date }],
              }
            : undefined,
      },
      {
        name: "Trend (Sen)",
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: series.trend_line,
        showSymbol: false,
        lineStyle: {
          width: 4,
          color: trendColor,
          type: trend.direction === "no_significant_trend" ? "dashed" : "solid",
        },
        itemStyle: { color: trendColor },
        z: 5,
      },
    ],
  };
}

export function TimeSeriesChart({ result, palettePolarity, height = 480 }: TimeSeriesChartProps) {
  const [asTable, setAsTable] = useState(false);
  const option = useMemo(() => buildOption(result, palettePolarity), [result, palettePolarity]);
  const ref = useEChart(option);
  const units = formatUnits(result.variable.units);

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <figcaption className="text-muted-foreground">
          {result.variable.name}, {result.region.name}. Seasons removed so the long-term change is visible
          {units ? `; units ${units}` : ""}.
        </figcaption>
        <Button variant="outline" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
          {asTable ? "Show as chart" : "Show as table"}
        </Button>
      </div>
      <div
        ref={ref}
        role="img"
        aria-label={`Line chart of ${result.variable.name} anomalies with the trend line and its 95% range. Use "Show as table" for the values.`}
        hidden={asTable}
        style={{ height }}
        className="w-full"
      />
      {asTable ? <SeriesTable result={result} /> : null}
    </figure>
  );
}
