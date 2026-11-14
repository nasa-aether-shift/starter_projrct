import { z } from "zod";

import { geometrySchema } from "./common";

// GET /variables and /variables/{id}: data/catalog/*.yaml served as JSON.

const localized = z.object({ en: z.string(), tw: z.string().optional() });

export const variableSchema = z.object({
  id: z.string(),
  name: localized,
  definition: z.object({
    kid: localized,
    student: localized,
    scientist: localized.optional(),
  }),
  units: z.string(),
  source: z.object({
    collection: z.string(),
    version: z.string(),
    variable: z.string(),
    provider: z.string(),
  }),
  resolution: z.object({ spatial_deg: z.union([z.string(), z.number()]), temporal: z.string() }).optional(),
  coverage: z.object({ start: z.string(), end: z.string() }).optional(),
  palette_polarity: z.string(),
  synonyms: z.array(z.string()).default([]),
  typical_questions: z.array(z.string()).default([]),
  caveats: z.array(z.string()).default([]),
  recommended_min_years: z.number().optional(),
  model_or_measurement: z.enum(["model", "measurement"]),
});
export type Variable = z.infer<typeof variableSchema>;
export const variablesSchema = z.array(variableSchema);

// GET /regions/presets: GeoJSON FeatureCollection.
export const regionPresetSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.string(),
    center: z.tuple([z.number(), z.number()]).optional(), // [lon, lat]
  }),
  geometry: geometrySchema,
});
export type RegionPreset = z.infer<typeof regionPresetSchema>;

export const regionPresetsSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(regionPresetSchema),
});

// GET /health
export const healthSchema = z.object({
  status: z.string(),
  code_version: z.string(),
  cached_results: z.array(z.string()),
  using_fixtures: z.boolean(),
});
export type Health = z.infer<typeof healthSchema>;
