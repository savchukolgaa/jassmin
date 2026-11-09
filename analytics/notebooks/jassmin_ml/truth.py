"""The generator's ground truth (#131), for evaluating models only: never use it as a feature."""

from __future__ import annotations

import hashlib

import pandas as pd

from jassmin_ml.db import read_mart

SEGMENTS = ["loyal", "regular", "occasional", "one_time"]

#: segment -> (share of customers, mean orders per year while alive, churn probability per order),
#: copied from analytics/generator/config.py for the comparison tables.
PLANTED = {
    "loyal": (0.08, 6.0, 0.06),
    "regular": (0.22, 3.0, 0.18),
    "occasional": (0.35, 1.3, 0.40),
    "one_time": (0.35, 0.6, 0.85),
}


def customer_key(user_id: int | str) -> str:
    """The warehouse's ``customer_key`` of a registered user (``macros/keys.sql``)."""
    return hashlib.md5(f"u:{user_id}".encode()).hexdigest()


def load_truth() -> pd.DataFrame:
    """``raw.customer_truth`` typed, with the warehouse's ``customer_key``."""
    truth = read_mart(
        """
        select user_id::bigint as user_id, segment, purchase_rate::float8 as purchase_rate,
          churn_probability::float8 as churn_probability, favourite_family, usual_device,
          acquisition_channel, nullif(churned_at, '')::timestamptz as churned_at
        from raw.customer_truth
        """
    )
    truth["customer_key"] = truth["user_id"].map(customer_key)
    truth["segment"] = pd.Categorical(truth["segment"], categories=SEGMENTS, ordered=True)
    return truth
