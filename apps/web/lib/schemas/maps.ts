import { z } from "zod";

import { nullableNumber } from "./common";
import { analysisCoreSchema, verdictSchema } from "./trend";

// GET /trend-map/{variable}/{region}: grid as lat[] / lon[] cell centres, arrays indexed [lat][lon].
export const trendMapSchema = z.object({
  grid: z.object({
    lat: z.array(z.number()),
    lon: z.array(z.number()),
    downsample_step: z.number(),
  }),
  slope_per_decade: z.array(z.array(nullableNumber)),
  p: z.array(z.array(nullableNumber)),
  fdr_significant: z.array(z.array(z.union([z.literal(0), z.literal(1)]))),
  fdr_level: z.number(),
  method: z.string(),
  palette_polarity: z.string(), // "warm_is_red" | "wet_is_blue" | "green_is_green" | ...
  units_per_decade: z.string(),
});
export type TrendMap = z.infer<typeof trendMapSchema>;

// GET /opposite-trends/{variable}/{region}
const clusterSchema = z
  .object({
    cells: z.number(),
    mask_indices: z.array(z.tuple([z.number(), z.number()])), // [latIndex, lonIndex]
    result: analysisCoreSchema,
  })
  .nullable();
export type OppositeCluster = NonNullable<z.infer<typeof clusterSchema>>;

export const oppositeTrendsSchema = z.object({
  found: z.boolean(),
  rising_share: z.number(),
  falling_share: z.number(),
  divergence_score: nullableNumber,
  clusters: z.object({ rising: clusterSchema, falling: clusterSchema }),
  sentence: z.string(),
});
export type OppositeTrends = z.infer<typeof oppositeTrendsSchema>;

// POST /narrative
export const narrativeRequestSchema = z.object({
  run_id: z.string(),
  level: z.enum(["kid", "student"]),
  use_ai: z.boolean(),
});
export type NarrativeRequest = z.infer<typeof narrativeRequestSchema>;

export const narrativeSchema = z.object({
  sentences: verdictSchema,
  source: z.enum(["ai", "template"]),
});
export type Narrative = z.infer<typeof narrativeSchema>;
