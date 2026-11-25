"""Create ``jassmin_wh``, the warehouse's three roles and their grants (#183). Idempotent.

    uv run --project analytics/warehouse analytics/warehouse/extract/setup.py

Run once per deploy (the ``analytics-setup`` service), after the app's migrations, as a superuser.
It's the only warehouse step that sees the superuser's password. Environment:

- ``WH_ADMIN_URL``: a superuser URL on the server (its database doesn't matter);
- ``WH_APP_DATABASE`` (default ``jassmindb``) and ``WH_DATABASE`` (default ``jassmin_wh``);
- ``WH_ROLE_PREFIX`` (default ``wh``): the roles are ``<prefix>_extract``, ``<prefix>_owner`` and
  ``<prefix>_reader``;
- ``WH_EXTRACT_PASSWORD``, ``WH_OWNER_PASSWORD``, ``WH_READER_PASSWORD``.

The roles:

- ``extract`` reads the app's database, and only the allow-listed columns (``allowlist.py``), through
  column-level grants; every transaction it starts is read-only.
- ``owner`` owns ``jassmin_wh``: the extract writes ``raw`` and ``meta`` with it, and dbt builds
  ``staging``, ``intermediate`` and ``marts``. It has no grant on any app table.
- ``reader`` reads ``marts`` and ``meta`` only, read-only: the dashboard (Evidence).
"""

from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg  # noqa: E402
from psycopg import sql  # noqa: E402

from extract.allowlist import TABLES, readable_columns  # noqa: E402
from wh import guard_prod, parse_url, with_database  # noqa: E402

#: Schemas of jassmin_wh the dashboard may read.
READER_SCHEMAS = ("marts", "meta")


@dataclass(frozen=True)
class Settings:
    admin_url: str
    app_database: str
    database: str
    extract_role: str
    owner_role: str
    reader_role: str
    extract_password: str
    owner_password: str
    reader_password: str


def settings_from(env: Mapping[str, str]) -> Settings:
    missing = [
        key
        for key in ("WH_ADMIN_URL", "WH_EXTRACT_PASSWORD", "WH_OWNER_PASSWORD", "WH_READER_PASSWORD")
        if not env.get(key)
    ]
    if missing:
        raise ValueError(f"Missing {', '.join(missing)}.")
    prefix = env.get("WH_ROLE_PREFIX", "wh")
    database = env.get("WH_DATABASE", "jassmin_wh")
    app_database = env.get("WH_APP_DATABASE", "jassmindb")
    guard_prod(database, app_database)
    parse_url(env["WH_ADMIN_URL"])  # Fails early on a malformed URL.
    return Settings(
        admin_url=env["WH_ADMIN_URL"],
        app_database=app_database,
        database=database,
        extract_role=f"{prefix}_extract",
        owner_role=f"{prefix}_owner",
        reader_role=f"{prefix}_reader",
        extract_password=env["WH_EXTRACT_PASSWORD"],
        owner_password=env["WH_OWNER_PASSWORD"],
        reader_password=env["WH_READER_PASSWORD"],
    )


def _ensure_role(conn: psycopg.Connection, role: str, password: str) -> None:
    exists = conn.execute("select 1 from pg_roles where rolname = %s", (role,)).fetchone()
    verb = "alter" if exists else "create"
    conn.execute(
        sql.SQL("{} role {} with login nosuperuser nocreatedb nocreaterole noinherit password {}").format(
            sql.SQL(verb), sql.Identifier(role), sql.Literal(password)
        )
    )


def create_roles_and_database(s: Settings) -> None:
    with psycopg.connect(with_database(s.admin_url, "postgres"), autocommit=True) as conn:
        for role, password in (
            (s.extract_role, s.extract_password),
            (s.owner_role, s.owner_password),
            (s.reader_role, s.reader_password),
        ):
            _ensure_role(conn, role, password)
        for role in (s.extract_role, s.reader_role):
            conn.execute(
                sql.SQL("alter role {} set default_transaction_read_only = on").format(sql.Identifier(role))
            )
        exists = conn.execute("select 1 from pg_database where datname = %s", (s.database,)).fetchone()
        if not exists:
            conn.execute(
                sql.SQL("create database {} owner {}").format(
                    sql.Identifier(s.database), sql.Identifier(s.owner_role)
                )
            )
            print(f"setup: created database {s.database}")
        else:
            conn.execute(
                sql.SQL("alter database {} owner to {}").format(
                    sql.Identifier(s.database), sql.Identifier(s.owner_role)
                )
            )
        # Only the owner and the dashboard connect to the warehouse; the extract role reads the app.
        conn.execute(
            sql.SQL("revoke connect, temporary on database {} from public").format(sql.Identifier(s.database))
        )
        conn.execute(
            sql.SQL("grant connect on database {} to {}, {}").format(
                sql.Identifier(s.database), sql.Identifier(s.owner_role), sql.Identifier(s.reader_role)
            )
        )
        conn.execute(
            sql.SQL("grant connect on database {} to {}").format(
                sql.Identifier(s.app_database), sql.Identifier(s.extract_role)
            )
        )


def grant_app_columns(s: Settings) -> None:
    """Exactly the allow-listed columns, nothing else: earlier grants are revoked first."""
    role = sql.Identifier(s.extract_role)
    with psycopg.connect(with_database(s.admin_url, s.app_database)) as conn:
        conn.execute(sql.SQL("revoke all on all tables in schema public from {}").format(role))
        conn.execute(sql.SQL("revoke all on all sequences in schema public from {}").format(role))
        conn.execute(sql.SQL("grant usage on schema public to {}").format(role))
        for table in TABLES:
            columns = sql.SQL(", ").join(sql.Identifier(c) for c in readable_columns(table))
            conn.execute(
                sql.SQL("grant select ({}) on table {} to {}").format(
                    columns, sql.Identifier("public", table), role
                )
            )


def prepare_warehouse(s: Settings) -> None:
    """The ``meta`` schema, and the reader's access to it and to ``marts``, now and for new tables."""
    owner, reader = sql.Identifier(s.owner_role), sql.Identifier(s.reader_role)
    with psycopg.connect(with_database(s.admin_url, s.database)) as conn:
        conn.execute(sql.SQL("revoke create on schema public from public"))
        for schema in READER_SCHEMAS:
            name = sql.Identifier(schema)
            conn.execute(sql.SQL("create schema if not exists {} authorization {}").format(name, owner))
            conn.execute(sql.SQL("alter schema {} owner to {}").format(name, owner))
            conn.execute(sql.SQL("grant usage on schema {} to {}").format(name, reader))
            conn.execute(sql.SQL("grant select on all tables in schema {} to {}").format(name, reader))
            conn.execute(
                sql.SQL(
                    "alter default privileges for role {} in schema {} grant select on tables to {}"
                ).format(owner, name, reader)
            )


def main() -> int:
    try:
        s = settings_from(os.environ)
    except ValueError as error:
        print(f"setup: {error}", file=sys.stderr)
        return 2
    create_roles_and_database(s)
    grant_app_columns(s)
    prepare_warehouse(s)
    print(
        f"setup: {s.database} owned by {s.owner_role}; {s.extract_role} reads "
        f"{sum(len(readable_columns(t)) for t in TABLES)} columns of {len(TABLES)} tables in "
        f"{s.app_database}; {s.reader_role} reads {', '.join(READER_SCHEMAS)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
