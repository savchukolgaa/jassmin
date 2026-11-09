from scripts.check_docs import missing_descriptions


def model(name: str, description: str, columns: dict[str, str]) -> dict:
    return {
        "resource_type": "model",
        "name": name,
        "description": description,
        "columns": {c: {"name": c, "description": d} for c, d in columns.items()},
    }


def test_a_fully_documented_project_passes():
    manifest = {
        "nodes": {"model.w.fct": model("fct", "Facts.", {"id": "The id.", "amount": "UAH."})},
        "sources": {
            "source.w.raw.orders": {
                "source_name": "raw",
                "name": "orders",
                "description": "Orders.",
                "columns": {"id": {"description": "The id."}},
            }
        },
    }
    catalog = {"nodes": {"model.w.fct": {"columns": {"id": {}, "AMOUNT": {}}}}}
    assert missing_descriptions(manifest, catalog) == []


def test_reports_undocumented_models_columns_and_sources():
    manifest = {
        "nodes": {
            "model.w.fct": model("fct", "", {"id": "The id.", "note": "  "}),
            "test.w.some_test": {"resource_type": "test", "name": "some_test"},
        },
        "sources": {
            "source.w.raw.users": {
                "source_name": "raw",
                "name": "users",
                "description": "",
                "columns": {"email": {"description": ""}},
            }
        },
    }
    catalog = {"nodes": {"model.w.fct": {"columns": {"id": {}, "note": {}, "extra": {}}}}}
    assert missing_descriptions(manifest, catalog) == [
        "fct: the model has no description",
        "fct.note: no description",
        "fct.extra: no description",
        "raw.users: the source table has no description",
        "raw.users.email: no description",
    ]


def test_a_model_missing_from_the_catalog_is_reported():
    manifest = {"nodes": {"model.w.new": model("new", "New.", {})}, "sources": {}}
    assert missing_descriptions(manifest, {"nodes": {}}) == [
        "new: not in catalog.json (was it built before docs generate?)"
    ]
