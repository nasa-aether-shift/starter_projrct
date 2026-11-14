#!/usr/bin/env node
// Builds public/geo/boundaries.json: West African country borders + Ghana's regions, simplified for the globe.
// Source: Natural Earth 1:10m (public domain), https://www.naturalearthdata.com/
//   curl -O https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson
//   curl -O https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson
// Usage: node scripts/build-boundaries.mjs <admin0.geojson> <admin1.geojson>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [admin0Path, admin1Path] = process.argv.slice(2);
if (!admin0Path || !admin1Path) {
  console.error("usage: node scripts/build-boundaries.mjs <admin0.geojson> <admin1.geojson>");
  process.exit(1);
}

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "geo", "boundaries.json");
/** Country rings touching this window are kept (West Africa + neighbours). */
const WINDOW = { west: -26, east: 24, south: -6, north: 28 };
const FOCUS_COUNTRY = "GHA";
const TOL = { country: 0.012, region: 0.006 }; // degrees (~1.3 km / ~0.7 km)

const r3 = (v) => Math.round(v * 1000) / 1000;

function simplify(points, tol) {
  if (points.length < 3) return points;
  const sq = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy || 1e-12;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > sq) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]).map(([x, y]) => [r3(x), r3(y)]);
}

function rings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function bbox(rs) {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const r of rs)
    for (const [x, y] of r) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
  return { w, s, e, n };
}

const touches = (b) => b.e >= WINDOW.west && b.w <= WINDOW.east && b.n >= WINDOW.south && b.s <= WINDOW.north;

const admin0 = JSON.parse(readFileSync(admin0Path, "utf8"));
const countries = [];
for (const f of admin0.features) {
  // Keep only the rings inside the window (drops e.g. France's overseas territories elsewhere).
  const rs = rings(f.geometry).filter((r) => touches(bbox([r])));
  if (!rs.length) continue;
  const p = f.properties;
  const simplified = rs.map((r) => simplify(r, TOL.country)).filter((r) => r.length >= 4);
  if (!simplified.length) continue;
  countries.push({
    iso: p.ADM0_A3,
    name: p.NAME,
    label: [r3(p.LABEL_X), r3(p.LABEL_Y)],
    rings: simplified,
  });
}

const admin1 = JSON.parse(readFileSync(admin1Path, "utf8"));
const regions = [];
for (const f of admin1.features) {
  const p = f.properties;
  if (p.adm0_a3 !== FOCUS_COUNTRY) continue;
  const simplified = rings(f.geometry)
    .map((r) => simplify(r, TOL.region))
    .filter((r) => r.length >= 4);
  if (!simplified.length) continue;
  regions.push({
    country: FOCUS_COUNTRY,
    name: p.name,
    label: [r3(p.longitude), r3(p.latitude)],
    rings: simplified,
  });
}

mkdirSync(dirname(OUT), { recursive: true });
const payload = {
  source: "Natural Earth 1:10m admin-0 countries and admin-1 states/provinces (public domain), simplified",
  focusCountry: FOCUS_COUNTRY,
  countries,
  regions,
};
writeFileSync(OUT, JSON.stringify(payload));
const pts = (xs) => xs.reduce((n, x) => n + x.rings.reduce((m, r) => m + r.length, 0), 0);
console.log(
  `wrote ${OUT}: ${countries.length} countries (${pts(countries)} pts), ${regions.length} ${FOCUS_COUNTRY} regions (${pts(regions)} pts)`,
);
console.log("regions:", regions.map((r) => r.name).join(", "));
