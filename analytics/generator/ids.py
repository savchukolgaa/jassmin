"""Seeded identifiers: serial ids per table and UUIDs that are the same for the same seed.

Replaces the prototype's `uuid.uuid4()` (random on every run) and its `globals()["uid"]` patch.
"""

from __future__ import annotations

import random
import uuid
from datetime import datetime

#: Namespace for the variant public ids derived from a product's public id and a volume.
VARIANT_NAMESPACE = uuid.UUID("6f1d3c2e-8a4b-4f6e-9c1d-2b7a5e9f0c13")


class Ids:
    """Serial counters per table (like PostgreSQL `serial`) and seeded UUIDs."""

    def __init__(self, rng: random.Random):
        self.rng = rng
        self.counters: dict[str, int] = {}

    def next(self, table: str) -> int:
        value = self.counters.get(table, 0) + 1
        self.counters[table] = value
        return value

    def uuid4(self) -> str:
        """A random (version 4) UUID drawn from the seeded generator."""
        return str(uuid.UUID(bytes=self.rng.randbytes(16), version=4))

    def uuid7(self, ts: datetime) -> str:
        """A version 7 UUID for `ts`, like the app's `uuidv7()`: ids sort by creation time."""
        ms = int(ts.timestamp() * 1000)
        raw = bytearray(ms.to_bytes(6, "big") + self.rng.randbytes(10))
        raw[6] = (raw[6] & 0x0F) | 0x70  # version 7
        raw[8] = (raw[8] & 0x3F) | 0x80  # RFC 4122 variant
        return str(uuid.UUID(bytes=bytes(raw)))


def variant_public_id(product_public_id: str, volume_ml: int) -> str:
    """A stable public id for a product's size (the catalog has none for sizes)."""
    return str(uuid.uuid5(VARIANT_NAMESPACE, f"{product_public_id}/{volume_ml}"))
