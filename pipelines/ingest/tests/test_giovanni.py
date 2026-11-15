"""Synthetic-only tests for strict Giovanni CSV ingestion and file inspection."""
from __future__ import annotations

import hashlib
import json
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from pipelines.ingest.giovanni import import_giovanni_csv, inspect_netcdf_hdf  # noqa: E402

SYNTHETIC_LABEL = "SYNTHETIC automated test input; not NASA data"
TEST_UNITS = "synthetic units"


def _months(count: int = 180) -> list[str]:
    start = date(2000, 1, 1)
    result = []
    for offset in range(count):
        month_index = start.year * 12 + start.month - 1 + offset
        result.append(f"{month_index // 12:04d}-{month_index % 12 + 1:02d}")
    return result


def _write_csv(
    path: Path,
    *,
    timestamps: list[str] | None = None,
    values: list[str] | None = None,
    header: str = "time,value",
    units_line: str | None = f"# Units: {TEST_UNITS}\n",
    source_line: str = f"# Source: {SYNTHETIC_LABEL}\n",
) -> Path:
    months = timestamps if timestamps is not None else _months()
    if values is None:
        # Deterministic trend plus seasonal cycle; test-only synthetic values.
        values = [f"{10 + 0.5 * i / 12 + 0.4 * np.sin(2 * np.pi * i / 12):.8f}" for i in range(len(months))]
    path.write_text(
        source_line + (units_line or "") + header + "\n" + "".join(f"{t},{v}\n" for t, v in zip(months, values)),
        encoding="utf-8",
    )
    return path


def _import(path: Path, tmp_path: Path, **kwargs) -> Path:
    return import_giovanni_csv(
        path,
        "test_variable",
        "test_region",
        expected_units=TEST_UNITS,
        retrieved_date="2026-11-14",
        cache_dir=tmp_path / "cache",
        raw_dir=tmp_path / "raw",
        code_version="test-code-version",
        **kwargs,
    )


def test_valid_synthetic_csv_writes_api_result_and_manifest(tmp_path):
    source = _write_csv(tmp_path / "synthetic_monthly.csv")
    output = _import(source, tmp_path)

    result = json.loads(output.read_text())
    assert output == tmp_path / "cache" / "results" / "test_variable__test_region.json"
    assert {"period", "series", "trend", "tests", "evidence_grade", "data_quality"} <= result.keys()
    assert result["period"]["n_months"] == 180

    manifest = json.loads((tmp_path / "cache" / "manifest.json").read_text())
    entry = manifest["test_variable__test_region"]
    assert entry["source"] == SYNTHETIC_LABEL
    assert entry["input_file_name"] == source.name
    assert entry["sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    assert entry["retrieval_date"] == "2026-11-14"
    assert entry["code_version"] == "test-code-version"
    assert entry["units"] == TEST_UNITS
    assert (tmp_path / "raw" / "test_variable__test_region.giovanni.csv").read_bytes() == source.read_bytes()


def test_explicit_missing_month_value_is_preserved_as_gap(tmp_path):
    months = _months()
    values = [f"{10 + 0.5 * i / 12:.8f}" for i in range(len(months))]
    values[42] = "NA"
    source = _write_csv(tmp_path / "synthetic_missing.csv", timestamps=months, values=values)

    output = _import(source, tmp_path)
    result = json.loads(output.read_text())
    assert result["data_quality"]["gaps"] == 1
    assert result["series"]["raw"][42] is None


def test_synthetic_giovanni_export_metadata_fill_value_and_selected_column(tmp_path):
    """Synthetic copy of Giovanni's observed export layout; contains no NASA values."""
    months = _months()
    values = [f"{10 + 0.5 * i / 12:.8f}" for i in range(len(months))]
    values[17] = "1000000000000000"
    source = tmp_path / "synthetic_giovanni_export.csv"
    source.write_text(
        'Title:,"Time Series, Area-Averaged (SYNTHETIC test input)"\n'
        "User Start Date:,2000-01-01T00:00:00Z\n"
        "User End Date:,2014-12-31T23:59:59Z\n"
        'User Bounding Box:,"-1.8,6.55,-1.45,6.85"\n'
        'Data Bounding Box:,"-1.875,6.5,-1.875,6.5"\n'
        "Fill Value (mean_synthetic):, 1000000000000000\n\n"
        "time, mean_synthetic\n"
        + "".join(f"{month}-01 00:00:00,{value}\n" for month, value in zip(months, values)),
        encoding="utf-8",
    )

    output = _import(
        source,
        tmp_path,
        value_column="mean_synthetic",
    )
    result = json.loads(output.read_text())
    assert result["data_quality"]["gaps"] == 1
    assert result["series"]["raw"][17] is None


def test_synthetic_kelvin_series_can_be_converted_to_catalog_celsius(tmp_path):
    months = _months()
    values = [f"{280 + i / 100:.4f}" for i in range(len(months))]
    source = _write_csv(
        tmp_path / "synthetic_kelvin.csv",
        timestamps=months,
        values=values,
        units_line="# Units: K\n",
        source_line=f"# Source: {SYNTHETIC_LABEL}\n",
    )
    output = import_giovanni_csv(
        source,
        "test_variable",
        "test_region",
        expected_units="K",
        output_units="degC",
        retrieved_date="2026-11-14",
        retrieved_at="2026-11-14T14:27:46+00:00",
        dataset_version="SYNTHETIC",
        cache_dir=tmp_path / "cache",
        raw_dir=tmp_path / "raw",
        code_version="test-code-version",
    )
    result = json.loads(output.read_text())
    assert result["series"]["raw"][0] == pytest.approx(6.85)
    manifest = json.loads((tmp_path / "cache" / "manifest.json").read_text())
    assert manifest["test_variable__test_region"]["units"] == "K"
    assert manifest["test_variable__test_region"]["output_units"] == "degC"
    assert manifest["test_variable__test_region"]["retrieved"] == "2026-11-14T14:27:46+00:00"
    assert manifest["test_variable__test_region"]["dataset_version"] == "SYNTHETIC"


@pytest.mark.parametrize(
    ("header", "units_line", "timestamps", "values", "message"),
    [
        ("date,measurement", f"# Units: {TEST_UNITS}\n", None, None, "selected time column"),
        ("time,value", None, None, None, "Source units are missing"),
        ("time,value", "# Units: K\n", None, None, "do not match expected units"),
        ("time,value", f"# Units: {TEST_UNITS}\n", _months()[:2] + _months()[3:], None, "continuity breaks"),
        ("time,value", f"# Units: {TEST_UNITS}\n", _months()[:2] + [_months()[1]] + _months()[3:], None, "duplicate month"),
        ("time,value", f"# Units: {TEST_UNITS}\n", [_months()[1], _months()[0]] + _months()[2:], None, "chronological order"),
        ("time,value", f"# Units: {TEST_UNITS}\n", ["2000-13"] + _months()[1:], None, "invalid month"),
        ("time,value", f"# Units: {TEST_UNITS}\n", None, ["bad"] + ["1"] * 179, "not numeric"),
    ],
)
def test_invalid_csv_is_rejected_without_cache_output(
    tmp_path, header, units_line, timestamps, values, message
):
    source = _write_csv(
        tmp_path / "synthetic_invalid.csv",
        header=header,
        units_line=units_line,
        timestamps=timestamps,
        values=values,
    )
    with pytest.raises(ValueError, match=message):
        _import(source, tmp_path)
    assert not (tmp_path / "cache" / "results" / "test_variable__test_region.json").exists()


def test_missing_required_column_and_short_record_are_rejected(tmp_path):
    source = _write_csv(tmp_path / "synthetic_wrong_headers.csv", header="date,measurement")
    with pytest.raises(ValueError, match="selected time column"):
        _import(source, tmp_path)

    short = _write_csv(tmp_path / "synthetic_short.csv", timestamps=_months(84))
    with pytest.raises(ValueError, match="at least 8 are required"):
        _import(short, tmp_path)


def test_malformed_field_count_and_non_monthly_day_are_rejected(tmp_path):
    malformed = tmp_path / "synthetic_malformed.csv"
    malformed.write_text(
        f"# Source: {SYNTHETIC_LABEL}\n# Units: {TEST_UNITS}\ntime,value\n2000-01,1,extra\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="different number of fields"):
        _import(malformed, tmp_path)

    timestamps = _months()
    timestamps[0] = "2000-01-15"
    daily_stamp = _write_csv(tmp_path / "synthetic_daily_stamp.csv", timestamps=timestamps)
    with pytest.raises(ValueError, match="daily timestamps are not accepted"):
        _import(daily_stamp, tmp_path)


def test_inspection_prints_dataset_and_variable_attributes(tmp_path, monkeypatch, capsys):
    synthetic_file = tmp_path / "synthetic_placeholder.nc"
    synthetic_file.write_text("SYNTHETIC inspection fixture; not NetCDF data")

    class FakeDataset:
        attrs = {"title": "SYNTHETIC inspection fixture"}
        variables = {
            "sample": SimpleNamespace(
                dims=("time", "lat"),
                shape=(2, 3),
                attrs={"units": TEST_UNITS, "long_name": "synthetic test variable"},
            )
        }

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

    monkeypatch.setitem(sys.modules, "xarray", SimpleNamespace(open_dataset=lambda *args, **kwargs: FakeDataset()))
    inspect_netcdf_hdf(synthetic_file)
    output = capsys.readouterr().out
    assert "Global attributes" in output
    assert "sample: dimensions=('time', 'lat'), shape=(2, 3)" in output
    assert f"units={TEST_UNITS!r}" in output
    assert "long_name" in output


def test_source_url_tracking_parameters_are_removed_from_manifest(tmp_path):
    # SYNTHETIC reproducibility link pasted with tracking parameters; only those parameters are dropped.
    url = "https://giovanni.gsfc.nasa.gov/giovanni/?portal=GIOVANNI&utm_source=chatgpt.com&utm_medium=x#service=ArAvTs&bbox=-1.8,6.55,-1.45,6.85"
    path = _write_csv(tmp_path / "input.csv", source_line=f"# Source: {url}\n")
    _import(path, tmp_path)
    entry = json.loads((tmp_path / "cache" / "manifest.json").read_text())["test_variable__test_region"]
    assert entry["source"] == "https://giovanni.gsfc.nasa.gov/giovanni/?portal=GIOVANNI#service=ArAvTs&bbox=-1.8,6.55,-1.45,6.85"


def test_written_files_have_the_same_bytes_on_every_os(tmp_path):
    # Checksummed outputs must not depend on the OS newline (Windows would turn "\n" into "\r\n").
    _import(_write_csv(tmp_path / "input.csv"), tmp_path)
    assert b"\r\n" not in (tmp_path / "cache" / "manifest.json").read_bytes()
    normalized = next((tmp_path / "raw").glob("*__*.csv")).read_bytes()
    assert normalized.startswith(b"time,value\r\n")  # csv module row ending, unchanged
    assert b"\r\r\n" not in normalized


def test_manifest_paths_use_forward_slashes_on_every_os(tmp_path, monkeypatch):
    # Paths recorded on Windows must still resolve on Linux (CI, Render).
    import pipelines.ingest.giovanni as giovanni

    monkeypatch.setattr(giovanni, "ROOT", tmp_path)
    _import(_write_csv(tmp_path / "input.csv"), tmp_path)
    entry = json.loads((tmp_path / "cache" / "manifest.json").read_text())["test_variable__test_region"]
    assert entry["file"] == "raw/test_variable__test_region.giovanni.csv"
    assert entry["cache_file"] == "cache/results/test_variable__test_region.json"
