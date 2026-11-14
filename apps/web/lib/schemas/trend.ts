import { z } from "zod";

import { geometrySchema, nullableNumber } from "./common";

// Mirrors POST /trend in packages/shared-schemas/trend.ts and apps/api/app/main.py.
// SHOULD fields are nullable: the UI must hide them when null (never render placeholder zeros).

export const directionSchema = z.enum(["increasing", "decreasing", "no_significant_trend"]);
export type Direction = z.infer<typeof directionSchema>;

export const gradeSchema = z.enum(["A", "B", "C", "D"]);
export type Grade = z.infer<typeof gradeSchema>;

const zp = z.object({ z: z.number(), p: z.number() });

export const periodSchema = z.object({
  start: z.string(),
  end: z.string(),
  n_months: z.number().int(),
  coverage: z.number(),
});

export const seriesSchema = z.object({
  time: z.array(z.string()),
  raw: z.array(nullableNumber),
  anomaly: z.array(nullableNumber),
  trend_line: z.array(nullableNumber),
  ci_low: z.array(nullableNumber),
  ci_high: z.array(nullableNumber),
});
export type Series = z.infer<typeof seriesSchema>;

export const trendSchema = z.object({
  direction: directionSchema,
  sen_slope_per_decade: z.number(),
  ci95_per_decade: z.tuple([z.number(), z.number()]),
  percent_of_mean_per_decade: nullableNumber,
});

export const testsSchema = z.object({
  mann_kendall: z.object({ tau: z.number(), z: z.number(), p: z.number() }),
  modified_mk: z.object({ z: z.number(), p: z.number(), correction_factor: z.number() }),
  seasonal_mk: zp.nullable(),
  annual_mk: zp.nullable(),
  ols: z.object({ slope_per_decade: z.number(), t: z.number(), p: z.number() }),
  alpha: z.number(),
  tests_agree: z.boolean(),
});

export const changePointSchema = z
  .object({
    detected: z.boolean(),
    date: z.string().nullable(),
    slope_before: nullableNumber,
    slope_after: nullableNumber,
    p: nullableNumber,
  })
  .nullable();

export const significanceHorizonSchema = z
  .object({
    needed: z.boolean(),
    years_estimate: nullableNumber,
    assumptions: z.string(),
  })
  .nullable();

export const evidenceGradeSchema = z.object({
  grade: gradeSchema,
  label: z.string().optional(), // sent by the API, not in the written contract
  reasons: z.array(z.string()),
});

export const dataQualitySchema = z
  .object({
    // Contract says gaps[]; the running API sends a count. Accept both.
    gaps: z.union([z.number(), z.array(z.unknown())]),
    notices: z.array(z.string()),
  })
  .nullable();

/** The statistics core: also the `result` inside each opposite-trend cluster. */
export const analysisCoreSchema = z.object({
  period: periodSchema,
  series: seriesSchema,
  trend: trendSchema,
  tests: testsSchema,
  autocorrelation: z.object({ lag1: z.number(), effective_n: z.number() }),
  change_point: changePointSchema,
  significance_horizon: significanceHorizonSchema,
  evidence_grade: evidenceGradeSchema,
  data_quality: dataQualitySchema,
});
export type AnalysisCore = z.infer<typeof analysisCoreSchema>;

export const verdictSchema = z.object({
  what: z.string(),
  where: z.string(),
  how_much: z.string(),
  significant: z.string(),
});
export type Verdict = z.infer<typeof verdictSchema>;

export const trendResultSchema = analysisCoreSchema.extend({
  run_id: z.string(),
  _warning: z.string().optional(), // present only on SYNTHETIC fixtures
  variable: z.object({
    id: z.string(),
    name: z.string(),
    units: z.string(),
    kind: z.enum(["measurement", "model"]),
  }),
  region: z.object({
    name: z.string(),
    geometry: geometrySchema,
    area_km2: z.number().optional(), // in the contract, not yet sent by the API
  }),
  provenance: z.object({
    datasets: z.array(z.record(z.string(), z.unknown())),
    steps: z.array(z.string()),
    code_version: z.string(),
    created_at: z.string(),
  }),
  verdict: verdictSchema,
});
export type TrendResult = z.infer<typeof trendResultSchema>;

export const trendRequestSchema = z.object({
  variable_id: z.string(),
  region_id: z.string().nullable(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(), // [west, south, east, north]
  start: z.string().nullable(),
  end: z.string().nullable(),
  alpha: z.number(),
});
export type TrendRequest = z.infer<typeof trendRequestSchema>;

export const pointRequestSchema = z.object({
  variable_id: z.string(),
  region_id: z.string(), // which cached grid to sample, e.g. "west_africa"
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type PointRequest = z.infer<typeof pointRequestSchema>;
