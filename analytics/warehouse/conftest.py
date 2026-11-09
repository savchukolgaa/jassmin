"""The warehouse's tests run in its own uv project (dbt, psycopg), from this directory:

    uv run --project analytics/warehouse pytest analytics/warehouse

The generator's tests (#131) run from ``analytics/`` in another environment, without dbt. When
pytest is started there and walks into this folder, skip it instead of failing on imports.
"""

from pathlib import Path

HERE = Path(__file__).resolve().parent


def pytest_ignore_collect(collection_path: Path, config) -> bool | None:
    if config.rootpath.resolve() != HERE and HERE in collection_path.resolve().parents:
        return True
    return None
