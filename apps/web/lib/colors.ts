// Diverging colour scales for trend maps (d3-scale-chromatic). Polarity comes from the catalog:
// warm_is_red → RdBu with positive = red; wet_is_blue → RdBu with positive = blue;
// green_is_green → BrBG with positive = blue-green. All are colour-blind-safe ColorBrewer schemes.

import { interpolateBrBG, interpolateRdBu } from "d3-scale-chromatic";

import { polarityFor } from "@/lib/polarity";

/**
 * Heatmap visibility by |trend|, relative to the map's own spread: changes below `lo` are transparent,
 * rising steeply to full strength at `hi`. Intense areas stand out; milder ones fall away (they changed
 * less, not nothing: hover and the legend table give exact values).
 */
export interface VisibilityRamp {
  lo: number;
  hi: number;
}

export interface DivergingScale {
  /** Symmetric limit used for the colour range (robust 95th percentile of |slope|). */
  maxAbs: number;
  color: (v: number) => string;
  /** Heatmap opacity for a value (0–1). */
  alpha: (v: number) => number;
  /** CSS gradient from the negative end (left) to the positive end (right). */
  gradient: string;
  /** Same gradient with the heatmap's opacity, for the legend. */
  heatGradient: string;
  negativeWord: string;
  positiveWord: string;
}

function absSorted(values: (number | null)[][]): number[] {
  return values
    .flat()
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .map(Math.abs)
    .sort((a, b) => a - b);
}

const pick = (sorted: number[], pct: number) => sorted[Math.min(sorted.length - 1, Math.floor(pct * sorted.length))]!;

export function robustMaxAbs(values: (number | null)[][], pct = 0.95): number {
  const abs = absSorted(values);
  if (!abs.length) return 1;
  return pick(abs, pct) || abs[abs.length - 1] || 1;
}

/** Visibility ramp from the map's distribution of |trend| (defaults: 50th → 97th percentile). */
export function visibilityRamp(values: (number | null)[][], loPct = 0.5, hiPct = 0.97): VisibilityRamp {
  const abs = absSorted(values);
  if (!abs.length) return { lo: 0, hi: 1 };
  const lo = pick(abs, loPct);
  const hi = Math.max(pick(abs, hiPct), lo + 1e-9);
  return { lo, hi };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Peak opacity of the strongest changes. */
const MAX_ALPHA = 1;

export function divergingScale(palettePolarity: string, maxAbs: number, ramp?: VisibilityRamp): DivergingScale {
  const interp = palettePolarity === "green_is_green" ? interpolateBrBG : interpolateRdBu;
  const positiveIsLow = palettePolarity === "warm_is_red"; // RdBu: 0 = red, 1 = blue
  // Use the palette from 10% to 90%: the darkest ends (maroon/navy/dark brown) look dim on the night-
  // dark globe, so the strongest changes glow in bright, still colour-blind-safe reds/blues/teals.
  const SPAN = 0.4;
  const t = (v: number) => {
    const x = Math.max(-1, Math.min(1, v / maxAbs));
    return positiveIsLow ? 0.5 - x * SPAN : 0.5 + x * SPAN;
  };
  const r = ramp ?? { lo: 0, hi: maxAbs };
  const alpha = (v: number) => MAX_ALPHA * smoothstep(r.lo, r.hi, Math.abs(v));
  const stops = Array.from({ length: 21 }, (_, i) => -maxAbs + (2 * maxAbs * i) / 20);
  const p = polarityFor(palettePolarity);
  return {
    maxAbs,
    color: (v) => interp(t(v)),
    alpha,
    gradient: `linear-gradient(to right, ${stops.map((s) => interp(t(s))).join(", ")})`,
    heatGradient: `linear-gradient(to right, ${stops
      .map((s) => {
        const c = interp(t(s)).replace(/^rgb\((.*)\)$/, "$1");
        return `rgba(${c}, ${Math.max(0.06, alpha(s)).toFixed(2)})`;
      })
      .join(", ")})`,
    negativeWord: p.downWord,
    positiveWord: p.upWord,
  };
}
