"""Data loaders: NASA POWER (no login), Giovanni CSV exports, and gridded files via earthaccess.

Run on a team laptop with internet. Every loader returns month-start times and
float values (NaN = missing) and writes a raw CSV + a manifest entry so the
provenance panel can show where each number came from.

NOT tested against live services in the starter repo (the build sandbox had
no NASA access). DATA owner: run each one once on Saturday morning and fix
units/variable names against CMR, then update data/catalog/VERIFIED.md.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
MANIFEST = ROOT / "data" / "cache" / "manifest.json"
CODE_VERSION = os.getenv("CODE_VERSION", "0.1.0")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write_raw(variable: str, region: str, time: np.ndarray, values: np.ndarray, source: dict) -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f"{variable}__{region}.csv"
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["time", "value"])
        for t, v in zip(time, values):
            w.writerow([str(t), "" if not np.isfinite(v) else f"{v:.6f}"])
    digest = _sha256_file(path)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    retrieved = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    source_url = source.get("source_url") or source.get("url")
    source_urls = source.get("source_urls") or ([source_url] if isinstance(source_url, str) else [])
    manifest[f"{variable}__{region}"] = {
        **source,
        "source_urls": source_urls,
        "file": path.relative_to(ROOT).as_posix(),
        "sha256": digest,
        "retrieved": retrieved,
        "retrieval_date": retrieved[:10],
        "code_version": CODE_VERSION,
        "n_months": int(len(values)),
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8", newline="")
    return path


# ---------------------------------------------------------------------------
# NASA POWER (fallback, point data, no login)
# ---------------------------------------------------------------------------
POWER_URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"


def fetch_power(variable_id: str, region: str, lat: float, lon: float, parameter: str, start: int, end: int) -> Path:
    """Monthly point series from NASA POWER. parameter e.g. T2M (degC) or PRECTOTCORR (check units)."""
    import requests

    r = requests.get(
        POWER_URL,
        params={"parameters": parameter, "community": "AG", "latitude": lat, "longitude": lon, "start": start, "end": end, "format": "JSON"},
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()["properties"]["parameter"][parameter]
    fill = r.json().get("header", {}).get("fill_value", -999)
    times, vals = [], []
    for key in sorted(data):
        month = int(key[4:])
        if month == 13:  # POWER adds an annual value as month 13
            continue
        times.append(np.datetime64(f"{key[:4]}-{key[4:]}", "M"))
        v = float(data[key])
        vals.append(np.nan if v == fill else v)
    return _write_raw(
        variable_id, region, np.array(times), np.array(vals),
        {"source": "NASA POWER", "parameter": parameter, "lat": lat, "lon": lon, "url": POWER_URL, "note": "fallback source"},
    )


# ---------------------------------------------------------------------------
# Giovanni "Time Series, Area-Averaged" CSV exported from the web UI
# ---------------------------------------------------------------------------
def load_giovanni_csv(path: str | Path, variable_id: str, region: str, scale: float = 1.0, offset: float = 0.0) -> Path:
    """Parse a Giovanni area-averaged CSV (metadata lines first, then time,value rows).

    scale/offset convert units, e.g. MERRA-2 K -> degC: offset=-273.15.
    Daily values are averaged to months (a month needs >= 20 valid days).
    """
    rows: list[tuple[np.datetime64, float]] = []
    meta: list[str] = []
    with open(path, newline="") as f:
        for line in csv.reader(f):
            if len(line) < 2:
                meta.append(",".join(line))
                continue
            try:
                t = np.datetime64(line[0].strip()[:10])
                v = float(line[1])
            except ValueError:
                meta.append(",".join(line))
                continue
            rows.append((t, np.nan if v <= -9999 else v * scale + offset))
    if not rows:
        raise ValueError(f"No data rows found in {path}")
    months = np.array([r[0].astype("datetime64[M]") for r in rows])
    vals = np.array([r[1] for r in rows])
    uniq = np.unique(months)
    if len(uniq) == len(months):
        out = vals
    else:
        out = np.array([np.nanmean(vals[months == m]) if np.isfinite(vals[months == m]).sum() >= 20 else np.nan for m in uniq])
    return _write_raw(variable_id, region, uniq, out, {"source": "NASA Giovanni (area-averaged CSV)", "giovanni_header": meta[:12]})


# ---------------------------------------------------------------------------
# Gridded monthly stacks via earthaccess (for trend maps and click-a-point)
# ---------------------------------------------------------------------------
def fetch_grid_earthaccess(
    variable_id: str, region: str, short_name: str, var_name: str,
    bbox: tuple[float, float, float, float], start: str, end: str,
    scale: float = 1.0, offset: float = 0.0,
    source_urls: list[str] | None = None,
) -> Path:
    """Download monthly granules for bbox=(west, south, east, north) and save a cube as .npz.

    Requires EARTHDATA_TOKEN or ~/.netrc. Example for GPM:
      fetch_grid_earthaccess("gpm_precip", "west_africa", "GPM_3IMERGM", "precipitation",
                             (-20, 0, 20, 20), "2000-06", "2025-12")
    Check the variable name and units in CMR first.
    """
    import earthaccess
    import xarray as xr

    earthaccess.login(strategy="environment")
    results = earthaccess.search_data(short_name=short_name, temporal=(start, end), bounding_box=bbox)
    if source_urls is None:
        discovered_urls = []
        for result in results:
            links = getattr(result, "data_links", None)
            if callable(links):
                links = links()
            if not isinstance(links, (list, tuple)):
                continue
            for link in links:
                href = link.get("href") if isinstance(link, dict) else link
                if isinstance(href, str) and urlsplit(href).scheme == "https":
                    parts = urlsplit(href)
                    discovered_urls.append(urlunsplit((parts.scheme, parts.netloc, parts.path, "", "")))
        source_urls = sorted(set(discovered_urls))
    if not source_urls or any(urlsplit(url).scheme != "https" or not urlsplit(url).netloc for url in source_urls):
        raise ValueError("Grid ingestion requires verified HTTPS source URLs from the granule metadata.")
    files = earthaccess.download(results, local_path=str(ROOT / "data" / "raw" / short_name))
    w, s, e, n = bbox
    slices, times = [], []
    for fp in sorted(files):
        try:
            ds = xr.open_dataset(fp, group="Grid") if short_name.startswith("GPM") else xr.open_dataset(fp)
        except (OSError, ValueError):
            ds = xr.open_dataset(fp)
        da = ds[var_name]
        lat_name = next(c for c in da.dims if c.lower().startswith("lat"))
        lon_name = next(c for c in da.dims if c.lower().startswith("lon"))
        da = da.sel({lat_name: slice(s, n), lon_name: slice(w, e)}).transpose(..., lat_name, lon_name)
        for t in da["time"].values if "time" in da.dims else [ds.attrs.get("time")]:
            arr = (da.sel(time=t) if "time" in da.dims else da).values.astype(float) * scale + offset
            slices.append(arr)
            times.append(np.datetime64(str(t)[:7], "M"))
        lats, lons = da[lat_name].values, da[lon_name].values
    order = np.argsort(times)
    cube = np.stack(slices)[order]
    out = ROOT / "data" / "cache" / "grids" / f"{variable_id}__{region}.npz"
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, time=np.array(times)[order].astype("datetime64[M]").astype(str), lat=lats, lon=lons, cube=cube)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    retrieved = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    input_files = [{
        "file": Path(fp).resolve().relative_to(ROOT.resolve()).as_posix(),
        "sha256": _sha256_file(Path(fp)),
    } for fp in files]
    manifest[f"grid:{variable_id}__{region}"] = {
        "source": f"NASA Earthdata {short_name}", "source_urls": source_urls,
        "variable": var_name, "bbox": bbox, "granules": len(files),
        "input_files": input_files,
        "file": out.relative_to(ROOT).as_posix(), "sha256": _sha256_file(out),
        "retrieved": retrieved, "retrieval_date": retrieved[:10], "code_version": CODE_VERSION,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8", newline="")
    return out
