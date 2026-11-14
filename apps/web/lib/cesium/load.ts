// Loads CesiumJS on the client only. CESIUM_BASE_URL must be set BEFORE the module is evaluated,
// so Cesium is imported dynamically here instead of statically at the top of a file.

export type CesiumModule = typeof import("cesium");

declare global {
  interface Window {
    CESIUM_BASE_URL?: string;
  }
}

let cesiumPromise: Promise<CesiumModule> | null = null;

export function loadCesium(): Promise<CesiumModule> {
  if (typeof window === "undefined") return Promise.reject(new Error("Cesium is client-only"));
  if (!cesiumPromise) {
    window.CESIUM_BASE_URL = "/cesium"; // served from public/cesium (scripts/copy-cesium.mjs)
    cesiumPromise = import("cesium").catch((err: unknown) => {
      cesiumPromise = null; // allow a retry after a network hiccup
      throw err;
    });
  }
  return cesiumPromise;
}
