"""Import one layer of a NASA AppEEARS area-statistics CSV as a normalized monthly series.

The export's File Name column names the product, version and layer, e.g.
``MOD13A3_061__1_km_monthly_EVI_doy2000032000000_aid0001``. The operator states which layer the series
must hold (``--layer``) and any other layer is rejected, so an EVI export cannot be filed as NDVI.
Months absent from the export are written with an empty value (never filled). The cached result is then
built with ``python -m pipelines.ingest.seed --series <variable>__<region>``.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import io
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE_URL = "https://appeears.earthdatacloud.nasa.gov/"
DEFAULT_CODE_VERSION = os.getenv("CODE_VERSION", "0.1.0")
_ID = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
_FILE_NAME = re.compile(r"^(?P<product>[A-Z0-9]+)_(?P<version>\d{3})_(?P<layer>_.+?)_doy\d{13}_")
_MONTH = re.compile(r"^\d{4}-\d{2}")
_REQUIRED = ("File Name", "Dataset", "Date", "Mean")


def read_area_statistics(content: bytes) -> dict:
    """Product, version, layer, months and monthly means from one AppEEARS area-statistics CSV."""
    rows = list(csv.DictReader(io.StringIO(content.decode("utf-8-sig"), newline="")))
    if not rows or any(column not in rows[0] for column in _REQUIRED):
        raise ValueError(f"AppEEARS area statistics need the columns: {', '.join(_REQUIRED)}.")
    layers = set()
    for row in rows:
        match = _FILE_NAME.match(row["File Name"])
        if not match or match["layer"] != row["Dataset"] or not _MONTH.match(row["Date"]):
            raise ValueError(f"Unrecognised AppEEARS row: {row['File Name']!r}, {row['Date']!r}")
        layers.add((match["product"], match["version"], match["layer"]))
    if len(layers) != 1:
        raise ValueError(f"Expected one product layer per export, found {sorted(layers)}.")
    months = [row["Date"][:7] for row in rows]
    if len(set(months)) != len(months):
        raise ValueError("The AppEEARS export repeats a month.")
    product, version, layer = layers.pop()
    values = [float(row["Mean"]) if row["Mean"].strip() else None for row in rows]
    return {"product": product, "version": version, "layer": layer, "months": months, "values": values}


def _month_axis(months: list[str]) -> list[str]:
    index = sorted(int(m[:4]) * 12 + int(m[5:7]) - 1 for m in months)
    return [f"{i // 12:04d}-{i % 12 + 1:02d}" for i in range(index[0], index[-1] + 1)]


def import_appeears_csv(
    csv_path: str | Path,
    variable_id: str,
    region_id: str,
    *,
    layer: str,
    retrieved: str,
    units: str = "index",
    area_note: str | None = None,
    raw_dir: str | Path | None = None,
    cache_dir: str | Path | None = None,
    root: Path = ROOT,
    code_version: str = DEFAULT_CODE_VERSION,
) -> Path:
    """Write ``<raw>/<variable>__<region>.csv`` and its manifest entry; return the normalized file."""
    for label, value in (("variable_id", variable_id), ("region_id", region_id)):
        if not _ID.fullmatch(value):
            raise ValueError(f"{label} must contain only lowercase letters, digits, '_' or '-'.")
    retrieval_date = dt.date.fromisoformat(retrieved[:10]).isoformat()  # from the download record, not the clock
    source = Path(csv_path)
    content = source.read_bytes()
    stats = read_area_statistics(content)
    if stats["layer"] != layer:
        raise ValueError(f"The export holds layer {stats['layer']}, not {layer}; import it under a variable for that layer.")

    by_month = dict(zip(stats["months"], stats["values"]))
    axis = _month_axis(stats["months"])
    missing = [m for m in axis if by_month.get(m) is None]
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(["time", "value"])
    for month in axis:
        value = by_month.get(month)
        writer.writerow([month, "" if value is None else f"{value:.12g}"])

    raw_root = Path(raw_dir) if raw_dir is not None else root / "data" / "raw"
    cache_root = Path(cache_dir) if cache_dir is not None else root / "data" / "cache"
    stem = f"{variable_id}__{region_id}"
    normalized = raw_root / f"{stem}.csv"
    normalized.parent.mkdir(parents=True, exist_ok=True)
    normalized.write_text(buffer.getvalue(), encoding="utf-8", newline="")  # identical bytes on every OS

    manifest_path = cache_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    product_layer = f"{stats['product']}.{stats['version']} layer {stats['layer']}"
    manifest[stem] = {
        "source": SOURCE_URL,
        "source_urls": [SOURCE_URL],
        "product": stats["product"],
        "dataset_version": stats["version"],
        "layer": stats["layer"],
        "file": source.resolve().relative_to(root.resolve()).as_posix(),
        "input_file_name": source.name,
        "sha256": hashlib.sha256(content).hexdigest(),
        "retrieved": retrieved,
        "retrieval_date": retrieval_date,
        "code_version": code_version,
        "units": units,
        "output_units": units,
        "processing_steps": [
            f"Monthly area mean (column Mean) of {product_layer} from a NASA AppEEARS area-statistics export.",
            *([area_note] if area_note else []),
            "Values used as exported; they are already on the index scale (no further scale factor applied).",
            *([f"{len(missing)} months absent from the export were left missing (never filled)."] if missing else []),
        ],
        "missing_months": missing,
        "n_months": len(axis) - len(missing),
    }
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, allow_nan=False), encoding="utf-8", newline="")
    return normalized


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True, help="AppEEARS area-statistics CSV (inside the repo)")
    parser.add_argument("--variable", required=True, help="catalog variable id, e.g. modis_evi")
    parser.add_argument("--region", required=True, help="preset region id, e.g. kumasi")
    parser.add_argument("--layer", required=True, help="layer the export must hold, e.g. _1_km_monthly_EVI")
    parser.add_argument("--retrieved", required=True, help="download time from the AppEEARS record (ISO-8601)")
    parser.add_argument("--units", default="index", help="units of the layer (default: index)")
    parser.add_argument("--area-note", help="processing step describing the requested area")
    args = parser.parse_args(argv)
    path = import_appeears_csv(args.csv, args.variable, args.region, layer=args.layer, retrieved=args.retrieved,
                               units=args.units, area_note=args.area_note)
    print(f"Normalized series written to {path.relative_to(ROOT).as_posix()}; "
          f"now run: python -m pipelines.ingest.seed --series {args.variable}__{args.region}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
