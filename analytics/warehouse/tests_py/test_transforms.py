import json

import pytest

from extract.transforms import (
    Transform,
    apply,
    email_pseudonym,
    event_properties,
    id_pseudonym,
    origin_only,
    path_only,
    presence,
    pseudonym_key,
)

KEY = b"k" * 32
OTHER_KEY = b"o" * 32


def test_email_pseudonym_hides_the_address_and_matches_staging_normalisation():
    value = email_pseudonym("  Olena.K@Gmail.com ", KEY)
    assert value is not None
    assert "olena" not in value.lower() and "gmail" not in value
    assert value.endswith("@pseudonym.invalid")
    # lower(trim()) first, so the same person's differently typed emails are one customer.
    assert value == email_pseudonym("olena.k@gmail.com", KEY)
    assert value != email_pseudonym("olena.k@gmail.com", OTHER_KEY)
    assert value != email_pseudonym("other@gmail.com", KEY)


def test_email_pseudonym_keeps_test_accounts_recognisable():
    value = email_pseudonym("QA+1@Example.com", KEY)
    assert value is not None and value.endswith("@example.com") and "qa" not in value
    assert email_pseudonym(None, KEY) is None
    assert email_pseudonym("  ", KEY) is None


def test_id_pseudonym_is_stable_and_keyed():
    assert id_pseudonym("anon-123", KEY) == id_pseudonym("anon-123", KEY)
    assert id_pseudonym("anon-123", KEY) != id_pseudonym("anon-123", OTHER_KEY)
    assert "anon" not in (id_pseudonym("anon-123", KEY) or "")
    assert id_pseudonym(None, KEY) is None


def test_presence_keeps_only_whether_there_is_a_value():
    assert presence("+380501234567") == "present"
    assert presence(None) is None
    assert presence(" ") is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("/uk/reset-password?token=SECRET#top", "/uk/reset-password"),
        ("/katalog/zhinochi", "/katalog/zhinochi"),
        ("https://jassmin.ua/en/unsubscribe?t=SECRET", "https://jassmin.ua/en/unsubscribe"),
        (None, None),
    ],
)
def test_path_only_drops_query_and_fragment(value, expected):
    assert path_only(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("https://www.google.com/search?q=olena+phone", "https://www.google.com"),
        ("https://user:pw@mail.example.org/inbox/123", "https://mail.example.org"),
        ("/relative/path", None),
        (None, None),
    ],
)
def test_origin_only_keeps_scheme_and_host(value, expected):
    assert origin_only(value) == expected


def test_event_properties_drop_free_text():
    page = json.loads(event_properties('{"path": "/uk/verify-email?token=SECRET"}') or "")
    assert page == {"path": "/uk/verify-email"}
    search = json.loads(event_properties('{"search_id": "x", "query": "Olena", "page": 1}') or "")
    assert search == {"search_id": "x", "query": None, "page": 1}
    perfumer = '{"reply_id": "r", "turn": 1, "pick_ids": ["a"]}'
    assert json.loads(event_properties(perfumer) or "") == json.loads(perfumer)
    assert event_properties("not json") is None
    assert event_properties('"a string"') is None
    assert event_properties(None) is None


def test_apply_dispatches_every_transform():
    for transform in Transform:
        apply(transform, None, KEY)  # Never raises on null.
    assert apply(Transform.COPY, "x", KEY) == "x"
    assert apply(Transform.NULL, "secret", KEY) is None


def test_pseudonym_key_must_be_long_enough():
    with pytest.raises(ValueError):
        pseudonym_key(None)
    with pytest.raises(ValueError):
        pseudonym_key("short")
    assert pseudonym_key("x" * 32) == b"x" * 32
