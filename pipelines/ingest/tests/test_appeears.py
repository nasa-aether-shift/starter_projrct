"""AppEEARS importer tests on SYNTHETIC area-statistics rows written to a temp folder (never committed)."""
import json

import pytest

from pipelines.ingest import appeears

HEADER = "File Name,Dataset,aid,Date,Count,Minimum,Maximum,Range,Mean\n"


def _row(layer: str, doy: str, date: str, mean: str) -> str:
    return f"MOD13A3_061_{layer}_doy{doy}000000_aid0001,{layer},aid0001,{date},10.0,0.1,0.9,\"(0.1,0.9)\",{mean}\n"


def _export(tmp_path, rows: list[str]):
    root = tmp_path / "repo"
    path = root / "data" / "raw" / "SYNTHETIC-Statistics.csv"
    path.parent.mkdir(parents=True)
    path.write_text(HEADER + "".join(rows), encoding="utf-8")
    return root, path


def test_import_keeps_layer_and_leaves_missing_months_empty(tmp_path):
    root, path = _export(tmp_path, [
        _row("_1_km_monthly_EVI", "2000336", "2000-12-01", "0.31"),
        _row("_1_km_monthly_EVI", "2001032", "2001-02-01", "0.42"),  # 2001-01 absent, as in the real export
    ])
    out = appeears.import_appeears_csv(path, "synthetic_evi", "synthetic_region", layer="_1_km_monthly_EVI",
                                       retrieved="2026-01-02T03:04:05+00:00", root=root)
    assert out.read_text(encoding="utf-8").splitlines() == ["time,value", "2000-12,0.31", "2001-01,", "2001-02,0.42"]
    entry = json.loads((root / "data" / "cache" / "manifest.json").read_text(encoding="utf-8"))["synthetic_evi__synthetic_region"]
    assert (entry["product"], entry["dataset_version"], entry["layer"]) == ("MOD13A3", "061", "_1_km_monthly_EVI")
    assert entry["file"] == "data/raw/SYNTHETIC-Statistics.csv"
    assert entry["retrieval_date"] == "2026-01-02"
    assert entry["missing_months"] == ["2001-01"]
    assert entry["n_months"] == 2


def test_import_rejects_a_layer_other_than_the_one_named(tmp_path):
    root, path = _export(tmp_path, [_row("_1_km_monthly_EVI", "2000336", "2000-12-01", "0.31")])
    with pytest.raises(ValueError, match="holds layer _1_km_monthly_EVI, not _1_km_monthly_NDVI"):
        appeears.import_appeears_csv(path, "synthetic_ndvi", "synthetic_region", layer="_1_km_monthly_NDVI",
                                     retrieved="2026-01-02", root=root)


def test_read_rejects_mixed_layers_and_repeated_months():
    mixed = (HEADER + _row("_1_km_monthly_EVI", "2000336", "2000-12-01", "0.31")
             + _row("_1_km_monthly_NDVI", "2000336", "2000-12-01", "0.52")).encode("utf-8")
    with pytest.raises(ValueError, match="one product layer"):
        appeears.read_area_statistics(mixed)
    repeated = (HEADER + _row("_1_km_monthly_EVI", "2000336", "2000-12-01", "0.31")
                + _row("_1_km_monthly_EVI", "2000336", "2000-12-01", "0.32")).encode("utf-8")
    with pytest.raises(ValueError, match="repeats a month"):
        appeears.read_area_statistics(repeated)
