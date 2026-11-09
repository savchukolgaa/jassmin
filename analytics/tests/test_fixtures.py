"""Committed generated files are up to date, and the script's dependencies match the project's."""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

import fixtures

GENERATOR = Path(__file__).resolve().parents[1] / "generator"


def test_fixtures_are_fresh():
    for name, text in fixtures.render().items():
        committed = (GENERATOR / "fixtures" / name).read_text(encoding="utf-8")
        assert committed == text, f"{name} is stale: run `uv run --project analytics analytics/generator/fixtures.py`"


def test_inline_script_dependencies_match_pyproject():
    script = (GENERATOR / "generate.py").read_text(encoding="utf-8")
    block = re.search(r"^# /// script\n(.*?)^# ///$", script, re.S | re.M)
    assert block
    inline = tomllib.loads("\n".join(line.removeprefix("# ").removeprefix("#") for line in block.group(1).splitlines()))
    project = tomllib.loads((GENERATOR.parent / "pyproject.toml").read_text(encoding="utf-8"))
    assert inline["dependencies"] == project["project"]["dependencies"]
    assert inline["requires-python"] == project["project"]["requires-python"]


def test_catalog_is_the_real_one():
    catalog = json.loads((GENERATOR / "data" / "catalog.json").read_text(encoding="utf-8"))
    assert len(catalog["products"]) == 128
    assert catalog["prices"] == {"5": "119.00", "10": "240.00", "30": "459.00", "50": "629.00", "100": "969.00"}
