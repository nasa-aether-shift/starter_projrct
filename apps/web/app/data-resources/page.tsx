import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ArrowUpRight, CloudRain, Database, ExternalLink, Leaf, Thermometer } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SpaceBackground } from "@/components/globe/space-background";

export const metadata: Metadata = {
  title: "NASA Data & Resources",
  description:
    "Explore the NASA Earth observation datasets behind Earth Data Detective and learn how to access their source data.",
};

const datasets = [
  {
    name: "Rainfall",
    short: "GPM IMERG",
    collection: "GPM_3IMERGM",
    provider: "NASA Goddard Earth Sciences Data and Information Services Center (GES DISC)",
    measure: "Monthly precipitation, expressed as millimetres per month.",
    limits:
      "The record begins in June 2000. Satellite estimates are combined with gauge observations; algorithm updates can affect comparisons over time.",
    href: "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGM_07/summary",
    link: "Open the GPM IMERG dataset",
    icon: CloudRain,
    color: "text-sky-300",
  },
  {
    name: "Air temperature",
    short: "MERRA-2",
    collection: "M2TMNXSLV · T2M",
    provider: "NASA Global Modeling and Assimilation Office (GMAO)",
    measure: "Monthly mean air temperature at 2 metres above the surface, converted to degrees Celsius.",
    limits:
      "MERRA-2 is a model reanalysis that combines observations with a weather model, not a direct thermometer measurement. Its grid is roughly 50 km across.",
    href: "https://gmao.gsfc.nasa.gov/reanalysis/MERRA-2/",
    link: "Learn about MERRA-2",
    icon: Thermometer,
    color: "text-amber-300",
  },
  {
    name: "Vegetation greenness",
    short: "MODIS NDVI",
    collection: "MOD13C2",
    provider: "NASA Land Processes Distributed Active Archive Center (LP DAAC)",
    measure:
      "A monthly vegetation index from 0 to 1 derived from reflected light; higher values generally indicate greener vegetation.",
    limits:
      "The record begins in February 2000. Clouds can affect observations, and NDVI becomes less sensitive to change in very dense vegetation.",
    href: "https://lpdaac.usgs.gov/products/mod13c2v061/",
    link: "Open the MODIS NDVI product",
    icon: Leaf,
    color: "text-emerald-300",
  },
];

const officialResources = [
  {
    title: "NASA Giovanni",
    agency: "NASA GES DISC",
    badge: "Ingestion Pipeline",
    description:
      "Web tool providing access to numerous Earth science variables, allowing generation and download of area-averaged time series. Used for MERRA-2 temperature records.",
    href: "https://giovanni.gsfc.nasa.gov/giovanni/",
  },
  {
    title: "AppEEARS",
    agency: "NASA LP DAAC / USGS",
    badge: "Geospatial Extraction",
    description:
      "Application for Extracting and Exploring Analysis Ready Samples, enabling subsetting and transformation of MODIS NDVI vegetation index time series.",
    href: "https://appeears.earthdatacloud.nasa.gov/",
  },
  {
    title: "NOAA Climate Data Online (CDO)",
    agency: "NOAA NCEI",
    badge: "Ground-Truth Check",
    description:
      "Archive of global historical weather and climate data used to ground-truth Kumasi Airport thermometer readings against satellite reanalysis models.",
    href: "https://www.ncei.noaa.gov/cdo-web/",
  },
  {
    title: "SWOT Mission",
    agency: "NASA / CNES / CSA / UKSA",
    badge: "Future Water Baseline",
    description:
      "Surveys 90% of Earth's surface water elevation for lakes, rivers, reservoirs, and oceans. Highlighted in our roadmap for high-resolution water trend detection.",
    href: "https://swot.jpl.nasa.gov/",
  },
  {
    title: "KNMI Climate Explorer",
    agency: "Royal Netherlands Met Institute",
    badge: "Statistical Benchmark",
    description:
      "Web-based scientific climate exploration tool used to cross-verify statistical engine calculations and regional trend slopes.",
    href: "https://climexp.knmi.nl/",
  },
  {
    title: "NASA Earthdata Search",
    agency: "NASA EOSDIS",
    badge: "Catalog Discovery",
    description:
      "Comprehensive search and direct access to over 30 years of Earth observation data across NASA Distributed Active Archive Centers.",
    href: "https://search.earthdata.nasa.gov/",
  },
];

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
    >
      {children}
      <ExternalLink aria-hidden className="size-3.5" />
    </a>
  );
}

export default function DataResourcesPage() {
  return (
    <div className="relative isolate flex-1 bg-black">
      <SpaceBackground />
      <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-3xl">
          <Badge variant="outline" className="mb-4 gap-2 border-primary/30 text-primary">
            <Database aria-hidden className="size-3.5" /> DATA TRANSPARENCY
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">NASA data &amp; resources</h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground sm:text-lg">
            Earth Data Detective uses satellite observations and NASA analysis products to investigate how places
            change. Here’s what each dataset measures, where it comes from, and what to keep in mind when reading a
            result.
          </p>
        </div>

        <section aria-labelledby="datasets-heading" className="mt-10 sm:mt-14">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">Behind the analysis</p>
              <h2 id="datasets-heading" className="mt-1 text-2xl font-semibold">
                Datasets we use
              </h2>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/method">
                Read our analysis method <ArrowUpRight aria-hidden />
              </Link>
            </Button>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {datasets.map((dataset) => {
              const Icon = dataset.icon;
              return (
                <article
                  key={dataset.short}
                  className="flex flex-col rounded-xl border border-border bg-card p-5 sm:p-6"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-accent">
                      <Icon aria-hidden className={`size-5 ${dataset.color}`} />
                    </span>
                    <div>
                      <p className="text-sm text-muted-foreground">{dataset.short}</p>
                      <h3 className="font-semibold">{dataset.name}</h3>
                    </div>
                  </div>
                  <dl className="mt-5 space-y-4 text-sm leading-6">
                    <div>
                      <dt className="font-medium">What it measures</dt>
                      <dd className="mt-1 text-muted-foreground">{dataset.measure}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">NASA collection</dt>
                      <dd className="mt-1 font-mono text-xs text-muted-foreground">{dataset.collection}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">Data provider</dt>
                      <dd className="mt-1 text-muted-foreground">{dataset.provider}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">Keep in mind</dt>
                      <dd className="mt-1 text-muted-foreground">{dataset.limits}</dd>
                    </div>
                  </dl>
                  <div className="mt-auto border-t border-border pt-4">
                    <ExternalAnchor href={dataset.href}>{dataset.link}</ExternalAnchor>
                  </div>
                </article>
              );
            })}
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Collection identifiers and coverage describe the products configured in this project. Check the provider’s
            catalog for current versions, documentation, and the latest available observations.
          </p>
        </section>

        <section
          aria-labelledby="more-resources-heading"
          className="mt-12 border-t border-border pt-8 sm:mt-16 sm:pt-10"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
                Official Challenge &amp; Partner Resources
              </p>
              <h2 id="more-resources-heading" className="mt-1 text-2xl font-semibold">
                NASA &amp; Space Agency Partner Tools
              </h2>
            </div>
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
              100% Provenance-Backed
            </Badge>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {officialResources.map((resource) => (
              <a
                key={resource.title}
                href={resource.href}
                target="_blank"
                rel="noreferrer"
                className="group flex flex-col justify-between rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-accent/40"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      {resource.agency}
                    </span>
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {resource.badge}
                    </span>
                  </div>
                  <h3 className="mt-2 flex items-center justify-between font-semibold text-foreground group-hover:text-primary">
                    {resource.title}
                    <ArrowUpRight
                      aria-hidden
                      className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                    />
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{resource.description}</p>
                </div>
              </a>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Want to see how we turn these time series into a trend?{" "}
            <Link href="/method" className="font-medium text-primary hover:underline">
              Explore the method
            </Link>{" "}
            or{" "}
            <Link href="/investigate" className="font-medium text-primary hover:underline">
              start an investigation
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
