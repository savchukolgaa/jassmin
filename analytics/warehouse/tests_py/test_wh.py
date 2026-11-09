import pytest

from wh import (
    Connection,
    UnsafeDatabaseError,
    dbt_args,
    guard_synth,
    parse_url,
    read_dotenv,
    resolve,
    resolve_synth,
    target_of,
    with_database,
)


def test_parse_url_reads_every_part_and_decodes_them():
    assert parse_url("postgres://user%40x:p%3Ass@db.local:6543/jassmin_synth") == Connection(
        host="db.local", port=6543, user="user@x", password="p:ss", dbname="jassmin_synth"
    )


def test_parse_url_defaults_port_and_rejects_other_schemes():
    assert parse_url("postgresql://u@h/jassmin_synth").port == 5432
    with pytest.raises(ValueError):
        parse_url("mysql://u@h/jassmin_synth")
    with pytest.raises(ValueError):
        parse_url("postgres://u@h/")


def test_with_database_swaps_only_the_database():
    assert (
        with_database("postgres://u:p@h:5432/jassmin?sslmode=disable", "jassmin_synth")
        == "postgres://u:p@h:5432/jassmin_synth?sslmode=disable"
    )


@pytest.mark.parametrize(
    ("env", "dbname"),
    [
        (
            {
                "WAREHOUSE_DATABASE_URL": "postgres://u@h/jassmin_synth_test_1",
                "JASSMIN_SYNTH_URI": "postgres://u@h/jassmin_synth",
            },
            "jassmin_synth_test_1",
        ),
        (
            {
                "JASSMIN_SYNTH_URI": "postgres://u@h/jassmin_synth",
                "SYNTH_DATABASE_URL": "postgres://u@h/jassmin_synth_x",
            },
            "jassmin_synth",
        ),
        ({"SYNTH_DATABASE_URL": "postgres://u@h/jassmin_synth_x"}, "jassmin_synth_x"),
        # The app's DATABASE_URL: same server, database swapped for jassmin_synth.
        ({"DATABASE_URL": "postgres://u:p@h:5432/jassmin"}, "jassmin_synth"),
    ],
)
def test_resolve_synth_follows_the_documented_order(env, dbname):
    assert resolve_synth(env).dbname == dbname


def test_resolve_synth_without_any_url_explains_what_to_set():
    with pytest.raises(UnsafeDatabaseError, match="WAREHOUSE_DATABASE_URL"):
        resolve_synth({})


@pytest.mark.parametrize("dbname", ["jassmin", "jassmindb", "postgres", "jassmin_synthx", "x_jassmin_synth"])
def test_the_guard_refuses_anything_but_jassmin_synth(dbname):
    with pytest.raises(UnsafeDatabaseError):
        guard_synth(dbname, app_dbname="jassmindb")


def test_the_guard_refuses_the_apps_own_database_even_if_named_like_synth():
    with pytest.raises(UnsafeDatabaseError, match="app's database"):
        resolve_synth(
            {
                "WAREHOUSE_DATABASE_URL": "postgres://u@h/jassmin_synth",
                "JASSMINDB_URI": "postgres://u@h/jassmin_synth",
            }
        )


def test_the_guard_accepts_synth_and_test_suffixes():
    guard_synth("jassmin_synth", app_dbname="jassmin")
    guard_synth("jassmin_synth_test_42", app_dbname="jassmin")


def test_prod_needs_its_own_url_and_skips_the_synth_guard():
    with pytest.raises(UnsafeDatabaseError, match="WAREHOUSE_PROD_URL"):
        resolve("prod", {"DATABASE_URL": "postgres://u@h/jassmin"})
    assert resolve("prod", {"WAREHOUSE_PROD_URL": "postgres://ro@replica/jassmin"}).dbname == "jassmin"
    with pytest.raises(UnsafeDatabaseError, match="Unknown target"):
        resolve("staging", {})


def test_target_of_reads_the_dbt_flag(monkeypatch):
    monkeypatch.delenv("WAREHOUSE_TARGET", raising=False)
    assert target_of(["build"]) == "synth"
    assert target_of(["build", "--target", "prod"]) == "prod"
    assert target_of(["build", "-t", "prod"]) == "prod"
    assert target_of(["build", "--target=prod"]) == "prod"


def test_dbt_args_add_the_project_directories_once():
    args = dbt_args(["build", "--select", "staging"])
    assert args[:3] == ["build", "--select", "staging"]
    assert args.count("--project-dir") == 1 and args.count("--profiles-dir") == 1
    assert dbt_args(["debug", "--project-dir", "x", "--profiles-dir", "y"]) == [
        "debug",
        "--project-dir",
        "x",
        "--profiles-dir",
        "y",
    ]


def test_read_dotenv_parses_simple_lines(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# comment\nDATABASE_URL='postgres://u@h/jassmin'\nEMPTY=\nnot a line\n", encoding="utf-8")
    assert read_dotenv(env) == {"DATABASE_URL": "postgres://u@h/jassmin", "EMPTY": ""}
    assert read_dotenv(tmp_path / "missing") == {}


def test_connection_env_holds_everything_profiles_yml_reads():
    env = Connection("h", 5433, "u", "p", "jassmin_synth").env("synth")
    assert env == {
        "WAREHOUSE_TARGET": "synth",
        "WAREHOUSE_HOST": "h",
        "WAREHOUSE_PORT": "5433",
        "WAREHOUSE_USER": "u",
        "WAREHOUSE_PASSWORD": "p",
        "WAREHOUSE_DBNAME": "jassmin_synth",
    }
