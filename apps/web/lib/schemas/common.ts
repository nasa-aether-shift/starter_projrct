import { z } from "zod";

/** A number the API may send as null (gaps, NaN cleaned to null). */
export const nullableNumber = z.number().nullable();

/** GeoJSON geometry, validated loosely (type + coordinates) and typed as GeoJSON.Geometry. */
export const geometrySchema = z.custom<GeoJSON.Geometry>(
  (v) =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as { type?: unknown }).type === "string" &&
    ("coordinates" in v || "geometries" in v),
  { message: "Invalid GeoJSON geometry" },
);

/** RFC 7807-style problem object, as specified in the API contract. */
export const problemSchema = z.object({
  type: z.string().optional(),
  title: z.string(),
  detail: z.string().optional(),
});
export type Problem = z.infer<typeof problemSchema>;
