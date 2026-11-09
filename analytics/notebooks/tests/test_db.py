from pathlib import Path

import pytest

from jassmin_ml import db


def test_resolves_the_synth_database_on_the_apps_server():
    url = db.resolve_url({"DATABASE_URL": "postgres://u:p@localhost:5432/jassmin"})
    assert url == "postgres://u:p@localhost:5432/jassmin_synth"


@pytest.mark.parametrize("key", db.URL_KEYS)
def test_explicit_urls_win_over_database_url(key):
    env = {"DATABASE_URL": "postgres://u:p@h/jassmin", key: "postgres://x:y@other:5433/jassmin_synth"}
    assert db.resolve_url(env) == "postgres://x:y@other:5433/jassmin_synth"


def test_order_of_explicit_urls():
    env = {
        "SYNTH_DATABASE_URL": "postgres://h/jassmin_synth_c",
        "JASSMIN_SYNTH_URI": "postgres://h/jassmin_synth_b",
        "WAREHOUSE_DATABASE_URL": "postgres://h/jassmin_synth_a",
    }
    assert db.resolve_url(env).endswith("/jassmin_synth_a")
    del env["WAREHOUSE_DATABASE_URL"]
    assert db.resolve_url(env).endswith("/jassmin_synth_b")


@pytest.mark.parametrize("name", ["jassmin", "jassmindb", "postgres", "jassmin_synthetic", "Jassmin_synth"])
def test_refuses_other_databases(name):
    with pytest.raises(db.UnsafeDatabaseError):
        db.resolve_url({"WAREHOUSE_DATABASE_URL": f"postgres://h/{name}"})


def test_accepts_a_suffixed_test_database():
    assert db.resolve_url({"WAREHOUSE_DATABASE_URL": "postgres://h/jassmin_synth_test"})


def test_refuses_the_apps_own_database_even_with_a_synth_name():
    env = {"WAREHOUSE_DATABASE_URL": "postgres://h/jassmin_synth", "JASSMINDB_URI": "postgres://h/jassmin_synth"}
    with pytest.raises(db.UnsafeDatabaseError):
        db.resolve_url(env)


def test_no_database_configured():
    with pytest.raises(db.UnsafeDatabaseError):
        db.resolve_url({})


def test_rejects_non_postgres_urls():
    with pytest.raises(ValueError):
        db.resolve_url({"WAREHOUSE_DATABASE_URL": "mysql://h/jassmin_synth"})


def test_sqlalchemy_url_uses_psycopg():
    assert db.sqlalchemy_url("postgres://u:p@h:1/jassmin_synth") == "postgresql+psycopg://u:p@h:1/jassmin_synth"


def test_read_dotenv(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text("# comment\nDATABASE_URL='postgres://h/jassmin'\n\nEMPTY=\nBROKEN\n", encoding="utf-8")
    assert db.read_dotenv(env) == {"DATABASE_URL": "postgres://h/jassmin", "EMPTY": ""}
    assert db.read_dotenv(tmp_path / "missing") == {}


def test_repo_root_is_the_checkout():
    assert (db.REPO_ROOT / "AGENTS.md").is_file()
