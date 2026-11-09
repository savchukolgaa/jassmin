"""Loading the generated data into the separate `jassmin_synth` database.

Safety first: the target is always a database named `jassmin_synth` (or `jassmin_synth_<suffix>`
for throwaway test databases), and never the app's own database, whatever the environment says.

1. `resolve_target`: the server comes from `JASSMIN_SYNTH_URI` (Aspire's `jassmin-synth`
   resource), `SYNTH_DATABASE_URL`, or the app's `DATABASE_URL` (env or `.env`); the database
   name is always replaced by the synth one, then checked.
2. `ensure_database`: creates it when missing (Aspire creates it itself).
3. `migrate`: runs the app's own `pnpm db:migrate` against it.
4. `load_raw`: recreates the `raw` schema (all-text tables, no constraints) and `COPY`s every
   table into it, with `raw.generation_runs` for provenance.
5. `load_public` (`--load-app-schema`): replaces the app tables' rows with the raw rows that pass
   the app's own constraints, read from the catalog: input validity per column type, NOT NULL,
   CHECKs, single-column foreign keys and (via ON CONFLICT DO NOTHING) unique indexes. The
   inventory ledger and the variants' stock come from the clean ledger instead (backorders are
   covered by `adjustment` rows), so `sum(quantity_delta) = stock_quantity` holds.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlsplit, urlunsplit

import frames

if TYPE_CHECKING:
    import argparse

    import psycopg

    from generate import Generated

REPO_ROOT = Path(__file__).resolve().parents[2]
SYNTH_NAME = re.compile(r"^jassmin_synth(_[a-z0-9_]+)?$")

#: App tables `--load-app-schema` replaces, parents first.
PUBLIC_TABLES = [
    "products", "product_variants", "discounts", "users", "sessions", "user_events", "carts",
    "cart_items", "orders", "order_items", "payments", "order_status_history",
    "inventory_movements",
]  # fmt: skip
SERIAL_TABLES = [t for t in PUBLIC_TABLES if t not in ("sessions", "user_events")]


class UnsafeTarget(Exception):
    pass


def read_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def database_name(url: str) -> str:
    return urlsplit(url).path.lstrip("/")


def with_database(url: str, name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{name}", parts.query, parts.fragment))


def redact(url: str) -> str:
    parts = urlsplit(url)
    netloc = parts.netloc
    if "@" in netloc:
        credentials, _, host = netloc.rpartition("@")
        user = credentials.split(":", 1)[0]
        netloc = f"{user}:***@{host}"
    return urlunsplit((parts.scheme, netloc, parts.path, "", ""))


def app_urls(env: dict[str, str], dotenv: dict[str, str]) -> list[str]:
    """Every URL that could point at the app's database."""
    candidates = [env.get("JASSMINDB_URI"), env.get("DATABASE_URL"), dotenv.get("DATABASE_URL")]
    return [u for u in candidates if u]


def check_target(target: str, app: list[str]) -> None:
    """Refuses any database that isn't a synth database, or that is one of the app's."""
    name = database_name(target)
    if not SYNTH_NAME.match(name):
        raise UnsafeTarget(f"Refusing to write to database {name!r}: only jassmin_synth[_suffix].")
    for url in app:
        if database_name(url) == name and urlsplit(url).hostname == urlsplit(target).hostname:
            raise UnsafeTarget(f"Refusing to write to {name!r}: it is the app's database.")


def resolve_target(name: str, env: dict[str, str] | None = None, dotenv: dict[str, str] | None = None) -> str:
    env = dict(os.environ) if env is None else env
    dotenv = read_dotenv(REPO_ROOT / ".env") if dotenv is None else dotenv
    app = app_urls(env, dotenv)
    base = env.get("JASSMIN_SYNTH_URI") or env.get("SYNTH_DATABASE_URL") or (app[0] if app else None)
    if not base:
        raise UnsafeTarget(
            "No database server: set SYNTH_DATABASE_URL, or DATABASE_URL in the repo's .env, "
            "or start `synth-generate` from the Aspire dashboard."
        )
    target = with_database(base, name)
    check_target(target, app)
    return target


def ensure_database(target: str) -> None:
    import psycopg
    from psycopg import sql

    name = database_name(target)
    with psycopg.connect(with_database(target, "postgres"), autocommit=True) as conn:
        exists = conn.execute("select 1 from pg_database where datname = %s", (name,)).fetchone()
        if not exists:
            conn.execute(sql.SQL("create database {}").format(sql.Identifier(name)))
            print(f"Created database {name}.")


def migrate(target: str) -> None:
    """Applies the app's migrations with the app's own migrator, aimed at the synth database."""
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError("pnpm not found: it runs the app's migrations (`pnpm db:migrate`).")
    env = dict(os.environ)
    # drizzle.config.ts reads JASSMINDB_URI || DATABASE_URL: point both at the synth database.
    env["JASSMINDB_URI"] = target
    env["DATABASE_URL"] = target
    subprocess.run([pnpm, "db:migrate"], cwd=REPO_ROOT, env=env, check=True)


def _git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _create_text_table(conn: psycopg.Connection, qualified: str, columns: list[str]) -> None:
    cols = ", ".join(f'"{c}" text' for c in columns)
    conn.execute(f"create table {qualified} ({cols})")


def _copy(conn: psycopg.Connection, qualified: str, columns: list[str], payload: str) -> None:
    cols = ", ".join(f'"{c}"' for c in columns)
    with conn.cursor() as cur:
        with cur.copy(f"copy {qualified} ({cols}) from stdin with (format csv, null '\\N')") as copy:
            copy.write(payload.encode("utf-8"))


def load_raw(conn: psycopg.Connection, generated: Generated, args: argparse.Namespace, started: datetime) -> None:
    conn.execute("drop schema if exists raw cascade")
    conn.execute("create schema raw")
    conn.execute(
        "comment on schema raw is 'Synthetic shop data (#131), as generated: no constraints, every "
        "value as text, deliberate anomalies included. See analytics/README.md.'"
    )
    for table in frames.TABLE_ORDER:
        _create_text_table(conn, f'raw."{table}"', frames.COLUMNS[table])
        _copy(conn, f'raw."{table}"', frames.COLUMNS[table], generated.raw[table])
    conn.execute(
        "comment on table raw.customer_truth is 'Ground truth of the customer model. Evaluate "
        "models against it; never train on it.'"
    )
    conn.execute(
        "create table raw.generation_runs (seed integer, arguments jsonb, git_commit text, "
        "digest text, row_counts jsonb, stats jsonb, started_at timestamptz, finished_at timestamptz)"
    )
    arguments = {
        "customers": args.customers, "visitors": args.visitors, "start": args.start.date().isoformat(),
        "end": args.end.date().isoformat(), "seed": args.seed, "load_app_schema": args.load_app_schema,
    }  # fmt: skip
    counts = {t: generated.raw[t].count("\n") for t in frames.TABLE_ORDER}
    conn.execute(
        "insert into raw.generation_runs values (%s, %s, %s, %s, %s, %s, %s, now())",
        (args.seed, json.dumps(arguments), _git_commit(), frames.digest(generated.raw),
         json.dumps(counts), json.dumps(generated.output.stats), started),  # fmt: skip
    )


def _columns(conn: psycopg.Connection, table: str) -> list[tuple[str, str, bool, str | None]]:
    """(name, type, not null, default expression) per column."""
    return conn.execute(
        """
        select a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull,
          pg_get_expr(d.adbin, d.adrelid)
        from pg_attribute a
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = %s::regclass and a.attnum > 0 and not a.attisdropped
        order by a.attnum
        """,
        (f"public.{table}",),
    ).fetchall()


def _checks(conn: psycopg.Connection, table: str) -> list[str]:
    rows = conn.execute(
        "select pg_get_constraintdef(oid) from pg_constraint where conrelid = %s::regclass and contype = 'c'",
        (f"public.{table}",),
    ).fetchall()
    checks = []
    for (definition,) in rows:
        expr = re.sub(r"^CHECK\s*", "", definition)
        checks.append(re.sub(r"\s+NOT VALID$", "", expr))
    return checks


def _foreign_keys(conn: psycopg.Connection, table: str) -> list[tuple[str, str, str]]:
    return conn.execute(
        """
        select a.attname, format('%%I.%%I', n.nspname, p.relname), af.attname
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_class p on p.oid = c.confrelid
        join pg_namespace n on n.oid = p.relnamespace
        join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
        where c.conrelid = %s::regclass and c.contype = 'f' and cardinality(c.conkey) = 1
        """,
        (f"public.{table}",),
    ).fetchall()


def insert_valid_sql(conn: psycopg.Connection, table: str, source: str, source_columns: list[str]) -> str:
    """`insert into public.<table> … select … from <source>` keeping only rows the table accepts."""
    every = _columns(conn, table)
    columns = [(n, t, nn) for n, t, nn, _ in every if n in source_columns]
    names = ", ".join(f'"{n}"' for n, _, _ in columns)
    casts = [f'r."{n}"::{t} as "{n}"' for n, t, _ in columns]
    # Columns the source lacks get their default (as the insert will), so CHECKs can see them.
    casts += [f'({d or "null"})::{t} as "{n}"' for n, t, _, d in every if n not in source_columns]
    valid_input = " and ".join(
        f"(r.\"{n}\" is null or pg_input_is_valid(r.\"{n}\", '{t}'))" for n, t, _ in columns
    )
    conditions = [f's."{n}" is not null' for n, _, nn in columns if nn]
    # A CHECK passes unless it is false (null passes), like in the table itself.
    conditions += [f"({expr}) is not false" for expr in _checks(conn, table)]
    for column, parent, parent_column in _foreign_keys(conn, table):
        if column in source_columns:
            conditions.append(
                f's."{column}" is null or exists (select 1 from {parent} p where p."{parent_column}" = s."{column}")'
            )
    where = " and ".join(f"({c})" for c in conditions) or "true"
    return (
        f"insert into public.{table} ({names}) "
        f"select {names} from (select {', '.join(casts)} from {source} r where {valid_input}) s "
        f"where {where} on conflict do nothing"
    )


def load_public(conn: psycopg.Connection, generated: Generated) -> dict[str, tuple[int, int]]:
    """Replaces the app tables' rows; returns {table: (rows offered, rows loaded)}."""
    conn.execute("set local time zone 'UTC'")  # naive raw timestamps are UTC
    # The clean ledger and stock, staged like raw tables.
    for table, payload in (("product_variants", generated.clean_variants),
                           ("inventory_movements", generated.clean_inventory)):  # fmt: skip
        conn.execute(f'create temp table "clean_{table}" (like raw."{table}") on commit drop')
        _copy(conn, f'"clean_{table}"', frames.COLUMNS[table], payload)
    tables = ", ".join(f"public.{t}" for t in PUBLIC_TABLES)
    conn.execute(f"truncate {tables} restart identity cascade")
    result: dict[str, tuple[int, int]] = {}
    for table in PUBLIC_TABLES:
        source = f'"clean_{table}"' if table in ("product_variants", "inventory_movements") else f'raw."{table}"'
        offered = conn.execute(f"select count(*) from {source}").fetchone()[0]
        cur = conn.execute(insert_valid_sql(conn, table, source, frames.COLUMNS[table]))
        result[table] = (offered, cur.rowcount)
    for table in SERIAL_TABLES:
        conn.execute(
            f"select setval(pg_get_serial_sequence('public.{table}', 'id'), "
            f"coalesce((select max(id) from public.{table}), 1), "
            f"(select max(id) from public.{table}) is not null)"
        )
    return result


def load(target: str, generated: Generated, args: argparse.Namespace, load_app_schema: bool) -> None:
    import psycopg

    started = datetime.now(timezone.utc)
    ensure_database(target)
    migrate(target)
    with psycopg.connect(target) as conn:
        with conn.transaction():
            load_raw(conn, generated, args, started)
        print(f"Loaded raw.* into {database_name(target)}.")
        if load_app_schema:
            with conn.transaction():
                result = load_public(conn, generated)
            print("Loaded public.* (rows that pass the app's constraints):")
            for table, (offered, loaded) in result.items():
                print(f"  public.{table:22s} {loaded:>9,d} of {offered:>9,d}")
    sys.stdout.flush()
