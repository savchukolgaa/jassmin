"""Fixtures the app's Vitest suite checks the generator against (#131):

- `fixtures/sample-events.json`: generated events of every type, validated against the app's
  `eventPropertiesSchemas` (the #129 contract);
- `fixtures/pricing-cases.json`: generated carts with this port's prices, compared with the app's
  `priceCart` (`app/.server/synthetic-data.contract.test.ts`).

Regenerate after changing the simulation or pricing.py:

    uv run --project analytics analytics/generator/fixtures.py

`tests/test_fixtures.py` fails while the committed files are stale.
"""

from __future__ import annotations

import json
import random
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import config  # noqa: E402
from catalog import build_discounts, load_catalog  # noqa: E402
from pricing import Discount, Line, money, price_cart  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
START = datetime(2024, 1, 1, tzinfo=config.KYIV)
END = datetime(2026, 11, 1, tzinfo=config.KYIV)


def sample_events() -> list[dict]:
    from generate import generate

    generated = generate(200, 300, START, END, 7)
    rows = sorted(generated.output.tables["user_events"], key=lambda e: e["event_id"])
    per_type: dict[str, int] = {}
    samples = []
    for row in rows:
        if per_type.get(row["event_type"], 0) >= 4:
            continue
        per_type[row["event_type"]] = per_type.get(row["event_type"], 0) + 1
        samples.append({"event_type": row["event_type"], "event_properties": json.loads(row["event_properties"])})
    return samples


def _discount_json(d: Discount) -> dict:
    return {
        "id": d.id, "code": d.code, "kind": d.kind, "value": money(d.value),
        "scopeVolumesMl": list(d.scope_volumes_ml) if d.scope_volumes_ml else None,
        "scopeProductPublicIds": None, "scopePackSize": d.scope_pack_size,
        "minQuantity": d.min_quantity, "maxSets": d.max_sets,
        "startsAt": d.starts_at.isoformat() if d.starts_at else None,
        "endsAt": d.ends_at.isoformat() if d.ends_at else None,
        "maxRedemptions": d.max_redemptions, "redemptionCount": 0, "active": d.active,
    }  # fmt: skip


def pricing_cases(count: int = 80) -> list[dict]:
    import numpy as np

    rng = random.Random(131)
    catalog = load_catalog(np.random.default_rng(131), START, END)
    discounts = build_discounts(START, END)
    automatic = [d for d in discounts if d.code is None]
    coded = [d for d in discounts if d.code is not None]
    cases = []
    for n in range(count):
        now = START + timedelta(days=rng.uniform(0, (END - START).days))
        if n % 5 == 0:  # around 8 March, so the spring codes apply
            now = datetime(rng.choice([2024, 2025, 2026]), 3, rng.randint(1, 8), 12, tzinfo=config.KYIV)
        if n % 7 == 0:  # many 10 ml testers: several trio sets, capped at three
            volumes = [10] * rng.randint(3, 11)
        elif n % 7 == 1:  # full bottles: the couple offer
            volumes = [rng.choice(config.FULL_BOTTLES) for _ in range(rng.randint(2, 5))]
        else:
            volumes = [rng.choice([5, 10, 30, 50, 100]) for _ in range(rng.randint(1, 5))]
        lines: list[Line] = []
        for volume in volumes:
            product = rng.choice(catalog.products)
            variant = product.variants[volume]
            if any(line.product_public_id == product.public_id and line.volume_ml == volume for line in lines):
                continue
            lines.append(Line(product.public_id, volume, 1, variant.price, rng.choice([1, 1, 1, 2, 3])))
        candidates = automatic + ([rng.choice(coded)] if rng.random() < 0.5 else [])
        priced = price_cart(lines, candidates, now, catalog.free_shipping_threshold)
        cases.append({
            "now": now.isoformat(),
            "lines": [
                {"productPublicId": line.product_public_id, "volumeMl": line.volume_ml,
                 "packSize": line.pack_size, "unitPrice": line.unit_price, "quantity": line.quantity}
                for line in lines
            ],
            "candidates": [_discount_json(d) for d in candidates],
            "expected": {
                "subtotal": priced.subtotal, "discount": priced.discount, "total": priced.total,
                "freeShipping": priced.free_shipping, "discountId": priced.discount_id,
                "allocation": priced.allocation,
            },
        })  # fmt: skip
    return cases


def render() -> dict[str, str]:
    """The fixture files' exact text."""
    dump = lambda value: json.dumps(value, ensure_ascii=False, indent=2) + "\n"  # noqa: E731
    return {"sample-events.json": dump(sample_events()), "pricing-cases.json": dump(pricing_cases())}


def main() -> None:
    FIXTURES.mkdir(exist_ok=True)
    for name, text in render().items():
        (FIXTURES / name).write_text(text, encoding="utf-8", newline="\n")
        print(f"Wrote {FIXTURES / name}")


if __name__ == "__main__":
    main()
