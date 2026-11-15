"""Facts behind GET /opposite-trends, computed from the cached map JSON. No new statistics: cluster sizes come
from stats_engine's own opposite_trends (same FDR mask, same 8-connected clusters), and the cluster-size rule is
the one the seed recorded, or the engine's defaults for caches written before it was recorded."""
from __future__ import annotations

import inspect
from typing import Any

import numpy as np
from stats_engine import cell_weights, opposite_trends

ENGINE_RULE = {
    name: param.default
    for name, param in inspect.signature(opposite_trends).parameters.items()
    if name in ("min_cells", "min_fraction")
}
AREA_WORDS = {"warm_is_red": ("warming", "cooling"), "wet_is_blue": ("wetting", "drying"),
              "green_is_green": ("greening", "browning")}


def min_cluster_size(valid_cells: int, min_cells: int, min_fraction: float) -> int:
    """The minimum used by stats_engine.maps.opposite_trends: max(min_cells, ceil(min_fraction x valid cells))."""
    return max(int(min_cells), int(np.ceil(min_fraction * valid_cells)))


def opposite_detail(cached: dict[str, Any]) -> dict[str, Any]:
    """Counts, area shares, the minimum cluster size and the largest cluster on each side (even below the minimum)."""
    slope = np.array([[np.nan if v is None else v for v in row] for row in cached["slope_per_decade"]], dtype=float)
    significant = np.array(cached["fdr_significant"], dtype=bool) & np.isfinite(slope)
    weights = cell_weights(np.asarray(cached["grid"]["lat"], dtype=float), slope.shape)
    block = cached["opposite_trends"]
    rule = {name: block.get(name, default) for name, default in ENGINE_RULE.items()}
    # With no minimum the engine returns the largest cluster on each side, whatever its size.
    largest = opposite_trends(slope, significant, weights, min_cells=1, min_fraction=0.0)
    valid = int(np.isfinite(slope).sum())
    return {
        "n_cells_valid": valid,
        "n_significant": int(significant.sum()),
        "n_significant_rising": int((significant & (slope > 0)).sum()),
        "n_significant_falling": int((significant & (slope < 0)).sum()),
        "rising_share": block.get("rising_share", largest["rising_share"]),
        "falling_share": block.get("falling_share", largest["falling_share"]),
        **rule,
        "min_cluster_size": min_cluster_size(valid, rule["min_cells"], rule["min_fraction"]),
        "largest_rising_cluster_cells": largest["rising"]["cells"] if largest["rising"] else 0,
        "largest_falling_cluster_cells": largest["falling"]["cells"] if largest["falling"] else 0,
    }


def _cells(n: int) -> str:
    return f"{n:,} cell" + ("" if n == 1 else "s")


def opposite_sentence(detail: dict[str, Any], found: bool, polarity: str) -> str:
    """Facts only, built from the numbers in `detail`; says nothing about causes."""
    up, down = AREA_WORDS.get(polarity, ("rising", "falling"))
    n_up, n_down = detail["n_significant_rising"], detail["n_significant_falling"]
    if n_up + n_down == 0:
        return "No cells show a significant trend after false-discovery control, so no opposite-trend region is reported."
    head = (f"{n_up:,} significant rising {'cell' if n_up == 1 else 'cells'} and {n_down:,} significant falling "
            f"{'cell' if n_down == 1 else 'cells'} after false-discovery control")
    minimum, big_up, big_down = (detail["min_cluster_size"], detail["largest_rising_cluster_cells"],
                                 detail["largest_falling_cluster_cells"])
    if found:
        return (f"{head}; the largest {up} area ({_cells(big_up)}) and the largest {down} area ({_cells(big_down)}) "
                f"both reach the {minimum:,}-cell minimum, so both are reported as opposite-trend regions.")
    reasons = []
    for word, count, biggest in ((up, n_up, big_up), (down, n_down, big_down)):
        if count == 0:
            reasons.append(f"there are no significant {word} cells")
        elif biggest < minimum:
            reasons.append(f"the largest {word} area ({_cells(biggest)}) is below the {minimum:,}-cell minimum")
    if not reasons:  # cached `found` and the sizes disagree; say only what is certain
        reasons.append(f"the {up} and {down} areas do not both reach the {minimum:,}-cell minimum")
    return f"{head}; {' and '.join(reasons)}, so no single opposite-trend region is reported."
