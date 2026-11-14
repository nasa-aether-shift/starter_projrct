"""Core trend statistics for one monthly series.

Every function here is pure (no I/O, no web code). `analyze_series()` is the
single entry point used by the API; it returns a dict that matches the
POST /trend contract in packages/shared-schemas/trend.ts.

References: Theil (1950), Sen (1968), Mann (1945), Kendall (1975),
Hirsch, Slack & Smith (1982), Hamed & Rao (1998), Pettitt (1979).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy import stats

from .grade import evidence_grade

MIN_YEARS_HARD = 8
MIN_YEARS_WARN = 15


# ---------------------------------------------------------------------------
# Data structure
# ---------------------------------------------------------------------------
@dataclass
class MonthlySeries:
    """A monthly series. `time` holds month starts as numpy datetime64[M]."""

    time: np.ndarray  # datetime64[M]
    values: np.ndarray  # float, NaN = missing
    units: str = ""

    def __post_init__(self) -> None:
        self.time = np.asarray(self.time, dtype="datetime64[M]")
        self.values = np.asarray(self.values, dtype=float)
        if self.time.shape != self.values.shape:
            raise ValueError("time and values must have the same length")
        order = np.argsort(self.time)
        self.time, self.values = self.time[order], self.values[order]

    @property
    def months(self) -> np.ndarray:
        """Calendar month 1..12 for each value."""
        return (self.time.astype(int) % 12) + 1

    @property
    def decimal_years(self) -> np.ndarray:
        """Time as decimal years (mid-month), e.g. 2001.04 for Jan 2001."""
        idx = self.time.astype(int)  # months since 1970-01
        return 1970 + (idx + 0.5) / 12.0


# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------
def coverage(series: MonthlySeries) -> float:
    """Valid months divided by expected months between first and last month."""
    expected = int(series.time[-1].astype(int) - series.time[0].astype(int)) + 1
    return float(np.isfinite(series.values).sum() / expected)


def record_years(series: MonthlySeries) -> float:
    return (int(series.time[-1].astype(int) - series.time[0].astype(int)) + 1) / 12.0


def deseasonalize(series: MonthlySeries, method: str = "anomaly") -> np.ndarray:
    """Remove the seasonal cycle.

    anomaly: subtract each calendar month's mean over the full record.
    percent: anomaly as percent of that month's mean (rainfall, NDVI).
    """
    out = np.full_like(series.values, np.nan)
    for m in range(1, 13):
        sel = series.months == m
        clim = np.nanmean(series.values[sel]) if np.isfinite(series.values[sel]).any() else np.nan
        if method == "percent":
            out[sel] = 100.0 * (series.values[sel] - clim) / clim if clim else np.nan
        else:
            out[sel] = series.values[sel] - clim
    return out


# ---------------------------------------------------------------------------
# Mann-Kendall family
# ---------------------------------------------------------------------------
def _mk_s(x: np.ndarray) -> float:
    n = len(x)
    s = 0.0
    for k in range(n - 1):
        s += np.sign(x[k + 1 :] - x[k]).sum()
    return float(s)


def _var_s(x: np.ndarray) -> float:
    n = len(x)
    _, counts = np.unique(x, return_counts=True)
    ties = counts[counts > 1].astype(float)
    return float((n * (n - 1) * (2 * n + 5) - np.sum(ties * (ties - 1) * (2 * ties + 5))) / 18.0)


def _z(s: float, var_s: float) -> float:
    if s > 0:
        return (s - 1) / np.sqrt(var_s)
    if s < 0:
        return (s + 1) / np.sqrt(var_s)
    return 0.0


def _p(z: float) -> float:
    return float(2 * (1 - stats.norm.cdf(abs(z))))


def mann_kendall(x: np.ndarray) -> dict[str, float]:
    """Original Mann-Kendall test with tie correction. NaNs are skipped."""
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    n = len(x)
    s = _mk_s(x)
    var_s = _var_s(x)
    z = _z(s, var_s)
    return {"s": s, "var_s": var_s, "tau": s / (0.5 * n * (n - 1)), "z": float(z), "p": _p(z), "n": n}


def _acf(x: np.ndarray, nlags: int) -> np.ndarray:
    y = x - x.mean()
    n = len(x)
    acov = np.correlate(y, y, "full")[n - 1 :] / n
    return acov[: nlags + 1] / acov[0]


def index_sen_slope(x: np.ndarray) -> float:
    """Sen slope per time step (used for detrending in Hamed-Rao)."""
    x = np.asarray(x, dtype=float)
    idx = np.arange(len(x))
    ok = np.isfinite(x)
    xi, ii = x[ok], idx[ok]
    i, j = np.triu_indices(len(xi), k=1)
    return float(np.median((xi[j] - xi[i]) / (ii[j] - ii[i])))


def modified_mann_kendall(x: np.ndarray, alpha: float = 0.05) -> dict[str, float]:
    """Hamed & Rao (1998) Mann-Kendall with autocorrelation correction."""
    x_all = np.asarray(x, dtype=float)
    base = mann_kendall(x_all)
    x = x_all[np.isfinite(x_all)]
    n = len(x)
    slope = index_sen_slope(x_all)
    detrended = x - np.arange(1, n + 1) * slope
    ranks = stats.rankdata(detrended)
    acf = _acf(ranks, n - 1)
    bound = stats.norm.ppf(1 - alpha / 2) / np.sqrt(n)
    sni = 0.0
    for i in range(1, n):
        if abs(acf[i]) > bound:
            sni += (n - i) * (n - i - 1) * (n - i - 2) * acf[i]
    factor = 1 + (2 / (n * (n - 1) * (n - 2))) * sni
    if factor <= 0:  # rare with strong negative autocorrelation; fall back to the original variance
        factor = 1.0
    var_s = base["var_s"] * factor
    z = _z(base["s"], var_s)
    return {"z": float(z), "p": _p(z), "correction_factor": float(factor), "s": base["s"], "var_s": float(var_s)}


def seasonal_mann_kendall(series: MonthlySeries) -> dict[str, float]:
    """Hirsch, Slack & Smith (1982): sum of per-month S and variances, raw values."""
    s_tot, var_tot = 0.0, 0.0
    for m in range(1, 13):
        x = series.values[series.months == m]
        x = x[np.isfinite(x)]
        if len(x) < 3:
            continue
        s_tot += _mk_s(x)
        var_tot += _var_s(x)
    if var_tot == 0:
        return {"z": 0.0, "p": 1.0}
    z = _z(s_tot, var_tot)
    return {"z": float(z), "p": _p(z)}


def annual_means(series: MonthlySeries, min_months: int = 10) -> tuple[np.ndarray, np.ndarray]:
    years = series.time.astype("datetime64[Y]").astype(int) + 1970
    ys, vals = [], []
    for y in np.unique(years):
        v = series.values[years == y]
        if np.isfinite(v).sum() >= min_months:
            ys.append(y)
            vals.append(np.nanmean(v))
    return np.array(ys, dtype=float), np.array(vals, dtype=float)


# ---------------------------------------------------------------------------
# Slopes, OLS, autocorrelation, change-point
# ---------------------------------------------------------------------------
def theil_sen(t: np.ndarray, x: np.ndarray, ci: float = 0.95) -> dict[str, float]:
    ok = np.isfinite(x)
    res = stats.theilslopes(x[ok], t[ok], alpha=ci)
    return {"slope": float(res.slope), "intercept": float(res.intercept), "low": float(res.low_slope), "high": float(res.high_slope)}


def ols(t: np.ndarray, x: np.ndarray) -> dict[str, float]:
    ok = np.isfinite(x)
    r = stats.linregress(t[ok], x[ok])
    t_stat = r.slope / r.stderr if r.stderr else 0.0
    return {"slope": float(r.slope), "t": float(t_stat), "p": float(r.pvalue)}


def lag1_autocorrelation(x: np.ndarray) -> float:
    x = x[np.isfinite(x)]
    if len(x) < 3:
        return 0.0
    return float(np.corrcoef(x[:-1], x[1:])[0, 1])


def effective_n(n: int, r1: float) -> int:
    r1 = min(max(r1, -0.99), 0.99)
    return int(max(2, round(n * (1 - r1) / (1 + r1))))


def pettitt(x: np.ndarray) -> dict[str, Any]:
    """Pettitt (1979) change-point test. Returns index of the last point before the change."""
    x = np.asarray(x, dtype=float)
    x = x[np.isfinite(x)]
    n = len(x)
    sign = np.sign(x[None, :] - x[:, None])  # sign(x_j - x_i)
    # U_t = sum_{i<=t} sum_{j>t} sign(x_i - x_j)
    u = np.array([-sign[: t + 1, t + 1 :].sum() for t in range(n - 1)])
    k = int(np.argmax(np.abs(u)))
    kmax = float(np.abs(u[k]))
    p = float(min(1.0, 2 * np.exp(-6 * kmax**2 / (n**3 + n**2))))
    return {"index": k, "p": p}


# ---------------------------------------------------------------------------
# Years-to-significance (Monte Carlo)
# ---------------------------------------------------------------------------
def _fast_mk_p(x: np.ndarray) -> float:
    """Original MK p-value without tie correction (fast, for simulations)."""
    n = len(x)
    s = np.sign(x[None, :] - x[:, None])[np.triu_indices(n, k=1)].sum()
    var = n * (n - 1) * (2 * n + 5) / 18.0
    return _p(_z(float(s), var))


def years_to_significance(
    anomaly: np.ndarray,
    slope_per_year: float,
    alpha: float = 0.05,
    max_years: int = 30,
    n_sims: int = 200,
    power: float = 0.8,
    seed: int = 42,
) -> dict[str, Any]:
    """Smallest k (extra years) where >= `power` of simulated series reach p < alpha.

    Simulates the observed slope plus AR(1) noise fitted to the residuals.
    Uses the original MK on annual means for speed; documented in KNOWN_LIMITS.
    The full plan asks for 1,000 sims with the modified test: raise n_sims for
    precomputed cases.
    """
    rng = np.random.default_rng(seed)
    x = anomaly[np.isfinite(anomaly)]
    n_months = len(x)
    t = np.arange(n_months) / 12.0
    resid = x - slope_per_year * t
    r1 = lag1_autocorrelation(resid)
    sigma = float(np.std(resid))
    innov = sigma * np.sqrt(max(1e-6, 1 - r1**2))
    for k in range(1, max_years + 1):
        total = n_months + 12 * k
        hits = 0
        for _ in range(n_sims):
            e = np.empty(total)
            e[0] = rng.normal(0, sigma)
            shocks = rng.normal(0, innov, total)
            for i in range(1, total):
                e[i] = r1 * e[i - 1] + shocks[i]
            sim = slope_per_year * (np.arange(total) / 12.0) + e
            yearly = sim[: (total // 12) * 12].reshape(-1, 12).mean(axis=1)
            if _fast_mk_p(yearly) < alpha:
                hits += 1
        if hits / n_sims >= power:
            return {"needed": True, "years_estimate": k}
    return {"needed": True, "years_estimate": None}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def analyze_series(
    series: MonthlySeries,
    alpha: float = 0.05,
    deseason: str = "anomaly",
    compute_horizon: bool = True,
    horizon_sims: int = 200,
) -> dict[str, Any]:
    """Run the full pipeline (Section 5 of the team doc) on one monthly series.

    Returns the `trend`, `tests`, `autocorrelation`, `change_point`,
    `significance_horizon`, `evidence_grade`, `series` and `period` parts of
    the POST /trend contract. The API adds run_id, variable, region,
    provenance and verdict text.
    """
    years = record_years(series)
    if years < MIN_YEARS_HARD:
        raise ValueError(f"Record is {years:.1f} years; at least {MIN_YEARS_HARD} are required.")
    cov = coverage(series)
    notices: list[str] = []
    if years < MIN_YEARS_WARN:
        notices.append(f"Short record ({years:.0f} years): trends are less reliable under {MIN_YEARS_WARN} years.")

    t = series.decimal_years
    anom = deseasonalize(series, deseason)

    ts = theil_sen(t, anom)
    mk = mann_kendall(anom)
    mmk = modified_mann_kendall(anom, alpha)
    smk = seasonal_mann_kendall(series)
    yrs, ann = annual_means(series)
    amk = mann_kendall(ann) if len(ann) >= 8 else {"z": 0.0, "p": 1.0}
    ol = ols(t, anom)
    r1 = lag1_autocorrelation(anom)
    n_valid = int(np.isfinite(anom).sum())

    sig = mmk["p"] < alpha
    direction = ("increasing" if mmk["z"] > 0 else "decreasing") if sig else "no_significant_trend"
    signs = [np.sign(mmk["z"]), np.sign(ol["slope"])]
    tests_agree = bool(len(set(signs)) == 1 and ((mmk["p"] < alpha) == (ol["p"] < alpha)))

    # change-point
    # Pettitt on the residuals from the Sen line, so a steady trend is not
    # mistaken for a sudden shift; it flags breaks a single line cannot explain.
    valid_idx = np.where(np.isfinite(anom))[0]
    resid = anom - (ts["intercept"] + ts["slope"] * t)
    pt = pettitt(resid)
    cp: dict[str, Any] = {"detected": False, "date": None, "slope_before": None, "slope_after": None, "p": pt["p"]}
    if pt["p"] < alpha:
        cut = valid_idx[pt["index"]]
        before = theil_sen(t[: cut + 1], anom[: cut + 1]) if cut >= 24 else None
        after = theil_sen(t[cut + 1 :], anom[cut + 1 :]) if len(anom) - cut > 24 else None
        cp = {
            "detected": True,
            "date": str(series.time[cut]),
            "slope_before": None if before is None else before["slope"] * 10,
            "slope_after": None if after is None else after["slope"] * 10,
            "p": pt["p"],
        }

    mean_level = float(np.nanmean(series.values))
    pct = 100 * ts["slope"] * 10 / mean_level if mean_level else None

    grade = evidence_grade(
        p_modified=mmk["p"],
        years=years,
        coverage=cov,
        direction_sign=float(np.sign(mmk["z"])),
        annual_sign=float(np.sign(amk["z"])),
        annual_p=amk["p"],
        seasonal_sign=float(np.sign(smk["z"])),
        seasonal_p=smk["p"],
        change_point_mid=bool(cp["detected"] and 0.1 <= (pt["index"] / max(1, n_valid)) <= 0.9),
    )

    horizon: dict[str, Any] = {"needed": False, "years_estimate": None, "assumptions": ""}
    if compute_horizon and grade["grade"] in ("C", "D"):
        h = years_to_significance(anom, ts["slope"], alpha=alpha, n_sims=horizon_sims)
        horizon = {
            **h,
            "assumptions": "Assumes the current trend and year-to-year noise continue unchanged. An estimate, not a forecast.",
        }

    trend_line = ts["intercept"] + ts["slope"] * t
    return {
        "period": {
            "start": str(series.time[0]),
            "end": str(series.time[-1]),
            "n_months": int(len(series.values)),
            "coverage": round(cov, 4),
        },
        "series": {
            "time": [str(m) for m in series.time],
            "raw": _clean(series.values),
            "anomaly": _clean(anom),
            "trend_line": _clean(trend_line),
            "ci_low": _clean(ts["intercept"] + ts["low"] * (t - np.nanmean(t)) + ts["slope"] * np.nanmean(t)),
            "ci_high": _clean(ts["intercept"] + ts["high"] * (t - np.nanmean(t)) + ts["slope"] * np.nanmean(t)),
        },
        "trend": {
            "direction": direction,
            "sen_slope_per_decade": ts["slope"] * 10,
            "ci95_per_decade": [ts["low"] * 10, ts["high"] * 10],
            "percent_of_mean_per_decade": pct,
        },
        "tests": {
            "mann_kendall": {"tau": mk["tau"], "z": mk["z"], "p": mk["p"]},
            "modified_mk": {"z": mmk["z"], "p": mmk["p"], "correction_factor": mmk["correction_factor"]},
            "seasonal_mk": smk,
            "annual_mk": {"z": amk["z"], "p": amk["p"]},
            "ols": {"slope_per_decade": ol["slope"] * 10, "t": ol["t"], "p": ol["p"]},
            "alpha": alpha,
            "tests_agree": tests_agree,
        },
        "autocorrelation": {"lag1": r1, "effective_n": effective_n(n_valid, r1)},
        "change_point": cp,
        "significance_horizon": horizon,
        "evidence_grade": grade,
        "data_quality": {"gaps": int(len(series.values) - n_valid), "notices": notices},
    }


def _clean(a: np.ndarray) -> list[float | None]:
    return [None if not np.isfinite(v) else round(float(v), 6) for v in np.asarray(a, dtype=float)]
