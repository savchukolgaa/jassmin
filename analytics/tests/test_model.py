"""The simulation's clean output: the shop's rules and the customer model hold."""

from __future__ import annotations

from collections import Counter, defaultdict

import config
from pricing import to_kopiyky


def test_totals_reconcile_before_anomalies(run):
    orders = run.output.tables["orders"]
    allocated: dict[int, int] = defaultdict(int)
    for item in run.output.tables["order_items"]:
        allocated[item["order_id"]] += to_kopiyky(item["discount_allocated"])
    for o in orders:
        subtotal, discount = to_kopiyky(o["subtotal"]), to_kopiyky(o["discount_amount"])
        assert subtotal - discount == to_kopiyky(o["total_amount"]), o["id"]
        assert allocated[o["id"]] == discount, o["id"]
        assert o["free_shipping"] == (subtotal - discount >= 150_000)


def test_nothing_of_a_user_before_signup(run):
    created = {u["id"]: u["created_at"] for u in run.output.tables["users"]}
    for o in run.output.tables["orders"]:
        if o["user_id"] is not None:
            assert o["created_at"] >= created[o["user_id"]]
    for s in run.output.tables["sessions"]:
        if s["user_id"] is not None:
            assert s["started_at"] >= created[s["user_id"]]
    for c in run.output.tables["carts"]:
        if c["user_id"] is not None:
            assert c["created_at"] >= created[c["user_id"]] or c["status"] == "converted"


def test_seasonal_peaks(run):
    days = Counter(o["created_at"].astimezone(config.KYIV).date() for o in run.output.tables["orders"])
    years = sorted({d.year for d in days})
    march = sum(v for d, v in days.items() if d.month == 3 and d.day <= 8) / (8 * len(years))
    july = sum(v for d, v in days.items() if d.month == 7) / (31 * len(years))
    assert march > 2 * july


def test_lifecycle_in_order(run):
    history = defaultdict(list)
    for h in run.output.tables["order_status_history"]:
        history[h["order_id"]].append(h)
    for o in run.output.tables["orders"]:
        rows = sorted(history[o["id"]], key=lambda h: h["id"])
        assert rows[0]["status"] == "pending" and rows[0]["source"] == "checkout"
        assert rows[-1]["status"] == o["status"]
        assert [h["changed_at"] for h in rows] == sorted(h["changed_at"] for h in rows)
        stamps = [o[k] for k in ("created_at", "shipped_at", "arrived_at", "completed_at") if o[k]]
        assert stamps == sorted(stamps)
        if o["waybill_number"] is not None:
            assert len(o["waybill_number"]) == 14 and o["waybill_number"].isdigit()


def test_every_status_and_cart_outcome_occurs(run):
    statuses = Counter(o["status"] for o in run.output.tables["orders"])
    for status in ("completed", "cancelled", "unclaimed", "returned"):
        assert statuses[status] > 0, status
    unclaimed = [o for o in run.output.tables["orders"] if o["status"] == "unclaimed"]
    assert sum(o["payment_method"] == "cod" for o in unclaimed) > len(unclaimed) / 2
    carts = Counter(c["status"] for c in run.output.tables["carts"])
    assert carts["abandoned"] > 0 and carts["converted"] == len(run.output.tables["orders"])


def test_one_active_cart_per_owner(run):
    active = [c for c in run.output.tables["carts"] if c["status"] == "active"]
    users = [c["user_id"] for c in active if c["user_id"] is not None]
    assert len(users) == len(set(users))


def test_ledgers(run):
    raw = run.output.tables["inventory_movements"]
    stock = {v["id"]: v["stock_quantity"] for v in run.output.tables["product_variants"]}
    totals: dict[int, int] = defaultdict(int)
    for m in raw:
        assert m["quantity_delta"] != 0
        totals[m["variant_id"]] += m["quantity_delta"]
    for vid, total in totals.items():
        assert total == stock[vid]
    clean: dict[int, int] = defaultdict(int)
    for m in run.output.clean_inventory:
        clean[m["variant_id"]] += m["quantity_delta"]
        assert m["stock_after"] == clean[m["variant_id"]] >= 0
    assert dict(clean) == {vid: s for vid, s in run.output.clean_stock.items() if vid in clean}
    reasons = Counter(m["reason"] for m in raw)
    assert reasons["receipt"] > 0 and reasons["sale"] > 0 and reasons["return"] > 0


def test_segments_drive_purchases(run):
    orders = Counter(o["user_id"] for o in run.output.tables["orders"])
    by_segment: dict[str, list[int]] = defaultdict(list)
    for truth in run.output.customer_truth:
        by_segment[truth["segment"]].append(orders[truth["user_id"]])
    mean = {s: sum(v) / len(v) for s, v in by_segment.items()}
    assert mean["loyal"] > mean["regular"] > mean["occasional"] > mean["one_time"]
    shares = {s: len(v) / len(run.output.customer_truth) for s, v in by_segment.items()}
    for segment, (share, _, _) in config.SEGMENTS.items():
        assert abs(shares[segment] - share) < 0.05, segment


def test_mostly_phones_and_social_traffic(run):
    devices = Counter(s["device_type"] for s in run.output.tables["sessions"])
    assert devices["mobile"] > devices["desktop"] + devices["tablet"]
    sources = Counter(s["traffic_source"] for s in run.output.tables["sessions"])
    assert sources["instagram"] == max(sources.values())
