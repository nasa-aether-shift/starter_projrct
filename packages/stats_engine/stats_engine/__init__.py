"""Earth Data Detective statistics engine (no web code)."""
from .core import MonthlySeries, analyze_series, mann_kendall, modified_mann_kendall, seasonal_mann_kendall, theil_sen, pettitt, deseasonalize
from .grade import evidence_grade
from .maps import annual_cube, pixel_trends, benjamini_hochberg, opposite_trends, regional_series, cell_weights

__all__ = [
    "MonthlySeries", "analyze_series", "mann_kendall", "modified_mann_kendall", "seasonal_mann_kendall",
    "theil_sen", "pettitt", "deseasonalize", "evidence_grade",
    "annual_cube", "pixel_trends", "benjamini_hochberg", "opposite_trends", "regional_series", "cell_weights",
]
