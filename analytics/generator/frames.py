"""Rows -> deterministic CSV text per table, used for `COPY` and for `--out`.

The columns are the app's PostgreSQL column names (the raw layer adds no constraints and stores
every value as text, Q2 of #131). NULL is `\\N`; booleans are `t`/`f`; timestamps are ISO 8601 in
UTC with milliseconds; arrays are PostgreSQL array literals; rows are sorted by primary key, so the
same seed always gives byte-identical files.
"""

from __future__ import annotations

import csv
import hashlib
import io
from datetime import datetime, timezone
from typing import Any

NULL = "\\N"

COLUMNS: dict[str, list[str]] = {
    "products": [
        "id", "public_id", "title", "brand", "gender", "fragrance_family", "fragrance_families",
        "store_code", "popular_rank", "price", "volume_ml", "pack_size", "stock_quantity",
        "active", "created_at", "updated_at",
    ],
    "product_variants": [
        "id", "public_id", "product_id", "volume_ml", "price", "stock_quantity", "track_stock",
        "created_at",
    ],
    "discounts": [
        "id", "slug", "code", "kind", "value", "scope_volumes_ml", "scope_product_public_ids",
        "scope_pack_size", "min_quantity", "max_sets", "starts_at", "ends_at", "max_redemptions",
        "redemption_count", "active", "created_at", "updated_at",
    ],
    "users": [
        "id", "full_name", "email", "password_hash", "phone", "acquisition_channel", "role",
        "last_login_at", "created_at", "first_touch_source", "first_touch_medium",
        "first_touch_campaign", "email_verified_at", "city", "marketing_opt_in", "locale",
    ],
    "sessions": [
        "session_id", "user_id", "anonymous_id", "started_at", "ended_at", "landing_page",
        "traffic_source", "traffic_medium", "traffic_campaign", "device_type",
    ],
    "user_events": [
        "event_id", "user_id", "anonymous_id", "session_id", "event_type", "product_id",
        "event_properties", "source", "medium", "campaign", "device_type", "referrer",
        "created_at",
    ],
    "carts": [
        "id", "user_id", "session_id", "status", "created_at", "updated_at", "abandoned_at",
        "discount_id", "reminder_sent_at", "restored_at",
    ],
    "cart_items": ["id", "cart_id", "product_id", "variant_id", "quantity", "added_at"],
    "orders": [
        "id", "user_id", "guest_full_name", "guest_email", "guest_phone", "shipping_address",
        "cart_id", "free_shipping", "status", "payment_status", "payment_method", "subtotal",
        "discount_amount", "shipping_amount", "gift_card_amount", "total_amount", "currency",
        "created_at", "updated_at", "paid_at", "cancelled_at", "refunded_at", "shipped_at",
        "completed_at", "arrived_at", "waybill_number", "discount_id", "returned_at",
        "cancel_reason",
    ],
    "order_items": [
        "id", "order_id", "product_id", "variant_id", "volume_ml", "quantity",
        "price_at_purchase", "discount_allocated",
    ],
    "payments": [
        "id", "order_id", "provider", "reference", "status", "amount", "currency", "created_at",
        "updated_at", "completed_at",
    ],
    "order_status_history": ["id", "order_id", "status", "changed_at", "source"],
    "inventory_movements": [
        "id", "variant_id", "occurred_at", "reason", "quantity_delta", "stock_after", "order_id",
        "source", "note",
    ],
    "customer_truth": [
        "user_id", "segment", "purchase_rate", "churn_probability", "favourite_family",
        "usual_device", "acquisition_channel", "churned_at",
    ],
}  # fmt: skip

#: Loaded in this order (parents before children).
TABLE_ORDER = list(COLUMNS)


def primary_key(table: str) -> str:
    return COLUMNS[table][0]


def _array_element(value: Any) -> str:
    if isinstance(value, int):
        return str(value)
    text = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{text}"'


def cell(value: Any) -> str:
    if value is None:
        return NULL
    if isinstance(value, bool):
        return "t" if value else "f"
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat(timespec="milliseconds")
    if isinstance(value, float):
        return f"{value:.4f}"
    if isinstance(value, (list, tuple)):
        return "{" + ",".join(_array_element(v) for v in value) + "}"
    return str(value)


def render(table: str, rows: list[dict[str, Any]], columns: list[str] | None = None) -> str:
    """The table as CSV text (no header), sorted by its primary key."""
    columns = columns or COLUMNS[table]
    key = columns[0]
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    for row in sorted(rows, key=lambda r: r[key]):
        writer.writerow([cell(row.get(c)) for c in columns])
    return out.getvalue()


def digest(payloads: dict[str, str]) -> str:
    """One SHA-256 over every table's payload, in table order."""
    h = hashlib.sha256()
    for table in sorted(payloads):
        h.update(table.encode())
        h.update(payloads[table].encode())
    return h.hexdigest()
