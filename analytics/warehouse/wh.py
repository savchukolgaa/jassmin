"""Run dbt for the Jassmin warehouse (#132) against the synthetic database, never the app's.

    uv run --project analytics/warehouse analytics/warehouse/wh.py build
    uv run --project analytics/warehouse analytics/warehouse/wh.py docs generate
    uv run --project analytics/warehouse analytics/warehouse/wh.py build --select staging
    uv run --project analytics/warehouse analytics/warehouse/wh.py docs serve

Every argument goes to dbt; the project and profiles directories are this folder. ``docs serve``
generates the docs first, and takes its port from ``WAREHOUSE_DOCS_PORT`` when set. The database
comes from, in order (the same rules as #131's generator):

1. ``WAREHOUSE_DATABASE_URL``;
2. ``JASSMIN_SYNTH_URI`` (injected by Aspire for the ``jassmin-synth`` database);
3. ``SYNTH_DATABASE_URL``;
4. ``DATABASE_URL`` from the environment or the repo's ``.env``, with the database name replaced
   by ``jassmin_synth``.

For the ``synth`` target the database name must be ``jassmin_synth`` (optionally with a
``_suffix`` for throwaway test databases) and differ from the app's database, so dbt can never
create schemas in the shop's own database. ``--target prod`` reads ``WAREHOUSE_PROD_URL`` instead
(a read-only replica; not run yet, see README.md).
"""

from __future__ import annotations

import os
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

PROJECT_DIR = Path(__file__).resolve().parent
REPO_ROOT = PROJECT_DIR.parents[1]
SYNTH_DATABASE = "jassmin_synth"
SYNTH_NAME_RE = re.compile(r"^jassmin_synth(_[a-z0-9_]+)?$")


class UnsafeDatabaseError(Exception):
    """The resolved database isn't one the warehouse may write to."""


@dataclass(frozen=True)
class Connection:
    host: str
    port: int
    user: str
    password: str
    dbname: str

    def env(self, target: str) -> dict[str, str]:
        return {
            "WAREHOUSE_TARGET": target,
            "WAREHOUSE_HOST": self.host,
            "WAREHOUSE_PORT": str(self.port),
            "WAREHOUSE_USER": self.user,
            "WAREHOUSE_PASSWORD": self.password,
            "WAREHOUSE_DBNAME": self.dbname,
        }


def parse_url(url: str) -> Connection:
    """A ``postgres://user:password@host:port/dbname`` URL as connection settings."""
    parts = urlsplit(url)
    if parts.scheme not in ("postgres", "postgresql"):
        raise ValueError(f"Not a PostgreSQL URL: {parts.scheme}://…")
    dbname = unquote(parts.path.lstrip("/"))
    if not dbname:
        raise ValueError("The database URL has no database name")
    return Connection(
        host=parts.hostname or "localhost",
        port=parts.port or 5432,
        user=unquote(parts.username or "postgres"),
        password=unquote(parts.password or ""),
        dbname=dbname,
    )


def with_database(url: str, dbname: str) -> str:
    """``url`` pointing at another database on the same server."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{dbname}", parts.query, parts.fragment))


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
    """The app's own database name, from ``JASSMINDB_URI`` or ``DATABASE_URL``."""
    url = env.get("JASSMINDB_URI") or env.get("DATABASE_URL")
    if not url:
        return None
    try:
        return parse_url(url).dbname
    except ValueError:
        return None


def resolve_synth(env: Mapping[str, str]) -> Connection:
    """The synthetic database to build in, following the order in the module docstring."""
    for key in ("WAREHOUSE_DATABASE_URL", "JASSMIN_SYNTH_URI", "SYNTH_DATABASE_URL"):
        if env.get(key):
            connection = parse_url(env[key])
            break
    else:
        app_url = env.get("DATABASE_URL")
        if not app_url:
            raise UnsafeDatabaseError(
                "No database: set WAREHOUSE_DATABASE_URL or JASSMIN_SYNTH_URI, or DATABASE_URL "
                "in the repo's .env (its server is used, with the database jassmin_synth)."
            )
        connection = parse_url(with_database(app_url, SYNTH_DATABASE))
    guard_synth(connection.dbname, app_database_name(env))
    return connection


def guard_synth(dbname: str, app_dbname: str | None) -> None:
    """Refuse any database that isn't ``jassmin_synth[_suffix]`` or that is the app's database."""
    if not SYNTH_NAME_RE.match(dbname):
        raise UnsafeDatabaseError(
            f"Refusing to build the warehouse in {dbname!r}: the synth target only writes to "
            "jassmin_synth (or jassmin_synth_<suffix>)."
        )
    if app_dbname is not None and dbname == app_dbname:
        raise UnsafeDatabaseError(f"Refusing to build the warehouse in the app's database {dbname!r}.")


def target_of(args: Sequence[str]) -> str:
    """The dbt target named by ``--target`` / ``-t``, else ``WAREHOUSE_TARGET``, else ``synth``."""
    for i, arg in enumerate(args):
        if arg in ("--target", "-t") and i + 1 < len(args):
            return args[i + 1]
        if arg.startswith("--target="):
            return arg.split("=", 1)[1]
    return os.environ.get("WAREHOUSE_TARGET", "synth")


def resolve(target: str, env: Mapping[str, str]) -> Connection:
    if target == "synth":
        return resolve_synth(env)
    if target == "prod":
        url = env.get("WAREHOUSE_PROD_URL")
        if not url:
            raise UnsafeDatabaseError("--target prod needs WAREHOUSE_PROD_URL (a read-only replica).")
        return parse_url(url)
    raise UnsafeDatabaseError(f"Unknown target {target!r}: use synth or prod.")


def dbt_args(args: Sequence[str]) -> list[str]:
    """``args`` plus this project's directories, unless the command is a bare ``--help``."""
    extra: list[str] = []
    if "--project-dir" not in args:
        extra += ["--project-dir", str(PROJECT_DIR)]
    if "--profiles-dir" not in args:
        extra += ["--profiles-dir", str(PROJECT_DIR)]
    return [*args, *extra]


def docs_serve_args(args: Sequence[str], env: Mapping[str, str]) -> list[str]:
    """``docs serve`` arguments with the port from ``WAREHOUSE_DOCS_PORT`` (set by Aspire's endpoint)
    and no browser, unless ``--port`` is given."""
    port = env.get("WAREHOUSE_DOCS_PORT")
    if not port or "--port" in args:
        return list(args)
    return [*args, "--port", port, "--no-browser"]


def main(argv: Sequence[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    env = {**read_dotenv(REPO_ROOT / ".env"), **os.environ}
    target = target_of(argv)
    try:
        connection = resolve(target, env)
    except (UnsafeDatabaseError, ValueError) as error:
        print(f"wh.py: {error}", file=sys.stderr)
        return 2
    os.environ.update(connection.env(target))
    print(f"wh.py: target {target}, database {connection.dbname} on {connection.host}:{connection.port}")

    from dbt.cli.main import dbtRunner  # Imported late: it's slow, and --help shouldn't wait.

    runner = dbtRunner()
    command = argv[0]
    if command not in ("deps", "clean", "debug") and not (PROJECT_DIR / "dbt_packages").is_dir():
        if not runner.invoke(dbt_args(["deps"])).success:
            return 1
    args = list(argv)
    if args[:2] == ["docs", "serve"]:
        # Serve fresh docs: generate them first, for the same target.
        if not runner.invoke(dbt_args(["docs", "generate", "--target", target])).success:
            return 1
        args = docs_serve_args(args, env)
    result = runner.invoke(dbt_args(args))
    return 0 if result.success else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
