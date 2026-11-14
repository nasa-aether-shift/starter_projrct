"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import {
  healthSchema,
  narrativeSchema,
  oppositeTrendsSchema,
  regionPresetsSchema,
  trendMapSchema,
  trendResultSchema,
  variableSchema,
  variablesSchema,
  type NarrativeRequest,
  type PointRequest,
  type TrendRequest,
  type TrendResult,
} from "@/lib/schemas";

import { apiGet, apiPost } from "./client";
import { ApiError } from "./errors";

const STATIC = { staleTime: Infinity, gcTime: Infinity } as const;
const enc = encodeURIComponent;

export const queryKeys = {
  health: ["health"] as const,
  variables: ["variables"] as const,
  variable: (id: string) => ["variables", id] as const,
  presets: ["regions", "presets"] as const,
  trend: (req: TrendRequest) => ["trend", req] as const,
  run: (runId: string) => ["runs", runId] as const,
  trendMap: (variable: string, region: string) => ["trend-map", variable, region] as const,
  opposite: (variable: string, region: string) => ["opposite-trends", variable, region] as const,
  narrative: (req: NarrativeRequest) => ["narrative", req] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => apiGet("/health", healthSchema, signal),
    retry: 0,
  });
}

export function useVariables() {
  return useQuery({
    queryKey: queryKeys.variables,
    queryFn: ({ signal }) => apiGet("/variables", variablesSchema, signal),
    ...STATIC,
  });
}

export function useVariable(id: string | null) {
  return useQuery({
    queryKey: queryKeys.variable(id ?? ""),
    queryFn: ({ signal }) => apiGet(`/variables/${enc(id ?? "")}`, variableSchema, signal),
    enabled: Boolean(id),
    ...STATIC,
  });
}

export function useRegionPresets() {
  return useQuery({
    queryKey: queryKeys.presets,
    queryFn: ({ signal }) => apiGet("/regions/presets", regionPresetsSchema, signal),
    ...STATIC,
  });
}

/** POST /trend is deterministic for a request, so it is cached as a query. */
export function useTrend(req: TrendRequest | null) {
  return useQuery({
    queryKey: queryKeys.trend(req ?? ({} as TrendRequest)),
    queryFn: ({ signal }) => apiPost("/trend", req, trendResultSchema, signal),
    enabled: req !== null,
    staleTime: Infinity,
  });
}

export function useRun(runId: string | null) {
  return useQuery({
    queryKey: queryKeys.run(runId ?? ""),
    queryFn: ({ signal }) => apiGet(`/runs/${enc(runId ?? "")}`, trendResultSchema, signal),
    enabled: Boolean(runId),
    staleTime: Infinity,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });
}

/** Remember a result under its run_id so /analysis/[runId] opens instantly without a refetch. */
function useRememberRun() {
  const qc = useQueryClient();
  return (result: TrendResult) => qc.setQueryData(queryKeys.run(result.run_id), result);
}

export function useTrendAtPoint() {
  const remember = useRememberRun();
  return useMutation({
    mutationFn: (req: PointRequest) => apiPost("/trend-at-point", req, trendResultSchema),
    onSuccess: remember,
  });
}

/** POST /trend as an explicit action (wizard "Run the analysis"). */
export function useRunTrend() {
  const remember = useRememberRun();
  return useMutation({
    mutationFn: (req: TrendRequest) => apiPost("/trend", req, trendResultSchema),
    onSuccess: remember,
  });
}

// POST /variables/search is a SHOULD endpoint with no agreed response shape yet. Accept a list of
// variables/ids, or {results: [...]}, and return ids in rank order. Any failure → keyword fallback.
const idItem = z.union([z.string(), z.object({ id: z.string() }), z.object({ variable_id: z.string() })]);
const searchSchema = z
  .union([z.array(idItem), z.object({ results: z.array(idItem) })])
  .transform((v) => (Array.isArray(v) ? v : v.results))
  .transform((items) => items.map((i) => (typeof i === "string" ? i : "id" in i ? i.id : i.variable_id)));

export function useVariableSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ["variables", "search", q] as const,
    queryFn: ({ signal }) => apiPost("/variables/search", { query: q }, searchSchema, signal),
    enabled: q.length > 2,
    staleTime: Infinity,
    retry: 0,
  });
}

export function useTrendMap(variable: string | null, region: string | null) {
  return useQuery({
    queryKey: queryKeys.trendMap(variable ?? "", region ?? ""),
    queryFn: ({ signal }) => apiGet(`/trend-map/${enc(variable ?? "")}/${enc(region ?? "")}`, trendMapSchema, signal),
    enabled: Boolean(variable && region),
    ...STATIC,
  });
}

export function useOppositeTrends(variable: string | null, region: string | null) {
  return useQuery({
    queryKey: queryKeys.opposite(variable ?? "", region ?? ""),
    queryFn: ({ signal }) =>
      apiGet(`/opposite-trends/${enc(variable ?? "")}/${enc(region ?? "")}`, oppositeTrendsSchema, signal),
    enabled: Boolean(variable && region),
    ...STATIC,
  });
}

/** POST /narrative. Callers fall back to the run's template `verdict` silently on error. */
export function useNarrative(req: NarrativeRequest | null) {
  return useQuery({
    queryKey: queryKeys.narrative(req ?? ({} as NarrativeRequest)),
    queryFn: ({ signal }) => apiPost("/narrative", req, narrativeSchema, signal),
    enabled: req !== null,
    staleTime: Infinity,
    retry: 0,
  });
}
