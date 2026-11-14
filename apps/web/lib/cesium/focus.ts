// Visual focus on the place of interest, plus demarcation of the preset analysis areas.

import type { Entity } from "cesium";

import { prefersReducedMotion } from "@/lib/motion";
import type { BBox } from "@/lib/region";
import type { RegionPreset } from "@/lib/schemas";

import type { GlobeHandle } from "./create-globe";

const FOCUS = "#7dd3fc"; // matches the chart anomaly colour / primary
const YOU = "#4f8dff"; // "you are here": the familiar map-app blue, distinct from the selection colour

export type FocusTarget =
  | { kind: "point"; lon: number; lat: number; label: string; tone?: "focus" | "you" }
  | { kind: "area"; ring: [number, number][]; label: string };

export function bboxRing([w, s, e, n]: BBox): [number, number][] {
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}

/** Outer ring of a GeoJSON Polygon / MultiPolygon as [lon, lat] pairs. */
export function geometryRing(g: GeoJSON.Geometry): [number, number][] | null {
  if (g.type === "Polygon") return g.coordinates[0]?.map(([x, y]) => [x!, y!] as [number, number]) ?? null;
  if (g.type === "MultiPolygon") return g.coordinates[0]?.[0]?.map(([x, y]) => [x!, y!] as [number, number]) ?? null;
  return null;
}

function labelGraphics(Cesium: GlobeHandle["Cesium"], text: string, offsetY: number) {
  return {
    text,
    font: "600 17px Geist, system-ui, sans-serif",
    fillColor: Cesium.Color.WHITE,
    showBackground: true,
    backgroundColor: Cesium.Color.fromCssColorString("rgba(8,12,24,0.78)"),
    backgroundPadding: new Cesium.Cartesian2(10, 6),
    pixelOffset: new Cesium.Cartesian2(0, offsetY),
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}

/**
 * Highlights the selected point (pulsing ring + pin + label) or area (glowing outline, light fill,
 * label). Returns a remover.
 */
export function showFocus(globe: GlobeHandle, focus: FocusTarget): () => void {
  const { Cesium, viewer } = globe;
  const accent = Cesium.Color.fromCssColorString(focus.kind === "point" && focus.tone === "you" ? YOU : FOCUS);
  const entities: Entity[] = [];
  const cleanups: (() => void)[] = [];
  const still = prefersReducedMotion();

  if (focus.kind === "point") {
    const pos = Cesium.Cartesian3.fromDegrees(focus.lon, focus.lat);
    const start = performance.now();
    const phase = () => (still ? 0.5 : ((performance.now() - start) / 1600) % 1);
    // One radius per frame, shared by both axes: Cesium throws (and stops rendering) if the two
    // callbacks ever disagree and semiMinor > semiMajor. Scales with camera height to read at any zoom.
    let r = 1000;
    let alpha = 0.45;
    const removeTick = viewer.scene.preRender.addEventListener(() => {
      const k = phase();
      r = Math.min(250_000, Math.max(400, viewer.camera.positionCartographic.height * 0.06)) * (0.6 + 0.8 * k);
      alpha = 0.45 * (1 - k);
    });
    cleanups.push(removeTick);
    const radius = () => r;
    entities.push(
      viewer.entities.add({
        position: pos,
        ellipse: {
          semiMajorAxis: new Cesium.CallbackProperty(radius, false),
          semiMinorAxis: new Cesium.CallbackProperty(radius, false),
          material: new Cesium.ColorMaterialProperty(new Cesium.CallbackProperty(() => accent.withAlpha(alpha), false)),
          outline: false,
          height: 0,
        },
      }),
      viewer.entities.add({
        position: pos,
        point: {
          pixelSize: 14,
          color: accent,
          outlineColor: Cesium.Color.fromCssColorString("#0b1020"),
          outlineWidth: 3,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        // "You are here" sits below its pin so it never collides with place labels above.
        label:
          focus.tone === "you"
            ? { ...labelGraphics(Cesium, focus.label, 16), verticalOrigin: Cesium.VerticalOrigin.TOP }
            : labelGraphics(Cesium, focus.label, -16),
      }),
    );
  } else {
    const flat = focus.ring.flat();
    const lons = focus.ring.map((p) => p[0]);
    const lats = focus.ring.map((p) => p[1]);
    const centre = Cesium.Cartesian3.fromDegrees((Math.min(...lons) + Math.max(...lons)) / 2, Math.max(...lats));
    entities.push(
      viewer.entities.add({
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(flat),
          material: accent.withAlpha(0.1),
          height: 0,
        },
      }),
      viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(flat),
          width: 7,
          material: new Cesium.PolylineGlowMaterialProperty({ color: accent, glowPower: 0.25 }),
          clampToGround: true,
        },
      }),
      viewer.entities.add({ position: centre, label: labelGraphics(Cesium, focus.label, -8) }),
    );
  }

  return () => {
    for (const c of cleanups) c();
    if (viewer.isDestroyed()) return;
    for (const e of entities) viewer.entities.remove(e);
  };
}

/** Max camera height at which each preset's dashed outline + name are drawn. */
const PRESET_VISIBLE_BELOW: Record<string, number> = { kumasi: 900_000, ashanti: 2_500_000 };

/**
 * Demarcates the preset analysis areas (dashed outline + name), so viewers can see exactly which
 * area a verdict averages over. Only nearby presets are drawn; they appear as you zoom in.
 */
export function showPresetOutlines(globe: GlobeHandle, presets: RegionPreset[]): () => void {
  const { Cesium, viewer } = globe;
  const entities: Entity[] = [];
  for (const f of presets) {
    const maxH = PRESET_VISIBLE_BELOW[f.properties.id];
    const ring = maxH ? geometryRing(f.geometry) : null;
    if (!maxH || !ring) continue;
    const show = new Cesium.DistanceDisplayCondition(0, maxH);
    const lons = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    entities.push(
      viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()),
          width: 2.5,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.WHITE.withAlpha(0.85),
            gapColor: Cesium.Color.BLACK.withAlpha(0.35),
            dashLength: 14,
          }),
          clampToGround: true,
          distanceDisplayCondition: show,
        },
      }),
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(Math.min(...lons), Math.max(...lats)),
        label: {
          text: `${f.properties.name} · analysis area`,
          font: "500 14px Geist, system-ui, sans-serif",
          fillColor: Cesium.Color.WHITE.withAlpha(0.92),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString("rgba(8,12,24,0.6)"),
          backgroundPadding: new Cesium.Cartesian2(7, 4),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -4),
          distanceDisplayCondition: show,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
  }
  return () => {
    if (viewer.isDestroyed()) return;
    for (const e of entities) viewer.entities.remove(e);
  };
}
