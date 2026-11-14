"use client";

import { Check, MapPin, SquareDashed } from "lucide-react";
import { useState } from "react";

import { ErrorState, LoadingState } from "@/components/async-state";
import { useRegionPresets } from "@/lib/api/hooks";
import { FEATURED_PRESETS, normaliseBox, type BBox, type RegionChoice } from "@/lib/region";
import type { RegionPreset } from "@/lib/schemas";

import { BoxDrawMap } from "./box-draw-map";

const order = (f: RegionPreset) => {
  const i = (FEATURED_PRESETS as readonly string[]).indexOf(f.properties.id);
  return i === -1 ? 99 : i;
};

function BoxInputs({ value, onChange }: { value: BBox | null; onChange: (b: BBox) => void }) {
  const labels = ["West (lon)", "South (lat)", "East (lon)", "North (lat)"] as const;
  const current = value ?? [-2.6, 5.8, -0.2, 7.7];
  return (
    <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <legend className="mb-2 text-sm text-muted-foreground">Or type the box edges in degrees</legend>
      {labels.map((label, i) => (
        <label key={label} className="flex flex-col gap-1 text-sm">
          {label}
          <input
            type="number"
            step="0.1"
            defaultValue={current[i]}
            onBlur={(e) => {
              const next = [...current] as BBox;
              next[i] = Number(e.currentTarget.value);
              if (next.every(Number.isFinite)) onChange(normaliseBox(next));
            }}
            className="tabular rounded-md border border-input bg-background px-3 py-2 text-base"
          />
        </label>
      ))}
    </fieldset>
  );
}

/** RegionPicker: preset regions (Kumasi, Ashanti, West Africa, …) or a drawn box. */
export function RegionPicker({ value, onChange }: { value: RegionChoice | null; onChange: (r: RegionChoice) => void }) {
  const presets = useRegionPresets();
  const [mode, setMode] = useState<"preset" | "box">(value?.kind === "bbox" ? "box" : "preset");

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="How to choose a place" className="flex gap-2">
        {(
          [
            ["preset", "Choose a place", MapPin],
            ["box", "Draw a box", SquareDashed],
          ] as const
        ).map(([m, label, Icon]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 font-medium ${
              mode === m ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"
            }`}
          >
            <Icon aria-hidden className="size-4" /> {label}
          </button>
        ))}
      </div>

      {mode === "preset" ? (
        presets.isPending ? (
          <LoadingState label="Loading places…" />
        ) : presets.isError ? (
          <ErrorState error={presets.error} onRetry={() => presets.refetch()} />
        ) : (
          <div role="radiogroup" aria-label="Places" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...presets.data.features]
              .sort((a, b) => order(a) - order(b))
              .map((f) => {
                const selected = value?.kind === "preset" && value.id === f.properties.id;
                return (
                  <button
                    key={f.properties.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange({ kind: "preset", id: f.properties.id })}
                    className={`flex items-start justify-between gap-3 rounded-xl border p-4 text-left transition-colors ${
                      selected ? "border-primary bg-primary/10" : "border-border bg-panel hover:border-primary/50"
                    }`}
                  >
                    <span>
                      <span className="block text-lg font-semibold">{f.properties.name}</span>
                      <span className="text-sm text-muted-foreground capitalize">{f.properties.kind}</span>
                    </span>
                    {selected ? <Check aria-hidden className="size-5 text-primary" /> : null}
                  </button>
                );
              })}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <BoxDrawMap
            value={value?.kind === "bbox" ? value.bbox : null}
            onChange={(bbox) => onChange({ kind: "bbox", bbox })}
          />
          <BoxInputs
            key={value?.kind === "bbox" ? value.bbox.join(",") : "none"}
            value={value?.kind === "bbox" ? value.bbox : null}
            onChange={(bbox) => onChange({ kind: "bbox", bbox })}
          />
        </div>
      )}
    </div>
  );
}
