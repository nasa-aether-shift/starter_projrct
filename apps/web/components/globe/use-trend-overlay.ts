"use client";

import { useEffect, useMemo } from "react";

import { isAlive, type GlobeHandle } from "@/lib/cesium/create-globe";
import { addTrendOverlay } from "@/lib/cesium/overlay";
import { divergingScale, robustMaxAbs, visibilityRamp, type DivergingScale } from "@/lib/colors";
import type { TrendMap } from "@/lib/schemas";

/** Paints `map` on the globe (when both exist) and returns the colour scale for the legend. */
export function useTrendOverlay(globe: GlobeHandle | null, map: TrendMap | undefined): DivergingScale | null {
  const scale = useMemo(
    () =>
      map
        ? divergingScale(map.palette_polarity, robustMaxAbs(map.slope_per_decade), visibilityRamp(map.slope_per_decade))
        : null,
    [map],
  );
  useEffect(() => {
    if (!isAlive(globe) || !map || !scale) return;
    return addTrendOverlay(globe, map, scale);
  }, [globe, map, scale]);
  return scale;
}
