"""Copy the shop's data, read-only and pseudonymised, into ``jassmin_wh.raw`` (#183).

    uv run --project analytics/warehouse analytics/warehouse/extract/extract.py

Environment:

- ``WH_EXTRACT_URL``: the app's database, as the read-only extract role (``setup.py``);
- ``WH_TARGET_URL``: ``jassmin_wh`` (or ``jassmin_wh_<suffix>``), as its owner role;
- ``WH_PSEUDONYM_KEY``: the secret key of the email and visitor pseudonyms (at least 32 characters;
  it must never change, or every guest becomes a new customer);
- ``GIT_COMMIT`` (optional): recorded in ``meta.extract_runs``.

Every allow-listed table (``allowlist.py``) is read in one read-only, repeatable-read transaction, so
the copy is one consistent snapshot. Its rows go through the transforms into ``raw_next`` (every
column ``text``, the generator's raw shape, #131), which then replaces ``raw`` in the same warehouse
transaction: a failed run leaves yesterday's copy as it was. Only row counts are logged.
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg  # noqa: E402
from psycopg import sql  # noqa: E402

from extract.allowlist import TABLES  # noqa: E402
from extract.transforms import Transform, apply, pseudonym_key  # noqa: E402
from wh import UnsafeDatabaseError, guard_prod, parse_url  # noqa: E402


class UnsafeSourceError(Exception):
    """The app connection isn't read-only."""


def check_urls(env: Mapping[str, str]) -> tuple[str, str]:
    source, target = env.get("WH_EXTRACT_URL"), env.get("WH_TARGET_URL")
    if not source or not target:
        raise UnsafeDatabaseError("Set WH_EXTRACT_URL (the app, read-only) and WH_TARGET_URL (jassmin_wh).")
    source_db, target_db = parse_url(source), parse_url(target)
    guard_prod(target_db.dbname, source_db.dbname)
    if (source_db.host, source_db.port, source_db.dbname) == (
        target_db.host,
        target_db.port,
        target_db.dbname,
    ):
        raise UnsafeDatabaseError("WH_EXTRACT_URL and WH_TARGET_URL are the same database.")
    return source, target


def select_statement(table: str) -> sql.Composed:
    """``select <col>::text, null, ... from public.<table>``: a ``NULL`` column isn't even read."""
    columns = [
        sql.SQL("null::text")
        if transform is Transform.NULL
        else sql.SQL("{}::text").format(sql.Identifier(column))
        for column, transform in TABLES[table].items()
    ]
    return sql.SQL("select {} from {}").format(sql.SQL(", ").join(columns), sql.Identifier("public", table))


def open_source(url: str) -> psycopg.Connection:
    """The app connection, in a read-only, repeatable-read transaction (one consistent snapshot).

    The extract role is read-only by default (``setup.py``); refuse to run if it isn't, so a URL with
    a writable role is never used, even though nothing here writes.
    """
    conn = psycopg.connect(url, autocommit=True)
    default = conn.execute("show default_transaction_read_only").fetchone()
    if not default or default[0] != "on":
        conn.close()
        raise UnsafeSourceError(
            "The extract role isn't read-only by default (default_transaction_read_only): run setup.py."
        )
    conn.execute("set time zone 'UTC'")
    conn.autocommit = False
    conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
    conn.read_only = True
    return conn


def copy_table(source: psycopg.Connection, target: psycopg.Connection, table: str, key: bytes) -> int:
    transforms = list(TABLES[table].values())
    columns = list(TABLES[table])
    target.execute(
        sql.SQL("create table {} ({})").format(
            sql.Identifier("raw_next", table),
            sql.SQL(", ").join(sql.SQL("{} text").format(sql.Identifier(c)) for c in columns),
        )
    )
    copy_in = sql.SQL("copy {} ({}) from stdin").format(
        sql.Identifier("raw_next", table), sql.SQL(", ").join(sql.Identifier(c) for c in columns)
    )
    copy_out = sql.SQL("copy ({}) to stdout").format(select_statement(table))
    count = 0
    with source.cursor() as read, target.cursor() as write:
        with read.copy(copy_out) as out, write.copy(copy_in) as into:
            for row in out.rows():
                into.write_row([apply(t, v, key) for t, v in zip(transforms, row, strict=True)])
                count += 1
    return count


def run(env: Mapping[str, str]) -> dict[str, int]:
    source_url, target_url = check_urls(env)
    key = pseudonym_key(env.get("WH_PSEUDONYM_KEY"))
    started = datetime.now(UTC)
    counts: dict[str, int] = {}
    source = open_source(source_url)
    try:
        with psycopg.connect(target_url) as target:
            target.execute("drop schema if exists raw_next cascade")
            target.execute("create schema raw_next")
            for table in TABLES:
                began = time.monotonic()
                counts[table] = copy_table(source, target, table, key)
                print(f"extract: {table}: {counts[table]} rows in {time.monotonic() - began:.1f}s")
            target.execute(
                "comment on schema raw_next is 'The shop''s data, copied nightly, read-only and "
                "pseudonymised (#183): no names, emails, phones, addresses or chat text. Every value "
                "as text, the shape of #131''s raw layer. See analytics/warehouse/README.md.'"
            )
            # Views of the previous build depend on raw; dbt rebuilds them right after.
            target.execute("drop schema if exists raw cascade")
            target.execute("alter schema raw_next rename to raw")
            target.execute(
                "create table if not exists meta.extract_runs (started_at timestamptz not null, "
                "finished_at timestamptz not null, git_commit text, row_counts jsonb not null)"
            )
            target.execute(
                "insert into meta.extract_runs values (%s, now(), %s, %s)",
                (started, env.get("GIT_COMMIT") or None, json.dumps(counts)),
            )
    finally:
        source.rollback()
        source.close()
    return counts


def main() -> int:
    try:
        counts = run(os.environ)
    except (UnsafeDatabaseError, UnsafeSourceError, ValueError) as error:
        print(f"extract: {error}", file=sys.stderr)
        return 2
    target = urlsplit(os.environ["WH_TARGET_URL"]).path.lstrip("/")
    print(f"extract: copied {sum(counts.values())} rows of {len(counts)} tables into {target}.raw")
    return 0


if __name__ == "__main__":
    sys.exit(main())
