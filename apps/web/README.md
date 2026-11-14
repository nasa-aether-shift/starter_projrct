# Web app (WEB owns this)

Next.js 16 (App Router, Turbopack, Cache Components) · React 19 · TypeScript strict · Tailwind CSS 4 + shadcn/ui ·
TanStack Query · Zod 4 · CesiumJS (3D globe) · ECharts · Framer Motion · d3-scale-chromatic.

## Run it

```bash
cd apps/web
npm install
cp .env.example .env.local     # fixtures on by default
npm run dev                    # http://localhost:3000
```

To use the real API, start it (`make api` from the repo root), then set `NEXT_PUBLIC_USE_FIXTURES=0` in `.env.local`
and restart `npm run dev`.

## Environment

| Variable                       | Default                        | Meaning                                                               |
| ------------------------------ | ------------------------------ | --------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`          | `http://localhost:8000/api/v1` | API base, including `/api/v1`                                         |
| `NEXT_PUBLIC_USE_FIXTURES`     | `1` in `.env.example`          | `1` answers every call from `fixtures/` and shows a warning strip     |
| `NEXT_PUBLIC_GLOBE_MODE`       | `cesium`                       | `static` = image hero + region picker, no WebGL globe                 |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | empty                          | Cesium World Terrain if set, smooth ellipsoid otherwise               |
| `NEXT_PUBLIC_GLOBE_HDR`        | `0`                            | High dynamic range rendering on the globe                             |
| `NEXT_PUBLIC_INTRO`            | `1`                            | Space intro on a visitor's first launch (`?intro=1` replays); `0` off |
| `NEXT_PUBLIC_ENABLE_BOX`       | `0`                            | Offer "Draw a box" regions; keep `0` until `/trend` takes a bbox      |

`NEXT_PUBLIC_*` values are baked in at build time; restart or rebuild after changing them.

## Scripts

| Script                                                | What it does                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npm run verify`                                      | typecheck + lint + fixture contract check + production build (run before a PR) |
| `npm run fixtures`                                    | regenerate the SYNTHETIC fixtures (`scripts/make-fixtures.mjs`)                |
| `npm run check:fixtures`                              | validate every fixture and the API's shared fixture against the Zod schemas    |
| `node scripts/build-boundaries.mjs <admin0> <admin1>` | rebuild `public/geo/boundaries.json` from Natural Earth (see script header)    |
| `npm run gen:types`                                   | `openapi-typescript` from the running API's `/openapi.json` into `types/`      |
| `npm run format`                                      | Prettier (with Tailwind class sorting)                                         |

## Layout

```
app/            routes (/, /explore, /investigate, /analysis/[runId], /cases/kumasi, /method)
components/     UI (ui/ = shadcn primitives)
lib/api/        typed client (fixtures ↔ real API switch), TanStack hooks, problem-object errors
lib/schemas/    Zod schemas = the response contract (source of truth for TS types)
lib/cesium/     globe setup (step 2)
lib/i18n/       English / Twi dictionary (step 8)
fixtures/       one SYNTHETIC JSON per endpoint (Grade A, Grade D, null-SHOULD cases)
scripts/        fixture generator + contract check
types/          generated OpenAPI types
```

## Globe (CesiumJS 1.147)

- `npm install` runs `scripts/copy-cesium.mjs`, which copies Cesium's `Workers`, `Assets`, `Widgets` and `ThirdParty`
  into `public/cesium` (gitignored). `lib/cesium/load.ts` sets `window.CESIUM_BASE_URL = "/cesium"` before a dynamic
  `import("cesium")`. If the globe is blank, check that `/cesium/Workers/` loads in the Network tab (re-run
  `npm run cesium:assets`).
- `components/globe/globe.tsx` loads the globe with `next/dynamic` (`ssr: false`). `NEXT_PUBLIC_GLOBE_MODE=static` shows a
  NASA Blue Marble image instead, and the globe falls back to that automatically if WebGL fails.
- Imagery (`lib/cesium/imagery.ts`): NASA GIBS WMTS Blue Marble base and Black Marble night lights; below ~1,500 km
  it fades to Sentinel-2 cloudless 2024 by EOX (10 m, CC BY-NC-SA 4.0, credited on the globe). These public tiles
  are the only third-party calls the browser makes.
- The trend overlay has two textures (`lib/cesium/overlay.ts`): a detailed one for regional zoom and a bolder "beacon"
  with a wide glow that takes over above ~3,500 km, so hotspots stay visible from space.
- Performance (`lib/cesium/performance.ts`): a starting quality tier from device hints (phone, memory, cores,
  data-saver, software GL), a governor that steps quality down (MSAA → resolution → tile detail → atmosphere) if
  frames average under ~45 fps, and the render loop pauses while the globe is off-screen or the tab is hidden.
  Overlay colour tweaks are baked into the textures (layer saturation/contrast would add globe shader variants).
- Sky (`lib/cesium/solar-system.ts`): Cesium's star field, Sun and Moon, plus the planets at their real positions
  for the scene's date (JPL approximate elements; checked against Cesium's Sun to 0.003°), names on hover. Planets
  are drawn only above 6,000 km and just beyond the Earth, so they never force a second render pass.
- In development, `window.__viewer` and `window.Cesium` are exposed for console debugging and scripted screenshots.
- Camera, spin and fade settings live in `lib/cesium/config.ts`. The idle spin stops on any input, resumes after 5 s and
  never runs with `prefers-reduced-motion`.

## Fixtures

All fixture numbers are **synthetic**, computed by `scripts/make-fixtures.mjs` (Sen slope, Mann-Kendall, OLS, BH-FDR on
deterministic fake series), so they are internally consistent but not real. Never screenshot them for the pitch; the
yellow strip at the top of every page is there to stop that.

| Request                                               | Fixture                                                 |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `POST /trend` with `merra2_t2m`                       | `trend.grade-a.json`: Grade A, all SHOULD fields set    |
| `POST /trend` with `gpm_precip`                       | `trend.grade-d.json`: Grade D, change-point, horizon    |
| `POST /trend` with `modis_ndvi`                       | `trend.null-should.json`: every SHOULD field `null`     |
| `POST /trend-at-point`                                | `trend-at-point.json`                                   |
| `GET /trend-map/{v}/west_africa`                      | `trend-map.{v}.west_africa.json`                        |
| `GET /opposite-trends/{v}/west_africa`                | `opposite-trends.{v}.west_africa.json`                  |
| `GET /runs/{id}`, `/runs/{id}/csv`, `POST /narrative` | served from the trend fixtures by `run_id`              |
| `GET /health`, `/variables`, `/regions/presets`       | `health.json`, `variables.json`, `regions-presets.json` |

## Pages

| Route               | What                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| `/`                 | Spinning globe with the West Africa trend map, variable switcher, legend (+ table) |
| `/explore`          | Flies into Ghana; click a cell, pick a preset or draw a box; results slide in      |
| `/investigate`      | Wizard: question → variable → place → period → results (state in the URL)          |
| `/analysis/[runId]` | Verdict, Time series, Opposite trends, Method & provenance, Download               |
| `/cases/kumasi`     | Scroll story bound to live API results                                             |
| `/method`           | Pipeline, formulas, grade rubric, validation, references                           |
| `/status`           | Gate check: API health, catalog, presets, a Kumasi trend                           |

`/explore?place=kumasi` (or `ashanti`, `west_africa`) flies straight to a preset — handy for the pitch.

With fixtures on, try `/analysis/fixture-grade-a`, `/analysis/fixture-grade-d`, `/analysis/fixture-null-should`
(add `?tab=series`). Add `?lang=tw` to any URL for the Twi verdict card and Kumasi case (draft translation).

## Switching to the real API (step 6)

1. API role confirms `POST /trend` works on the real cache (`GET /health` lists `cached_results`).
2. In `.env.local` (or Vercel): `NEXT_PUBLIC_USE_FIXTURES=0`, `NEXT_PUBLIC_API_URL=<api>/api/v1`.
3. Restart or rebuild, then open `/status`: all four checks must be green, and the yellow banner must be gone.
4. `NEXT_PUBLIC_API_URL`'s origin must be in the API's `ALLOWED_ORIGINS`.

## Deploying to Vercel (step 9)

- New project from the repo, **Root Directory `apps/web`**, framework Next.js. `postinstall` copies Cesium's assets.
- Environment: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_USE_FIXTURES=0`, `NEXT_PUBLIC_GLOBE_MODE=cesium` (or `static` as the
  fallback), optional `NEXT_PUBLIC_CESIUM_ION_TOKEN`.
- Add the Vercel URL to the API's `ALLOWED_ORIGINS`.
- Check from a signed-out browser: `/status` green, `/cases/kumasi` loads, no requests to NASA except
  `gibs.earthdata.nasa.gov` tiles (DevTools → Network).

## Notes for the API owner

- `POST /trend` ignores `bbox`, `start`, `end`; drawn boxes get 404. `region.area_km2` is not sent.
- Errors are wrapped as `{"detail": {type,title,detail}}`; web handles both, the contract says top level.
- Verdict template prints `degC` (not °C) and rounds to 2 decimals, so NDVI reads "−0.01 (−0.01 to −0.00)".
- Runs live in memory: after a restart `/runs/{id}` 404s. Web re-runs from the URL when it can.
- `/variables/search` and `/compare` are not implemented; web falls back to keyword matching.
- Catalog `source.version` still says `<verify in CMR>` and is shown in the provenance panel.

## Contract notes (web side)

The Zod schemas follow what the running API sends; deviations from the written contract are logged in
`docs/DECISIONS.md`. In short: `region.area_km2` is optional, `data_quality.gaps` accepts a count or a list,
`evidence_grade.label` is accepted, the trend map uses `grid.lat[]/lon[]` with `[lat][lon]` arrays, and error bodies are
read either as a top-level problem object or FastAPI's `{"detail": {...}}`.

`NEXT_PUBLIC_AUTO_LOCATE` (default `1`): focus the globe on the visitor via the browser's location permission; set `0` on the projector.
