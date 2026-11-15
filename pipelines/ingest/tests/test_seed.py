"""Seed pipeline tests use labelled synthetic files and temporary caches only."""
import csv
import hashlib
import json

import numpy as np
import pytest

from pipelines.ingest import seed


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.fixture
def layout(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    raw = root / "data" / "raw"
    cache = root / "data" / "cache"
    raw.mkdir(parents=True)
    (cache / "grids").mkdir(parents=True)
    monkeypatch.setattr(seed, "ROOT", root)
    monkeypatch.setattr(seed, "RAW", raw)
    monkeypatch.setattr(seed, "CACHE", cache)
    return root, raw, cache


def test_seed_series_uses_manifested_real_source_and_skips_giovanni_copy(layout, monkeypatch):
    root, raw, cache = layout
    normalized = raw / "synthetic_variable__synthetic_region.csv"
    with normalized.open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["time", "value"])
        writer.writerow(["2000-01", "1.0"])
        writer.writerow(["2000-02", "2.0"])
    source = raw / "synthetic_original.csv"
    source.write_text("SYNTHETIC TEST INPUT\n")
    (raw / "synthetic_variable__synthetic_region.giovanni.csv").write_text("synthetic source export copy\n")
    entry = {
        "source": "https://example.invalid/synthetic-test-source",
        "file": str(source.relative_to(root)),
        "sha256": sha256(source),
        "retrieval_date": "2026-01-02",
        "code_version": "synthetic-test",
    }
    (cache / "manifest.json").write_text(json.dumps({"synthetic_variable__synthetic_region": entry}))
    monkeypatch.setattr(seed, "analyze_series", lambda series, **kwargs: {"synthetic_test_result": True})

    metrics = seed.seed_series(horizon_sims=0)

    output = cache / "results" / "synthetic_variable__synthetic_region.json"
    assert json.loads(output.read_text()) == {"synthetic_test_result": True}
    updated = json.loads((cache / "manifest.json").read_text())["synthetic_variable__synthetic_region"]
    assert updated["source_urls"] == ["https://example.invalid/synthetic-test-source"]
    assert updated["normalized_file_sha256"] == sha256(normalized)
    assert updated["cache_sha256"] == sha256(output)
    assert metrics["series_count"] == 1
    assert metrics["peak_memory_bytes"] > 0


def test_seed_series_rejects_source_checksum_mismatch(layout, monkeypatch):
    _root, raw, cache = layout
    normalized = raw / "synthetic_variable__synthetic_region.csv"
    normalized.write_text("time,value\n2000-01,1\n")
    source = raw / "synthetic_original.csv"
    source.write_text("SYNTHETIC TEST INPUT\n")
    entry = {
        "source": "https://example.invalid/synthetic-test-source",
        "file": str(source.relative_to(_root)), "sha256": "wrong",
        "retrieval_date": "2026-01-02", "code_version": "synthetic-test",
    }
    (cache / "manifest.json").write_text(json.dumps({"synthetic_variable__synthetic_region": entry}))
    with pytest.raises(ValueError, match="checksum mismatch"):
        seed._series_inputs()


def test_seed_maps_caps_grid_and_writes_manifested_map(layout, monkeypatch):
    root, _raw, cache = layout
    grid_path = cache / "grids" / "synthetic_variable__synthetic_region.npz"
    rng = np.random.default_rng(7)
    time = (np.datetime64("2000-01", "M") + np.arange(120)).astype(str)
    lat = np.linspace(-5, 5, 20)
    lon = np.linspace(-5, 5, 20)
    cube = rng.normal(size=(120, 20, 20))
    np.savez_compressed(grid_path, time=time, lat=lat, lon=lon, cube=cube)
    source_file = root / "data" / "raw" / "synthetic_granule.nc"
    source_file.write_bytes(b"SYNTHETIC TEST GRANULE")
    entry = {
        "source_urls": ["https://example.invalid/synthetic-granule"],
        "input_files": [{"file": str(source_file.relative_to(root)), "sha256": sha256(source_file)}],
        "sha256": sha256(grid_path), "retrieval_date": "2026-01-02", "code_version": "synthetic-test",
    }
    (cache / "manifest.json").write_text(json.dumps({"grid:synthetic_variable__synthetic_region": entry}))

    monkeypatch.setattr(seed, "MAX_MAP_CELLS", 25)
    monkeypatch.setattr(seed, "pixel_trends", lambda years, annual, chunk_size: {
        "slope_per_decade": np.zeros(annual.shape[1:]), "p": np.ones(annual.shape[1:]),
    })
    monkeypatch.setattr(seed, "benjamini_hochberg", lambda p, q: np.zeros(p.shape, dtype=bool))
    monkeypatch.setattr(seed, "opposite_trends", lambda slope, sig, weights: {
        "found": False, "rising_share": 0.0, "falling_share": 0.0, "divergence_score": None,
        "rising": None, "falling": None,
    })

    metrics = seed.seed_maps(max_cells=25)

    output = cache / "maps" / "synthetic_variable__synthetic_region.json"
    payload = json.loads(output.read_text())
    assert len(payload["grid"]["lat"]) * len(payload["grid"]["lon"]) <= 25
    assert payload["opposite_trends"]["found"] is False
    updated = json.loads((cache / "manifest.json").read_text())["map:synthetic_variable__synthetic_region"]
    assert updated["cache_sha256"] == sha256(output)
    assert updated["source_urls"] == entry["source_urls"]
    assert metrics["map_count"] == 1


def test_seed_maps_reports_absent_grids_without_fabricating_output(layout):
    _root, _raw, cache = layout
    (cache / "manifest.json").write_text("{}")
    metrics = seed.seed_maps()
    assert metrics["map_count"] == 0
    assert not list((cache / "maps").glob("*.json"))


def test_seed_manifest_bytes_do_not_depend_on_the_os(layout, monkeypatch):
    root, raw, cache = layout
    normalized = raw / "synthetic_variable__synthetic_region.csv"
    normalized.write_bytes(b"time,value\r\n2000-01,1.0\r\n")
    source = raw / "synthetic_original.csv"
    source.write_bytes(b"SYNTHETIC TEST INPUT\n")
    entry = {
        "source": "https://example.invalid/synthetic-test-source",
        "file": str(source.relative_to(root)),
        "sha256": sha256(source),
        "retrieval_date": "2026-01-02",
        "code_version": "synthetic-test",
    }
    (cache / "manifest.json").write_bytes(json.dumps({"synthetic_variable__synthetic_region": entry}).encode())
    monkeypatch.setattr(seed, "analyze_series", lambda series, **kwargs: {"synthetic_test_result": True})

    seed.seed_series(horizon_sims=0)

    assert b"\r\n" not in (cache / "manifest.json").read_bytes()
    recorded = json.loads((cache / "manifest.json").read_text())["synthetic_variable__synthetic_region"]
    assert "\\" not in recorded["normalized_file"] + recorded["cache_file"]  # forward slashes on every OS
