"""Compare fixture-mode API payload shapes with the frontend's synthetic fixtures."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

import app.main as api

ROOT = Path(__file__).resolve().parents[3]
WEB_FIXTURES = ROOT / "apps" / "web" / "fixtures"


def _fixture(name: str) -> Any:
    return json.loads((WEB_FIXTURES / name).read_text())


def _assert_compatible(actual: Any, expected: Any, path: str = "$") -> None:
    """Require matching JSON structure and types; fixture nulls remain nullable."""
    if expected is None:
        # These fields are nullable in the frontend Zod contract; null fixture
        # values cannot describe the non-null member's type.
        return
    nullable_path = (
        ".series." in path
        or path.endswith(".percent_of_mean_per_decade")
        or path.endswith(".change_point")
        or ".change_point." in path
        or path.endswith(".significance_horizon")
        or ".significance_horizon." in path
        or path.endswith(".tests.seasonal_mk")
        or path.endswith(".tests.annual_mk")
        or path.endswith(".data_quality")
        or path.endswith(".divergence_score")
        or path.startswith("$.slope_per_decade[")
        or path.startswith("$.p[")
    )
    if actual is None and nullable_path:
        # These fields use nullable schemas in the frontend.
        return
    if path.endswith(".resolution.spatial_deg"):
        assert isinstance(actual, (str, int, float)) and not isinstance(actual, bool), path
        return
    if path.endswith(".data_quality.gaps"):
        assert isinstance(actual, (int, list)) and not isinstance(actual, bool), path
        return
    if path.endswith(".geometry"):
        assert isinstance(actual, dict) and isinstance(actual.get("type"), str), path
        assert "coordinates" in actual or "geometries" in actual, path
        return
    if path.endswith(".provenance.datasets"):
        assert isinstance(actual, list) and all(isinstance(item, dict) for item in actual), path
        return
    elif isinstance(expected, dict):
        assert isinstance(actual, dict), path
        for key, value in expected.items():
            if key.startswith("_"):
                continue
            assert key in actual, f"{path}.{key} is missing"
            _assert_compatible(actual[key], value, f"{path}.{key}")
    elif isinstance(expected, list):
        assert isinstance(actual, list), path
        if expected and all(isinstance(item, dict) and "id" in item for item in expected):
            actual_by_id = {item.get("id"): item for item in actual if isinstance(item, dict)}
            for item in expected:
                assert item["id"] in actual_by_id, f"{path} has no item with id={item['id']}"
                _assert_compatible(actual_by_id[item["id"]], item, f"{path}[id={item['id']}]")
            return
        for index, value in enumerate(expected[: len(actual)]):
            _assert_compatible(actual[index], value, f"{path}[{index}]")
    elif isinstance(expected, bool):
        assert isinstance(actual, bool), path
    elif isinstance(expected, (int, float)):
        assert isinstance(actual, (int, float)) and not isinstance(actual, bool), path
    else:
        assert isinstance(actual, type(expected)), path


def test_api_responses_match_web_fixture_shapes(tmp_path, monkeypatch):
    """Exercise the frontend's fixture-backed JSON routes without NASA/network access."""
    monkeypatch.setattr(api, "USE_FIXTURES", True)
    monkeypatch.setattr(api, "CACHE", tmp_path)

    # The map route is a cache reader, so install the existing synthetic web fixture
    # into this test's temporary cache; no scientific values are generated here.
    maps = tmp_path / "maps"
    maps.mkdir()
    map_fixtures = {
        "merra2_t2m": "trend-map.merra2_t2m.west_africa.json",
        "gpm_precip": "trend-map.gpm_precip.west_africa.json",
        "modis_ndvi": "trend-map.modis_ndvi.west_africa.json",
    }
    trend_fixtures = {
        "merra2_t2m": "trend.grade-a.json",
        "gpm_precip": "trend.grade-d.json",
        "modis_ndvi": "trend.null-should.json",
    }
    for variable_id, map_name in map_fixtures.items():
        map_fixture = _fixture(map_name)
        map_fixture["opposite_trends"] = _fixture(
            f"opposite-trends.{variable_id}.west_africa.json"
        )
        (maps / f"{variable_id}__west_africa.json").write_text(json.dumps(map_fixture))

    with TestClient(api.app) as client:
        health = client.get("/api/v1/health")
        assert health.status_code == 200
        _assert_compatible(health.json(), _fixture("health.json"))

        variables = client.get("/api/v1/variables")
        assert variables.status_code == 200
        variable_fixtures = _fixture("variables.json")
        _assert_compatible(variables.json(), variable_fixtures)
        detail = client.get("/api/v1/variables/merra2_t2m")
        assert detail.status_code == 200
        merra_fixture = next(v for v in variable_fixtures if v["id"] == "merra2_t2m")
        _assert_compatible(detail.json(), merra_fixture)

        presets = client.get("/api/v1/regions/presets")
        assert presets.status_code == 200
        _assert_compatible(presets.json(), _fixture("regions-presets.json"))

        run_id = None
        for variable_id, fixture_name in trend_fixtures.items():
            trend = client.post(
                "/api/v1/trend", json={"variable_id": variable_id, "region_id": "kumasi"}
            )
            assert trend.status_code == 200
            _assert_compatible(trend.json(), _fixture(fixture_name))
            if run_id is None:
                run_id = trend.json()["run_id"]

        point = client.post(
            "/api/v1/trend-at-point",
            json={"variable_id": "merra2_t2m", "region_id": "west_africa", "lat": 6.7, "lon": -1.6},
        )
        assert point.status_code == 200
        _assert_compatible(point.json(), _fixture("trend-at-point.json"))

        for variable_id, map_name in map_fixtures.items():
            trend_map = client.get(f"/api/v1/trend-map/{variable_id}/west_africa")
            assert trend_map.status_code == 200
            _assert_compatible(trend_map.json(), _fixture(map_name))
            opposite = client.get(f"/api/v1/opposite-trends/{variable_id}/west_africa")
            assert opposite.status_code == 200
            _assert_compatible(
                opposite.json(), _fixture(f"opposite-trends.{variable_id}.west_africa.json")
            )

        narrative = client.post(
            "/api/v1/narrative", json={"run_id": run_id, "level": "student", "use_ai": False}
        )
        assert narrative.status_code == 200
        _assert_compatible(narrative.json(), _fixture("narrative.json"))

        run = client.get(f"/api/v1/runs/{run_id}")
        assert run.status_code == 200
        _assert_compatible(run.json(), _fixture("trend.grade-a.json"))
        csv = client.get(f"/api/v1/runs/{run_id}/csv")
        assert csv.status_code == 200
        assert csv.headers["content-type"].startswith("text/csv")

        missing_map = client.get("/api/v1/trend-map/merra2_t2m/not_cached")
        assert missing_map.status_code == 404
        _assert_compatible(missing_map.json(), _fixture("problem.not-cached.json"))

