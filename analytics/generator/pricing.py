"""A port of the app's cart pricing (`app/.server/services/pricing.ts`, #59, #124, #128).

Amounts are whole kopiyky. One discount per order: the rule that saves the most; on a tie the
entered code wins, then the older rule. The discount is split over the lines in proportion to the
prices of the units it took money off (`allocate_discount`). `app/.server/synthetic-data.contract
.test.ts` checks this port against the TypeScript original on generated carts
(`fixtures/pricing-cases.json`), so the two can't drift apart.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class Line:
    product_public_id: str
    volume_ml: int
    pack_size: int
    unit_price: int
    quantity: int


@dataclass(frozen=True)
class Discount:
    id: int
    slug: str
    code: str | None
    kind: str
    #: Percent, or hryvnias, in kopiyky (15 % is 1500, 499 ₴ is 49900).
    value: int
    scope_volumes_ml: tuple[int, ...] | None = None
    scope_product_public_ids: tuple[str, ...] | None = None
    scope_pack_size: int | None = None
    min_quantity: int = 1
    max_sets: int | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_redemptions: int | None = None
    active: bool = True


@dataclass(frozen=True)
class PricedCart:
    subtotal: int
    discount: int
    total: int
    free_shipping: bool
    discount_id: int | None
    code: str | None
    allocation: list[int]


def available(discount: Discount, now: datetime, redemption_count: int = 0) -> bool:
    if not discount.active or (discount.starts_at is not None and now < discount.starts_at):
        return False
    if discount.ends_at is not None and now >= discount.ends_at:
        return False
    return discount.max_redemptions is None or redemption_count < discount.max_redemptions


def _qualifies(line: Line, discount: Discount) -> bool:
    return (
        (discount.scope_volumes_ml is None or line.volume_ml in discount.scope_volumes_ml)
        and (
            discount.scope_product_public_ids is None
            or line.product_public_id in discount.scope_product_public_ids
        )
        and (discount.scope_pack_size is None or discount.scope_pack_size == line.pack_size)
    )


def discounted_units(lines: list[Line], discount: Discount) -> tuple[int, list[tuple[int, int]]]:
    """(saving, [(line index, unit price)]) for the rule, ignoring its availability."""
    qualifying = [
        (index, line.unit_price)
        for index, line in enumerate(lines)
        if _qualifies(line, discount)
        for _ in range(line.quantity)
    ]
    # Most expensive first; Python's sort is stable, like the TypeScript one.
    qualifying.sort(key=lambda unit: -unit[1])
    if len(qualifying) < discount.min_quantity:
        return 0, []
    value = discount.value
    if discount.kind == "percent":
        units = qualifying
        saving = sum(p for _, p in units) * value // 10_000
    elif discount.kind == "fixed_amount":
        units = qualifying
        saving = min(value, sum(p for _, p in units))
    elif discount.kind == "fixed_price_set":
        sets = len(qualifying) // discount.min_quantity
        if discount.max_sets is not None:
            sets = min(sets, discount.max_sets)
        units = qualifying[: sets * discount.min_quantity]
        saving = sum(p for _, p in units) - sets * value
    elif discount.kind == "percent_every_nth":
        groups = len(qualifying) // discount.min_quantity
        if discount.max_sets is not None:
            groups = min(groups, discount.max_sets)
        units = [qualifying[g * discount.min_quantity - 1] for g in range(1, groups + 1)]
        saving = sum(p for _, p in units) * value // 10_000
    else:
        raise ValueError(f"Unknown discount kind {discount.kind}")
    subtotal = sum(line.unit_price * line.quantity for line in lines)
    saving = min(max(saving, 0), subtotal)
    return (saving, units) if saving > 0 else (0, [])


def allocate_discount(saving: int, units: list[tuple[int, int]], line_count: int) -> list[int]:
    weights = [0] * line_count
    for index, price in units:
        weights[index] += price
    total = sum(weights)
    if saving <= 0 or total <= 0:
        return [0] * line_count
    shares = [saving * w // total for w in weights]
    largest = 0
    for index, weight in enumerate(weights):
        if weight > weights[largest]:
            largest = index
    shares[largest] += saving - sum(shares)
    return shares


def _preferred(a: Discount, b: Discount) -> bool:
    if (a.code is not None) != (b.code is not None):
        return a.code is not None
    return a.id < b.id


def price_cart(
    lines: list[Line],
    candidates: list[Discount],
    now: datetime,
    free_shipping_threshold: int,
) -> PricedCart:
    subtotal = sum(line.unit_price * line.quantity for line in lines)
    best: tuple[Discount, int, list[tuple[int, int]]] | None = None
    for discount in candidates:
        if not available(discount, now):
            continue
        saving, units = discounted_units(lines, discount)
        if saving <= 0:
            continue
        if best is None or saving > best[1] or (saving == best[1] and _preferred(discount, best[0])):
            best = (discount, saving, units)
    saving = best[1] if best else 0
    return PricedCart(
        subtotal=subtotal,
        discount=saving,
        total=subtotal - saving,
        free_shipping=subtotal - saving >= free_shipping_threshold,
        discount_id=best[0].id if best else None,
        code=best[0].code if best else None,
        allocation=allocate_discount(saving, best[2] if best else [], len(lines)),
    )


def money(kopiyky: int) -> str:
    """Kopiyky as a `numeric(10, 2)` string: 49900 -> "499.00"."""
    sign = "-" if kopiyky < 0 else ""
    kopiyky = abs(kopiyky)
    return f"{sign}{kopiyky // 100}.{kopiyky % 100:02d}"


def to_kopiyky(amount: str) -> int:
    whole, _, fraction = amount.partition(".")
    return int(whole) * 100 + int((fraction + "00")[:2])
