"""Deployment safety: production never serves fixtures, /health reports the real cache, and grids are read once."""
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

import app.main as m

API_DIR = Path(__file__).resolve().parents[1]
ROOT = API_DIR.parents[1]


# --- APP_ENV / USE_FIXTURES ------------------------------------------------------------------------------------

def test_production_refuses_to_start_with_fixtures(monkeypatch):
    monkeypatch.setattr(m, "APP_ENV", "production")
    monkeypatch.setattr(m, "USE_FIXTURES", True)
    with pytest.raises(RuntimeError, match="Set USE_FIXTURES=0"):
        m.validate_startup_config()
    with pytest.raises(RuntimeError, match="Refusing to start"):
        with TestClient(m.app):  # runs the startup (lifespan) hook
            pass


@pytest.mark.parametrize("env, starts", [
    ({"APP_ENV": "production"}, False),  # USE_FIXTURES defaults to 1, so forgetting it must not start
    ({"APP_ENV": "production", "USE_FIXTURES": "1"}, False),
    ({"APP_ENV": "production", "USE_FIXTURES": "0"}, True),
    ({"APP_ENV": "development"}, True),
], ids=["production-default", "production-fixtures", "production-real", "development"])
def test_startup_reads_the_real_environment(env, starts):
    script = "from fastapi.testclient import TestClient\nimport app.main as m\nwith TestClient(m.app):\n    print('started')\n"
    base = {k: v for k, v in os.environ.items() if k not in ("APP_ENV", "USE_FIXTURES", "LLM_API_KEY", "EMBEDDING_MODEL")}
    proc = subprocess.run([sys.executable, "-c", script], cwd=API_DIR, env={**base, **env},
                          capture_output=True, text=True, timeout=180)
    if starts:
        assert proc.returncode == 0 and "started" in proc.stdout, proc.stderr[-2000:]
    else:
        assert proc.returncode != 0 and "Refusing to start" in proc.stderr, proc.stderr[-2000:]


# --- /health ---------------------------------------------------------------------------------------------------

def test_health_lists_the_real_cache_files():
    response = TestClient(m.app).get("/api/v1/health")  # the repo's own data/cache, exactly as deployed
    body = response.json()
    assert response.status_code == 200 and body["status"] == "ok" and body["missing_cache_files"] == []
    assert body["app_env"] == m.APP_ENV and body["using_fixtures"] is m.USE_FIXTURES
    on_disk = {kind: sorted(p.stem for p in (m.CACHE / kind).glob(pattern))
               for kind, pattern in (("results", "*.json"), ("maps", "*.json"), ("grids", "*.npz"))}
    assert body["cached_results"] == on_disk["results"] and "merra2_t2m__kumasi" in body["cached_results"]
    assert body["cached_maps"] == on_disk["maps"] and body["cached_grids"] == on_disk["grids"]
    manifest = json.loads((m.CACHE / "manifest.json").read_text(encoding="utf-8"))
    listed = {Path(entry[key]).stem for entry in manifest.values() if isinstance(entry, dict)
              for key in ("cache_file", "file") if str(entry.get(key, "")).startswith("data/cache/")}
    assert listed and listed <= set(body["cached_results"]) | set(body["cached_maps"]) | set(body["cached_grids"])


def test_health_is_503_when_a_manifest_listed_cache_file_is_missing(tmp_path, monkeypatch):
    for kind in ("results", "maps"):
        (tmp_path / kind).mkdir()
    (tmp_path / "results" / "merra2_t2m__kumasi.json").write_text("{}", encoding="utf-8")
    (tmp_path / "manifest.json").write_text(json.dumps({
        "map:synthetic__region": {"cache_file": "data/cache/maps/synthetic__region.json"},  # SYNTHETIC, never built
        "station:SYNTHETIC": {"file": "data/raw/SYNTHETIC.csv"},  # raw inputs are not runtime files
    }), encoding="utf-8")
    monkeypatch.setattr(m, "CACHE", tmp_path)
    response = TestClient(m.app).get("/api/v1/health")
    assert response.status_code == 503
    assert response.json()["missing_cache_files"] == ["data/cache/maps/synthetic__region.json"]


def test_every_cache_file_is_committed():
    """The deployed API reads only data/cache, so a cache file that is not in git is missing in production."""
    try:
        tracked = set(subprocess.run(["git", "ls-files", "data/cache"], cwd=ROOT, capture_output=True,
                                     text=True, check=True).stdout.split())
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("not a git checkout")
    on_disk = {p.relative_to(ROOT).as_posix() for p in (ROOT / "data" / "cache").rglob("*") if p.is_file()}
    assert on_disk <= tracked, sorted(on_disk - tracked)


# --- grid cache --------------------------------------------------------------------------------------------------

def test_each_grid_is_read_from_disk_once(tmp_path, monkeypatch):
    rng = np.random.default_rng(5)
    t = np.arange(30 * 12)
    lat, lon = np.linspace(5, 8, 4), np.linspace(-3, 1, 5)
    cube = 26 + np.sin(2 * np.pi * t / 12)[:, None, None] + rng.normal(0, 0.2, (t.size, 4, 5))  # SYNTHETIC
    (tmp_path / "grids").mkdir()
    path = tmp_path / "grids" / "merra2_t2m__west_africa.npz"
    np.savez_compressed(path, time=(np.datetime64("1995-01", "M") + t).astype(str), lat=lat, lon=lon, cube=cube)
    monkeypatch.setattr(m, "CACHE", tmp_path)
    monkeypatch.setattr(m, "USE_FIXTURES", False)
    m._load_grid_arrays.cache_clear()
    reads, real_load = [], np.load
    monkeypatch.setattr(np, "load", lambda file, *args, **kwargs: reads.append(str(file)) or real_load(file, *args, **kwargs))

    client = TestClient(m.app)
    for lat_, lon_ in ((6.0, -1.5), (7.0, 0.0)):
        assert client.post("/api/v1/trend-at-point", json={"variable_id": "merra2_t2m", "region_id": "west_africa",
                                                           "lat": lat_, "lon": lon_}).status_code == 200
    assert client.post("/api/v1/trend", json={"variable_id": "merra2_t2m", "bbox": [-2.0, 5.5, 0.0, 7.5]}).status_code == 200

    assert reads == [str(path)]  # three requests, one disk read
    assert not any(array.flags.writeable for array in m._grid(path))  # shared arrays are read-only
