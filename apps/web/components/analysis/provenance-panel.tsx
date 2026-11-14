import { DefinitionCard } from "@/components/definition-card";
import { formatPercent, formatPeriod } from "@/lib/format";
import type { TrendResult, Variable } from "@/lib/schemas";

import { CsvDownload } from "./csv-download";
import { TestExplainer } from "./test-explainer";

const show = (v: unknown): string =>
  v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xl font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** ProvenancePanel: where the numbers came from and how, so anyone can check them. */
export function ProvenancePanel({ result, variable }: { result: TrendResult; variable?: Variable }) {
  const p = result.provenance;
  return (
    <div className="flex flex-col gap-8">
      {variable ? (
        <Section title={`What is “${variable.name.en}”?`}>
          <DefinitionCard variable={variable} />
        </Section>
      ) : null}

      <Section title="Data">
        <ul className="flex flex-col gap-3">
          {p.datasets.map((d, i) => {
            const entries = Object.entries(d).filter(([, v]) => show(v) !== "");
            return (
              <li key={i} className="rounded-lg border border-border bg-panel p-4">
                <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
                  {entries.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground capitalize">{k.replaceAll("_", " ")}</dt>
                      <dd className="break-words">{show(v)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Region</dt>
          <dd>
            {result.region.name}
            {result.region.area_km2 !== undefined ? ` (${result.region.area_km2.toLocaleString("en")} km²)` : ""}
          </dd>
          <dt className="text-muted-foreground">Period</dt>
          <dd>
            {formatPeriod(result.period.start, result.period.end)}: {result.period.n_months} months,{" "}
            {formatPercent(result.period.coverage)} present
          </dd>
          <dt className="text-muted-foreground">Variable type</dt>
          <dd>{result.variable.kind === "model" ? "Model estimate (reanalysis)" : "Satellite measurement"}</dd>
        </dl>
      </Section>

      <Section title="Processing steps">
        <ol className="flex list-decimal flex-col gap-1 pl-6">
          {p.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </Section>

      <Section title="Tests">
        <TestExplainer result={result} />
      </Section>

      <Section title="Reproduce it">
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Run ID</dt>
          <dd>
            <code className="font-mono">{result.run_id}</code>
          </dd>
          <dt className="text-muted-foreground">Code version</dt>
          <dd>
            <code className="font-mono">{p.code_version}</code>
          </dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{p.created_at}</dd>
        </dl>
        <CsvDownload runId={result.run_id} />
      </Section>
    </div>
  );
}
