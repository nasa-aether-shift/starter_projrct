"use client";

import { MapPin } from "lucide-react";
import { useEffect, useState } from "react";

import { VariableIcon } from "@/components/variable-icon";
import { addBoundaries } from "@/lib/cesium/boundaries";
import { isAlive, type GlobeHandle } from "@/lib/cesium/create-globe";
import { onGlobeHover, type HoverInfo } from "@/lib/cesium/interaction";
import type { DivergingScale } from "@/lib/colors";
import { decimalsFor, formatP, formatSigned, formatUnits } from "@/lib/format";
import { locate, type Boundaries } from "@/lib/geo/boundaries";
import { cellAt } from "@/lib/map-lookup";
import type { TrendMap } from "@/lib/schemas";
import { variableMeta } from "@/lib/variable-meta";

/** Draws country borders, the focus country and its regions on the globe. */
export function useBoundaryLayer(globe: GlobeHandle | null, boundaries: Boundaries | undefined) {
  useEffect(() => {
    if (!isAlive(globe) || !boundaries) return;
    return addBoundaries(globe, boundaries);
  }, [globe, boundaries]);
}

const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;
const TIP_W = 288;
const TIP_H = 170;

/**
 * Hover readout: place name (country, and region inside Ghana) and the trend-map value under the
 * pointer, straight from the map payload. Render inside the same positioned box as the globe canvas.
 */
export function GlobeHoverTooltip({
  globe,
  map,
  scale,
  variableId,
  boundaries,
}: {
  globe: GlobeHandle | null;
  map: TrendMap | undefined;
  scale: DivergingScale | null;
  variableId: string;
  boundaries: Boundaries | undefined;
}) {
  const [hover, setHover] = useState<HoverInfo | null>(null);

  useEffect(() => {
    if (!isAlive(globe)) return;
    return onGlobeHover(globe, setHover);
  }, [globe]);

  if (!hover || !isAlive(globe)) return null;

  const place = boundaries ? locate(boundaries, hover.lon, hover.lat) : null;
  const cell = map ? cellAt(map, hover.lon, hover.lat) : null;
  const meta = variableMeta(variableId);
  const units = map ? formatUnits(map.units_per_decade.replace(/ per decade$/, "")) : "";
  const placeName = place?.region
    ? `${place.region} Region, ${place.country}`
    : (place?.country ?? (cell ? "West Africa" : "Open ocean"));

  // Keep the card on screen: flip left/up near the canvas edges.
  const canvas = globe.viewer.canvas;
  const left = hover.x + 18 + TIP_W > canvas.clientWidth ? hover.x - 18 - TIP_W : hover.x + 18;
  const top = hover.y + 18 + TIP_H > canvas.clientHeight ? hover.y - 18 - TIP_H : hover.y + 18;

  return (
    <div
      aria-hidden // supplemental: the legend's table and the click-to-analyse flow carry the same data
      className="pointer-events-none absolute z-20 rounded-xl border border-white/10 bg-black/75 p-3 text-white shadow-[0_10px_30px_rgba(0,0,0,0.5)] backdrop-blur-md"
      style={{ left, top, width: TIP_W }}
    >
      <p className="flex items-start gap-1.5 text-sm font-semibold">
        <MapPin className="mt-0.5 size-3.5 shrink-0 text-white/70" /> {placeName}
      </p>
      <p className="tabular pl-5 text-xs text-white/60">
        {coord(hover.lat, "N", "S")}, {coord(hover.lon, "E", "W")}
      </p>

      <div className="mt-2.5 border-t border-white/10 pt-2.5">
        {cell && scale ? (
          <>
            <p className="flex items-center gap-2 text-xs text-white/70">
              <VariableIcon id={variableId} size="sm" />
              {meta.short} trend in this cell
            </p>
            <p className="mt-1.5 flex items-center gap-2">
              <span
                className="inline-block size-4 shrink-0 rounded border border-white/40"
                style={{ background: scale.color(cell.slope) }}
              />
              <span className="tabular text-xl font-bold">
                {formatSigned(cell.slope, decimalsFor([cell.slope, scale.maxAbs]))}
                {units ? ` ${units}` : ""}
              </span>
              <span className="text-sm text-white/70">/ decade</span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-white/80">
              <span
                className={`inline-block size-2 rounded-full ${cell.significant ? "bg-white" : "border border-white/60"}`}
              />
              {cell.significant ? "Significant after FDR control" : "Not significant"}
              {cell.p !== null ? ` · p ${formatP(cell.p)}` : ""}
            </p>
          </>
        ) : (
          <p className="text-xs text-white/70">No trend data here. The map covers West Africa.</p>
        )}
      </div>
    </div>
  );
}
