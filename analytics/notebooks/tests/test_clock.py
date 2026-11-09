import numpy as np
import pandas as pd
import pytest

from jassmin_ml import clock


def test_seasonal_design_columns():
    days = pd.Series(pd.to_datetime(["2025-01-10", "2025-03-05", "2025-12-20"]))
    design = clock.seasonal_design(days)
    assert "month_1" not in design  # January is the baseline
    assert list(design.loc[1, ["month_3", "womens_day_week"]]) == [1.0, 1.0]
    assert design.loc[2, "new_year_rush"] == 1.0
    assert design.loc[0].sum() == 0.0


def test_recovers_a_planted_seasonality_despite_growth():
    rng = np.random.default_rng(1)
    days = pd.Series(pd.date_range("2024-01-01", "2025-12-31", freq="D"))
    planted = np.where(days.dt.month == 7, 0.5, 1.0) * np.where(
        (days.dt.month == 3) & (days.dt.day <= 8), 3.0, 1.0
    )
    base = np.linspace(500, 5000, len(days))  # the shop grows tenfold
    orders = rng.poisson(0.01 * base * planted)
    index, _ = clock.fit_seasonal_index(
        days, orders, base, fit_mask=np.ones(len(days), bool), normalise_mask=(days.dt.year == 2025).to_numpy()
    )
    assert index[days.dt.year.to_numpy() == 2025].mean() == pytest.approx(1.0)
    july, june = index["2025-07-15"], index["2025-06-15"]
    assert july / june == pytest.approx(0.5, rel=0.1)
    assert index["2025-03-05"] / index["2025-03-20"] == pytest.approx(3.0, rel=0.1)


def test_adjusted_weeks_and_rfm():
    days = pd.date_range("2025-01-01", periods=21, freq="D")
    index = pd.Series(1.0, index=days)
    weeks = clock.adjusted_weeks(index)
    assert weeks.iloc[6] == pytest.approx(1.0)
    tx = pd.DataFrame(
        {"customer_key": ["a", "a", "a", "b"], "order_date": pd.to_datetime(["2025-01-01", "2025-01-08", "2025-01-20", "2025-01-15"])}
    )
    rfm = clock.rfm_on_clock(tx, weeks, "2025-01-15").set_index("customer_id")
    assert rfm.loc["a", "frequency"] == 1  # the 20th is after the period end
    assert rfm.loc["a", "recency"] == pytest.approx(1.0)
    assert rfm.loc["a", "T"] == pytest.approx(2.0)
    assert rfm.loc["b", "frequency"] == 0
    assert rfm.loc["b", "T"] == pytest.approx(0.0)
