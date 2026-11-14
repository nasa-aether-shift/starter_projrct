"""OPeNDAP grid ingestion tests. All grids and responses are SYNTHETIC and served by a fake in-process server."""
from __future__ import annotations

import io
import json
import re
from dataclasses import replace

import h5py
import numpy as np
import pytest

from pipelines.ingest import opendap_grid as og
from pipelines.ingest import seed

SYNTHETIC = "SYNTHETIC automated test data; not NASA data"


def test_index_range_selects_cell_centres_inside_the_box():
    axis = np.arange(-89.95, 90, 0.1)
    first, last = og.index_range(axis, 0, 20)
    assert axis[first] == pytest.approx(0.05) and axis[last] == pytest.approx(19.95)
    with pytest.raises(ValueError):
        og.index_range(axis, 100, 120)


def test_constraint_follows_each_datasets_dimension_order():
    assert og.constraint(og.SPECS["merra2_t2m"], (180, 220), (256, 320)) == "/T2M[0][180:220][256:320];/lat[180:220];/lon[256:320]"
    assert og.constraint(og.SPECS["gpm_precip"], (900, 1099), (1600, 1999)) == (
        "/Grid/precipitation[0][1600:1999][900:1099];/Grid/lat[900:1099];/Grid/lon[1600:1999]"
    )


def test_unit_conversions_are_explicit():
    values, step = og.convert_units(np.array([273.15, 300.0]), og.SPECS["merra2_t2m"])
    assert values == pytest.approx([0.0, 26.85]) and "K to degC" in step
    values, step = og.convert_units(np.array([0.5]), og.SPECS["gpm_precip"])
    assert values == pytest.approx([12.0]) and "mm/hr to mm/day" in step
    with pytest.raises(ValueError):
        og.convert_units(np.array([1.0]), replace(og.SPECS["gpm_precip"], output_units="mm/month"))


def test_coarsen_averages_blocks_and_keeps_mostly_missing_blocks_missing():
    lat, lon = np.array([0.05, 0.15, 0.25, 0.35]), np.array([10.05, 10.15])
    cube = np.array([[[1.0, 3.0], [5.0, 7.0], [np.nan, np.nan], [np.nan, 2.0]]])
    c_lat, c_lon, c_cube = og.coarsen(lat, lon, cube, 2)
    assert c_lat == pytest.approx([0.1, 0.3]) and c_lon == pytest.approx([10.1])
    assert c_cube[0, 0, 0] == pytest.approx(4.0)  # all four cells valid
    assert np.isnan(c_cube[0, 1, 0])  # one of four valid: under half, stays missing


def _h5_bytes(arrays: dict[str, np.ndarray], fill: float | None = None, units: str = "") -> bytes:
    buffer = io.BytesIO()
    with h5py.File(buffer, "w") as handle:
        handle.attrs["comment"] = SYNTHETIC
        for path, array in arrays.items():
            dataset = handle.create_dataset(path.lstrip("/"), data=array)
            if fill is not None and array.ndim == 3:
                dataset.attrs["_FillValue"] = np.float32(fill)
                dataset.attrs["units"] = units
    return buffer.getvalue()


def test_read_subset_transposes_lon_first_fields_and_masks_fill(tmp_path):
    spec = og.SPECS["gpm_precip"]
    field = np.array([[[0.1, 0.2, 0.3], [0.4, spec.fill_value, 0.6]]], dtype=np.float32)  # (time, lon=2, lat=3)
    path = tmp_path / "synthetic.nc4"
    path.write_bytes(_h5_bytes({spec.variable: field, spec.lat: np.array([0.05, 0.15, 0.25]),
                                spec.lon: np.array([-0.05, 0.05])}, spec.fill_value, "mm/hr"))
    lat, lon, out = og.read_subset(path, spec)
    assert out.shape == (3, 2)
    assert out[0, 1] == pytest.approx(0.4) and np.isnan(out[1, 1])


class _Response:
    def __init__(self, status_code=200, content=b"", payload=None):
        self.status_code, self.content, self._payload = status_code, content, payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeNasa:
    """Serves a SYNTHETIC global temperature grid, one granule per month, with one month withheld."""

    def __init__(self, months, missing):
        self.lat = np.arange(-1.75, 2.0, 0.5)
        self.lon = np.arange(-1.75, 2.0, 0.5)
        self.months = [m for m in months if m not in missing]
        rng = np.random.default_rng(7)
        t = np.arange(len(months))
        base = 300 + 2 * np.sin(2 * np.pi * t / 12) + 0.004 * t
        self.values = {m: (base[i] + rng.normal(0, 0.1, (len(self.lat), len(self.lon)))).astype(np.float32)
                       for i, m in enumerate(months)}
        self.tokens: set[str] = set()

    def __call__(self, url, params=None, headers=None, timeout=None):
        if url == og.CMR_GRANULES:
            items = [{"umm": {"TemporalExtent": {"RangeDateTime": {"BeginningDateTime": f"{m}-01T00:00:00.000Z"}},
                              "RelatedUrls": [{"Type": "GET DATA", "URL": f"https://data.example.invalid/{m}.nc4"},
                                              {"Type": "USE SERVICE API", "Subtype": "OPENDAP DATA",
                                               "URL": f"https://opendap.example.invalid/{m}"}]}}
                     for m in self.months]
            return _Response(payload={"items": items if params["page_num"] == 1 else []})
        self.tokens.add((headers or {}).get("Authorization", ""))
        month = url.rsplit("/", 1)[1].removesuffix(".dap.nc4")
        ce = params["dap4.ce"]
        if not ce.startswith("/T2M"):
            return _Response(content=_h5_bytes({"/lat": self.lat, "/lon": self.lon}))
        (a, b), (c, d) = [tuple(map(int, r)) for r in re.findall(r"\[(\d+):(\d+)\]", ce)[:2]]
        field = self.values[month][a:b + 1, c:d + 1][None]
        return _Response(content=_h5_bytes({"/T2M": field, "/lat": self.lat[a:b + 1], "/lon": self.lon[c:d + 1]},
                                           1e15, "K"))


def test_build_grid_writes_a_gap_preserving_cube_that_seed_accepts(tmp_path, monkeypatch):
    (tmp_path / "data" / "regions").mkdir(parents=True)
    ring = [[-1.0, -1.0], [1.0, -1.0], [1.0, 1.0], [-1.0, 1.0], [-1.0, -1.0]]
    (tmp_path / "data" / "regions" / "presets.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"id": "synthetic_box", "name": "Synthetic box", "kind": "map"},
         "geometry": {"type": "Polygon", "coordinates": [ring]}}]}), encoding="utf-8")
    months = [str(m) for m in np.arange(np.datetime64("2000-01"), np.datetime64("2012-01"))]
    fake = FakeNasa(months, missing={"2005-07"})

    out = og.build_grid("merra2_t2m", "synthetic_box", token="synthetic-token", start="2000-01", end="2011-12",
                        get=fake, workers=2, root=tmp_path)

    with np.load(out) as grid:
        assert list(grid["lat"]) == [-0.75, -0.25, 0.25, 0.75] and list(grid["lon"]) == [-0.75, -0.25, 0.25, 0.75]
        assert grid["cube"].shape == (144, 4, 4)
        july = list(grid["time"]).index("2005-07")
        assert np.isnan(grid["cube"][july]).all()  # withheld month stays missing, never filled
        assert np.nanmax(grid["cube"]) < 40  # converted from K to degC
    assert fake.tokens == {"Bearer synthetic-token"}
    entry = json.loads((tmp_path / "data" / "cache" / "manifest.json").read_text())["grid:merra2_t2m__synthetic_box"]
    assert entry["missing_months"] == ["2005-07"] and entry["granules"] == 143
    assert all(url.startswith("https://") for url in entry["source_urls"])
    assert "synthetic-token" not in json.dumps(entry)

    monkeypatch.setattr(seed, "ROOT", tmp_path)
    monkeypatch.setattr(seed, "CACHE", tmp_path / "data" / "cache")
    metrics = seed.seed_maps()
    assert metrics["map_count"] == 1
    payload = json.loads((tmp_path / "data" / "cache" / "maps" / "merra2_t2m__synthetic_box.json").read_text())
    assert len(payload["slope_per_decade"]) == 4 and "opposite_trends" in payload


def test_index_range_keeps_a_centre_that_is_zero_up_to_float_noise():
    axis = np.array([-0.5, -1.8e-13, 0.5, 1.0])  # MERRA-2 stores its equator row as -1.8e-13
    assert og.index_range(axis, 0, 1.0) == (1, 3)


def test_downloaded_subsets_are_keyed_by_their_constraint(tmp_path):
    # A changed box must never reuse subsets cut for the old box.
    spec = og.SPECS["merra2_t2m"]
    first = og.subset_dir(tmp_path, "merra2_t2m", "box", og.constraint(spec, (0, 1), (0, 1)))
    second = og.subset_dir(tmp_path, "merra2_t2m", "box", og.constraint(spec, (0, 2), (0, 1)))
    assert first != second and first.parent == second.parent
