# Data check: 2026-11-15, updated 12:33 UTC

> **Snapshot, now out of date.** This report describes `main` at `6afc667`.
>
> Fixed since:
> - the "NDVI" export was EVI and is now `modis_evi`, and its raw files are committed (#14)
> - the station facts are in `docs/VALIDATION_REPORT.md` (#14)
> - the opposite-trends sentence now states the numbers (#16)
> - real NDVI was added from MOD13A1 (#19)
> - Render deploy settings were added (#21)
>
> Still open:
> - the Kumasi temperature series still starts in 2005, because the Giovanni re-download from 1980 has not been done
> - the duplicate Giovanni CSV is still in the repo root
> - nothing is deployed yet
>
> For the current state see `docs/VERIFIED.md`, `docs/KNOWN_LIMITS.md` and `docs/VALIDATION_REPORT.md`.

The first run was at 12:18 UTC. This update adds the three files that appeared in `data/raw/` at 12:21 UTC:
- `MOD13A3-061-Statistics.csv`
- `GHM00065442.csv`
- `global-summary-of-the-month-2026-11-15T11-08-13.csv`

**What else changed since the first run**
- `main` is now `6afc667` ("added ai"). The only change since `091be7f` is one new row (#32) in `docs/DECISIONS.md`, so no data changed.
- No other file under `data/` changed.

**How the checks were run**
- This was read-only. Nothing in the repo was changed, moved, deleted, downloaded or committed, and `seed.py` was not run. This file is the only thing written.
- Python ran from outside the repo with bytecode writing turned off. `git status` was the same before and after.
- Code reused from the repo, all functions that don't write: `giovanni._parse_csv`, `opendap_grid.read_subset`, `opendap_grid.coarsen` and `opendap_grid.SPECS`.
- The writing loaders in `pipelines/ingest/sources.py` were not used.
- Times are file modification times. The machine clock is UTC (`date` and `date -u` agree).

## 1. Inventory

`data/raw/` and `data/cache/` hold 1,422 files: 12 single files plus 1,410 monthly OPeNDAP cut-outs in 3 folders. The cut-outs are summarised per folder because each folder is exactly one file per month, with no gaps.

| File | Bytes | Modified (UTC) | Git |
| --- | ---: | --- | --- |
| data/cache/grids/merra2_t2m__west_africa.npz | 4,653,701 | 2026-11-15 06:56 | tracked (force-added; `.gitignore:10 data/cache/grids/*.npz` matches it) |
| data/cache/grids/gpm_precip__west_africa.npz | 2,360,688 | 2026-11-15 06:56 | tracked (force-added; same rule) |
| data/cache/manifest.json | 388,773 | 2026-11-15 11:54 | tracked |
| data/cache/maps/merra2_t2m__west_africa.json | 95,344 | 2026-11-15 06:56 | tracked |
| data/cache/maps/gpm_precip__west_africa.json | 78,000 | 2026-11-15 06:56 | tracked |
| data/cache/results/merra2_t2m__kumasi.json | 16,010 | 2026-11-14 23:35 | tracked |
| data/cache/results/modis_ndvi__kumasi.json | 17,944 | 2026-11-15 11:54 | tracked |
| data/raw/merra2_t2m__kumasi.giovanni.csv | 8,384 | 2026-11-14 18:02 | tracked (force-added; `.gitignore:8 data/raw/` matches it) |
| data/raw/merra2_t2m__kumasi.csv | 4,768 | 2026-11-14 18:02 | tracked (force-added; same rule) |
| **data/raw/MOD13A3-061-Statistics.csv** (new) | 58,484 | 2026-11-15 12:21 | **ignored** (`.gitignore:8`); not on GitHub |
| **data/raw/GHM00065442.csv** (new) | 4,164 | 2026-11-15 12:21 | **ignored** (`.gitignore:8`); not on GitHub |
| **data/raw/global-summary-of-the-month-2026-11-15T11-08-13.csv** (new) | 24 | 2026-11-15 12:21 | **ignored** (`.gitignore:8`); header only, no data |

| OPeNDAP cut-out folder | Files | Bytes | Modified (UTC) | Git | Used by |
| --- | ---: | ---: | --- | --- | --- |
| data/raw/opendap/gpm_precip__west_africa/ | 305 (2000-06 … 2025-09, plus axes.nc4) | 37,534,515 | 2026-11-14 23:18–23:22 | ignored (`.gitignore:8`) | GPM grid (per the manifest `input_files`) |
| data/raw/opendap/merra2_t2m__west_africa/ (top level) | 553 (1980-01 … 2025-12, plus axes.nc4) | 21,064,122 | 2026-11-14 23:07–23:17 | ignored | **Nothing.** These are older cut-outs with 40 latitude rows (0.5–20°N) and no equator row |
| data/raw/opendap/merra2_t2m__west_africa/2b82894a764d/ | 552 (1980-01 … 2025-12) | 21,148,085 | 2026-11-14 23:27–23:34 | ignored | MERRA-2 grid |

**Files outside `data/`**
- `g4.areaAvgTimeSeries.M2TMNXSLV_5_12_4_T2M.20050101-20251231.1W_6N_1W_6N.csv` sits in the repo root and is tracked.
  - Size: 8,645 bytes, modified 2026-11-14 16:34.
  - Its content matches `data/raw/merra2_t2m__kumasi.giovanni.csv` except for line endings (it uses CRLF).
  - So its SHA-256 does **not** match the manifest; the `data/raw` copy does.
- No other data files (csv, nc, nc4, npz, h5, hdf, tif, parquet, xlsx, zip) were found outside `data/`, ignoring `node_modules` and `.next`.
- `richard.md.save` (root, tracked) is not data.

**Files the manifest refers to: what is present now**
- `data/raw/MOD13A3-061-Statistics.csv` is **now present**, and its SHA-256 matches the manifest.
- `data/raw/modis_ndvi__kumasi.csv`, the normalised NDVI file, is **still missing**.

## 2. Datasets

### A. Giovanni MERRA-2 T2M, Kumasi area average (needed: 1980-01 to 2025-12)

No new file has been added; the 1980 re-download has not happened yet.

- **File:** `data/raw/merra2_t2m__kumasi.giovanni.csv`, a Giovanni CSV with a metadata header followed by `time, mean_M2TMNXSLV_5_12_4_T2M`.
- **Header:**
  - Title: `Time Series, Area-Averaged of 2-meter air temperature monthly 0.5 x 0.625 deg. [MERRA-2 (monthly)`
  - User Start / End Date: `2005-01-01T00:00:00Z` / `2025-12-31T23:59:59Z`
  - User Bounding Box: `-1.8,6.55,-1.45,6.85`. This is the same as the `kumasi` preset.
  - **Data Bounding Box: `-1.875,6.5,-1.875,6.5`.** The "area average" is a single MERRA-2 cell.
  - Variable `M2TMNXSLV_5_12_4_T2M`, so the product is M2TMNXSLV version 5.12.4.
  - Fill value `1000000000000000`.
  - The reproduce URL contains `utm_source=chatgpt.com`. The manifest copy has it stripped.
- **Months:**
  - 2005-01 to 2025-12: 252 months, 252 expected.
  - 0 missing, 0 duplicates, in order.
  - **Before 2005-01 there is nothing: 300 of the 552 needed months are absent.**
- **Fill and blank values:** 0 fill values and 0 blanks.
- **Units:** stored in K (296.815–302.447). Conversion needed: subtract 273.15 to get °C.
- **After conversion:** min 23.66, max 29.30, mean 25.70 °C. Nothing falls outside 15–40 °C.
- **Normalised file:** `data/raw/merra2_t2m__kumasi.csv` holds the same 252 months, and matches the raw values minus 273.15 to 5e-14.
- **Checksums:** the raw CSV, the normalised CSV and the cached result all match the manifest's SHA-256.
- **Cached result:** 2005-01 to 2025-12, n=252, grade D, `no_significant_trend`, Sen slope +0.0916 °C per decade.

### B. MODIS vegetation index, Kumasi (the NDVI the app shows): **the file holds EVI, not NDVI**

- **West Africa grid: MISSING.** No file exists, and `docs/KNOWN_LIMITS.md` says NDVI has no grid.
- **Kumasi raw export:** `data/raw/MOD13A3-061-Statistics.csv`, a NASA AppEEARS area-statistics CSV.
  - Its SHA-256 matches the manifest entry `modis_ndvi__kumasi`, so this is the file the cache was built from.
  - Header: `File Name, Dataset, aid, Date, Count, Minimum, Maximum, Range, Mean, Standard Deviation, Variance, Upper Quartile, Upper 1.5 IQR, Median, Lower 1.5 IQR, Lower Quartile`.
- **Layer: all 295 rows are `_1_km_monthly_EVI`. There is no NDVI row.**
  - File names look like `MOD13A3_061__1_km_monthly_EVI_doy2000032000000_aid0001`, which gives product MOD13A3, version 061, area `aid0001`.
  - The polygon is not in the CSV, so it is **NOT VERIFIED** from the file. The manifest says −1.80, 6.55 to −1.45, 6.85.
- **Pixels:** the count is 1,512 in every row.
- **The cached result is built from these EVI values.**
  - `data/cache/results/modis_ndvi__kumasi.json`'s `series.raw` equals the file's `Mean` column month for month (max |difference| 5e-7).
  - The cached "NDVI" result (grade A, decreasing, Sen slope −0.0542 per decade) is therefore an EVI result.
  - Three places call it NDVI: the catalog (`data/catalog/modis_ndvi.yaml`, "1 km monthly NDVI"), `docs/VERIFIED.md`, and the app.
- **Months:**
  - 2000-02 to 2026-10: 295 months against 321 expected.
  - **26 missing, every January from 2001 to 2026.** No duplicates.
  - The January rows are absent from the export itself: the day-of-year in the file names jumps from 336 (December) to 032 (February).
  - So the import did not drop them. Which setting of the AppEEARS request left them out is NOT VERIFIED.
  - The cached result's `data_quality.gaps` still says `0`.
- **Fill and blank values:** 0 blank or fill values in `Mean`.
- **Units and scale:** the index has no units. Values 0.1668–0.5584 (mean 0.3867) are already scaled, so no further ×0.0001 is needed. Nothing falls outside −0.2..1.0.
- **Still unknown:** whether the 2026 months up to 2026-10 are final products (NOT VERIFIED).

### C. NOAA Climate Data Online, Kumasi station (monthly temperature): **present but too sparse**

**`data/raw/GHM00065442.csv`**
- Format: NOAA "Global Summary of the Month" CSV, one row per month.
  - Columns include STATION, DATE, LATITUDE, LONGITUDE, ELEVATION, NAME, TAVG, TMAX, TMIN, PRCP and `*_ATTRIBUTES`.
- Station: `GHM00065442`, "KUMASI, GH", lat 6.715, lon −1.591, elevation 287.1 m. The same in every row.
- **Months:**
  - 14 rows between 1997-04 and 2025-07, a span where 340 months would be expected.
  - **326 months are missing.** No duplicates.
  - Rows present: 1997-04, 1997-05, 1997-06, 1997-07, 2018-01, 2018-06, 2019-02, 2020-07, 2023-01, 2023-12, 2024-01, 2024-02, 2025-06, 2025-07.
- **TAVG:**
  - Present in **7 of 14 rows**: 1997-05, 1997-06, 2018-01, 2019-02, 2023-12, 2024-02 and 2025-06. Blank in the other 7.
  - No sentinel values.
  - Other columns: TMAX 11 present, TMIN 10, PRCP 1.
- **Units:** the CSV has no units line. TAVG values of 25.86–30.31 (mean 28.11) only make sense in °C, but that is NOT VERIFIED from metadata. Nothing falls outside 15–40 °C.
- **Coverage per year (TAVG):**
  - 1997: 2 of 12; 2018, 2019, 2023, 2024 and 2025: 1 of 12 each.
  - The other 23 of the 29 years from 1997 to 2025 have none.
  - **No year reaches 80% of months, so the longest run is 0 years, against the 15 needed.**
- Whether NOAA holds more months for this station than this export contains is NOT VERIFIED.

**`data/raw/global-summary-of-the-month-2026-11-15T11-08-13.csv`**
- Header only (`"STATION","DATE","TAVG"`), 0 data rows. An empty export.

### D. Existing grids

| | merra2_t2m__west_africa.npz | gpm_precip__west_africa.npz |
| --- | --- | --- |
| Keys / dtype | time, lat, lon, cube (float32) | time, lat, lon, cube (float32) |
| Shape (time, lat, lon) | (552, 41, 65) | (304, 40, 80) |
| Months | 1980-01 to 2025-12, 552 of 552; 0 missing; 0 duplicates | 2000-06 to 2025-09, 304 of 304; 0 missing; 0 duplicates |
| Latitude | 0 to 20, step 0.5 (first value stored as −1.8e-13) | 0.25 to 19.75, step 0.5 |
| Longitude | −20 to 20, step 0.625 | −19.75 to 19.75, step 0.5 |
| NaN per month | 0% in every month (no fill values in the box) | 0% in every month |
| Units in the cube | °C (K − 273.15 already applied) | mm/day (mm/hr × 24 already applied; 0.1° averaged 5×5 to 0.5°) |
| Min / max / mean | 7.14 / 38.44 / 26.56 °C | 0.00 / 45.67 / 3.02 mm/day |
| Flags | 3,920 cell-months (0.27%) below 15 °C, none above 40 °C | 0 negative; 220 cell-months above 30 mm/day; 133,756 cell-months exactly 0 |
| SHA-256 vs manifest | match | match |

**Notes on the grids**

- **Values below 15 °C:**
  - They are in 344 cells, all at 15–20°N, in Dec–Feb (plus 8 in Nov).
  - The lowest is 7.14 °C at 20.0°N, 18.75°E (northern Chad) in 1983-01.
  - The 15–40 °C rule is for Kumasi. These are Saharan winter months, so they are not treated as errors.
  - The Kumasi cell itself (6.5°N, −1.875°E) ranges 22.31–30.30 °C.
- **Values above 30 mm/day:**
  - Nearly all are in May–Aug (96 in June).
  - They lie at 0.25–11.25°N, −19.75–9.25°E: the Guinea coast and nearby ocean.
  - The maximum is 45.67 mm/day at 5.25°N, −10.25°E in 2017-06.
  - No upper limit was given, so these are not flagged.
- **The two grids do not share a grid.**
  - The box is the same, `[-20, 0, 20, 20]` in the manifest, but MERRA-2 uses 0.5° × 0.625° cells centred on the box edges, while GPM uses 0.5° × 0.5° cells centred 0.25° inside the edges.
  - Each variable has its own map, so this does no harm today. Comparing the two cell by cell would need regridding.
- **Rebuilt from raw:** I rebuilt 1980-01, 2005-06 and 2025-12 (MERRA-2) and 2000-06, 2012-07 and 2025-09 (GPM) in memory from the cut-outs. They match the npz to ≤1.7e-6, which is float32 rounding.
- **Raw checksums:** all 552 + 304 raw cut-outs match the SHA-256 values in the manifest.

## 3. Consistency checks

**Giovanni (A) vs the MERRA-2 grid cell nearest to (6.69, −1.62) (D)**
- The nearest cell is lat 6.5, lon −1.875, which is exactly Giovanni's Data Bounding Box.
- Over 2005-01 to 2025-12 (n = 252):
  - Correlation of monthly values: **r = 1.000000**.
  - Mean difference (grid − Giovanni): **+0.0000 °C**. Max |difference| 0.0000 °C, to 4 decimal places.
  - Correlation of monthly anomalies: r = 1.000000.
- **They are the same data.** The grid holds the same cell for 1980-01 to 2004-12: 300 months with no gaps.

**Station (C) vs Giovanni (A)**
- Only **5 months** overlap: 2018-01, 2019-02, 2023-12, 2024-02 and 2025-06.
- Station − Giovanni: +1.69, +1.85, +3.46, +3.10 and +2.33 °C. **Mean bias +2.49 °C**; the station was warmer in all 5 months.
- Correlation of monthly values: r = 0.73. This mostly reflects the seasonal cycle.
- Correlation of monthly anomalies: **r = −0.34**. Anomalies here are each value minus Giovanni's 2005–2025 average for that calendar month.
- With n = 5, neither correlation means anything. **No agreement can be claimed.**

## 4. Readiness

| Prompt | Data needed | Status | Evidence | What to fix |
| --- | --- | --- | --- | --- |
| 1 Kumasi 1980–2025 | MERRA-2 T2M Kumasi, monthly, 1980-01 to 2025-12 | **PARTIAL** | The Giovanni file still covers 2005-01 to 2025-12 only (252 of 552 months), and the cached Kumasi result is 2005–2025 (grade D). The grid cell (6.5, −1.875) holds the full 1980–2025 record and equals Giovanni exactly where they overlap. | Re-download Giovanni starting 1980-01 (see section 5) |
| 2 Opposite trends | Cached West Africa maps (T2M, rainfall) | **PROBLEM** | Both maps are present and their checksums match. **T2M:** 2,377 significant cells, all rising (one cluster of 2,374), none falling, so "none found" is correct. **Rainfall:** 87 significant cells. 49 rising, largest cluster 32. 38 falling, clusters 25, 12 and 1. The minimum cluster size is 32 (1% of 3,200 valid cells), so the rising cluster passes and the falling one fails, giving `found: false`. The cached sentence says changes "all point the same way, or there are none", which is untrue for rainfall. | A STATS decision on the 1% minimum (record it in DECISIONS.md), or say it plainly: drying cells exist but form no cluster big enough. Fix the sentence (API). |
| 3 NDVI | NDVI grid and/or Kumasi series | **PROBLEM** | The raw export is now present and matches the manifest, but **every row is `_1_km_monthly_EVI`**. The cached "NDVI" result is computed from EVI. 2000-02 to 2026-10, 295 of 321 months; the export has no January rows. No West Africa grid. | Re-export the NDVI layer from AppEEARS (see section 5). Until then, don't present the result as NDVI. |
| 4 Station check | NOAA CDO monthly temperature, Kumasi station | **PROBLEM** | The file is present (`GHM00065442`, KUMASI, GH) but has TAVG in only 7 months between 1997 and 2025. 0 years reach 80% coverage, against the 15 needed. It overlaps Giovanni in 5 months, with mean bias +2.49 °C and anomaly r −0.34. The second export is empty. | Present it as a sparse check; claim no agreement |
| 5 AI search | Catalog plus cached variables | **PARTIAL** | 3 catalog entries (8, 8 and 9 synonyms), each with at least 1 cache. The web calls `POST /variables/search` (`apps/web/lib/api/hooks.ts:127`), but the API has no such route, so the web falls back to keyword matching (`apps/web/lib/variable-match.ts`). On this Windows machine `main.py:54` reads the YAML as cp1252, which garbles the Twi names (`Nsuo a É›tÉ”`). `coverage.end` is still `"<latest>"` in all 3 files. Whether an LLM key is set was NOT VERIFIED (`.env` was not read). | Use the keyword fallback for the demo. API: add `encoding="utf-8"` at `main.py:54`. |
| 6 Deploy | Cache files tracked by git | **READY** (data) / deploy config **MISSING** | 7 tracked cache files, **7,610,460 bytes (7.26 MiB)**. The largest is 4,653,701 bytes. All match the manifest. The runtime-required `results/merra2_t2m__kumasi.json` is tracked, as are the catalog (3) and regions (2). None of `render.yaml`, `vercel.json`, `apps/web/vercel.json`, `apps/api/Dockerfile` or `Procfile` exists. | Add Render and Vercel config. Set `USE_FIXTURES=0` and `APP_ENV=production`. |

## 5. Problems, most severe first

1. **The app shows EVI labelled as NDVI (Prompt 3).**
   - Re-submit the AppEEARS area request:
     - product MOD13A3.061, layer `_1_km_monthly_NDVI`
     - the same Kumasi polygon
     - dates 2000-02-01 to 2026-10-31, and check that January is included
   - Import the new file to `data/raw/` and re-seed `modis_ndvi__kumasi`.
   - If that can't happen before the pitch, either hide the vegetation result, or relabel it as EVI in the catalog and story (a team decision).
   - Either way, correct the NDVI row in `docs/VERIFIED.md`.
2. **The Kumasi temperature record starts in 2005, not 1980 (Prompt 1).**
   - Re-download the Giovanni "Time Series, Area-Averaged" export for `M2TMNXSLV_5_12_4_T2M`:
     - start `1980-01-01`, end `2025-12-31`
     - same bbox, `-1.8,6.55,-1.45,6.85`
   - Import it with `python -m pipelines.ingest.giovanni` into `data/raw/merra2_t2m__kumasi.giovanni.csv`, then re-seed.
   - The cached grid cell shows the 2005–2025 values will come out identical.
3. **The station has only 7 months of TAVG (Prompt 4).**
   - In the pitch, say: "station GHM00065442 has 7 monthly averages since 1997; too sparse to test agreement."
   - Do not claim agreement with MERRA-2.
   - Optionally try one more NOAA export for 1980-01-01 to 2025-12-31. If it returns the same 14 rows, stop.
   - Delete or replace the empty `global-summary-of-the-month-…csv`.
4. **The opposite-trends sentence is wrong for rainfall (Prompt 2).**
   - It says there are no opposing changes, but 38 significant drying cells exist; the largest cluster has 25 cells, under the 32-cell minimum.
   - API/STORY: word the "found nothing" case to say so when significant falling cells exist.
   - STATS: decide the 1% minimum and record it in DECISIONS.md.
   - Until then, don't say "rainfall changes the same way everywhere" in the pitch.
5. **No deploy configuration (Prompt 6).** The data is ready to ship at 7.26 MiB, but nothing defines the Render and Vercel services. Run the demo locally or add the config in a PR.
6. **The new raw files exist only on this laptop.**
   - `data/raw/` is ignored by git, so `MOD13A3-061-Statistics.csv` (which the manifest names) and `GHM00065442.csv` are not on GitHub.
   - Either force-add them like the Giovanni CSVs (`git add -f`, 58 KB and 4 KB), or put them on the team drive, so the provenance can be checked by others.
7. **Duplicate Giovanni CSV in the repo root.** It has CRLF line endings, its SHA-256 doesn't match the manifest, and the manifest's `input_file_name` still names it. Remove it from the root in a PR; keep the `data/raw` copy.
8. **The catalog's Twi names are garbled on Windows** because `apps/api/app/main.py:54` calls `read_text()` with no encoding. Pass `encoding="utf-8"`. Linux is likely unaffected (NOT VERIFIED; nothing is deployed).
9. **Stale MERRA-2 cut-outs.** The top-level `data/raw/opendap/merra2_t2m__west_africa/*.nc4` files (553 files, 21 MB, ignored) are unused. They can be deleted locally at any time.
10. **`.gitignore` rules match tracked files.** `data/raw/` and `data/cache/grids/*.npz` match the force-added files, so any new grid or raw file needs `git add -f`. Note this in the README or narrow the rules.
