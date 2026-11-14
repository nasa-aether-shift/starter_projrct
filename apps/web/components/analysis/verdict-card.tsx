"use client";

import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Clock, Languages, Sparkles, Zap } from "lucide-react";
import { useId } from "react";

import { Badge } from "@/components/ui/badge";
import {
  decimalsFor,
  formatMonth,
  formatP,
  formatPercent,
  formatPeriod,
  formatSigned,
  formatUnits,
  withUnits,
} from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { directionStyle, polarityFor } from "@/lib/polarity";
import type { Narrative, TrendResult, Variable, Verdict } from "@/lib/schemas";

import { GradeBadge } from "./grade-badge";

export interface VerdictCardProps {
  result: TrendResult;
  /** Catalog entry: gives colour polarity. Optional so the card still renders if /variables fails. */
  variable?: Variable;
  /** POST /narrative output. Falls back to the template `result.verdict` when absent. */
  narrative?: Narrative;
}

const SENTENCES: { key: keyof Verdict; label: string }[] = [
  { key: "what", label: "verdict.what" },
  { key: "where", label: "verdict.where" },
  { key: "how_much", label: "verdict.howMuch" },
  { key: "significant", label: "verdict.howSure" },
];

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-panel-raised p-5">
      <h3 className="text-sm font-semibold tracking-[0.14em] text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function VerdictCard({ result, variable, narrative }: VerdictCardProps) {
  const { trend, tests, evidence_grade: grade, period, change_point: cp, significance_horizon: horizon } = result;
  const polarity = polarityFor(variable?.palette_polarity);
  const dir = directionStyle(trend.direction, polarity);
  const Arrow =
    trend.direction === "increasing" ? ArrowUpRight : trend.direction === "decreasing" ? ArrowDownRight : ArrowRight;
  const [lo, hi] = trend.ci95_per_decade;
  const d = decimalsFor([trend.sen_slope_per_decade, lo, hi]);
  const units = result.variable.units;
  const weak = grade.grade === "C" || grade.grade === "D";
  const sentences = narrative?.sentences ?? result.verdict;
  const aiWording = narrative?.source === "ai";
  const { t, lang } = useI18n();
  const uid = useId();
  const dirTitle = t(
    trend.direction === "increasing"
      ? "verdict.rising"
      : trend.direction === "decreasing"
        ? "verdict.falling"
        : "verdict.none",
  );
  const unitText = formatUnits(units);

  return (
    <article
      aria-labelledby={`${uid}-title`}
      className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5 shadow-xl sm:p-7"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-primary uppercase">{t("verdict.kicker")}</p>
          <h2 id={`${uid}-title`} className="text-2xl font-bold sm:text-3xl">
            {result.variable.name}
          </h2>
          <p className="text-muted-foreground">
            {result.region.name} · {formatPeriod(period.start, period.end)}
          </p>
        </div>
        <Badge variant="outline" className="h-auto px-3 py-1 text-sm">
          {t(result.variable.kind === "model" ? "verdict.model" : "verdict.measurement")}
        </Badge>
      </header>

      {weak ? (
        <div
          role="note"
          className="flex items-start gap-3 rounded-xl border-2 border-warning/70 bg-warning/10 p-4 text-lg font-semibold"
        >
          <AlertTriangle aria-hidden className="mt-1 size-6 shrink-0 text-warning" />
          <p>{t("verdict.notEstablished", { g: grade.grade })}</p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Block title={t("verdict.direction")}>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-14 shrink-0 items-center justify-center rounded-full border-2"
              style={{ borderColor: dir.color, color: dir.color }}
            >
              <Arrow className="size-8" strokeWidth={2.5} />
            </span>
            <div>
              <p className="text-2xl font-bold">{dirTitle}</p>
              <p className="text-muted-foreground">{t(`pol.${dir.word}`)}</p>
            </div>
          </div>
        </Block>

        <Block title={t("verdict.magnitude")}>
          <p className="tabular text-3xl font-bold">
            {withUnits(formatSigned(trend.sen_slope_per_decade, d), units)}
            <span className="block text-lg font-medium text-muted-foreground">{t("verdict.perDecade")}</span>
          </p>
          <p className="tabular text-muted-foreground">
            {t("verdict.range95", { lo: formatSigned(lo, d), hi: formatSigned(hi, d) })}
            {unitText ? ` ${unitText}` : ""}
          </p>
          {trend.percent_of_mean_per_decade !== null ? (
            <p className="tabular text-muted-foreground">
              {t("verdict.pctMean", {
                v: formatSigned(trend.percent_of_mean_per_decade, decimalsFor([trend.percent_of_mean_per_decade])),
              })}
            </p>
          ) : null}
        </Block>

        <Block title={t("verdict.evidence")}>
          <GradeBadge
            grade={grade.grade}
            label={lang === "en" ? grade.label : t(`grade.${grade.grade}`)}
            sub={t("verdict.gradeWord", { g: grade.grade })}
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-base">
            <dt className="text-muted-foreground">{t("verdict.correctedMK")}</dt>
            <dd className="tabular font-medium">p {formatP(tests.modified_mk.p)}</dd>
            <dt className="text-muted-foreground">{t("verdict.record")}</dt>
            <dd className="tabular font-medium">
              {t("verdict.recordValue", { n: period.n_months, pct: formatPercent(period.coverage) })}
            </dd>
          </dl>
        </Block>
      </div>

      {grade.reasons.length ? (
        <section aria-labelledby={`${uid}-reasons`}>
          <h3 id={`${uid}-reasons`} className="mb-2 font-semibold">
            {t("verdict.whyGrade")}
          </h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {grade.reasons.map((r) => (
              <li key={r} className="flex gap-2 text-muted-foreground">
                <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                {r}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby={`${uid}-sentences`} className="rounded-xl bg-muted/50 p-5">
        <h3 id={`${uid}-sentences`} className="sr-only">
          The verdict in four sentences
        </h3>
        <dl className="grid gap-3">
          {SENTENCES.map(({ key, label }) => (
            <div key={key} className="grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4">
              <dt className="font-semibold text-primary">{t(label)}</dt>
              <dd className="text-lg" lang="en">
                {sentences[key]}
              </dd>
            </div>
          ))}
        </dl>
        {aiWording ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles aria-hidden className="size-4" /> {t("verdict.aiWording")}
          </p>
        ) : null}
        {lang !== "en" ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Languages aria-hidden className="size-4" /> {t("verdict.englishNote")}
          </p>
        ) : null}
      </section>

      {horizon?.needed && horizon.years_estimate !== null ? (
        <p className="flex items-start gap-3 text-base">
          <Clock aria-hidden className="mt-1 size-5 shrink-0 text-primary" />
          <span>
            <strong>{t("verdict.yearsToSig", { n: horizon.years_estimate })}</strong>{" "}
            <span className="text-muted-foreground">{horizon.assumptions}</span>
          </span>
        </p>
      ) : null}

      {cp?.detected && cp.date ? (
        <p className="flex items-start gap-3 text-base">
          <Zap aria-hidden className="mt-1 size-5 shrink-0 text-warning" />
          <span>
            <strong>{t("verdict.shift", { date: formatMonth(cp.date) })}</strong>
            {cp.p !== null ? ` (Pettitt p ${formatP(cp.p)})` : ""}. {t("verdict.shiftTail")}
          </span>
        </p>
      ) : null}

      {result.data_quality?.notices.length ? (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {result.data_quality.notices.map((n) => (
            <li key={n} className="flex gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /> {n}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
