# Validation report

What was checked against an independent source, what agreed, and what could not be checked. Numbers come from the files named here and were computed on 2026-11-15; nothing in this report is an estimate.

## 1. Ground station vs MERRA-2 air temperature (Kumasi): not possible

| Item | Value |
| --- | --- |
| Station | `GHM00065442`, "KUMASI, GH" |
| Location | latitude 6.715, longitude −1.591, elevation 287.1 m |
| Source file | `data/raw/GHM00065442.csv`, NOAA NCEI Climate Data Online, Global Summary of the Month (download date not recorded) |
| Rows in the file | 14 months between 1997-04 and 2025-07 (340 calendar months in that span) |
| Months with monthly mean temperature (TAVG) | **7**: 1997-05, 1997-06, 2018-01, 2019-02, 2023-12, 2024-02, 2025-06 |
| Years with at least 80% of months | none (the plan needs a run of 15) |
| Months overlapping the MERRA-2 Kumasi series (2005-01 to 2025-12) | **5**: 2018-01, 2019-02, 2023-12, 2024-02, 2025-06 |
| Station minus MERRA-2 in those months | +1.69, +1.85, +3.46, +3.10, +2.33 °C (mean +2.49 °C) |

**Conclusion: no agreement can be claimed.** Five scattered months cannot show whether the station and MERRA-2 agree on month-to-month changes or on a trend, so no correlation or trend test is reported and the app has no validation view. The station was warmer than the MERRA-2 cell in all five months; this report does not attribute that difference to any cause.

- The station file has no units line; its TAVG values (25.86 to 30.31) are consistent only with °C.
- A second export, `data/raw/global-summary-of-the-month-2026-11-15T11-08-13.csv`, contains only the header `"STATION","DATE","TAVG"` and no data.
- Whether NOAA holds more months for this station than this export contains was not checked.

## 2. Giovanni Kumasi series vs the MERRA-2 grid (internal consistency): agree exactly

The Giovanni area-average export for Kumasi (`data/raw/merra2_t2m__kumasi.giovanni.csv`) reports a data bounding box of a single MERRA-2 cell (latitude 6.5, longitude −1.875). The same cell in `data/cache/grids/merra2_t2m__west_africa.npz` (Earthdata OPeNDAP subset) matches it over all 252 months from 2005-01 to 2025-12: correlation 1.000000, mean difference 0.0000 °C, largest difference 0.0000 °C (to 4 decimals). Both are MERRA-2, so this checks the two download routes, not MERRA-2 itself.

## 3. Not validated

- GPM rainfall and MODIS EVI have no independent comparison in this repo.
- EVI (`modis_evi`, Kumasi) is checked only for provenance: the export's layer is `_1_km_monthly_EVI` in every row, and January is absent every year from 2001 to 2026 (see `docs/VERIFIED.md`).

## 4. Opposite-trend detector: sensitivity to the minimum cluster size

**This is a sensitivity check, not a change of method.** The app still uses the engine's rule: the smallest cluster that counts is the larger of 3 cells and 1% of the valid cells (27 cells for temperature, 32 for rainfall), and the FDR level stays q = 0.10. The table only shows whether an opposite-trend pair (a significantly rising and a significantly falling cluster, each at least the minimum size) would be found if the minimum were a fixed number of cells instead.

Computed on 2026-11-15 with `stats_engine.opposite_trends(…, min_cells=k, min_fraction=0)` on the cached West Africa maps (`data/cache/maps/*__west_africa.json`: the same per-cell slopes and FDR mask the app serves).

| Map | Significant cells (rising / falling) | Largest rising / falling cluster | k = 3 | k = 8 | k = 16 | k = 32 | App's rule |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Air temperature (MERRA-2) | 2,377 / 0 | 2,374 / none | no | no | no | no | no (minimum 27) |
| Rainfall (GPM IMERG) | 49 / 38 | 32 / 25 | yes | yes | yes | no | no (minimum 32) |

Temperature has no significantly falling cells, so no minimum would produce an opposite pair. For rainfall the answer depends on the minimum: the largest drying area (25 cells) passes any fixed minimum up to 25 and fails the app's 32. `GET /api/v1/opposite-trends/{variable}/{region}` now reports these counts, the minimum used and both largest cluster sizes, so the "no" is visible rather than hidden. Any change to the minimum is a STATS decision.

Decisions: DECISIONS #33 (EVI relabel) and #34 (station check reported, not built).
