# Project status — Earth Data Detective

> **Snapshot, now out of date.** This report describes `main` at `50b3612`, before PRs #10 to #21. Since then:
> - real vegetation data was added: EVI (#14) and NDVI (#19)
> - the NOAA station and ground-truth wording was corrected (#14, #15)
> - the opposite-trend response now reports its counts (#16)
> - AI search and a working AI rewrite were added (#20)
> - Render deploy settings were added (#21)
>
> For the current state see `docs/VERIFIED.md`, `docs/KNOWN_LIMITS.md`, `docs/VALIDATION_REPORT.md` and `docs/DECISIONS.md`. Kept for the record; do not use its counts, checklist or next steps as current.

Checked Sun 15 Nov 2026, 09:14 UTC (Kumasi time), on `main` at `50b3612` (PR #8 merge). No code was changed for this report. "NOT VERIFIED" means it could not be checked here.

## 1. One-paragraph summary

Earth Data Detective is a Next.js web app with a FastAPI backend and a Python statistics engine. A visitor can:

- open the home page (a 3D Cesium globe with a West Africa trend map) or the Explore page;
- pick a variable and a place, or click the globe;
- get a verdict card (direction, magnitude, evidence grade), a time-series chart, provenance and a CSV.

Real NASA data is cached for **air temperature (MERRA-2)** and **rainfall (GPM IMERG)**. **NDVI has no data.** Everything works on the build laptop with `USE_FIXTURES=0`. **Nothing is deployed** (section 6).

## 2. Data

**Files in `data/cache`:**

- `results/merra2_t2m__kumasi.json`
- `grids/merra2_t2m__west_africa.npz` and `grids/gpm_precip__west_africa.npz`
- `maps/merra2_t2m__west_africa.json` and `maps/gpm_precip__west_africa.json`
- `manifest.json`

**Sources, from `manifest.json`:**

| Key | Source | Version | Units | Retrieved |
| --- | --- | --- | --- | --- |
| `merra2_t2m__kumasi` | NASA Giovanni area-average export (bbox -1.8,6.55,-1.45,6.85) | 5.12.4 | K → degC | 2026-11-14 |
| `grid:merra2_t2m__west_africa` | GES DISC M2TMNXSLV via Earthdata cloud OPeNDAP | 5.12.4 | K → degC | 2026-11-14 |
| `grid:gpm_precip__west_africa` | GES DISC GPM_3IMERGM via Earthdata cloud OPeNDAP | 07 | mm/hr → mm/day | 2026-11-14 |

**Grids** (West Africa, no missing values):

- Temperature: 1980-01 to 2025-12, 552 months, 41 × 65 cells.
- Rainfall: 2000-06 to 2025-09, 304 months, 40 × 80 cells (0.1° averaged to 0.5°).

**Cached result, Kumasi temperature** (`results/merra2_t2m__kumasi.json`, numbers copied exactly):

- **Grade D** ("No significant trend"); direction `no_significant_trend`.
- Sen slope **0.09155046434984995 degC per decade**; 95% CI [-0.0008462271062261204, 0.1816125087108002].
- Modified Mann-Kendall p **0.23739825476586685**.
- Record 2005-01 to 2025-12: **252 months**, coverage 1.0. Years-to-significance estimate: 25.

**Maps** (FDR q = 0.1):

| Map | Cells | FDR-significant | Opposite trends found | Largest rising cluster |
| --- | --- | --- | --- | --- |
| Temperature | 2,665 | 2,377 (all rising) | **False** | 2,374 cells; grade B; Sen 0.2233763509185134 degC/decade; p 1.0476344902698997e-08 |
| Rainfall | 3,200 | 87 (49 rising, 38 falling) | **False** | 32 cells; grade A; Sen 0.008597169083213946 mm/day/decade; p 0.0006644122895003157 |

**Live grid result, same Kumasi cell, 1980-01 to 2025-12** (`/trend-at-point`): **grade C**, Sen 0.12361496969826087 degC/decade, p 0.0620061697952663.

**`docs/VERIFIED.md`:** MERRA-2 and GPM are filled in, with sources. MODIS NDVI, MODIS LST, OMI NO₂ and the POWER fallback are **empty**.

## 3. Statistics engine

**Implemented** (`packages/stats_engine`):

- season removal and coverage checks;
- Mann-Kendall, Hamed-Rao modified MK, seasonal MK, annual-means MK;
- Theil-Sen slope with CI, and OLS;
- lag-1 autocorrelation and effective n;
- Pettitt change-point;
- years-to-significance;
- `analyze_series`;
- the grade A–D rubric (`grade_thresholds.yaml`);
- per-pixel trends, Benjamini-Hochberg FDR, latitude weights, regional series, the opposite-trend detector.

**Tests:**

- **CI on `main`** (Linux, run for the PR #8 merge, 06:55 UTC): **65 passed** (64 validation plus 1 chunk test). PASS.
- **Locally:** `test_validation.py` cannot be collected because `pymannkendall` is not installed (ERROR); `test_pixel_chunks.py` 1 passed. `make` is not installed on this laptop.

**Changes since the starter** (`git diff e3212ff HEAD -- packages/stats_engine`): only `maps.py`, where `pixel_trends` is now chunked (+44/−15), and a new `tests/test_pixel_chunks.py`. Thresholds are unchanged.

`docs/BACKEND_LOG.md` (B5) says **the STATS owner has not reviewed the chunking change yet**. Decisions #2–5 document the map method, Pettitt on residuals, the years-to-significance simulations and the modified-MK fallback.

## 4. API

`apps/api/app/main.py`. Calls made today against the running instance on :8000, which has `using_fixtures:false`:

| Endpoint | Status | Data |
| --- | --- | --- |
| GET /health | 200 | `cached_results: [merra2_t2m__kumasi]`, `missing_cache_files: []` |
| GET /variables | 200 | gpm_precip (mm/day), merra2_t2m (degC), modis_ndvi (index) |
| GET /variables/{id} | 200 (checked 2026-11-14; NOT VERIFIED today) | catalog |
| GET /regions/presets | 200 | kumasi, ashanti, west_africa, eastern_china, india_igp |
| POST /trend merra2_t2m/kumasi | 200 | real, cached Giovanni result |
| POST /trend gpm_precip/ashanti | 200 | real, built from the grid |
| POST /trend modis_ndvi/kumasi | 404 "Not available yet" | none |
| POST /trend-at-point | 200 | real grid |
| GET /trend-map/{temp, rain}/west_africa | 200 | real |
| GET /trend-map/modis_ndvi/west_africa | 404 | none |
| GET /opposite-trends/gpm_precip/west_africa | 200 | real, `found: false` |
| GET /runs/{id}, /runs/{id}/csv | 200 | real |
| POST /narrative | 200 | `source: template` |
| POST /variables/search | 405 | not implemented; the web falls back to keyword matching |

**`USE_FIXTURES` defaults to `"1"` in the code (line 33).** I started a default instance on :8001: `/health` reported `using_fixtures: true`, and POST /trend modis_ndvi/kumasi returned **200 with the SYNTHETIC fixture** (`variable.id = fixture_t2m`, "Synthetic test region", `_warning` present).

**AI:** `rewrite()` and `numeric_guard()` are wired into `/narrative` (`apps/api/app/ai.py`).

**LLM key configured: no.** It is not set in this shell, there is no `.env` file, and `/narrative` returned `template`.

## 5. Frontend

**Routes:**

- `/`: globe, intro, map-layer card
- `/explore`: globe, click a point, presets
- `/investigate`: wizard
- `/analysis/[runId]`: verdict, series, opposite trends, method and provenance, download
- `/cases/kumasi`
- `/method`
- `/status`
- `error` and `not-found` pages

**Components present:**

- globe (`earth-globe`, `landing-globe`), trend-map legend and hover;
- 2D box map (`box-draw-map`), wizard, `VerdictCard`, `TimeSeriesChart`, Tale of Two Regions;
- provenance panel, CSV download, Kumasi case, space intro, fixture banner.

**Libraries:** Next 16.4.6, React 19.3, CesiumJS 1.147, three 0.187, ECharts 6, TanStack Query 5, Zod 4, framer-motion, radix/shadcn, d3-scale-chromatic.

**Wiring:** there is no `apps/web/.env.local`, so `useFixtures` is false and the web calls `http://localhost:8000/api/v1` (real data). But `apps/web/.env.example` sets `NEXT_PUBLIC_USE_FIXTURES=1`.

**Notes:**

- **"2D map":** CesiumJS replaced MapLibre (DECISIONS #7). There is no separate flat 2D map; the globe zooms and tilts. Clicking a point works.
- **Drawing a box** is hidden by `NEXT_PUBLIC_ENABLE_BOX` (default 0), even though the API now supports boxes on the grids.
- **Build:** `npm run build` PASS (10 routes, exit 0).

## 6. Deployment

**Not deployed.**

- There is no `render.yaml`, `vercel.json` or `.vercel` directory.
- GitHub has 0 deployments recorded.
- PR checks show only the `web` and `python` CI jobs, with no Vercel preview.
- Vercel and Render dashboards: NOT VERIFIED.

Variables needed:

- **API (Render):** `USE_FIXTURES=0`, `APP_ENV=production`, `ALLOWED_ORIGINS=<web URL>`, optionally `LLM_API_KEY`.
- **Web (Vercel):** `NEXT_PUBLIC_API_URL=<api URL>/api/v1`, `NEXT_PUBLIC_USE_FIXTURES=0`, `NEXT_PUBLIC_AUTO_LOCATE=0` on the projector.

## 7. MUST checklist from CLAUDE.md

| MUST | Status | Evidence |
| --- | --- | --- |
| Real cached data for Kumasi (temperature, rainfall) | Done | Temperature: cached result, 2005–2025, grade D. Rainfall: 200 from the grid (nearest cell) |
| West Africa trend map | Done | Two map JSONs; `/trend-map` 200 for temperature and rainfall |
| Verdict card (Direction/Magnitude/Evidence + 4 sentences) | Done | `verdict-card.tsx`; real verdict for Ashanti seen 2026-11-14 |
| Time-series chart | Done | `time-series-chart.tsx` |
| Globe → 2D map → click a point | Partial | Cesium globe and click work; no separate 2D map (DECISIONS #7) |
| Opposite-trend view | **Partial** | The view exists, but `found: false` on real data. The rainfall drying cluster (25 cells) is below the 1% minimum (32 cells) |
| Provenance panel | Done | `provenance-panel.tsx`; clean source URLs and versions |
| CSV export | Done | `/runs/{id}/csv` 200 |
| Guarded AI wording | Partial | Template plus numeric guard work; the AI rewrite is inactive (no key) |
| Kumasi case page | **Partial** | Real data, but the story text says "Rainfall tells a different story…" while temperature is grade D |
| Deployed web (Vercel) + API (Render) | **Missing** | Section 6 |

## 8. Bugs and risks

1. **Not deployed.** The demo depends on the laptop.
2. **The local API was stopped twice by low memory** (Claude Code background jobs). Run it in your own terminal.
3. **Synthetic data can appear.** `make api`, or the code default `USE_FIXTURES=1`, makes uncached requests return the fixture with 200 (verified on :8001). The web's yellow strip shows when `/health` says `using_fixtures: true`. `apps/web/.env.example` also enables fixtures.
4. **No real opposite-trend example**, a "never cut" item in the build doc. Needs a STATS decision on the 1% cluster rule.
5. **Inconsistent Kumasi temperature.** The case page and the preset give grade D (2005–2025), while a map click on the same cell gives grade C (1980–2025).
6. **Kumasi case story text** contradicts the data (STORY).
7. **Unreviewed stats change.** `pixel_trends` chunking still has no STATS review.
8. **NDVI missing:** the Greenness layer shows "Not available yet".
9. **Console:** a React hydration error on `/status` was observed on 2026-11-14 (it comes from the fixture-banner health query). NOT VERIFIED today.
10. **Git hygiene:**
    - `origin/Audrey` has 7 unmerged commits based on old history; merging it would remove the B5 work.
    - `main` contains duplicated pre- and post-force-push commits.
    - Branch protection is unavailable on the current GitHub plan.
    - Commits `f01ff02`, `016f1dd` and `52ecaa3` carry Claude co-author trailers.
11. **Secrets:** none found in tracked files; no `.env` tracked. An Earthdata token was shared in chat on 2026-11-14 and should be rotated after the event.
12. **Hard-coded numbers in the UI:** only the test-suite description on `/method` ("64 checks, all passing", which matches CI) and `LAST_YEAR = 2025` in the wizard.

## 9. Recommended next steps before code freeze (11:00, about 1 h 45 min left)

1. **Deploy the API to Render.** Add `render.yaml`; Python 3.12; start with `uvicorn app.main:app --host 0.0.0.0 --port $PORT` from `apps/api`; set the variables from section 6. **35 min.** Needs a Render account.
2. **Deploy the web to Vercel.** Root `apps/web`; set the variables from section 6; add the Vercel URL to `ALLOWED_ORIGINS`; check `/status` is all green. **25 min.**
3. **Prepare a local backup.** API in your own terminal with `USE_FIXTURES=0`, plus `npm run dev`; rehearse home → Explore → Ashanti → analysis → Kumasi case. **10 min.**
4. **STORY: fix the Kumasi case text** to tell the honest "not yet significant" story, and pick which Kumasi period to show. **15 min.**
5. **STATS: decide the opposite-trend minimum cluster size**, or present the rainfall map with "no opposite trends found" honestly. Re-seed takes 5 min if changed. **10 min.**
6. **Write `docs/VALIDATION_REPORT.md`** from the CI log (65 stats tests and 39 API tests passing). **15 min**; docs only, and can follow the freeze.
7. **Record screen captures** from whichever version works, deployed or local. STORY, in parallel.
