"use client";

import { BarChart3, Table2 } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/async-state";
import { CHART, escapeHtml, type ChartOption } from "@/components/charts/echarts";
import { useEChart } from "@/components/charts/use-echart";
import { Button } from "@/components/ui/button";
import { useOppositeTrends } from "@/lib/api/hooks";
import {
  decimalsFor,
  formatMonth,
  formatNumber,
  formatP,
  formatPercent,
  formatSigned,
  formatUnits,
} from "@/lib/format";
import { prefersReducedMotion } from "@/lib/motion";
import { polarityFor } from "@/lib/polarity";
import { MAP_REGION } from "@/lib/region";
import type { OppositeCluster, Variable } from "@/lib/schemas";

function option(rising: OppositeCluster, falling: OppositeCluster, variable: Variable): ChartOption {
  const pol = polarityFor(variable.palette_polarity);
  const units = formatUnits(variable.units);
  const time = rising.result.series.time;
  const d = decimalsFor([...rising.result.series.anomaly, ...falling.result.series.anomaly]);
  const line = (name: string, data: (number | null)[], color: string, width: number, dashed = false) => ({
    name,
    type: "line" as const,
    data,
    showSymbol: false,
    lineStyle: { color, width, type: dashed ? ("dashed" as const) : ("solid" as const), opacity: width < 2 ? 0.55 : 1 },
    itemStyle: { color },
  });
  return {
    animation: !prefersReducedMotion(),
    backgroundColor: "transparent",
    textStyle: { color: CHART.text, fontSize: 14 },
    aria: { enabled: true },
    legend: { top: 0, textStyle: { color: CHART.text, fontSize: 14 } },
    tooltip: {
      trigger: "axis",
      backgroundColor: CHART.tooltipBg,
      borderColor: CHART.axis,
      textStyle: { color: CHART.text },
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const i = first?.dataIndex ?? 0;
        const v = (x: number | null | undefined) =>
          x == null ? "–" : `${formatNumber(x, d)}${units ? ` ${units}` : ""}`;
        return [
          `<strong>${escapeHtml(formatMonth(time[i] ?? ""))}</strong>`,
          `${escapeHtml(pol.upWord)} area: <strong>${escapeHtml(v(rising.result.series.anomaly[i]))}</strong>`,
          `${escapeHtml(pol.downWord)} area: <strong>${escapeHtml(v(falling.result.series.anomaly[i]))}</strong>`,
        ].join("<br/>");
      },
    },
    grid: { left: 64, right: 24, top: 48, bottom: 40 },
    xAxis: {
      type: "category",
      data: time,
      boundaryGap: false,
      axisLabel: {
        color: CHART.text,
        interval: (_: number, v: string) => v.endsWith("-01") && Number(v.slice(0, 4)) % 5 === 0,
        formatter: (v: string) => v.slice(0, 4),
      },
      axisLine: { lineStyle: { color: CHART.axis } },
    },
    yAxis: {
      type: "value",
      scale: true,
      name: `Anomaly${units ? ` (${units})` : ""}`,
      nameTextStyle: { color: CHART.text, align: "left" },
      axisLabel: { color: CHART.text },
      splitLine: { lineStyle: { color: CHART.grid } },
    },
    series: [
      line(`Area ${pol.upWord}`, rising.result.series.anomaly, pol.upColor, 1.2),
      line(`Area ${pol.downWord}`, falling.result.series.anomaly, pol.downColor, 1.2),
      line(`Trend, ${pol.upWord} area`, rising.result.series.trend_line, pol.upColor, 4),
      line(`Trend, ${pol.downWord} area`, falling.result.series.trend_line, pol.downColor, 4, true),
    ],
  };
}

function ClusterSummary({ c, word, units }: { c: OppositeCluster; word: string; units: string }) {
  const t = c.result.trend;
  const d = decimalsFor([t.sen_slope_per_decade, ...t.ci95_per_decade]);
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <p className="font-semibold capitalize">Area {word}</p>
      <p className="tabular text-2xl font-bold">
        {formatSigned(t.sen_slope_per_decade, d)}
        {units ? ` ${units}` : ""} <span className="text-base font-normal text-muted-foreground">per decade</span>
      </p>
      <p className="tabular text-muted-foreground">
        95% range {formatSigned(t.ci95_per_decade[0], d)} to {formatSigned(t.ci95_per_decade[1], d)} · grade{" "}
        {c.result.evidence_grade.grade} · p {formatP(c.result.tests.modified_mk.p)} · {c.cells} grid cells
      </p>
    </div>
  );
}

function TwoRegionChart({
  rising,
  falling,
  variable,
}: {
  rising: OppositeCluster;
  falling: OppositeCluster;
  variable: Variable;
}) {
  const opt = useMemo(() => option(rising, falling, variable), [rising, falling, variable]);
  const ref = useEChart(opt);
  return (
    <div
      ref={ref}
      role="img"
      aria-label="Rising and falling areas over time"
      style={{ height: 380 }}
      className="w-full"
    />
  );
}

/** TaleOfTwoRegions: the same variable rising in one cluster and falling in another. */
export function TaleOfTwoRegions({ variable }: { variable: Variable }) {
  const q = useOppositeTrends(variable.id, MAP_REGION);
  const [asTable, setAsTable] = useState(false);
  const pol = polarityFor(variable.palette_polarity);
  const units = formatUnits(variable.units);

  if (q.isPending) return <LoadingState label="Looking for opposite trends…" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { rising, falling } = q.data.clusters;
  if (!q.data.found || !rising || !falling) {
    return <EmptyState title="No opposite trends found">{q.data.sentence}</EmptyState>;
  }
  const s = rising.result.series;
  const d = decimalsFor([...s.anomaly, ...falling.result.series.anomaly]);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xl">{q.data.sentence}</p>
      <p className="text-muted-foreground">
        Across West Africa, {formatPercent(q.data.rising_share)} of the significant area is {pol.upWord} and{" "}
        {formatPercent(q.data.falling_share)} is {pol.downWord}. One regional average would hide this.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <ClusterSummary c={rising} word={pol.upWord} units={units} />
        <ClusterSummary c={falling} word={pol.downWord} units={units} />
      </div>
      <div className="flex justify-end">
        <Button variant="outline" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />} {asTable ? "Show as chart" : "Show as table"}
        </Button>
      </div>
      {asTable ? (
        <div className="max-h-96 overflow-auto rounded-lg border border-border" tabIndex={0}>
          <table className="tabular w-full text-left">
            <caption className="sr-only">Monthly anomalies of the rising and falling areas</caption>
            <thead className="sticky top-0 bg-card">
              <tr>
                <th scope="col" className="px-3 py-2">
                  Month
                </th>
                <th scope="col" className="px-3 py-2 text-right capitalize">
                  {pol.upWord} area
                </th>
                <th scope="col" className="px-3 py-2 text-right capitalize">
                  {pol.downWord} area
                </th>
              </tr>
            </thead>
            <tbody>
              {s.time.map((t, i) => (
                <tr key={t} className="border-t border-border/50">
                  <th scope="row" className="px-3 py-1 font-normal">
                    {formatMonth(t)}
                  </th>
                  <td className="px-3 py-1 text-right">
                    {s.anomaly[i] == null ? "–" : formatNumber(s.anomaly[i]!, d)}
                  </td>
                  <td className="px-3 py-1 text-right">
                    {falling.result.series.anomaly[i] == null
                      ? "–"
                      : formatNumber(falling.result.series.anomaly[i]!, d)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <TwoRegionChart rising={rising} falling={falling} variable={variable} />
      )}
    </div>
  );
}
