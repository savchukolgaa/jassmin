"""Evaluation metrics for the #133 models."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence

import numpy as np
import pandas as pd


def wape(actual: Iterable[float], forecast: Iterable[float], mask: Iterable[bool] | None = None) -> float:
    """Weighted absolute percentage error, Σ|actual − forecast| / Σ actual.

    ``mask`` keeps only the rows where it's true (e.g. not a censored stock-out day).
    """
    a = np.asarray(list(actual), dtype=float)
    f = np.asarray(list(forecast), dtype=float)
    if a.shape != f.shape:
        raise ValueError("actual and forecast differ in length")
    if mask is not None:
        keep = np.asarray(list(mask), dtype=bool)
        a, f = a[keep], f[keep]
    total = a.sum()
    if total == 0:
        raise ValueError("WAPE is undefined when the actuals sum to 0")
    return float(np.abs(a - f).sum() / total)


def recall_at_k(recommended: Sequence[object], relevant: object | Iterable[object], k: int = 10) -> float:
    """Share of the relevant items found in the top ``k`` recommendations."""
    targets = _as_set(relevant)
    if not targets:
        raise ValueError("No relevant items")
    hits = len(targets.intersection(recommended[:k]))
    return hits / len(targets)


def ndcg_at_k(recommended: Sequence[object], relevant: object | Iterable[object], k: int = 10) -> float:
    """Normalised discounted cumulative gain with binary relevance."""
    targets = _as_set(relevant)
    if not targets:
        raise ValueError("No relevant items")
    dcg = sum(1.0 / np.log2(rank + 2) for rank, item in enumerate(recommended[:k]) if item in targets)
    ideal = sum(1.0 / np.log2(rank + 2) for rank in range(min(len(targets), k)))
    return float(dcg / ideal)


def catalog_coverage(recommendations: Iterable[Sequence[object]], catalog_size: int, k: int = 10) -> float:
    """Share of the catalog that appears in at least one top-``k`` list."""
    if catalog_size <= 0:
        raise ValueError("catalog_size must be positive")
    seen: set[object] = set()
    for items in recommendations:
        seen.update(items[:k])
    return len(seen) / catalog_size


def ranking_report(
    recommendations: Mapping[object, Sequence[object]],
    targets: Mapping[object, object],
    catalog_size: int,
    k: int = 10,
) -> dict[str, float]:
    """Mean Recall@k and NDCG@k over the users in ``targets``, and catalog coverage@k."""
    users = list(targets)
    return {
        f"recall@{k}": float(np.mean([recall_at_k(recommendations[u], targets[u], k) for u in users])),
        f"ndcg@{k}": float(np.mean([ndcg_at_k(recommendations[u], targets[u], k) for u in users])),
        f"coverage@{k}": catalog_coverage((recommendations[u] for u in users), catalog_size, k),
    }


def decile_table(predicted: pd.Series, actual: pd.Series, deciles: int = 10) -> pd.DataFrame:
    """Customers ranked by ``predicted`` into ``deciles`` equal groups (1 = lowest), with the sum of
    predicted and actual per group and the relative error |predicted − actual| / actual."""
    frame = pd.DataFrame({"predicted": predicted.astype(float), "actual": actual.astype(float)})
    # Rank first so ties don't make unequal groups.
    ranks = frame["predicted"].rank(method="first")
    frame["decile"] = pd.qcut(ranks, deciles, labels=range(1, deciles + 1)).astype(int)
    table = frame.groupby("decile").agg(
        customers=("predicted", "size"), predicted=("predicted", "sum"), actual=("actual", "sum")
    )
    table["relative_error"] = (table["predicted"] - table["actual"]).abs() / table["actual"]
    return table


def merge_low_deciles(table: pd.DataFrame, min_actual: float) -> pd.DataFrame:
    """``table`` with its lowest deciles merged, from decile 1 up, until the merged group has at
    least ``min_actual`` actual purchases (#133 plan, Q2). Unchanged when decile 1 already does."""
    rows = table.sort_index()
    merged: list[int] = []
    for decile, row in rows.iterrows():
        merged.append(int(decile))
        if rows.loc[merged, "actual"].sum() >= min_actual:
            break
    if len(merged) <= 1:
        return rows.assign(group=[str(d) for d in rows.index])
    head = rows.loc[merged].sum()
    head["relative_error"] = abs(head["predicted"] - head["actual"]) / head["actual"]
    label = f"{merged[0]}–{merged[-1]}"
    rest = rows.drop(index=merged).assign(group=lambda t: [str(d) for d in t.index])
    first = pd.DataFrame([head]).assign(group=label)
    first.index = [merged[0]]
    return pd.concat([first, rest])


def _as_set(items: object | Iterable[object]) -> set[object]:
    if isinstance(items, (str, bytes)) or not isinstance(items, Iterable):
        return {items}
    return set(items)
