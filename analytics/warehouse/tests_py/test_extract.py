"""End to end (#183): a throwaway app database, migrated with the app's own migrations and filled
with rows whose personal values are unique markers; then ``setup.py``, ``extract.py`` and
``wh.py build --target prod`` into a throwaway ``jassmin_wh_test_<pid>``. No marker may appear
anywhere in the warehouse, the extract role can't read or write more than it should, and the app's
database is left exactly as it was. Last, when ``analytics/dashboard`` is installed, the Evidence site
builds from the marts as the reader role.

Needs a PostgreSQL server where the URL's user is a superuser (it creates roles):
``WAREHOUSE_TEST_SERVER_URL``, else the app's ``DATABASE_URL``. Skipped without one; and pnpm, which
runs the app's migrations.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg
import pytest

from extract import extract, setup
from extract.allowlist import TABLES
from wh import PROJECT_DIR, REPO_ROOT, read_dotenv, with_database

SERVER_URL = os.environ.get("WAREHOUSE_TEST_SERVER_URL") or {
    **read_dotenv(REPO_ROOT / ".env"),
    **os.environ,
}.get("DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not SERVER_URL or not shutil.which("pnpm"),
    reason="needs WAREHOUSE_TEST_SERVER_URL or DATABASE_URL (a PostgreSQL superuser) and pnpm",
)

PID = os.getpid()
APP_DB = f"jassmin_app_test_{PID}"
WH_DB = f"jassmin_wh_test_{PID}"
PREFIX = f"wh_test_{PID}"
KEY = "test-pseudonym-key-" + "x" * 32

#: Personal values planted in the app's tables; none may reach the warehouse in any form.
MARKERS = {
    "name": "Markername Olena",
    "email": "marker.olena@gmail.com",
    "password_hash": "$argon2id$markerhash",
    "phone": "+380509990001",
    "guest_name": "Markerguest Ivan",
    "guest_email": "Marker.Guest@ukr.net",
    "guest_phone": "+380509990002",
    "address": "Markerstreet 12, Nova Poshta 7",
    "waybill": "20459990001234",
    "reset_token": "markertoken123",
    "visitor_cookie": "markeranon-0001",
    "search_query": "markerquery olena",
    "referrer_path": "markerinbox",
    "payment_callback": "markercallbackphone",
    "provider_payment_id": "markerppid",
    "staff_note": "markernote from Ivan",
    "chat_text": "markerchat my wife Olena likes roses",
    "chat_reply": "markerreply roses",
    "gift_code": "MARKERCODE000001",
    "gift_email": "marker.gift@gmail.com",
}


def role_url(role: str, password: str, dbname: str) -> str:
    assert SERVER_URL
    parts = urlsplit(SERVER_URL)
    netloc = f"{quote(role)}:{quote(password)}@{parts.hostname}:{parts.port or 5432}"
    return urlunsplit((parts.scheme, netloc, f"/{dbname}", "", ""))


FIXTURE_SQL = f"""
insert into products (id, title, brand, gender, fragrance_family, fragrance_families, price, volume_ml,
                      pack_size, slug, store_code)
values (1, 'Rose', 'Jassmin', 'women', 'Квіткові', '{{Квіткові}}', 499, 10, 1, 'rose', 'J001');
insert into product_variants (id, product_id, volume_ml, price, stock_quantity, track_stock)
values (1, 1, 10, 199, 0, false), (2, 1, 50, 899, 4, true);
insert into users (id, full_name, email, password_hash, phone, city, marketing_opt_in, created_at)
values (1, '{MARKERS["name"]}', '{MARKERS["email"]}', '{MARKERS["password_hash"]}',
        '{MARKERS["phone"]}', 'Київ', true, '2026-01-01T10:00:00Z');
insert into sessions (session_id, user_id, anonymous_id, started_at, ended_at, landing_page,
                      traffic_source, traffic_medium, device_type)
values ('00000000-0000-7000-8000-000000000001', 1, '{MARKERS["visitor_cookie"]}',
        '2026-01-02T10:00:00Z', '2026-01-02T10:20:00Z',
        '/uk/reset-password?token={MARKERS["reset_token"]}', 'direct', 'none', 'mobile');
insert into user_events (event_id, user_id, anonymous_id, session_id, event_type, product_id,
                         event_properties, referrer, device_type, created_at)
values
  ('00000000-0000-7000-8000-000000000011', 1, '{MARKERS["visitor_cookie"]}',
   '00000000-0000-7000-8000-000000000001', 'page_view', null,
   '{{"path": "/uk/verify-email?token={MARKERS["reset_token"]}"}}',
   'https://mail.google.com/mail/u/0/{MARKERS["referrer_path"]}', 'mobile', '2026-01-02T10:01:00Z'),
  ('00000000-0000-7000-8000-000000000012', 1, '{MARKERS["visitor_cookie"]}',
   '00000000-0000-7000-8000-000000000001', 'search', null,
   '{{"search_id": "00000000-0000-7000-8000-0000000000aa", "query": "{MARKERS["search_query"]}",
      "gender": "women", "fragrance_family": null, "brand": null, "sort": "popular", "page": 1,
      "result_count": 1, "product_public_ids": []}}',
   null, 'mobile', '2026-01-02T10:02:00Z');
insert into orders (id, user_id, guest_full_name, guest_email, guest_phone, shipping_address, status,
                    payment_status, payment_method, subtotal, total_amount, created_at, paid_at,
                    waybill_number)
values
  (1, 1, '{MARKERS["name"]}', '{MARKERS["email"]}', '{MARKERS["phone"]}', '{MARKERS["address"]}',
   'paid', 'paid', 'card', 899, 899, '2026-01-02T10:10:00Z', '2026-01-02T10:11:00Z',
   '{MARKERS["waybill"]}'),
  (2, null, '{MARKERS["guest_name"]}', '{MARKERS["guest_email"]}', '{MARKERS["guest_phone"]}',
   '{MARKERS["address"]}', 'pending', 'unpaid', 'cod', 199, 199, '2026-01-03T09:00:00Z', null, null);
insert into order_items (id, order_id, product_id, variant_id, volume_ml, quantity, price_at_purchase)
values (1, 1, 1, 2, 50, 1, 899), (2, 2, 1, 1, 10, 1, 199);
insert into order_status_history (order_id, status, changed_at, source)
values (1, 'pending', '2026-01-02T10:10:00Z', 'checkout'), (1, 'paid', '2026-01-02T10:11:00Z', 'payment'),
       (2, 'pending', '2026-01-03T09:00:00Z', 'checkout');
insert into payments (order_id, provider, reference, status, amount, provider_payment_id,
                      last_callback, created_at, completed_at)
values (1, 'liqpay', '1-1', 'succeeded', 899, '{MARKERS["provider_payment_id"]}',
        '{{"sender_phone": "{MARKERS["payment_callback"]}"}}', '2026-01-02T10:10:30Z',
        '2026-01-02T10:11:00Z');
insert into inventory_movements (variant_id, occurred_at, reason, quantity_delta, stock_after,
                                 order_id, source, note)
values (2, '2026-01-01T08:00:00Z', 'receipt', 5, 5, null, 'cms', '{MARKERS["staff_note"]}'),
       (2, '2026-01-02T10:10:00Z', 'sale', -1, 4, 1, 'checkout', null);
insert into gift_cards (code, initial_amount, balance, buyer_email, recipient_email, locale)
values ('{MARKERS["gift_code"]}', 500, 500, '{MARKERS["gift_email"]}', '{MARKERS["gift_email"]}', 'uk');
insert into perfumer_threads (id, anonymous_id, user_id, entry)
values (1, '{MARKERS["visitor_cookie"]}', 1, 'menu');
insert into perfumer_messages (thread_id, role, text) values
  (1, 'user', '{MARKERS["chat_text"]}');
insert into perfumer_messages (thread_id, role, reply) values
  (1, 'perfumer', '{{"intro": "{MARKERS["chat_reply"]}"}}');
select setval(pg_get_serial_sequence('products', 'id'), 10);
select setval(pg_get_serial_sequence('users', 'id'), 10);
select setval(pg_get_serial_sequence('orders', 'id'), 10);
"""


@dataclass(frozen=True)
class Env:
    settings: setup.Settings
    app_admin_url: str
    extract_url: str
    owner_url: str
    reader_url: str
    counts: dict[str, int]
    app_before: dict[str, str]


def app_fingerprint(url: str) -> dict[str, str]:
    """Every app table's row count and content hash: proof the extract wrote nothing."""
    with psycopg.connect(url) as conn:
        tables = [
            r[0]
            for r in conn.execute(
                "select tablename from pg_tables where schemaname = 'public' order by 1"
            ).fetchall()
        ]
        fingerprint = (
            "select count(*) || ':' || md5(coalesce(string_agg(x::text, ',' order by x::text), '')) "
            'from public."{}" as x'
        )
        return {t: conn.execute(fingerprint.format(t)).fetchone()[0] for t in tables}


def drop_everything(admin: str) -> None:
    with psycopg.connect(with_database(admin, "postgres"), autocommit=True) as conn:
        conn.execute(f'drop database if exists "{WH_DB}" with (force)')
        exists = conn.execute("select 1 from pg_database where datname = %s", (APP_DB,)).fetchone()
    if exists:
        with psycopg.connect(with_database(admin, APP_DB), autocommit=True) as conn:
            for suffix in ("extract", "owner", "reader"):
                role = f"{PREFIX}_{suffix}"
                if conn.execute("select 1 from pg_roles where rolname = %s", (role,)).fetchone():
                    conn.execute(f'drop owned by "{role}"')
    with psycopg.connect(with_database(admin, "postgres"), autocommit=True) as conn:
        conn.execute(f'drop database if exists "{APP_DB}" with (force)')
        for suffix in ("extract", "owner", "reader"):
            role = f"{PREFIX}_{suffix}"
            if conn.execute("select 1 from pg_roles where rolname = %s", (role,)).fetchone():
                conn.execute(f'drop owned by "{role}"')
                conn.execute(f'drop role "{role}"')


@pytest.fixture(scope="module")
def env() -> Iterator[Env]:
    assert SERVER_URL
    admin = SERVER_URL
    drop_everything(admin)
    with psycopg.connect(with_database(admin, "postgres"), autocommit=True) as conn:
        conn.execute(f'create database "{APP_DB}"')
    app_admin_url = with_database(admin, APP_DB)
    try:
        migrate_env = {**os.environ, "JASSMINDB_URI": app_admin_url, "DATABASE_URL": app_admin_url}
        pnpm = shutil.which("pnpm")
        assert pnpm
        subprocess.run([pnpm, "--silent", "db:migrate"], cwd=REPO_ROOT, env=migrate_env, check=True)
        with psycopg.connect(app_admin_url, autocommit=True) as conn:
            conn.execute(FIXTURE_SQL)
        settings = setup.settings_from(
            {
                "WH_ADMIN_URL": admin,
                "WH_APP_DATABASE": APP_DB,
                "WH_DATABASE": WH_DB,
                "WH_ROLE_PREFIX": PREFIX,
                "WH_EXTRACT_PASSWORD": "extract-pw",
                "WH_OWNER_PASSWORD": "owner-pw",
                "WH_READER_PASSWORD": "reader-pw",
            }
        )
        for _ in range(2):  # Idempotent: a second deploy re-runs it.
            setup.create_roles_and_database(settings)
            setup.grant_app_columns(settings)
            setup.prepare_warehouse(settings)
        extract_url = role_url(settings.extract_role, "extract-pw", APP_DB)
        owner_url = role_url(settings.owner_role, "owner-pw", WH_DB)
        app_before = app_fingerprint(app_admin_url)
        run_env = {"WH_EXTRACT_URL": extract_url, "WH_TARGET_URL": owner_url, "WH_PSEUDONYM_KEY": KEY}
        extract.run(run_env)
        counts = extract.run(run_env)  # A second night replaces the first copy.
        yield Env(
            settings=settings,
            app_admin_url=app_admin_url,
            extract_url=extract_url,
            owner_url=owner_url,
            reader_url=role_url(settings.reader_role, "reader-pw", WH_DB),
            counts=counts,
            app_before=app_before,
        )
    finally:
        drop_everything(admin)


def wh_build(env: Env) -> subprocess.CompletedProcess[str]:
    run_env = {
        **os.environ,
        "WAREHOUSE_PROD_URL": env.owner_url,
        "JASSMINDB_URI": env.app_admin_url,
        "PYTHONIOENCODING": "utf-8",
    }
    return subprocess.run(
        [sys.executable, str(PROJECT_DIR / "wh.py"), "build", "--target", "prod"],
        env=run_env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )


def every_text_value(url: str) -> list[tuple[str, str]]:
    """``(schema.table.column, value)`` for every value of every table and view in the database."""
    found: list[tuple[str, str]] = []
    with psycopg.connect(url) as conn:
        columns = conn.execute(
            """
            select c.table_schema, c.table_name, c.column_name
            from information_schema.columns as c
            where c.table_schema not in ('pg_catalog', 'information_schema')
            order by 1, 2, 3
            """
        ).fetchall()
        for schema, table, column in columns:
            rows = conn.execute(
                f'select "{column}"::text from "{schema}"."{table}" where "{column}" is not null'
            ).fetchall()
            found += [(f"{schema}.{table}.{column}", r[0]) for r in rows]
    return found


def assert_no_marker(url: str) -> None:
    values = every_text_value(url)
    assert values, "the warehouse is empty"
    for where, value in values:
        lowered = value.lower()
        for name, marker in MARKERS.items():
            assert marker.lower() not in lowered, f"{name} reached {where}"
    # The phone's digits, the email's local part and the cookie, in any form.
    for where, value in values:
        for fragment in ("9990001", "9990002", "marker.olena", "marker.guest", "markeranon"):
            assert fragment not in value.lower(), f"{fragment} reached {where}"


def test_copies_every_allow_listed_table(env: Env):
    assert set(env.counts) == set(TABLES)
    assert env.counts["orders"] == 2 and env.counts["users"] == 1 and env.counts["user_events"] == 2
    with psycopg.connect(env.owner_url) as conn:
        runs = conn.execute("select count(*) from meta.extract_runs").fetchone()
        assert runs == (2,)
        schemas = {r[0] for r in conn.execute("select nspname from pg_namespace").fetchall()}
        assert "raw" in schemas and "raw_next" not in schemas


def test_no_personal_value_reaches_the_raw_copy(env: Env):
    assert_no_marker(env.owner_url)


def test_pseudonyms_keep_identity_and_test_flags(env: Env):
    with psycopg.connect(env.owner_url) as conn:
        user_email = conn.execute("select email from raw.users").fetchone()
        order_emails = dict(conn.execute("select id, guest_email from raw.orders").fetchall())
        phone = conn.execute("select phone from raw.users").fetchone()
        anon = {
            r[0]
            for r in conn.execute(
                "select anonymous_id from raw.sessions union all select anonymous_id from raw.user_events"
            ).fetchall()
        }
        landing = conn.execute("select landing_page from raw.sessions").fetchone()
    assert user_email and user_email[0].endswith("@pseudonym.invalid")
    assert order_emails["1"] == user_email[0]  # The same person's email, the same pseudonym.
    assert phone == ("present",)
    assert len(anon) == 1  # One visitor across sessions and events.
    assert landing == ("/uk/reset-password",)


def test_extract_role_reads_only_allow_listed_columns(env: Env):
    with psycopg.connect(env.extract_url, autocommit=True) as conn:
        for statement in (
            "select full_name from users",
            "select * from users",
            "select shipping_address from orders",
            "select last_callback from payments",
            "select text from perfumer_messages",
            "select code from gift_cards",
        ):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(statement)
        assert conn.execute("select count(*) from users").fetchone() == (1,)
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            conn.execute("create temporary table t (x int)")


def test_extract_writes_nothing_to_the_app(env: Env):
    assert app_fingerprint(env.app_admin_url) == env.app_before


def test_reader_sees_only_marts_and_meta(env: Env):
    with psycopg.connect(env.reader_url, autocommit=True) as conn:
        assert conn.execute("select count(*) from meta.extract_runs").fetchone() == (2,)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("select * from raw.users")


def test_refuses_a_writable_or_wrong_database(env: Env):
    with pytest.raises(extract.UnsafeSourceError):
        extract.open_source(env.app_admin_url)  # A superuser isn't read-only by default.
    with pytest.raises(extract.UnsafeDatabaseError):
        extract.check_urls({"WH_EXTRACT_URL": env.extract_url, "WH_TARGET_URL": env.extract_url})


def test_dbt_builds_the_marts_on_the_copy(env: Env):
    result = wh_build(env)
    assert result.returncode == 0, result.stdout[-6000:] + result.stderr[-3000:]
    with psycopg.connect(env.reader_url) as conn:
        orders = conn.execute("select count(*) from marts.fct_orders").fetchone()
        customers = conn.execute("select count(*) from marts.dim_customers").fetchone()
    assert orders == (2,)
    assert customers == (2,)  # The registered user and the guest.
    # dbt's staging layer read the copy: still no marker anywhere, marts included.
    assert_no_marker(env.owner_url)


DASHBOARD = REPO_ROOT / "analytics" / "dashboard"


@pytest.mark.skipif(
    not (DASHBOARD / "node_modules").is_dir(),
    reason="the dashboard isn't installed (pnpm --dir analytics/dashboard install)",
)
def test_dashboard_builds_from_the_marts_as_the_reader(env: Env):
    """The Evidence site (#183) builds on the copy, reading only marts and meta as the reader role."""
    test_dbt_builds_the_marts_on_the_copy(env)  # Idempotent; makes this test runnable on its own.
    parts = urlsplit(env.reader_url)
    evidence_env = {
        **os.environ,
        "EVIDENCE_SOURCE__warehouse__host": parts.hostname or "localhost",
        "EVIDENCE_SOURCE__warehouse__port": str(parts.port or 5432),
        "EVIDENCE_SOURCE__warehouse__database": WH_DB,
        "EVIDENCE_SOURCE__warehouse__user": env.settings.reader_role,
        "EVIDENCE_SOURCE__warehouse__password": "reader-pw",
        "SEND_ANONYMOUS_USAGE_STATS": "no",
    }
    pnpm = shutil.which("pnpm")
    assert pnpm
    for script in ("sources", "build:strict"):
        result = subprocess.run(
            [pnpm, "--dir", str(DASHBOARD), "run", script],
            env=evidence_env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        assert result.returncode == 0, result.stdout[-6000:] + result.stderr[-3000:]
    for page in ("index", "sales", "products", "testers", "customers", "perfumer"):
        path = DASHBOARD / "build" / ("index.html" if page == "index" else f"{page}/index.html")
        assert "Дані на" in path.read_text(encoding="utf-8"), page
