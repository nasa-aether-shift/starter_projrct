"use client";

import { motion } from "framer-motion";
import { ArrowRight, HelpCircle, Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { GradeBadge } from "@/components/analysis/grade-badge";
import { TaleOfTwoRegions } from "@/components/analysis/tale-of-two-regions";
import { VerdictCard } from "@/components/analysis/verdict-card";
import { ErrorState, LoadingState } from "@/components/async-state";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { ScopeStatement } from "@/components/scope-statement";
import { Button } from "@/components/ui/button";
import { useTrend, useVariables } from "@/lib/api/hooks";
import { decimalsFor, formatSigned, formatUnits } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { directionStyle, polarityFor } from "@/lib/polarity";
import type { TrendRequest, TrendResult } from "@/lib/schemas";

const TEMP: TrendRequest = {
  variable_id: "merra2_t2m",
  region_id: "kumasi",
  bbox: null,
  start: null,
  end: null,
  alpha: 0.05,
};
const RAIN: TrendRequest = {
  variable_id: "gpm_precip",
  region_id: "kumasi",
  bbox: null,
  start: null,
  end: null,
  alpha: 0.05,
};

function Chapter({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <motion.section
      aria-labelledby={`chapter-${n}`}
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-5 border-t border-border py-14"
    >
      <p className="tabular text-sm font-semibold tracking-[0.2em] text-primary uppercase">0{n}</p>
      <h2 id={`chapter-${n}`} className="text-3xl font-bold sm:text-4xl">
        {title}
      </h2>
      {children}
    </motion.section>
  );
}

function Headline({ result, palettePolarity }: { result: TrendResult; palettePolarity?: string }) {
  const { t, lang } = useI18n();
  const tr = result.trend;
  const d = decimalsFor([tr.sen_slope_per_decade, ...tr.ci95_per_decade]);
  const dir = directionStyle(tr.direction, polarityFor(palettePolarity));
  const units = formatUnits(result.variable.units);
  return (
    <div className="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-2xl border border-border bg-panel p-6">
      <div>
        <p className="tabular text-5xl font-bold" style={{ color: dir.color }}>
          {formatSigned(tr.sen_slope_per_decade, d)}
          {units ? ` ${units}` : ""}
        </p>
        <p className="text-lg text-muted-foreground">
          {t("verdict.perDecade")} · {t(`pol.${dir.word}`)}
        </p>
      </div>
      <GradeBadge
        grade={result.evidence_grade.grade}
        label={lang === "en" ? result.evidence_grade.label : t(`grade.${result.evidence_grade.grade}`)}
        sub={t("verdict.gradeWord", { g: result.evidence_grade.grade })}
      />
    </div>
  );
}

function Async({ q, children }: { q: ReturnType<typeof useTrend>; children: (r: TrendResult) => ReactNode }) {
  if (q.isPending) return <LoadingState lines={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <>{children(q.data)}</>;
}

/** The Kumasi case: Clue → Evidence → Twist → Verdict → What we cannot say, bound to live API results. */
export function KumasiCase() {
  const { t } = useI18n();
  const temp = useTrend(TEMP);
  const rain = useTrend(RAIN);
  const variables = useVariables();
  const tempVar = variables.data?.find((v) => v.id === TEMP.variable_id);
  const rainVar = variables.data?.find((v) => v.id === RAIN.variable_id);
  const caveats = [...(tempVar?.caveats ?? []), ...(rainVar?.caveats ?? [])];

  return (
    <article className="mx-auto flex w-full max-w-5xl flex-col px-4 pt-8 pb-14 sm:px-6">
      <header className="flex flex-col gap-4 pb-12">
        <p className="text-sm font-semibold tracking-[0.2em] text-primary uppercase">{t("case.kicker")}</p>
        <h1 className="text-4xl font-bold text-balance sm:text-6xl">{t("case.title")}</h1>
        <p className="max-w-3xl text-xl text-muted-foreground">{t("case.intro")}</p>
      </header>

      <Chapter n={1} title={t("case.clue.title")}>
        <div className="flex gap-4 text-xl">
          <Search aria-hidden className="mt-1 size-7 shrink-0 text-primary" />
          <p className="max-w-3xl">{t("case.clue.body")}</p>
        </div>
      </Chapter>

      <Chapter n={2} title={t("case.evidence.title")}>
        <p className="max-w-3xl text-lg text-muted-foreground">{t("case.evidence.body")}</p>
        <Async q={temp}>
          {(r) => (
            <>
              <Headline result={r} palettePolarity={tempVar?.palette_polarity} />
              <TimeSeriesChart result={r} palettePolarity={tempVar?.palette_polarity} />
            </>
          )}
        </Async>
      </Chapter>

      <Chapter n={3} title={t("case.twist.title")}>
        <p className="max-w-3xl text-lg text-muted-foreground">{t("case.twist.body")}</p>
        <h3 className="text-xl font-semibold">{t("case.rainfall")}</h3>
        <Async q={rain}>
          {(r) => (
            <>
              <Headline result={r} palettePolarity={rainVar?.palette_polarity} />
              <p className="text-lg" lang="en">
                {r.verdict.what} {r.verdict.significant}
              </p>
            </>
          )}
        </Async>
        <h3 className="mt-4 text-xl font-semibold">{t("case.acrossWestAfrica")}</h3>
        {rainVar ? <TaleOfTwoRegions variable={rainVar} /> : <LoadingState />}
      </Chapter>

      <Chapter n={4} title={t("case.verdict.title")}>
        <Async q={temp}>
          {(r) => (
            <>
              <VerdictCard result={r} variable={tempVar} />
              <Button asChild size="lg" className="w-fit">
                <Link href={`/analysis/${encodeURIComponent(r.run_id)}?variable=merra2_t2m&region=kumasi`}>
                  {t("case.openAnalysis")} <ArrowRight aria-hidden />
                </Link>
              </Button>
            </>
          )}
        </Async>
      </Chapter>

      <Chapter n={5} title={t("case.cannot.title")}>
        <ul className="flex flex-col gap-4 text-lg">
          {["case.cannot.cause", "case.cannot.shape", "case.cannot.future"].map((k) => (
            <li key={k} className="flex gap-3">
              <HelpCircle aria-hidden className="mt-1 size-6 shrink-0 text-warning" />
              {t(k)}
            </li>
          ))}
          {caveats.map((c) => (
            <li key={c} className="flex gap-3" lang="en">
              <HelpCircle aria-hidden className="mt-1 size-6 shrink-0 text-warning" />
              {c}
            </li>
          ))}
        </ul>
        <ScopeStatement />
      </Chapter>
    </article>
  );
}
