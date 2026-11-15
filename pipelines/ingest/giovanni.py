"""Strict import of monthly Giovanni CSVs into the API's precomputed cache.

Expected input is a UTF-8 monthly CSV. Both a simple ``# Units: ...`` format and
Giovanni's two-column metadata preamble are supported. Units must be declared
or explicitly supplied by the operator; conversion is performed only when the
operator selects a supported output unit.
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
import sys
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "stats_engine"))

from stats_engine import MonthlySeries, analyze_series  # noqa: E402

DEFAULT_CODE_VERSION = os.getenv("CODE_VERSION", "0.1.0")
_ID = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
_MISSING = {"", "na", "nan"}
_TRACKING_PARAM = re.compile(r"^(utm_\w+|fbclid|gclid)$", re.IGNORECASE)


def _without_tracking(value: str) -> str:
    """Drop link-tracking query parameters (utm_*, fbclid, gclid) from an HTTP(S) source URL; keep the rest."""
    parts = urlsplit(value)
    if parts.scheme not in {"http", "https"} or not parts.query:
        return value
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _TRACKING_PARAM.match(k)]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query, safe=",:/"), parts.fragment))


def _month(value: str, line_number: int) -> tuple[str, int]:
    value = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}", value):
        fmt = "%Y-%m"
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        fmt = "%Y-%m-%d"
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?", value):
        try:
            parsed_dt = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError(f"Line {line_number}: invalid month timestamp {value!r}.") from exc
        if any((parsed_dt.hour, parsed_dt.minute, parsed_dt.second, parsed_dt.microsecond)):
            raise ValueError(f"Line {line_number}: monthly timestamps must identify the start of the month.")
        parsed = parsed_dt.date()
        month = f"{parsed.year:04d}-{parsed.month:02d}"
        return month, parsed.year * 12 + parsed.month - 1
    else:
        raise ValueError(f"Line {line_number}: expected a monthly date or month-start timestamp, got {value!r}.")
    try:
        parsed = dt.datetime.strptime(value, fmt).date()
    except ValueError as exc:
        raise ValueError(f"Line {line_number}: invalid month {value!r}.") from exc
    if parsed.day != 1:
        raise ValueError(f"Line {line_number}: daily timestamps are not accepted; use monthly values dated on day 1.")
    month = f"{parsed.year:04d}-{parsed.month:02d}"
    return month, parsed.year * 12 + parsed.month - 1


def _parse_csv(
    content: bytes,
    *,
    expected_units: str,
    time_column: str,
    value_column: str,
) -> tuple[list[str], np.ndarray, str, str]:
    if not expected_units.strip():
        raise ValueError("An expected unit is required; unit conversion is not inferred.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Input must be a UTF-8 CSV file.") from exc

    metadata: dict[str, str] = {}
    csv_lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            key, separator, value = stripped[1:].partition(":")
            if separator:
                normalized_key = key.strip().casefold()
                if normalized_key in {"units", "source"}:
                    if normalized_key in metadata:
                        raise ValueError(f"Duplicate #{key.strip()} metadata line.")
                    metadata[normalized_key] = value.strip()
            continue
        try:
            fields = next(csv.reader([line], strict=True))
        except csv.Error as exc:
            raise ValueError(f"Malformed CSV metadata: {exc}") from exc
        if (
            len(fields) == 2
            and fields[0].strip().endswith(":")
            and fields[0].strip().casefold() != time_column.strip().casefold()
        ):
            key, value = fields[0].strip().rstrip(":"), fields[1].strip()
            if key and key.casefold() not in metadata:
                metadata[key.casefold()] = value
            elif key and key.casefold() in metadata:
                raise ValueError(f"Duplicate metadata field {key!r}.")
            continue
        csv_lines.append(line)

    if not csv_lines:
        raise ValueError("CSV header is missing.")
    try:
        reader = csv.DictReader(io.StringIO("\n".join(csv_lines)), strict=True)
        headers = reader.fieldnames
        if not headers or any(not (header or "").strip() for header in headers):
            raise ValueError("CSV header contains an empty column name.")
        normalized = [header.strip().casefold() for header in headers]
        if len(set(normalized)) != len(normalized):
            raise ValueError("CSV header contains duplicate column names.")
        time_key = time_column.strip().casefold()
        value_key = value_column.strip().casefold()
        if time_key not in normalized or value_key not in normalized:
            raise ValueError(
                f"CSV header must contain the selected time column {time_column!r} and value column {value_column!r}; "
                f"found {headers!r}."
            )
        time_header = headers[normalized.index(time_key)]
        value_header = headers[normalized.index(value_key)]
        source_units = metadata.get("units", "")
        if not source_units:
            match = re.search(r"\(([^()]*)\)\s*$", value_header)
            source_units = match.group(1).strip() if match else ""
        if not source_units and metadata.get("title", "").casefold().find("area-averaged") >= 0:
            # Giovanni's area-averaged export omits units. --units is an explicit
            # operator declaration, validated against source metadata before use.
            source_units = expected_units.strip()
        if not source_units:
            raise ValueError("Source units are missing; add '# Units: ...' or units to the value-column header.")
        if source_units != expected_units.strip():
            raise ValueError(
                f"Source units {source_units!r} do not match expected units {expected_units.strip()!r}; "
                "no conversion was applied."
            )

        months: list[str] = []
        values: list[float] = []
        prior_index: int | None = None
        fill_key = f"fill value ({value_header.strip()})".casefold()
        fill_value: float | None = None
        if fill_key in metadata:
            try:
                fill_value = float(metadata[fill_key])
            except ValueError as exc:
                raise ValueError(f"Invalid fill value metadata for {value_header!r}.") from exc
        for row_number, row in enumerate(reader, start=2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"Line {row_number}: row has a different number of fields than the header.")
            raw_month = row.get(time_header)
            raw_value = row.get(value_header)
            if raw_month is None or raw_value is None:
                raise ValueError(f"Line {row_number}: selected time/value field is missing.")
            month, month_index = _month(raw_month, row_number)
            if prior_index is not None:
                if month_index == prior_index:
                    raise ValueError(f"Line {row_number}: duplicate month {month}.")
                if month_index < prior_index:
                    raise ValueError(f"Line {row_number}: months are not in chronological order at {month}.")
                if month_index != prior_index + 1:
                    prior_month = months[-1]
                    raise ValueError(f"Month continuity breaks between {prior_month} and {month}.")
            months.append(month)
            prior_index = month_index

            value_text = raw_value.strip()
            if value_text.casefold() in _MISSING or (
                fill_value is not None and value_text and _is_fill_value(value_text, fill_value)
            ):
                values.append(float("nan"))
                continue
            try:
                value = float(value_text)
            except ValueError as exc:
                raise ValueError(f"Line {row_number}: value {value_text!r} is not numeric or an explicit missing value.") from exc
            if not np.isfinite(value):
                raise ValueError(f"Line {row_number}: non-finite values must be represented as blank, NA, or NaN.")
            values.append(value)
    except csv.Error as exc:
        raise ValueError(f"Malformed CSV: {exc}") from exc

    if not months:
        raise ValueError("CSV contains a header but no monthly records.")
    if not np.isfinite(np.asarray(values, dtype=float)).any():
        raise ValueError("CSV contains no valid numeric monthly values.")
    source_label = _without_tracking(
        metadata.get("source") or metadata.get("url to reproduce results") or "NASA Giovanni area-averaged CSV"
    )
    return months, np.asarray(values, dtype=float), source_units, source_label


def _is_fill_value(text: str, fill_value: float) -> bool:
    try:
        return float(text) == fill_value
    except ValueError:
        return False


def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="")  # identical bytes on every OS (outputs are checksummed)


def _relative_or_name(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.name


def import_giovanni_csv(
    csv_path: str | Path,
    variable_id: str,
    region_id: str,
    *,
    expected_units: str,
    output_units: str | None = None,
    retrieved_date: str,
    retrieved_at: str | None = None,
    dataset_version: str | None = None,
    time_column: str = "time",
    value_column: str = "value",
    cache_dir: str | Path | None = None,
    raw_dir: str | Path | None = None,
    code_version: str = DEFAULT_CODE_VERSION,
) -> Path:
    """Validate a monthly Giovanni CSV, then write raw, result-cache, and manifest files.

    ``retrieved_date`` is supplied by the operator from the real download record.
    The API reads the resulting ``data/cache/results/<variable>__<region>.json``.
    """
    for label, value in (("variable_id", variable_id), ("region_id", region_id)):
        if not isinstance(value, str) or not _ID.fullmatch(value):
            raise ValueError(f"{label} must contain only lowercase letters, digits, '_' or '-'.")
    if not isinstance(retrieved_date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", retrieved_date):
        raise ValueError("retrieved_date must be an ISO date (YYYY-MM-DD) from the download record.")
    try:
        dt.date.fromisoformat(retrieved_date)
    except ValueError as exc:
        raise ValueError("retrieved_date must be an ISO date (YYYY-MM-DD) from the download record.") from exc
    if not code_version.strip():
        raise ValueError("code_version cannot be empty.")
    if retrieved_at:
        try:
            parsed_retrieved_at = dt.datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("retrieved_at must be an ISO-8601 timestamp.") from exc
        if parsed_retrieved_at.date().isoformat() != retrieved_date:
            raise ValueError("retrieved_at date must match retrieved_date.")
        if parsed_retrieved_at.tzinfo is None:
            raise ValueError("retrieved_at must include a timezone.")

    source_path = Path(csv_path)
    if not source_path.is_file():
        raise FileNotFoundError(f"Giovanni CSV does not exist: {source_path}")
    source_bytes = source_path.read_bytes()
    months, values, source_units, source_label = _parse_csv(
        source_bytes,
        expected_units=expected_units,
        time_column=time_column,
        value_column=value_column,
    )
    processing_steps: list[str] = []
    if output_units and output_units != source_units:
        if source_units == "K" and output_units in {"degC", "°C"}:
            values = values - 273.15
            processing_steps.append("Converted temperature from K to degC (subtract 273.15).")
            output_units = "degC"
        else:
            raise ValueError(f"Unsupported unit conversion: {source_units!r} to {output_units!r}.")
    else:
        output_units = source_units
    series = MonthlySeries(np.asarray(months, dtype="datetime64[M]"), values, output_units)
    result = analyze_series(series)

    cache_root = Path(cache_dir) if cache_dir is not None else ROOT / "data" / "cache"
    raw_root = Path(raw_dir) if raw_dir is not None else ROOT / "data" / "raw"
    stem = f"{variable_id}__{region_id}"
    raw_source_path = raw_root / f"{stem}.giovanni.csv"
    normalized_path = raw_root / f"{stem}.csv"
    result_path = cache_root / "results" / f"{stem}.json"
    manifest_path = cache_root / "manifest.json"

    digest = hashlib.sha256(source_bytes).hexdigest()
    normalized_buffer = io.StringIO(newline="")
    writer = csv.writer(normalized_buffer)
    writer.writerow(["time", "value"])
    for month, value in zip(months, values):
        writer.writerow([month, "" if not np.isfinite(value) else f"{value:.12g}"])

    if manifest_path.exists():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"Existing manifest is not valid JSON: {manifest_path}") from exc
        if not isinstance(manifest, dict):
            raise ValueError("Existing manifest must be a JSON object.")
    else:
        manifest = {}
    entry = {
        "source": source_label,
        "file": _relative_or_name(raw_source_path, ROOT),
        "input_file_name": source_path.name,
        "cache_file": _relative_or_name(result_path, ROOT),
        "dataset_version": dataset_version,
        "sha256": digest,
        "retrieved": retrieved_at or retrieved_date,
        "retrieval_date": retrieved_date,
        "code_version": code_version,
        "units": source_units,
        "output_units": output_units,
        "processing_steps": processing_steps,
        "n_months": len(months),
    }

    raw_source_path.parent.mkdir(parents=True, exist_ok=True)
    raw_source_path.write_bytes(source_bytes)
    _write_text(normalized_path, normalized_buffer.getvalue())
    _write_text(result_path, json.dumps(result, allow_nan=False, separators=(",", ":")))
    manifest[stem] = entry
    _write_text(manifest_path, json.dumps(manifest, indent=2, allow_nan=False))
    return result_path


def inspect_netcdf_hdf(path: str | Path) -> None:
    """Print global and variable metadata; xarray is imported only for this command."""
    source = Path(path)
    if not source.is_file():
        raise FileNotFoundError(f"Scientific data file does not exist: {source}")
    try:
        import xarray as xr
    except ImportError as exc:
        raise RuntimeError("Inspection requires xarray; install the repository's ingestion dependencies.") from exc

    dataset = None
    errors: list[str] = []
    for engine in ("netcdf4", "h5netcdf", None):
        try:
            dataset = xr.open_dataset(source, engine=engine, decode_cf=False)
            break
        except Exception as exc:  # report each backend failure if this file is unsupported
            errors.append(f"{engine or 'auto'}: {exc}")
    if dataset is None:
        raise ValueError("Could not inspect file with netCDF4, h5netcdf, or xarray auto-detection: " + " | ".join(errors))

    with dataset:
        print(f"File: {source.name}")
        print("Global attributes:")
        for key, value in dataset.attrs.items():
            print(f"  {key}: {value!r}")
        print("Variables:")
        for name, variable in dataset.variables.items():
            print(f"  {name}: dimensions={tuple(variable.dims)!r}, shape={variable.shape!r}, units={variable.attrs.get('units')!r}")
            for key, value in variable.attrs.items():
                print(f"    {key}: {value!r}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inspect", metavar="FILE", help="print NetCDF/HDF variables, dimensions, units, and attributes")
    parser.add_argument("--csv", type=Path, help="NASA Giovanni monthly area-averaged CSV to import")
    parser.add_argument("--variable", help="catalog variable id")
    parser.add_argument("--region", help="preset region id")
    parser.add_argument("--units", dest="expected_units", help="required expected unit (must match input metadata)")
    parser.add_argument("--output-units", help="optional supported output unit, e.g. degC for a K source")
    parser.add_argument("--retrieved-date", help="download retrieval date in YYYY-MM-DD form")
    parser.add_argument("--retrieved-at", help="optional exact ISO-8601 retrieval timestamp with timezone")
    parser.add_argument("--dataset-version", help="optional source dataset version verified in NASA metadata")
    parser.add_argument("--time-column", default="time", help="CSV date column (default: time)")
    parser.add_argument("--value-column", default="value", help="CSV measurement column (default: value)")
    args = parser.parse_args(argv)

    if args.inspect:
        if args.csv:
            parser.error("Use either --inspect FILE or --csv FILE, not both.")
        inspect_netcdf_hdf(args.inspect)
        return 0
    if not args.csv or not args.variable or not args.region or not args.expected_units or not args.retrieved_date:
        parser.error("CSV import requires --csv, --variable, --region, --units, and --retrieved-date.")
    result_path = import_giovanni_csv(
        args.csv,
        args.variable,
        args.region,
        expected_units=args.expected_units,
        output_units=args.output_units,
        retrieved_date=args.retrieved_date,
        retrieved_at=args.retrieved_at,
        dataset_version=args.dataset_version,
        time_column=args.time_column,
        value_column=args.value_column,
    )
    print(f"Validated monthly series cached at {result_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
