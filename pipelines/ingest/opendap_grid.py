"""Monthly grids for a box from NASA Earthdata cloud OPeNDAP, cut out on the server.

Whole global monthly files are large (MERRA-2 M2TMNXSLV 1980-2025: 552 files, about 31 GB; GPM_3IMERGM V07
2000-2025: 304 files, about 5 GB, per CMR granule sizes). OPeNDAP returns only the requested variable inside the
box, a few tens of KB per month. Dataset facts used below (variable path, dimension order, units, fill value) were
read from each collection's OPeNDAP DMR and are recorded in docs/VERIFIED.md.

Writes data/cache/grids/<variable>__<region>.npz (time, lat, lon, cube) and a manifest entry with the SHA-256 of
every downloaded subset, which `make seed` verifies before building maps. The subsets stay in
data/raw/opendap/ (git-ignored). Needs an Earthdata Login token in EARTHDATA_TOKEN; it is never printed or stored.

  python -m pipelines.ingest.opendap_grid --variable gpm_precip --region west_africa
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CMR_GRANULES = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
CODE_VERSION = os.getenv("CODE_VERSION", "0.1.0")
HDF5_MAGIC = b"\x89HDF"


@dataclass(frozen=True)
class GridSpec:
    short_name: str
    version: str
    variable: str  # path of the variable in the OPeNDAP response
    lat: str
    lon: str
    lon_first: bool  # dimensions are (time, lon, lat) rather than (time, lat, lon)
    fill_value: float
    source_units: str
    output_units: str
    start: str  # first month of the record
    coarsen: int = 1  # average blocks of n x n cells (1 = native grid)


# Facts from each collection's OPeNDAP DMR, checked 2026-11-14 (docs/VERIFIED.md).
SPECS: dict[str, GridSpec] = {
    "merra2_t2m": GridSpec("M2TMNXSLV", "5.12.4", "/T2M", "/lat", "/lon", False, 1e15, "K", "degC", "1980-01"),
    "gpm_precip": GridSpec(
        "GPM_3IMERGM", "07", "/Grid/precipitation", "/Grid/lat", "/Grid/lon", True, -9999.9, "mm/hr", "mm/day",
        "2000-06", coarsen=5,
    ),
}

Getter = Callable[..., Any]  # requests.get-compatible


def region_bbox(region_id: str, presets_path: Path | None = None) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a preset region's polygon."""
    presets = json.loads((presets_path or ROOT / "data" / "regions" / "presets.geojson").read_text(encoding="utf-8"))
    for feature in presets["features"]:
        if feature["properties"]["id"] == region_id:
            ring = np.asarray(feature["geometry"]["coordinates"][0], dtype=float)
            return float(ring[:, 0].min()), float(ring[:, 1].min()), float(ring[:, 0].max()), float(ring[:, 1].max())
    raise ValueError(f"Unknown region preset: {region_id}")


def index_range(axis: np.ndarray, low: float, high: float, tolerance: float = 1e-6) -> tuple[int, int]:
    """First and last index of the cell centres that fall inside [low, high] (allowing float noise such as
    MERRA-2's equator row, stored as -1.8e-13)."""
    inside = np.flatnonzero((np.asarray(axis) >= low - tolerance) & (np.asarray(axis) <= high + tolerance))
    if not inside.size:
        raise ValueError(f"No grid cell centre lies between {low} and {high}.")
    return int(inside[0]), int(inside[-1])


def constraint(spec: GridSpec, lat_range: tuple[int, int], lon_range: tuple[int, int]) -> str:
    """DAP4 constraint expression for the variable and its coordinates inside the index ranges."""
    lat_sel, lon_sel = f"[{lat_range[0]}:{lat_range[1]}]", f"[{lon_range[0]}:{lon_range[1]}]"
    field = f"[0]{lon_sel}{lat_sel}" if spec.lon_first else f"[0]{lat_sel}{lon_sel}"
    return f"{spec.variable}{field};{spec.lat}{lat_sel};{spec.lon}{lon_sel}"


def subset_dir(root: Path, variable_id: str, region_id: str, ce: str) -> Path:
    """Folder for downloaded subsets, keyed by their constraint so a changed box never reuses old cut-outs."""
    key = hashlib.sha256(ce.encode("utf-8")).hexdigest()[:12]
    return root / "data" / "raw" / "opendap" / f"{variable_id}__{region_id}" / key


def convert_units(values: np.ndarray, spec: GridSpec) -> tuple[np.ndarray, str | None]:
    """Values in output units plus the processing step that describes the conversion (None if unchanged)."""
    if spec.source_units == spec.output_units:
        return values, None
    if (spec.source_units, spec.output_units) == ("K", "degC"):
        return values - 273.15, "Converted temperature from K to degC (subtract 273.15)."
    if (spec.source_units, spec.output_units) == ("mm/hr", "mm/day"):
        return values * 24.0, "Converted precipitation rate from mm/hr to mm/day (multiply by 24)."
    raise ValueError(f"Unsupported unit conversion: {spec.source_units} to {spec.output_units}")


def coarsen(lat: np.ndarray, lon: np.ndarray, cube: np.ndarray, n: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Average n x n blocks of cells; a block with fewer than half of its cells valid stays missing."""
    if n == 1:
        return lat, lon, cube
    n_lat, n_lon = (len(lat) // n) * n, (len(lon) // n) * n
    blocks = cube[:, :n_lat, :n_lon].reshape(cube.shape[0], n_lat // n, n, n_lon // n, n)
    valid = np.isfinite(blocks).sum(axis=(2, 4))
    with np.errstate(invalid="ignore"):
        sums = np.nansum(blocks, axis=(2, 4))
        means = np.where(valid >= (n * n) / 2, sums / np.maximum(valid, 1), np.nan)
    return lat[:n_lat].reshape(-1, n).mean(axis=1), lon[:n_lon].reshape(-1, n).mean(axis=1), means


def read_subset(path: Path, spec: GridSpec) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(lat, lon, field[lat, lon]) from one OPeNDAP NetCDF-4 response, fill values set to NaN."""
    import h5py  # ingestion-only dependency

    with h5py.File(path, "r") as handle:
        field = np.asarray(handle[spec.variable][0], dtype=float)
        lat = np.asarray(handle[spec.lat][...], dtype=float)
        lon = np.asarray(handle[spec.lon][...], dtype=float)
    if spec.lon_first:
        field = field.T
    field[(field == np.float32(spec.fill_value)) | ~np.isfinite(field)] = np.nan
    return lat, lon, field


def list_granules(spec: GridSpec, start: str, end: str, get: Getter) -> list[dict[str, str]]:
    """Monthly granules from CMR, with their HTTPS data URL and OPeNDAP URL, sorted by month."""
    last_day = (dt.date(int(end[:4]), int(end[5:7]), 28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
    temporal = f"{start}-01T00:00:00Z,{last_day.isoformat()}T23:59:59Z"
    granules: dict[str, dict[str, str]] = {}
    page = 1
    while True:
        response = get(CMR_GRANULES, params={"short_name": spec.short_name, "version": spec.version,
                                             "temporal": temporal, "page_size": 2000, "page_num": page}, timeout=120)
        response.raise_for_status()
        items = response.json().get("items", [])
        for item in items:
            umm = item["umm"]
            month = umm["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"][:7]
            urls = umm.get("RelatedUrls", [])
            data = next((u["URL"] for u in urls if u.get("Type") == "GET DATA" and u["URL"].startswith("https://")), None)
            opendap = next((u["URL"] for u in urls if u.get("Subtype") == "OPENDAP DATA" and u["URL"].startswith("https://")), None)
            if data and opendap:
                granules[month] = {"month": month, "data_url": data, "opendap_url": opendap}
        if len(items) < 2000:
            break
        page += 1
    if not granules:
        raise ValueError(f"CMR returned no {spec.short_name} {spec.version} granules with OPeNDAP links for {start} to {end}.")
    return [granules[month] for month in sorted(granules)]


def _fetch(url: str, token: str, get: Getter, path: Path, params: dict[str, str] | None = None, attempts: int = 3) -> Path:
    """Download one OPeNDAP NetCDF-4 response to path (kept if already present and valid)."""
    if path.is_file() and path.read_bytes()[:4] == HDF5_MAGIC:
        return path
    for attempt in range(1, attempts + 1):
        try:
            response = get(url, params=params, headers={"Authorization": f"Bearer {token}"}, timeout=180)
            if response.status_code == 200 and response.content[:4] == HDF5_MAGIC:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(response.content)
                return path
            problem = f"HTTP {response.status_code}"
        except Exception as exc:  # network errors are retried; the token never appears in messages
            problem = type(exc).__name__
        if attempt < attempts:
            time.sleep(2 * attempt)
    raise RuntimeError(f"OPeNDAP download failed after {attempts} attempts ({problem}): {url}")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_grid(
    variable_id: str, region_id: str, *, token: str, start: str | None = None, end: str = "2025-12",
    get: Getter | None = None, workers: int = 6, root: Path | None = None,
) -> Path:
    """Download the box for every month, then write the grid cache and its manifest entry."""
    if not token:
        raise ValueError("Set EARTHDATA_TOKEN to an Earthdata Login token first.")
    if get is None:
        import requests

        get = requests.get
    spec = SPECS[variable_id]
    root = root or ROOT
    start = start or spec.start
    west, south, east, north = region_bbox(region_id, root / "data" / "regions" / "presets.geojson")
    granules = list_granules(spec, start, end, get)
    raw_dir = root / "data" / "raw" / "opendap" / f"{variable_id}__{region_id}"

    # Full coordinate axes from the first granule pick the index ranges of the box.
    axes_path = _fetch(f"{granules[0]['opendap_url']}.dap.nc4", token, get, raw_dir / "axes.nc4",
                       params={"dap4.ce": f"{spec.lat};{spec.lon}"})
    import h5py  # ingestion-only dependency

    with h5py.File(axes_path, "r") as handle:
        lat_axis, lon_axis = np.asarray(handle[spec.lat][...]), np.asarray(handle[spec.lon][...])
    ce = constraint(spec, index_range(lat_axis, south, north), index_range(lon_axis, west, east))

    subsets = subset_dir(root, variable_id, region_id, ce)

    def download(granule: dict[str, str]) -> Path:
        return _fetch(f"{granule['opendap_url']}.dap.nc4", token, get, subsets / f"{granule['month']}.nc4",
                      params={"dap4.ce": ce})

    with ThreadPoolExecutor(max_workers=workers) as pool:
        files = list(pool.map(download, granules))

    # Assemble a gap-free monthly cube; months with no granule stay missing (never filled).
    by_month = {g["month"]: f for g, f in zip(granules, files)}
    first, last = np.datetime64(granules[0]["month"], "M"), np.datetime64(granules[-1]["month"], "M")
    months = np.arange(first, last + np.timedelta64(1, "M"))
    lat, lon, sample = read_subset(files[0], spec)
    cube = np.full((len(months), *sample.shape), np.nan)
    for i, month in enumerate(months.astype(str)):
        if month in by_month:
            m_lat, m_lon, field = read_subset(by_month[month], spec)
            if field.shape != sample.shape or not (np.allclose(m_lat, lat) and np.allclose(m_lon, lon)):
                raise ValueError(f"Grid for {month} does not match the first month's coordinates.")
            cube[i] = field
    missing = [m for m in months.astype(str) if m not in by_month]

    cube, conversion = convert_units(cube, spec)
    lat, lon, cube = coarsen(lat, lon, cube, spec.coarsen)
    steps = [
        f"Server-side subset via NASA Earthdata cloud OPeNDAP: {spec.variable} inside bbox {[west, south, east, north]}",
        f"Fill value {spec.fill_value} set to missing",
        *([conversion] if conversion else []),
        *([f"Averaged {spec.coarsen} x {spec.coarsen} blocks of cells; blocks with under half their cells valid left missing"]
          if spec.coarsen > 1 else []),
    ]

    out = root / "data" / "cache" / "grids" / f"{variable_id}__{region_id}.npz"
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, time=months.astype(str), lat=lat, lon=lon, cube=cube.astype(np.float32))
    retrieved = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    manifest_path = root / "data" / "cache" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest[f"grid:{variable_id}__{region_id}"] = {
        "source": f"NASA GES DISC {spec.short_name} {spec.version} via Earthdata cloud OPeNDAP (server-side subset)",
        "source_urls": [g["data_url"] for g in granules],
        "dataset_version": spec.version,
        "variable": spec.variable,
        "bbox": [west, south, east, north],
        "granules": len(granules),
        "missing_months": missing,
        "input_files": [{"file": f.relative_to(root).as_posix(), "sha256": _sha256(f)} for f in files],
        "file": out.relative_to(root).as_posix(),
        "sha256": _sha256(out),
        "units": spec.source_units,
        "output_units": spec.output_units,
        "processing_steps": steps,
        "retrieved": retrieved,
        "retrieval_date": retrieved[:10],
        "code_version": CODE_VERSION,
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, allow_nan=False), encoding="utf-8", newline="")
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--variable", required=True, choices=sorted(SPECS))
    parser.add_argument("--region", default="west_africa")
    parser.add_argument("--start", help="first month YYYY-MM (default: start of the record)")
    parser.add_argument("--end", default="2025-12", help="last month YYYY-MM")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args(argv)
    started = time.perf_counter()
    out = build_grid(args.variable, args.region, token=os.getenv("EARTHDATA_TOKEN", ""), start=args.start,
                     end=args.end, workers=args.workers)
    with np.load(out) as grid:
        shape = grid["cube"].shape
    print(f"Grid cached at {out.relative_to(ROOT).as_posix()}: {shape[0]} months x {shape[1]} x {shape[2]} cells "
          f"in {time.perf_counter() - started:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
