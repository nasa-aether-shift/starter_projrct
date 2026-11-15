"use client";

import { motion } from "framer-motion";
import { useRef, type KeyboardEvent } from "react";

import { VariableIcon } from "@/components/variable-icon";
import { divergingScale } from "@/lib/colors";
import { variableMeta } from "@/lib/variable-meta";

export const MAP_VARIABLES = [
  { id: "merra2_t2m", label: "Temperature" },
  { id: "gpm_precip", label: "Rainfall" },
  { id: "modis_evi", label: "Greenness" },
] as const;

export type MapVariableId = (typeof MAP_VARIABLES)[number]["id"];

export const isMapVariable = (v: string | null): v is MapVariableId => MAP_VARIABLES.some((m) => m.id === v);

/**
 * Segmented variable picker for the globe. Proper radio group: one tab stop, arrow keys move the
 * selection, the active pill glides between options (instant with reduced motion).
 */
export function VariableSwitcher({
  value,
  onChange,
  layoutId = "variable-pill",
  layout = "row",
  embedded = false,
}: {
  value: MapVariableId;
  onChange: (v: MapVariableId) => void;
  /** Unique per page if two switchers are ever shown together. */
  layoutId?: string;
  /** "stacked" puts the icon above the label for narrow panels. */
  layout?: "row" | "stacked";
  /** Inside another panel: drop the switcher's own glass chrome. */
  embedded?: boolean;
}) {
  const stacked = layout === "stacked";
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = MAP_VARIABLES.length;
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % n
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(MAP_VARIABLES[next]!.id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Variable shown on the globe"
      className={`grid grid-cols-3 gap-1 p-1 ${
        embedded
          ? "rounded-xl bg-white/[0.04] ring-1 ring-white/10"
          : "rounded-2xl border border-white/10 bg-black/55 p-1.5 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-md"
      }`}
    >
      {MAP_VARIABLES.map(({ id, label }, i) => {
        const active = value === id;
        const meta = variableMeta(id);
        const swatch = divergingScale(meta.polarity, 1).gradient;
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(e) => onKey(e, i)}
            title={meta.caption}
            className={`group/opt relative flex min-w-0 rounded-xl outline-offset-2 transition-colors hover:bg-white/[0.06] ${
              stacked
                ? "flex-col items-center gap-1.5 px-1.5 py-2.5 text-center"
                : "items-center gap-2.5 px-2.5 py-2 text-left"
            }`}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                aria-hidden
                className="absolute inset-0 rounded-xl border"
                style={{
                  background: `linear-gradient(135deg, color-mix(in oklab, ${meta.accent} 26%, transparent), rgba(255,255,255,0.04))`,
                  borderColor: `color-mix(in oklab, ${meta.accent} 55%, transparent)`,
                  boxShadow: `0 0 28px -8px ${meta.accent}, inset 0 1px 0 rgba(255,255,255,0.08)`,
                }}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
              />
            ) : null}
            <span className="relative">
              <VariableIcon id={id} size="sm" active={active} />
            </span>
            <span className={`relative min-w-0 leading-tight ${stacked ? "w-full" : ""}`}>
              <span className={`block truncate text-base font-semibold ${active ? "text-white" : "text-white/75"}`}>
                {label}
              </span>
              <span className={`truncate text-xs text-white/55 ${stacked ? "block" : "hidden sm:block"}`}>
                {meta.program}
              </span>
              {/* Preview of this layer's colour scale, tying the switcher to the legend. */}
              <span
                aria-hidden
                className={`mt-1.5 block h-1 rounded-full transition-opacity ${
                  active ? "opacity-100" : "opacity-35 group-hover/opt:opacity-70"
                } ${stacked ? "mx-auto w-4/5" : "w-full"}`}
                style={{ background: swatch }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
