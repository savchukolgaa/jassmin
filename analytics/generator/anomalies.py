"""Deliberate data-quality anomalies for the ETL work (#132) to detect and clean.

Each anomaly hits an exact number of rows, round(rate * rows), chosen with its own seeded stream,
so a run's rates are exactly the documented ones (README.md, "Anomaly catalogue"). The clean rows
are never modified in place: a changed row is a copy, so the simulation's clean tables stay
available (tests reconcile them).

Backorders (negative `stock_after` in `inventory_movements`) come from the simulation itself.
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np

import config
from ids import Ids
from pricing import money, to_kopiyky
from simulate import Output

Row = dict[str, Any]


def _sample(rng: random.Random, rows: list[Row], rate: float) -> list[int]:
    k = round(rate * len(rows))
    return sorted(rng.sample(range(len(rows)), k))


def _set(rows: list[Row], index: int, **changes: Any) -> None:
    rows[index] = {**rows[index], **changes}


def inject(output: Output, seed: int, start: datetime, end: datetime) -> dict[str, list[Row]]:
    """The raw tables: the simulation's tables with every anomaly applied (copies)."""
    stream = np.random.SeedSequence(seed).spawn(7)[6]
    rng = random.Random(int(stream.generate_state(1)[0]))
    ids = Ids(rng)
    rates = config.ANOMALY_RATES
    tables = {name: list(rows) for name, rows in output.tables.items()}
    sessions, events, users = tables["sessions"], tables["user_events"], tables["users"]
    orders, items = tables["orders"], tables["order_items"]

    # Missing device type (blocked or empty User-Agent), on sessions and on events.
    for i in _sample(rng, sessions, rates["sessions_missing_device_type"]):
        _set(sessions, i, device_type=None)
    for i in _sample(rng, events, rates["events_missing_device_type"]):
        _set(events, i, device_type=None)
    # Timezone drift: an old app version wrote timestamps as naive UTC strings.
    for i in _sample(rng, events, rates["events_naive_utc_timestamp"]):
        naive = events[i]["created_at"].astimezone(timezone.utc).replace(tzinfo=None)
        _set(events, i, created_at=naive.isoformat(timespec="milliseconds"))
    # Double-fired events (client retry): same row and timestamp, a new event id.
    for i in _sample(rng, events, rates["duplicate_events"]):
        original = events[i]
        ts = original["created_at"]
        stamp = ts if isinstance(ts, datetime) else datetime.fromisoformat(ts).replace(tzinfo=timezone.utc)
        events.append({**original, "event_id": ids.uuid7(stamp)})
    # Bot traffic: sessions with hundreds of product views a fraction of a second apart.
    products = output.catalog.products
    span = (end - start).total_seconds()
    for _ in range(config.BOT_SESSIONS):
        t0 = start + timedelta(seconds=rng.random() * (span - 3600))
        session_id, anon_id = ids.uuid7(t0), ids.uuid4()
        views = rng.randrange(*config.BOT_VIEWS)
        sessions.append({
            "session_id": session_id, "user_id": None, "anonymous_id": anon_id, "started_at": t0,
            "ended_at": t0 + timedelta(seconds=views * config.BOT_SECONDS_BETWEEN_VIEWS),
            "landing_page": "/", "traffic_source": "direct", "traffic_medium": "none",
            "traffic_campaign": None, "device_type": "desktop",
        })  # fmt: skip
        for k in range(views):
            product = products[rng.randrange(len(products))]
            variant = product.variants[5]
            ts = t0 + timedelta(seconds=k * config.BOT_SECONDS_BETWEEN_VIEWS)
            props = {
                "product_public_id": product.public_id, "variant_id": variant.public_id,
                "volume_ml": 5, "price": money(variant.price), "in_stock": True,
            }  # fmt: skip
            events.append({
                "event_id": ids.uuid7(ts), "user_id": None, "anonymous_id": anon_id,
                "session_id": session_id, "event_type": "product_view", "product_id": product.id,
                "event_properties": json.dumps(props, ensure_ascii=False, separators=(",", ":")),
                "source": "direct", "medium": "none", "campaign": None, "device_type": "desktop",
                "referrer": None, "created_at": ts,
            })  # fmt: skip

    # Users: missing phones, emails with stray spaces and upper case, staff test accounts.
    for i in _sample(rng, users, rates["users_missing_phone"]):
        _set(users, i, phone=None)
    for i in _sample(rng, users, rates["users_messy_email"]):
        _set(users, i, email=f"  {users[i]['email'].upper()} ")
    next_id = max((u["id"] for u in users), default=0)
    for n in range(config.TEST_ACCOUNTS):
        created = start + timedelta(seconds=rng.random() * span)
        users.append({
            "id": next_id + n + 1, "full_name": "Test Test", "email": f"test{n}@example.com",
            "password_hash": config.DEMO_PASSWORD_HASH, "phone": None,
            "acquisition_channel": "direct", "role": "customer", "last_login_at": created,
            "created_at": created, "first_touch_source": None, "first_touch_medium": None,
            "first_touch_campaign": None, "email_verified_at": None, "city": None,
            "marketing_opt_in": False, "locale": "uk",
        })  # fmt: skip

    # Orders: an extra zero in the total, shipped after completion, lowercase currency.
    for i in _sample(rng, orders, rates["orders_price_typo"]):
        _set(orders, i, total_amount=money(to_kopiyky(orders[i]["total_amount"]) * 10))
    completed = [i for i, o in enumerate(orders) if o["completed_at"] is not None]
    k = round(rates["orders_shipped_after_completed"] * len(completed))
    for i in sorted(rng.sample(completed, k)):
        _set(orders, i, shipped_at=orders[i]["completed_at"] + timedelta(days=1))
    for i in _sample(rng, orders, rates["orders_lowercase_currency"]):
        _set(orders, i, currency="uah")
    # Lines whose product was deleted later (the FK sets product_id to NULL).
    for i in _sample(rng, items, rates["order_items_deleted_product"]):
        _set(items, i, product_id=None)
    return tables
