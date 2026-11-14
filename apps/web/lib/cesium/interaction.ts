// Globe input: click-to-pick a lat/lon, and a simple drag-a-rectangle draw mode.

import type { Cartesian2, Cartesian3, ScreenSpaceEventHandler } from "cesium";

import { normaliseBox, type BBox } from "@/lib/region";

import type { GlobeHandle } from "./create-globe";

function pickLonLat(globe: GlobeHandle, pos: Cartesian2): [number, number] | null {
  const { Cesium, viewer } = globe;
  const { scene, camera } = viewer;
  let cart: Cartesian3 | undefined;
  const ray = camera.getPickRay(pos);
  if (ray) cart = scene.globe.pick(ray, scene); // respects terrain when present
  cart ??= camera.pickEllipsoid(pos, scene.globe.ellipsoid);
  if (!cart) return null; // clicked on space
  const c = Cesium.Cartographic.fromCartesian(cart);
  return [Cesium.Math.toDegrees(c.longitude), Cesium.Math.toDegrees(c.latitude)];
}

/** Calls `onPick(lon, lat)` on a left click on the globe (ignores drags). Returns a remover. */
export function onGlobeClick(globe: GlobeHandle, onPick: (lon: number, lat: number) => void): () => void {
  const { Cesium, viewer } = globe;
  const handler: ScreenSpaceEventHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((e: { position: Cartesian2 }) => {
    const ll = pickLonLat(globe, e.position);
    if (ll) onPick(ll[0], ll[1]);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  return () => {
    if (!handler.isDestroyed()) handler.destroy();
  };
}

export interface HoverInfo {
  lon: number;
  lat: number;
  /** Canvas pixel position of the pointer. */
  x: number;
  y: number;
}

/** Calls `onHover` with the lon/lat under the pointer (null when over space), at most once per frame. */
export function onGlobeHover(globe: GlobeHandle, onHover: (info: HoverInfo | null) => void): () => void {
  const { Cesium, viewer } = globe;
  const handler: ScreenSpaceEventHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  let pending: Cartesian2 | null = null;
  let raf = 0;
  const flush = () => {
    raf = 0;
    if (!pending || viewer.isDestroyed()) return;
    const ll = pickLonLat(globe, pending);
    onHover(ll ? { lon: ll[0], lat: ll[1], x: pending.x, y: pending.y } : null);
    pending = null;
  };
  handler.setInputAction((e: { endPosition: Cartesian2 }) => {
    pending = Cesium.Cartesian2.clone(e.endPosition);
    if (!raf) raf = requestAnimationFrame(flush);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  const leave = () => onHover(null);
  const canvas = viewer.canvas; // captured: the getter throws once the viewer is destroyed
  canvas.addEventListener("pointerleave", leave);
  return () => {
    cancelAnimationFrame(raf);
    canvas.removeEventListener("pointerleave", leave);
    if (!handler.isDestroyed()) handler.destroy();
  };
}

/**
 * Draw mode: press, drag, release to draw a rectangle. Camera input is paused while drawing.
 * Calls onDone with a capped, normalised bbox. Returns a cancel function that restores everything.
 */
export function startBoxDraw(globe: GlobeHandle, onDone: (bbox: BBox) => void): () => void {
  const { Cesium, viewer } = globe;
  const ctrl = viewer.scene.screenSpaceCameraController;
  ctrl.enableInputs = false;
  globe.setSpin(false);
  let start: [number, number] | null = null;
  let current: BBox | null = null;

  const entity = viewer.entities.add({
    rectangle: {
      coordinates: new Cesium.CallbackProperty(
        () => (current ? Cesium.Rectangle.fromDegrees(...current) : Cesium.Rectangle.fromDegrees(0, 0, 0, 0)),
        false,
      ),
      material: Cesium.Color.WHITE.withAlpha(0.18),
      outline: true,
      outlineColor: Cesium.Color.WHITE,
      height: 0,
    },
  });

  const handler: ScreenSpaceEventHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((e: { position: Cartesian2 }) => {
    start = pickLonLat(globe, e.position);
  }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
  handler.setInputAction((e: { endPosition: Cartesian2 }) => {
    if (!start) return;
    const p = pickLonLat(globe, e.endPosition);
    if (p) current = normaliseBox([start[0], start[1], p[0], p[1]]);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(() => {
    if (start && current) onDone(current);
    start = null;
  }, Cesium.ScreenSpaceEventType.LEFT_UP);

  return () => {
    if (!handler.isDestroyed()) handler.destroy();
    if (!viewer.isDestroyed()) {
      viewer.entities.remove(entity);
      ctrl.enableInputs = true;
    }
  };
}
