// A place for an investigation: a preset region id, or a drawn box [west, south, east, north] in degrees.

export type BBox = [number, number, number, number];
export type RegionChoice = { kind: "preset"; id: string } | { kind: "bbox"; bbox: BBox };

/** Client-side cap on drawn boxes (the API also validates). */
export const BOX_LIMITS = { maxSpanDeg: 10, minSpanDeg: 0.25 } as const;

/** Presets shown first, in this order (Kumasi is the local case). */
export const FEATURED_PRESETS = ["kumasi", "ashanti", "west_africa"] as const;

/** The only region with cached trend maps / opposite-trend clusters for now. */
export const MAP_REGION = "west_africa";

const round = (v: number) => Math.round(v * 100) / 100;

/** Orders corners, rounds to 0.01°, and caps the span around the box centre. */
export function normaliseBox([a, b, c, d]: BBox): BBox {
  let west = Math.min(a, c);
  let east = Math.max(a, c);
  let south = Math.min(b, d);
  let north = Math.max(b, d);
  const cap = (lo: number, hi: number): [number, number] => {
    const mid = (lo + hi) / 2;
    const span = Math.min(BOX_LIMITS.maxSpanDeg, Math.max(BOX_LIMITS.minSpanDeg, hi - lo));
    return [mid - span / 2, mid + span / 2];
  };
  [west, east] = cap(west, east);
  [south, north] = cap(south, north);
  return [
    round(Math.max(-180, west)),
    round(Math.max(-90, south)),
    round(Math.min(180, east)),
    round(Math.min(90, north)),
  ];
}

export function formatBox([w, s, e, n]: BBox): string {
  const lat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
  const lon = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "E" : "W"}`;
  return `${lat(s)} to ${lat(n)}, ${lon(w)} to ${lon(e)}`;
}

export function regionFromSearch(search: URLSearchParams): RegionChoice | null {
  const bbox = search.get("bbox");
  if (bbox) {
    const parts = bbox.split(",").map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) return { kind: "bbox", bbox: normaliseBox(parts as BBox) };
  }
  const id = search.get("region");
  return id ? { kind: "preset", id } : null;
}

export function writeRegion(params: URLSearchParams, region: RegionChoice | null): void {
  params.delete("region");
  params.delete("bbox");
  if (region?.kind === "preset") params.set("region", region.id);
  if (region?.kind === "bbox") params.set("bbox", region.bbox.join(","));
}
