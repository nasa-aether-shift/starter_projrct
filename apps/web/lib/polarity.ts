// Colour polarity comes from the variable catalog (`palette_polarity`): temperature warmer = red,
// rainfall wetter = blue, greenness greener = teal-green. Colours are ColorBrewer RdBu / BrBG light ends
// (colour-blind safe on the dark theme) and are always paired with an arrow, a sign and a word.

import type { Direction } from "@/lib/schemas";

export interface Polarity {
  upWord: string; // "warming"
  downWord: string; // "cooling"
  upColor: string;
  downColor: string;
}

const RED = "#ef8a62";
const BLUE = "#67a9cf";
const BROWN = "#d8b365";
const TEAL = "#5ab4ac";
export const NEUTRAL = "#a3a9b5";

const POLARITIES: Record<string, Polarity> = {
  warm_is_red: { upWord: "warming", downWord: "cooling", upColor: RED, downColor: BLUE },
  wet_is_blue: { upWord: "getting wetter", downWord: "getting drier", upColor: BLUE, downColor: BROWN },
  green_is_green: { upWord: "getting greener", downWord: "losing greenness", upColor: TEAL, downColor: BROWN },
};

const FALLBACK: Polarity = { upWord: "increasing", downWord: "decreasing", upColor: RED, downColor: BLUE };

export function polarityFor(palettePolarity: string | undefined): Polarity {
  return (palettePolarity && POLARITIES[palettePolarity]) || FALLBACK;
}

export function directionStyle(direction: Direction, polarity: Polarity): { color: string; word: string } {
  if (direction === "increasing") return { color: polarity.upColor, word: polarity.upWord };
  if (direction === "decreasing") return { color: polarity.downColor, word: polarity.downWord };
  return { color: NEUTRAL, word: "no clear trend" };
}
