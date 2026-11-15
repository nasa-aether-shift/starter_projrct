// Camera and motion settings for the globe. Heights are metres above the ellipsoid.

/** Centred south of the Sahel so West Africa (and its trend map) sits in the upper half, clear of the map card. */
// 36,000 km keeps the whole Earth comfortably inside the hero (it was 26,000 km: too big on the landing page).
// The space intro (lib/intro/create-intro.ts) ends on this view, so both stay in step.
export const START_VIEW = { lon: 6, lat: -4, height: 36_000_000 } as const;
export const GHANA_VIEW = { lon: -1.2, lat: 7.9, height: 600_000, pitchDeg: -45, durationS: 3 } as const;
export const KUMASI_VIEW = { lon: -1.62, lat: 6.69, height: 30_000, pitchDeg: -45, durationS: 3 } as const;

export const SPIN = {
  /** Radians per second of apparent rotation (west → east, like the real Earth). */
  rate: 0.035,
  /** Resume after this much idle time. */
  idleMs: 5_000,
  /** Only spin when zoomed out beyond this height. */
  minHeight: 4_000_000,
} as const;

/**
 * Sentinel-2 layer fades in between these heights. Above ~1,500 km Blue Marble (500 m) is sharp enough and
 * keeps its ocean bathymetry; by the 600 km Ghana view Sentinel-2 (10 m) has fully taken over.
 */
export const CLOSE_FADE = { fullBelow: 800_000, hiddenAbove: 1_600_000, maxAlpha: 1 } as const;

/** Max ~150,000 km: far enough to pull back into space, see the Earth as a small blue disc and the planets around it. */
export const ZOOM_LIMITS = { min: 1_500, max: 150_000_000 } as const;

/**
 * Fixed sun position: 15:00 UTC today. Ghana (UTC+0) is in afternoon light and the day/night line,
 * with Black Marble city lights, sits on the eastern limb of the starting view.
 */
export function demoSunTime(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 15, 0, 0));
}
