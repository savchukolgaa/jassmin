"""End to end against PostgreSQL: create a throwaway synth database, migrate it with the app's
migrations, load raw.* and public.*, and check the constraint filter.

Needs a server: `SYNTH_TEST_DATABASE_URL`, else `DATABASE_URL` from the environment (CI sets it;
the repo's .env is deliberately not read here). Skipped without one, except in CI.
"""

from __future__ import annotations

import os

import pytest

import db
import generate

URL = os.environ.get("SYNTH_TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
# Skipped locally without a server; in CI a skip would hide the tests, so it fails instead.
if not URL and os.environ.get("CI"):
    raise RuntimeError("CI must set SYNTH_TEST_DATABASE_URL or DATABASE_URL for the load tests")
pytestmark = pytest.mark.skipif(not URL, reason="needs SYNTH_TEST_DATABASE_URL or DATABASE_URL")


@pytest.fixture(scope="module")
def database():
    import psycopg

    name = f"jassmin_synth_test_{os.getpid()}"
    yield name
    with psycopg.connect(db.with_database(URL, "postgres"), autocommit=True) as conn:
        conn.execute(f'drop database if exists "{name}" with (force)')


def test_load_raw_and_public(database, monkeypatch):
    import psycopg

    monkeypatch.setenv("SYNTH_DATABASE_URL", URL)
    for var in ("JASSMIN_SYNTH_URI", "JASSMINDB_URI"):
        monkeypatch.delenv(var, raising=False)
    args = ["--customers", "120", "--visitors", "150", "--seed", "5", "--database-name", database,
            "--load-app-schema"]  # fmt: skip
    assert generate.main(args) == 0
    # A second run replaces everything instead of adding to it.
    assert generate.main(args) == 0

    target = db.with_database(URL, database)
    with psycopg.connect(target) as conn:
        raw_orders = conn.execute("select count(*) from raw.orders").fetchone()[0]
        public_orders = conn.execute("select count(*) from public.orders").fetchone()[0]
        assert raw_orders > 0 and public_orders == raw_orders
        assert conn.execute("select count(*) from raw.generation_runs").fetchone()[0] == 1
        assert conn.execute("select count(*) from raw.customer_truth").fetchone()[0] == 120
        # The app's ledger invariant holds in public, and its daily view works.
        mismatched = conn.execute(
            """
            select count(*) from product_variants v
            where v.track_stock and v.stock_quantity <> (
              select coalesce(sum(quantity_delta), 0) from inventory_movements m where m.variant_id = v.id)
            """
        ).fetchone()[0]
        assert mismatched == 0
        conn.execute("select count(*) from inventory_daily").fetchone()
        # Naive raw timestamps were read as UTC.
        naive = conn.execute(
            "select event_id, created_at from raw.user_events where created_at !~ '\\+00:00$' limit 1"
        ).fetchone()
        if naive:
            loaded = conn.execute(
                "select created_at at time zone 'UTC' from public.user_events where event_id = %s::uuid", (naive[0],)
            ).fetchone()[0]
            assert loaded.isoformat(timespec="milliseconds") == naive[1]
        # Sequences continue after the loaded ids.
        next_id = conn.execute("select nextval(pg_get_serial_sequence('public.orders', 'id'))").fetchone()[0]
        assert next_id == conn.execute("select max(id) from public.orders").fetchone()[0] + 1


def test_public_load_drops_rows_the_app_would_refuse(database):
    import psycopg

    target = db.with_database(URL, database)
    generated = generate.generate(120, 150, generate.parse_day("2024-01-01"), generate.parse_day("2026-11-01"), 5)
    with psycopg.connect(target) as conn:
        with conn.transaction(force_rollback=True):
            conn.execute("update raw.order_items set quantity = '0' where id = '1'")  # CHECK quantity > 0
            conn.execute("update raw.orders set payment_method = 'barter' where id = '2'")  # CHECK
            conn.execute("update raw.users set email = 'not-a-user' where id = '3'")  # still valid
            conn.execute("update raw.order_items set variant_id = '999999' where id = '4'")  # FK
            conn.execute("update raw.payments set amount = 'abc' where id = '1'")  # not numeric
            result = db.load_public(conn, generated)
            items = conn.execute("select array_agg(id order by id) from public.order_items where id in (1, 4)").fetchone()[0]
            assert items is None
            orders = conn.execute("select count(*) from public.orders where id = 2").fetchone()[0]
            assert orders == 0
            assert conn.execute("select count(*) from public.payments where id = 1").fetchone()[0] == 0
            # Lines 1 and 4 are refused, and so are the lines of the refused order 2 (FK).
            expected = conn.execute(
                "select count(*) from raw.order_items where id not in ('1', '4') and order_id <> '2'"
            ).fetchone()[0]
            assert result["order_items"][1] == expected
            assert conn.execute("select count(*) from public.users where id = 3").fetchone()[0] == 1
