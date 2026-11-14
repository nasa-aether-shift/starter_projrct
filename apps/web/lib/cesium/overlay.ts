// Trend-map overlay rendered as a crisp, organic heatmap. The trend values themselves are interpolated
// (bilinear, per output pixel) and only then coloured, so edges are smooth contours rather than grid
// squares or blur. Opacity comes from the scale's visibility ramp: the strongest changes are vivid,
// milder ones fade out, so the footprint follows the hotspots instead of the data rectangle. Missing
// cells (ocean) and the grid border fade smoothly. A light glow sits under the crisp layer.
// FDR-significant cells get subtle stipple dots at regional zoom. Everything fades with camera height.
// From far away (whole-globe views) a second "beacon" texture takes over: a lower visibility threshold,
// brighter colour and a wide glow, so the region's hotspots read at a glance from space. It cross-fades
// to the detailed layer as the camera comes down.

import type { ImageryLayer, PointPrimitiveCollection } from "cesium";

import type { DivergingScale } from "@/lib/colors";
import type { TrendMap } from "@/lib/schemas";

import type { GlobeHandle } from "./create-globe";

/** Layer opacity by camera height: full from space, slightly softer regionally, gone near the ground. */
const FADE = { hiddenBelow: 60_000, regionalAt: 250_000, spaceAbove: 3_000_000, regional: 0.85, space: 1 } as const;
/** Detailed → beacon cross-fade by camera height. */
const BEACON = { startAbove: 3_500_000, fullAbove: 9_000_000 } as const;

interface PaintStyle {
  /** Remaps the scale's visibility ramp: alpha' = min(1, floor + gain · alpha). */
  floor: number;
  gain: number;
  /** Glow blur radius (output px) and strength under the crisp layer. */
  glowBlur: number;
  glowAlpha: number;
  /**
   * Colour punch baked into the texture (not ImageryLayer.saturation/contrast: those add globe shader
   * variants, which cost a shader compile and per-pixel work on every tile they touch).
   */
  saturation: number;
  contrast: number;
}
const DETAIL: PaintStyle = {
  floor: 0,
  gain: 1,
  glowBlur: Math.round(12 * 0.8),
  glowAlpha: 0.45,
  saturation: 1.3,
  contrast: 1,
};
/**
 * Far view: everything above the map's median change is fully opaque (`gain` 2.2 saturates the ramp
 * halfway up) and a faint wash marks milder change, so the footprint is solid, with a halo three cells wide.
 */
// Punchier colour cuts through the ground-atmosphere haze over the disc seen from space.
const FAR: PaintStyle = { floor: 0.18, gain: 2.2, glowBlur: 36, glowAlpha: 1, saturation: 1.8, contrast: 1.25 };
/** Stipple dots only at regional zoom, where individual cells are big enough to read. */
const DOTS = { showBelow: 3_500_000, hideBelow: 60_000 } as const;

/** Transparent margin (cells) around the grid: room for the far view's halo to fade out. */
const PAD = 4;
/**
 * Rounded falloff over the data area (superellipse |u|^n + |v|^n): full inside, fading to zero at the
 * border, so the footprint has no straight edges or corners even where data run up to the grid limit.
 */
const FALLOFF = { power: 3, start: 0.62, end: 1 } as const;
/** Output pixels per grid cell. */
const SCALE = 12;
/** Colour lookup resolution. */
const LUT_SIZE = 256;

function axisStep(axis: number[]): number {
  return axis.length > 1 ? Math.abs(axis[1]! - axis[0]!) : 0.5;
}

function paddedRect(map: TrendMap) {
  const dLat = axisStep(map.grid.lat);
  const dLon = axisStep(map.grid.lon);
  return {
    west: Math.min(...map.grid.lon) - dLon * (0.5 + PAD),
    east: Math.max(...map.grid.lon) + dLon * (0.5 + PAD),
    south: Math.max(-90, Math.min(...map.grid.lat) - dLat * (0.5 + PAD)),
    north: Math.min(90, Math.max(...map.grid.lat) + dLat * (0.5 + PAD)),
  };
}

const RGB = /rgba?\((\d+),\s*(\d+),\s*(\d+)/;
const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

function buildLut(scale: DivergingScale, style: PaintStyle): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(LUT_SIZE * 3);
  for (let k = 0; k < LUT_SIZE; k++) {
    const v = -scale.maxAbs + (2 * scale.maxAbs * k) / (LUT_SIZE - 1);
    const m = RGB.exec(scale.color(v));
    if (!m) continue;
    const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
    const lum = 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
    for (let c = 0; c < 3; c++) {
      const sat = lum + (rgb[c]! - lum) * style.saturation;
      lut[k * 3 + c] = (sat - 127.5) * style.contrast + 127.5; // Uint8ClampedArray clamps to 0–255
    }
  }
  return lut;
}

function paint(
  map: TrendMap,
  scale: DivergingScale,
  style: PaintStyle,
): { url: string; width: number; height: number } {
  const rows = map.grid.lat.length;
  const cols = map.grid.lon.length;
  const gw = cols + 2 * PAD;
  const gh = rows + 2 * PAD;

  // Padded, north-up grids of value and weight (0 = missing), weight eased by the rounded falloff.
  const raw = new Float32Array(gw * gh);
  const has = new Uint8Array(gw * gh);
  const wt = new Float32Array(gw * gh);
  const latAscending = map.grid.lat[0]! < map.grid.lat[rows - 1]!;
  for (let i = 0; i < rows; i++) {
    const gy = PAD + (latAscending ? rows - 1 - i : i);
    for (let j = 0; j < cols; j++) {
      const v = map.slope_per_decade[i]?.[j];
      if (v === null || v === undefined) continue;
      const k = gy * gw + PAD + j;
      raw[k] = v;
      has[k] = 1;
      const u = Math.abs((j + 0.5) / cols - 0.5) * 2;
      const w = Math.abs((i + 0.5) / rows - 0.5) * 2;
      const r = (u ** FALLOFF.power + w ** FALLOFF.power) ** (1 / FALLOFF.power);
      wt[k] = 1 - smooth01((r - FALLOFF.start) / (FALLOFF.end - FALLOFF.start));
    }
  }
  // Display-only smoothing (3×3 [1 2 1] kernel over valid cells) so contours are round, not diamond.
  // Hover and tables still use the raw values.
  const val = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const k = y * gw + x;
      if (!has[k]) continue;
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= gh || xx < 0 || xx >= gw) continue;
          const kk = yy * gw + xx;
          if (!has[kk]) continue;
          const c = (dy ? 1 : 2) * (dx ? 1 : 2);
          sum += c * raw[kk]!;
          n += c;
        }
      val[k] = sum / n;
    }

  const lut = buildLut(scale, style);
  const W = gw * SCALE;
  const H = gh * SCALE;
  const out = new ImageData(W, H);
  const px = out.data;
  for (let y = 0; y < H; y++) {
    const fyAbs = (y + 0.5) / SCALE - 0.5;
    const i0 = Math.floor(fyAbs);
    const fy = fyAbs - i0;
    for (let x = 0; x < W; x++) {
      const fxAbs = (x + 0.5) / SCALE - 0.5;
      const j0 = Math.floor(fxAbs);
      const fx = fxAbs - j0;
      let vs = 0;
      let ws = 0;
      let cover = 0;
      for (let di = 0; di < 2; di++) {
        const ii = i0 + di;
        if (ii < 0 || ii >= gh) continue;
        const wy = di ? fy : 1 - fy;
        for (let dj = 0; dj < 2; dj++) {
          const jj = j0 + dj;
          if (jj < 0 || jj >= gw) continue;
          const k = ii * gw + jj;
          const w = wt[k]!;
          if (w <= 0) continue;
          const b = wy * (dj ? fx : 1 - fx);
          vs += b * val[k]!;
          ws += b;
          cover += b * w;
        }
      }
      if (ws <= 0) continue;
      const v = vs / ws;
      const base = scale.alpha(v);
      const a = Math.min(1, base > 0 ? style.floor + style.gain * base : 0) * smooth01(cover * 1.6);
      if (a <= 0.004) continue;
      const li = Math.round(((Math.max(-1, Math.min(1, v / scale.maxAbs)) + 1) / 2) * (LUT_SIZE - 1)) * 3;
      const o = (y * W + x) * 4;
      px[o] = lut[li]!;
      px[o + 1] = lut[li + 1]!;
      px[o + 2] = lut[li + 2]!;
      px[o + 3] = Math.round(a * 255);
    }
  }

  const crisp = document.createElement("canvas");
  crisp.width = W;
  crisp.height = H;
  crisp.getContext("2d")?.putImageData(out, 0, 0);

  // Light glow under the crisp layer: luminous hotspots without blurring the shapes themselves.
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  if ("filter" in ctx) {
    ctx.filter = `blur(${style.glowBlur}px)`;
    ctx.globalAlpha = style.glowAlpha;
    ctx.drawImage(crisp, 0, 0);
    if (style.glowAlpha >= 1) ctx.drawImage(crisp, 0, 0); // double pass: a denser halo for the far view
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(crisp, 0, 0);
  return { url: canvas.toDataURL("image/png"), width: W, height: H };
}

/** Adds the overlay; returns a remover. */
export function addTrendOverlay(globe: GlobeHandle, map: TrendMap, scale: DivergingScale): () => void {
  const { Cesium, viewer } = globe;
  const r = paddedRect(map);
  const rectangle = Cesium.Rectangle.fromDegrees(r.west, r.south, r.east, r.north);
  const addLayer = (style: PaintStyle, index: number): ImageryLayer => {
    const tex = paint(map, scale, style);
    const provider = new Cesium.SingleTileImageryProvider({
      url: tex.url,
      rectangle,
      tileWidth: tex.width,
      tileHeight: tex.height,
    });
    // Directly above the photo layers; vector borders and labels draw on top of it.
    return viewer.imageryLayers.addImageryProvider(provider, index);
  };
  const layer = addLayer(DETAIL, globe.overlayIndex);
  const beacon = addLayer(FAR, globe.overlayIndex + 1);

  const dots: PointPrimitiveCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
  const dotColor = Cesium.Color.WHITE.withAlpha(0.6);
  map.fdr_significant.forEach((row, i) =>
    row.forEach((sig, j) => {
      if (sig !== 1) return;
      dots.add({
        position: Cesium.Cartesian3.fromDegrees(map.grid.lon[j]!, map.grid.lat[i]!),
        pixelSize: 2.5,
        color: dotColor,
      });
    }),
  );

  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const removeFade = viewer.scene.preRender.addEventListener(() => {
    const h = viewer.camera.positionCartographic.height;
    const ground = clamp((h - FADE.hiddenBelow) / (FADE.regionalAt - FADE.hiddenBelow));
    const space = clamp((h - FADE.regionalAt) / (FADE.spaceAbove - FADE.regionalAt));
    const t = ground * (FADE.regional + (FADE.space - FADE.regional) * space);
    const far = smooth01((h - BEACON.startAbove) / (BEACON.fullAbove - BEACON.startAbove));
    layer.alpha = t * (1 - far);
    layer.show = layer.alpha > 0.01;
    beacon.alpha = t * far;
    beacon.show = beacon.alpha > 0.01;
    dots.show = h < DOTS.showBelow && h > DOTS.hideBelow;
  });

  return () => {
    removeFade();
    if (viewer.isDestroyed()) return;
    viewer.imageryLayers.remove(beacon, true);
    viewer.imageryLayers.remove(layer, true);
    viewer.scene.primitives.remove(dots);
  };
}
