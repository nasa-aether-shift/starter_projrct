"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { ErrorState, LoadingState } from "@/components/async-state";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { ScopeStatement } from "@/components/scope-statement";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api/errors";
import { useNarrative, useRun, useTrend, useVariable } from "@/lib/api/hooks";
import { regionFromSearch } from "@/lib/region";
import type { TrendRequest } from "@/lib/schemas";

import { CaveatList } from "./caveat-list";
import { CsvDownload } from "./csv-download";
import { ProvenancePanel } from "./provenance-panel";
import { TaleOfTwoRegions } from "./tale-of-two-regions";
import { VerdictCard } from "./verdict-card";

const TABS = [
  { id: "verdict", label: "Verdict" },
  { id: "series", label: "Time series" },
  { id: "opposite", label: "Opposite trends" },
  { id: "method", label: "Method & provenance" },
  { id: "download", label: "Download" },
] as const;
type TabId = (typeof TABS)[number]["id"];
const isTab = (v: string | null): v is TabId => TABS.some((t) => t.id === v);

/** The request that produced this run, kept in the URL so the page can re-run it if the API forgot the run. */
function requestFromSearch(search: URLSearchParams): TrendRequest | null {
  const variable = search.get("variable");
  const region = regionFromSearch(search);
  if (!variable || !region) return null;
  return {
    variable_id: variable,
    region_id: region.kind === "preset" ? region.id : null,
    bbox: region.kind === "bbox" ? region.bbox : null,
    start: search.get("start"),
    end: search.get("end"),
    alpha: 0.05,
  };
}

export function AnalysisView() {
  const { runId } = useParams<{ runId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: TabId = isTab(search.get("tab")) ? (search.get("tab") as TabId) : "verdict";

  const run = useRun(runId);
  const rerunRequest = requestFromSearch(search);
  const runMissing = run.error instanceof ApiError && run.error.status === 404;
  const rerun = useTrend(runMissing ? rerunRequest : null);
  const result = run.data ?? rerun.data;

  // A re-run gets a fresh run_id: put it in the URL so links and the CSV button use it.
  useEffect(() => {
    if (rerun.data && rerun.data.run_id !== runId) {
      router.replace(`/analysis/${encodeURIComponent(rerun.data.run_id)}?${search.toString()}`, { scroll: false });
    }
  }, [rerun.data, runId, router, search]);

  const variable = useVariable(result?.variable.id ?? null);
  const narrative = useNarrative(result ? { run_id: result.run_id, level: "student", use_ai: true } : null);

  const setTab = (next: string) => {
    const params = new URLSearchParams(search.toString());
    params.set("tab", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  if (!result) {
    const pending = run.isPending || (runMissing && rerunRequest !== null && rerun.isPending);
    return (
      <Shell>
        {pending ? (
          <LoadingState label="Loading the analysis…" lines={5} />
        ) : runMissing && rerunRequest === null ? (
          <ErrorState
            error={
              new ApiError(404, {
                title: "This analysis is no longer available",
                detail: "Results are kept for a limited time. Start a new investigation to run it again.",
              })
            }
          />
        ) : (
          <ErrorState
            error={rerun.error ?? run.error}
            onRetry={() => (rerun.error ? rerun.refetch() : run.refetch())}
          />
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold sm:text-4xl">
          {result.variable.name} <span className="text-muted-foreground">in</span> {result.region.name}
        </h1>
        {variable.data ? <CaveatList caveats={variable.data.caveats} /> : null}
      </header>

      <ScopeStatement />

      <Tabs value={tab} onValueChange={setTab} className="gap-5">
        <TabsList
          variant="line"
          className="h-auto w-full flex-wrap justify-start gap-1 border-b border-border pb-1 group-data-horizontal/tabs:h-auto"
        >
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="flex-none px-4 py-2 text-base">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="verdict">
          <VerdictCard
            result={result}
            variable={variable.data}
            narrative={narrative.isSuccess ? narrative.data : undefined}
          />
        </TabsContent>

        <TabsContent value="series">
          <TimeSeriesChart result={result} palettePolarity={variable.data?.palette_polarity} />
        </TabsContent>

        <TabsContent value="opposite">
          {variable.data ? (
            <TaleOfTwoRegions variable={variable.data} />
          ) : variable.isError ? (
            <ErrorState error={variable.error} onRetry={() => variable.refetch()} />
          ) : (
            <LoadingState />
          )}
        </TabsContent>

        <TabsContent value="method">
          <ProvenancePanel result={result} variable={variable.data} />
        </TabsContent>

        <TabsContent value="download">
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground">
              Monthly values, season-removed anomalies and the trend line as CSV, so anyone can check the result.
            </p>
            <CsvDownload runId={result.run_id} />
            <p className="text-sm text-muted-foreground">
              Run ID <code className="font-mono">{result.run_id}</code>
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6">
      <Link
        href="/investigate"
        className="flex w-fit items-center gap-2 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" /> New investigation
      </Link>
      {children}
    </div>
  );
}
