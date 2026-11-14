"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Layers } from "lucide-react";
import { useEffect, useState } from "react";

import { useTrendMap } from "@/lib/api/hooks";
import { useBoundaries } from "@/lib/geo/boundaries";
import { flyTo } from "@/lib/cesium/camera";
import { START_VIEW } from "@/lib/cesium/config";
import { isAlive, type GlobeHandle } from "@/lib/cesium/create-globe";
import { showFocus } from "@/lib/cesium/focus";
import { useUserLocation } from "@/lib/geo/use-user-location";
import { MAP_REGION } from "@/lib/region";
import { variableMeta } from "@/lib/variable-meta";

import { Globe } from "./globe";
import { GlobeHoverTooltip, useBoundaryLayer } from "./globe-hover";
import { MapLegend } from "./map-legend";
import { useTrendOverlay } from "./use-trend-overlay";
import { MAP_VARIABLES, VariableSwitcher, type MapVariableId } from "./variable-switcher";

/** Landing hero: spinning Earth with the West Africa trend map, and one "map layer" card (switcher + legend). */
export function LandingGlobe() {
  const [globe, setGlobe] = useState<GlobeHandle | null>(null);
  const [variable, setVariable] = useState<MapVariableId>("merra2_t2m");
  const map = useTrendMap(variable, MAP_REGION);
  const scale = useTrendOverlay(globe, map.data);
  const label = MAP_VARIABLES.find((m) => m.id === variable)?.label ?? "";
  const meta = variableMeta(variable);
  const boundaries = useBoundaries();
  useBoundaryLayer(globe, boundaries.data);

  // Face the visitor: turn the globe to their location (kept in the browser) and mark it.
  const here = useUserLocation();
  useEffect(() => {
    if (!isAlive(globe) || here.status !== "ok") return;
    globe.setSpin(false);
    // Lift the location above the "Map layer" card that sits over the lower part of the globe.
    const lift = globe.viewer.canvas.clientHeight * 0.2;
    void flyTo(
      globe,
      { lon: here.lon, lat: here.lat, height: START_VIEW.height, pitchDeg: -89.5, durationS: 2.5 },
      { offsetYPx: lift },
    );
    return showFocus(globe, { kind: "point", lon: here.lon, lat: here.lat, label: "You are here", tone: "you" });
  }, [globe, here]);

  return (
    <>
      <div className="absolute inset-y-0 right-0 left-0 -z-10 lg:-right-[45%]">
        <Globe onReady={setGlobe} />
        <GlobeHoverTooltip
          globe={globe}
          map={map.data}
          scale={scale}
          variableId={variable}
          boundaries={boundaries.data}
        />
      </div>
      <section
        aria-label="Map layer"
        className="no-print absolute right-4 bottom-4 z-10 flex w-[min(28rem,calc(100%-2rem))] flex-col gap-3 rounded-2xl border border-white/10 bg-black/60 p-4 text-white shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-md sm:right-6 sm:bottom-6"
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.18em] text-white/60 uppercase">
            <Layers aria-hidden className="size-3.5" /> Map layer
          </p>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={variable}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="truncate text-sm text-white/70"
              aria-live="polite"
            >
              {meta.caption}
            </motion.p>
          </AnimatePresence>
        </div>
        <VariableSwitcher
          value={variable}
          onChange={setVariable}
          embedded
          layout="stacked"
          layoutId="landing-variable-pill"
        />
        <div className="h-px bg-white/10" />
        {map.data && scale ? (
          <MapLegend map={map.data} scale={scale} title={`${label} trend`} variableId={variable} embedded />
        ) : map.isError ? (
          <p className="text-sm text-white/70">Trend map unavailable right now.</p>
        ) : (
          <div role="status" className="h-28 animate-pulse rounded-lg bg-white/5">
            <span className="sr-only">Loading the trend map…</span>
          </div>
        )}
      </section>
    </>
  );
}
