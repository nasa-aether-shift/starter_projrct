// NASA GIBS WMTS layers (EPSG:3857 "best" endpoint). Values verified against
// https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml on 14 Nov 2026.
// The browser may call GIBS tiles directly (public, CORS: *); all science data comes from our API.

import type { CesiumModule } from "./load";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

export interface GibsLayer {
  id: string;
  format: "image/jpeg" | "image/png";
  ext: "jpeg" | "png";
  tileMatrixSet: "GoogleMapsCompatible_Level8" | "GoogleMapsCompatible_Level12";
  maximumLevel: number;
  /** ISO date for layers with a Time dimension; omitted for static layers. */
  time?: string;
  credit: string;
}

/** Cloud-free Blue Marble with shaded relief and ocean bathymetry: the whole-globe base. */
export const BLUE_MARBLE: GibsLayer = {
  id: "BlueMarble_ShadedRelief_Bathymetry",
  format: "image/jpeg",
  ext: "jpeg",
  tileMatrixSet: "GoogleMapsCompatible_Level8",
  maximumLevel: 8,
  credit: "NASA Blue Marble (GIBS)",
};

/** City lights at night (VIIRS Black Marble 2016), shown only on the night side. */
export const BLACK_MARBLE: GibsLayer = {
  id: "VIIRS_Black_Marble",
  format: "image/png",
  ext: "png",
  tileMatrixSet: "GoogleMapsCompatible_Level8",
  maximumLevel: 8,
  time: "2016-01-01",
  credit: "NASA Black Marble (GIBS)",
};

/**
 * Close range: Landsat WELD true colour, cloud-free annual composite (~30 m, latest = 2000).
 * Chosen over VIIRS daily true colour, which at 375 m is blurry at city zoom and was partly cloudy over
 * Kumasi on every date sampled (Nov 2025 to Mar 2026). No-data (ocean) is black and keyed out in create-globe.ts.
 */
export const LANDSAT_CLOSE: GibsLayer = {
  id: "Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual",
  format: "image/jpeg",
  ext: "jpeg",
  tileMatrixSet: "GoogleMapsCompatible_Level12",
  maximumLevel: 12,
  time: "2000-12-01",
  credit: "NASA/USGS Landsat WELD true colour, 2000 composite (GIBS)",
};

export function gibsProvider(Cesium: CesiumModule, layer: GibsLayer) {
  const timePart = layer.time ? `${layer.time}/` : "";
  return new Cesium.WebMapTileServiceImageryProvider({
    url: `${GIBS}/${layer.id}/default/${timePart}{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.${layer.ext}`,
    layer: layer.id,
    style: "default",
    format: layer.format,
    tileMatrixSetID: layer.tileMatrixSet,
    maximumLevel: layer.maximumLevel,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    credit: new Cesium.Credit(layer.credit, true),
  });
}
