"""Build API caches from locally ingested, provenance-checked NASA inputs only."""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import os
import resource
import sys
import time
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "stats_engine"))

from stats_engine import (  # noqa: E402
    MonthlySeries, analyze_series, annual_cube, benjamini_hochberg, cell_weights,
    opposite_trends, pixel_trends, regional_series,
)

CACHE = ROOT / "data" / "cache"
RAW = ROOT / "data" / "raw"
CODE_VERSION = os.getenv("CODE_VERSION", "0.1.0")
MAX_MAP_CELLS = 10_000
MAX_INPUT_GRID_CELLS = 25_000
MAX_INPUT_MONTHS = 600
PIXEL_CHUNK_SIZE = 512


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _npy_shape_size(archive: zipfile.ZipFile, name: str) -> tuple[tuple[int, ...], int]:
    with archive.open(f"{name}.npy") as stream:
        version = np.lib.format.read_magic(stream)
        if version == (1, 0):
            shape, _fortran_order, dtype = np.lib.format.read_array_header_1_0(stream)
        else:
            shape, _fortran_order, dtype = np.lib.format.read_array_header_2_0(stream)
    return shape, np.dtype(dtype).itemsize


def _manifest() -> dict:
    path = CACHE / "manifest.json"
    if not path.is_file():
        raise FileNotFoundError(f"Provenance manifest is missing: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Provenance manifest must be a JSON object: {path}")
    return data


def _write_manifest(data: dict) -> None:
    path = CACHE / "manifest.json"
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, allow_nan=False), encoding="utf-8")
    tmp.replace(path)


def _validate_date(value: object, description: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{description} is required in the cache manifest.")
    candidate = value[:10]
    try:
        dt.date.fromisoformat(candidate)
    except ValueError as exc:
        raise ValueError(f"{description} must contain an ISO date (YYYY-MM-DD).") from exc
    return candidate


def _source_urls(entry: dict) -> list[str]:
    values = entry.get("source_urls") or [entry.get("source_url") or entry.get("source") or entry.get("url")]
    urls = [value for value in values if isinstance(value, str)]
    if not urls or any(urlparse(url).scheme != "https" or not urlparse(url).netloc for url in urls):
        raise ValueError("Each real cache input must record one or more HTTPS source URLs.")
    return sorted(set(urls))


def _validate_common_provenance(entry: dict, label: str) -> tuple[list[str], str]:
    if not isinstance(entry, dict):
        raise ValueError(f"Missing provenance entry for {label}.")
    urls = _source_urls(entry)
    retrieval_date = _validate_date(entry.get("retrieval_date") or entry.get("retrieved"), f"{label} retrieval date")
    if not isinstance(entry.get("code_version"), str) or not entry["code_version"].strip():
        raise ValueError(f"{label} code_version is required in the cache manifest.")
    return urls, retrieval_date


def _series_inputs() -> list[tuple[Path, dict, list[str], str]]:
    entries = _manifest()
    paths = sorted(p for p in RAW.glob("*__*.csv") if not p.name.endswith(".giovanni.csv"))
    if not paths:
        raise FileNotFoundError(f"No normalized real monthly series found in {RAW}.")
    sources = []
    for path in paths:
        entry = entries.get(path.stem)
        urls, retrieval_date = _validate_common_provenance(entry, path.stem)
        source_path = ROOT / entry.get("file", "")
        if not source_path.is_file() or not entry.get("sha256"):
            raise ValueError(f"{path.stem} requires an existing source file and SHA-256 in data/cache/manifest.json.")
        if _sha256(source_path) != entry["sha256"]:
            raise ValueError(f"Source checksum mismatch for {path.stem}: {source_path}.")
        sources.append((path, entry, urls, retrieval_date))
    return sources


def _peak_rss_bytes() -> int:
    value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return int(value if sys.platform == "darwin" else value * 1024)


def seed_series(horizon_sims: int = 1000) -> dict[str, float | int]:
    started = time.perf_counter()
    before = _peak_rss_bytes()
    out_dir = CACHE / "results"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = _manifest()
    sources = _series_inputs()
    built = 0
    for path, entry, urls, retrieval_date in sources:
        with path.open(newline="", encoding="utf-8") as stream:
            rows = list(csv.DictReader(stream))
        if not rows or not {"time", "value"}.issubset(rows[0]):
            raise ValueError(f"{path} must contain time,value columns.")
        try:
            series = MonthlySeries(
                np.array([row["time"] for row in rows], dtype="datetime64[M]"),
                np.array([float(row["value"]) if row["value"] else np.nan for row in rows]),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(f"Invalid normalized monthly series: {path}") from exc
        result = analyze_series(series, horizon_sims=horizon_sims)
        output_path = out_dir / f"{path.stem}.json"
        output_path.write_text(json.dumps(result, allow_nan=False, separators=(",", ":")), encoding="utf-8")
        manifest[path.stem] = {
            **entry,
            "source_urls": urls,
            "retrieval_date": retrieval_date,
            "ingest_code_version": entry.get("code_version"),
            "code_version": CODE_VERSION,
            "normalized_file": str(path.relative_to(ROOT)),
            "normalized_file_sha256": _sha256(path),
            "cache_file": str(output_path.relative_to(ROOT)),
            "cache_sha256": _sha256(output_path),
            "seed_horizon_sims": horizon_sims,
        }
        built += 1
        print(f"series {path.stem}: built from verified local source file")
    _write_manifest(manifest)
    return {"series_count": built, "runtime_seconds": time.perf_counter() - started,
            "peak_memory_bytes": max(before, _peak_rss_bytes())}


def _grid_metadata(path: Path, entries: dict) -> tuple[dict, list[str], str]:
    key = f"grid:{path.stem}"
    entry = entries.get(key)
    urls, retrieval_date = _validate_common_provenance(entry, path.stem)
    if entry.get("sha256") != _sha256(path):
        raise ValueError(f"Grid cache checksum mismatch or missing for {path.name}.")
    if not entry.get("input_files") or any(not item.get("sha256") for item in entry["input_files"]):
        raise ValueError(f"Grid provenance must include checksums for its downloaded source files: {path.name}.")
    for item in entry["input_files"]:
        source_path = ROOT / item.get("file", "")
        if not source_path.is_file() or _sha256(source_path) != item["sha256"]:
            raise ValueError(f"Grid source file is missing or has a checksum mismatch: {item.get('file')}.")
    return entry, urls, retrieval_date


def _guard_grid_archive(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        try:
            time_shape, _ = _npy_shape_size(archive, "time")
            lat_shape, _ = _npy_shape_size(archive, "lat")
            lon_shape, _ = _npy_shape_size(archive, "lon")
            cube_shape, _ = _npy_shape_size(archive, "cube")
        except (KeyError, zipfile.BadZipFile, ValueError) as exc:
            raise ValueError(f"Grid cache {path.name} must contain readable time, lat, lon, and cube arrays.") from exc
    if len(time_shape) != 1 or len(lat_shape) != 1 or len(lon_shape) != 1 or len(cube_shape) != 3:
        raise ValueError(f"Grid cache {path.name} has invalid array dimensions.")
    n_time, n_lat, n_lon = time_shape[0], lat_shape[0], lon_shape[0]
    if cube_shape != (n_time, n_lat, n_lon):
        raise ValueError(f"Grid cache {path.name} cube shape does not match its coordinates.")
    if n_lat * n_lon > MAX_INPUT_GRID_CELLS:
        raise ValueError(f"Grid cache {path.name} exceeds the {MAX_INPUT_GRID_CELLS}-cell input limit.")
    if n_time > MAX_INPUT_MONTHS:
        raise ValueError(f"Grid cache {path.name} exceeds the {MAX_INPUT_MONTHS}-month input limit.")


def seed_maps(q: float = 0.10, max_cells: int = MAX_MAP_CELLS) -> dict[str, float | int]:
    if isinstance(max_cells, bool) or not isinstance(max_cells, int) or max_cells < 1:
        raise ValueError("max_cells must be a positive integer.")
    max_cells = min(max_cells, MAX_MAP_CELLS)
    started = time.perf_counter()
    before = _peak_rss_bytes()
    out_dir = CACHE / "maps"
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = _manifest()
    paths = sorted((CACHE / "grids").glob("*.npz"))
    built = 0
    for path in paths:
        source, urls, retrieval_date = _grid_metadata(path, entries)
        _guard_grid_archive(path)
        with np.load(path) as grid:
            time_axis = grid["time"].astype("datetime64[M]")
            lat, lon = grid["lat"].astype(float), grid["lon"].astype(float)
            cube = grid["cube"].astype(float)
        if cube.shape != (len(time_axis), len(lat), len(lon)):
            raise ValueError(f"Grid dimensions do not match coordinates in {path.name}.")
        step = max(1, int(np.ceil(np.sqrt(cube.shape[1] * cube.shape[2] / max_cells))))
        lat_d, lon_d, cube_d = lat[::step], lon[::step], cube[:, ::step, ::step]
        years, annual = annual_cube(time_axis, cube_d)
        trends = pixel_trends(years, annual, chunk_size=PIXEL_CHUNK_SIZE)
        significant = benjamini_hochberg(trends["p"], q)
        weights = cell_weights(lat_d, significant.shape)
        opposite = opposite_trends(trends["slope_per_decade"], significant, weights)
        clusters = {}
        for name in ("rising", "falling"):
            selected = opposite[name]
            if selected is None:
                clusters[name] = None
                continue
            series = regional_series(cube_d, selected["mask"], weights)
            result = analyze_series(MonthlySeries(time_axis, series), compute_horizon=False)
            clusters[name] = {"cells": selected["cells"], "mask_indices": np.argwhere(selected["mask"]).tolist(),
                              "result": result}

        def clean(values):
            return [[None if not np.isfinite(value) else round(float(value), 5) for value in row] for row in values]

        payload = {
            "grid": {"lat": lat_d.round(4).tolist(), "lon": lon_d.round(4).tolist(), "downsample_step": step},
            "slope_per_decade": clean(trends["slope_per_decade"]),
            "p": clean(trends["p"]),
            "fdr_significant": significant.astype(int).tolist(),
            "fdr_level": q,
            "method": "Sen slope and Mann-Kendall on annual means per pixel; Benjamini-Hochberg FDR (Wilks 2016).",
            "opposite_trends": {
                "found": opposite["found"], "rising_share": opposite["rising_share"],
                "falling_share": opposite["falling_share"], "divergence_score": opposite["divergence_score"],
                "clusters": clusters,
                "sentence": "The same variable is rising in some places and falling in others in this region."
                if opposite["found"] else "No opposite trends found: significant changes here all point the same way, or there are none.",
            },
        }
        output_path = out_dir / f"{path.stem}.json"
        output_path.write_text(json.dumps(payload, allow_nan=False, separators=(",", ":")), encoding="utf-8")
        entries[f"map:{path.stem}"] = {
            "source_urls": urls,
            "source_grid": str(path.relative_to(ROOT)),
            "source_grid_sha256": _sha256(path),
            "source_retrieval_date": retrieval_date,
            "source_code_version": source["code_version"],
            "cache_file": str(output_path.relative_to(ROOT)),
            "cache_sha256": _sha256(output_path),
            "code_version": CODE_VERSION,
            "retrieval_date": retrieval_date,
            "max_map_cells": max_cells,
            "downsample_step": step,
            "fdr_level": q,
        }
        built += 1
        print(f"map {path.stem}: {lat_d.size * lon_d.size} cells (limit {max_cells}); generated trend and opposite-trend payload")
    _write_manifest(entries)
    return {"map_count": built, "runtime_seconds": time.perf_counter() - started,
            "peak_memory_bytes": max(before, _peak_rss_bytes())}


def main() -> None:
    overall_start = time.perf_counter()
    series = seed_series()
    maps = seed_maps()
    print(json.dumps({"series": series, "maps": maps, "runtime_seconds": time.perf_counter() - overall_start,
                      "peak_memory_bytes": max(series["peak_memory_bytes"], maps["peak_memory_bytes"]),
                      "map_input_available": maps["map_count"] > 0}, indent=2))
    if maps["map_count"] == 0:
        print("No provenance-verified gridded input was present; point-sampling grids and trend maps were not fabricated.")


if __name__ == "__main__":
    main()
