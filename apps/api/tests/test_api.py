"""API smoke tests on SYNTHETIC cached files written to a temp folder (never committed)."""
import base64
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
    health = client.get("/api/v1/health").json()
    assert health["status"] == "ok"
    assert health["missing_cache_files"] == []
    ids = {v["id"] for v in client.get("/api/v1/variables").json()}
    assert {"merra2_t2m", "gpm_precip", "modis_ndvi"} <= ids
    assert client.get("/api/v1/regions/presets").json()["features"]


def test_health_lists_missing_required_cache_file(client, tmp_path):
    (tmp_path / "results" / "merra2_t2m__kumasi.json").unlink()
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["missing_cache_files"] == ["data/cache/results/merra2_t2m__kumasi.json"]


def test_production_startup_rejects_fixtures(monkeypatch):
    monkeypatch.setattr(m, "APP_ENV", "production")
    monkeypatch.setattr(m, "USE_FIXTURES", True)
    with pytest.raises(RuntimeError, match="USE_FIXTURES=0"):
        with TestClient(m.app):
            pass


def test_real_mode_does_not_serve_fixture_for_uncached_trend_or_point(client, monkeypatch):
    monkeypatch.setattr(m, "USE_FIXTURES", False)
    trend = client.post("/api/v1/trend", json={"variable_id": "gpm_precip", "region_id": "kumasi"})
    point = client.post("/api/v1/trend-at-point", json={
        "variable_id": "gpm_precip", "region_id": "west_africa", "lat": 6.7, "lon": -1.6,
    })
    assert trend.status_code == 404
    assert point.status_code == 404
    assert "fixture" not in trend.text.lower()
    assert "fixture" not in point.text.lower()


def test_real_mode_does_not_resolve_legacy_fixture_run(client, monkeypatch):
    monkeypatch.setattr(m, "USE_FIXTURES", False)
    response = client.get("/api/v1/runs/fixture-grade-a")
    assert response.status_code == 404


def test_trend_contract_and_narrative(client):
    r = client.post("/api/v1/trend", json={"variable_id": "merra2_t2m", "region_id": "kumasi"})
    assert r.status_code == 200
    body = r.json()
    for key in ("run_id", "variable", "region", "period", "series", "trend", "tests", "evidence_grade", "provenance", "verdict"):
        assert key in body
    n = client.post("/api/v1/narrative", json={"run_id": body["run_id"]}).json()
    assert n["source"] == "template"  # no LLM key in tests
    assert client.get(f"/api/v1/runs/{body['run_id']}/csv").text.startswith("#")


def test_run_id_is_url_safe_and_encodes_normalized_request(client):
    response = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": "kumasi", "bbox": None,
        "start": "2000-01", "end": "2009-12", "alpha": 0.05,
    })
    assert response.status_code == 200
    run_id = response.json()["run_id"]
    assert run_id not in m.RUNS
    assert run_id.startswith("r1_")
    assert len(run_id) <= 256
    assert all(c.isalnum() or c in "_-" for c in run_id)
    encoded = run_id.removeprefix("r1_")
    payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    assert payload == {
        "alpha": 0.05,
        "bbox": None,
        "end": "2009-12",
        "kind": "trend",
        "region_id": "kumasi",
        "start": "2000-01",
        "variable_id": "merra2_t2m",
    }


def test_normalized_equivalent_bbox_requests_share_a_run_id(client):
    body = {
        "variable_id": "merra2_t2m", "region_id": None,
        "bbox": [-2.5, 6, -1.5, 7], "start": None, "end": None, "alpha": 0.05,
    }
    first = client.post("/api/v1/trend", json=body)
    body["bbox"] = [-2.5, 6.0, -1.5, 7.0]
    second = client.post("/api/v1/trend", json=body)
    assert first.status_code == second.status_code == 200
    assert first.json()["run_id"] == second.json()["run_id"]


def test_cached_preset_reanalysis_uses_requested_alpha(client):
    default = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": "kumasi", "bbox": None,
        "start": None, "end": None, "alpha": 0.05,
    }).json()
    response = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": "kumasi", "bbox": None,
        "start": None, "end": None, "alpha": 0.1,
    })
    assert response.status_code == 200
    assert response.json()["tests"]["alpha"] == 0.1
    assert response.json()["run_id"] != default["run_id"]


def test_run_get_csv_and_narrative_recompute_after_simulated_restart(client):
    first = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": "kumasi", "bbox": None,
        "start": None, "end": None, "alpha": 0.05,
    }).json()
    run_id = first["run_id"]

    m.RUNS.clear()
    restored = client.get(f"/api/v1/runs/{run_id}")
    assert restored.status_code == 200
    assert restored.json()["run_id"] == run_id
    restored_body = restored.json()
    first["provenance"].pop("created_at")
    restored_body["provenance"].pop("created_at")
    assert restored_body == first

    m.RUNS.clear()
    csv_response = client.get(f"/api/v1/runs/{run_id}/csv")
    assert csv_response.status_code == 200
    assert csv_response.text.startswith("#")

    m.RUNS.clear()
    narrative = client.post("/api/v1/narrative", json={"run_id": run_id, "use_ai": False})
    assert narrative.status_code == 200
    assert narrative.json()["source"] == "template"


def test_bbox_run_can_be_reconstructed_after_simulated_restart(client):
    first = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": None,
        "bbox": [-2.5, 6.0, -1.5, 7.0], "start": None, "end": None, "alpha": 0.05,
    }).json()
    m.RUNS.clear()
    restored = client.get(f"/api/v1/runs/{first['run_id']}")
    assert restored.status_code == 200
    restored_body = restored.json()
    first["provenance"].pop("created_at")
    restored_body["provenance"].pop("created_at")
    assert restored_body == first


def test_point_run_can_be_reconstructed_after_simulated_restart(client):
    first = client.post("/api/v1/trend-at-point", json={
        "variable_id": "merra2_t2m", "region_id": "west_africa", "lat": 6.7, "lon": -1.6,
    }).json()
    assert first["run_id"] not in m.RUNS
    m.RUNS.clear()
    restored = client.get(f"/api/v1/runs/{first['run_id']}")
    assert restored.status_code == 200
    assert restored.json()["run_id"] == first["run_id"]
    assert restored.json()["region"]["geometry"] == first["region"]["geometry"]


def test_unknown_or_oversized_run_ids_return_404(client):
    for run_id in ("not-a-run", "r1_!invalid", "r1_" + "a" * 300):
        assert client.get(f"/api/v1/runs/{run_id}").status_code == 404
        assert client.get(f"/api/v1/runs/{run_id}/csv").status_code == 404
        assert client.post("/api/v1/narrative", json={"run_id": run_id, "use_ai": False}).status_code == 404


def test_trend_applies_requested_month_period_to_cached_series(client):
    response = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": "kumasi", "bbox": None,
        "start": "2000-01", "end": "2009-12", "alpha": 0.05,
    })
    assert response.status_code == 200
    assert response.json()["period"]["start"] == "2000-01"
    assert response.json()["period"]["end"] == "2009-12"
    assert response.json()["period"]["n_months"] == 120


def test_trend_accepts_exactly_eight_years(client):
    response = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": "kumasi", "bbox": None,
        "start": "2000-01", "end": "2007-12", "alpha": 0.05,
    })
    assert response.status_code == 200
    assert response.json()["period"]["n_months"] == 96


@pytest.mark.parametrize(
    ("start", "end", "detail"),
    [
        ("2000-1", "2009-12", "YYYY-MM"),
        ("2010-01", "2009-12", "after"),
        ("2000-01", "2007-11", "at least 8"),
    ],
)
def test_trend_rejects_invalid_or_short_periods(client, start, end, detail):
    response = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": "kumasi", "bbox": None,
        "start": start, "end": end, "alpha": 0.05,
    })
    assert response.status_code == 422
    assert detail.lower() in response.json()["detail"]["detail"].lower()


def test_bbox_trend_without_region_uses_weighted_cached_cells(client):
    response = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": None,
        "bbox": [-2.5, 6.0, -1.5, 7.0], "start": "2000-01", "end": "2009-12", "alpha": 0.05,
    })
    assert response.status_code == 200
    body = response.json()
    assert body["period"]["start"] == "2000-01"
    assert body["period"]["end"] == "2009-12"
    assert body["period"]["n_months"] == 120
    assert body["region"]["geometry"]["type"] == "Polygon"
    assert body["provenance"]["selected_cells"] == 2

    rng = np.random.default_rng(1)
    n = 30 * 12
    t = np.arange(n)
    x = 26 + np.sin(2 * np.pi * t / 12) + 0.03 * t / 12 + rng.normal(0, 0.2, n)
    cube = x[:, None, None] + rng.normal(0, 0.1, (n, 4, 5))
    expected = np.average(cube[60, 1:3, 1], weights=np.cos(np.deg2rad([6.0, 7.0])))
    assert body["series"]["raw"][0] == pytest.approx(expected)


def test_bbox_without_date_bounds_uses_full_cached_grid_period(client):
    response = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": None,
        "bbox": [-2.5, 6.0, -1.5, 7.0], "start": None, "end": None,
    })
    assert response.status_code == 200
    assert response.json()["period"]["start"] == "1995-01"
    assert response.json()["period"]["end"] == "2024-12"


def test_bbox_with_no_cell_center_uses_nearest_and_adds_notice(client):
    response = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": None,
        "bbox": [-2.4, 6.3, -2.1, 6.6], "start": "2000-01", "end": "2009-12", "alpha": 0.05,
    })
    assert response.status_code == 200
    assert any("nearest grid-cell centre" in item for item in response.json()["data_quality"]["notices"])


@pytest.mark.parametrize(
    ("bbox", "detail"),
    [
        ([-2.5, 6, -2.3, 7], "0.25"),
        ([-20, 0, -9, 1], "10"),
        ([-20, 0, -19, 1], "outside cached coverage"),
        ([1.0, 6.0, 2.0, 7.0], "outside cached coverage"),
        ([-2, 7, -1, 6], "valid coordinate bounds"),
        ([-2.5, 6, -1.5], "four coordinates"),
        (["west", 6, -1.5, 7], "finite numbers"),
    ],
)
def test_bbox_rejects_bad_size_or_out_of_coverage(client, bbox, detail):
    response = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": None,
        "bbox": bbox, "start": None, "end": None, "alpha": 0.05,
    })
    assert response.status_code == 422
    assert detail.lower() in response.json()["detail"]["detail"].lower()


def test_trend_requires_preset_or_bbox(client):
    response = client.post("/api/v1/trend", json={
        "variable_id": "merra2_t2m", "region_id": None, "bbox": None,
        "start": None, "end": None, "alpha": 0.05,
    })
    assert response.status_code == 422
    assert "preset region_id or a bbox" in response.json()["detail"]["detail"]


def test_giovanni_cached_series_provenance_does_not_claim_backend_spatial_average(client, tmp_path, monkeypatch):
    monkeypatch.setattr(m, "CACHE", tmp_path)
    (tmp_path / "results").mkdir(exist_ok=True)
    (tmp_path / "manifest.json").write_text(json.dumps({
        "merra2_t2m__kumasi": {
            "source": "https://giovanni.gsfc.nasa.gov/giovanni/?service=ArAvTs",
            "dataset_version": "5.12.4",
            "processing_steps": ["Converted temperature from K to degC (subtract 273.15)."],
        }
    }))

    response = client.post("/api/v1/trend", json={"variable_id": "merra2_t2m", "region_id": "kumasi"})
    assert response.status_code == 200
    steps = response.json()["provenance"]["steps"]
    assert "NASA Giovanni area-averaged regional series" in steps
    assert "Latitude-weighted regional mean" not in steps
    assert "Converted temperature from K to degC (subtract 273.15)." in steps


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


def test_unavailable_data_messages_are_written_for_people(client, monkeypatch):
    monkeypatch.setattr(m, "USE_FIXTURES", False)
    responses = [
        client.post("/api/v1/trend", json={"variable_id": "gpm_precip", "region_id": "kumasi"}),
        client.post("/api/v1/trend-at-point", json={
            "variable_id": "gpm_precip", "region_id": "west_africa", "lat": 6.7, "lon": -1.6,
        }),
        client.post("/api/v1/trend", json={"variable_id": "gpm_precip", "region_id": None, "bbox": [-2.6, 5.8, -0.2, 7.7]}),
        client.get("/api/v1/trend-map/gpm_precip/west_africa"),
        client.get("/api/v1/opposite-trends/gpm_precip/west_africa"),
    ]
    for response in responses:
        assert response.status_code == 404
        problem = response.json()["detail"]
        assert problem["title"] == "Not available yet"
        text = f"{problem['title']} {problem['detail']}".lower()
        for jargon in ("make seed", "cache", "npz", "ingest", "earthaccess", "__"):
            assert jargon not in text, (jargon, text)
        assert "rainfall" in text


def test_verdict_template_uses_degree_sign_and_no_negative_zero():
    from app.ai import verdict_template

    # SYNTHETIC result values for a wording test; not a real analysis.
    result = {"period": {"start": "2005-01", "end": "2025-12"},
              "trend": {"direction": "no_significant_trend", "sen_slope_per_decade": 0.1234, "ci95_per_decade": [-0.0012, 0.2468]},
              "tests": {"modified_mk": {"p": 0.41}},
              "evidence_grade": {"grade": "D", "label": "No significant trend"}}
    variable = {"id": "merra2_t2m", "name": {"en": "Air temperature"}, "units": "degC", "model_or_measurement": "model"}
    sentences = verdict_template(result, variable, "Kumasi")
    assert sentences["how_much"] == "About +0.12 °C per decade (95% range 0.00 to +0.25)."
    assert numeric_guard(" ".join(sentences.values()), result)[0]
