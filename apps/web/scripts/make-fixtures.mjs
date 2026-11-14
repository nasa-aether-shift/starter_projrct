#!/usr/bin/env node
// Generates SYNTHETIC fixtures for every API endpoint into ./fixtures.
// Shapes mirror apps/api/app/main.py + packages/stats_engine exactly (as of the starter repo).
// Numbers are computed (Sen slope, Mann-Kendall, OLS, BH-FDR) from deterministic synthetic
// series, so they are internally consistent — but they are NOT real data. Never show them in the pitch.
//
// Usage: npm run fixtures

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "fixtures");
const REPO = join(HERE, "..", "..", "..");
mkdirSync(OUT, { recursive: true });

const WARNING = "SYNTHETIC FIXTURE for frontend development only. Never show these numbers in the demo.";
const CREATED_AT = "2026-11-14T10:00:00+00:00";
const CODE_VERSION = "0.1.0-fixture";

// ---------- deterministic RNG ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng) {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

// ---------- maths ----------
const r6 = (v) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 1e6) / 1e6);
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const pTwo = (z) => Math.max(1e-12, 2 * (1 - phi(Math.abs(z))));

function mkStats(x) {
  const v = x.filter((e) => e !== null);
  const n = v.length;
  let s = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(v[j] - v[i]);
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  return { s, varS, z, p: pTwo(z), tau: s / ((n * (n - 1)) / 2), n };
}
function lag1(x) {
  const v = x.filter((e) => e !== null);
  const m = mean(v);
  let num = 0;
  let den = 0;
  for (let i = 0; i < v.length; i++) {
    den += (v[i] - m) ** 2;
    if (i > 0) num += (v[i] - m) * (v[i - 1] - m);
  }
  return num / den;
}
function theilSen(t, x) {
  const idx = x.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  const slopes = [];
  for (let a = 0; a < idx.length - 1; a++)
    for (let b = a + 1; b < idx.length; b++) slopes.push((x[idx[b]] - x[idx[a]]) / (t[idx[b]] - t[idx[a]]));
  slopes.sort((p, q) => p - q);
  const slope = median(slopes);
  const n = idx.length;
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const c = 1.959964 * Math.sqrt(varS);
  const N = slopes.length;
  const lo = slopes[Math.max(0, Math.round((N - c) / 2) - 1)];
  const hi = slopes[Math.min(N - 1, Math.round((N + c) / 2))];
  const intercept = median(idx.map((i) => x[i] - slope * t[i]));
  return { slope, lo, hi, intercept };
}
function ols(t, x) {
  const idx = x.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  const tt = idx.map((i) => t[i]);
  const xx = idx.map((i) => x[i]);
  const mt = mean(tt);
  const mx = mean(xx);
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < tt.length; k++) {
    sxy += (tt[k] - mt) * (xx[k] - mx);
    sxx += (tt[k] - mt) ** 2;
  }
  const slope = sxy / sxx;
  const b = mx - slope * mt;
  const sse = tt.reduce((s, ti, k) => s + (xx[k] - (b + slope * ti)) ** 2, 0);
  const se = Math.sqrt(sse / (tt.length - 2) / sxx);
  const tStat = slope / se;
  return { slope, t: tStat, p: pTwo(tStat) };
}

// ---------- series ----------
function monthRange(start, end) {
  const out = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
const decimalYear = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return y + (m - 0.5) / 12;
};

function synth({
  start,
  end,
  seed,
  base,
  seasonalAmp,
  slopePerYear,
  noise,
  ar = 0.3,
  gapEvery = 0,
  shiftAt = null,
  shift = 0,
  floor = null,
}) {
  const rng = mulberry32(seed);
  const time = monthRange(start, end);
  let e = 0;
  const raw = time.map((ym, i) => {
    e = ar * e + Math.sqrt(1 - ar * ar) * gaussian(rng) * noise;
    const [, m] = ym.split("-").map(Number);
    let v =
      base +
      seasonalAmp * Math.sin((2 * Math.PI * (m - 3)) / 12) +
      slopePerYear * (decimalYear(ym) - decimalYear(start)) +
      e;
    if (shiftAt && ym >= shiftAt) v += shift;
    if (floor !== null) v = Math.max(floor, v);
    if (gapEvery && i % gapEvery === gapEvery - 1) return null;
    return v;
  });
  return { time, raw };
}

function anomalies(time, raw) {
  const byMonth = Array.from({ length: 12 }, () => []);
  time.forEach((ym, i) => raw[i] !== null && byMonth[Number(ym.slice(5)) - 1].push(raw[i]));
  const clim = byMonth.map((a) => mean(a));
  return time.map((ym, i) => (raw[i] === null ? null : raw[i] - clim[Number(ym.slice(5)) - 1]));
}

function annualMeans(time, raw) {
  const by = new Map();
  time.forEach((ym, i) => {
    if (raw[i] === null) return;
    const y = ym.slice(0, 4);
    by.set(y, [...(by.get(y) ?? []), raw[i]]);
  });
  return [...by.values()].filter((a) => a.length >= 10).map(mean);
}

function seasonalMk(time, anom) {
  let s = 0;
  let v = 0;
  for (let m = 1; m <= 12; m++) {
    const sub = anom.filter((_, i) => Number(time[i].slice(5)) === m);
    const r = mkStats(sub);
    s += r.s;
    v += r.varS;
  }
  const z = s > 0 ? (s - 1) / Math.sqrt(v) : s < 0 ? (s + 1) / Math.sqrt(v) : 0;
  return { z, p: pTwo(z) };
}

// Core of analyze_series(): returns period/series/trend/tests/autocorrelation/change_point/
// significance_horizon/evidence_grade/data_quality, same keys as the engine.
function analyze(
  { time, raw },
  { alpha = 0.05, grade, label, extraReasons = [], changePoint = null, horizon = null, notices = [] },
) {
  const anom = anomalies(time, raw);
  const t = time.map(decimalYear);
  const ts = theilSen(t, anom);
  const mk = mkStats(anom);
  const r1 = lag1(anom);
  const cf = (1 + r1) / (1 - r1);
  const zMod = mk.z / Math.sqrt(cf);
  const pMod = pTwo(zMod);
  const sm = seasonalMk(time, anom);
  const ann = mkStats(annualMeans(time, raw));
  const ol = ols(t, anom);
  const nValid = anom.filter((v) => v !== null).length;
  const years = time.length / 12;
  const cov = nValid / time.length;
  const sig = pMod < alpha;
  const direction = sig ? (zMod > 0 ? "increasing" : "decreasing") : "no_significant_trend";
  const tMean = mean(t);
  const rawValid = raw.filter((v) => v !== null);
  const pct = (100 * ts.slope * 10) / mean(rawValid);
  const pText = pMod < 0.001 ? "p < 0.001" : `p = ${pMod.toFixed(3)}`;
  const reasons = [
    `Autocorrelation-corrected Mann-Kendall ${pText}`,
    `${Math.round(years)} years of data`,
    `${Math.round(cov * 100)}% of months available`,
    ...extraReasons,
  ];
  return {
    period: {
      start: time[0],
      end: time[time.length - 1],
      n_months: time.length,
      coverage: Math.round(cov * 1e4) / 1e4,
    },
    series: {
      time,
      raw: raw.map(r6),
      anomaly: anom.map(r6),
      trend_line: t.map((ti) => r6(ts.intercept + ts.slope * ti)),
      ci_low: t.map((ti) => r6(ts.intercept + ts.lo * (ti - tMean) + ts.slope * tMean)),
      ci_high: t.map((ti) => r6(ts.intercept + ts.hi * (ti - tMean) + ts.slope * tMean)),
    },
    trend: {
      direction,
      sen_slope_per_decade: ts.slope * 10,
      ci95_per_decade: [ts.lo * 10, ts.hi * 10],
      percent_of_mean_per_decade: pct,
    },
    tests: {
      mann_kendall: { tau: mk.tau, z: mk.z, p: mk.p },
      modified_mk: { z: zMod, p: pMod, correction_factor: cf },
      seasonal_mk: sm,
      annual_mk: { z: ann.z, p: ann.p },
      ols: { slope_per_decade: ol.slope * 10, t: ol.t, p: ol.p },
      alpha,
      tests_agree: Math.sign(zMod) === Math.sign(ol.slope) && pMod < alpha === ol.p < alpha,
    },
    autocorrelation: { lag1: r1, effective_n: Math.round((nValid * (1 - r1)) / (1 + r1)) },
    change_point: changePoint ?? { detected: false, date: null, slope_before: null, slope_after: null, p: 0.62 },
    significance_horizon: horizon ?? { needed: false, years_estimate: null, assumptions: "" },
    evidence_grade: { grade, label, reasons },
    data_quality: { gaps: time.length - nValid, notices },
  };
}

// ---------- catalog / presets (mirrors data/catalog/*.yaml as served by GET /variables) ----------
const VARIABLES = [
  {
    id: "merra2_t2m",
    name: { en: "Air temperature", tw: "Mframa mu ɔhyew" },
    definition: {
      kid: { en: "How warm the air is just above the ground." },
      student: { en: "Monthly average air temperature 2 metres above the ground, in degrees Celsius." },
      scientist: { en: "2 m air temperature (T2M) from the MERRA-2 reanalysis, monthly mean." },
    },
    units: "degC",
    source: { collection: "M2TMNXSLV", version: "<verify in CMR>", variable: "T2M", provider: "NASA GMAO" },
    resolution: { spatial_deg: "0.5 x 0.625", temporal: "monthly" },
    coverage: { start: "1980-01", end: "<latest>" },
    qa: { min_valid_fraction: 0.75, convert: "K -> degC (subtract 273.15)" },
    palette_polarity: "warm_is_red",
    synonyms: ["temperature", "heat", "hot", "hotter", "warm", "warming", "cooler", "ɔhyew"],
    typical_questions: ["Is it getting hotter here?", "Is Kumasi warming?"],
    caveats: [
      "MERRA-2 is a model reanalysis, not a direct measurement.",
      "Each grid cell is about 50 km wide, so a city and its surroundings share one value.",
    ],
    recommended_min_years: 15,
    model_or_measurement: "model",
  },
  {
    id: "gpm_precip",
    name: { en: "Rainfall", tw: "Nsuo a ɛtɔ" },
    definition: {
      kid: { en: "How much rain falls from the sky." },
      student: { en: "Total rain reaching the ground in a month, in millimetres." },
      scientist: { en: "Satellite-gauge merged monthly precipitation from GPM IMERG Final Run." },
    },
    units: "mm/month",
    source: {
      collection: "GPM_3IMERGM",
      version: "<verify in CMR>",
      variable: "precipitation",
      provider: "NASA GES DISC",
    },
    resolution: { spatial_deg: 0.1, temporal: "monthly" },
    coverage: { start: "2000-06", end: "<latest>" },
    qa: { min_valid_fraction: 0.75, convert: "mm/hr -> mm/month (x hours in month), check units on download" },
    palette_polarity: "wet_is_blue",
    synonyms: ["rain", "rainfall", "drought", "wetter", "drier", "dry", "flood", "nsuo"],
    typical_questions: ["Is it getting drier here?", "Is the rainy season changing?"],
    caveats: ["Record starts in mid-2000, so about 25 years.", "Algorithm version changes can shift values."],
    recommended_min_years: 15,
    model_or_measurement: "measurement",
  },
  {
    id: "modis_ndvi",
    name: { en: "Vegetation greenness (NDVI)", tw: "Nnua mu ahabammono" },
    definition: {
      kid: { en: "How green and leafy the plants are." },
      student: { en: "A greenness score from 0 to 1 measured from space; higher means more healthy plants." },
      scientist: { en: "Normalized Difference Vegetation Index from MODIS Terra monthly vegetation indices (CMG)." },
    },
    units: "index",
    source: {
      collection: "MOD13C2",
      version: "<verify in CMR>",
      variable: "CMG 0.05 Deg Monthly NDVI",
      provider: "NASA LP DAAC",
    },
    resolution: { spatial_deg: 0.05, temporal: "monthly" },
    coverage: { start: "2000-02", end: "<latest>" },
    qa: { min_valid_fraction: 0.75, scale_factor: 0.0001 },
    palette_polarity: "green_is_green",
    synonyms: ["vegetation", "green", "greener", "plants", "trees", "forest", "crops", "farming", "deforestation"],
    typical_questions: ["Is the land getting greener?", "Are forests shrinking here?"],
    caveats: [
      "Clouds can contaminate monthly values in the rainy season.",
      "NDVI saturates over dense forest, so small changes there are hard to see.",
    ],
    recommended_min_years: 15,
    model_or_measurement: "measurement",
  },
];
const VAR = Object.fromEntries(VARIABLES.map((v) => [v.id, v]));
const PRESETS = JSON.parse(readFileSync(join(REPO, "data", "regions", "presets.geojson"), "utf8"));
const REGION = Object.fromEntries(PRESETS.features.map((f) => [f.properties.id, f]));

// ---------- API wrapper (mirrors _finish + verdict_template in apps/api) ----------
const fmt = (v) => (v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`);
function verdictTemplate(result, variable, regionName) {
  const tr = result.trend;
  const g = result.evidence_grade;
  const p = result.tests.modified_mk.p;
  const period = `${result.period.start.slice(0, 4)}–${result.period.end.slice(0, 4)}`;
  const kind = variable.model_or_measurement === "model" ? "model estimate" : "satellite measurement";
  const word = { increasing: "rising", decreasing: "falling" }[tr.direction] ?? "showing no clear trend";
  const [lo, hi] = tr.ci95_per_decade;
  const out = {
    what: `${variable.name.en} (${kind}) is ${word}.`,
    where: `Averaged over ${regionName}, ${period}.`,
    how_much: `About ${fmt(tr.sen_slope_per_decade)} ${variable.units} per decade (95% range ${fmt(lo)} to ${fmt(hi)}).`,
    significant: `Evidence grade ${g.grade} (${g.label.toLowerCase()}); autocorrelation-corrected Mann-Kendall p ${p < 0.001 ? "< 0.001." : `= ${p.toFixed(3)}.`}`,
  };
  const h = result.significance_horizon ?? {};
  if (h.needed && h.years_estimate)
    out.significant += ` If the trend continues, roughly ${h.years_estimate} more years of data may be needed to confirm it (an estimate).`;
  return out;
}
function finish(runId, core, variableId, regionName, geometry, regional = true) {
  const variable = VAR[variableId];
  const full = {
    run_id: runId,
    _warning: WARNING,
    variable: {
      id: variable.id,
      name: `${variable.name.en} (SYNTHETIC)`,
      units: variable.units,
      kind: variable.model_or_measurement,
    },
    region: { name: regionName, geometry },
    ...core,
    provenance: {
      datasets: [variable.source, { source: "SYNTHETIC series from apps/web/scripts/make-fixtures.mjs" }],
      steps: [
        "Quality masks and fill values removed",
        regional ? "Latitude-weighted regional mean" : "Nearest grid cell",
        "Monthly anomalies (each calendar month's mean removed)",
        "Theil-Sen slope with 95% interval",
        "Mann-Kendall (original, Hamed-Rao modified, seasonal, annual) and OLS t-test",
        "Pettitt change-point test; evidence grade A-D",
      ],
      code_version: CODE_VERSION,
      created_at: CREATED_AT,
    },
  };
  full.verdict = verdictTemplate(full, variable, regionName);
  return full;
}
const write = (name, data) =>
  writeFileSync(join(OUT, name), typeof data === "string" ? data : `${JSON.stringify(data)}\n`);

// ---------- POST /trend scenarios ----------
// Grade A: long, clean, steadily warming Kumasi temperature. All SHOULD fields present.
const gradeA = finish(
  "fixture-grade-a",
  analyze(
    synth({
      start: "1981-01",
      end: "2025-12",
      seed: 11,
      base: 26.2,
      seasonalAmp: 1.6,
      slopePerYear: 0.021,
      noise: 0.28,
      gapEvery: 90,
    }),
    {
      grade: "A",
      label: "Strong evidence",
      extraReasons: ["Annual and seasonal checks agree", "No abrupt shift mid-record"],
    },
  ),
  "merra2_t2m",
  "Kumasi (SYNTHETIC)",
  REGION.kumasi.geometry,
);

// Grade D: short, noisy rainfall record with a mid-record shift. Change-point + horizon present.
const gradeDCore = analyze(
  synth({
    start: "2000-06",
    end: "2025-12",
    seed: 23,
    base: 120,
    seasonalAmp: 85,
    slopePerYear: -0.08,
    noise: 38,
    ar: 0.15,
    gapEvery: 40,
    shiftAt: "2012-07",
    shift: 9,
    floor: 0,
  }),
  {
    grade: "D",
    label: "No significant trend",
    extraReasons: [], // the engine lists only the three base reasons for grade D
    notices: ["Algorithm version changes can shift values."],
  },
);
gradeDCore.change_point = { detected: true, date: "2012-07", slope_before: -3.1, slope_after: 1.4, p: 0.031 };
gradeDCore.significance_horizon = {
  needed: true,
  years_estimate: 22,
  assumptions: "Assumes the current trend and year-to-year noise continue unchanged. An estimate, not a forecast.",
};
const gradeD = finish("fixture-grade-d", gradeDCore, "gpm_precip", "Kumasi (SYNTHETIC)", REGION.kumasi.geometry);

// Null SHOULD fields: every optional block is null and must be hidden by the UI.
const nullCore = analyze(
  synth({
    start: "2000-02",
    end: "2025-12",
    seed: 37,
    base: 0.62,
    seasonalAmp: 0.08,
    slopePerYear: -0.0011,
    noise: 0.025,
  }),
  {
    grade: "B",
    label: "Moderate evidence",
  },
);
Object.assign(nullCore, { change_point: null, significance_horizon: null, data_quality: null });
nullCore.tests.seasonal_mk = null;
nullCore.tests.annual_mk = null;
const nullShould = finish(
  "fixture-null-should",
  nullCore,
  "modis_ndvi",
  "Ashanti Region (box) (SYNTHETIC)",
  REGION.ashanti.geometry,
);

// POST /trend-at-point: a single grid cell (compute_horizon=False in the API).
const pointCore = analyze(
  synth({ start: "1981-01", end: "2025-12", seed: 41, base: 25.9, seasonalAmp: 1.8, slopePerYear: 0.017, noise: 0.35 }),
  {
    grade: "B",
    label: "Moderate evidence",
    extraReasons: ["Annual means point the same way"],
  },
);
const point = finish(
  "fixture-point",
  pointCore,
  "merra2_t2m",
  "Grid cell near 6.75°, -1.56° (SYNTHETIC)",
  { type: "Point", coordinates: [-1.5625, 6.75] },
  false,
);

for (const run of [gradeA, gradeD, nullShould, point]) {
  console.log(
    `${run.run_id}: grade ${run.evidence_grade.grade}, ${run.trend.direction}, slope/dec ${run.trend.sen_slope_per_decade.toFixed(3)}, p_mod ${run.tests.modified_mk.p.toExponential(2)}`,
  );
}
write("trend.grade-a.json", gradeA);
write("trend.grade-d.json", gradeD);
write("trend.null-should.json", nullShould);
write("trend-at-point.json", point);

// ---------- GET /trend-map + GET /opposite-trends (west_africa) ----------
const LAT = Array.from({ length: 40 }, (_, i) => 0.25 + i * 0.5);
const LON = Array.from({ length: 80 }, (_, j) => -19.75 + j * 0.5);
// Land mask from the real coastline (public/geo/boundaries.json, Natural Earth). Cells whose centre is
// in no country are ocean → null, like the real cached grids.
const BOUNDS = JSON.parse(readFileSync(join(HERE, "..", "public", "geo", "boundaries.json"), "utf8"));
function inRing(lon, lat, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const isLand = (la, lo) =>
  BOUNDS.countries.some((c) => c.rings.reduce((acc, r) => (inRing(lo, la, r) ? !acc : acc), false));
const isOcean = (la, lo) => !isLand(la, lo);

function benjaminiHochberg(ps, q) {
  const idx = ps
    .map((p, i) => [p, i])
    .filter(([p]) => p !== null)
    .sort((a, b) => a[0] - b[0]);
  const m = idx.length;
  let k = -1;
  idx.forEach(([p], r) => {
    if (p <= ((r + 1) / m) * q) k = r;
  });
  const out = ps.map(() => 0);
  for (let r = 0; r <= k; r++) out[idx[r][1]] = 1;
  return out;
}

function makeMap(variableId, seed, field, noise, seScale, clusters) {
  const rng = mulberry32(seed);
  // Spatially correlated noise (box-blurred white noise, rescaled), like real climate fields.
  let field2 = LAT.map(() => LON.map(() => gaussian(rng)));
  for (let pass = 0; pass < 3; pass++) {
    field2 = field2.map((row, i) =>
      row.map((_, j) => {
        let sum = 0;
        let n = 0;
        for (let di = -2; di <= 2; di++)
          for (let dj = -2; dj <= 2; dj++) {
            const v = field2[i + di]?.[j + dj];
            if (v !== undefined) {
              sum += v;
              n += 1;
            }
          }
        return sum / n;
      }),
    );
  }
  const sd = Math.sqrt(mean(field2.flat().map((v) => v * v)));
  const slope = [];
  const p = [];
  LAT.forEach((la, li) => {
    const sRow = [];
    const pRow = [];
    LON.forEach((lo, lj) => {
      if (isOcean(la, lo)) {
        sRow.push(null);
        pRow.push(null);
        return;
      }
      const s = field(la, lo) + (field2[li][lj] / sd) * noise;
      const se = seScale * (0.7 + 0.6 * rng());
      sRow.push(r6(s));
      pRow.push(r6(pTwo(s / se)));
    });
    slope.push(sRow);
    p.push(pRow);
  });
  const flatSig = benjaminiHochberg(p.flat(), 0.1);
  const sig = LAT.map((_, i) => flatSig.slice(i * LON.length, (i + 1) * LON.length));
  const variable = VAR[variableId];
  const map = {
    _warning: WARNING,
    grid: { lat: LAT, lon: LON, downsample_step: 1 },
    slope_per_decade: slope,
    p,
    fdr_significant: sig,
    fdr_level: 0.1,
    method: "Sen slope and Mann-Kendall on annual means per pixel; Benjamini-Hochberg FDR (Wilks 2016).",
    palette_polarity: variable.palette_polarity,
    units_per_decade: `${variable.units} per decade`,
  };

  // Opposite trends: significant cells inside the predefined boxes, by sign.
  const weightOf = (i) => Math.cos((LAT[i] * Math.PI) / 180);
  let pos = 0;
  let neg = 0;
  sig.forEach((row, i) =>
    row.forEach((v, j) => {
      if (!v) return;
      if (slope[i][j] > 0) pos += weightOf(i);
      else neg += weightOf(i);
    }),
  );
  const total = pos + neg;
  const out = { rising: null, falling: null };
  for (const c of clusters) {
    const cells = [];
    sig.forEach((row, i) =>
      row.forEach((v, j) => {
        if (
          v &&
          LAT[i] >= c.lat[0] &&
          LAT[i] <= c.lat[1] &&
          LON[j] >= c.lon[0] &&
          LON[j] <= c.lon[1] &&
          Math.sign(slope[i][j]) === (c.name === "rising" ? 1 : -1)
        )
          cells.push([i, j]);
      }),
    );
    if (cells.length >= 3)
      out[c.name] = {
        cells: cells.length,
        mask_indices: cells,
        result: analyze(synth(c.series), { grade: c.grade, label: c.label }),
      };
  }
  const found = out.rising !== null && out.falling !== null;
  const opposite = {
    _warning: WARNING,
    found,
    rising_share: total ? pos / total : 0,
    falling_share: total ? neg / total : 0,
    divergence_score: total ? pos / total : null,
    clusters: out,
    sentence: found
      ? "The same variable is rising in some places and falling in others in this region."
      : "No opposite trends found: significant changes here all point the same way, or there are none.",
  };
  return { map, opposite };
}

const t2m = makeMap("merra2_t2m", 101, (la) => 0.1 + 0.012 * la, 0.05, 0.1, []);
const gpm = makeMap(
  "gpm_precip",
  202,
  (la, lo) => (la > 11 ? 3.5 + 0.3 * (la - 11) : la < 8.5 ? -4 - 0.4 * (8.5 - la) + 0.05 * lo : 0),
  2.2,
  1.9,
  [
    {
      name: "rising",
      lat: [11, 17],
      lon: [-12, 15],
      grade: "B",
      label: "Moderate evidence",
      series: {
        start: "2000-06",
        end: "2025-12",
        seed: 61,
        base: 55,
        seasonalAmp: 50,
        slopePerYear: 0.45,
        noise: 14,
        floor: 0,
      },
    },
    {
      name: "falling",
      lat: [4, 8.5],
      lon: [-9, 9],
      grade: "B",
      label: "Moderate evidence",
      series: {
        start: "2000-06",
        end: "2025-12",
        seed: 62,
        base: 140,
        seasonalAmp: 70,
        slopePerYear: -0.6,
        noise: 22,
        floor: 0,
      },
    },
  ],
);
const ndvi = makeMap("modis_ndvi", 303, (la) => (la > 12 ? 0.006 : la < 8 ? -0.007 : 0), 0.003, 0.0026, [
  {
    name: "rising",
    lat: [12, 17],
    lon: [-15, 15],
    grade: "C",
    label: "Suggestive only",
    series: {
      start: "2000-02",
      end: "2025-12",
      seed: 71,
      base: 0.28,
      seasonalAmp: 0.1,
      slopePerYear: 0.0009,
      noise: 0.03,
    },
  },
  {
    name: "falling",
    lat: [4, 8],
    lon: [-9, 9],
    grade: "B",
    label: "Moderate evidence",
    series: {
      start: "2000-02",
      end: "2025-12",
      seed: 72,
      base: 0.66,
      seasonalAmp: 0.06,
      slopePerYear: -0.0012,
      noise: 0.02,
    },
  },
]);
for (const [id, m] of [
  ["merra2_t2m", t2m],
  ["gpm_precip", gpm],
  ["modis_ndvi", ndvi],
]) {
  write(`trend-map.${id}.west_africa.json`, m.map);
  write(`opposite-trends.${id}.west_africa.json`, m.opposite);
  console.log(
    `map ${id}: ${m.map.fdr_significant.flat().reduce((a, b) => a + b, 0)} FDR cells, opposite found=${m.opposite.found}`,
  );
}

// ---------- small endpoints ----------
write("health.json", { status: "ok", code_version: CODE_VERSION, cached_results: [], using_fixtures: true });
write("variables.json", VARIABLES);
write("regions-presets.json", PRESETS);
write("narrative.json", { sentences: gradeA.verdict, source: "template" });
write("problem.not-cached.json", {
  detail: {
    type: "about:blank",
    title: "Not cached yet",
    detail: "No cached result for this variable and region. Run `make seed` after ingesting data.",
  },
});
console.log(`fixtures written to ${OUT}`);
