"""Earth Data Detective API (FastAPI). Reads precomputed results from data/cache; never calls NASA live."""
from __future__ import annotations

import csv
import base64
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
from stats_engine import MonthlySeries, analyze_series, cell_weights, regional_series  # noqa: E402

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
RUN_ID_PREFIX = "r1_"
RUN_ID_MAX_LENGTH = 256


class TrendRequest(BaseModel):
    variable_id: str
    region_id: str | None = None
    bbox: list[Any] | None = None
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


def _encode_run_id(payload: dict[str, Any]) -> str:
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    ).decode("ascii").rstrip("=")
    run_id = f"{RUN_ID_PREFIX}{encoded}"
    if len(run_id) > RUN_ID_MAX_LENGTH:
        raise problem(422, "Request too long", f"The normalized request exceeds the {RUN_ID_MAX_LENGTH}-character run ID limit.")
    return run_id


def _trend_run_payload(req: TrendRequest, bbox: tuple[float, float, float, float] | None) -> dict[str, Any]:
    return {
        "kind": "trend",
        "variable_id": req.variable_id,
        "region_id": req.region_id,
        "bbox": list(bbox) if bbox is not None else None,
        "start": req.start,
        "end": req.end,
        "alpha": float(req.alpha),
    }


def _point_run_payload(req: PointRequest) -> dict[str, Any]:
    return {
        "kind": "point",
        "variable_id": req.variable_id,
        "region_id": req.region_id,
        "lat": float(req.lat),
        "lon": float(req.lon),
    }


def _decode_run_id(run_id: str) -> dict[str, Any]:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
    if not isinstance(run_id, str) or len(run_id) > RUN_ID_MAX_LENGTH or not run_id.startswith(RUN_ID_PREFIX):
        raise problem(404, "Unknown run", "This run ID is invalid or unavailable.")
    encoded = run_id[len(RUN_ID_PREFIX):]
    if not encoded or any(char not in alphabet for char in encoded):
        raise problem(404, "Unknown run", "This run ID is invalid or unavailable.")
    try:
        raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("run payload must be an object")
        kind = payload.get("kind")
        if kind == "trend":
            required = {"kind", "variable_id", "region_id", "bbox", "start", "end", "alpha"}
            if set(payload) != required:
                raise ValueError("trend request fields do not match")
            req = TrendRequest(**{key: payload[key] for key in required if key != "kind"})
            normalized = _trend_run_payload(req, _bbox_parts(req.bbox) if req.bbox is not None else None)
        elif kind == "point":
            required = {"kind", "variable_id", "region_id", "lat", "lon"}
            if set(payload) != required:
                raise ValueError("point request fields do not match")
            req = PointRequest(**{key: payload[key] for key in required if key != "kind"})
            normalized = _point_run_payload(req)
        else:
            raise ValueError("unknown run kind")
        if _encode_run_id(normalized) != run_id:
            raise ValueError("run ID is not canonical")
        return payload
    except Exception as exc:
        raise problem(404, "Unknown run", "This run ID is invalid or unavailable.") from exc


def _finish(
    result: dict[str, Any], variable: dict[str, Any], region_name: str, geometry: Any,
    provenance_extra: dict, *, run_id: str,
) -> dict[str, Any]:
    manifest = json.loads((CACHE / "manifest.json").read_text()) if (CACHE / "manifest.json").exists() else {}
    manifest_entry = manifest.get(provenance_extra.get("manifest_key", ""), {})
    is_giovanni_series = "giovanni.gsfc.nasa.gov" in manifest_entry.get("source", "")
    spatial_step = (
        "NASA Giovanni area-averaged regional series"
        if is_giovanni_series
        else "Latitude-weighted regional mean" if provenance_extra.get("regional") else "Nearest grid cell"
    )
    quality_step = "Giovanni-declared fill values removed" if is_giovanni_series else "Quality masks and fill values removed"
    full = {
        "run_id": run_id,
        "variable": {"id": variable["id"], "name": variable["name"]["en"], "units": variable["units"], "kind": variable["model_or_measurement"]},
        "region": {"name": region_name, "geometry": geometry},
        **result,
        "provenance": {
            "datasets": [variable["source"], manifest_entry],
            "steps": [
                quality_step,
                spatial_step,
                *manifest_entry.get("processing_steps", []),
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
    if not run_id.startswith(RUN_ID_PREFIX):
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


def _month_index(value: str | None, field: str) -> int | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) != 7 or value[4:5] != "-" or not (value[:4] + value[5:]).isdigit():
        raise problem(422, "Invalid date", f"{field} must use YYYY-MM format.")
    year, month = int(value[:4]), int(value[5:])
    if not 1 <= month <= 12:
        raise problem(422, "Invalid date", f"{field} must use a valid month in YYYY-MM format.")
    return year * 12 + month - 1


def _validate_request_period(req: TrendRequest) -> tuple[int | None, int | None]:
    start_idx = _month_index(req.start, "start")
    end_idx = _month_index(req.end, "end")
    if start_idx is not None and end_idx is not None and end_idx < start_idx:
        raise problem(422, "Invalid period", "The end month must be the same as or after the start month.")
    return start_idx, end_idx


def _analyze_period(time: np.ndarray, values: np.ndarray, req: TrendRequest) -> dict[str, Any]:
    start_idx, end_idx = _validate_request_period(req)
    month_idx = np.asarray(time, dtype="datetime64[M]").astype(int)
    keep = np.ones(len(month_idx), dtype=bool)
    if start_idx is not None:
        keep &= month_idx >= start_idx - (1970 * 12)
    if end_idx is not None:
        keep &= month_idx <= end_idx - (1970 * 12)
    selected_time = np.asarray(time, dtype="datetime64[M]")[keep]
    selected_values = np.asarray(values, dtype=float)[keep]
    if not len(selected_time) or not np.isfinite(selected_values).any():
        raise problem(422, "Insufficient data", "The requested period contains no valid cached data.")
    try:
        return analyze_series(MonthlySeries(selected_time, selected_values), alpha=req.alpha)
    except ValueError as exc:
        raise problem(422, "Insufficient data", str(exc)) from exc


def _bbox_parts(bbox: list[Any]) -> tuple[float, float, float, float]:
    if len(bbox) != 4:
        raise problem(422, "Invalid bounding box", "bbox must contain four coordinates: west, south, east, north.")
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in bbox):
        raise problem(422, "Invalid bounding box", "All bbox coordinates must be finite numbers.")
    west, south, east, north = map(float, bbox)
    if not np.isfinite([west, south, east, north]).all():
        raise problem(422, "Invalid bounding box", "All bbox coordinates must be finite numbers.")
    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
        raise problem(422, "Invalid bounding box", "bbox must be [west, south, east, north] with valid coordinate bounds.")
    lon_span, lat_span = east - west, north - south
    if not (0.25 <= lon_span <= 10 and 0.25 <= lat_span <= 10):
        raise problem(422, "Invalid bounding box size", "Each bbox side must be between 0.25 and 10 degrees.")
    return west, south, east, north


def _grid_coverage(axis: np.ndarray) -> tuple[float, float]:
    coords = np.unique(np.asarray(axis, dtype=float))
    if not len(coords) or not np.isfinite(coords).all():
        raise problem(422, "Invalid cached grid", "The selected cached grid has invalid coordinates.")
    coords.sort()
    half_step = float(np.median(np.diff(coords)) / 2) if len(coords) > 1 else 0.0
    return float(coords[0] - half_step), float(coords[-1] + half_step)


def _bbox_covered_by_grid(bbox: tuple[float, float, float, float], lat: np.ndarray, lon: np.ndarray) -> bool:
    west, south, east, north = bbox
    grid_west, grid_east = _grid_coverage(lon)
    grid_south, grid_north = _grid_coverage(lat)
    return grid_west <= west and east <= grid_east and grid_south <= south and north <= grid_north


def _select_grid(variable_id: str, region_id: str | None, bbox: tuple[float, float, float, float]) -> Path:
    grid_dir = CACHE / "grids"
    if region_id is not None:
        if region_id not in REGION_BY_ID:
            raise problem(404, "Unknown region", f"No preset or cached-grid region '{region_id}'.")
        path = grid_dir / f"{variable_id}__{region_id}.npz"
        if not path.is_file():
            raise problem(404, "Grid not cached", f"No grid for {path.stem}.")
        with np.load(path) as grid:
            if not _bbox_covered_by_grid(bbox, grid["lat"], grid["lon"]):
                raise problem(422, "Outside cached coverage", "The bbox is not fully inside this cached grid's coverage.")
        return path

    candidates = sorted(grid_dir.glob(f"{variable_id}__*.npz")) if grid_dir.exists() else []
    if not candidates:
        raise problem(404, "Grid not cached", f"No cached grid exists for variable '{variable_id}'.")
    overlapping: list[tuple[bool, float, str, Path]] = []
    for path in candidates:
        with np.load(path) as grid:
            lat, lon = grid["lat"], grid["lon"]
            if not _bbox_covered_by_grid(bbox, lat, lon):
                continue
            lat_bounds, lon_bounds = _grid_coverage(lat), _grid_coverage(lon)
            west, south, east, north = bbox
            contains = lon_bounds[0] <= west and east <= lon_bounds[1] and lat_bounds[0] <= south and north <= lat_bounds[1]
            area = (lon_bounds[1] - lon_bounds[0]) * (lat_bounds[1] - lat_bounds[0])
            overlapping.append((not contains, area, path.name, path))
    if not overlapping:
        raise problem(422, "Outside cached coverage", "The bbox is outside cached coverage for this variable.")
    return min(overlapping)[3]


def _bbox_geometry(bbox: tuple[float, float, float, float]) -> dict[str, Any]:
    west, south, east, north = bbox
    return {"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]}


def _cache_relative_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT.resolve()))
    except ValueError:
        return path.name


@app.post("/api/v1/trend")
def trend(req: TrendRequest) -> dict[str, Any]:
    var = _variable(req.variable_id)
    _validate_request_period(req)
    if req.bbox is not None:
        bbox = _bbox_parts(req.bbox)
        path = _select_grid(req.variable_id, req.region_id, bbox)
        run_id = _encode_run_id(_trend_run_payload(req, bbox))
        with np.load(path) as grid:
            time = grid["time"].astype("datetime64[M]")
            lat, lon, cube = grid["lat"].astype(float), grid["lon"].astype(float), grid["cube"].astype(float)
        if cube.shape != (len(time), len(lat), len(lon)):
            raise problem(422, "Invalid cached grid", "Cached grid dimensions do not match its time, latitude, and longitude coordinates.")
        west, south, east, north = bbox
        lat_mask = (lat >= south) & (lat <= north)
        lon_mask = (lon >= west) & (lon <= east)
        mask = lat_mask[:, None] & lon_mask[None, :]
        notices: list[str] = []
        if not mask.any():
            mid_lat, mid_lon = (south + north) / 2, (west + east) / 2
            lon_scale = np.cos(np.deg2rad(mid_lat))
            distance = (lat[:, None] - mid_lat) ** 2 + (lon_scale * (lon[None, :] - mid_lon)) ** 2
            i, j = np.unravel_index(np.argmin(distance), distance.shape)
            mask[i, j] = True
            notices.append(f"No grid-cell centre fell inside the bbox; nearest grid-cell centre ({lat[i]:.4f}, {lon[j]:.4f}) was used.")
        values = regional_series(cube, mask, cell_weights(lat, mask.shape))
        result = _analyze_period(time, values, req)
        if result["data_quality"] is not None:
            result["data_quality"]["notices"].extend(notices)
        region_name = "Custom bounding box"
        return _finish(
            result, var, region_name, _bbox_geometry(bbox),
            {"manifest_key": f"grid:{path.stem}", "regional": True, "source_file": _cache_relative_path(path), "bbox": list(bbox), "selected_cells": int(mask.sum())},
            run_id=run_id,
        )

    if req.region_id is None:
        raise problem(422, "Missing region", "Provide a preset region_id or a bbox.")
    region = REGION_BY_ID.get(req.region_id)
    if region is None:
        raise problem(404, "Unknown region", f"No preset '{req.region_id}'.")
    run_id = _encode_run_id(_trend_run_payload(req, None))
    path = CACHE / "results" / f"{req.variable_id}__{req.region_id}.json"
    if path.exists():
        cached = json.loads(path.read_text())
        if req.start is None and req.end is None and req.alpha == cached.get("tests", {}).get("alpha", 0.05):
            result = cached
        else:
            result = _analyze_period(
                np.asarray(cached["series"]["time"], dtype="datetime64[M]"),
                np.asarray(cached["series"]["raw"], dtype=float), req,
            )
        return _finish(
            result, var, region["properties"]["name"], region["geometry"],
            {"manifest_key": path.stem, "regional": True}, run_id=run_id,
        )
    if req.start is None and req.end is None and USE_FIXTURES and FIXTURE.exists():
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
    run_id = _encode_run_id(_point_run_payload(req))
    i, j = int(np.abs(lat - req.lat).argmin()), int(np.abs(lon - req.lon).argmin())
    s = MonthlySeries(g["time"].astype("datetime64[M]"), g["cube"][:, i, j])
    try:
        result = analyze_series(s, compute_horizon=False)  # horizon is too slow per click; precomputed cases only
    except ValueError as exc:
        raise problem(422, "Not enough data here", str(exc)) from exc
    name = f"Grid cell near {lat[i]:.2f}°, {lon[j]:.2f}°"
    geom = {"type": "Point", "coordinates": [float(lon[j]), float(lat[i])]}
    return _finish(result, var, name, geom, {"manifest_key": f"grid:{path.stem}", "regional": False}, run_id=run_id)


def _resolve_run(run_id: str) -> dict[str, Any]:
    if not isinstance(run_id, str) or not run_id.startswith(RUN_ID_PREFIX):
        if run_id in RUNS:
            return RUNS[run_id]
        if USE_FIXTURES and FIXTURE.is_file():
            fixture = json.loads(FIXTURE.read_text())
            if fixture.get("run_id") == run_id:
                return fixture
        raise problem(404, "Unknown run", "This run ID is invalid or unavailable.")

    payload = _decode_run_id(run_id)
    try:
        if payload["kind"] == "trend":
            request = TrendRequest(**{key: payload[key] for key in ("variable_id", "region_id", "bbox", "start", "end", "alpha")})
            run = trend(request)
        else:
            request = PointRequest(**{key: payload[key] for key in ("variable_id", "region_id", "lat", "lon")})
            run = trend_at_point(request)
    except HTTPException as exc:
        if exc.status_code in (404, 422):
            raise problem(404, "Unknown run", "The cached inputs for this run are no longer available.") from exc
        raise
    if run.get("run_id") != run_id:
        raise problem(404, "Unknown run", "The cached inputs for this run are no longer available.")
    return run


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
    run = _resolve_run(req.run_id)
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
    return _resolve_run(run_id)


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
