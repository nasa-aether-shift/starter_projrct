// Keeps the globe smooth on every device: a starting quality tier from device hints, a frame-rate
// governor that steps quality down (never below "low") when frames run long, and pausing the render
// loop while the globe is off-screen or the tab is hidden. Visual effects are dropped in order of
// cost-per-pixel benefit: MSAA first, then render resolution, then atmosphere/fog, then tile detail.

import type { Viewer } from "cesium";

export type Tier = 0 | 1 | 2 | 3; // 3 = full quality … 0 = lightest

interface TierSettings {
  msaa: number;
  /** Fraction of CSS-pixel resolution (Cesium ignores devicePixelRatio by default). */
  resolution: number;
  /** Higher = coarser tiles, fewer requests and triangles. */
  sse: number;
  atmosphere: boolean;
  tileCache: number;
}

const TIERS: Record<Tier, TierSettings> = {
  3: { msaa: 4, resolution: 1, sse: 1.5, atmosphere: true, tileCache: 250 },
  2: { msaa: 2, resolution: 1, sse: 2, atmosphere: true, tileCache: 200 },
  1: { msaa: 1, resolution: 0.85, sse: 2.5, atmosphere: true, tileCache: 150 },
  0: { msaa: 1, resolution: 0.7, sse: 3, atmosphere: false, tileCache: 100 },
};

/** Best guess before the first frame: phones, low-memory, few-core, data-saver or software-GL devices start lower. */
export function initialTier(viewer: Viewer): Tier {
  if (typeof navigator === "undefined") return 2;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 8;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  let renderer = "";
  try {
    // Same type as Cesium's context returns that existing context (no new one is created).
    const gl = (viewer.canvas.getContext("webgl2") ??
      viewer.canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return 1;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    /* renderer string is optional */
  }
  if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return 0;
  if (nav.connection?.saveData || memory <= 2 || cores <= 2) return 0;
  if (coarse || memory <= 4 || cores <= 4) return 1;
  if (/intel|mali|adreno|powervr|apple gpu/i.test(renderer) && !/apple m\d/i.test(renderer)) return 2;
  return 3;
}

function apply(viewer: Viewer, tier: Tier): void {
  const s = TIERS[tier];
  const { scene } = viewer;
  if (scene.msaaSamples !== s.msaa) scene.msaaSamples = s.msaa;
  viewer.resolutionScale = s.resolution;
  scene.globe.maximumScreenSpaceError = s.sse;
  scene.globe.tileCacheSize = s.tileCache;
  scene.globe.showGroundAtmosphere = s.atmosphere;
  scene.fog.enabled = s.atmosphere;
}

/** Governor window: judge the frame rate over this long, ignoring the first seconds of loading. */
const WINDOW_MS = 2500;
const WARMUP_MS = 6000;
/** Step down when the average frame takes longer than this (≈45 fps). */
const SLOW_FRAME_MS = 22;

export interface PerformanceHandle {
  tier: () => Tier;
  destroy: () => void;
}

export function managePerformance(viewer: Viewer, container: HTMLElement): PerformanceHandle {
  let tier = initialTier(viewer);
  apply(viewer, tier);

  // ---- frame-rate governor (only ever steps down; a reload re-evaluates) ----
  const start = performance.now();
  let windowStart = 0;
  let frames = 0;
  let last = 0;
  let worstGapIgnored = false;
  const removePost = viewer.scene.postRender.addEventListener(() => {
    const now = performance.now();
    if (now - start < WARMUP_MS || document.hidden) {
      windowStart = 0;
      return;
    }
    // A long pause (tab switch, debugger, shader compile on first use of a view) is not steady-state slowness.
    if (last && now - last > 1000) worstGapIgnored = true;
    last = now;
    if (!windowStart || worstGapIgnored) {
      windowStart = now;
      frames = 0;
      worstGapIgnored = false;
      return;
    }
    frames++;
    const elapsed = now - windowStart;
    if (elapsed < WINDOW_MS) return;
    const avg = elapsed / frames;
    windowStart = now;
    frames = 0;
    if (avg > SLOW_FRAME_MS && tier > 0) {
      tier = (tier - 1) as Tier;
      apply(viewer, tier);
    }
  });

  // ---- pause rendering when nobody can see it ----
  let onScreen = true;
  const sync = () => {
    const run = onScreen && !document.hidden;
    if (viewer.isDestroyed() || viewer.useDefaultRenderLoop === run) return;
    viewer.useDefaultRenderLoop = run;
    last = 0; // do not count the pause as a slow frame
  };
  const io =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          onScreen = entries.some((e) => e.isIntersecting);
          sync();
        })
      : null;
  io?.observe(container);
  document.addEventListener("visibilitychange", sync);

  return {
    tier: () => tier,
    destroy: () => {
      removePost();
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    },
  };
}
