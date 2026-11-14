# Web app (WEB owns this)

Create the app at kickoff, inside this folder:

```bash
cd apps/web
npx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*"
npx shadcn@latest init
npm i maplibre-gl echarts echarts-for-react @tanstack/react-query zod framer-motion
npm i -D @types/geojson
```

Then:

1. Copy `../../packages/shared-schemas/trend.ts` to `src/lib/contract.ts` (or import it with a path alias).
2. Set `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1` in `.env.local`.
3. Until real data is cached, `POST /trend` and `POST /trend-at-point` return the **SYNTHETIC fixture**. Build every component against it; never screenshot it for the pitch.

## Build order (from the team doc, Section 8)

1. `/` MapLibre globe (`projection: "globe"`), slow rotation, button to start.
2. `/explore` fly-to Ghana → 2D map, click → `POST /trend-at-point` → side panel.
3. `VerdictCard` (Direction / Magnitude / Evidence + four sentences), `TimeSeriesChart` (ECharts: raw quiet, anomaly bold, trend line, CI band, change-point marker, table toggle).
4. `/investigate` wizard: question → variable cards → place → results.
5. `TrendMap` layer from `GET /trend-map/{variable}/{region}`: diverging colours by `palette_polarity`, dots where `fdr_significant` = 1, signed legend.
6. `ProvenancePanel`, CSV button (`GET /runs/{id}/csv`), opposite-trends tab, Kumasi case page.

Design rules: colour-blind-safe palettes (RdBu diverging, viridis sequential), never colour alone, table fallback for every chart, large text for the projector.
