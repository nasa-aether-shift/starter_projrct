"use client";

import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";

import { useHealth, useRegionPresets, useTrend, useVariables } from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/errors";
import { env } from "@/lib/env";

type Row = { label: string; status: "pending" | "ok" | "error"; detail: string };

function StatusIcon({ status }: { status: Row["status"] }) {
  if (status === "ok") return <CheckCircle2 aria-hidden className="size-5 text-grade-b" />;
  if (status === "error") return <XCircle aria-hidden className="size-5 text-destructive" />;
  return <CircleDashed aria-hidden className="size-5 animate-spin text-muted-foreground" />;
}

const errText = (e: unknown) => (e instanceof ApiError ? e.problem.title : "Failed");

/** Step-1 wiring check: proves the typed client + Zod contract work against fixtures or the real API. */
export function SystemCheck() {
  const health = useHealth();
  const variables = useVariables();
  const presets = useRegionPresets();
  const kumasi = useTrend({
    variable_id: "merra2_t2m",
    region_id: "kumasi",
    bbox: null,
    start: null,
    end: null,
    alpha: 0.05,
  });

  const rows: Row[] = [
    {
      label: "API health",
      status: health.isPending ? "pending" : health.isError ? "error" : "ok",
      detail: health.data
        ? `${health.data.status}, code ${health.data.code_version}`
        : health.isError
          ? errText(health.error)
          : "",
    },
    {
      label: "Variable catalog",
      status: variables.isPending ? "pending" : variables.isError ? "error" : "ok",
      detail: variables.data
        ? variables.data.map((v) => v.name.en).join(", ")
        : variables.isError
          ? errText(variables.error)
          : "",
    },
    {
      label: "Region presets",
      status: presets.isPending ? "pending" : presets.isError ? "error" : "ok",
      detail: presets.data
        ? presets.data.features.map((f) => f.properties.name).join(", ")
        : presets.isError
          ? errText(presets.error)
          : "",
    },
    {
      label: "Kumasi temperature trend",
      status: kumasi.isPending ? "pending" : kumasi.isError ? "error" : "ok",
      detail: kumasi.data
        ? `Grade ${kumasi.data.evidence_grade.grade}, run ${kumasi.data.run_id}`
        : kumasi.isError
          ? errText(kumasi.error)
          : "",
    },
  ];

  return (
    <section aria-labelledby="syscheck" className="rounded-xl border border-border bg-panel p-5 backdrop-blur">
      <h2 id="syscheck" className="mb-1 text-lg font-semibold">
        Systems check
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Source: {env.useFixtures ? "fixtures (synthetic)" : env.apiUrl}
      </p>
      <ul className="flex flex-col gap-3">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-3">
            <StatusIcon status={r.status} />
            <div className="min-w-0">
              <p className="font-medium">{r.label}</p>
              {r.detail ? <p className="truncate text-sm text-muted-foreground">{r.detail}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
