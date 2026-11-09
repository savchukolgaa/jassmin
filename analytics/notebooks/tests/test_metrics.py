import math

import pandas as pd
import pytest

from jassmin_ml import metrics


def test_wape_by_hand():
    # |10-8| + |0-1| + |5-5| = 3 over 15.
    assert metrics.wape([10, 0, 5], [8, 1, 5]) == pytest.approx(0.2)


def test_wape_masks_rows():
    assert metrics.wape([10, 0, 5], [8, 99, 5], mask=[True, False, True]) == pytest.approx(2 / 15)


def test_wape_errors():
    with pytest.raises(ValueError):
        metrics.wape([1, 2], [1])
    with pytest.raises(ValueError):
        metrics.wape([0, 0], [1, 1])


def test_recall_at_k():
    recs = ["a", "b", "c", "d"]
    assert metrics.recall_at_k(recs, "c", k=3) == 1.0
    assert metrics.recall_at_k(recs, "d", k=3) == 0.0
    assert metrics.recall_at_k(recs, {"a", "z"}, k=3) == 0.5
    assert metrics.recall_at_k([1, 2, 3], 2, k=2) == 1.0


def test_ndcg_at_k():
    assert metrics.ndcg_at_k(["a", "b"], "a") == 1.0
    assert metrics.ndcg_at_k(["b", "a"], "a") == pytest.approx(1 / math.log2(3))
    assert metrics.ndcg_at_k(["b", "c"], "a") == 0.0
    assert metrics.ndcg_at_k(["a", "b", "c"], {"a", "b"}) == 1.0


def test_catalog_coverage():
    assert metrics.catalog_coverage([["a", "b"], ["b", "c"]], catalog_size=4) == 0.75
    assert metrics.catalog_coverage([["a", "b", "c"]], catalog_size=4, k=1) == 0.25


def test_ranking_report():
    report = metrics.ranking_report({"u1": ["a", "b"], "u2": ["c", "a"]}, {"u1": "a", "u2": "b"}, 4, k=2)
    assert report == {"recall@2": 0.5, "ndcg@2": 0.5, "coverage@2": 0.75}


def test_decile_table_groups_and_errors():
    predicted = pd.Series(range(20), dtype=float)
    actual = pd.Series([1.0] * 20)
    table = metrics.decile_table(predicted, actual)
    assert list(table.index) == list(range(1, 11))
    assert (table["customers"] == 2).all()
    assert table.loc[10, "predicted"] == 18 + 19
    assert table.loc[10, "relative_error"] == pytest.approx((37 - 2) / 2)


def test_decile_table_ties_still_make_equal_groups():
    table = metrics.decile_table(pd.Series([0.0] * 30), pd.Series([1.0] * 30))
    assert (table["customers"] == 3).all()


def test_merge_low_deciles():
    table = pd.DataFrame(
        {"customers": [10, 10, 10, 10], "predicted": [2.0, 4.0, 30.0, 50.0], "actual": [1.0, 5.0, 31.0, 49.0]},
        index=[1, 2, 3, 4],
    )
    table["relative_error"] = (table["predicted"] - table["actual"]).abs() / table["actual"]
    merged = metrics.merge_low_deciles(table, min_actual=30)
    assert list(merged["group"]) == ["1–3", "4"]
    assert merged.iloc[0]["actual"] == 37
    assert merged.iloc[0]["relative_error"] == pytest.approx(1 / 37)
    unchanged = metrics.merge_low_deciles(table, min_actual=1)
    assert list(unchanged["group"]) == ["1", "2", "3", "4"]
