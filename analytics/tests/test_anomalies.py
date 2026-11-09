"""Every anomaly in the README catalogue is in the raw layer at its documented rate (±30 %)."""

from __future__ import annotations

import csv
import io
import math
from collections import Counter

import pytest

import config
import frames
from pricing import to_kopiyky

NULL = frames.NULL


def table(run, name: str) -> list[dict[str, str]]:
    reader = csv.reader(io.StringIO(run.raw[name]))
    return [dict(zip(frames.COLUMNS[name], row, strict=True)) for row in reader]


def near(measured: float, rate: float) -> bool:
    return abs(measured - rate) <= 0.3 * rate


@pytest.fixture(scope="module")
def raw(run):
    return {name: table(run, name) for name in ("sessions", "user_events", "users", "orders", "order_items",
                                                 "inventory_movements")}  # fmt: skip


def bot_sessions(raw) -> set[str]:
    views = Counter(e["session_id"] for e in raw["user_events"] if e["event_type"] == "product_view")
    return {sid for sid, n in views.items() if n >= config.BOT_VIEWS[0]}


def test_bot_sessions(raw):
    assert len(bot_sessions(raw)) == config.BOT_SESSIONS


def test_missing_device_type(raw):
    bots = bot_sessions(raw)
    sessions = [s for s in raw["sessions"] if s["session_id"] not in bots]
    events = [e for e in raw["user_events"] if e["session_id"] not in bots]
    rates = config.ANOMALY_RATES
    assert near(sum(s["device_type"] == NULL for s in sessions) / len(sessions), rates["sessions_missing_device_type"])
    assert near(sum(e["device_type"] == NULL for e in events) / len(events), rates["events_missing_device_type"])


def test_double_fired_events(raw, run):
    bots = bot_sessions(raw)
    keys = Counter(
        (e["session_id"], e["event_type"], e["created_at"], e["event_properties"])
        for e in raw["user_events"] if e["session_id"] not in bots
    )  # fmt: skip
    extra = sum(n - 1 for n in keys.values())
    assert near(extra / len(run.output.tables["user_events"]), config.ANOMALY_RATES["duplicate_events"])


def test_naive_timestamps(raw, run):
    naive = sum(not e["created_at"].endswith("+00:00") for e in raw["user_events"])
    assert near(naive / len(run.output.tables["user_events"]), config.ANOMALY_RATES["events_naive_utc_timestamp"])


def test_users(raw):
    users = raw["users"]
    tests = [u for u in users if u["email"].endswith("@example.com")]
    assert len(tests) == config.TEST_ACCOUNTS
    real = [u for u in users if u not in tests]
    assert near(sum(u["phone"] == NULL for u in real) / len(real), config.ANOMALY_RATES["users_missing_phone"])
    messy = sum(u["email"] != u["email"].strip().lower() for u in real)
    assert near(messy / len(real), config.ANOMALY_RATES["users_messy_email"])


def test_orders(raw):
    orders = raw["orders"]
    typos = sum(
        to_kopiyky(o["subtotal"]) - to_kopiyky(o["discount_amount"]) != to_kopiyky(o["total_amount"]) for o in orders
    )
    assert near(typos / len(orders), config.ANOMALY_RATES["orders_price_typo"])
    completed = [o for o in orders if o["completed_at"] != NULL]
    late = sum(o["shipped_at"] > o["completed_at"] for o in completed)
    assert near(late / len(completed), config.ANOMALY_RATES["orders_shipped_after_completed"])
    lower = sum(o["currency"] == "uah" for o in orders)
    assert near(lower / len(orders), config.ANOMALY_RATES["orders_lowercase_currency"])


def test_deleted_products(raw):
    items = raw["order_items"]
    gone = sum(i["product_id"] == NULL for i in items)
    assert near(gone / len(items), config.ANOMALY_RATES["order_items_deleted_product"])


def test_backorders_make_stock_negative(raw, run):
    assert any(int(m["stock_after"]) < 0 for m in raw["inventory_movements"])
    stats = run.output.stats
    assert stats["out_of_stock_adds"] >= 20
    # A per-shopper probability, not an exact count like the others: allow 3 binomial sigmas.
    n, p = stats["out_of_stock_adds"], config.BACKORDER_SHARE
    assert abs(stats["backorder_adds"] / n - p) <= 3 * math.sqrt(p * (1 - p) / n)
