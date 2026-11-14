// Camera and motion settings for the globe. Heights are metres above the ellipsoid.

export const START_VIEW = { lon: 2, lat: 8, height: 26_000_000 } as const;
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

/** Close-range Landsat layer fades in between these heights (hidden at the 600 km Ghana view). */
export const CLOSE_FADE = { fullBelow: 120_000, hiddenAbove: 450_000, maxAlpha: 1 } as const;

export const ZOOM_LIMITS = { min: 1_500, max: 40_000_000 } as const;

/**
 * Fixed sun position: 15:00 UTC today. Ghana (UTC+0) is in afternoon light and the day/night line,
 * with Black Marble city lights, sits on the eastern limb of the starting view.
 */
export function demoSunTime(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 15, 0, 0));
}
