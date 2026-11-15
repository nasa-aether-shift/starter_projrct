// Focus-locked camera flights. Cesium's built-in flyTo interpolates position and orientation
// separately, so the place of interest can slide off-screen mid-flight. Here the camera looks at a
// focus point every frame: the focus glides onto the target early, then the camera zooms (log scale)
// and tilts around it, so the country or point stays in view for the whole transition.
// With prefers-reduced-motion the camera jumps instead. Any user input cancels the flight in place.

import { prefersReducedMotion } from "@/lib/motion";

import { START_VIEW } from "./config";
import type { GlobeHandle } from "./create-globe";

export interface ViewTarget {
  lon: number;
  lat: number;
  /** Camera height above the target, metres. */
  height: number;
  pitchDeg?: number;
  durationS?: number;
}

export interface FlyOptions {
  /**
   * Keep the target this many CSS pixels left of the screen centre at the end of the flight
   * (e.g. half the width of a results panel that covers the right side).
   */
  offsetPx?: number;
  /** Keep the target this many CSS pixels above the screen centre (e.g. above a bottom card). */
  offsetYPx?: number;
}

const EARTH_R = 6_371_000;
const cancels = new WeakMap<GlobeHandle, () => void>();

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const wrapPi = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

export function cancelFlight(globe: GlobeHandle): void {
  cancels.get(globe)?.();
}

export function flyTo(globe: GlobeHandle, t: ViewTarget, opts: FlyOptions = {}): Promise<void> {
  const { Cesium, viewer } = globe;
  const { camera, scene } = viewer;
  cancelFlight(globe);

  const D2R = Math.PI / 180;
  const endPitch = Math.max(-89.5, Math.min(-10, t.pitchDeg ?? -45)) * D2R;
  const endRange = t.height / Math.sin(-endPitch); // slant range that gives the requested altitude
  const canvas = scene.canvas;

  // Where the camera is looking now: the start of the focus glide (falls back to the target).
  const centrePx = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const startHit = camera.pickEllipsoid(centrePx, scene.globe.ellipsoid);
  const startCarto = startHit
    ? Cesium.Cartographic.fromCartesian(startHit)
    : Cesium.Cartographic.fromDegrees(t.lon, t.lat);
  const startRange = startHit
    ? Cesium.Cartesian3.distance(camera.positionWC, startHit)
    : camera.positionCartographic.height;
  const startPitch = Math.max(-89.5 * D2R, Math.min(-10 * D2R, camera.pitch));
  const startHeading = camera.heading;

  // End focus point, nudged east so the target sits `offsetPx` left of centre (heading is north-up).
  let endLon = t.lon * D2R;
  const endLat = t.lat * D2R;
  if (opts.offsetPx && canvas.clientWidth > 0) {
    const frustum = camera.frustum as { fov?: number };
    const halfWidth = endRange * Math.tan((frustum.fov ?? Math.PI / 3) / 2);
    const metres = (opts.offsetPx / (canvas.clientWidth / 2)) * halfWidth;
    endLon += metres / (EARTH_R * Math.max(0.1, Math.cos(endLat)));
  }
  let endLatAdj = endLat;
  if (opts.offsetYPx && canvas.clientHeight > 0) {
    const frustum = camera.frustum as { fov?: number };
    const aspect = canvas.clientWidth / canvas.clientHeight;
    const fov = frustum.fov ?? Math.PI / 3;
    const fovY = aspect >= 1 ? 2 * Math.atan(Math.tan(fov / 2) / aspect) : fov;
    const metres = (opts.offsetYPx / (canvas.clientHeight / 2)) * endRange * Math.tan(fovY / 2);
    endLatAdj -= metres / EARTH_R; // look south of the target so it sits higher on screen (north-up)
  }
  const dLon = wrapPi(endLon - startCarto.longitude);
  const dHeading = wrapPi(0 - startHeading);
  const durationMs = prefersReducedMotion() ? 0 : (t.durationS ?? 3) * 1000;

  return new Promise((resolve) => {
    let raf = 0;
    let done = false;
    const t0 = performance.now();
    const target = new Cesium.Cartesian3();
    const hpr = new Cesium.HeadingPitchRange();

    const apply = (k: number) => {
      const e = easeInOut(k);
      const focusK = easeInOut(Math.min(1, k / 0.55)); // focus arrives early, zoom continues on it
      Cesium.Cartesian3.fromRadians(
        startCarto.longitude + dLon * focusK,
        lerp(startCarto.latitude, endLatAdj, focusK),
        0,
        undefined,
        target,
      );
      hpr.heading = startHeading + dHeading * e;
      hpr.pitch = lerp(startPitch, endPitch, e);
      hpr.range = Math.exp(lerp(Math.log(Math.max(1, startRange)), Math.log(endRange), e));
      camera.lookAt(target, hpr);
    };

    const finish = () => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY); // hand the camera back to the user
      for (const ev of ["pointerdown", "wheel", "touchstart"] as const) canvas.removeEventListener(ev, finish);
      cancels.delete(globe);
      resolve();
    };

    const step = () => {
      if (done || viewer.isDestroyed()) return finish();
      const k = durationMs ? Math.min(1, (performance.now() - t0) / durationMs) : 1;
      apply(k);
      if (k < 1) raf = requestAnimationFrame(step);
      else finish();
    };

    for (const ev of ["pointerdown", "wheel", "touchstart"] as const)
      canvas.addEventListener(ev, finish, { passive: true });
    cancels.set(globe, finish);
    step();
  });
}

/**
 * A view that frames an area (ring of [lon, lat]) with margin: height scales with the area's size, so a
 * city box and a whole region both sit fully in frame, tilted for depth.
 */
export function viewForRing(ring: [number, number][]): ViewTarget {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const M_PER_DEG = 111_320;
  const span = Math.max(
    (Math.max(...lats) - Math.min(...lats)) * M_PER_DEG,
    (Math.max(...lons) - Math.min(...lons)) * M_PER_DEG * Math.cos((lat * Math.PI) / 180),
  );
  const height = Math.min(4_000_000, Math.max(30_000, span * 2.4));
  return { lon, lat, height, pitchDeg: span > 1_000_000 ? -60 : -45 };
}

/** Back to the whole-Earth view (focus-locked too) and resume the idle spin. */
export async function flyHome(globe: GlobeHandle): Promise<void> {
  await flyTo(globe, { lon: START_VIEW.lon, lat: START_VIEW.lat, height: START_VIEW.height, pitchDeg: -89.5 });
  globe.setSpin(true);
}

/**
 * Zoom by a factor of the camera's height (<1 in, >1 out) with a short glide along the view direction, kept
 * inside the zoom limits. Looking at space (no Earth under the centre), it moves towards the Earth's centre.
 */
export function zoomBy(globe: GlobeHandle, factor: number): void {
  const { Cesium, viewer } = globe;
  const { camera, scene } = viewer;
  cancelFlight(globe);
  globe.holdSpin();
  const ctrl = scene.screenSpaceCameraController;
  const h = camera.positionCartographic.height;
  const newH = Math.min(ctrl.maximumZoomDistance * 0.98, Math.max(ctrl.minimumZoomDistance * 1.2, h * factor));
  const canvas = scene.canvas;
  const centre = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const hit = camera.pickEllipsoid(centre, scene.globe.ellipsoid);
  const pos = camera.positionWC;
  const dir = hit
    ? Cesium.Cartesian3.clone(camera.directionWC)
    : Cesium.Cartesian3.negate(Cesium.Cartesian3.normalize(pos, new Cesium.Cartesian3()), new Cesium.Cartesian3());
  const dist = hit ? Cesium.Cartesian3.distance(pos, hit) : h;
  // Moving the same fraction of the distance to the target scales the height by about `newH / h`.
  const move = dist * (1 - newH / h);
  const destination = Cesium.Cartesian3.add(
    pos,
    Cesium.Cartesian3.multiplyByScalar(dir, move, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  );
  camera.flyTo({
    destination,
    orientation: { direction: Cesium.Cartesian3.clone(camera.directionWC), up: Cesium.Cartesian3.clone(camera.upWC) },
    duration: prefersReducedMotion() ? 0 : 0.9,
    easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
  });
}
