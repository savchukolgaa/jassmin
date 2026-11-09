from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "generator"))

import config  # noqa: E402
from generate import Generated, generate  # noqa: E402

START = datetime(2024, 1, 1, tzinfo=config.KYIV)
END = datetime(2026, 11, 1, tzinfo=config.KYIV)


@pytest.fixture(scope="session")
def run() -> Generated:
    """A mid-sized run shared by the model and anomaly tests."""
    return generate(1500, 2200, START, END, 11)
