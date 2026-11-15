"""Planetary Computer NDVI importer tests on SYNTHETIC arrays and files in a temp folder (no network, never committed)."""
import json

import numpy as np
import pytest

from pipelines.ingest import planetary_ndvi as p


def test_mask_and_scale_keeps_good_and_marginal_pixels_only():
    ndvi = np.array([5000, 5000, 5000, 5000, -3000, -2500, 12000, -2000], dtype=np.int16)
    reliability = np.array([0, 1, 2, 3, 0, 0, 0, -1], dtype=np.int8)
    out = p.mask_and_scale(ndvi, reliability)
    assert out[:2] == pytest.approx([0.5, 0.5])
    assert np.isnan(out[2:]).all()  # snow/ice, cloudy, fill, below and above the valid range, no-data reliability


def test_monthly_means_assign_composites_by_their_middle_day():
    fields = np.array([[[0.2]], [[0.4]], [[np.nan]], [[0.9]]], dtype=np.float32)
    # middle days: 2001-01-09, 2001-01-25, 2001-02-10, 2000-12-27
    months, cube = p.monthly_means(["2001-01-01", "2001-01-17", "2001-02-02", "2000-12-19"], fields)
    assert months == ["2000-12", "2001-01", "2001-02"]
    assert cube[:, 0, 0][:2] == pytest.approx([0.9, 0.3]) and np.isnan(cube[2, 0, 0])


def test_area_series_needs_half_the_pixels():
    cube = np.full((2, 2, 2), 0.5, dtype=np.float32)
    cube[1, :, :1] = np.nan
    cube[1, 0, 1] = np.nan  # 1 of 4 valid
    mean, valid = p.area_series(cube)
    assert mean[0] == pytest.approx(0.5) and np.isnan(mean[1])
    assert valid.tolist() == [4, 1]


def _write_year(raw, year, months, value, shape, lat, lon, suffix=""):
    cube = np.full((len(months), *shape), value, dtype=np.float32)
    np.savez_compressed(raw / f"{year}{suffix}.npz", time=np.array(months), lat=lat, lon=lon, cube=cube)


def test_build_writes_grid_series_and_manifest(tmp_path):
    root = tmp_path / "repo"
    (root / "data" / "regions").mkdir(parents=True)
    box = lambda w, s, e, n: {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}
    (root / "data" / "regions" / "presets.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": "synthetic_region"}, "geometry": box(0, 0, 1, 1)},
        {"type": "Feature", "properties": {"id": "synthetic_city"}, "geometry": box(0.1, 0.1, 0.2, 0.2)},
    ]}), encoding="utf-8")
    raw = root / "data" / "raw" / "planetary_computer" / "modis_ndvi__synthetic_region"
    raw.mkdir(parents=True)
    lat = lon = np.round(np.arange(20) * 0.05 + 0.025, 6)  # 20 x 20 samples -> 2 x 2 cells of 0.5 deg
    _write_year(raw, 2000, ["2000-11", "2000-12"], 0.3, (20, 20), lat, lon)
    _write_year(raw, 2001, ["2001-02"], 0.5, (20, 20), lat, lon)  # 2001-01 has no composite: must stay missing
    _write_year(raw, 2000, ["2000-11", "2000-12"], 0.6, (4, 4), lat[:4], lon[:4], ".series")
    _write_year(raw, 2001, ["2001-02"], 0.7, (4, 4), lat[:4], lon[:4], ".series")
    for year in (2000, 2001):
        (raw / f"{year}.items.json").write_text(json.dumps({"retrieved": f"{year + 25}-01-02T00:00:00+00:00",
                                                             "items": [f"SYNTHETIC.{year}"]}), encoding="utf-8")

    result = p.build("synthetic_region", "synthetic_city", end="2001-12", root=root, code_version="synthetic-test")

    with np.load(root / "data" / "cache" / "grids" / "modis_ndvi__synthetic_region.npz") as grid:
        assert grid["time"].tolist() == ["2000-11", "2000-12", "2001-01", "2001-02"]
        assert grid["cube"].shape == (4, 2, 2) and grid["lat"].tolist() == [0.25, 0.75]
        assert np.isnan(grid["cube"][2]).all() and grid["cube"][3] == pytest.approx(np.full((2, 2), 0.5))
    assert result["grid_missing"] == ["2001-01"]
    lines = (root / "data" / "raw" / "modis_ndvi__synthetic_city.csv").read_text(encoding="utf-8").splitlines()
    assert lines == ["time,value", "2000-11,0.600000", "2000-12,0.600000", "2001-01,", "2001-02,0.700000"]
    manifest = json.loads((root / "data" / "cache" / "manifest.json").read_text(encoding="utf-8"))
    grid_entry, series_entry = manifest["grid:modis_ndvi__synthetic_region"], manifest["modis_ndvi__synthetic_city"]
    assert (grid_entry["collection_id"], grid_entry["product"], grid_entry["dataset_version"]) == ("modis-13A1-061", "MOD13A1", "061")
    assert grid_entry["retrieval_date"] == "2026-01-02" and grid_entry["stac_items"] == 2
    assert all(item["sha256"] for item in grid_entry["input_files"])
    assert series_entry["file"] == "data/raw/modis_ndvi__synthetic_city.areastats.csv"
    assert series_entry["missing_months"] == ["2001-01"] and series_entry["pixels_per_month"] == 16
