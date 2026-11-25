"""The only app tables and columns the warehouse may read from the shop's database (#183).

Each table lists the columns of #131's raw layer (``analytics/generator/frames.py`` → ``COLUMNS``,
the shape the staging models read), in that order, with the transform that is applied on the way
into ``jassmin_wh.raw``. A ``NULL`` column is never read: ``setup.py`` grants the extract role
``SELECT`` on exactly the other columns, so Postgres refuses the rest, and a column added to the app
later is invisible to the warehouse until it is added here.

Never read: names, password hashes, guest phones, addresses, waybill numbers, staff notes, the
payment provider's callback, and every table not listed (AI perfumer chats, gift card codes, auth
tokens, emails sent, newsletters, rate limits, ...).
"""

from __future__ import annotations

from extract.transforms import Transform

C = Transform.COPY
N = Transform.NULL

TABLES: dict[str, dict[str, Transform]] = {
    "products": {
        "id": C, "public_id": C, "title": C, "brand": C, "gender": C, "fragrance_family": C,
        "fragrance_families": C, "store_code": C, "popular_rank": C, "price": C, "volume_ml": C,
        "pack_size": C, "stock_quantity": C, "active": C, "created_at": C, "updated_at": C,
    },
    "product_variants": {
        "id": C, "public_id": C, "product_id": C, "volume_ml": C, "price": C, "stock_quantity": C,
        "track_stock": C, "created_at": C,
    },
    "discounts": {
        "id": C, "slug": C, "code": C, "kind": C, "value": C, "scope_volumes_ml": C,
        "scope_product_public_ids": C, "scope_pack_size": C, "min_quantity": C, "max_sets": C,
        "starts_at": C, "ends_at": C, "max_redemptions": C, "redemption_count": C, "active": C,
        "created_at": C, "updated_at": C,
    },
    "users": {
        "id": C,
        "full_name": N,
        "email": Transform.EMAIL_PSEUDONYM,
        "password_hash": N,
        "phone": Transform.PRESENCE,
        "acquisition_channel": C, "role": C, "last_login_at": C, "created_at": C,
        "first_touch_source": C, "first_touch_medium": C, "first_touch_campaign": C,
        "email_verified_at": C, "city": C, "marketing_opt_in": C, "locale": C,
    },
    "sessions": {
        "session_id": C, "user_id": C,
        "anonymous_id": Transform.ID_PSEUDONYM,
        "started_at": C, "ended_at": C,
        "landing_page": Transform.PATH_ONLY,
        "traffic_source": C, "traffic_medium": C, "traffic_campaign": C, "device_type": C,
    },
    "user_events": {
        "event_id": C, "user_id": C,
        "anonymous_id": Transform.ID_PSEUDONYM,
        "session_id": C, "event_type": C, "product_id": C,
        "event_properties": Transform.EVENT_PROPERTIES,
        "source": C, "medium": C, "campaign": C, "device_type": C,
        "referrer": Transform.ORIGIN_ONLY,
        "created_at": C,
    },
    "carts": {
        "id": C, "user_id": C, "session_id": C, "status": C, "created_at": C, "updated_at": C,
        "abandoned_at": C, "discount_id": C, "reminder_sent_at": C, "restored_at": C,
    },
    "cart_items": {
        "id": C, "cart_id": C, "product_id": C, "variant_id": C, "quantity": C, "added_at": C,
    },
    "orders": {
        "id": C, "user_id": C,
        "guest_full_name": N,
        "guest_email": Transform.EMAIL_PSEUDONYM,
        "guest_phone": N,
        "shipping_address": N,
        "cart_id": C, "free_shipping": C, "status": C, "payment_status": C, "payment_method": C,
        "subtotal": C, "discount_amount": C, "shipping_amount": C, "gift_card_amount": C,
        "total_amount": C, "currency": C, "created_at": C, "updated_at": C, "paid_at": C,
        "cancelled_at": C, "refunded_at": C, "shipped_at": C, "completed_at": C, "arrived_at": C,
        "waybill_number": N,
        "discount_id": C, "returned_at": C, "cancel_reason": C,
    },
    "order_items": {
        "id": C, "order_id": C, "product_id": C, "variant_id": C, "volume_ml": C, "quantity": C,
        "price_at_purchase": C, "discount_allocated": C,
    },
    "payments": {
        "id": C, "order_id": C, "provider": C, "reference": C, "status": C, "amount": C,
        "currency": C, "created_at": C, "updated_at": C, "completed_at": C,
    },
    "order_status_history": {
        "id": C, "order_id": C, "status": C, "changed_at": C, "source": C,
    },
    "inventory_movements": {
        "id": C, "variant_id": C, "occurred_at": C, "reason": C, "quantity_delta": C,
        "stock_after": C, "order_id": C, "source": C,
        "note": N,
    },
}  # fmt: skip


def readable_columns(table: str) -> list[str]:
    """The app columns of ``table`` the extract role may read (every column that isn't ``NULL``)."""
    return [column for column, transform in TABLES[table].items() if transform is not Transform.NULL]
