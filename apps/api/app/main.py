"""Earth Data Detective API (FastAPI). Reads precomputed results from data/cache; never calls NASA live."""
from __future__ import annotations

import csv
import base64
import functools
import io
import json
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import numpy as np
import yaml
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import AliasChoices, BaseModel, Field

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "packages" / "stats_engine"))
from stats_engine import MonthlySeries, analyze_series, cell_weights, regional_series  # noqa: E402

from .ai import rewrite, verdict_template  # noqa: E402
from .opposite import opposite_detail, opposite_sentence  # noqa: E402
from .ratelimit import RateLimiter  # noqa: E402
from .search import VariableSearch, load_encoder  # noqa: E402

CODE_VERSION = os.getenv("CODE_VERSION", "0.1.0")
CACHE = ROOT / "data" / "cache"
FIXTURE = ROOT / "packages" / "shared-schemas" / "fixtures" / "trend.fixture.json"
REQUIRED_CACHE_FILES = (Path("results") / "merra2_t2m__kumasi.json",)
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
USE_FIXTURES = os.getenv("USE_FIXTURES", "1") == "1"  # turn off once real cache exists


def validate_startup_config() -> None:
    if APP_ENV == "production" and USE_FIXTURES:
        raise RuntimeError(
            "Refusing to start: APP_ENV=production but USE_FIXTURES is on (it defaults to 1), which would serve "
            "SYNTHETIC fixture data. Set USE_FIXTURES=0 so the API serves only the real files in data/cache."
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    global SEARCH
    validate_startup_config()
    encoder = load_encoder()
    if encoder is not None:  # embed the catalog once at startup
        SEARCH = VariableSearch(CATALOG, encoder)
    yield

app = FastAPI(title="Earth Data Detective API", version=CODE_VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

CATALOG = {p.stem: yaml.safe_load(p.read_text(encoding="utf-8")) for p in (ROOT / "data" / "catalog").glob("*.yaml")}
REGIONS = json.loads((ROOT / "data" / "regions" / "presets.geojson").read_text(encoding="utf-8"))
REGION_BY_ID = {f["properties"]["id"]: f for f in REGIONS["features"]}
RUNS: dict[str, dict[str, Any]] = {}
RUN_ID_PREFIX = "r1_"
COORD_TOLERANCE = 1e-6  # degrees; absorbs float32 rounding in cached grid coordinates
RUN_ID_MAX_LENGTH = 256
SEARCH = VariableSearch(CATALOG)  # keyword search; lifespan adds embeddings when EMBEDDING_MODEL is set
LIMITER = RateLimiter(int(os.getenv("RATE_LIMIT_PER_MINUTE", "30")))


def rate_limit(request: Request) -> None:
    """429 once a client has made RATE_LIMIT_PER_MINUTE requests to this endpoint in the last minute."""
    wait = LIMITER.check(request.url.path, request.client.host if request.client else "unknown")
    if wait is not None:
        raise HTTPException(status_code=429, headers={"Retry-After": str(wait)}, detail={
            "type": "about:blank", "title": "Too many requests",
            "detail": f"Too many requests from this address. Please wait {wait} seconds and try again."})


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


class SearchRequest(BaseModel):
    # The web client sends `query`; both names are accepted.
    question: str = Field(..., min_length=1, max_length=300, validation_alias=AliasChoices("question", "query"))
    lang: Literal["en", "tw"] = "en"


def problem(status: int, title: str, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"type": "about:blank", "title": title, "detail": detail})


def _not_available(detail: str) -> HTTPException:
    """404 for data that has not been prepared yet, worded for the people using the app."""
    return problem(404, "Not available yet", detail)


def _region_label(region_id: str) -> str:
    region = REGION_BY_ID.get(region_id)
    return region["properties"]["name"] if region else "this region"


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


def _provenance_entry(entry: dict[str, Any], keep: int = 3) -> dict[str, Any]:
    """Manifest entry for a result's provenance; long per-file lists (a grid has one file per month) are summarised.

    The complete lists stay in data/cache/manifest.json, which the summary points to.
    """
    urls, files = entry.get("source_urls") or [], entry.get("input_files") or []
    if len(urls) <= keep and len(files) <= keep:
        return entry
    summary = {k: v for k, v in entry.items() if k not in ("source_urls", "input_files")}
    if urls:
        summary["source_urls"] = urls if len(urls) <= keep else [urls[0], urls[-1]]
        summary["source_url_count"] = len(urls)
    if files:
        summary["input_file_count"] = len(files)
    summary["full_record"] = "data/cache/manifest.json"
    return summary


def _finish(
    result: dict[str, Any], variable: dict[str, Any], region_name: str, geometry: Any,
    provenance_extra: dict, *, run_id: str,
) -> dict[str, Any]:
    manifest = json.loads((CACHE / "manifest.json").read_text(encoding="utf-8")) if (CACHE / "manifest.json").exists() else {}
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
            "datasets": [variable["source"], _provenance_entry(manifest_entry)],
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


def _required_cache_files() -> list[Path]:
    """REQUIRED_CACHE_FILES plus every data/cache file that the provenance manifest says exists."""
    required = set(REQUIRED_CACHE_FILES)
    manifest_path = CACHE / "manifest.json"
    if manifest_path.is_file():
        for entry in json.loads(manifest_path.read_text(encoding="utf-8")).values():
            for key in ("cache_file", "file"):
                value = entry.get(key) if isinstance(entry, dict) else None
                if isinstance(value, str) and value.startswith("data/cache/"):
                    required.add(Path(value).relative_to("data/cache"))
    return sorted(required, key=lambda p: p.as_posix())


def _cached(kind: str, pattern: str) -> list[str]:
    folder = CACHE / kind
    return sorted(p.stem for p in folder.glob(pattern)) if folder.is_dir() else []


@app.get("/api/v1/health", response_model=None)
def health() -> dict[str, Any] | JSONResponse:
    """503 when a required cache file is missing, so a deploy without its data never passes the health check."""
    missing = [
        (Path("data/cache") / relative_path).as_posix()  # same on Windows and Linux
        for relative_path in _required_cache_files()
        if not (CACHE / relative_path).is_file()
    ]
    body = {
        "status": "unavailable" if missing else "ok",
        "code_version": CODE_VERSION,
        "using_fixtures": USE_FIXTURES,
        "app_env": APP_ENV,
        "cached_results": _cached("results", "*.json"),
        "cached_maps": _cached("maps", "*.json"),
        "cached_grids": _cached("grids", "*.npz"),
        "missing_cache_files": missing,
    }
    return JSONResponse(body, status_code=503) if missing else body


@app.get("/api/v1/variables")
def variables() -> list[dict[str, Any]]:
    return list(CATALOG.values())


@app.post("/api/v1/variables/search", dependencies=[Depends(rate_limit)])
def variables_search(req: SearchRequest) -> dict[str, Any]:
    """Top 3 cached variables for a question, each with a score and a one-line reason from the catalog."""
    return {"results": SEARCH.search(req.question, req.lang, CACHE)}


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
    tol = COORD_TOLERANCE
    return grid_west <= west + tol and east <= grid_east + tol and grid_south <= south + tol and north <= grid_north + tol


def _cells_in_box(lat: np.ndarray, lon: np.ndarray, bbox: tuple[float, float, float, float]) -> np.ndarray:
    """Mask of grid cells whose centres fall inside bbox (allowing float noise, e.g. an equator row of -1.8e-13)."""
    west, south, east, north = bbox
    tol = COORD_TOLERANCE
    lat_mask = (lat >= south - tol) & (lat <= north + tol)
    lon_mask = (lon >= west - tol) & (lon <= east + tol)
    return lat_mask[:, None] & lon_mask[None, :]


@functools.lru_cache(maxsize=16)
def _load_grid_arrays(path: str, mtime_ns: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    with np.load(path) as grid:
        arrays = (grid["time"].astype("datetime64[M]"), grid["lat"].astype(float),
                  grid["lon"].astype(float), grid["cube"].astype(float))
    for array in arrays:
        array.setflags(write=False)  # shared by every request that uses this grid
    return arrays


def _grid(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """(time, lat, lon, cube) of a cached grid. Each file is read on first use and then kept in memory, keyed by
    path and modification time (a re-seeded grid is read again)."""
    return _load_grid_arrays(str(path), path.stat().st_mtime_ns)


def _select_grid(variable_id: str, region_id: str | None, bbox: tuple[float, float, float, float]) -> Path:
    grid_dir = CACHE / "grids"
    if region_id is not None:
        if region_id not in REGION_BY_ID:
            raise problem(404, "Unknown region", f"No preset or cached-grid region '{region_id}'.")
        path = grid_dir / f"{variable_id}__{region_id}.npz"
        if not path.is_file():
            raise _not_available(f"Custom areas for {CATALOG[variable_id]['name']['en']} are not available yet. Try a preset place instead.")
        _, lat, lon, _ = _grid(path)
        if not _bbox_covered_by_grid(bbox, lat, lon):
            raise problem(422, "Outside cached coverage", "The bbox is not fully inside this cached grid's coverage.")
        return path

    candidates = sorted(grid_dir.glob(f"{variable_id}__*.npz")) if grid_dir.exists() else []
    if not candidates:
        raise _not_available(f"Custom areas for {CATALOG[variable_id]['name']['en']} are not available yet. Try a preset place instead.")
    overlapping: list[tuple[bool, float, str, Path]] = []
    for path in candidates:
        _, lat, lon, _ = _grid(path)
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
        return path.resolve().relative_to(ROOT.resolve()).as_posix()
    except ValueError:
        return path.name


def _geometry_bbox(geometry: dict[str, Any]) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a preset's GeoJSON geometry."""
    coords = np.asarray([pt for ring in geometry["coordinates"] for pt in ring], dtype=float)
    return float(coords[:, 0].min()), float(coords[:, 1].min()), float(coords[:, 0].max()), float(coords[:, 1].max())


def _grid_box_result(path: Path, bbox: tuple[float, float, float, float], req: TrendRequest) -> tuple[dict[str, Any], int]:
    """Analyse the latitude-weighted mean of the cached grid cells whose centres fall inside bbox."""
    time, lat, lon, cube = _grid(path)
    if cube.shape != (len(time), len(lat), len(lon)):
        raise problem(422, "Invalid cached grid", "Cached grid dimensions do not match its time, latitude, and longitude coordinates.")
    west, south, east, north = bbox
    mask = _cells_in_box(lat, lon, bbox)
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
    return result, int(mask.sum())


@app.post("/api/v1/trend")
def trend(req: TrendRequest) -> dict[str, Any]:
    var = _variable(req.variable_id)
    _validate_request_period(req)
    if req.bbox is not None:
        bbox = _bbox_parts(req.bbox)
        path = _select_grid(req.variable_id, req.region_id, bbox)
        run_id = _encode_run_id(_trend_run_payload(req, bbox))
        result, cells = _grid_box_result(path, bbox, req)
        return _finish(
            result, var, "Custom bounding box", _bbox_geometry(bbox),
            {"manifest_key": f"grid:{path.stem}", "regional": True, "source_file": _cache_relative_path(path), "bbox": list(bbox), "selected_cells": cells},
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
        cached = json.loads(path.read_text(encoding="utf-8"))
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
    # No cached regional result: average the cells of a cached grid that covers the preset, as for a drawn box.
    region_box = _geometry_bbox(region["geometry"])
    try:
        grid_path = _select_grid(req.variable_id, None, region_box)
    except HTTPException:
        grid_path = None
    if grid_path is not None:
        result, cells = _grid_box_result(grid_path, region_box, req)
        return _finish(
            result, var, region["properties"]["name"], region["geometry"],
            {"manifest_key": f"grid:{grid_path.stem}", "regional": True, "source_file": _cache_relative_path(grid_path),
             "bbox": list(region_box), "selected_cells": cells},
            run_id=run_id,
        )
    if req.start is None and req.end is None and USE_FIXTURES and FIXTURE.exists():
        fx = json.loads(FIXTURE.read_text(encoding="utf-8"))
        RUNS[fx["run_id"]] = fx
        return fx
    raise _not_available(
        f"{var['name']['en']} results for {region['properties']['name']} have not been prepared yet. Try another variable or place."
    )


@app.post("/api/v1/trend-at-point")
def trend_at_point(req: PointRequest) -> dict[str, Any]:
    var = _variable(req.variable_id)
    path = CACHE / "grids" / f"{req.variable_id}__{req.region_id}.npz"
    if not path.exists():
        if USE_FIXTURES and FIXTURE.exists():
            return json.loads(FIXTURE.read_text(encoding="utf-8"))
        raise _not_available(f"Map clicks for {var['name']['en']} are not available yet. Try a preset place instead.")
    time, lat, lon, cube = _grid(path)
    if not (lat.min() <= req.lat <= lat.max() and lon.min() <= req.lon <= lon.max()):
        raise problem(422, "Outside the map", "That point is outside the cached region.")
    run_id = _encode_run_id(_point_run_payload(req))
    i, j = int(np.abs(lat - req.lat).argmin()), int(np.abs(lon - req.lon).argmin())
    s = MonthlySeries(time, cube[:, i, j])
    try:
        result = analyze_series(s, compute_horizon=False)  # horizon is too slow per click; precomputed cases only
    except ValueError as exc:
        raise problem(422, "Not enough data here", str(exc)) from exc
    name = f"Grid cell near {lat[i]:.2f}°, {lon[j]:.2f}°"
    geom = {"type": "Point", "coordinates": [float(lon[j]), float(lat[i])]}
    return _finish(result, var, name, geom, {"manifest_key": f"grid:{path.stem}", "regional": False}, run_id=run_id)


def _resolve_run(run_id: str) -> dict[str, Any]:
    if not isinstance(run_id, str) or not run_id.startswith(RUN_ID_PREFIX):
        if USE_FIXTURES and run_id in RUNS:
            return RUNS[run_id]
        if USE_FIXTURES and FIXTURE.is_file():
            fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
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
    var = _variable(vid)
    path = CACHE / "maps" / f"{vid}__{region_id}.json"
    if not path.exists():
        raise _not_available(f"The {var['name']['en']} trend map for {_region_label(region_id)} is not available yet.")
    data = json.loads(path.read_text(encoding="utf-8"))
    data.pop("opposite_trends", None)
    data["palette_polarity"] = CATALOG[vid]["palette_polarity"]
    data["units_per_decade"] = f"{CATALOG[vid]['units']} per decade"
    return data


@app.get("/api/v1/opposite-trends/{vid}/{region_id}")
def opposite(vid: str, region_id: str) -> dict[str, Any]:
    var = _variable(vid)
    path = CACHE / "maps" / f"{vid}__{region_id}.json"
    if not path.exists():
        raise _not_available(f"Opposite-trend results for {var['name']['en']} in {_region_label(region_id)} are not available yet.")
    cached = json.loads(path.read_text(encoding="utf-8"))
    block = cached["opposite_trends"]
    detail = opposite_detail(cached)
    return {**block, **detail, "sentence": opposite_sentence(detail, block["found"], CATALOG[vid]["palette_polarity"])}


@app.post("/api/v1/narrative", dependencies=[Depends(rate_limit)])
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
