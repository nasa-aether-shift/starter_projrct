"use client";

// Country borders (West Africa) and Ghana's regions from public/geo/boundaries.json
// (Natural Earth 1:10m, public domain; built by scripts/build-boundaries.mjs).

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const ring = z.array(z.tuple([z.number(), z.number()]));
const area = z.object({ name: z.string(), label: z.tuple([z.number(), z.number()]), rings: z.array(ring) });

export const boundariesSchema = z.object({
  source: z.string(),
  focusCountry: z.string(),
  countries: z.array(area.extend({ iso: z.string() })),
  regions: z.array(area.extend({ country: z.string() })),
});
export type Boundaries = z.infer<typeof boundariesSchema>;
export type BoundaryArea = z.infer<typeof area>;

export function useBoundaries() {
  return useQuery({
    queryKey: ["geo", "boundaries"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/geo/boundaries.json", { signal });
      if (!res.ok) throw new Error(`boundaries ${res.status}`);
      return boundariesSchema.parse(await res.json());
    },
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

function inRing(lon: number, lat: number, r: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!;
    const [xj, yj] = r[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd test over all rings (handles islands and holes). */
function contains(a: BoundaryArea, lon: number, lat: number): boolean {
  let inside = false;
  for (const r of a.rings) if (inRing(lon, lat, r)) inside = !inside;
  return inside;
}

export interface Place {
  country: string | null;
  region: string | null;
}

export function locate(b: Boundaries, lon: number, lat: number): Place {
  const country = b.countries.find((c) => contains(c, lon, lat)) ?? null;
  const region =
    country && country.iso === b.focusCountry ? (b.regions.find((r) => contains(r, lon, lat)) ?? null) : null;
  return { country: country?.name ?? null, region: region?.name ?? null };
}
