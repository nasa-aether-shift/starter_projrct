# Known limits

- Detects monotonic **linear** trends only. Real changes can be non-linear, cyclical or caused by sensor changes. A significant trend does not identify its cause.
- Satellite records (GPM, MODIS) start around 2000, so many series are about 25 years long.
- MERRA-2 is a model reanalysis, not a direct measurement; one grid cell (~50 km) covers a city and its surroundings.
- The older loaders in `pipelines/ingest/sources.py` (POWER, earthaccess whole-file grids) have not been run against live NASA services. The West Africa grids come from `pipelines/ingest/opendap_grid.py`, which was run on 2026-11-14.
- Years-to-significance is an estimate that assumes the trend and noise continue unchanged; it uses annual means and fewer simulations than the full plan (see DECISIONS #4).
- Gridded data covers **West Africa only** (0–20°N, 20°W–20°E). It includes MERRA-2 air temperature for 1980-01 to 2025-12 on its native 0.5° × 0.625° grid, and GPM rainfall for 2000-06 to 2025-09, averaged from 0.1° to 0.5° cells. Drawn boxes, map clicks, trend maps and presets without a cached regional result use these grids. Vegetation greenness (NDVI) has no grid yet.
- Rainfall is reported in mm/day. NASA's metadata does not confirm that the monthly value is a mean rate over the month, so it is not converted to mm/month (DECISIONS #30).
- West Africa rainfall has both significant wetting (largest cluster 32 cells, near Lake Chad) and significant drying (largest cluster 25 cells, near the Cameroon coast). The drying cluster is below the opposite-trend detector's 1% minimum (32 cells), so the app reports "no opposite trends found". Changing that threshold needs STATS sign-off.
- Cache-backed run IDs are reconstructed from the request and cache after restart; fixture-only legacy IDs are not available in real mode.
- Map cache builds reject gridded inputs larger than 25,000 cells or 600 monthly slices and cap derived maps at 10,000 cells. These are processing limits, not dataset resolution claims.
- Twi labels in `data/catalog/` are drafts and must be reviewed by a fluent speaker.
