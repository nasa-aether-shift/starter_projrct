"use client";

import { ArrowRight, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";

import { VerdictCard } from "@/components/analysis/verdict-card";
import { ErrorState, LoadingState } from "@/components/async-state";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { Button } from "@/components/ui/button";
import type { TrendResult, Variable } from "@/lib/schemas";

export interface PanelState {
  open: boolean;
  title: string;
  pending: boolean;
  error: unknown;
  result: TrendResult | undefined;
  analysisHref: string | null;
}

/** Slide-in results: verdict, the series for the clicked place, and a link to the full analysis. */
export function ResultsPanel({
  state,
  variable,
  onClose,
  onRetry,
}: {
  state: PanelState;
  variable: Variable | undefined;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <AnimatePresence>
      {state.open ? (
        <motion.aside
          key="results"
          aria-label="Results"
          initial={{ x: "100%", opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "tween", ease: [0.22, 1, 0.36, 1], duration: 0.45 }}
          className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[36rem] flex-col gap-4 overflow-y-auto border-l border-border bg-background/95 p-5 shadow-2xl backdrop-blur sm:p-6"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-semibold">{state.title}</h2>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close results">
              <X aria-hidden />
            </Button>
          </div>
          <div aria-live="polite" className="flex flex-col gap-5">
            {state.pending ? (
              <LoadingState label="Analysing this place…" lines={6} />
            ) : state.error ? (
              <ErrorState error={state.error} onRetry={onRetry} />
            ) : state.result ? (
              <>
                <VerdictCard result={state.result} variable={variable} compact />
                <TimeSeriesChart result={state.result} palettePolarity={variable?.palette_polarity} height={360} />
                {state.analysisHref ? (
                  <Button asChild size="lg" className="w-fit">
                    <Link href={state.analysisHref}>
                      Open the full analysis <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
