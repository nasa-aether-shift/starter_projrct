// Public runtime config. Each NEXT_PUBLIC_* must be referenced literally so Next.js inlines it.

export type GlobeMode = "cesium" | "static";

export const env = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1").replace(/\/$/, ""),
  useFixtures: process.env.NEXT_PUBLIC_USE_FIXTURES === "1",
  globeMode: (process.env.NEXT_PUBLIC_GLOBE_MODE === "static" ? "static" : "cesium") as GlobeMode,
  cesiumIonToken: process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN ?? "",
  globeHdr: process.env.NEXT_PUBLIC_GLOBE_HDR === "1",
  /** Ask the browser for the visitor's location and focus the globe on it (default on). */
  autoLocate: process.env.NEXT_PUBLIC_AUTO_LOCATE !== "0",
  /** Offer drawn-box regions (default off: POST /trend does not accept a bbox yet). */
  enableBox: process.env.NEXT_PUBLIC_ENABLE_BOX === "1",
  /** Space intro on the home page (default on; "0" is the switch for weak projector hardware). */
  intro: process.env.NEXT_PUBLIC_INTRO !== "0",
} as const;
