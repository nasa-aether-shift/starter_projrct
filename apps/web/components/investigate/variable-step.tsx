"use client";

import { CheckCircle2, Circle, Sparkles, TriangleAlert } from "lucide-react";

import { DefinitionCard } from "@/components/definition-card";
import { VariableIcon } from "@/components/variable-icon";
import type { Variable } from "@/lib/schemas";
import { variableMeta } from "@/lib/variable-meta";

export interface Suggestion {
  variable: Variable;
  best: boolean;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-medium break-words">{value}</dd>
    </div>
  );
}

function VariableCard({
  variable,
  best,
  selected,
  onSelect,
}: {
  variable: Variable;
  best: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = variableMeta(variable.id);
  const titleId = `var-${variable.id}-title`;
  const spatial = variable.resolution ? `${String(variable.resolution.spatial_deg).replace(/\s*x\s*/i, "×")}°` : "–";
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 ${
        selected ? "shadow-[0_0_0_2px_var(--ring),0_12px_40px_rgba(0,0,0,0.35)]" : "hover:shadow-lg"
      }`}
      style={{ borderColor: selected ? "var(--ring)" : undefined }}
    >
      {/* Accent wash behind the header */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-28"
        style={{
          background: `linear-gradient(180deg, color-mix(in oklab, ${meta.accent} 22%, transparent), transparent)`,
        }}
      />

      <div className="relative flex items-start gap-4 p-5 pb-3">
        <VariableIcon id={variable.id} size="lg" active={selected} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {best ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
                <Sparkles aria-hidden className="size-3" /> Best match
              </span>
            ) : null}
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
              {variable.model_or_measurement === "model" ? "Model estimate" : "Satellite measurement"}
            </span>
          </div>
          <h3 id={titleId} className="mt-1.5 text-xl leading-snug font-semibold">
            {/* The whole card is the hit area: this radio stretches over it via the ::after overlay. */}
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-describedby={`${titleId}-def`}
              onClick={onSelect}
              className="text-left outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-3 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
            >
              {variable.name.en}
            </button>
          </h3>
          <p className="text-sm text-muted-foreground">{meta.program}</p>
        </div>
        {selected ? (
          <CheckCircle2 aria-hidden className="size-7 shrink-0 text-primary" />
        ) : (
          <Circle aria-hidden className="size-7 shrink-0 text-muted-foreground/50" />
        )}
      </div>

      <div id={`${titleId}-def`} className="pointer-events-none relative z-10 px-5 [&_button]:pointer-events-auto">
        <DefinitionCard variable={variable} compact />
      </div>

      <dl className="relative mx-5 mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4">
        <Fact label="Since" value={variable.coverage ? variable.coverage.start.slice(0, 4) : "–"} />
        <Fact label="Grid" value={spatial} />
        <Fact label="From" value={variable.source.provider} />
      </dl>

      {variable.caveats[0] ? (
        <p className="relative mt-auto flex items-start gap-2 px-5 pt-4 pb-5 text-sm text-muted-foreground">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          {variable.caveats[0]}
        </p>
      ) : (
        <div className="pb-5" />
      )}
    </div>
  );
}

/** Suggested variable cards: radio semantics, best matches first. */
export function VariableStep({
  suggestions,
  selected,
  onSelect,
  source,
}: {
  suggestions: Suggestion[];
  selected: string | null;
  onSelect: (id: string) => void;
  source: "search" | "keywords" | "none";
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground">
        {source === "none"
          ? "Pick the measurement that fits your question."
          : "Ranked by how well each one fits your question" + (source === "keywords" ? " (keyword match)." : ".")}
      </p>
      <div role="radiogroup" aria-label="Variables" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {suggestions.map(({ variable, best }) => (
          <VariableCard
            key={variable.id}
            variable={variable}
            best={best}
            selected={selected === variable.id}
            onSelect={() => onSelect(variable.id)}
          />
        ))}
      </div>
    </div>
  );
}
