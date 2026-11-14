"""Validation suite (team doc, Section 5). All data here is SYNTHETIC and used only for tests."""
import numpy as np
import pymannkendall as pmk
import pytest

from stats_engine import (
    MonthlySeries, analyze_series, benjamini_hochberg, cell_weights, evidence_grade,
    mann_kendall, modified_mann_kendall, opposite_trends, pixel_trends, theil_sen,
)
from stats_engine.core import index_sen_slope


def synthetic(n_months=300, slope_per_year=0.03, ar=0.3, noise=0.3, seasonal=2.0, seed=0, start="1990-01"):
    rng = np.random.default_rng(seed)
    t = np.arange(n_months) / 12.0
    e = np.zeros(n_months)
    for i in range(1, n_months):
        e[i] = ar * e[i - 1] + rng.normal(0, noise)
    x = 25 + seasonal * np.sin(2 * np.pi * np.arange(n_months) / 12) + slope_per_year * t + e
    time = np.datetime64(start, "M") + np.arange(n_months)
    return MonthlySeries(time, x, "degC")


# 1. Reference agreement with pymannkendall on 50 seeded series
@pytest.mark.parametrize("seed", range(50))
def test_reference_agreement(seed):
    rng = np.random.default_rng(seed)
    n = int(rng.integers(40, 160))
    x = np.round(rng.normal(0, 1, n).cumsum() * 0.2 + rng.normal(0, 1, n), 2)  # rounding creates ties
    ours, ref = mann_kendall(x), pmk.original_test(x)
    assert ours["s"] == pytest.approx(ref.s, abs=1e-8)
    assert ours["p"] == pytest.approx(ref.p, abs=1e-6)
    assert index_sen_slope(x) == pytest.approx(ref.slope, abs=1e-8)
    om, rm = modified_mann_kendall(x), pmk.hamed_rao_modification_test(x)
    assert om["p"] == pytest.approx(rm.p, abs=1e-6)


# 2. Slope recovery within 5%
def test_slope_recovery():
    s = synthetic(n_months=360, slope_per_year=0.05, noise=0.15, seed=1)
    res = analyze_series(s, compute_horizon=False)
    assert res["trend"]["sen_slope_per_decade"] == pytest.approx(0.5, rel=0.05)
    assert res["trend"]["direction"] == "increasing"


# 3. False-positive rate on white noise (original MK) within 3.5%-6.5%
def test_false_positive_rate():
    rng = np.random.default_rng(7)
    hits = sum(mann_kendall(rng.normal(size=120))["p"] < 0.05 for _ in range(2000))
    assert 0.035 <= hits / 2000 <= 0.065


# 4. Autocorrelation: modified test closer to 5% than the original at AR(1)=0.5
def test_modified_handles_autocorrelation():
    rng = np.random.default_rng(3)
    orig = mod = 0
    for _ in range(400):
        e = np.zeros(120)
        for i in range(1, 120):
            e[i] = 0.5 * e[i - 1] + rng.normal()
        orig += mann_kendall(e)["p"] < 0.05
        mod += modified_mann_kendall(e)["p"] < 0.05
    assert abs(mod / 400 - 0.05) < abs(orig / 400 - 0.05)


# 5. FDR on a null map: stippled share stays below the FDR level
def test_fdr_null_map():
    rng = np.random.default_rng(11)
    p = rng.uniform(size=(80, 80))
    assert benjamini_hochberg(p, 0.10).mean() <= 0.10


# 6. Opposite-trend recovery on a synthetic field with two blobs (IoU >= 0.8)
def test_opposite_trend_recovery():
    rng = np.random.default_rng(5)
    ny, nx, ny_years = 40, 40, 25
    years = np.arange(2000, 2000 + ny_years, dtype=float)
    yy, xx = np.mgrid[0:ny, 0:nx]
    up = (yy - 10) ** 2 + (xx - 10) ** 2 < 36
    down = (yy - 28) ** 2 + (xx - 28) ** 2 < 36
    trend = np.where(up, 0.2, np.where(down, -0.2, 0.0))
    cube = trend[None] * (years - years[0])[:, None, None] + rng.normal(0, 0.5, (ny_years, ny, nx))
    m = pixel_trends(years, cube)
    sig = benjamini_hochberg(m["p"], 0.10)
    res = opposite_trends(m["slope_per_decade"], sig, cell_weights(np.linspace(5, 10, ny), (ny, nx)))
    assert res["found"]
    for name, truth in (("rising", up), ("falling", down)):
        got = res[name]["mask"]
        iou = (got & truth).sum() / (got | truth).sum()
        assert iou >= 0.8, name


# 7. Grade boundaries
@pytest.mark.parametrize(
    "kw,grade",
    [
        (dict(p_modified=0.005, years=25, coverage=0.95), "A"),
        (dict(p_modified=0.005, years=18, coverage=0.95), "B"),
        (dict(p_modified=0.03, years=16, coverage=0.85), "B"),
        (dict(p_modified=0.03, years=12, coverage=0.85), "C"),
        (dict(p_modified=0.08, years=25, coverage=0.95), "C"),
        (dict(p_modified=0.30, years=25, coverage=0.95), "D"),
    ],
)
def test_grade_boundaries(kw, grade):
    base = dict(direction_sign=1.0, annual_sign=1.0, annual_p=0.01, seasonal_sign=1.0, seasonal_p=0.01, change_point_mid=False)
    assert evidence_grade(**kw, **base)["grade"] == grade


# 8. Contract shape and refusal of short records
def test_contract_and_min_years():
    res = analyze_series(synthetic(n_months=240, slope_per_year=0.0, seed=2), horizon_sims=50)
    for key in ("trend", "tests", "autocorrelation", "change_point", "significance_horizon", "evidence_grade", "series", "period"):
        assert key in res
    with pytest.raises(ValueError):
        analyze_series(synthetic(n_months=60))


# 9. Invariants: negating data flips the slope; scaling scales it
def test_invariants():
    s = synthetic(seed=4)
    t = s.decimal_years
    a = theil_sen(t, s.values)["slope"]
    assert theil_sen(t, -s.values)["slope"] == pytest.approx(-a)
    assert theil_sen(t, 3 * s.values)["slope"] == pytest.approx(3 * a)


# 10. Change-point: a steady trend is NOT a change-point; a sudden step is
def test_change_point_trend_vs_step():
    trend_only = analyze_series(synthetic(n_months=360, slope_per_year=0.05, noise=0.15, seed=8), compute_horizon=False)
    assert trend_only["change_point"]["detected"] is False
    s = synthetic(n_months=360, slope_per_year=0.0, noise=0.15, seed=9)
    s.values[180:] += 1.0
    step = analyze_series(s, compute_horizon=False)
    assert step["change_point"]["detected"] is True
    assert step["change_point"]["date"][:4] in {"2004", "2005"}
