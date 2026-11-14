# Known limits

- Detects monotonic **linear** trends only. Real changes can be non-linear, cyclical or caused by sensor changes. A significant trend does not identify its cause.
- Satellite records (GPM, MODIS) start around 2000, so many series are about 25 years long.
- MERRA-2 is a model reanalysis, not a direct measurement; one grid cell (~50 km) covers a city and its surroundings.
- Data loaders in `pipelines/ingest/sources.py` were written without live NASA access in the build sandbox. They must be run and checked on Saturday morning.
- Years-to-significance is an estimate that assumes the trend and noise continue unchanged; it uses annual means and fewer simulations than the full plan (see DECISIONS #4).
- Drawn-box `/trend` requests and `/trend-at-point` require a locally cached gridded input. No gridded input is currently present in `data/cache/grids/`, so those analyses and trend maps cannot yet be served from real data.
- Cache-backed run IDs are reconstructed from the request and cache after restart; fixture-only legacy IDs are not available in real mode.
- Map cache builds reject gridded inputs larger than 25,000 cells or 600 monthly slices and cap derived maps at 10,000 cells. These are processing limits, not dataset resolution claims.
- Twi labels in `data/catalog/` are drafts and must be reviewed by a fluent speaker.
