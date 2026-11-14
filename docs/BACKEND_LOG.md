# Backend work log

## B0 — baseline (2026-11-14)

### Scope

- Confirmed the frontend routes in `apps/web/lib/api/hooks.ts` and response schemas in `apps/web/lib/schemas/` before testing.
- Added `apps/api/tests/test_contract_vs_web_fixtures.py`. It exercises frontend-backed JSON routes against the existing synthetic web fixtures, including all three variable map/opposite-trend fixtures. The test writes fixture payloads only into pytest's temporary cache directory.
- No production endpoint, schema, scientific method, dependency manifest, Makefile target, frontend file, or shared schema was changed.

### Test inventory and results

- Stats suite: `packages/stats_engine/tests/test_validation.py` contains 11 test functions; the two parametrized tests expand the suite to 64 cases. Command, from `packages/stats_engine/`: `../../apps/api/.venv/bin/python -m pytest -q` — **64 passed in 29.86s**.
- API suite before the new contract test: `apps/api/tests/test_api.py` contained 4 test functions. The final API suite, including the new contract test, was run with `cd apps/api && .venv/bin/python -m pytest -q` — **5 passed in 2.34s**, with one Starlette deprecation warning about `httpx` / `httpx2`.
- Contract test alone: `cd apps/api && .venv/bin/python -m pytest -q tests/test_contract_vs_web_fixtures.py` — **1 passed in 1.96s**, with the same deprecation warning.
- Root README's claim of 64 stats validation tests passing agrees with this run. No README edits were made.
- The system `python3` initially lacked pytest, FastAPI, Pydantic, NumPy, SciPy, and HTTPX. The declared project test/API dependencies were installed into the temporary repo-local `apps/api/.venv` for this task; no dependency manifest was changed. Sandbox network isolation required approved package-index access. The virtual environment is task-local and will be removed before handoff.
- TestClient and local HTTP calls require local socket access in this environment. The initial sandbox-only API test attempt stalled at the first request; the final API suite and endpoint checks were run with local socket access enabled.

### Fixture-mode endpoint checks

The API was started locally with its default `USE_FIXTURES=1`; all returned trend values below are synthetic fixture values, not scientific findings. No NASA calls were made.

| Method and path | Status | Observation |
|---|---:|---|
| `GET /api/v1/health` | 200 | JSON |
| `GET /api/v1/variables` | 200 | JSON |
| `GET /api/v1/variables/merra2_t2m` | 200 | JSON |
| `GET /api/v1/regions/presets` | 200 | GeoJSON |
| `POST /api/v1/trend` | 200 | Shared synthetic fixture returned for the uncached request |
| `POST /api/v1/trend-at-point` | 200 | Shared synthetic fixture returned because no grid cache exists |
| `GET /api/v1/trend-map/merra2_t2m/west_africa` | 404 | Map cache absent; wrapped problem response |
| `GET /api/v1/opposite-trends/merra2_t2m/west_africa` | 404 | Map cache absent; wrapped problem response |
| `POST /api/v1/narrative` | 200 | Template response for the in-memory synthetic run |
| `GET /api/v1/runs/{run_id}` | 200 | In-memory synthetic run |
| `GET /api/v1/runs/{run_id}/csv` | 200 | `text/csv` |
| `POST /api/v1/variables/search` | 405 | Not implemented; optional frontend search falls back to local keyword matching |

The checks confirm there is no usable map cache in the repository. `GET /health` returned 200, but the fixture-mode status body must not be read as evidence that a real dataset is cached. The default API fallback marks the shared trend fixture with `_warning` but returns it for arbitrary uncached trend requests; keep `USE_FIXTURES=0` for real/demo mode until B4 makes fixture safety explicit.

### Contract comparison notes

- The test checks required non-underscore fixture keys and compatible JSON types, not scientific values. It follows the frontend's actual Zod flexibility: `resolution.spatial_deg` is string-or-number; GeoJSON coordinates are accepted by the custom geometry validator; series and selected analysis values are nullable; provenance dataset entries are open records; `data_quality.gaps` accepts a count or array.
- The first test drafts correctly exposed those permitted variants and were updated to match the Zod schema. The final compatibility test passes.
- API fixture fallback data is semantically generic: `/trend` for a `merra2_t2m` request can return `variable.id = fixture_t2m` and a synthetic point region. The shape-only contract test intentionally does not treat that as request/result correctness. The `_warning` marker and frontend synthetic-data banner must remain visible when using fixtures.
- The current wrapped error shape `{"detail":{"type":"about:blank","title":"...","detail":"..."}}` matches the web client's accepted FastAPI error form.

### Handoff

- No frontend/shared-schema changes are needed for B0.
- The human should keep the pre-existing worktree changes and untracked files intact; this task did not modify them.
- No NASA source metadata, real input CSV, dataset version, unit conversion, or citation was verified in B0.

## B1 — Giovanni import and file inspection (2026-11-14)

### Scope and implementation

- Added `pipelines/ingest/giovanni.py`. It reads a local UTF-8 monthly CSV, checks the selected header columns, requires source units and an exact operator-supplied expected-unit match, validates month formatting/order/continuity and duplicates, preserves explicit blank/`NA`/`NaN` values as missing months, and delegates the existing 8-year minimum and statistical pipeline to `stats_engine.analyze_series()`.
- On successful import it copies the exact input into `data/raw/`, writes a normalized `time,value` raw series for `pipelines/ingest/seed.py`, writes the analyzed result to `data/cache/results/<variable>__<region>.json` (the path read by `apps/api/app/main.py`), and updates `data/cache/manifest.json` with input filename, SHA-256, retrieval date, code version, source label, units, month count, and cache file name.
- The supported input format is UTF-8 CSV with `# Units: ...` metadata (or units in the selected value header), optional `# Source: ...`, and `time,value` columns by default. Other column names can be selected with CLI flags. No unit conversion is performed. This input format has not yet been checked against a real Giovanni download.
- Added `python -m pipelines.ingest.giovanni --inspect FILE`; it lazily imports xarray and prints global attributes plus variable names, dimensions, shapes, units, and attributes using netCDF4, h5netcdf, or xarray auto-detection.
- Confirmed `pipelines/ingest/sources.py` already has a NASA POWER monthly point loader (`fetch_power`) with `requests` imported inside the function. No duplicate loader or live NASA call was added.
- Added `pipelines/ingest/tests/test_giovanni.py`; every synthetic input is labelled as synthetic and lives in pytest temporary directories. Tests cover valid cache/manifest output, preserved gaps, missing/incorrect units, headers, date validation, chronology, duplicates, continuity, non-numeric data, minimum record length, malformed rows, and inspection output.
- No dependency manifests, Makefile targets, catalog files, `docs/VERIFIED.md`, stats-engine code, API routes, frontend files, or shared schemas were changed. Existing dependencies are reused; xarray is imported only inside the optional inspect command.

### Test result

- Command: `apps/api/.venv/bin/python -m pytest -q pipelines/ingest/tests/test_giovanni.py` from the repository root — **13 passed in 1.40s**.
- One earlier test run had 12 passed and 1 failed because the test expected the wrong wording for the stats engine's existing short-record error. The assertion was corrected to the actual message; production code and statistical thresholds were not changed.
- The temporary `apps/api/.venv` used to run tests was removed after the run. No persistent dependency or environment change remains.

### Human input received and parser follow-up (2026-11-14)

- The human supplied `g4.areaAvgTimeSeries.M2TMNXSLV_5_12_4_T2M.20050101-20251231.1W_6N_1W_6N.csv`, confirmed the selected source unit is K, and provided a retrieval timestamp of 2026-11-14 14:27:46.
- The CSV metadata records the Kumasi box in Giovanni's west,south,east,north order and a data bounding box resolving to the grid cell centered at 6.5 N, 1.875 W. No CSV values are copied into this log.
- NASA Earthdata metadata for DOI `10.5067/AP1B0BA5PD2K` confirms collection M2TMNXSLV version 5.12.4 and T2M units K; recorded in `docs/VERIFIED.md`.
- The importer now supports the export's key/value metadata preamble, month-start timestamps with time-of-day, selected `mean_*` column, and declared fill sentinel. Operator-declared units are accepted for Giovanni exports that omit units. Optional K-to-degC conversion writes °C series for the API catalog while retaining source units and conversion steps in the manifest.
- Synthetic-only tests reproduce the export structure and fill marker and cover K-to-degC conversion plus timestamp/version manifest fields. Command: `/tmp/edd-b1-venv/bin/python -m pytest -q pipelines/ingest/tests/test_giovanni.py` — **15 passed in 0.90s**. The temporary test environment uses pytest, NumPy, SciPy, and PyYAML; no project dependency manifest was changed.
- Imported the supplied CSV locally with declared source unit K, output unit degC, exact retrieval timestamp 2026-11-14T14:27:46+00:00, dataset version 5.12.4, and selected column `mean_M2TMNXSLV_5_12_4_T2M`. Command: `/tmp/edd-b1-venv/bin/python -m pipelines.ingest.giovanni --csv g4.areaAvgTimeSeries.M2TMNXSLV_5_12_4_T2M.20050101-20251231.1W_6N_1W_6N.csv --variable merra2_t2m --region kumasi --units K --output-units degC --retrieved-date 2026-11-14 --retrieved-at 2026-11-14T14:27:46+00:00 --dataset-version 5.12.4 --value-column mean_M2TMNXSLV_5_12_4_T2M` — completed and wrote the result cache, normalized input, source copy, and manifest. The generated cache contains 252 months (2005-01 through 2025-12), complete monthly coverage, and zero parsed fill/missing values. This was a local import only; there were no live NASA calls.
- Updated `apps/api/app/main.py` so Giovanni cached results identify the upstream Giovanni area average and manifest conversion steps instead of claiming the backend computed a latitude-weighted mean. Added a regression test in `apps/api/tests/test_api.py`. Complete API suite: from `apps/api/`, `/tmp/edd-b1-venv/bin/python -m pytest -q` — **6 passed in 1.72s**, one Starlette/httpx deprecation warning. Importer suite — **15 passed in 0.90s**. A local `TestClient` POST to `/api/v1/trend` for `merra2_t2m/kumasi` returned **200**, units `degC`, period 2005-01 through 2025-12, and manifest version `5.12.4`.
- Source URL in the provided Giovanni file: `https://giovanni.gsfc.nasa.gov/giovanni/?utm_source=chatgpt.com#service=ArAvTs&starttime=2005-01-01T00:00:00Z&endtime=2025-12-31T23:59:59Z&bbox=-1.8,6.55,-1.45,6.85&data=M2TMNXSLV_5_12_4_T2M&portal=GIOVANNI&format=json`.

## B2 — request periods and bbox analysis (2026-11-14)

- Confirmed the frontend sends `region_id`, nullable `bbox` in `[west, south, east, north]` order, nullable `start`/`end`, and `alpha`; `apps/web/lib/region.ts` enforces 0.25°–10° spans for each side. No frontend or shared-schema files were changed.
- `POST /trend` now filters cached preset series and grid series to inclusive `YYYY-MM` bounds before analysis. Invalid months/order and periods shorter than eight years return the existing wrapped 422 problem. Exactly eight years is accepted.
- Bbox requests use a cached grid, including automatic variable-grid selection when `region_id` is null. Validation enforces coordinate order/ranges and the frontend span limits; requests must fit within inferred cached grid-cell coverage. Cell centres inside the box are aggregated with the existing cosine-latitude weights. When a covered box contains no centre, the nearest centre is analyzed and a `data_quality.notices` message is added.
- Bbox results carry a Polygon geometry and provenance fields for the source grid file, requested bbox, and selected cell count. No stats-engine code, statistical thresholds, or frontend-visible required fields changed.
- Synthetic API tests cover date filtering, bad date syntax and order, under/equal eight-year boundary, bbox without `region_id`, weighted cell selection, nearest-cell fallback, malformed coordinates, size limits, outside and partial-outside coverage, and missing region+bbox.
- Focused B2 command from `apps/api/`: `/tmp/edd-b1-venv/bin/python -m pytest -q tests/test_api.py -k 'requested_month_period or exactly_eight_years or invalid_or_short_periods or bbox or requires_preset'` — **16 passed, 5 deselected**.
- Full API suite from `apps/api/`: `/tmp/edd-b1-venv/bin/python -m pytest -q` — **22 passed**, one Starlette/httpx deprecation warning. Giovanni importer suite: `/tmp/edd-b1-venv/bin/python -m pytest -q pipelines/ingest/tests/test_giovanni.py` — **15 passed**. Python compilation of the touched API and test files completed successfully.
- A local `TestClient` request against the imported B1 cache, with 2010-01 through 2019-12 selected, returned **200**, exactly 120 months, and units `degC`; no NASA network request was made.
- No gridded NASA cache currently exists in `data/cache/grids/`; the bbox implementation was tested on synthetic grids only. Live NASA calls were not made. Bbox analysis for real data will return 404 until a grid cache is built for the requested variable.

## B3 — restart-safe run IDs (2026-11-14)

- Confirmed `apps/web/lib/schemas/trend.ts` validates `run_id` as a string; `apps/web/components/investigate/wizard.tsx` URL-encodes it, and `apps/web/components/analysis/analysis-view.tsx` passes it opaquely to the run hook and CSV download. No ID parsing or format assumption exists in the frontend; no frontend or shared-schema changes were made.
- Cache-backed trend and point requests now receive versioned `r1_` IDs containing canonical JSON encoded with URL-safe base64 and no padding. IDs include all normalized request fields, are capped at 256 characters, and are validated canonically when decoded. These IDs contain no hash of process state or secrets.
- `GET /runs/{id}`, `GET /runs/{id}/csv`, and `POST /narrative` now decode the request and recompute from the existing result or grid cache. Real run responses are no longer stored in `RUNS`; the dictionary remains only for the legacy fixture path. Unknown, malformed, noncanonical, over-length, or no-longer-resolvable IDs return the wrapped 404 error.
- Cached preset results are reused when their alpha matches the request. A changed alpha triggers reanalysis from the cached raw series so the result matches its encoded request. Bbox and point requests are likewise reconstructed from their encoded coordinates and cache selectors.
- API tests verify URL-safe/self-describing IDs, equivalent bbox normalization, changed alpha, GET/CSV/narrative after clearing process run state, bbox and point restart reconstruction, and 404 behavior for malformed/over-length IDs. Full API command from `apps/api/`: `/tmp/edd-b1-venv/bin/python -m pytest -q` — **29 passed in 4.06s**, one Starlette/httpx deprecation warning. `python3 -m py_compile app/main.py tests/test_api.py` completed successfully. Tests use synthetic temporary caches; no NASA calls were made.
- The response's `provenance.created_at` is regenerated on retrieval; analysis fields, verdict, and source metadata are stable across the simulated restart. A run can be reconstructed only while its required cache files remain available; otherwise the run endpoints return 404.

## B4 — fixture safety and cache health (2026-11-14)

- Confirmed `apps/web/lib/schemas/catalog.ts` defines health as a non-strict `z.object`, so the additive `missing_cache_files` field is accepted without changing the frontend or shared schema.
- `/api/v1/health` now lists missing cache assets. For this build, the required demo asset is `data/cache/results/merra2_t2m__kumasi.json`, identified by the existing Kumasi demo/cache contract and present in `data/cache/`; no grid or map cache is currently required by this health check. This is an explicit implementation assumption and should be revisited if the demo's required cache set changes.
- Added an API lifespan check that refuses startup when `APP_ENV=production` and `USE_FIXTURES=1`. `.env.example` documents `APP_ENV`; development remains the default. Uncached trend/point routes remain fixture-gated, and legacy fixture run lookup is also disabled when `USE_FIXTURES=0`.
- Added tests for health's missing-file list, production startup refusal, uncached trend and point responses in real mode, and legacy fixture run rejection in real mode. No frontend-visible existing fields were removed or changed.
- Command from `apps/api/`: `/tmp/edd-b1-venv/bin/python -m pytest -q tests/test_api.py` — **32 passed in 4.69s**, one Starlette/httpx deprecation warning. This suite uses temporary synthetic test caches; no live NASA calls were made.

## B5 — provenance-checked cache build and bounded pixel statistics (2026-11-14)

- `pipelines/ingest/seed.py` now builds cached regional result JSON from normalized local series only when the manifest supplies HTTPS source URLs, a retrieval date, code version, and a matching SHA-256 for the retained original source file. It ignores the `.giovanni.csv` retained export copy instead of trying to parse it as `time,value`. It records normalized input and output checksums and seed code version in the manifest.
- Gridded cache generation verifies the grid checksum plus each retained granule checksum and source URL. The grid loader now records those hashes, retrieval date, and code version; the monthly CSV loader records the same provenance fields. The API's map JSON retains its established `opposite_trends` response shape, so no API or frontend contract changed.
- Map generation caps output at 10,000 cells and rejects input grids above 25,000 spatial cells or 600 monthly slices before decompression. `pixel_trends` now processes pixels in 512-cell chunks. A fixed-seed synthetic regression test compares slope, p-value, and coverage arrays exactly against the previous unchunked algorithm; **STATS owner review is required** for the restricted stats-engine change.
- Seed metrics print runtime and process peak RSS. Running against the available real regional series rebuilt one cache in **21.49 seconds** with **208,470,016 bytes** process peak RSS. No verified grid input exists in `data/cache/grids/`, so this run could not produce a point-sampling NPZ or map/opposite-trend cache; it explicitly reported that it did not fabricate them. No live NASA call was made.
- `make seed` initially failed because system `python3` has no NumPy installed; direct user-site installation was blocked by the OS's externally-managed Python policy. Installed the already-declared runtime dependencies NumPy, SciPy, and PyYAML in the isolated persistent environment `$HOME/.venvs/earth-data-detective`. `PATH=$HOME/.venvs/earth-data-detective/bin:$PATH make seed` succeeded, rebuilding the regional series in **22.72 seconds** at **102,838,272 bytes** peak RSS and reporting no gridded inputs. System Python remains unchanged. No Makefile or project dependency-manifest edits were made.
- Tests: `/tmp/edd-b1-venv/bin/python -m pytest -q pipelines/ingest/tests/test_seed.py packages/stats_engine/tests/test_pixel_chunks.py` — **5 passed**; `/tmp/edd-b1-venv/bin/python -m pytest -q pipelines/ingest/tests/test_seed.py pipelines/ingest/tests/test_giovanni.py` — **19 passed**; API suite from `apps/api/` — **32 passed**, one Starlette/httpx deprecation warning. Touched Python files compiled successfully; local real-cache POST `/api/v1/trend` returned **200**, units `degC`, 252 months.
- Full stats-engine suite was not run: its existing `test_validation.py` cannot be collected in the available environment because `pymannkendall` is absent. The isolated chunk-equivalence test passed. No project dependency was added.
