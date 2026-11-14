"use client";

import { ArrowLeft, ArrowRight, Loader2, Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ErrorState, LoadingState } from "@/components/async-state";
import { RegionPicker } from "@/components/region/region-picker";
import { Button } from "@/components/ui/button";
import { useRegionPresets, useRunTrend, useVariableSearch, useVariables } from "@/lib/api/hooks";
import { formatBox, regionFromSearch, writeRegion, type RegionChoice } from "@/lib/region";
import { rankVariables } from "@/lib/variable-match";

import { VariableStep, type Suggestion } from "./variable-step";

const STEPS = ["Question", "Variable", "Place", "Period", "Results"] as const;
/** Last full year of data the demo cache covers. */
const LAST_YEAR = 2025;

export function Wizard() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const step = Math.min(5, Math.max(1, Number(search.get("step")) || 1));
  const q = search.get("q") ?? "";
  const variableId = search.get("variable");
  const region = regionFromSearch(search);

  const variables = useVariables();
  const presets = useRegionPresets();
  const searchResult = useVariableSearch(q);
  const run = useRunTrend();
  const [draftQ, setDraftQ] = useState(q);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const update = (changes: Record<string, string | null>, nextRegion?: RegionChoice | null) => {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    if (nextRegion !== undefined) writeRegion(params, nextRegion);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };
  const go = (n: number) => update({ step: String(n) });

  // Move focus to the step heading so screen-reader and keyboard users land on the new step.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const variable = variables.data?.find((v) => v.id === variableId) ?? null;

  const { suggestions, source } = useMemo((): { suggestions: Suggestion[]; source: "search" | "keywords" | "none" } => {
    const all = variables.data ?? [];
    if (searchResult.data?.length) {
      const ids = searchResult.data;
      const ranked = [...all].sort((a, b) => (ids.indexOf(a.id) + 1 || 99) - (ids.indexOf(b.id) + 1 || 99));
      return { suggestions: ranked.map((v) => ({ variable: v, best: v.id === ids[0] })), source: "search" };
    }
    const ranked = rankVariables(q, all);
    const top = ranked[0]?.score ?? 0;
    return {
      suggestions: ranked.map((r) => ({ variable: r.variable, best: top > 0 && r.score === top })),
      source: top > 0 ? "keywords" : "none",
    };
  }, [variables.data, searchResult.data, q]);

  const coverageStart = variable?.coverage?.start ?? "1981-01";
  const firstYear = Number(coverageStart.slice(0, 4));
  const startYear = Number((search.get("start") ?? coverageStart).slice(0, 4));
  const endYear = Number((search.get("end") ?? `${LAST_YEAR}-12`).slice(0, 4));
  const startParam = startYear === firstYear ? coverageStart : `${startYear}-01`;
  const endParam = `${endYear}-12`;
  const years = endYear - startYear + 1;

  const regionName =
    region?.kind === "preset"
      ? (presets.data?.features.find((f) => f.properties.id === region.id)?.properties.name ?? region.id)
      : region?.kind === "bbox"
        ? `Box ${formatBox(region.bbox)}`
        : "";

  const submit = () => {
    if (!variable || !region) return;
    run.mutate(
      {
        variable_id: variable.id,
        region_id: region.kind === "preset" ? region.id : null,
        bbox: region.kind === "bbox" ? region.bbox : null,
        start: startParam,
        end: endParam,
        alpha: 0.05,
      },
      {
        onSuccess: (result) => {
          const params = new URLSearchParams({ variable: variable.id, start: startParam, end: endParam });
          writeRegion(params, region);
          router.push(`/analysis/${encodeURIComponent(result.run_id)}?${params.toString()}`);
        },
      },
    );
  };

  const canNext =
    (step === 1 && draftQ.trim().length > 0) ||
    (step === 2 && variable !== null) ||
    (step === 3 && region !== null) ||
    (step === 4 && startYear <= endYear);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
      <nav aria-label="Investigation steps">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const state = n === step ? "current" : n < step ? "done" : "todo";
            return (
              <li key={label}>
                <button
                  type="button"
                  disabled={n > step}
                  aria-current={state === "current" ? "step" : undefined}
                  onClick={() => go(n)}
                  className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-base ${
                    state === "current"
                      ? "border-primary bg-primary text-primary-foreground"
                      : state === "done"
                        ? "border-primary/50 text-foreground"
                        : "border-border text-muted-foreground"
                  }`}
                >
                  <span className="tabular font-semibold">{n}</span> {label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-labelledby="step-heading" className="flex flex-col gap-6">
        <h1 id="step-heading" ref={headingRef} tabIndex={-1} className="text-3xl font-bold outline-none sm:text-4xl">
          {step === 1 && "What do you want to find out?"}
          {step === 2 && "Which measurement answers it?"}
          {step === 3 && "Where?"}
          {step === 4 && "Over which years?"}
          {step === 5 && "Ready to investigate"}
        </h1>

        {step === 1 ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (draftQ.trim()) update({ q: draftQ.trim(), step: "2" });
            }}
          >
            <label htmlFor="question" className="sr-only">
              Your question
            </label>
            <div className="relative">
              <Search aria-hidden className="absolute top-4 left-4 size-6 text-muted-foreground" />
              <textarea
                id="question"
                value={draftQ}
                onChange={(e) => setDraftQ(e.target.value)}
                rows={2}
                maxLength={300}
                placeholder="Is Kumasi getting hotter?"
                className="w-full resize-none rounded-2xl border border-input bg-panel py-3.5 pr-4 pl-14 text-xl"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="py-1.5 text-muted-foreground">Try:</span>
              {(variables.data ?? [])
                .flatMap((v) => v.typical_questions.slice(0, 1))
                .map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => setDraftQ(ex)}
                    className="rounded-full border border-border px-4 py-1.5 hover:border-primary/60"
                  >
                    {ex}
                  </button>
                ))}
            </div>
            <Button type="submit" size="lg" className="h-12 w-fit px-6 text-lg" disabled={!canNext}>
              Find the right data <ArrowRight aria-hidden />
            </Button>
          </form>
        ) : null}

        {step === 2 ? (
          variables.isPending ? (
            <LoadingState label="Loading variables…" />
          ) : variables.isError ? (
            <ErrorState error={variables.error} onRetry={() => variables.refetch()} />
          ) : (
            <>
              {q ? <p className="text-lg">“{q}”</p> : null}
              <VariableStep
                suggestions={suggestions}
                selected={variableId}
                onSelect={(id) => update({ variable: id, start: null, end: null })}
                source={source}
              />
            </>
          )
        ) : null}

        {step === 3 ? <RegionPicker value={region} onChange={(r) => update({}, r)} /> : null}

        {step === 4 && variable ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-4">
              {(
                [
                  ["From", startYear, "start", (y: number) => (y === firstYear ? coverageStart : `${y}-01`)],
                  ["To", endYear, "end", (y: number) => `${y}-12`],
                ] as const
              ).map(([label, val, key, toParam]) => (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-muted-foreground">{label}</span>
                  <select
                    value={val}
                    onChange={(e) => update({ [key]: toParam(Number(e.target.value)) })}
                    className="tabular rounded-lg border border-input bg-panel px-4 py-2.5 text-lg"
                  >
                    {Array.from({ length: LAST_YEAR - firstYear + 1 }, (_, i) => firstYear + i).map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-muted-foreground">
              {variable.name.en} data start in {coverageStart.slice(0, 4)}. Longer records give more reliable answers.
            </p>
            {startYear > endYear ? (
              <p role="alert" className="text-destructive">
                The start year must be before the end year.
              </p>
            ) : variable.recommended_min_years && years < variable.recommended_min_years ? (
              <p role="note" className="rounded-lg border border-warning/50 bg-warning/10 p-3">
                {years} years is short: trends are less reliable under {variable.recommended_min_years} years.
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 5 && variable && region ? (
          <div className="flex flex-col gap-5">
            <dl className="grid gap-3 rounded-2xl border border-border bg-panel p-5 text-lg sm:grid-cols-[10rem_1fr]">
              <dt className="text-muted-foreground">Question</dt>
              <dd>{q || "—"}</dd>
              <dt className="text-muted-foreground">Variable</dt>
              <dd>{variable.name.en}</dd>
              <dt className="text-muted-foreground">Place</dt>
              <dd>{regionName}</dd>
              <dt className="text-muted-foreground">Period</dt>
              <dd className="tabular">
                {startParam} to {endParam}
              </dd>
            </dl>
            {run.isError ? <ErrorState error={run.error} onRetry={submit} /> : null}
            <Button size="lg" className="h-14 w-fit px-8 text-lg" onClick={submit} disabled={run.isPending}>
              {run.isPending ? (
                <>
                  <Loader2 aria-hidden className="animate-spin" /> Analysing {years} years of data…
                </>
              ) : (
                <>
                  Run the analysis <ArrowRight aria-hidden />
                </>
              )}
            </Button>
          </div>
        ) : null}

        {step === 5 && (!variable || !region) ? (
          <ErrorState error={new Error("Choose a variable and a place first.")} />
        ) : null}
      </section>

      {step > 1 ? (
        <div className="flex gap-3 border-t border-border pt-6">
          <Button variant="outline" size="lg" onClick={() => go(step - 1)}>
            <ArrowLeft aria-hidden /> Back
          </Button>
          {step < 5 ? (
            <Button size="lg" onClick={() => go(step + 1)} disabled={!canNext}>
              Next <ArrowRight aria-hidden />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
