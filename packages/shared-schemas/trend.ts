// TypeScript types for the POST /trend contract (team doc, Section 7).
// FROZEN at kickoff: change only after agreeing in the team chat.
// Later: replace with types generated from the API's OpenAPI document (/openapi.json).

export type Direction = "increasing" | "decreasing" | "no_significant_trend";
export type Grade = "A" | "B" | "C" | "D";

export interface TrendResult {
  run_id: string;
  variable: { id: string; name: string; units: string; kind: "measurement" | "model" };
  region: { name: string; geometry: GeoJSON.Geometry };
  period: { start: string; end: string; n_months: number; coverage: number };
  series: {
    time: string[]; // "YYYY-MM"
    raw: (number | null)[];
    anomaly: (number | null)[];
    trend_line: (number | null)[];
    ci_low: (number | null)[];
    ci_high: (number | null)[];
  };
  trend: {
    direction: Direction;
    sen_slope_per_decade: number;
    ci95_per_decade: [number, number];
    percent_of_mean_per_decade: number | null;
  };
  tests: {
    mann_kendall: { tau: number; z: number; p: number };
    modified_mk: { z: number; p: number; correction_factor: number };
    seasonal_mk: { z: number; p: number } | null;
    annual_mk: { z: number; p: number } | null;
    ols: { slope_per_decade: number; t: number; p: number };
    alpha: number;
    tests_agree: boolean;
  };
  autocorrelation: { lag1: number; effective_n: number };
  change_point: { detected: boolean; date: string | null; slope_before: number | null; slope_after: number | null; p: number | null } | null;
  significance_horizon: { needed: boolean; years_estimate: number | null; assumptions: string } | null;
  evidence_grade: { grade: Grade; label: string; reasons: string[] };
  data_quality: { gaps: number; notices: string[] } | null;
  provenance: { datasets: Record<string, unknown>[]; steps: string[]; code_version: string; created_at: string };
  verdict: { what: string; where: string; how_much: string; significant: string };
}

export interface TrendMap {
  grid: { lat: number[]; lon: number[]; downsample_step: number };
  slope_per_decade: (number | null)[][]; // [lat][lon]
  p: (number | null)[][];
  fdr_significant: (0 | 1)[][];
  fdr_level: number;
  method: string;
  palette_polarity: string; // e.g. "warm_is_red", "wet_is_blue"
  units_per_decade: string;
}

export interface Narrative {
  sentences: TrendResult["verdict"];
  source: "ai" | "template";
}
