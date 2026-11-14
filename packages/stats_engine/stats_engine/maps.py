"""Gridded trend maps, false-discovery-rate control and the opposite-trend detector (D1).

Decision (logged in docs/DECISIONS.md): per-pixel tests run on ANNUAL means
(calendar years with >= 10 valid months). This removes the seasonal cycle,
reduces autocorrelation, and keeps a 100,000-cell map fast enough to
precompute in a hackathon. Regional series for the clusters still go through
the full monthly pipeline in core.analyze_series().
"""
from __future__ import annotations

from typing import Any

import numpy as np
from scipy import ndimage, stats


def annual_cube(time: np.ndarray, cube: np.ndarray, min_months: int = 10) -> tuple[np.ndarray, np.ndarray]:
    """(time, y, x) monthly cube -> (years, (year, y, x)) annual means."""
    time = np.asarray(time, dtype="datetime64[M]")
    years = time.astype("datetime64[Y]").astype(int) + 1970
    uniq = np.unique(years)
    out = np.full((len(uniq),) + cube.shape[1:], np.nan)
    for i, y in enumerate(uniq):
        block = cube[years == y]
        n_ok = np.isfinite(block).sum(axis=0)
        with np.errstate(invalid="ignore"):
            mean = np.nanmean(block, axis=0) if block.size else np.nan
        out[i] = np.where(n_ok >= min_months, mean, np.nan)
    return uniq.astype(float), out


def pixel_trends(
    years: np.ndarray,
    annual: np.ndarray,
    min_coverage: float = 0.75,
    chunk_size: int = 512,
) -> dict[str, np.ndarray]:
    """Sen slope (per decade) and Mann-Kendall p for every pixel in bounded-memory chunks."""
    if isinstance(chunk_size, bool) or not isinstance(chunk_size, int) or chunk_size < 1:
        raise ValueError("chunk_size must be a positive integer")
    n_t = annual.shape[0]
    flat = annual.reshape(n_t, -1)
    n_cells = flat.shape[1]
    i, j = np.triu_indices(n_t, k=1)
    dt = (years[j] - years[i])[:, None]
    slope = np.full(n_cells, np.nan)
    p = np.full(n_cells, np.nan)
    cov = np.full(n_cells, np.nan)
    for start in range(0, n_cells, chunk_size):
        stop = min(start + chunk_size, n_cells)
        block = flat[:, start:stop]
        valid = np.isfinite(block)
        cov[start:stop] = valid.mean(axis=0)
        diff = block[j] - block[i]  # (pairs, chunk pixels)
        with np.errstate(invalid="ignore", all="ignore"):
            slope[start:stop] = np.nanmedian(diff / dt, axis=0) * 10.0
            s = np.nansum(np.sign(diff), axis=0)
        n = valid.sum(axis=0).astype(float)
        var = n * (n - 1) * (2 * n + 5) / 18.0
        with np.errstate(invalid="ignore", divide="ignore"):
            z = np.where(s > 0, (s - 1) / np.sqrt(var), np.where(s < 0, (s + 1) / np.sqrt(var), 0.0))
        p[start:stop] = 2 * (1 - stats.norm.cdf(np.abs(z)))
        bad = (cov[start:stop] < min_coverage) | (n < 8)
        slope[start:stop][bad], p[start:stop][bad] = np.nan, np.nan
    shape = annual.shape[1:]
    return {"slope_per_decade": slope.reshape(shape), "p": p.reshape(shape), "coverage": cov.reshape(shape)}


def benjamini_hochberg(p: np.ndarray, q: float = 0.10) -> np.ndarray:
    """Boolean mask of p-values that survive BH false-discovery-rate control at level q."""
    flat = p.ravel()
    ok = np.isfinite(flat)
    pv = flat[ok]
    m = len(pv)
    mask = np.zeros_like(flat, dtype=bool)
    if m == 0:
        return mask.reshape(p.shape)
    order = np.argsort(pv)
    ranked = pv[order]
    below = ranked <= q * (np.arange(1, m + 1) / m)
    if below.any():
        cutoff = ranked[np.max(np.where(below))]
        sub = np.zeros(m, dtype=bool)
        sub[pv <= cutoff] = True
        mask[np.where(ok)[0]] = sub
    return mask.reshape(p.shape)


def cell_weights(lats: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    """cos(latitude) area weights broadcast to (y, x)."""
    w = np.cos(np.deg2rad(np.asarray(lats, dtype=float)))[:, None]
    return np.broadcast_to(w, shape).copy()


def regional_series(cube: np.ndarray, mask: np.ndarray, weights: np.ndarray) -> np.ndarray:
    """Latitude-weighted mean over the masked cells, per time step (missing cells skipped, never filled)."""
    w = np.where(mask, weights, 0.0)
    vals = np.where(mask[None], cube, np.nan)
    wv = np.where(np.isfinite(vals), w[None], 0.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.nansum(vals * wv, axis=(1, 2)) / wv.sum(axis=(1, 2))


def opposite_trends(
    slope: np.ndarray,
    significant: np.ndarray,
    weights: np.ndarray,
    min_cells: int = 3,
    min_fraction: float = 0.01,
) -> dict[str, Any]:
    """D1: label connected clusters of significantly rising and falling pixels (8-connectivity)."""
    valid_cells = np.isfinite(slope).sum()
    min_size = max(min_cells, int(np.ceil(min_fraction * valid_cells)))
    structure = np.ones((3, 3), dtype=int)
    result: dict[str, Any] = {}
    for name, sel in (("rising", significant & (slope > 0)), ("falling", significant & (slope < 0))):
        labels, n = ndimage.label(sel, structure=structure)
        best, best_size = None, 0
        sizes = ndimage.sum(np.ones_like(labels), labels, index=np.arange(1, n + 1)) if n else []
        for k, size in enumerate(sizes, start=1):
            if size >= min_size and size > best_size:
                best, best_size = k, int(size)
        result[name] = None if best is None else {"mask": labels == best, "cells": best_size}
    pos_area = float(weights[significant & (slope > 0)].sum())
    neg_area = float(weights[significant & (slope < 0)].sum())
    total = pos_area + neg_area
    found = result["rising"] is not None and result["falling"] is not None
    result.update(
        {
            "found": found,
            "rising_share": pos_area / total if total else 0.0,
            "falling_share": neg_area / total if total else 0.0,
            "divergence_score": pos_area / total if total else None,
        }
    )
    return result
