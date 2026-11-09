"""Train/test splits that respect time (#133)."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date

import numpy as np
import pandas as pd


def time_split(
    frame: pd.DataFrame, column: str, train_end: date | str, test_start: date | str
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """(train, validation, test) by ``column``: train ≤ ``train_end`` < validation < ``test_start``
    ≤ test. Nothing from a later period reaches an earlier one."""
    values = pd.to_datetime(frame[column])
    train_end_ts, test_start_ts = pd.Timestamp(train_end), pd.Timestamp(test_start)
    if train_end_ts >= test_start_ts:
        raise ValueError("train_end must be before test_start")
    train = frame[values <= train_end_ts]
    validation = frame[(values > train_end_ts) & (values < test_start_ts)]
    test = frame[values >= test_start_ts]
    return train, validation, test


def leave_last_out(
    purchases: pd.DataFrame,
    interactions: pd.DataFrame,
    user: str = "customer_key",
    item: str = "product_key",
    at: str = "event_at",
    session: str = "session_id",
) -> tuple[pd.DataFrame, pd.Series]:
    """Hold out each user's last purchased item, for users with at least two distinct purchased items.

    Returns the training interactions and the target item per user. A user's training rows are only
    those *before the session of the held-out purchase*: the views and cart adds that led to it
    would give the answer away. Rows of users without a target are kept whole.
    ``purchases`` has ``user, item, at, session``; ``interactions`` has ``user, item, at, session``.
    """
    ordered = purchases.sort_values([user, at, item])
    distinct = ordered.groupby(user)[item].nunique()
    eligible = distinct[distinct >= 2].index
    last = ordered[ordered[user].isin(eligible)].groupby(user).tail(1).set_index(user)
    targets = last[item]
    if targets.empty:
        return interactions, targets
    # The cut-off is the start of the held-out purchase's session (its earliest interaction).
    session_start = interactions.groupby(session)[at].min()
    cutoff = last[session].map(session_start).fillna(last[at])
    cutoff = cutoff.where(cutoff <= last[at], last[at])
    limit = interactions[user].map(cutoff)
    keep = limit.isna() | (interactions[at] < limit)
    return interactions[keep], targets


def censor_mask(values: pd.Series, censored: pd.Series) -> pd.Series:
    """``values`` with censored days set to NaN, so lags and baselines never read them."""
    if not values.index.equals(censored.index):
        raise ValueError("values and censored must share an index")
    return values.mask(censored.astype(bool))


def lag_masked(
    frame: pd.DataFrame, value: str, censored: str, by: str, lags: Sequence[int]
) -> pd.DataFrame:
    """Lag columns ``{value}_lag{n}`` per series ``by`` (rows ordered by date within each series),
    NaN wherever the lagged day was censored."""
    masked = censor_mask(frame[value].astype(float), frame[censored])
    out = pd.DataFrame(index=frame.index)
    grouped = masked.groupby(frame[by])
    for n in lags:
        out[f"{value}_lag{n}"] = grouped.shift(n)
    return out


def seasonal_naive(
    frame: pd.DataFrame, value: str, censored: str, by: str, season: int = 7, fallbacks: int = 1
) -> pd.Series:
    """Same day one ``season`` earlier; when that day was censored, ``season`` × 2, and so on
    ``fallbacks`` more times. NaN when every candidate was censored or before the data starts."""
    masked = censor_mask(frame[value].astype(float), frame[censored])
    grouped = masked.groupby(frame[by])
    forecast = pd.Series(np.nan, index=frame.index)
    for step in range(1, fallbacks + 2):
        forecast = forecast.fillna(grouped.shift(season * step))
    return forecast
