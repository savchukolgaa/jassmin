import numpy as np
import pandas as pd
import pytest

from jassmin_ml import splits


def test_time_split():
    frame = pd.DataFrame({"d": pd.to_datetime(["2025-01-01", "2025-06-01", "2025-09-01", "2026-01-01"])})
    train, valid, test = splits.time_split(frame, "d", "2025-06-01", "2026-01-01")
    assert list(train.index) == [0, 1]
    assert list(valid.index) == [2]
    assert list(test.index) == [3]
    with pytest.raises(ValueError):
        splits.time_split(frame, "d", "2026-01-01", "2025-01-01")


def ts(day: int, hour: int = 12) -> pd.Timestamp:
    return pd.Timestamp(2025, 1, day, hour, tz="UTC")


def test_leave_last_out_drops_the_target_session():
    purchases = pd.DataFrame(
        {
            "customer_key": ["u", "u", "solo"],
            "product_key": [1, 2, 7],
            "event_at": [ts(1), ts(5, 13), ts(2)],
            "session_id": ["s1", "s3", "s9"],
        }
    )
    interactions = pd.DataFrame(
        {
            "customer_key": ["u", "u", "u", "u", "u", "solo"],
            "product_key": [1, 1, 2, 2, 2, 7],
            "event_at": [ts(1, 11), ts(1), ts(3), ts(5, 12), ts(5, 13), ts(2)],
            "session_id": ["s1", "s1", "s2", "s3", "s3", "s9"],
        }
    )
    train, targets = splits.leave_last_out(purchases, interactions)
    assert targets.to_dict() == {"u": 2}
    # The view of item 2 in an earlier session stays; the target session (s3) is gone.
    assert sorted(train.loc[train.customer_key == "u", "session_id"]) == ["s1", "s1", "s2"]
    # A user with one distinct purchased item has no target and keeps every row.
    assert (train.customer_key == "solo").sum() == 1


def test_leave_last_out_needs_two_distinct_items():
    purchases = pd.DataFrame(
        {"customer_key": ["u", "u"], "product_key": [1, 1], "event_at": [ts(1), ts(2)], "session_id": ["a", "b"]}
    )
    _, targets = splits.leave_last_out(purchases, purchases)
    assert targets.empty


def panel() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "variant": ["a"] * 15,
            "units": [float(i) for i in range(15)],
            "censored": [False] * 7 + [True] + [False] * 7,
        }
    )


def test_censor_mask():
    frame = panel()
    masked = splits.censor_mask(frame["units"], frame["censored"])
    assert np.isnan(masked[7])
    assert masked[6] == 6
    with pytest.raises(ValueError):
        splits.censor_mask(frame["units"], frame["censored"].reset_index(drop=True).iloc[1:])


def test_lag_masked_never_reads_a_censored_day():
    lags = splits.lag_masked(panel(), "units", "censored", "variant", [1, 7])
    assert np.isnan(lags.loc[8, "units_lag1"])  # day 7 was censored
    assert lags.loc[9, "units_lag1"] == 8
    assert np.isnan(lags.loc[14, "units_lag7"])
    assert lags.loc[13, "units_lag7"] == 6


def test_lags_stay_within_their_series():
    frame = pd.concat([panel(), panel().assign(variant="b")], ignore_index=True)
    lags = splits.lag_masked(frame, "units", "censored", "variant", [1])
    assert np.isnan(lags.loc[15, "units_lag1"])


def test_seasonal_naive_falls_back_past_a_censored_day():
    forecast = splits.seasonal_naive(panel(), "units", "censored", "variant", season=7, fallbacks=1)
    assert forecast[13] == 6
    assert forecast[14] == 0  # day 7 was censored, so day 0 (two weeks back)
    assert np.isnan(forecast[3])
