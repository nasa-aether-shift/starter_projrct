import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ScopeStatement } from "@/components/scope-statement";

export const metadata: Metadata = {
  title: "Method",
  description: "How Earth Data Detective decides whether a place is really changing: tests, formulas, validation.",
};

// Content mirrors packages/stats_engine (core.py, grade.py, grade_thresholds.yaml, tests/test_validation.py).

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-border py-10">
      <h2 id={id} className="text-2xl font-bold sm:text-3xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Formula({ children }: { children: ReactNode }) {
  return (
    <p className="overflow-x-auto rounded-lg bg-muted/60 px-4 py-3 font-mono text-base whitespace-nowrap">{children}</p>
  );
}

const STEPS = [
  ["Clean", "Remove fill values and quality-masked pixels; convert units (for example kelvin to °C)."],
  ["Average", "Latitude-weighted mean over the region, one value per month."],
  ["Remove seasons", "Subtract each calendar month's long-term mean, leaving monthly anomalies."],
  ["Measure", "Theil-Sen slope with a 95% interval: the “how much”."],
  ["Test", "Mann-Kendall (original, autocorrelation-corrected, seasonal, annual) and an OLS cross-check."],
  ["Check for jumps", "Pettitt change-point test on what the trend line cannot explain."],
  ["Grade", "Combine the results into an evidence grade A–D with the reasons shown."],
] as const;

const GRADES = [
  [
    "A",
    "Strong evidence",
    "Corrected Mann-Kendall p < 0.01, at least 20 years, at least 90% of months present, annual and seasonal tests agree in direction with p < 0.05, and no abrupt shift mid-record.",
  ],
  [
    "B",
    "Moderate evidence",
    "p < 0.05, at least 15 years, at least 80% of months present, and annual means point the same way.",
  ],
  [
    "C",
    "Suggestive only",
    "p < 0.10, or p < 0.05 but held back (short record, missing months, or annual means disagree). The reason is listed.",
  ],
  [
    "D",
    "No significant trend",
    "Everything else. The tool says the change is not clearly established and estimates how many more years might be needed.",
  ],
] as const;

const VALIDATION = [
  "Agreement with the independent pymannkendall library on 50 seeded series (S statistic, p-values, Sen slope, Hamed-Rao p-value).",
  "A known slope is recovered within 5%.",
  "On pure noise the test flags a trend 3.5–6.5% of the time, matching the 5% significance level.",
  "With strong month-to-month memory (AR(1) = 0.5) the corrected test stays much closer to 5% false alarms than the original.",
  "On a map with no real trends, false-discovery control keeps the share of dotted cells below its level.",
  "Two planted opposite-trend blobs are recovered (overlap ≥ 80%).",
  "Grade boundaries behave exactly as the rubric says.",
  "The output matches the API contract, and records that are too short are refused.",
  "Flipping the data flips the slope; scaling the data scales it.",
  "A steady trend is not mistaken for a change-point; a sudden step is detected.",
] as const;

const REFERENCES = [
  "Mann, H. B. (1945). Nonparametric tests against trend. Econometrica, 13(3), 245–259.",
  "Kendall, M. G. (1975). Rank Correlation Methods (4th ed.). Charles Griffin.",
  "Sen, P. K. (1968). Estimates of the regression coefficient based on Kendall's tau. JASA, 63(324), 1379–1389.",
  "Hamed, K. H., & Rao, A. R. (1998). A modified Mann-Kendall trend test for autocorrelated data. Journal of Hydrology, 204, 182–196.",
  "Hirsch, R. M., Slack, J. R., & Smith, R. A. (1982). Techniques of trend analysis for monthly water quality data. Water Resources Research, 18(1), 107–121.",
  "Pettitt, A. N. (1979). A non-parametric approach to the change-point problem. Applied Statistics, 28(2), 126–135.",
  "Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate. JRSS B, 57(1), 289–300.",
  "Wilks, D. S. (2016). “The stippling shows statistically significant grid points”. BAMS, 97(12), 2263–2273.",
  "Gelaro, R., et al. (2017). The Modern-Era Retrospective Analysis for Research and Applications, Version 2 (MERRA-2). Journal of Climate, 30, 5419–5454.",
] as const;

export default function MethodPage() {
  return (
    <article className="mx-auto flex w-full max-w-4xl flex-col px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-4 pb-8">
        <p className="text-sm font-semibold tracking-[0.2em] text-primary uppercase">Method</p>
        <h1 className="text-4xl font-bold sm:text-5xl">How we decide if a place is really changing</h1>
        <p className="text-xl text-muted-foreground">
          Every verdict comes from the same transparent pipeline. The numbers are computed by our statistics engine;
          nothing on screen is invented or rounded beyond display.
        </p>
        <ScopeStatement />
      </header>

      <Section id="pipeline" title="The pipeline">
        <ol className="flex flex-col gap-3">
          {STEPS.map(([name, text], i) => (
            <li key={name} className="flex gap-4">
              <span className="tabular flex size-8 shrink-0 items-center justify-center rounded-full border border-primary font-semibold text-primary">
                {i + 1}
              </span>
              <p>
                <strong>{name}.</strong> {text}
              </p>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="formulas" title="Tests and formulas">
        <h3 className="text-xl font-semibold">Season-removed anomaly</h3>
        <Formula>x′(t) = x(t) − mean of all values in the same calendar month</Formula>
        <h3 className="text-xl font-semibold">Theil-Sen slope (how much)</h3>
        <Formula>β = median over all i &lt; j of (x_j − x_i) / (t_j − t_i)</Formula>
        <p className="text-muted-foreground">
          Shown per decade. The median ignores unusual months, unlike a least-squares line.
        </p>
        <h3 className="text-xl font-semibold">Mann-Kendall (is it real?)</h3>
        <Formula>S = Σ_(i&lt;j) sign(x_j − x_i), Var(S) = n(n − 1)(2n + 5) / 18, Z = (S − sign S) / √Var(S)</Formula>
        <p className="text-muted-foreground">Ties are corrected for. Two-sided p-value from the normal distribution.</p>
        <h3 className="text-xl font-semibold">Hamed-Rao correction (month-to-month memory)</h3>
        <Formula>Var*(S) = Var(S) · [1 + 2 / (n(n−1)(n−2)) · Σ_k (n−k)(n−k−1)(n−k−2) ρ_k]</Formula>
        <p className="text-muted-foreground">
          ρ_k are significant autocorrelations of the ranks. Without this, similar neighbouring months make a trend look
          more certain than it is. The corrected p-value drives the grade.
        </p>
        <h3 className="text-xl font-semibold">Seasonal and annual checks</h3>
        <Formula>S_seasonal = Σ_(m=1..12) S_m, Var = Σ_m Var(S_m); annual test on yearly means (≥ 10 months)</Formula>
        <h3 className="text-xl font-semibold">Pettitt change-point</h3>
        <Formula>U_t = Σ_(i≤t) Σ_(j&gt;t) sign(x_j − x_i), K = max |U_t|, p ≈ 2 exp(−6K² / (n³ + n²))</Formula>
        <p className="text-muted-foreground">
          Run on the residuals from the Sen line, so a steady trend is not mistaken for a sudden jump.
        </p>
        <h3 className="text-xl font-semibold">Maps: false-discovery control</h3>
        <Formula>sort p-values; dot every cell up to the largest k with p_(k) ≤ (k / m) · q, q = 0.10</Formula>
        <p className="text-muted-foreground">
          Each map cell is tested on annual means (Sen slope + Mann-Kendall). Benjamini-Hochberg keeps the share of
          false dots in check when thousands of cells are tested at once (Wilks 2016).
        </p>
        <h3 className="text-xl font-semibold">Years to significance</h3>
        <p>
          For grades C and D we simulate the current trend plus realistic year-to-year noise (AR(1)) and count how many
          more years it would take to be detected most of the time. It is an estimate, not a forecast.
        </p>
      </Section>

      <Section id="grades" title="Evidence grades">
        <dl className="flex flex-col gap-4">
          {GRADES.map(([g, label, rule]) => (
            <div key={g} className="flex gap-4 rounded-xl border border-border bg-panel p-4">
              <dt className="flex size-12 shrink-0 items-center justify-center rounded-lg border-2 border-primary text-2xl font-bold">
                {g}
              </dt>
              <dd>
                <p className="font-semibold">{label}</p>
                <p className="text-muted-foreground">{rule}</p>
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground">
          Records shorter than 8 years are refused; under 15 years carry a warning.
        </p>
      </Section>

      <Section id="validation" title="Validation">
        <p>
          The statistics engine ships with an automated validation suite (64 checks, all passing) run on synthetic data
          with known answers:
        </p>
        <ol className="flex list-decimal flex-col gap-2 pl-6">
          {VALIDATION.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ol>
      </Section>

      <Section id="data" title="Data">
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>
            <strong>Air temperature</strong>: MERRA-2 reanalysis (NASA GMAO), 2 m temperature, monthly. A model
            estimate, not a direct measurement.
          </li>
          <li>
            <strong>Rainfall</strong>: GPM IMERG monthly (NASA GES DISC), from June 2000.
          </li>
          <li>
            <strong>Vegetation greenness</strong>: MODIS Terra NDVI monthly (NASA LP DAAC), from February 2000.
            Saturates over dense forest.
          </li>
          <li>
            <strong>Globe imagery</strong>: NASA GIBS (Blue Marble, Black Marble) and Sentinel-2 cloudless 2024 by EOX
            (Copernicus data) when zoomed in. Imagery only; no statistics are computed from it.
          </li>
        </ul>
        <p className="text-muted-foreground">
          The demo reads precomputed results; it never calls NASA data services live. Exact dataset versions are shown
          in each analysis under “Method &amp; provenance”.
        </p>
      </Section>

      <Section id="references" title="References">
        <ol className="flex list-decimal flex-col gap-2 pl-6 text-muted-foreground">
          {REFERENCES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      </Section>
    </article>
  );
}
