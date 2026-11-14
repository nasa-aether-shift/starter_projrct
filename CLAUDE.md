# Earth Data Detective — instructions for Claude Code

NASA Space Apps 2026, challenge "Be An Earth System Trend Detective!", Space Apps Kumasi.
A web tool answering: what is changing, where, by how much, and is it significant, from NASA Earth data.
Code freeze: Sun 15 Nov 11:00. Pitch ~14:30.

## Hard rules (never break)

1. Professional stack only: Next.js + TypeScript (apps/web), FastAPI (apps/api), Python stats (packages/stats_engine). Never Streamlit, Dash, Gradio, Shiny, Panel, Voila or a notebook as the app.
2. No fabricated data. Synthetic data only in tests and the labelled fixture in packages/shared-schemas/fixtures/. Never show fixture numbers as real.
3. The AI never computes numbers. All numbers come from stats_engine; AI text must pass `numeric_guard` in apps/api/app/ai.py.
4. Never claim a cause for a trend. Show "no significant trend" as clearly as a significant one.
5. The demo reads only from data/cache/. No live NASA calls outside pipelines/ingest/.
6. The JSON contract in packages/shared-schemas/trend.ts is frozen. Do not rename or remove fields without the team agreeing first.
7. Never commit secrets (.env, EARTHDATA_TOKEN, LLM_API_KEY).
8. Do not change statistics or grade thresholds without STATS sign-off; record any change in docs/DECISIONS.md.

## Commands

- `make setup` install Python deps · `make test` run all Python tests (must stay green)
- `make api` FastAPI on :8000 (docs at /docs) · `make seed` precompute data/cache from data/raw and grids
- `make web` Next.js dev server (after it is created in apps/web, see apps/web/README.md)

## Who owns what

| Role | Folders |
| --- | --- |
| DATA | pipelines/ingest/, data/catalog/, data/regions/, docs/VERIFIED.md |
| STATS | packages/stats_engine/ |
| API & AI | apps/api/, packages/shared-schemas/ |
| WEB | apps/web/ |
| STORY | docs/, case-file text, data/catalog definitions (wording) |

Stay inside your role's folders unless asked. Keep changes small; run `make test` before every commit; commit to a branch named `<role>/<feature>` and open a PR to main.

## Priorities (MUST before SHOULD before STRETCH)

MUST: real cached data for Kumasi (temperature, rainfall) and a West Africa trend map; verdict card (Direction / Magnitude / Evidence + what/where/how much/significant); time-series chart; globe → 2D map → click a point; opposite-trend view; provenance panel; CSV export; guarded AI wording; Kumasi case page; deployed web (Vercel) + API (Render).
SHOULD: variable finder, Tale of Two Regions chart, ground-station check, NO2 China vs India case, Twi text.
STRETCH: detective chat, PDF export, extra case files.

Full plan: the team doc "Earth Data Detective — 48-Hour Build Documentation".
