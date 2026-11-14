# Known limits

- Detects monotonic **linear** trends only. Real changes can be non-linear, cyclical or caused by sensor changes. A significant trend does not identify its cause.
- Satellite records (GPM, MODIS) start around 2000, so many series are about 25 years long.
- MERRA-2 is a model reanalysis, not a direct measurement; one grid cell (~50 km) covers a city and its surroundings.
- Data loaders in `pipelines/ingest/sources.py` were written without live NASA access in the build sandbox. They must be run and checked on Saturday morning.
- Years-to-significance is an estimate that assumes the trend and noise continue unchanged; it uses annual means and fewer simulations than the full plan (see DECISIONS #4).
- Drawn-box regions are not yet supported by `/trend`; use presets or click a point (`/trend-at-point`).
- Runs are kept in API memory; a restart clears run IDs (cached results remain).
- Twi labels in `data/catalog/` are drafts and must be reviewed by a fluent speaker.
