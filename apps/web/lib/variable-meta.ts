// Visual identity per variable (icon, short label, accent). Accents reuse the colour-blind-safe
// trend palette and are decorative only: always shown with an icon and a text label.

import { CloudRain, Leaf, Thermometer, Waves, type LucideIcon } from "lucide-react";

export interface VariableMeta {
  short: string;
  Icon: LucideIcon;
  /** Accent hex (ColorBrewer RdBu / BrBG light ends). */
  accent: string;
  /** Program behind the data, for a one-line subtitle. */
  program: string;
  /** Catalog palette polarity, for previewing the map's colour scale. */
  polarity: string;
  /** One-line caption of what the globe layer shows. */
  caption: string;
}

const META: Record<string, VariableMeta> = {
  merra2_t2m: {
    short: "Temperature",
    Icon: Thermometer,
    accent: "#ef8a62",
    program: "MERRA-2",
    polarity: "warm_is_red",
    caption: "How fast the air is warming or cooling",
  },
  gpm_precip: {
    short: "Rainfall",
    Icon: CloudRain,
    accent: "#67a9cf",
    program: "GPM IMERG",
    polarity: "wet_is_blue",
    caption: "Where rain is increasing or decreasing",
  },
  modis_ndvi: {
    short: "Greenness",
    Icon: Leaf,
    accent: "#5ab4ac",
    program: "MODIS NDVI",
    polarity: "green_is_green",
    caption: "Where plants are getting greener or browner",
  },
};

const FALLBACK: VariableMeta = {
  short: "Variable",
  Icon: Waves,
  accent: "#a3a9b5",
  program: "NASA",
  polarity: "",
  caption: "Change per decade",
};

export function variableMeta(id: string): VariableMeta {
  return META[id] ?? FALLBACK;
}
