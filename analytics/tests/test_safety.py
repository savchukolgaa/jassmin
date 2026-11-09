"""The generator never writes to anything but a synth database."""

from __future__ import annotations

import pytest

import db

APP = "postgres://jassmin:secret@localhost:5432/jassmin"


@pytest.mark.parametrize("name", ["jassmin", "postgres", "jassmindb", "jassmin_synthx", "synth", "jassmin_synth-x"])
def test_refuses_other_databases(name):
    with pytest.raises(db.UnsafeTarget):
        db.check_target(f"postgres://u:p@localhost:5432/{name}", [APP])


def test_accepts_synth_databases():
    db.check_target("postgres://u:p@localhost:5432/jassmin_synth", [APP])
    db.check_target("postgres://u:p@localhost:5432/jassmin_synth_test_42", [APP])


def test_refuses_the_apps_database_even_if_named_synth():
    with pytest.raises(db.UnsafeTarget):
        db.check_target("postgres://u:p@localhost:5432/jassmin_synth", ["postgres://x@localhost:5432/jassmin_synth"])


def test_resolve_replaces_the_database_name():
    target = db.resolve_target("jassmin_synth", env={}, dotenv={"DATABASE_URL": APP})
    assert target == "postgres://jassmin:secret@localhost:5432/jassmin_synth"
    aspire = "postgresql://postgres:pw@localhost:61234/jassmin_synth"
    assert db.resolve_target("jassmin_synth", env={"JASSMIN_SYNTH_URI": aspire}, dotenv={}) == aspire


def test_resolve_refuses_bad_names_and_no_server():
    with pytest.raises(db.UnsafeTarget):
        db.resolve_target("jassmin", env={}, dotenv={"DATABASE_URL": APP})
    with pytest.raises(db.UnsafeTarget):
        db.resolve_target("jassmin_synth", env={}, dotenv={})


def test_redact_hides_the_password():
    assert "secret" not in db.redact(APP)
