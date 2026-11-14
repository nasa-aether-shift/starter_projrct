// Find the trend-map cell under a lon/lat (grid of cell centres, regular spacing). Lookup only:
// the values returned are the API's own numbers.

import type { TrendMap } from "@/lib/schemas";

export interface MapCell {
  lat: number;
  lon: number;
  slope: number;
  p: number | null;
  significant: boolean;
}

function nearestIndex(axis: number[], v: number): number | null {
  if (axis.length === 0) return null;
  const step = axis.length > 1 ? axis[1]! - axis[0]! : 1;
  const i = Math.round((v - axis[0]!) / step);
  if (i < 0 || i >= axis.length) return null;
  return Math.abs(axis[i]! - v) <= Math.abs(step) / 2 + 1e-9 ? i : null;
}

export function cellAt(map: TrendMap, lon: number, lat: number): MapCell | null {
  const i = nearestIndex(map.grid.lat, lat);
  const j = nearestIndex(map.grid.lon, lon);
  if (i === null || j === null) return null;
  const slope = map.slope_per_decade[i]?.[j];
  if (slope === null || slope === undefined) return null;
  return {
    lat: map.grid.lat[i]!,
    lon: map.grid.lon[j]!,
    slope,
    p: map.p[i]?.[j] ?? null,
    significant: map.fdr_significant[i]?.[j] === 1,
  };
}
