import { decimalsFor, formatMonth, formatNumber, formatUnits } from "@/lib/format";
import type { TrendResult } from "@/lib/schemas";

/** Table fallback for TimeSeriesChart: the same API values, no chart needed. */
export function SeriesTable({ result }: { result: TrendResult }) {
  const s = result.series;
  const units = formatUnits(result.variable.units);
  const dRaw = decimalsFor(s.raw);
  const dAnom = decimalsFor(s.anomaly);
  const cell = (v: number | null, d: number) => (v === null ? "–" : formatNumber(v, d));
  const head = units ? ` (${units})` : "";

  return (
    <div className="max-h-[30rem] overflow-auto rounded-lg border border-border" tabIndex={0}>
      <table className="tabular w-full text-left">
        <caption className="sr-only">
          Monthly values for {result.variable.name}, {result.region.name}
        </caption>
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2">
              Month
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Monthly value{head}
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Anomaly{head}
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Trend line{head}
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              95% range{head}
            </th>
          </tr>
        </thead>
        <tbody>
          {s.time.map((t, i) => (
            <tr key={t} className="border-b border-border/50 odd:bg-muted/30">
              <th scope="row" className="px-3 py-1.5 font-normal">
                {formatMonth(t)}
              </th>
              <td className="px-3 py-1.5 text-right">{cell(s.raw[i] ?? null, dRaw)}</td>
              <td className="px-3 py-1.5 text-right">{cell(s.anomaly[i] ?? null, dAnom)}</td>
              <td className="px-3 py-1.5 text-right">{cell(s.trend_line[i] ?? null, dAnom)}</td>
              <td className="px-3 py-1.5 text-right">
                {cell(s.ci_low[i] ?? null, dAnom)} to {cell(s.ci_high[i] ?? null, dAnom)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
