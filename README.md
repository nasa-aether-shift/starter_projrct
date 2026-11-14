# Earth Data Detective

NASA Space Apps Challenge 2026 — **Be An Earth System Trend Detective!** — Team build, Space Apps Kumasi (14–15 Nov 2026).

A web tool that answers *"is this place really changing?"* from NASA Earth data: what is changing, where, by how much, and whether it is statistically significant. Full plan: the team doc **Earth Data Detective — 48-Hour Build Documentation**.

> **Deadline:** code freeze Sun 15 Nov 11:00 · pitches ~14:30 · submission closes Sun 23:59 local time.

## Quick start

```bash
make setup      # Python deps for stats engine + API
make test       # stats validation suite + API tests (offline, synthetic data only)
make api        # FastAPI on http://localhost:8000  (docs at /docs)
```

The API serves a **SYNTHETIC fixture** (`packages/shared-schemas/fixtures/trend.fixture.json`) until real data is cached, so WEB can build from 10:00. Set `USE_FIXTURES=0` once `make seed` has run.

## What is here (and who owns it)

| Path | What | Owner |
| --- | --- | --- |
| `packages/stats_engine/` | `analyze_series()`, trend maps, FDR, opposite-trend detector, **64 validation tests (passing)** | STATS |
| `pipelines/ingest/sources.py` | NASA POWER, Giovanni CSV, earthaccess grid loaders + manifest | DATA |
| `pipelines/ingest/seed.py` | `make seed`: precompute every result and map into `data/cache/` | DATA + STATS |
| `apps/api/` | FastAPI: all MUST endpoints, verdict template, numeric guard, AI rewrite | API & AI |
| `packages/shared-schemas/` | Frozen JSON contract as TypeScript types + synthetic fixture | API & AI + WEB |
| `apps/web/` | Next.js app (create at kickoff, see `apps/web/README.md`) | WEB |
| `data/catalog/` | Variable YAML (definitions, caveats, colour polarity) | DATA + STORY |
| `data/regions/presets.geojson` | Kumasi, Ashanti, West Africa, eastern China, India | DATA |
| `docs/` | Contract, decisions, known limits, data verification | everyone |

## Getting real data (DATA, Saturday morning)

```bash
export EARTHDATA_TOKEN=...   # never commit it
python3 -c "from pipelines.ingest.sources import fetch_power; fetch_power('merra2_t2m','kumasi',6.69,-1.62,'T2M',1981,2025)"   # fallback, no login
python3 -c "from pipelines.ingest.sources import load_giovanni_csv; load_giovanni_csv('giovanni_kumasi_t2m.csv','merra2_t2m','kumasi',offset=-273.15)"
python3 -c "from pipelines.ingest.sources import fetch_grid_earthaccess as g; g('gpm_precip','west_africa','GPM_3IMERGM','precipitation',(-20,0,20,20),'2000-06','2025-12')"
make seed
```

The loaders were written without live NASA access: run each once, check units and variable names against CMR, and record findings in `docs/VERIFIED.md`.

## Rules

- Professional stack only: no Streamlit, Dash, Gradio, Shiny, Panel, Voila or notebook-as-app.
- No fabricated data. Synthetic data only in tests and the labelled fixture.
- The AI never computes numbers; the numeric guard enforces it.
- The deployed demo reads only from `data/cache/`; it never calls NASA live.

## Data acknowledgement

Data from NASA GES DISC, GMAO (MERRA-2), GPM, LP DAAC (MODIS) and NASA POWER. Add exact dataset citations from CMR to `docs/VERIFIED.md` and the app's Method page.
