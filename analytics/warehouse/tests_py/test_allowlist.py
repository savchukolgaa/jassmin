"""The allow-list (#183): the raw shape the staging models expect, and no personal column copied."""

import ast
import re
from pathlib import Path

from extract.allowlist import TABLES, readable_columns
from extract.transforms import Transform
from wh import PROJECT_DIR, REPO_ROOT

FRAMES = REPO_ROOT / "analytics" / "generator" / "frames.py"
SCHEMA = REPO_ROOT / "app" / ".server" / "db" / "schema.ts"

#: Words that mark a column holding, or able to hold, personal data or a secret. None may be copied as
#: is (checked per word of the column name, so `shipping_amount` isn't an `ip`).
SENSITIVE = {
    "name", "email", "phone", "address", "password", "waybill", "note", "ip", "referrer", "landing",
    "anonymous", "properties", "token", "callback", "message", "content", "hash",
}  # fmt: skip
#: Contains such a word but is safe: a timestamp.
SAFE = {"email_verified_at"}


def generator_columns() -> dict[str, list[str]]:
    """``frames.COLUMNS``, read without importing the generator (it's another uv project)."""
    tree = ast.parse(FRAMES.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", None) == "COLUMNS":
            return ast.literal_eval(node.value)
    raise AssertionError("COLUMNS not found in frames.py")


def test_every_table_has_the_generators_columns_in_order():
    columns = generator_columns()
    assert set(TABLES) == set(columns) - {"customer_truth"}
    for table, mapping in TABLES.items():
        assert list(mapping) == columns[table], table


def test_no_sensitive_column_is_copied_as_is():
    for table, mapping in TABLES.items():
        for column, transform in mapping.items():
            if SENSITIVE & set(column.split("_")) and column not in SAFE:
                assert transform is not Transform.COPY, f"{table}.{column} is copied as is"


def test_personal_columns_are_never_read():
    never = {
        "users": {"full_name", "password_hash"},
        "orders": {"guest_full_name", "guest_phone", "shipping_address", "waybill_number"},
        "inventory_movements": {"note"},
    }
    for table, columns in never.items():
        assert not columns & set(readable_columns(table)), table


def test_chats_and_secrets_are_not_listed():
    for table in ("perfumer_threads", "perfumer_messages", "auth_tokens", "gift_cards"):
        assert table not in TABLES
    assert "last_callback" not in TABLES["payments"]
    assert "provider_payment_id" not in TABLES["payments"]


def test_every_readable_column_exists_in_the_app_schema():
    """A rename in schema.ts must update the allow-list, or setup's GRANT would fail on deploy."""
    schema = SCHEMA.read_text(encoding="utf-8")
    for table, mapping in TABLES.items():
        match = re.search(rf'pgTable\(\s*"{table}",\s*\{{(.*?)\n  \}}', schema, re.S)
        assert match, f"table {table} not in schema.ts"
        body = match.group(1)
        for column in readable_columns(table):
            camel = re.sub(r"_([a-z])", lambda m: m.group(1).upper(), column)
            assert re.search(rf"^\s*{camel}:", body, re.M), f"{table}.{column} not in schema.ts"


def test_no_model_reads_generator_only_tables():
    """`raw.customer_truth` is #131's ground truth; no model may read it (the prod copy hasn't it)."""
    for path in (PROJECT_DIR / "models").rglob("*.sql"):
        text = path.read_text(encoding="utf-8")
        assert "customer_truth" not in text, path
        assert "generation_runs" not in text, path
