// Modular ECharts 6 setup: register only what we use.
import { LineChart, type LineSeriesOption } from "echarts/charts";
import {
  AriaComponent,
  AxisPointerComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  type AriaComponentOption,
  type DataZoomComponentOption,
  type GridComponentOption,
  type LegendComponentOption,
  type MarkLineComponentOption,
  type TooltipComponentOption,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  MarkLineComponent,
  AxisPointerComponent,
  AriaComponent,
  CanvasRenderer,
]);

export type ChartOption = echarts.ComposeOption<
  | LineSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | DataZoomComponentOption
  | MarkLineComponentOption
  | AriaComponentOption
>;

export { echarts };

/** Hex palette for charts (ECharts manipulates colours, so no oklch here). Matches the dark theme. */
export const CHART = {
  text: "#c9cfda",
  muted: "#8b93a3",
  grid: "rgba(255,255,255,0.08)",
  axis: "rgba(255,255,255,0.25)",
  raw: "#8b93a3",
  anomaly: "#7dd3fc",
  changePoint: "#f0b429",
  tooltipBg: "#151b2b",
} as const;

export const escapeHtml = (s: string) => echarts.format.encodeHTML(s);
