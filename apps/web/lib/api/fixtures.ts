// Fixture router: answers API paths from /fixtures when NEXT_PUBLIC_USE_FIXTURES=1.
// Each JSON is code-split via dynamic import so fixtures never bloat the real-API bundle.
// All fixture numbers are SYNTHETIC (see scripts/make-fixtures.mjs).

import { ApiError } from "./errors";

type Loader = () => Promise<unknown>;

const TREND_BY_VARIABLE: Record<string, Loader> = {
  merra2_t2m: () => import("@/fixtures/trend.grade-a.json").then((m) => m.default),
  gpm_precip: () => import("@/fixtures/trend.grade-d.json").then((m) => m.default),
  modis_ndvi: () => import("@/fixtures/trend.null-should.json").then((m) => m.default),
};

const RUNS: Record<string, Loader> = {
  "fixture-grade-a": TREND_BY_VARIABLE.merra2_t2m,
  "fixture-grade-d": TREND_BY_VARIABLE.gpm_precip,
  "fixture-null-should": TREND_BY_VARIABLE.modis_ndvi,
  "fixture-point": () => import("@/fixtures/trend-at-point.json").then((m) => m.default),
};

const MAPS: Record<string, Loader> = {
  merra2_t2m: () => import("@/fixtures/trend-map.merra2_t2m.west_africa.json").then((m) => m.default),
  gpm_precip: () => import("@/fixtures/trend-map.gpm_precip.west_africa.json").then((m) => m.default),
  modis_ndvi: () => import("@/fixtures/trend-map.modis_ndvi.west_africa.json").then((m) => m.default),
};

const OPPOSITE: Record<string, Loader> = {
  merra2_t2m: () => import("@/fixtures/opposite-trends.merra2_t2m.west_africa.json").then((m) => m.default),
  gpm_precip: () => import("@/fixtures/opposite-trends.gpm_precip.west_africa.json").then((m) => m.default),
  modis_ndvi: () => import("@/fixtures/opposite-trends.modis_ndvi.west_africa.json").then((m) => m.default),
};

const notFound = (title: string, detail: string) => new ApiError(404, { type: "about:blank", title, detail });

const LATENCY_MS = 350; // makes loading states visible during development

function bodyField(body: unknown, key: string): string | undefined {
  if (typeof body === "object" && body !== null && key in body) {
    const v = (body as Record<string, unknown>)[key];
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

async function pick(table: Record<string, Loader>, key: string | undefined, what: string): Promise<unknown> {
  const loader = key ? table[key] : undefined;
  if (!loader) throw notFound(`No ${what} fixture`, `There is no fixture for '${key ?? "?"}'.`);
  return loader();
}

/** Resolve a JSON endpoint from fixtures. `path` is relative to /api/v1, e.g. "/trend". */
export async function fixtureJson(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  const parts = path.split("?")[0].split("/").filter(Boolean);

  if (method === "GET") {
    if (path === "/health") return (await import("@/fixtures/health.json")).default;
    if (path === "/variables") return (await import("@/fixtures/variables.json")).default;
    if (path === "/regions/presets") return (await import("@/fixtures/regions-presets.json")).default;
    if (parts[0] === "variables" && parts[1]) {
      const all = (await import("@/fixtures/variables.json")).default as { id: string }[];
      const found = all.find((v) => v.id === parts[1]);
      if (!found) throw notFound("Unknown variable", `No variable '${parts[1]}'.`);
      return found;
    }
    if (parts[0] === "trend-map") {
      if (parts[2] !== "west_africa") throw notFound("Map not cached", `No fixture map for region '${parts[2]}'.`);
      return pick(MAPS, parts[1], "trend-map");
    }
    if (parts[0] === "opposite-trends") {
      if (parts[2] !== "west_africa") throw notFound("Map not cached", `No fixture map for region '${parts[2]}'.`);
      return pick(OPPOSITE, parts[1], "opposite-trends");
    }
    if (parts[0] === "runs" && parts[1] && parts.length === 2) {
      const loader = RUNS[parts[1]];
      if (!loader) throw notFound("Unknown run", parts[1]);
      return loader();
    }
  }

  if (method === "POST") {
    if (path === "/trend") return pick(TREND_BY_VARIABLE, bodyField(body, "variable_id"), "trend");
    if (path === "/trend-at-point") return (await import("@/fixtures/trend-at-point.json")).default;
    if (path === "/narrative") {
      const runId = bodyField(body, "run_id");
      if (!runId || !RUNS[runId]) throw notFound("Unknown run", "Call /trend first; runs are kept in memory.");
      const run = (await RUNS[runId]()) as { verdict: unknown };
      return { sentences: run.verdict, source: "template" };
    }
  }

  throw notFound("Not in fixtures", `${method} ${path} has no fixture.`);
}

/** GET /runs/{id}/csv in fixture mode: same layout as the API's CSV. */
export async function fixtureCsv(runId: string): Promise<string> {
  const run = (await fixtureJson("GET", `/runs/${runId}`)) as {
    run_id: string;
    variable: { name: string; units: string };
    region: { name: string };
    provenance: { code_version: string };
    series: { time: string[]; raw: (number | null)[]; anomaly: (number | null)[]; trend_line: (number | null)[] };
  };
  const s = run.series;
  const rows = s.time.map((t, i) => [t, s.raw[i] ?? "", s.anomaly[i] ?? "", s.trend_line[i] ?? ""].join(","));
  const header = `# ${run.variable.name} (${run.variable.units}) | ${run.region.name} | run ${run.run_id} | code ${run.provenance.code_version}`;
  return `${header}\ntime,raw,anomaly,trend_line\n${rows.join("\n")}\n`;
}
