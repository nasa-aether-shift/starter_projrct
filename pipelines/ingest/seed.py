"""make seed: precompute every demo result into data/cache so the demo never calls NASA live.

Reads   data/raw/<variable>__<region>.csv      (from sources.py)
        data/cache/grids/<variable>__<region>.npz
Writes  data/cache/results/<variable>__<region>.json   (POST /trend payload, minus verdict text)
        data/cache/maps/<variable>__<region>.json      (trend map + FDR + opposite trends)
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "stats_engine"))

from stats_engine import (  # noqa: E402
    MonthlySeries, analyze_series, annual_cube, benjamini_hochberg, cell_weights, opposite_trends, pixel_trends, regional_series,
)

CACHE = ROOT / "data" / "cache"


def seed_series(horizon_sims: int = 1000) -> None:
    out_dir = CACHE / "results"
    out_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted((ROOT / "data" / "raw").glob("*__*.csv")):
        with path.open() as f:
            rows = list(csv.DictReader(f))
        s = MonthlySeries(
            np.array([r["time"] for r in rows], dtype="datetime64[M]"),
            np.array([float(r["value"]) if r["value"] else np.nan for r in rows]),
        )
        res = analyze_series(s, horizon_sims=horizon_sims)
        (out_dir / f"{path.stem}.json").write_text(json.dumps(res))
        print(f"series {path.stem}: grade {res['evidence_grade']['grade']}, slope/decade {res['trend']['sen_slope_per_decade']:.4g}")


def seed_maps(q: float = 0.10, max_cells: int = 100_000) -> None:
    out_dir = CACHE / "maps"
    out_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted((CACHE / "grids").glob("*.npz")):
        g = np.load(path)
        time, lat, lon, cube = g["time"].astype("datetime64[M]"), g["lat"], g["lon"], g["cube"]
        step = int(np.ceil(np.sqrt(cube.shape[1] * cube.shape[2] / max_cells)))  # downsample big grids
        lat_d, lon_d, cube_d = lat[::step], lon[::step], cube[:, ::step, ::step]
        years, annual = annual_cube(time, cube_d)
        m = pixel_trends(years, annual)
        sig = benjamini_hochberg(m["p"], q)
        w = cell_weights(lat_d, sig.shape)
        opp = opposite_trends(m["slope_per_decade"], sig, w)
        clusters = {}
        for name in ("rising", "falling"):
            if opp[name] is None:
                clusters[name] = None
                continue
            series = regional_series(cube_d, opp[name]["mask"], w)
            res = analyze_series(MonthlySeries(time, series), compute_horizon=False)
            clusters[name] = {"cells": opp[name]["cells"], "mask_indices": np.argwhere(opp[name]["mask"]).tolist(), "result": res}

        def clean(a):
            return [[None if not np.isfinite(v) else round(float(v), 5) for v in row] for row in a]

        payload = {
            "grid": {"lat": lat_d.round(4).tolist(), "lon": lon_d.round(4).tolist(), "downsample_step": step},
            "slope_per_decade": clean(m["slope_per_decade"]),
            "p": clean(m["p"]),
            "fdr_significant": sig.astype(int).tolist(),
            "fdr_level": q,
            "method": "Sen slope and Mann-Kendall on annual means per pixel; Benjamini-Hochberg FDR (Wilks 2016).",
            "opposite_trends": {
                "found": opp["found"], "rising_share": opp["rising_share"], "falling_share": opp["falling_share"],
                "divergence_score": opp["divergence_score"], "clusters": clusters,
                "sentence": "The same variable is rising in some places and falling in others in this region."
                if opp["found"] else "No opposite trends found: significant changes here all point the same way, or there are none.",
            },
        }
        (out_dir / f"{path.stem}.json").write_text(json.dumps(payload))
        print(f"map {path.stem}: {int(sig.sum())} significant cells after FDR; opposite trends found = {opp['found']}")


if __name__ == "__main__":
    seed_series()
    seed_maps()
