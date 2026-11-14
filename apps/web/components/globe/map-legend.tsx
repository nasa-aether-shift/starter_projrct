"use client";

import { ChevronDown, Table2, X } from "lucide-react";
import { useState } from "react";

import { VariableIcon } from "@/components/variable-icon";
import type { DivergingScale } from "@/lib/colors";
import { decimalsFor, formatSigned, formatUnits } from "@/lib/format";
import type { TrendMap } from "@/lib/schemas";

import { MapTable } from "./map-table";

/** Signed colour legend + FDR dot key + table fallback for the trend map. */
export function MapLegend({
  map,
  scale,
  title,
  variableId,
  embedded = false,
  onHide,
  id,
}: {
  map: TrendMap;
  scale: DivergingScale;
  title: string;
  variableId?: string;
  /** Inside another panel: drop the legend's own glass chrome. */
  embedded?: boolean;
  /** When given, a collapse button sits next to "Table" (the parent renders the collapsed state). */
  onHide?: () => void;
  id?: string;
}) {
  const [table, setTable] = useState(false);
  const d = decimalsFor([scale.maxAbs]);
  // "degC per decade" → "°C"; NDVI ("index") has no unit.
  const units = formatUnits(map.units_per_decade.replace(/ per decade$/, ""));
  return (
    <div
      id={id}
      className={`flex max-w-full flex-col gap-2 text-white ${
        embedded
          ? "w-full"
          : "w-[22rem] rounded-2xl border border-white/10 bg-black/60 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-md"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="mr-auto flex items-center gap-2.5 font-semibold">
          {variableId ? <VariableIcon id={variableId} size="sm" /> : null}
          {title}
        </p>
        <button
          type="button"
          onClick={() => setTable((v) => !v)}
          aria-pressed={table}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-white/80 hover:bg-white/10"
        >
          {table ? <X aria-hidden className="size-4" /> : <Table2 aria-hidden className="size-4" />}
          {table ? "Close table" : "Table"}
        </button>
        {onHide ? (
          <button
            type="button"
            onClick={onHide}
            aria-label={`Hide ${title.toLowerCase()} legend`}
            aria-controls={id}
            title="Hide"
            className="-mr-1 grid size-8 shrink-0 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
          >
            <ChevronDown aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
      <p className="text-sm text-white/70">West Africa · change per decade{units ? ` (${units})` : ""}</p>
      <div
        aria-hidden
        className="h-3 rounded-full ring-1 ring-white/10"
        style={{
          background: `${scale.heatGradient}, repeating-conic-gradient(#1b2233 0 25%, #10151f 0 50%) 0 0 / 8px 8px`,
        }}
      />
      <div className="tabular flex justify-between text-sm">
        <span>{formatSigned(-scale.maxAbs, d)}</span>
        <span>0</span>
        <span>{formatSigned(scale.maxAbs, d)}</span>
      </div>
      <div className="flex justify-between text-sm text-white/80">
        <span>← {scale.negativeWord}</span>
        <span>{scale.positiveWord} →</span>
      </div>
      <p className="flex items-center gap-2 text-sm text-white/80">
        <span aria-hidden className="inline-block size-2.5 rounded-full border border-black/70 bg-white" />
        Glow marks the strongest changes in this region; clear areas changed less (hover for any spot). Dot =
        significant after false-discovery control (q = {map.fdr_level}).
      </p>
      {table ? (
        <div className="mt-2 rounded-lg bg-card p-3 text-card-foreground">
          <MapTable map={map} />
        </div>
      ) : null}
    </div>
  );
}
