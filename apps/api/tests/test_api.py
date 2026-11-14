"""API smoke tests on SYNTHETIC cached files written to a temp folder (never committed)."""
import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app.main as m
from app.ai import numeric_guard


@pytest.fixture()
def client(tmp_path, monkeypatch):
    rng = np.random.default_rng(1)
    n = 30 * 12
    t = np.arange(n)
    x = 26 + np.sin(2 * np.pi * t / 12) + 0.03 * t / 12 + rng.normal(0, 0.2, n)
    (tmp_path / "results").mkdir()
    from stats_engine import MonthlySeries, analyze_series
    s = MonthlySeries(np.datetime64("1995-01", "M") + t, x)
    (tmp_path / "results" / "merra2_t2m__kumasi.json").write_text(json.dumps(analyze_series(s, horizon_sims=30)))
    (tmp_path / "grids").mkdir()
    cube = x[:, None, None] + rng.normal(0, 0.1, (n, 4, 5))
    np.savez_compressed(tmp_path / "grids" / "merra2_t2m__west_africa.npz",
                        time=(np.datetime64("1995-01", "M") + t).astype(str), lat=np.linspace(5, 8, 4), lon=np.linspace(-3, 1, 5), cube=cube)
    monkeypatch.setattr(m, "CACHE", tmp_path)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    return TestClient(m.app)


def test_health_and_catalog(client):
    assert client.get("/api/v1/health").json()["status"] == "ok"
    ids = {v["id"] for v in client.get("/api/v1/variables").json()}
    assert {"merra2_t2m", "gpm_precip", "modis_ndvi"} <= ids
    assert client.get("/api/v1/regions/presets").json()["features"]


def test_trend_contract_and_narrative(client):
    r = client.post("/api/v1/trend", json={"variable_id": "merra2_t2m", "region_id": "kumasi"})
    assert r.status_code == 200
    body = r.json()
    for key in ("run_id", "variable", "region", "period", "series", "trend", "tests", "evidence_grade", "provenance", "verdict"):
        assert key in body
    n = client.post("/api/v1/narrative", json={"run_id": body["run_id"]}).json()
    assert n["source"] == "template"  # no LLM key in tests
    assert client.get(f"/api/v1/runs/{body['run_id']}/csv").text.startswith("#")


def test_point_and_errors(client):
    ok = client.post("/api/v1/trend-at-point", json={"variable_id": "merra2_t2m", "region_id": "west_africa", "lat": 6.7, "lon": -1.6})
    assert ok.status_code == 200 and ok.json()["region"]["geometry"]["type"] == "Point"
    out = client.post("/api/v1/trend-at-point", json={"variable_id": "merra2_t2m", "region_id": "west_africa", "lat": 40, "lon": 0})
    assert out.status_code == 422
    assert client.post("/api/v1/trend", json={"variable_id": "nope", "region_id": "kumasi"}).status_code == 404


def test_numeric_guard_rejects_invented_numbers():
    result = {"period": {"start": "1995-01", "end": "2024-12"}, "trend": {"sen_slope_per_decade": 0.3012, "ci95_per_decade": [0.25, 0.35]},
              "tests": {"modified_mk": {"p": 0.004}}}
    assert numeric_guard("Warming about 0.30 °C per decade since 1995, 95% range 0.25 to 0.35.", result)[0]
    ok, bad = numeric_guard("Warming 0.9 °C per decade, 3 times faster than 2050.", result)
    assert not ok and "0.9" in bad
