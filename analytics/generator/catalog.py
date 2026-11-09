"""The shop's real catalog (data/catalog.json, from `pnpm analytics:export-catalog`) and its
discount rules, as the simulation uses them."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

import config
from ids import variant_public_id
from pricing import Discount, to_kopiyky

CATALOG_JSON = Path(__file__).parent / "data" / "catalog.json"


@dataclass(eq=False)
class Variant:
    id: int
    public_id: str
    product_id: int
    volume_ml: int
    price: int
    track_stock: bool


@dataclass(eq=False)
class Product:
    id: int
    public_id: str
    title: str
    brand: str
    gender: str
    store_code: str
    families: list[str]
    popular_rank: int | None
    variants: dict[int, Variant] = field(default_factory=dict)


@dataclass
class Catalog:
    products: list[Product]
    variants: list[Variant]
    families: list[str]
    free_shipping_threshold: int
    #: Probability of each product when a shopper isn't looking in their favourite family.
    popularity: np.ndarray
    by_family: dict[str, list[Product]]
    by_gender: dict[str, list[Product]]
    #: The `/popular` page, in `popular_rank` order.
    popular: list[Product]
    discounts: list[Discount]
    created_at: datetime


def load_catalog(rng: np.random.Generator, start: datetime, end: datetime) -> Catalog:
    data = json.loads(CATALOG_JSON.read_text(encoding="utf-8"))
    prices = {int(volume): to_kopiyky(price) for volume, price in data["prices"].items()}
    products: list[Product] = []
    variants: list[Variant] = []
    for index, entry in enumerate(data["products"], start=1):
        product = Product(
            id=index,
            public_id=entry["publicId"],
            title=entry["title"],
            brand=entry["brand"],
            gender=entry["gender"],
            store_code=entry["storeCode"],
            families=list(entry["fragranceFamilies"]),
            popular_rank=entry["popularRank"],
        )
        for volume, price in prices.items():
            variant = Variant(
                id=len(variants) + 1,
                public_id=variant_public_id(product.public_id, volume),
                product_id=product.id,
                volume_ml=volume,
                price=price,
                track_stock=volume in config.TRACKED_VOLUMES,
            )
            variants.append(variant)
            product.variants[volume] = variant
        products.append(product)

    # A few bestsellers: Gamma weights, boosted for the products on the popular list.
    weights = rng.gamma(0.6, 1.0, len(products))
    for i, product in enumerate(products):
        if product.popular_rank is not None:
            weights[i] *= 3.0
    popularity = weights / weights.sum()

    families = list(data["fragranceFamilies"])
    by_family = {f: [p for p in products if f in p.families] for f in families}
    by_gender = {g: [p for p in products if p.gender == g] for g in ("women", "men", "unisex")}
    popular = sorted((p for p in products if p.popular_rank is not None), key=lambda p: p.popular_rank)
    return Catalog(
        products=products,
        variants=variants,
        families=families,
        free_shipping_threshold=to_kopiyky(data["freeShippingThreshold"]),
        popularity=popularity,
        by_family=by_family,
        by_gender=by_gender,
        popular=popular,
        discounts=build_discounts(start, end),
        created_at=start - timedelta(days=30),
    )


def build_discounts(start: datetime, end: datetime) -> list[Discount]:
    """The shop's rules (seed-data.ts / migrations 0021, 0022) plus a yearly 8 March code."""
    rules = [
        Discount(
            id=1, slug="tester-trio", code=None, kind="fixed_price_set", value=49_900,
            scope_volumes_ml=(10,), scope_pack_size=1, min_quantity=3, max_sets=3,
        ),
        Discount(
            id=2, slug="couple-15", code=None, kind="percent_every_nth", value=1_500,
            scope_volumes_ml=config.FULL_BOTTLES, scope_pack_size=1, min_quantity=2,
            starts_at=config.COUPLE_OFFER_START,
        ),
        Discount(id=3, slug="welcome-10", code="JASSMIN10", kind="percent", value=1_000),
    ]  # fmt: skip
    for year in range(start.year, end.year + 1):
        rules.append(
            Discount(
                id=len(rules) + 1,
                slug=f"vesna-{year}",
                code=f"VESNA{year}",
                kind="percent",
                value=1_500,
                starts_at=datetime(year, 3, 1, tzinfo=config.KYIV),
                ends_at=datetime(year, 3, 9, tzinfo=config.KYIV),
            )
        )
    return rules
