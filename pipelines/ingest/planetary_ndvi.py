"""MODIS NDVI from Microsoft Planetary Computer (STAC catalogue + cloud-optimised GeoTIFFs).

Collection ``modis-13A1-061`` is NASA LP DAAC MOD13A1 version 061: Terra, 16-day composites, 500 m. For each year:

1. search the STAC API for Terra items (ids ``MOD13A1.*``) whose tiles overlap the region box (tiles that only touch an
   edge are skipped);
2. read NDVI and pixel reliability by nearest-neighbour sampling, so every sample is one 500 m pixel with its own
   quality flag: a 0.05 deg grid over the region (for the map) and a 1/240 deg (about 463 m) grid over the series
   region (for the area series);
3. keep pixel reliability 0 (good) and 1 (marginal); drop the NDVI fill value -3000 and values outside -2000..10000;
   multiply by 0.0001 (values from the NASA product page, see docs/VERIFIED.md);
4. average the composites into calendar months by each composite's middle day (start + 8 days).

Per-year files in data/raw/planetary_computer/ make the download resumable. ``build`` turns them into the 0.5 deg grid
used by the other variables (10 x 10 blocks of 0.05 deg samples; a block needs half of them valid) and into the area
series for the series region (a month needs half of its pixels valid). Missing months stay missing (never filled).

  python -m pipelines.ingest.planetary_ndvi download --start 2000 --end 2025
  python -m pipelines.ingest.planetary_ndvi build --end 2025-12
  python -m pipelines.ingest.seed --maps && python -m pipelines.ingest.seed --series modis_ndvi__kumasi
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
import warnings
from pathlib import Path

import numpy as np

from pipelines.ingest.opendap_grid import coarsen, region_bbox

ROOT = Path(__file__).resolve().parents[2]
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"
COLLECTION = "modis-13A1-061"
PLATFORM, TERRA_ID_PREFIX = "terra", "MOD13A1."  # Aqua items are MYD13A1.*
NDVI_ASSET, RELIABILITY_ASSET = "500m_16_days_NDVI", "500m_16_days_pixel_reliability"
NDVI_FILL, NDVI_VALID, SCALE = -3000, (-2000, 10000), 0.0001
RELIABILITY_FILL, RELIABILITY_KEEP = -1, (0, 1)  # 0 good, 1 marginal; 2 snow/ice and 3 cloudy are dropped
GRID_DEG, SERIES_DEG, BLOCK = 0.05, 1 / 240, 10  # 10 x 0.05 deg = the 0.5 deg cells of the rainfall grid
PRODUCT_PAGE = "https://lpdaac.usgs.gov/products/mod13a1v061/"
DOI_URL = "https://doi.org/10.5067/MODIS/MOD13A1.061"
VARIABLE_ID = "modis_ndvi"
DEFAULT_CODE_VERSION = os.getenv("CODE_VERSION", "0.1.0")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _overlaps(item_bbox: list[float], bbox: tuple[float, float, float, float]) -> bool:
    west, south, east, north = bbox
    return item_bbox[0] < east and item_bbox[2] > west and item_bbox[1] < north and item_bbox[3] > south


def mask_and_scale(ndvi: np.ndarray, reliability: np.ndarray) -> np.ndarray:
    """NDVI as float32, NaN where the pixel is fill, out of range, or not good/marginal quality."""
    valid = ((ndvi != NDVI_FILL) & (ndvi >= NDVI_VALID[0]) & (ndvi <= NDVI_VALID[1])
             & np.isin(reliability, RELIABILITY_KEEP))
    return np.where(valid, ndvi.astype(np.float32) * np.float32(SCALE), np.float32(np.nan))


def monthly_means(starts: list[str], fields: np.ndarray) -> tuple[list[str], np.ndarray]:
    """Average 16-day composites into calendar months by each composite's middle day (start + 8 days)."""
    months = [str(np.datetime64(s, "D") + np.timedelta64(8, "D"))[:7] for s in starts]
    out_months = sorted(set(months))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN months stay NaN
        cube = np.stack([np.nanmean(fields[[i for i, m in enumerate(months) if m == month]], axis=0)
                         for month in out_months]).astype(np.float32)
    return out_months, cube


def _load(items: list, bbox: tuple[float, float, float, float], resolution: float, pool: int):
    """(composite start dates, lat ascending, lon, masked NDVI) for the items, sampled on a regular lat/lon grid."""
    import odc.stac
    from odc.geo.geobox import GeoBox

    geobox = GeoBox.from_bbox(bbox, crs="epsg:4326", resolution=resolution)
    nodata = {COLLECTION: {"assets": {NDVI_ASSET: {"nodata": NDVI_FILL}, RELIABILITY_ASSET: {"nodata": RELIABILITY_FILL}}}}
    ds = odc.stac.load(items, bands=[NDVI_ASSET, RELIABILITY_ASSET], geobox=geobox, resampling="nearest",
                       groupby="start_datetime", stac_cfg=nodata, pool=pool)
    starts = [str(t)[:10] for t in ds["time"].values]
    fields = mask_and_scale(ds[NDVI_ASSET].values, ds[RELIABILITY_ASSET].values)
    lat, lon = ds["latitude"].values.round(6), ds["longitude"].values.round(6)
    order = np.argsort(lat)  # ascending latitude, as in the other grids
    return starts, lat[order], lon, fields[:, order, :]


def download_year(year: int, bbox: tuple, series_bbox: tuple, raw_dir: Path, pool: int = 16) -> Path:
    """Read one year of composites and write <raw_dir>/<year>.npz, <year>.series.npz and <year>.items.json."""
    out = raw_dir / f"{year}.npz"
    if out.exists() and (raw_dir / f"{year}.series.npz").exists() and (raw_dir / f"{year}.items.json").exists():
        return out
    import odc.stac
    import planetary_computer
    import pystac_client

    odc.stac.configure_rio(cloud_defaults=True)
    catalog = pystac_client.Client.open(STAC_URL, modifier=planetary_computer.sign_inplace)
    # Select Terra by item id, not by the `platform` property: many 2002, 2024 and 2025 items lack that property.
    search = catalog.search(collections=[COLLECTION], bbox=list(bbox), datetime=f"{year}-01-01/{year}-12-31")
    items = [i for i in search.items() if i.id.startswith(TERRA_ID_PREFIX)
             and i.properties["start_datetime"].startswith(str(year)) and _overlaps(i.bbox, bbox)]
    if not items:
        raise ValueError(f"No {COLLECTION} {PLATFORM} items for {year} over {bbox}.")
    series_items = [i for i in items if _overlaps(i.bbox, series_bbox)]
    raw_dir.mkdir(parents=True, exist_ok=True)
    for label, chosen, box, resolution in (("", items, bbox, GRID_DEG), (".series", series_items, series_bbox, SERIES_DEG)):
        starts, lat, lon, fields = _load(chosen, box, resolution, pool)
        months, cube = monthly_means(starts, fields)
        valid = np.isfinite(fields).sum(axis=(1, 2))
        np.savez_compressed(raw_dir / f"{year}{label}.npz", time=np.array(months), lat=lat, lon=lon, cube=cube,
                            composites=np.array(starts), composite_valid=valid)
    retrieved = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    record = {"collection": COLLECTION, "platform": PLATFORM, "year": year, "bbox": list(bbox), "retrieved": retrieved,
              "items": sorted(i.id for i in items), "series_items": sorted(i.id for i in series_items),
              "assets": sorted(i.assets[NDVI_ASSET].href.split("?")[0] for i in items)}
    (raw_dir / f"{year}.items.json").write_text(json.dumps(record, indent=1), encoding="utf-8", newline="")
    return out


def _stack(raw_dir: Path, suffix: str, end: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    files = sorted(p for p in raw_dir.glob(f"[0-9][0-9][0-9][0-9]{suffix}.npz") if p.name.count(".") == suffix.count(".") + 1)
    if not files:
        raise FileNotFoundError(f"No downloaded years in {raw_dir}; run the download step first.")
    times, cubes = [], []
    for path in files:
        with np.load(path) as part:
            times.extend(part["time"].tolist())
            cubes.append(part["cube"])
            lat, lon = part["lat"], part["lon"]
    time, cube = np.array(times, dtype="datetime64[M]"), np.concatenate(cubes)
    keep = time <= np.datetime64(end, "M")
    time, cube = time[keep], cube[keep]
    axis = np.arange(time[0], time[-1] + np.timedelta64(1, "M"))  # gap-free; months without composites stay NaN
    full = np.full((axis.size, *cube.shape[1:]), np.nan, dtype=np.float32)
    full[np.searchsorted(axis, time)] = cube
    return axis, lat, lon, full


def area_series(cube: np.ndarray, min_fraction: float = 0.5) -> tuple[np.ndarray, np.ndarray]:
    """Monthly mean over all pixels and the valid-pixel count; NaN when fewer than min_fraction are valid."""
    valid = np.isfinite(cube).sum(axis=(1, 2))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        mean = np.nanmean(cube, axis=(1, 2))
    return np.where(valid >= min_fraction * cube[0].size, mean, np.nan), valid


def build(region_id: str = "west_africa", series_region_id: str = "kumasi", end: str = "2025-12",
          root: Path = ROOT, code_version: str = DEFAULT_CODE_VERSION) -> dict:
    """Write the 0.5 deg grid, the series' area statistics and normalized CSV, and their manifest entries."""
    raw_dir = root / "data" / "raw" / "planetary_computer" / f"{VARIABLE_ID}__{region_id}"
    bbox = region_bbox(region_id, root / "data" / "regions" / "presets.geojson")
    series_bbox = region_bbox(series_region_id, root / "data" / "regions" / "presets.geojson")
    records = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(raw_dir.glob("*.items.json"))]
    retrieved = max(r["retrieved"] for r in records)

    time, lat, lon, fine = _stack(raw_dir, "", end)
    glat, glon, grid = coarsen(lat, lon, fine, BLOCK)
    grid_path = root / "data" / "cache" / "grids" / f"{VARIABLE_ID}__{region_id}.npz"
    grid_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(grid_path, time=time.astype(str), lat=glat.round(6), lon=glon.round(6), cube=grid.astype(np.float32))

    s_time, s_lat, s_lon, s_cube = _stack(raw_dir, ".series", end)
    mean, valid = area_series(s_cube)
    stats_path = root / "data" / "raw" / f"{VARIABLE_ID}__{series_region_id}.areastats.csv"
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(["time", "mean_ndvi", "valid_pixels", "total_pixels"])
    for month, m, v in zip(s_time.astype(str), mean, valid):
        writer.writerow([month, "" if not np.isfinite(m) else f"{m:.6f}", int(v), s_cube[0].size])
    stats_path.write_text(buffer.getvalue(), encoding="utf-8", newline="")
    normalized = root / "data" / "raw" / f"{VARIABLE_ID}__{series_region_id}.csv"
    normalized.write_text("time,value\n" + "".join(f"{t},{'' if not np.isfinite(m) else f'{m:.6f}'}\n"
                                                    for t, m in zip(s_time.astype(str), mean)), encoding="utf-8", newline="")

    source = (f"Microsoft Planetary Computer STAC collection {COLLECTION}: NASA LP DAAC MOD13A1 version 061 "
              f"(MODIS {PLATFORM.title()} 16-day vegetation indices, 500 m)")
    common = {
        "source": source, "source_urls": [f"{STAC_URL}/collections/{COLLECTION}", PRODUCT_PAGE, DOI_URL],
        "collection_id": COLLECTION, "product": "MOD13A1", "dataset_version": "061", "platform": PLATFORM,
        "variable": NDVI_ASSET, "quality_layer": RELIABILITY_ASSET, "units": "index", "output_units": "index",
        "retrieved": retrieved, "retrieval_date": retrieved[:10], "code_version": code_version,
        "stac_items": len({i for r in records for i in r["items"]}),
    }
    masking = (f"Kept pixel reliability {list(RELIABILITY_KEEP)} (good, marginal); dropped NDVI fill {NDVI_FILL} and "
               f"values outside {NDVI_VALID[0]}..{NDVI_VALID[1]}; multiplied by {SCALE}.")
    monthly = "16-day composites averaged into calendar months by each composite's middle day (start + 8 days)."
    year_files = sorted(raw_dir.glob("[0-9][0-9][0-9][0-9].npz")) + sorted(raw_dir.glob("*.items.json"))
    series_files = sorted(raw_dir.glob("*.series.npz"))
    manifest_path = root / "data" / "cache" / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    grid_missing = [str(t) for t, block in zip(time, grid) if not np.isfinite(block).any()]
    manifest[f"grid:{VARIABLE_ID}__{region_id}"] = {
        **common, "bbox": list(bbox), "file": grid_path.relative_to(root).as_posix(), "sha256": _sha256(grid_path),
        "missing_months": grid_missing,
        "input_files": [{"file": p.relative_to(root).as_posix(), "sha256": _sha256(p)} for p in year_files],
        "processing_steps": [
            f"STAC search of {COLLECTION} ({PLATFORM}) for tiles overlapping bbox {list(bbox)}; NDVI and "
            f"{RELIABILITY_ASSET} read from the cloud-optimised GeoTIFFs by nearest-neighbour sampling every {GRID_DEG} deg.",
            masking, monthly,
            f"Averaged {BLOCK} x {BLOCK} blocks of {GRID_DEG} deg samples into 0.5 deg cells; blocks with under half "
            "their samples valid left missing.",
        ],
    }
    series_missing = [str(t) for t, m in zip(s_time, mean) if not np.isfinite(m)]
    manifest[f"{VARIABLE_ID}__{series_region_id}"] = {
        **common, "file": stats_path.relative_to(root).as_posix(), "input_file_name": stats_path.name,
        "sha256": _sha256(stats_path), "bbox": list(series_bbox), "missing_months": series_missing,
        "n_months": int(np.isfinite(mean).sum()), "pixels_per_month": int(s_cube[0].size),
        "input_files": [{"file": p.relative_to(root).as_posix(), "sha256": _sha256(p)} for p in series_files],
        "processing_steps": [
            f"NDVI and {RELIABILITY_ASSET} read over the {series_region_id} preset box {list(series_bbox)} every "
            f"{SERIES_DEG:.6f} deg (about one 500 m pixel per sample, {s_cube[0].size} samples).",
            masking, monthly,
            "Monthly area mean over the box; a month needs at least half of its samples valid, otherwise it is missing.",
        ],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2, allow_nan=False), encoding="utf-8", newline="")
    return {"grid": grid_path, "grid_months": int(time.size), "grid_missing": grid_missing,
            "series": normalized, "series_missing": series_missing}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("step", choices=["download", "build"])
    parser.add_argument("--region", default="west_africa")
    parser.add_argument("--series-region", default="kumasi")
    parser.add_argument("--start", type=int, default=2000)
    parser.add_argument("--end", default="2025-12", help="last month for build (YYYY-MM); last year for download")
    parser.add_argument("--pool", type=int, default=16, help="parallel reads")
    args = parser.parse_args(argv)
    presets = ROOT / "data" / "regions" / "presets.geojson"
    raw_dir = ROOT / "data" / "raw" / "planetary_computer" / f"{VARIABLE_ID}__{args.region}"
    if args.step == "download":
        bbox, series_bbox = region_bbox(args.region, presets), region_bbox(args.series_region, presets)
        for year in range(args.start, int(args.end[:4]) + 1):
            started = dt.datetime.now()
            download_year(year, bbox, series_bbox, raw_dir, pool=args.pool)
            print(f"{year}: done in {(dt.datetime.now() - started).total_seconds():.0f}s", flush=True)
        return 0
    result = build(args.region, args.series_region, args.end)
    print(json.dumps({k: (v.relative_to(ROOT).as_posix() if isinstance(v, Path) else v) for k, v in result.items()}, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
