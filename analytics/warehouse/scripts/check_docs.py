"""Fail when a warehouse model or column has no description (#132).

    uv run --project analytics/warehouse analytics/warehouse/wh.py docs generate
    uv run --project analytics/warehouse analytics/warehouse/scripts/check_docs.py

Reads dbt's ``target/manifest.json`` (what the YAML documents) and ``target/catalog.json`` (the
columns that really exist in the database, written by ``dbt docs generate``). Every model needs a
description, and so does every column it actually has. Sources need a description for the table and
for each column they declare (the raw tables have many columns no model reads).
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any

TARGET_DIR = Path(__file__).resolve().parents[1] / "target"


def _described(entry: Mapping[str, Any]) -> bool:
    return bool(str(entry.get("description") or "").strip())


def missing_descriptions(manifest: Mapping[str, Any], catalog: Mapping[str, Any]) -> list[str]:
    """Every undocumented model, model column and source (column), as ``name[.column]`` lines."""
    problems: list[str] = []
    nodes: Mapping[str, Any] = manifest.get("nodes", {})
    for unique_id, node in sorted(nodes.items()):
        if node.get("resource_type") != "model":
            continue
        name = node["name"]
        if not _described(node):
            problems.append(f"{name}: the model has no description")
        documented = {
            column_name.lower(): column
            for column_name, column in node.get("columns", {}).items()
        }
        catalog_node = catalog.get("nodes", {}).get(unique_id)
        if catalog_node is None:
            problems.append(f"{name}: not in catalog.json (was it built before docs generate?)")
            continue
        for column_name in catalog_node.get("columns", {}):
            column = documented.get(column_name.lower())
            if column is None or not _described(column):
                problems.append(f"{name}.{column_name}: no description")
    for _, source in sorted(manifest.get("sources", {}).items()):
        name = f"{source['source_name']}.{source['name']}"
        if not _described(source):
            problems.append(f"{name}: the source table has no description")
        for column_name, column in source.get("columns", {}).items():
            if not _described(column):
                problems.append(f"{name}.{column_name}: no description")
    return problems


def main(target_dir: Path = TARGET_DIR) -> int:
    try:
        manifest = json.loads((target_dir / "manifest.json").read_text(encoding="utf-8"))
        catalog = json.loads((target_dir / "catalog.json").read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        print(f"check_docs: {error.filename} is missing; run `wh.py docs generate` first.")
        return 2
    problems = missing_descriptions(manifest, catalog)
    for problem in problems:
        print(f"check_docs: {problem}")
    if problems:
        print(f"check_docs: {len(problems)} undocumented item(s).")
        return 1
    models = sum(1 for n in manifest["nodes"].values() if n.get("resource_type") == "model")
    print(f"check_docs: every column of {models} models is described.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
