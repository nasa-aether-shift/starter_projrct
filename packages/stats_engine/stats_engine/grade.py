"""Evidence grade A-D (rubric in the team doc, Section 5). First match wins.

Thresholds live in grade_thresholds.yaml so they can be reviewed and tested.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

_T = yaml.safe_load((Path(__file__).parent / "grade_thresholds.yaml").read_text())


def evidence_grade(
    *,
    p_modified: float,
    years: float,
    coverage: float,
    direction_sign: float,
    annual_sign: float,
    annual_p: float,
    seasonal_sign: float,
    seasonal_p: float,
    change_point_mid: bool,
) -> dict[str, Any]:
    a, b, c = _T["A"], _T["B"], _T["C"]
    p_txt = "< 0.001" if p_modified < 0.001 else f"= {p_modified:.3f}"
    reasons: list[str] = [f"Autocorrelation-corrected Mann-Kendall p {p_txt}", f"{years:.0f} years of data", f"{coverage:.0%} of months available"]

    annual_same = annual_sign == direction_sign
    if (
        p_modified < a["p_max"]
        and years >= a["years_min"]
        and coverage >= a["coverage_min"]
        and annual_same
        and annual_p < a["robust_p_max"]
        and seasonal_sign == direction_sign
        and seasonal_p < a["robust_p_max"]
        and not change_point_mid
    ):
        return {"grade": "A", "label": "Strong evidence", "reasons": reasons + ["Annual and seasonal checks agree", "No abrupt shift mid-record"]}

    b_ok = p_modified < b["p_max"] and years >= b["years_min"] and coverage >= b["coverage_min"] and annual_same
    if b_ok:
        return {"grade": "B", "label": "Moderate evidence", "reasons": reasons + ["Annual means point the same way"]}

    if p_modified < c["p_max"] or p_modified < b["p_max"]:
        why = []
        if years < b["years_min"]:
            why.append(f"record shorter than {b['years_min']} years")
        if coverage < b["coverage_min"]:
            why.append("too many missing months")
        if not annual_same:
            why.append("annual means disagree in direction")
        if p_modified >= b["p_max"]:
            why.append("p-value between 0.05 and 0.10")
        return {"grade": "C", "label": "Suggestive only", "reasons": reasons + [f"Held back because: {', '.join(why)}" if why else "Weak signal"]}

    return {"grade": "D", "label": "No significant trend", "reasons": reasons}
