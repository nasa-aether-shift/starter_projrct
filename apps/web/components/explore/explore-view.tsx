"use client";

import { Globe2, LocateFixed, MapPin, MousePointerClick, SquareDashed } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Globe } from "@/components/globe/globe";
import { GlobeHoverTooltip, useBoundaryLayer } from "@/components/globe/globe-hover";
import { MapLegend } from "@/components/globe/map-legend";
import { useTrendOverlay } from "@/components/globe/use-trend-overlay";
import {
  MAP_VARIABLES,
  VariableSwitcher,
  isMapVariable,
  type MapVariableId,
} from "@/components/globe/variable-switcher";
import { Button } from "@/components/ui/button";
import { useRegionPresets, useRunTrend, useTrendAtPoint, useTrendMap, useVariable } from "@/lib/api/hooks";
import { flyHome, flyTo, viewForRing, type ViewTarget } from "@/lib/cesium/camera";
import { bboxRing, geometryRing, showFocus, showPresetOutlines, type FocusTarget } from "@/lib/cesium/focus";
import { GHANA_VIEW, KUMASI_VIEW } from "@/lib/cesium/config";
import { isAlive, type GlobeHandle } from "@/lib/cesium/create-globe";
import { onGlobeClick, startBoxDraw } from "@/lib/cesium/interaction";
import { useBoundaries } from "@/lib/geo/boundaries";
import { useUserLocation } from "@/lib/geo/use-user-location";
import { MAP_REGION, formatBox, writeRegion, type BBox, type RegionChoice } from "@/lib/region";

import { ResultsPanel, type PanelState } from "./results-panel";

/** Bounds of the cached West Africa grid (presets.geojson) where /trend-at-point has data. */
const MAP_BOUNDS = { west: -20, east: 20, south: 0, north: 20 } as const;

const PLACES: { id: string; label: string; view: ViewTarget }[] = [
  { id: "kumasi", label: "Kumasi", view: KUMASI_VIEW },
  { id: "ashanti", label: "Ashanti", view: { lon: -1.4, lat: 6.75, height: 250_000 } },
  { id: "west_africa", label: "West Africa", view: { lon: 0, lat: 10, height: 2_500_000, pitchDeg: -60 } },
];

type Selection =
  | { kind: "point"; lon: number; lat: number }
  | { kind: "preset"; id: string; label: string }
  | { kind: "bbox"; bbox: BBox };

/**
 * The results panel covers the right side on wide screens (max 44rem), so flights keep the target
 * centred in the visible area to its left.
 */
function panelOffsetPx(): number {
  if (typeof window === "undefined" || window.innerWidth < 1024) return 0;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return Math.min(44 * rem, window.innerWidth) / 2;
}

/** Regional view used when flying to the visitor. */
const HERE_VIEW = { height: 600_000, pitchDeg: -45 } as const;

const inMap = (lon: number, lat: number) =>
  lon >= MAP_BOUNDS.west && lon <= MAP_BOUNDS.east && lat >= MAP_BOUNDS.south && lat <= MAP_BOUNDS.north;

export function ExploreView() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const variable: MapVariableId = isMapVariable(search.get("variable"))
    ? (search.get("variable") as MapVariableId)
    : "merra2_t2m";

  const [globe, setGlobe] = useState<GlobeHandle | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const point = useTrendAtPoint();
  const trend = useRunTrend();
  const catalog = useVariable(variable);
  const presets = useRegionPresets();
  /** Frame a preset by its real geometry when loaded (fallback: the hand-set view). */
  const placeView = useCallback(
    (p: (typeof PLACES)[number]): ViewTarget => {
      const f = presets.data?.features.find((x) => x.properties.id === p.id);
      const ring = f ? geometryRing(f.geometry) : null;
      return ring ? viewForRing(ring) : p.view;
    },
    [presets.data],
  );
  const map = useTrendMap(variable, MAP_REGION);
  const scale = useTrendOverlay(globe, map.data);
  const boundaries = useBoundaries();
  useBoundaryLayer(globe, boundaries.data);

  const analyse = useCallback(
    (sel: Selection, v: MapVariableId) => {
      setNotice(null);
      if (sel.kind === "point") {
        trend.reset();
        point.mutate({ variable_id: v, region_id: MAP_REGION, lat: sel.lat, lon: sel.lon });
      } else {
        point.reset();
        trend.mutate({
          variable_id: v,
          region_id: sel.kind === "preset" ? sel.id : null,
          bbox: sel.kind === "bbox" ? sel.bbox : null,
          start: null,
          end: null,
          alpha: 0.05,
        });
      }
    },
    // mutate/reset are stable; listing the mutation objects would re-create this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const select = useCallback(
    (sel: Selection) => {
      setSelection(sel);
      analyse(sel, variable);
    },
    [analyse, variable],
  );

  const selectRef = useRef(select);
  useEffect(() => {
    selectRef.current = select;
  }, [select]);

  // First arrival: fly in to Ghana (tilted), no spin while exploring. ?place=kumasi|ashanti|west_africa
  // deep-links straight to a preset (handy for the pitch).
  const initialPlace = useRef(search.get("place"));
  const deepLinked = useRef(Boolean(search.get("place")));
  const flownIn = useRef(false);
  useEffect(() => {
    if (!isAlive(globe) || flownIn.current) return;
    const place = PLACES.find((p) => p.id === initialPlace.current);
    if (place && !presets.data && !presets.isError) return; // wait for geometry to frame the area
    flownIn.current = true;
    globe.setSpin(false);
    if (place) {
      void flyTo(globe, placeView(place), { offsetPx: panelOffsetPx() });
      selectRef.current({ kind: "preset", id: place.id, label: place.label });
    } else {
      void flyTo(globe, GHANA_VIEW);
    }
  }, [globe, presets.data, presets.isError, placeView]);

  // Click on the globe → analyse that grid cell (inside the mapped area only).
  useEffect(() => {
    if (!isAlive(globe) || drawing) return;
    return onGlobeClick(globe, (lon, lat) => {
      if (!inMap(lon, lat)) {
        setNotice("That spot is outside the mapped area (West Africa). Try a point inside the coloured grid.");
        return;
      }
      void flyTo(globe, { lon, lat, height: 30_000, durationS: 2.5 }, { offsetPx: panelOffsetPx() });
      selectRef.current({ kind: "point", lon, lat });
    });
  }, [globe, drawing]);

  // Box draw mode.
  useEffect(() => {
    if (!isAlive(globe) || !drawing) return;
    return startBoxDraw(globe, (bbox) => {
      setDrawing(false);
      void flyTo(globe, viewForRing(bboxRing(bbox)), { offsetPx: panelOffsetPx() });
      selectRef.current({ kind: "bbox", bbox });
    });
  }, [globe, drawing]);

  // Demarcate the preset analysis areas (dashed outlines + names appear as you zoom in).
  useEffect(() => {
    if (!isAlive(globe) || !presets.data) return;
    return showPresetOutlines(globe, presets.data.features);
  }, [globe, presets.data]);

  // Keep the selected place visibly in focus: glowing outline for areas, pulsing pin for points.
  useEffect(() => {
    if (!isAlive(globe) || !selection) return;
    let focus: FocusTarget | null = null;
    if (selection.kind === "point") {
      focus = {
        kind: "point",
        lon: selection.lon,
        lat: selection.lat,
        label: `${selection.lat.toFixed(2)}°, ${selection.lon.toFixed(2)}°`,
      };
    } else if (selection.kind === "bbox") {
      focus = { kind: "area", ring: bboxRing(selection.bbox), label: "Your box" };
    } else {
      const feature = presets.data?.features.find((f) => f.properties.id === selection.id);
      const ring = feature ? geometryRing(feature.geometry) : null;
      if (ring) focus = { kind: "area", ring, label: selection.label };
    }
    return focus ? showFocus(globe, focus) : undefined;
  }, [globe, selection, presets.data]);

  // Visitor location (browser-only): mark it, and fly there on arrival if it is inside the mapped area
  // and nothing else has been chosen yet. Outside the map, keep the data in view and say why.
  const here = useUserLocation();
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
  const locatedOnce = useRef(false);
  useEffect(() => {
    if (!isAlive(globe) || here.status !== "ok") return;
    if (!locatedOnce.current) {
      locatedOnce.current = true;
      if (!inMap(here.lon, here.lat)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time notice when the location arrives
        setNotice(
          "You're outside the mapped area, so the globe stays on West Africa. Tap My location to see where you are.",
        );
      } else if (!deepLinked.current && !selectionRef.current) {
        void flyTo(globe, { lon: here.lon, lat: here.lat, ...HERE_VIEW });
      }
    }
    return showFocus(globe, { kind: "point", lon: here.lon, lat: here.lat, label: "You are here", tone: "you" });
  }, [globe, here]);

  const goToMe = () => {
    if (!isAlive(globe) || here.status !== "ok") return;
    void flyTo(globe, { lon: here.lon, lat: here.lat, ...HERE_VIEW }, { offsetPx: selection ? panelOffsetPx() : 0 });
  };

  const setVariable = (v: MapVariableId) => {
    const params = new URLSearchParams(search.toString());
    params.set("variable", v);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    if (selection) analyse(selection, v);
  };

  const goPlace = (p: (typeof PLACES)[number]) => {
    if (isAlive(globe)) void flyTo(globe, placeView(p), { offsetPx: panelOffsetPx() });
    select({ kind: "preset", id: p.id, label: p.label });
  };

  const backToGlobe = () => {
    setSelection(null);
    setDrawing(false);
    point.reset();
    trend.reset();
    if (isAlive(globe)) void flyHome(globe);
  };

  const active = selection?.kind === "point" ? point : trend;
  const regionChoice: RegionChoice | null =
    selection?.kind === "preset"
      ? { kind: "preset", id: selection.id }
      : selection?.kind === "bbox"
        ? { kind: "bbox", bbox: selection.bbox }
        : null;
  const href = (() => {
    if (!active.data) return null;
    const params = new URLSearchParams({ variable });
    writeRegion(params, regionChoice);
    return `/analysis/${encodeURIComponent(active.data.run_id)}?${params.toString()}`;
  })();
  const panel: PanelState = {
    open: selection !== null,
    title:
      selection?.kind === "point"
        ? `Grid cell near ${selection.lat.toFixed(2)}°, ${selection.lon.toFixed(2)}°`
        : selection?.kind === "preset"
          ? selection.label
          : selection?.kind === "bbox"
            ? `Box ${formatBox(selection.bbox)}`
            : "",
    pending: active.isPending,
    error: active.error,
    result: active.data,
    analysisHref: href,
  };
  const label = MAP_VARIABLES.find((m) => m.id === variable)?.label ?? "";

  return (
    <div className="relative isolate flex min-h-[calc(100dvh-4rem)] flex-1 overflow-hidden bg-black">
      <div className="absolute inset-0 -z-10">
        <Globe spin={false} onReady={setGlobe} />
        <GlobeHoverTooltip
          globe={globe}
          map={map.data}
          scale={scale}
          variableId={variable}
          boundaries={boundaries.data}
        />
      </div>

      <div className="no-print absolute top-4 left-4 z-10 flex max-w-[24rem] flex-col gap-3 sm:top-6 sm:left-6">
        <div className="flex flex-col gap-3 rounded-xl border border-white/15 bg-black/70 p-4 text-white backdrop-blur">
          <h1 className="text-xl font-bold">Explore the globe</h1>
          <VariableSwitcher value={variable} onChange={setVariable} layout="stacked" />
          <p className="flex items-start gap-2 text-sm text-white/80">
            <MousePointerClick aria-hidden className="mt-0.5 size-4 shrink-0" />
            Click anywhere in the coloured grid to test that spot, or pick a place:
          </p>
          <div className="flex flex-wrap gap-2">
            {PLACES.map((p) => (
              <Button key={p.id} variant="secondary" onClick={() => goPlace(p)}>
                <MapPin aria-hidden /> {p.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={drawing ? "default" : "outline"}
              aria-pressed={drawing}
              disabled={!globe}
              onClick={() => setDrawing((d) => !d)}
              className="border-white/30 bg-transparent text-white"
            >
              <SquareDashed aria-hidden /> {drawing ? "Drag on the globe…" : "Draw a box"}
            </Button>
            <Button variant="outline" onClick={backToGlobe} className="border-white/30 bg-transparent text-white">
              <Globe2 aria-hidden /> Back to globe
            </Button>
            {here.status === "ok" ? (
              <Button variant="outline" onClick={goToMe} className="border-white/30 bg-transparent text-white">
                <LocateFixed aria-hidden /> My location
              </Button>
            ) : null}
          </div>
          {notice ? (
            <p role="status" className="rounded-md bg-warning/20 px-3 py-2 text-sm">
              {notice}
            </p>
          ) : null}
        </div>
      </div>

      {map.data && scale ? (
        <div className="no-print absolute bottom-4 left-4 z-10 sm:bottom-6 sm:left-6">
          <MapLegend map={map.data} scale={scale} title={`${label} trend`} variableId={variable} />
        </div>
      ) : null}

      <ResultsPanel
        state={panel}
        variable={catalog.data}
        onClose={() => setSelection(null)}
        onRetry={() => selection && analyse(selection, variable)}
      />
    </div>
  );
}
