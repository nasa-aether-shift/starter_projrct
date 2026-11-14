"""Chunk equivalence tests use synthetic arrays only; no scientific result is implied."""
import numpy as np
from scipy import stats

from stats_engine.maps import pixel_trends


def test_chunked_pixel_trends_matches_legacy_synthetic_seed():
    """The chunked implementation must preserve the previous map statistics exactly."""
    rng = np.random.default_rng(20261114)
    years = np.arange(1990, 2026, dtype=float)
    annual = rng.normal(size=(len(years), 7, 11))
    annual[rng.random(annual.shape) < 0.13] = np.nan

    flat = annual.reshape(len(years), -1)
    valid = np.isfinite(flat)
    coverage = valid.mean(axis=0)
    i, j = np.triu_indices(len(years), k=1)
    differences = flat[j] - flat[i]
    dt = (years[j] - years[i])[:, None]
    with np.errstate(invalid="ignore", all="ignore"):
        old_slope = np.nanmedian(differences / dt, axis=0) * 10.0
        old_s = np.nansum(np.sign(differences), axis=0)
    n = valid.sum(axis=0).astype(float)
    variance = n * (n - 1) * (2 * n + 5) / 18.0
    with np.errstate(invalid="ignore", divide="ignore"):
        z = np.where(old_s > 0, (old_s - 1) / np.sqrt(variance),
                     np.where(old_s < 0, (old_s + 1) / np.sqrt(variance), 0.0))
    old_p = 2 * (1 - stats.norm.cdf(np.abs(z)))
    bad = (coverage < 0.75) | (n < 8)
    old_slope[bad] = np.nan
    old_p[bad] = np.nan
    old = {
        "slope_per_decade": old_slope.reshape(annual.shape[1:]),
        "p": old_p.reshape(annual.shape[1:]),
        "coverage": coverage.reshape(annual.shape[1:]),
    }

    actual = pixel_trends(years, annual, chunk_size=9)
    for key in old:
        np.testing.assert_array_equal(actual[key], old[key])
