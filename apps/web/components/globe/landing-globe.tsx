"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Layers } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SpaceIntro } from "@/components/intro/space-intro";
import { useTrendMap } from "@/lib/api/hooks";
import { useBoundaries } from "@/lib/geo/boundaries";
import { flyTo } from "@/lib/cesium/camera";
import { START_VIEW } from "@/lib/cesium/config";
import { isAlive, type GlobeHandle } from "@/lib/cesium/create-globe";
import { showFocus } from "@/lib/cesium/focus";
import { env } from "@/lib/env";
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

  // Space intro (first launch only; SpaceIntro decides): the flight ends on the globe's start view, then fades
  // into it. Starts as "playing" so nothing moves the globe until SpaceIntro has decided.
  const [intro, setIntro] = useState<"playing" | "revealing" | "done">(env.intro ? "playing" : "done");
  const frameRef = useRef<HTMLDivElement>(null);

  // While it plays, hold the globe still on START_VIEW (where the flight ends) and let it load tiles at a low
  // frame rate so the GPU serves the intro.
  useEffect(() => {
    if (!isAlive(globe)) return;
    globe.setSpin(intro === "done");
    globe.setFrameRate(intro === "playing" ? 10 : undefined);
  }, [globe, intro]);

  // Face the visitor: turn the globe to their location (kept in the browser) and mark it. Asked only after the
  // intro, so the permission prompt never interrupts it.
  const here = useUserLocation(intro === "done");
  useEffect(() => {
    // A location remembered from an earlier visit must not move the globe while the intro is landing on it.
    if (!isAlive(globe) || here.status !== "ok" || intro !== "done") return;
    let active = true;
    globe.setSpin(false); // pause during the turn, then keep spinning (the pin rides along with the Earth)
    // Lift the location above the "Map layer" card that sits over the lower part of the globe.
    const lift = globe.viewer.canvas.clientHeight * 0.2;
    void flyTo(
      globe,
      { lon: here.lon, lat: here.lat, height: START_VIEW.height, pitchDeg: -89.5, durationS: 2.5 },
      { offsetYPx: lift },
    ).then(() => {
      if (active && isAlive(globe)) globe.setSpin(true);
    });
    const removeFocus = showFocus(globe, {
      kind: "point",
      lon: here.lon,
      lat: here.lat,
      label: "You are here",
      tone: "you",
      labelOnHover: true,
    });
    return () => {
      active = false;
      removeFocus();
    };
  }, [globe, here, intro]);

  const [cardOpen, setCardOpen] = useState(false); // starts collapsed: the globe gets the stage until asked

  return (
    <>
      {intro !== "done" ? (
        <SpaceIntro frameRef={frameRef} onReveal={() => setIntro("revealing")} onDone={() => setIntro("done")} />
      ) : null}
      <div ref={frameRef} className="absolute inset-y-0 right-0 left-0 -z-10 lg:-right-[45%]">
        <Globe onReady={setGlobe} />
        <GlobeHoverTooltip
          globe={globe}
          map={map.data}
          scale={scale}
          variableId={variable}
          boundaries={boundaries.data}
        />
      </div>
      <AnimatePresence initial={false} mode="wait">
        {cardOpen ? (
          <motion.section
            key="card"
            id="map-layer-card"
            aria-label="Map layer"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2 }}
            className="no-print absolute right-4 bottom-4 z-10 flex w-[min(28rem,calc(100%-2rem))] flex-col gap-3 rounded-2xl border border-white/10 bg-black/60 p-4 text-white shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-md sm:right-6 sm:bottom-6"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="flex shrink-0 items-center gap-2 text-xs font-semibold tracking-[0.18em] text-white/60 uppercase">
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
              <button
                type="button"
                onClick={() => setCardOpen(false)}
                aria-label="Hide map layer panel"
                title="Hide"
                className="-mr-1 grid size-7 shrink-0 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
              >
                <ChevronDown aria-hidden className="size-4" />
              </button>
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
          </motion.section>
        ) : (
          <motion.button
            key="pill"
            type="button"
            onClick={() => setCardOpen(true)}
            aria-label="Show map layer panel"
            aria-controls="map-layer-card"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="no-print absolute right-4 bottom-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs font-semibold tracking-[0.18em] text-white/80 uppercase shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-md transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none sm:right-6 sm:bottom-6"
          >
            <Layers aria-hidden className="size-3.5" /> Map layer
            <ChevronDown aria-hidden className="size-4 rotate-180" />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
}
