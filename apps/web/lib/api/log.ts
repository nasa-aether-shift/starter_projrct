// Development-only API logging: one collapsed console group per call with a one-line summary (method, path,
// status, time, key numbers) and the full request/response inside. Tagged API or FIXTURE so it is always
// clear where the numbers came from. Stripped from production builds (NODE_ENV check).
// Mute in the browser console with: localStorage.setItem("edd:api-log", "off")

type Source = "API" | "FIXTURE";

interface LogEntry {
  source: Source;
  method: string;
  path: string;
  status: number | "error";
  ms: number;
  body?: unknown;
  data?: unknown;
  error?: unknown;
}

const enabled = (): boolean => {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("edd:api-log") !== "off";
  } catch {
    return true;
  }
};

const num = (v: unknown, d = 3) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(d)) : v);
const get = (o: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), o);

/** The few values worth seeing at a glance for each kind of response. */
function summarise(path: string, data: unknown): string {
  if (!data || typeof data !== "object") return "";
  if (path.startsWith("/health"))
    return `using_fixtures=${String(get(data, "using_fixtures"))} cached=${JSON.stringify(get(data, "cached_results"))}`;
  if (Array.isArray(data))
    return `${data.length} items${
      data.length
        ? ": " +
          data
            .map((x) => get(x, "id"))
            .filter(Boolean)
            .join(", ")
        : ""
    }`;
  if (path.startsWith("/trend-map")) {
    const slopes = ((get(data, "slope_per_decade") as (number | null)[][] | undefined) ?? []).flat();
    const vals = slopes.filter((v): v is number => typeof v === "number");
    const sig = ((get(data, "fdr_significant") as number[][] | undefined) ?? []).flat();
    const lat = (get(data, "grid.lat") as number[] | undefined) ?? [];
    const lon = (get(data, "grid.lon") as number[] | undefined) ?? [];
    const pct = sig.length ? Math.round((100 * sig.filter((x) => x === 1).length) / sig.length) : 0;
    return `${lat.length}×${lon.length} cells, slope ${num(Math.min(...vals))}…${num(Math.max(...vals))} ${String(get(data, "units_per_decade"))}, ${pct}% FDR-significant`;
  }
  if (get(data, "trend") && get(data, "variable")) {
    return [
      get(data, "variable.id"),
      get(data, "region.name"),
      `${String(get(data, "period.start"))}–${String(get(data, "period.end"))} (${String(get(data, "period.n_months"))} mo)`,
      get(data, "trend.direction"),
      `${num(get(data, "trend.sen_slope_per_decade"))} ${String(get(data, "variable.units"))}/decade`,
      `grade ${String(get(data, "evidence_grade.grade"))}`,
    ].join(" · ");
  }
  if (path.startsWith("/opposite-trends"))
    return `found=${String(get(data, "found"))}, rising ${num(Number(get(data, "rising_share")) * 100, 0)}% / falling ${num(Number(get(data, "falling_share")) * 100, 0)}% of cells, divergence ${num(get(data, "divergence_score"), 2)}`;
  if (path.startsWith("/variables/"))
    return `${String(get(data, "id"))}: ${String(get(data, "name.en") ?? get(data, "name"))} (${String(get(data, "units"))})`;
  if (get(data, "type") === "FeatureCollection")
    return `${((get(data, "features") as unknown[]) ?? []).length} features`;
  return Object.keys(data).slice(0, 6).join(", ");
}

export function logApi(e: LogEntry) {
  if (!enabled()) return;
  const ok = typeof e.status === "number" && e.status < 400;
  const colour = e.source === "FIXTURE" ? "#b45309" : ok ? "#15803d" : "#b91c1c";
  const summary = e.error ? describeError(e.error) : summarise(e.path, e.data);
  console.groupCollapsed(
    `%c${e.source}%c ${e.method} ${e.path} %c${e.status}%c ${Math.round(e.ms)} ms  ${summary}`,
    `color:#fff;background:${colour};padding:1px 5px;border-radius:3px;font-weight:600`,
    "color:inherit",
    `color:${colour};font-weight:600`,
    "color:#6b7280",
  );
  if (e.body !== undefined) console.log("request body", e.body);
  if (e.data !== undefined) console.log("response", e.data);
  if (e.error !== undefined) console.log("error", e.error);
  console.groupEnd();
}

function describeError(err: unknown): string {
  const problem = get(err, "problem");
  const title = get(problem, "title") ?? get(err, "message");
  const detail = get(problem, "detail");
  return [title, detail].filter(Boolean).join(": ");
}
