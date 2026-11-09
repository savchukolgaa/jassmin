"""End to end: load fixtures/raw_fixture.sql into a throwaway jassmin_synth_test_<pid> database, run
`dbt build` and `dbt docs generate` through wh.py, and check what the cleaning and the marts produced.

Needs a PostgreSQL server: ``WAREHOUSE_TEST_SERVER_URL`` (any database on it, e.g.
``postgres://postgres@localhost:5432/postgres``), else the app's ``DATABASE_URL`` (environment or
the repo's ``.env``). Skipped when neither is set.
"""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Iterator
from datetime import date
from decimal import Decimal
from pathlib import Path

import psycopg
import pytest

from scripts.check_docs import main as check_docs
from wh import PROJECT_DIR, REPO_ROOT, read_dotenv, with_database

SERVER_URL = os.environ.get("WAREHOUSE_TEST_SERVER_URL") or {
    **read_dotenv(REPO_ROOT / ".env"),
    **os.environ,
}.get("DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not SERVER_URL, reason="needs WAREHOUSE_TEST_SERVER_URL or DATABASE_URL (a PostgreSQL server)"
)

TEST_DB = f"jassmin_synth_test_{os.getpid()}"


def wh(*args: str, url: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "WAREHOUSE_DATABASE_URL": url, "PYTHONIOENCODING": "utf-8"}
    return subprocess.run(
        [sys.executable, str(PROJECT_DIR / "wh.py"), *args],
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


@pytest.fixture(scope="module")
def built() -> Iterator[str]:
    assert SERVER_URL
    admin_url = with_database(SERVER_URL, "postgres")
    with psycopg.connect(admin_url, autocommit=True) as admin:
        admin.execute(f'drop database if exists "{TEST_DB}" with (force)')
        admin.execute(f'create database "{TEST_DB}"')
    url = with_database(SERVER_URL, TEST_DB)
    try:
        fixture = (PROJECT_DIR / "fixtures" / "raw_fixture.sql").read_text(encoding="utf-8")
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute(fixture)  # A trusted, multi-statement script.
        result = wh("build", url=url)
        assert result.returncode == 0, result.stdout + result.stderr
        docs = wh("docs", "generate", url=url)
        assert docs.returncode == 0, docs.stdout + docs.stderr
        yield url
    finally:
        with psycopg.connect(admin_url, autocommit=True) as admin:
            admin.execute(f'drop database if exists "{TEST_DB}" with (force)')


def rows(url: str, sql: str) -> list[tuple]:
    with psycopg.connect(url) as conn:
        return conn.execute(sql).fetchall()


def one(url: str, sql: str):
    result = rows(url, sql)
    assert len(result) == 1 and len(result[0]) == 1, result
    return result[0][0]


def test_every_column_is_documented(built: str) -> None:
    assert check_docs(Path(PROJECT_DIR) / "target") == 0


def test_double_fired_events_are_dropped_and_naive_timestamps_read_as_utc(built: str) -> None:
    assert one(built, "select count(*) from raw.user_events") - 1 == one(
        built, "select count(*) from staging.stg_user_events"
    )
    naive = rows(
        built,
        "select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') "
        "from staging.stg_user_events where had_naive_timestamp",
    )
    assert naive == [("2025-01-10 08:30",)]


def test_bots_and_test_accounts_are_flagged_in_staging_and_gone_from_marts(built: str) -> None:
    assert one(built, "select count(*) from staging.stg_sessions where is_bot") == 1
    assert one(built, "select count(*) from staging.stg_users where is_test_account") == 1
    assert one(built, "select count(*) from marts.fct_sessions") == 9  # 11 - bot - test account
    assert one(built, "select count(*) from marts.fct_orders where order_id = 7") == 0
    assert one(built, "select count(*) from marts.dim_customers") == 4  # 3 users + 1 guest


def test_missing_devices_become_unknown(built: str) -> None:
    assert one(
        built,
        "select device_type from marts.fct_sessions "
        "where session_id = '01940000-0000-7000-8000-000000000002'",
    ) == "unknown"


def test_price_typo_currency_and_timeline_are_fixed(built: str) -> None:
    order = rows(
        built,
        "select total_amount, raw_total_amount, is_price_outlier, currency, "
        "to_char(shipped_at at time zone 'Europe/Kyiv', 'YYYY-MM-DD'), timeline_fixed_from_history "
        "from marts.fct_orders where order_id = 2",
    )
    assert order == [(Decimal("1088.00"), Decimal("10880.00"), True, "UAH", "2025-01-11", True)]
    assert one(built, "select count(*) from marts.fct_orders where currency <> 'UAH'") == 0


def test_a_deleted_products_line_is_recovered_from_its_size_or_unknown(built: str) -> None:
    lines = rows(
        built,
        "select order_item_id, product_key, is_orphan_product from marts.fct_order_items "
        "where order_item_id in (4, 9) order by 1",
    )
    # Line 9 kept its size (50 ml Sauvage): recovered. Line 4 kept nothing: the unknown product.
    assert lines == [(4, -1, True), (9, 1, True)]


def test_a_guests_orders_are_one_customer(built: str) -> None:
    assert one(
        built, "select count(distinct customer_key) from marts.fct_orders where order_id in (5, 6)"
    ) == 1


def test_a_backorder_is_a_censored_stock_out(built: str) -> None:
    day = rows(
        built,
        "select closing_stock, backorder_units, is_stock_out, is_demand_censored "
        "from marts.fct_inventory_daily where variant_id = 13 and day = date '2025-03-10'",
    )
    assert day == [(0, 1, True, True)]


def test_churn_labels_are_point_in_time(built: str) -> None:
    labels = dict(
        rows(
            built,
            "select f.snapshot_date, f.churned_next_90d from marts.mart_customer_features as f "
            "join marts.fct_orders as o on o.customer_key = f.customer_key and o.order_id = 2",
        )
    )
    # Ivan's only order after 1 February was cancelled because the payment failed: churned.
    assert labels[date(2025, 2, 1)] is True
    # The data ends on 31 August: no label for snapshots whose 90 days run past it.
    assert labels[date(2025, 7, 1)] is None
    olena = dict(
        rows(
            built,
            "select f.snapshot_date, f.return_rate from marts.mart_customer_features as f "
            "join marts.fct_orders as o on o.customer_key = f.customer_key and o.order_id = 1",
        )
    )
    # Order 3 was returned on 20 March: the return only counts from the April snapshot on.
    assert olena[date(2025, 3, 1)] == Decimal("0")
    assert olena[date(2025, 4, 1)] == Decimal("0.5")
