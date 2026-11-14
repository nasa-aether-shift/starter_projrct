"""Earth Data Detective API (FastAPI). Reads precomputed results from data/cache; never calls NASA live."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import numpy as np
import yaml
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "packages" / "stats_engine"))
from stats_engine import MonthlySeries, analyze_series  # noqa: E402

from .ai import rewrite, verdict_template  # noqa: E402

CODE_VERSION = os.getenv("CODE_VERSION", "0.1.0")
CACHE = ROOT / "data" / "cache"
FIXTURE = ROOT / "packages" / "shared-schemas" / "fixtures" / "trend.fixture.json"

app = FastAPI(title="Earth Data Detective API", version=CODE_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

CATALOG = {p.stem: yaml.safe_load(p.read_text()) for p in (ROOT / "data" / "catalog").glob("*.yaml")}
REGIONS = json.loads((ROOT / "data" / "regions" / "presets.geojson").read_text())
REGION_BY_ID = {f["properties"]["id"]: f for f in REGIONS["features"]}
RUNS: dict[str, dict[str, Any]] = {}
USE_FIXTURES = os.getenv("USE_FIXTURES", "1") == "1"  # turn off once real cache exists


class TrendRequest(BaseModel):
    variable_id: str
    region_id: str | None = None
    start: str | None = None
    end: str | None = None
    alpha: float = Field(0.05, gt=0, lt=0.5)


class PointRequest(BaseModel):
    variable_id: str
    region_id: str = Field(..., description="Which cached grid to use, e.g. west_africa")
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class NarrativeRequest(BaseModel):
    run_id: str
    level: Literal["kid", "student"] = "student"
    use_ai: bool = True


def problem(status: int, title: str, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"type": "about:blank", "title": title, "detail": detail})


def _variable(vid: str) -> dict[str, Any]:
    if vid not in CATALOG:
        raise problem(404, "Unknown variable", f"No variable '{vid}'. See GET /api/v1/variables.")
    return CATALOG[vid]


def _finish(result: dict[str, Any], variable: dict[str, Any], region_name: str, geometry: Any, provenance_extra: dict) -> dict[str, Any]:
    run_id = hashlib.sha256(json.dumps([variable["id"], region_name, result["period"], CODE_VERSION]).encode()).hexdigest()[:16]
    manifest = json.loads((CACHE / "manifest.json").read_text()) if (CACHE / "manifest.json").exists() else {}
    full = {
        "run_id": run_id,
        "variable": {"id": variable["id"], "name": variable["name"]["en"], "units": variable["units"], "kind": variable["model_or_measurement"]},
        "region": {"name": region_name, "geometry": geometry},
        **result,
        "provenance": {
            "datasets": [variable["source"], manifest.get(provenance_extra.get("manifest_key", ""), {})],
            "steps": [
                "Quality masks and fill values removed",
                "Latitude-weighted regional mean" if provenance_extra.get("regional") else "Nearest grid cell",
                "Monthly anomalies (each calendar month's mean removed)",
                "Theil-Sen slope with 95% interval",
                "Mann-Kendall (original, Hamed-Rao modified, seasonal, annual) and OLS t-test",
                "Pettitt change-point test; evidence grade A-D",
            ],
            "code_version": CODE_VERSION,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            **{k: v for k, v in provenance_extra.items() if k not in ("manifest_key", "regional")},
        },
    }
    full["verdict"] = verdict_template(full, variable, region_name)
    RUNS[run_id] = full
    return full


@app.get("/api/v1/health")
def health() -> dict[str, Any]:
    results = sorted(p.stem for p in (CACHE / "results").glob("*.json")) if (CACHE / "results").exists() else []
    return {"status": "ok", "code_version": CODE_VERSION, "cached_results": results, "using_fixtures": USE_FIXTURES}


@app.get("/api/v1/variables")
def variables() -> list[dict[str, Any]]:
    return list(CATALOG.values())


@app.get("/api/v1/variables/{vid}")
def variable(vid: str) -> dict[str, Any]:
    return _variable(vid)


@app.get("/api/v1/regions/presets")
def presets() -> dict[str, Any]:
    return REGIONS


@app.post("/api/v1/trend")
def trend(req: TrendRequest) -> dict[str, Any]:
    var = _variable(req.variable_id)
    region = REGION_BY_ID.get(req.region_id or "")
    if region is None:
        raise problem(404, "Unknown region", f"No preset '{req.region_id}'. Drawn boxes: use /trend-at-point for now.")
    path = CACHE / "results" / f"{req.variable_id}__{req.region_id}.json"
    if path.exists():
        result = json.loads(path.read_text())
        return _finish(result, var, region["properties"]["name"], region["geometry"], {"manifest_key": path.stem, "regional": True})
    if USE_FIXTURES and FIXTURE.exists():
        fx = json.loads(FIXTURE.read_text())
        RUNS[fx["run_id"]] = fx
        return fx
    raise problem(404, "Not cached yet", f"No cached result for {path.stem}. Run `make seed` after ingesting data.")


@app.post("/api/v1/trend-at-point")
def trend_at_point(req: PointRequest) -> dict[str, Any]:
    var = _variable(req.variable_id)
    path = CACHE / "grids" / f"{req.variable_id}__{req.region_id}.npz"
    if not path.exists():
        if USE_FIXTURES and FIXTURE.exists():
            return json.loads(FIXTURE.read_text())
        raise problem(404, "Grid not cached", f"No grid for {path.stem}. Run the earthaccess ingest, then `make seed`.")
    g = np.load(path)
    lat, lon = g["lat"], g["lon"]
    if not (lat.min() <= req.lat <= lat.max() and lon.min() <= req.lon <= lon.max()):
        raise problem(422, "Outside the map", "That point is outside the cached region.")
    i, j = int(np.abs(lat - req.lat).argmin()), int(np.abs(lon - req.lon).argmin())
    s = MonthlySeries(g["time"].astype("datetime64[M]"), g["cube"][:, i, j])
    try:
        result = analyze_series(s, compute_horizon=False)  # horizon is too slow per click; precomputed cases only
    except ValueError as exc:
        raise problem(422, "Not enough data here", str(exc)) from exc
    name = f"Grid cell near {lat[i]:.2f}°, {lon[j]:.2f}°"
    geom = {"type": "Point", "coordinates": [float(lon[j]), float(lat[i])]}
    return _finish(result, var, name, geom, {"manifest_key": f"grid:{path.stem}", "regional": False})


@app.get("/api/v1/trend-map/{vid}/{region_id}")
def trend_map(vid: str, region_id: str) -> dict[str, Any]:
    _variable(vid)
    path = CACHE / "maps" / f"{vid}__{region_id}.json"
    if not path.exists():
        raise problem(404, "Map not cached", f"Run `make seed` to build {path.stem}.")
    data = json.loads(path.read_text())
    data.pop("opposite_trends", None)
    data["palette_polarity"] = CATALOG[vid]["palette_polarity"]
    data["units_per_decade"] = f"{CATALOG[vid]['units']} per decade"
    return data


@app.get("/api/v1/opposite-trends/{vid}/{region_id}")
def opposite(vid: str, region_id: str) -> dict[str, Any]:
    _variable(vid)
    path = CACHE / "maps" / f"{vid}__{region_id}.json"
    if not path.exists():
        raise problem(404, "Map not cached", f"Run `make seed` to build {path.stem}.")
    return json.loads(path.read_text())["opposite_trends"]


@app.post("/api/v1/narrative")
def narrative(req: NarrativeRequest) -> dict[str, Any]:
    run = RUNS.get(req.run_id)
    if run is None:
        raise problem(404, "Unknown run", "Call /trend first; runs are kept in memory.")
    if run["variable"]["id"] not in CATALOG:  # synthetic fixture
        return {"sentences": run["verdict"], "source": "template"}
    var = CATALOG[run["variable"]["id"]]
    template = verdict_template(run, var, run["region"]["name"])
    if not req.use_ai:
        return {"sentences": template, "source": "template"}
    sentences, source = rewrite(template, run, req.level)
    return {"sentences": sentences, "source": source}


@app.get("/api/v1/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    if run_id not in RUNS:
        raise problem(404, "Unknown run", run_id)
    return RUNS[run_id]


@app.get("/api/v1/runs/{run_id}/csv")
def run_csv(run_id: str) -> StreamingResponse:
    run = get_run(run_id)
    buf = io.StringIO()
    buf.write(f"# {run['variable']['name']} ({run['variable']['units']}) | {run['region']['name']} | run {run_id} | code {CODE_VERSION}\n")
    w = csv.writer(buf)
    w.writerow(["time", "raw", "anomaly", "trend_line"])
    s = run["series"]
    for row in zip(s["time"], s["raw"], s["anomaly"], s["trend_line"]):
        w.writerow(row)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename={run_id}.csv"})
