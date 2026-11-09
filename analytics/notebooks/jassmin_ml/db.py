"""Read-only access to the warehouse marts in ``jassmin_synth`` (#132), never the app's database.

The database is resolved like ``analytics/warehouse/wh.py`` does, in this order:

1. ``WAREHOUSE_DATABASE_URL``;
2. ``JASSMIN_SYNTH_URI`` (injected by Aspire);
3. ``SYNTH_DATABASE_URL``;
4. ``DATABASE_URL`` from the environment or the repo's ``.env``, with the database name replaced by
   ``jassmin_synth``.

The name must be ``jassmin_synth`` (or ``jassmin_synth_<suffix>``) and differ from the app's
database, and every session is read-only, so a notebook can't change any data.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from functools import cache
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit

import pandas as pd
import sqlalchemy as sa

REPO_ROOT = Path(__file__).resolve().parents[3]
SYNTH_DATABASE = "jassmin_synth"
SYNTH_NAME_RE = re.compile(r"^jassmin_synth(_[a-z0-9_]+)?$")
URL_KEYS = ("WAREHOUSE_DATABASE_URL", "JASSMIN_SYNTH_URI", "SYNTH_DATABASE_URL")


class UnsafeDatabaseError(Exception):
    """The resolved database isn't one the notebooks may read."""


def database_name(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme not in ("postgres", "postgresql"):
        raise ValueError(f"Not a PostgreSQL URL: {parts.scheme}://…")
    name = unquote(parts.path.lstrip("/"))
    if not name:
        raise ValueError("The database URL has no database name")
    return name


def with_database(url: str, name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{quote(name)}", parts.query, parts.fragment))


def read_dotenv(path: Path) -> dict[str, str]:
    """``KEY=VALUE`` lines of a ``.env`` file (no interpolation); empty when it doesn't exist."""
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def app_database_name(env: Mapping[str, str]) -> str | None:
    url = env.get("JASSMINDB_URI") or env.get("DATABASE_URL")
    if not url:
        return None
    try:
        return database_name(url)
    except ValueError:
        return None


def guard(name: str, app_name: str | None) -> None:
    """Refuse any database that isn't ``jassmin_synth[_suffix]`` or that is the app's database."""
    if not SYNTH_NAME_RE.match(name):
        raise UnsafeDatabaseError(
            f"Refusing to read {name!r}: the notebooks only read jassmin_synth (or jassmin_synth_<suffix>)."
        )
    if app_name is not None and name == app_name:
        raise UnsafeDatabaseError(f"Refusing to read the app's database {name!r}.")


def resolve_url(env: Mapping[str, str]) -> str:
    """The synthetic database's URL, following the order in the module docstring."""
    for key in URL_KEYS:
        if env.get(key):
            url = env[key]
            break
    else:
        app_url = env.get("DATABASE_URL")
        if not app_url:
            raise UnsafeDatabaseError(
                "No database: set WAREHOUSE_DATABASE_URL or JASSMIN_SYNTH_URI, or DATABASE_URL in "
                "the repo's .env (its server is used, with the database jassmin_synth)."
            )
        url = with_database(app_url, SYNTH_DATABASE)
    guard(database_name(url), app_database_name(env))
    return url


def sqlalchemy_url(url: str) -> str:
    """``postgres://…`` as a SQLAlchemy URL for psycopg 3."""
    parts = urlsplit(url)
    return urlunsplit(("postgresql+psycopg", parts.netloc, parts.path, parts.query, parts.fragment))


@cache
def engine() -> sa.Engine:
    """One read-only engine for the session (``default_transaction_read_only``)."""
    env = {**read_dotenv(REPO_ROOT / ".env"), **os.environ}
    url = resolve_url(env)
    return sa.create_engine(
        sqlalchemy_url(url),
        connect_args={"options": "-c default_transaction_read_only=on -c TimeZone=Europe/Kyiv"},
    )


def read_mart(sql: str, params: Mapping[str, object] | None = None) -> pd.DataFrame:
    """The result of ``sql`` (with ``:name`` parameters) as a DataFrame."""
    with engine().connect() as connection:
        return pd.read_sql(sa.text(sql), connection, params=dict(params or {}))
