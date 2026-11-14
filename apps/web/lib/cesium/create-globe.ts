// Builds the realistic Cesium globe: GIBS imagery, terrain, atmosphere, sun lighting, stars,
// night lights, regional/close Sentinel-2 fade and idle spin. Framework-free; React wraps it in EarthGlobe.

import type { Viewer } from "cesium";

import { env } from "@/lib/env";
import { prefersReducedMotion } from "@/lib/motion";

import { CLOSE_FADE, SPIN, START_VIEW, ZOOM_LIMITS, demoSunTime } from "./config";
import { BLACK_MARBLE, BLUE_MARBLE, gibsProvider, sentinel2Provider } from "./imagery";
import type { CesiumModule } from "./load";
import { managePerformance } from "./performance";
import { addSolarSystem } from "./solar-system";

export interface GlobeHandle {
  viewer: Viewer;
  Cesium: CesiumModule;
  /** Imagery index where data overlays go: directly above the photo layers. */
  overlayIndex: number;
  /** Enable/disable the idle spin (it also pauses itself during user input). */
  setSpin: (on: boolean) => void;
  /** Cap the render rate, e.g. while the space intro plays over the globe; undefined = the display's rate. */
  setFrameRate: (fps: number | undefined) => void;
  destroy: () => void;
}

/** True while the globe exists and its viewer has not been destroyed. */
export function isAlive(globe: GlobeHandle | null): globe is GlobeHandle {
  return globe !== null && !globe.viewer.isDestroyed();
}

const INPUT_EVENTS = ["pointerdown", "wheel", "touchstart", "keydown"] as const;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function createGlobe(Cesium: CesiumModule, container: HTMLElement, opts: { spin: boolean }): GlobeHandle {
  // Never fall back to Cesium's demo ion token: no token means no ion requests at all.
  Cesium.Ion.defaultAccessToken = env.cesiumIonToken;

  const viewer = new Cesium.Viewer(container, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    vrButton: false,
    msaaSamples: 4,
    ...(env.cesiumIonToken ? { terrain: Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true }) } : {}),
  });
  const { scene, camera, clock } = viewer;
  // Dev-only handle for console debugging and scripted screenshots; stripped from production builds.
  if (process.env.NODE_ENV === "development")
    Object.assign(window as unknown as Record<string, unknown>, { __viewer: viewer, Cesium });

  // ---- imagery (bottom to top) ----
  const layers = viewer.imageryLayers;
  layers.addImageryProvider(gibsProvider(Cesium, BLUE_MARBLE));
  const night = layers.addImageryProvider(gibsProvider(Cesium, BLACK_MARBLE));
  night.dayAlpha = 0;
  night.nightAlpha = 1;
  night.brightness = 1.4;
  const close = layers.addImageryProvider(sentinel2Provider(Cesium));
  close.alpha = 0;
  close.nightAlpha = 0;
  const overlayIndex = layers.length; // trend overlays are inserted here, under the demarcations

  // Demarcations (borders, regions, names) are vector entities: see lib/cesium/boundaries.ts.

  // ---- realism ----
  const globe = scene.globe;
  globe.enableLighting = true;
  globe.dynamicAtmosphereLighting = true;
  globe.dynamicAtmosphereLightingFromSun = true;
  globe.showGroundAtmosphere = true;
  globe.baseColor = Cesium.Color.fromCssColorString("#0a1a33"); // ocean tone while tiles load
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  if (scene.skyBox) scene.skyBox.show = true; // Cesium's built-in star field (Tycho-2 catalogue)
  if (scene.sun) {
    scene.sun.show = true;
    scene.sun.glowFactor = 1.4; // a touch more bloom so the Sun reads as a light source, not a disc
  }
  if (scene.moon) scene.moon.show = true; // true position and size for the scene's date
  scene.fog.enabled = true;
  scene.highDynamicRange = env.globeHdr;
  scene.backgroundColor = Cesium.Color.BLACK;

  // Fixed, flattering sun: Africa in daylight with the day/night line visible.
  clock.currentTime = Cesium.JulianDate.fromDate(demoSunTime());
  clock.shouldAnimate = false;

  const ctrl = scene.screenSpaceCameraController;
  ctrl.minimumZoomDistance = ZOOM_LIMITS.min;
  ctrl.maximumZoomDistance = ZOOM_LIMITS.max;

  camera.setView({ destination: Cesium.Cartesian3.fromDegrees(START_VIEW.lon, START_VIEW.lat, START_VIEW.height) });

  // ---- per-frame: Sentinel-2 fade by height ----
  const removePreRender = scene.preRender.addEventListener(() => {
    const h = camera.positionCartographic.height;
    close.alpha = CLOSE_FADE.maxAlpha * (1 - smoothstep(CLOSE_FADE.fullBelow, CLOSE_FADE.hiddenAbove, h));
    close.show = close.alpha > 0.001; // skip 10 m tile requests when invisible
  });

  const removeSolarSystem = addSolarSystem(Cesium, viewer);

  // Quality tier (MSAA, resolution, tile detail, atmosphere) and pause-when-hidden: see performance.ts.
  const perf = managePerformance(viewer, container);

  // ---- idle spin ----
  let spinOn = opts.spin && !prefersReducedMotion();
  let lastInput = -Infinity;
  let prev = performance.now();
  const onInput = () => {
    lastInput = performance.now();
  };
  for (const ev of INPUT_EVENTS) viewer.canvas.addEventListener(ev, onInput, { passive: true });
  const removePostRender = scene.postRender.addEventListener(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - prev) / 1000);
    prev = now;
    if (!spinOn || now - lastInput < SPIN.idleMs) return;
    if (camera.positionCartographic.height < SPIN.minHeight) return;
    camera.rotate(Cesium.Cartesian3.UNIT_Z, -SPIN.rate * dt);
  });

  return {
    viewer,
    Cesium,
    overlayIndex,
    setSpin: (on) => {
      spinOn = on && !prefersReducedMotion();
    },
    setFrameRate: (fps) => {
      // Cesium documents undefined as "no cap", but types targetFrameRate as number.
      (viewer as { targetFrameRate?: number }).targetFrameRate = fps;
    },
    destroy: () => {
      perf.destroy();
      removeSolarSystem();
      removePreRender();
      removePostRender();
      for (const ev of INPUT_EVENTS) viewer.canvas.removeEventListener(ev, onInput);
      if (!viewer.isDestroyed()) viewer.destroy();
    },
  };
}
