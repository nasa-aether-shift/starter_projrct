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
import { YearSelect } from "./year-select";

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
  const [questionSuggestionsOpen, setQuestionSuggestionsOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
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
  const chooseQuestionSuggestion = (question: string) => {
    setDraftQ(question);
    setQuestionSuggestionsOpen(false);
    setActiveSuggestionIndex(-1);
    update({ q: question, variable: null, start: null, end: null, step: "2" });
  };

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

  const questionSuggestions = useMemo(() => {
    const all = variables.data ?? [];
    const words = [...new Set(draftQ.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])];
    if (!draftQ.trim()) return [];
    const variableScores = new Map(
      rankVariables(draftQ, all)
        .filter(({ score }) => score > 0)
        .map(({ variable, score }) => [variable.id, score]),
    );
    const rankedQuestions = all.flatMap((variable) =>
      variable.typical_questions.map((question) => ({
        question,
        score:
          words.filter((word) => question.toLowerCase().includes(word)).length + (variableScores.get(variable.id) ?? 0),
      })),
    );

    return rankedQuestions
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ question }) => question);
  }, [draftQ, variables.data]);
  const showQuestionSuggestions = questionSuggestionsOpen && Boolean(draftQ.trim()) && questionSuggestions.length > 0;

  const activitySuggestions = useMemo(() => {
    const seen = new Set<string>();
    return (variables.data ?? [])
      .flatMap((item) =>
        item.typical_questions.slice(0, 1).map((question) => ({
          id: item.id,
          title: item.name.en,
          question,
        })),
      )
      .filter(({ question }) => {
        if (seen.has(question)) return false;
        seen.add(question);
        return true;
      })
      .slice(0, 3);
  }, [variables.data]);

  const coverageStart = variable?.coverage?.start ?? "1981-01";
  const firstYear = Number(coverageStart.slice(0, 4));
  const startYear = Number((search.get("start") ?? coverageStart).slice(0, 4));
  const endYear = Number((search.get("end") ?? `${LAST_YEAR}-12`).slice(0, 4));
  const startParam = startYear === firstYear ? coverageStart : `${startYear}-01`;
  const endParam = `${endYear}-12`;
  const years = endYear - startYear + 1;
  const yearOptions = Array.from({ length: LAST_YEAR - firstYear + 1 }, (_, i) => firstYear + i);

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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-5 sm:px-6">
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
                  className={`relative flex items-center gap-2 px-4 py-1.5 text-base transition-colors duration-200 ${
                    state === "current"
                      ? "font-bold text-foreground"
                      : state === "done"
                        ? "font-semibold text-foreground"
                        : "font-normal text-muted-foreground"
                  }`}
                >
                  <span className="tabular">{n}</span> {label}
                  <span
                    aria-hidden
                    className={`absolute inset-x-2 -bottom-0.5 h-0.5 origin-left rounded-full bg-primary transition-transform duration-300 ease-out ${
                      state === "current" ? "scale-x-100" : "scale-x-0"
                    }`}
                  />
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
              <Search aria-hidden className="absolute top-3.5 left-4 size-6 text-muted-foreground" />
              <textarea
                id="question"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={showQuestionSuggestions}
                aria-controls={showQuestionSuggestions ? "question-suggestions" : undefined}
                aria-activedescendant={
                  showQuestionSuggestions && activeSuggestionIndex >= 0
                    ? `question-suggestion-${activeSuggestionIndex}`
                    : undefined
                }
                value={draftQ}
                onChange={(e) => {
                  setDraftQ(e.target.value);
                  setQuestionSuggestionsOpen(true);
                  setActiveSuggestionIndex(-1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setQuestionSuggestionsOpen(false);
                    setActiveSuggestionIndex(-1);
                  } else if (showQuestionSuggestions && event.key === "ArrowDown") {
                    event.preventDefault();
                    setActiveSuggestionIndex((index) => (index + 1) % questionSuggestions.length);
                  } else if (showQuestionSuggestions && event.key === "ArrowUp") {
                    event.preventDefault();
                    setActiveSuggestionIndex((index) => (index <= 0 ? questionSuggestions.length - 1 : index - 1));
                  } else if (showQuestionSuggestions && event.key === "Enter" && activeSuggestionIndex >= 0) {
                    event.preventDefault();
                    const selected = questionSuggestions[activeSuggestionIndex];
                    if (selected) chooseQuestionSuggestion(selected);
                  }
                }}
                rows={1}
                maxLength={300}
                placeholder="Is Kumasi getting hotter?"
                className="w-full resize-none rounded-2xl border border-input bg-panel py-3 pr-4 pl-14 text-xl focus-visible:outline-2 focus-visible:outline-offset-1"
              />
              {showQuestionSuggestions ? (
                <div
                  id="question-suggestions"
                  role="listbox"
                  aria-label="Suggested questions"
                  className="absolute top-full right-0 left-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-xl"
                >
                  {questionSuggestions.map((suggestion, index) => (
                    <button
                      key={`${suggestion}-${index}`}
                      type="button"
                      id={`question-suggestion-${index}`}
                      role="option"
                      aria-selected={activeSuggestionIndex === index}
                      tabIndex={-1}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveSuggestionIndex(index)}
                      onClick={() => chooseQuestionSuggestion(suggestion)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                        activeSuggestionIndex === index ? "bg-accent" : "hover:bg-accent"
                      }`}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <section aria-labelledby="what-to-try-heading" className="flex flex-col gap-3">
              <div>
                <h2 id="what-to-try-heading" className="text-lg font-semibold">
                  What to try
                </h2>
                <p className="text-sm text-muted-foreground">
                  Choose an activity to start; we’ll take you to place selection.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {activitySuggestions.map((activity) => (
                  <button
                    key={activity.id}
                    type="button"
                    onClick={() => {
                      setDraftQ(activity.question);
                      setQuestionSuggestionsOpen(false);
                      update({ q: activity.question, variable: activity.id, start: null, end: null, step: "3" });
                    }}
                    className="flex flex-col items-start gap-2 rounded-xl border border-border bg-panel p-4 text-left transition-colors hover:border-primary/60 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span className="text-sm font-semibold">{activity.title}</span>
                    <span className="text-sm text-muted-foreground">{activity.question}</span>
                  </button>
                ))}
              </div>
            </section>
            <Button type="submit" size="lg" className="h-12 w-fit px-6 text-lg" disabled={!canNext}>
              Find the right data
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
                  <YearSelect
                    label={label}
                    value={val}
                    years={yearOptions}
                    onChange={(year) => update({ [key]: toParam(year) })}
                  />
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
                "Run the analysis"
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
