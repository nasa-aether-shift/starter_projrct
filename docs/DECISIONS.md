# Decisions log

Record every change from the Master Build Prompt here, with a reason.

| # | Decision | Why | Who / when |
| --- | --- | --- | --- |
| 1 | Precomputed JSON/Parquet/NPZ files in `data/cache/` instead of Zarr on MinIO, PostgreSQL/PostGIS/pgvector, Redis and Celery | 48-hour build; no servers to set up; heavy maps are precomputed anyway | Starter repo, Sat 14 Nov |
| 2 | Per-pixel map trends use **annual means** (years with ≥ 10 valid months), Sen slope + Mann-Kendall, then Benjamini-Hochberg FDR at q = 0.10 | Removes seasons, reduces autocorrelation, keeps 100k-cell maps fast; regional cluster series still get the full monthly pipeline | Starter repo |
| 3 | Pettitt change-point runs on the **residuals from the Sen trend line**, not the raw anomalies | On raw anomalies any steady trend looks like a mid-record "change-point" and would wrongly block grade A | Starter repo |
| 4 | Years-to-significance simulates AR(1) noise, tests annual means with the original MK, 200 sims for live use and 1,000 in `make seed` | Speed; the full plan's 1,000 sims with modified MK per click is too slow | Starter repo |
| 5 | Modified MK falls back to the original variance if the Hamed-Rao factor is ≤ 0 | Rare edge case with strong negative autocorrelation produces an invalid variance | Starter repo |
| 6 | LLM via a plain HTTP call (Anthropic Messages API), model set by `LLM_MODEL` | Fewer dependencies; swap provider by editing `apps/api/app/ai.py` | Starter repo |
