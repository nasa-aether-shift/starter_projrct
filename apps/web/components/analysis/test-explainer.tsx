import { formatNumber, formatP } from "@/lib/format";
import type { TrendResult } from "@/lib/schemas";

interface Row {
  test: string;
  stat: string;
  p: string;
  plain: string;
}

/** TestExplainer: every test the API ran, its numbers, and one plain sentence each. */
export function TestExplainer({ result }: { result: TrendResult }) {
  const t = result.tests;
  const f2 = (v: number) => formatNumber(v, 2);
  const rows: Row[] = [
    {
      test: "Mann-Kendall",
      stat: `τ ${f2(t.mann_kendall.tau)}, z ${f2(t.mann_kendall.z)}`,
      p: formatP(t.mann_kendall.p),
      plain:
        "Checks whether values go up (or down) over time more often than chance would allow, without assuming a straight line.",
    },
    {
      test: "Modified Mann-Kendall (Hamed-Rao)",
      stat: `z ${f2(t.modified_mk.z)}, correction × ${f2(t.modified_mk.correction_factor)}`,
      p: formatP(t.modified_mk.p),
      plain:
        "The same test, corrected because each month tends to resemble the last one. This is the p-value used for the grade.",
    },
    ...(t.seasonal_mk
      ? [
          {
            test: "Seasonal Mann-Kendall",
            stat: `z ${f2(t.seasonal_mk.z)}`,
            p: formatP(t.seasonal_mk.p),
            plain:
              "Compares each calendar month only with the same month in other years, so the seasons cannot fake a trend.",
          },
        ]
      : []),
    ...(t.annual_mk
      ? [
          {
            test: "Annual Mann-Kendall",
            stat: `z ${f2(t.annual_mk.z)}`,
            p: formatP(t.annual_mk.p),
            plain: "Runs the test on yearly averages as a cross-check.",
          },
        ]
      : []),
    {
      test: "Ordinary least squares",
      stat: `t ${f2(t.ols.t)}`,
      p: formatP(t.ols.p),
      plain: "Fits an ordinary straight line, as a second opinion on the direction.",
    },
    {
      test: "Theil-Sen slope",
      stat: "median of all pairwise slopes",
      p: "–",
      plain: "Gives the “how much”. Using the median makes it robust to unusual months.",
    },
    ...(result.change_point
      ? [
          {
            test: "Pettitt change-point",
            stat:
              result.change_point.detected && result.change_point.date
                ? `shift at ${result.change_point.date}`
                : "no shift",
            p: result.change_point.p !== null ? formatP(result.change_point.p) : "–",
            plain: "Looks for one sudden jump that a single straight line cannot explain.",
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-left">
          <caption className="sr-only">Statistical tests and what they mean</caption>
          <thead className="bg-muted/50">
            <tr>
              <th scope="col" className="px-3 py-2">
                Test
              </th>
              <th scope="col" className="px-3 py-2">
                Result
              </th>
              <th scope="col" className="px-3 py-2">
                p
              </th>
              <th scope="col" className="px-3 py-2">
                In plain words
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.test} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 font-semibold">
                  {r.test}
                </th>
                <td className="tabular px-3 py-2 whitespace-nowrap">{r.stat}</td>
                <td className="tabular px-3 py-2 whitespace-nowrap">{r.p}</td>
                <td className="px-3 py-2 text-muted-foreground">{r.plain}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground">
        Significance level α = {t.alpha}. Tests {t.tests_agree ? "agree" : "do not all agree"} on direction and
        significance. Lag-1 autocorrelation {formatNumber(result.autocorrelation.lag1, 2)}, so the record behaves like
        about {result.autocorrelation.effective_n} independent months.
      </p>
    </div>
  );
}
