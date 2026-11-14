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

/**
 * Regional and close range: Sentinel-2 cloudless 2024 mosaic by EOX (~10 m, cloud-free, colour-balanced).
 * Chosen over GIBS Landsat WELD (2000, ~30 m, hazy and visibly seamed at city zoom) and daily VIIRS
 * (375 m, cloudy over Kumasi). Licence CC BY-NC-SA 4.0: attribution is required and shown on the globe.
 * Tiles are public with CORS; checked against https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml.
 */
export function sentinel2Provider(Cesium: CesiumModule) {
  return new Cesium.WebMapTileServiceImageryProvider({
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{TileMatrix}/{TileRow}/{TileCol}.jpg",
    layer: "s2cloudless-2024_3857",
    style: "default",
    format: "image/jpeg",
    tileMatrixSetID: "g",
    maximumLevel: 14, // native 10 m; deeper levels are upsampled, so let Cesium do that client-side
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    credit: new Cesium.Credit(
      '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless 2024 by EOX</a> (contains modified Copernicus Sentinel data 2024)',
      true,
    ),
  });
}
