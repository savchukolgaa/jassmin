"""How each allow-listed value is changed on its way into ``jassmin_wh`` (#183).

Every function takes the app's value as text (``None`` for SQL null) and returns the text that is
written to ``raw.*``, never the personal value itself.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from enum import Enum
from urllib.parse import urlsplit, urlunsplit

#: Test accounts keep this domain, so staging can still recognise and drop them (#132).
TEST_EMAIL_DOMAIN = "example.com"
#: The domain of every other pseudonymised email (`.invalid` can never be delivered to).
PSEUDONYM_EMAIL_DOMAIN = "pseudonym.invalid"
#: The pseudonym key must be at least this long.
MIN_KEY_LENGTH = 32


class Transform(Enum):
    COPY = "copy"
    """The value as it is: no personal data."""
    NULL = "null"
    """Never read (not even granted to the extract role); written as null."""
    EMAIL_PSEUDONYM = "email_pseudonym"
    """A keyed hash of the normalised email, as ``<hash>@pseudonym.invalid``."""
    ID_PSEUDONYM = "id_pseudonym"
    """A keyed hash of an identifier (the visitor cookie)."""
    PRESENCE = "presence"
    """``present`` when there is a value, else null: keeps a "has a phone" flag, not the phone."""
    PATH_ONLY = "path_only"
    """A URL or path without its query string and fragment (which can hold tokens)."""
    ORIGIN_ONLY = "origin_only"
    """A URL's scheme and host only."""
    EVENT_PROPERTIES = "event_properties"
    """The #129 event properties without free text (see ``event_properties``)."""


def _digest(key: bytes, value: str) -> str:
    return hmac.new(key, value.encode("utf-8"), hashlib.sha256).hexdigest()[:32]


def email_pseudonym(value: str | None, key: bytes) -> str | None:
    """``<hash>@example.com`` for a test account, else ``<hash>@pseudonym.invalid``.

    The hash is of ``lower(trim(email))``, staging's own normalisation, so a guest's repeat orders
    stay one customer and a registered user's email matches their orders'.
    """
    if value is None:
        return None
    normalised = value.strip().lower()
    if not normalised:
        return None
    domain = normalised.rpartition("@")[2]
    suffix = TEST_EMAIL_DOMAIN if domain == TEST_EMAIL_DOMAIN else PSEUDONYM_EMAIL_DOMAIN
    return f"{_digest(key, 'email:' + normalised)}@{suffix}"


def id_pseudonym(value: str | None, key: bytes) -> str | None:
    if value is None or not value.strip():
        return None
    return _digest(key, "id:" + value.strip())


def presence(value: str | None) -> str | None:
    return "present" if value is not None and value.strip() else None


def path_only(value: str | None) -> str | None:
    """``/uk/reset-password?token=…#x`` → ``/uk/reset-password``; keeps a full URL's origin."""
    if value is None:
        return None
    parts = urlsplit(value.strip())
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def origin_only(value: str | None) -> str | None:
    """``https://www.google.com/search?q=…`` → ``https://www.google.com``; null when it has no host."""
    if value is None:
        return None
    parts = urlsplit(value.strip())
    if not parts.netloc:
        return None
    return urlunsplit((parts.scheme, parts.netloc.rpartition("@")[2], "", "", ""))


def event_properties(value: str | None) -> str | None:
    """The event's properties (#129) without anything a person could have typed.

    The contract is strict objects of ids, numbers, enums and catalogue labels; its only free text is
    ``search.query`` (reserved, always null today) and a page's ``path``, whose query string can hold
    a reset or unsubscribe token. So: ``query`` → null, ``path`` → path only. Perfumer events never
    hold text (#166). Anything that isn't a JSON object is dropped.
    """
    if value is None:
        return None
    try:
        properties = json.loads(value)
    except ValueError:
        return None
    if not isinstance(properties, dict):
        return None
    if "query" in properties:
        properties["query"] = None
    if isinstance(properties.get("path"), str):
        properties["path"] = path_only(properties["path"])
    return json.dumps(properties, ensure_ascii=False, separators=(",", ":"))


def apply(transform: Transform, value: str | None, key: bytes) -> str | None:
    match transform:
        case Transform.COPY:
            return value
        case Transform.NULL:
            return None
        case Transform.EMAIL_PSEUDONYM:
            return email_pseudonym(value, key)
        case Transform.ID_PSEUDONYM:
            return id_pseudonym(value, key)
        case Transform.PRESENCE:
            return presence(value)
        case Transform.PATH_ONLY:
            return path_only(value)
        case Transform.ORIGIN_ONLY:
            return origin_only(value)
        case Transform.EVENT_PROPERTIES:
            return event_properties(value)


def pseudonym_key(raw: str | None) -> bytes:
    """The HMAC key from ``WH_PSEUDONYM_KEY``; refuses a missing or short one."""
    if not raw or len(raw) < MIN_KEY_LENGTH:
        raise ValueError(f"WH_PSEUDONYM_KEY must be set, at least {MIN_KEY_LENGTH} characters.")
    return raw.encode("utf-8")
