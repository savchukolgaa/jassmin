"""A seasonally adjusted clock for the BG/NBD models (#133).

BG/NBD assumes each customer buys at a constant rate while alive. This shop's demand isn't constant:
8 March, 14 February and December multiply it, the summer halves it. A customer observed only through
a summer looks slower than they are, one observed through 8 March faster, and the holdout check is
biased by whichever season the calibration period ends in.

The fix is to measure time in *expected-demand* units instead of days: estimate a daily seasonal
index s(d) from the repeat-purchase rate, then a customer's clock advances by s(d) / 7 "adjusted
weeks" per day. Over a year the index averages 1, so an adjusted week is a calendar week on
average. The index is estimated with a Poisson GLM on daily *repeat* orders (the process BG/NBD
models), with the number of customers acquired so far as the exposure, so the shop's growth doesn't
leak into the seasonal terms.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.genmod.generalized_linear_model import GLMResultsWrapper

#: Gift windows of the Ukrainian perfume calendar, as (month, first day, last day).
GIFT_WINDOWS: dict[str, tuple[int, int, int]] = {
    "valentines_week": (2, 7, 14),
    "womens_day_week": (3, 1, 8),
    "black_friday_week": (11, 22, 30),
    "st_nicholas": (12, 1, 6),
    "new_year_rush": (12, 15, 31),
}


def seasonal_design(days: pd.Series) -> pd.DataFrame:
    """Month-of-year dummies (January is the baseline) and one dummy per gift window."""
    days = pd.to_datetime(days).reset_index(drop=True)
    months = pd.Categorical(days.dt.month, categories=range(1, 13))
    design = pd.get_dummies(months, prefix="month", drop_first=True, dtype=float)
    for name, (month, first, last) in GIFT_WINDOWS.items():
        design[name] = ((days.dt.month == month) & days.dt.day.between(first, last)).astype(float)
    return design


def fit_seasonal_index(
    days: pd.Series,
    repeat_orders: np.ndarray,
    customer_base: np.ndarray,
    fit_mask: np.ndarray,
    normalise_mask: np.ndarray,
) -> tuple[pd.Series, GLMResultsWrapper]:
    """The daily seasonal index for every day in ``days``, fitted on the days in ``fit_mask`` only.

    ``repeat_orders`` and ``customer_base`` are per day (orders that weren't a customer's first, and
    customers acquired before the day). The model is
    ``log E[repeat orders] = log(base) + const + trend · years + seasonal terms``, and the index is
    ``exp(seasonal terms)`` scaled to average 1 over the days in ``normalise_mask`` (a full year).
    """
    days = pd.to_datetime(days).reset_index(drop=True)
    seasonal = seasonal_design(days)
    years = (days - days.iloc[0]).dt.days.to_numpy() / 365.25
    design = sm.add_constant(seasonal.assign(trend=years))
    fit = np.asarray(fit_mask, dtype=bool) & (np.asarray(customer_base) > 0)
    model = sm.GLM(
        np.asarray(repeat_orders)[fit],
        design[fit],
        family=sm.families.Poisson(),
        offset=np.log(np.asarray(customer_base)[fit]),
    ).fit()
    index = np.exp(seasonal.to_numpy() @ model.params[seasonal.columns].to_numpy())
    index = index / index[np.asarray(normalise_mask, dtype=bool)].mean()
    return pd.Series(index, index=pd.DatetimeIndex(days), name="seasonal_index"), model


def adjusted_weeks(index: pd.Series) -> pd.Series:
    """The clock: adjusted weeks elapsed at the *end* of each day since the first day's start."""
    return (index.cumsum() / 7.0).rename("adjusted_weeks")


def rfm_on_clock(
    transactions: pd.DataFrame, clock: pd.Series, period_end: pd.Timestamp | str
) -> pd.DataFrame:
    """BG/NBD inputs per customer in adjusted weeks, from ``transactions`` (``customer_key``,
    ``order_date``; one row per customer and purchase day) up to and including ``period_end``.

    ``frequency`` = repeat purchase days, ``recency`` = first → last purchase, ``T`` = first purchase →
    end of ``period_end``.
    """
    end = pd.Timestamp(period_end)
    rows = transactions[transactions["order_date"] <= end]
    at = rows["order_date"].map(clock)
    grouped = at.groupby(rows["customer_key"])
    out = pd.DataFrame(
        {
            "frequency": grouped.count() - 1,
            "recency": grouped.max() - grouped.min(),
            "T": clock[end] - grouped.min(),
        }
    )
    out.index.name = "customer_id"
    return out.reset_index()
