"""The shop simulation: customers with latent behaviour, their visits, carts, orders with the full
Ukrainian e-commerce lifecycle, payments and the inventory ledger.

It runs in two phases:

1. **Plan** every visit: per customer (signup, purchases by a thinned Poisson process with the
   customer's own rate and seasonality, browsing before buying, churn after each order, visits
   after churning) and per anonymous visitor.
2. **Run** the visits in time order. Stock changes in between (supplier receipts, units coming
   back from cancelled or returned orders) wait in a heap and are applied when the clock passes
   them, so serial ids grow with time like in the app, and a shopper sees the stock of that
   moment.

The output is clean: it satisfies the app's constraints and invariants, except for backorders
(a tracked size sold while out of stock makes `stock_after` negative in the raw ledger; the
"clean" ledger used for the app schema covers each shortfall with an `adjustment`). The other
deliberate anomalies are added afterwards by anomalies.py.
"""

from __future__ import annotations

import bisect
import heapq
import itertools
import json
import math
import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

import numpy as np

import config
from catalog import Catalog, Product, Variant, load_catalog
from ids import Ids
from pricing import Discount, Line, money, price_cart

UTC = timezone.utc
Row = dict[str, Any]


class Rand:
    """Fast seeded scalar draws (Python's Mersenne Twister) with the helpers the model needs."""

    def __init__(self, seed: int):
        self.r = random.Random(seed)

    def random(self) -> float:
        return self.r.random()

    def chance(self, p: float) -> bool:
        return self.r.random() < p

    def uniform(self, a: float, b: float) -> float:
        return a + (b - a) * self.r.random()

    def integers(self, lo: int, hi: int) -> int:
        """lo <= n < hi."""
        return lo + int(self.r.random() * (hi - lo))

    def exponential(self, mean: float) -> float:
        return -mean * math.log(1.0 - self.r.random())

    def gamma(self, shape: float, scale: float) -> float:
        return self.r.gammavariate(shape, scale)

    def lognormal(self, mu: float, sigma: float) -> float:
        return self.r.lognormvariate(mu, sigma)

    def poisson(self, lam: float) -> int:
        # Knuth's method: fine for the small means used here.
        limit, k, p = math.exp(-lam), 0, 1.0
        while True:
            p *= self.r.random()
            if p <= limit:
                return k
            k += 1

    def pick(self, options: list | tuple):
        return options[int(self.r.random() * len(options))]

    def weighted(self, options: list | tuple, cumulative: list[float]):
        return options[bisect.bisect_right(cumulative, self.r.random() * cumulative[-1])]


def cumulative(weights) -> list[float]:
    return list(itertools.accumulate(float(w) for w in weights))


CHANNEL_NAMES = list(config.CHANNELS)
CHANNEL_CUM = cumulative(config.CHANNELS.values())
DEVICE_CUM = {ch: cumulative(p) for ch, p in config.DEVICE_BY_CHANNEL.items()}
CITY_NAMES = [c for c, _ in config.CITIES]
CITY_CUM = cumulative(w for _, w in config.CITIES)
SEGMENT_NAMES = list(config.SEGMENTS)
SEGMENT_CUM = cumulative(s[0] for s in config.SEGMENTS.values())
HOURS = list(range(24))
HOUR_CUM = cumulative(config.HOUR_WEIGHTS)
VOLUMES = list(config.VOLUME_WEIGHTS)
VOLUME_CUM = cumulative(config.VOLUME_WEIGHTS.values())
FULL_CUM = cumulative(config.VOLUME_WEIGHTS[v] for v in config.FULL_BOTTLES)
DOMAINS = [d for d, _ in config.EMAIL_DOMAINS]
DOMAIN_CUM = cumulative(w for _, w in config.EMAIL_DOMAINS)
REFERRERS = {
    "instagram": "https://l.instagram.com/",
    "google": "https://www.google.com/",
    "t.me": "https://t.me/",
    "facebook": "https://l.facebook.com/",
}
LANDINGS = ["home", "catalog", "popular", "offers", "product"]
LANDING_CUM = cumulative([0.3, 0.35, 0.15, 0.1, 0.1])
SORTS = ["newest", "price_asc", "price_desc"]


def kyiv_day(ts: datetime) -> date:
    return ts.astimezone(config.KYIV).date()


@dataclass
class Person:
    """A registered customer and their latent (ground-truth) behaviour."""

    id: int
    segment: str
    rate: float
    churn: float
    family: str
    gender: str
    device: str
    channel: str
    city: str
    locale: str
    anon_id: str
    created: datetime
    full_name: str
    email: str
    phone: str
    marketing_opt_in: bool
    churned_at: datetime | None = None
    order_count: int = 0
    last_login: datetime | None = None
    last_city: str | None = None
    first_traffic: tuple[str, str, str | None] | None = None
    last_reminder: datetime | None = None


@dataclass
class Visitor:
    """An anonymous visitor who never registers."""

    anon_id: str
    family: str
    gender: str
    device: str
    channel: str
    locale: str


@dataclass(order=True)
class Visit:
    ts: datetime
    seq: int
    kind: str = field(compare=False)
    who: Person | Visitor = field(compare=False)


@dataclass
class Cart:
    row: Row
    items: dict[int, Row]  # variant id -> cart_items row
    owner: tuple[str, Any]
    person: Person | None

    def abandon_time(self, rng: Rand) -> datetime:
        if "_abandon_at" not in self.row:
            self.row["_abandon_at"] = self.row["updated_at"] + timedelta(
                hours=config.ABANDONED_CART_HOURS + rng.random()
            )
        return self.row["_abandon_at"]


@dataclass
class Output:
    """Everything the simulation produced, as rows per table (column name -> value)."""

    tables: dict[str, list[Row]]
    #: The ledger with each backorder shortfall covered by an `adjustment` (for the app schema).
    clean_inventory: list[Row]
    #: Final stock per variant id in the clean ledger.
    clean_stock: dict[int, int]
    customer_truth: list[Row]
    stats: dict[str, int]
    catalog: Catalog


class Simulation:
    def __init__(
        self, customers: int, visitors: int, start: datetime, end: datetime, seed: int
    ):
        self.customers, self.visitors, self.start, self.end = customers, visitors, start, end
        # One stream per concern, so a change in one part doesn't reshuffle every table.
        streams = np.random.SeedSequence(seed).spawn(6)
        self.np_catalog = np.random.default_rng(streams[0])
        self.plan_rng = Rand(int(streams[1].generate_state(1)[0]))
        self.sim_rng = Rand(int(streams[2].generate_state(1)[0]))
        self.stock_rng = Rand(int(streams[3].generate_state(1)[0]))
        self.ids = Ids(random.Random(int(streams[4].generate_state(1)[0])))
        self.np_people = np.random.default_rng(streams[5])

        self.catalog = load_catalog(self.np_catalog, start, end)
        self.automatic = [d for d in self.catalog.discounts if d.code is None]
        self.discount_by_slug = {d.slug: d for d in self.catalog.discounts}
        self.tables: dict[str, list[Row]] = {
            name: []
            for name in (
                "products", "product_variants", "discounts", "users", "sessions", "user_events",
                "carts", "cart_items", "orders", "order_items", "payments",
                "order_status_history", "inventory_movements",
            )
        }  # fmt: skip
        self.events: list[Row] = self.tables["user_events"]
        self.clean_inventory: list[Row] = []
        self.people: list[Person] = []
        self.visits: list[Visit] = []
        self.seq = itertools.count()
        self.heap: list[tuple[datetime, int, str, Any]] = []
        self.stock: dict[int, int] = {}
        self.adjusted: dict[int, int] = {}
        self.incoming: set[int] = set()
        self.active_carts: dict[tuple[str, Any], Cart] = {}
        self.all_carts: list[Cart] = []
        self.emails_ordered: set[str] = set()
        self.stats = {"out_of_stock_adds": 0, "backorder_adds": 0, "guest_orders": 0}

    # --- helpers ----------------------------------------------------------------------------

    def at_local_hour(self, day: date, rng: Rand) -> datetime:
        """A moment on a Kyiv calendar day at a realistic hour (evening peak), in UTC."""
        hour = rng.weighted(HOURS, HOUR_CUM)
        local = datetime(day.year, day.month, day.day, hour, rng.integers(0, 60),
                         rng.integers(0, 60), rng.integers(0, 1000) * 1000, tzinfo=config.KYIV)  # fmt: skip
        return local.astimezone(UTC)

    def seasonal_day(self, rng: Rand, a: float = 1.6, b: float = 1.0) -> date:
        """A day in [start, end) drawn from a growing (Beta) trend, thinned by seasonality."""
        span = (self.end - self.start).days
        while True:
            offset = int(self.np_people.beta(a, b) * span)
            day = kyiv_day(self.start) + timedelta(days=offset)
            if rng.random() * config.MAX_SEASONALITY < config.seasonality(day):
                return day

    def next_purchase(self, rng: Rand, t: datetime, rate: float) -> datetime:
        """The next purchase time of a Poisson process with intensity rate * seasonality(t)."""
        peak_rate = max(rate, 0.02) * config.MAX_SEASONALITY / 365.0  # per day
        while True:
            t = t + timedelta(days=rng.exponential(1.0 / peak_rate))
            if t >= self.end:
                return t
            if rng.random() * config.MAX_SEASONALITY < config.seasonality(kyiv_day(t)):
                return t

    def schedule(self, ts: datetime, kind: str, who: Person | Visitor) -> None:
        if self.start <= ts < self.end - timedelta(hours=2):
            self.visits.append(Visit(ts, next(self.seq), kind, who))

    def pick_product(self, family: str, gender: str, rng: Rand) -> Product:
        if rng.chance(config.FAVOURITE_FAMILY_SHARE):
            pool = [p for p in self.catalog.by_family.get(family, []) if p.gender in (gender, "unisex")]
            if pool:
                return rng.pick(pool)
        index = bisect.bisect_right(self.popularity_cum, rng.random())
        return self.catalog.products[min(index, len(self.catalog.products) - 1)]

    # --- reference data ---------------------------------------------------------------------

    def build_catalog_rows(self) -> None:
        created = self.catalog.created_at
        self.popularity_cum = cumulative(self.catalog.popularity)
        for p in self.catalog.products:
            self.tables["products"].append({
                "id": p.id, "public_id": p.public_id, "title": p.title, "brand": p.brand,
                "gender": p.gender, "fragrance_family": p.families[0],
                "fragrance_families": list(p.families), "store_code": p.store_code,
                "popular_rank": p.popular_rank, "price": money(p.variants[30].price),
                "volume_ml": 30, "pack_size": 1, "stock_quantity": 0, "active": True,
                "created_at": created, "updated_at": created,
            })  # fmt: skip
        for v in self.catalog.variants:
            self.tables["product_variants"].append({
                "id": v.id, "public_id": v.public_id, "product_id": v.product_id,
                "volume_ml": v.volume_ml, "price": money(v.price), "stock_quantity": 0,
                "track_stock": v.track_stock, "created_at": created,
            })  # fmt: skip
        opening = self.start - timedelta(days=1)
        for v in self.catalog.variants:
            if v.track_stock:
                product = self.catalog.products[v.product_id - 1]
                qty = self.stock_rng.integers(*config.OPENING_STOCK)
                if product.popular_rank is not None:
                    qty += 4
                self.stock[v.id] = 0
                self.adjusted[v.id] = 0
                self.move(v.id, opening, "opening_balance", qty, None, "migration")

    # --- inventory --------------------------------------------------------------------------

    def move(
        self, variant_id: int, ts: datetime, reason: str, delta: int, order_id: int | None,
        source: str, note: str | None = None,
    ) -> None:  # fmt: skip
        """Records a stock change in both ledgers and reorders when stock runs low."""
        raw_after = self.stock[variant_id] + delta
        adjusted = self.adjusted[variant_id]
        if delta < 0 and raw_after + adjusted < 0:
            shortfall = -(raw_after + adjusted)
            adjusted += shortfall
            self.adjusted[variant_id] = adjusted
            self.clean_inventory.append({
                "id": len(self.clean_inventory) + 1, "variant_id": variant_id, "occurred_at": ts,
                "reason": "adjustment", "quantity_delta": shortfall,
                "stock_after": self.stock[variant_id] + adjusted, "order_id": None,
                "source": "cms", "note": "synthetic backorder",
            })  # fmt: skip
        row = {
            "variant_id": variant_id, "occurred_at": ts, "reason": reason,
            "quantity_delta": delta, "order_id": order_id, "source": source, "note": note,
        }  # fmt: skip
        self.tables["inventory_movements"].append(
            {"id": self.ids.next("inventory_movements"), **row, "stock_after": raw_after}
        )
        self.clean_inventory.append(
            {"id": len(self.clean_inventory) + 1, **row, "stock_after": raw_after + adjusted}
        )
        self.stock[variant_id] = raw_after
        if raw_after <= config.REORDER_POINT and variant_id not in self.incoming:
            self.incoming.add(variant_id)
            lead = timedelta(days=self.stock_rng.uniform(*config.SUPPLIER_LEAD_DAYS))
            arrival = self.at_local_hour(kyiv_day(ts + lead), self.stock_rng)
            arrival = max(arrival, ts + timedelta(hours=1))
            heapq.heappush(self.heap, (arrival, next(self.seq), "receipt", variant_id))

    def run_stock_events(self, until: datetime) -> None:
        while self.heap and self.heap[0][0] <= until:
            ts, _, kind, payload = heapq.heappop(self.heap)
            if ts >= self.end:
                continue
            if kind == "receipt":
                variant_id = payload
                self.incoming.discard(variant_id)
                qty = self.stock_rng.integers(*config.REORDER_QUANTITY)
                qty += max(0, -self.stock[variant_id])  # cover backorders
                self.move(variant_id, ts, "receipt", qty, None, "cms")
            else:  # units back from a cancelled, unclaimed or returned order
                order_id, reason, source, lines = payload
                for variant_id, qty in lines:
                    self.move(variant_id, ts, reason, qty, order_id, source)

    # --- people -----------------------------------------------------------------------------

    def build_people(self) -> None:
        rng = self.plan_rng
        days = sorted(self.seasonal_day(rng) for _ in range(self.customers))
        signups = sorted(self.at_local_hour(d, rng) for d in days)
        for created in signups:
            female = rng.chance(config.FEMALE_SHARE)
            first = rng.pick(config.FIRST_NAMES_F if female else config.FIRST_NAMES_M)
            last = rng.pick(config.LAST_NAMES)
            channel = rng.weighted(CHANNEL_NAMES, CHANNEL_CUM)
            segment = rng.weighted(SEGMENT_NAMES, SEGMENT_CUM)
            _, mean_rate, churn = config.SEGMENTS[segment]
            uid = len(self.people) + 1
            domain = rng.weighted(DOMAINS, DOMAIN_CUM)
            local = f"{first.lower().translate(config.TRANSLIT)}.{last.lower().translate(config.TRANSLIT)}{uid}"
            person = Person(
                id=uid,
                segment=segment,
                # Gamma-distributed individual rate around the segment mean (BG/NBD heterogeneity).
                rate=float(self.np_people.gamma(config.RATE_GAMMA_SHAPE, mean_rate / config.RATE_GAMMA_SHAPE)),
                churn=churn,
                family=rng.pick(self.catalog.families),
                gender="women" if (female and rng.chance(0.85)) or (not female and rng.chance(0.3)) else "men",
                device=rng.weighted(config.DEVICES, DEVICE_CUM[channel]),
                channel=channel,
                city=rng.weighted(CITY_NAMES, CITY_CUM),
                locale="en" if rng.chance(config.ENGLISH_SHARE) else "uk",
                anon_id=self.ids.uuid4(),
                created=created,
                full_name=f"{first} {last}",
                email=f"{local}@{domain}",
                phone=f"+380{rng.pick(config.PHONE_PREFIXES)}{rng.integers(1_000_000, 10_000_000)}",
                marketing_opt_in=rng.chance(config.MARKETING_OPT_IN_SHARE),
            )  # fmt: skip
            self.people.append(person)
            self.plan_person(person)

    def plan_person(self, person: Person) -> None:
        rng = self.plan_rng
        # Visits before signing up, with the same browser (anonymous id).
        for _ in range(rng.poisson(0.8)):
            day = kyiv_day(person.created - timedelta(days=rng.uniform(0.5, 20)))
            self.schedule(self.at_local_hour(day, rng), "browse", person)
        buys_at_signup = rng.chance(config.FIRST_ORDER_AT_SIGNUP)
        self.schedule(person.created, "signup_purchase" if buys_at_signup else "signup", person)
        t = person.created
        alive = True
        if buys_at_signup:
            alive = not rng.chance(person.churn)
            if not alive:
                person.churned_at = t
        while alive:
            t = self.next_purchase(rng, t, person.rate)
            if t >= self.end:
                break
            # Browsing before buying: some visits leave a cart behind.
            for _ in range(rng.integers(0, 4)):
                bt = t - timedelta(days=rng.uniform(0.2, 12))
                if bt > person.created:
                    kind = "cart" if rng.chance(0.35) else "browse"
                    self.schedule(self.at_local_hour(kyiv_day(bt), rng), kind, person)
            self.schedule(t, "purchase", person)
            if rng.chance(person.churn):
                alive = False
                person.churned_at = t
        # Churned customers still drop by occasionally without buying.
        last = person.churned_at or t
        for _ in range(rng.poisson(config.POST_CHURN_VISITS)):
            bt = last + timedelta(days=rng.exponential(60))
            self.schedule(self.at_local_hour(kyiv_day(bt), rng), "browse", person)

    def build_visitors(self) -> None:
        rng = self.plan_rng
        for _ in range(self.visitors):
            channel = rng.weighted(CHANNEL_NAMES, CHANNEL_CUM)
            visitor = Visitor(
                anon_id=self.ids.uuid4(),
                family=rng.pick(self.catalog.families),
                gender="women" if rng.chance(0.68) else "men",
                device=rng.weighted(config.DEVICES, DEVICE_CUM[channel]),
                channel=channel,
                locale="en" if rng.chance(config.ENGLISH_SHARE) else "uk",
            )
            r = rng.random()
            kind = (
                "guest_purchase" if r < config.VISITOR_GUEST_ORDER_SHARE
                else "cart" if r < config.VISITOR_GUEST_ORDER_SHARE + config.VISITOR_CART_SHARE
                else "browse"
            )  # fmt: skip
            self.schedule(self.at_local_hour(self.seasonal_day(rng), rng), kind, visitor)

    # --- carts ------------------------------------------------------------------------------

    def settle_cart(self, cart: Cart, now: datetime) -> bool:
        """Marks the cart abandoned if the hourly job would have by `now`; True if it did."""
        if cart.row["status"] != "active":
            return False
        abandon_at = cart.abandon_time(self.sim_rng)
        if abandon_at > now:
            return False
        cart.row["status"] = "abandoned"
        cart.row["abandoned_at"] = abandon_at
        self.active_carts.pop(cart.owner, None)
        person = cart.person
        # #139: one reminder per abandoned cart to opted-in users, at most one per user per week.
        if (
            person is not None
            and person.marketing_opt_in
            and cart.row["user_id"] is not None
            and (person.last_reminder is None or abandon_at - person.last_reminder >= timedelta(days=7))
        ):
            sent = abandon_at + timedelta(minutes=self.sim_rng.uniform(1, 60))
            if sent < self.end:
                cart.row["reminder_sent_at"] = sent
                person.last_reminder = sent
                if self.sim_rng.chance(0.12):
                    restored = sent + timedelta(hours=self.sim_rng.uniform(1, 72))
                    if restored < self.end:
                        cart.row["restored_at"] = restored
        return True

    def cart_for(self, owner: tuple[str, Any], person: Person | None, user_id: int | None,
                 session_id: str, ts: datetime) -> Cart:  # fmt: skip
        cart = self.active_carts.get(owner)
        if cart is not None and not self.settle_cart(cart, ts):
            return cart
        row = {
            "id": self.ids.next("carts"), "user_id": user_id, "session_id": session_id,
            "status": "active", "created_at": ts, "updated_at": ts, "abandoned_at": None,
            "discount_id": None, "reminder_sent_at": None, "restored_at": None,
        }  # fmt: skip
        cart = Cart(row=row, items={}, owner=owner, person=person)
        self.tables["carts"].append(row)
        self.active_carts[owner] = cart
        self.all_carts.append(cart)
        return cart

    def cart_lines(self, cart: Cart) -> list[tuple[Variant, int]]:
        variants = self.catalog.variants
        return [(variants[vid - 1], item["quantity"]) for vid, item in cart.items.items()]

    def cart_value(self, cart: Cart) -> int:
        return sum(v.price * q for v, q in self.cart_lines(cart))

    # --- a visit ----------------------------------------------------------------------------

    def run_visit(self, visit: Visit) -> None:
        rng = self.sim_rng
        who, ts, kind = visit.who, visit.ts, visit.kind
        person = who if isinstance(who, Person) else None
        signup = kind.startswith("signup")
        if signup or (person and person.first_traffic is None):
            channel = who.channel
        else:
            channel = who.channel if rng.chance(0.6) else rng.weighted(CHANNEL_NAMES, CHANNEL_CUM)
        source, medium = config.CHANNEL_TRAFFIC[channel]
        campaign = config.campaign_for(kyiv_day(ts)) if medium == "paid_social" else None
        usual = rng.chance(0.85)
        device = who.device if usual else rng.weighted(config.DEVICES, DEVICE_CUM[channel])
        anon_id = who.anon_id if usual or person is None else self.ids.uuid4()
        if person and person.first_traffic is None:
            person.first_traffic = (source, medium, campaign)
        registered = person is not None and ts >= person.created and not signup
        logged_in = registered and (kind == "purchase" or rng.chance(0.5))
        user_id: int | None = person.id if logged_in else None
        session_id = self.ids.uuid7(ts)
        session = {
            "session_id": session_id, "user_id": person.id if (logged_in or signup) else None,
            "anonymous_id": anon_id, "started_at": ts, "ended_at": ts, "landing_page": None,
            "traffic_source": source, "traffic_medium": medium, "traffic_campaign": campaign,
            "device_type": device,
        }  # fmt: skip
        self.tables["sessions"].append(session)
        referrer = REFERRERS.get(source)
        clock = [ts]

        def event(event_type: str, props: dict, product_id: int | None = None, gap: float = 25.0) -> None:
            clock[0] = clock[0] + timedelta(seconds=rng.exponential(gap))
            self.events.append({
                "event_id": self.ids.uuid7(clock[0]), "user_id": user_id, "anonymous_id": anon_id,
                "session_id": session_id, "event_type": event_type, "product_id": product_id,
                "event_properties": json.dumps(props, ensure_ascii=False, separators=(",", ":")),
                "source": source, "medium": medium, "campaign": campaign, "device_type": device,
                "referrer": referrer, "created_at": clock[0],
            })  # fmt: skip

        prefix = "/en" if who.locale == "en" else ""
        gender_slug = {"women": ("zhinochi", "women"), "men": ("cholovichi", "men")}[who.gender]
        catalog_path = f"{prefix}/{'catalog/' + gender_slug[1] if prefix else 'katalog/' + gender_slug[0]}"
        product_path = (lambda p: f"{prefix}/{'perfumes' if prefix else 'parfumy'}/{p.public_id}")
        landing = rng.weighted(LANDINGS, LANDING_CUM)
        family = who.family if person or rng.chance(0.5) else rng.pick(self.catalog.families)
        first_product: Product | None = None
        if landing == "product":
            first_product = self.pick_product(family, who.gender, rng)
            path = product_path(first_product)
        else:
            path = {
                "home": prefix or "/",
                "catalog": catalog_path,
                "popular": f"{prefix}/{'popular' if prefix else 'populiarni'}",
                "offers": f"{prefix}/{'offers' if prefix else 'aktsii'}",
            }[landing]
        session["landing_page"] = path
        if user_id is not None and rng.chance(0.3):
            event("login", {"method": "login"}, gap=5)
            person.last_login = clock[0]
        event("page_view", {"path": path}, gap=1)

        # The list the shopper browses, if any: (list_id, products, search_id).
        listing: tuple[str, list[Product], str | None] | None = None
        if landing == "catalog":
            pool = sorted(self.catalog.by_gender[who.gender] + self.catalog.by_gender["unisex"],
                          key=lambda p: -p.id)  # fmt: skip
            listing = ("catalog", pool, None)
        elif landing == "popular":
            listing = ("popular", self.catalog.popular, None)
        elif landing == "home":
            listing = ("home", self.catalog.popular[:8], None)
        elif landing == "offers":
            listing = ("offers", self.catalog.popular[8:20], None)
        if landing in ("catalog", "home") and rng.chance(0.25):
            # A filtered catalog: its own page view, a `search` event and the results as the list.
            fam = family if rng.chance(0.7) else None
            sort = rng.pick(SORTS)
            pool = [p for p in self.catalog.by_gender[who.gender] + self.catalog.by_gender["unisex"]
                    if fam is None or fam in p.families]  # fmt: skip
            pool.sort(key=lambda p: -p.id)
            search_id = self.ids.uuid4()
            query = f"?family={fam}&sort={sort}" if fam else f"?sort={sort}"
            event("page_view", {"path": f"{catalog_path}{query}"})
            event("search", {
                "search_id": search_id, "query": None, "gender": who.gender,
                "fragrance_family": fam, "brand": None, "sort": sort, "page": 1,
                "result_count": len(pool), "product_public_ids": [p.public_id for p in pool[:24]],
            })  # fmt: skip
            listing = ("search", pool, search_id)
        shown: set[int] = set()
        if listing is not None and rng.chance(0.6):
            # Cards seen for at least a second (#129); quick scrollers send none.
            list_id, pool, search_id = listing
            for position, product in enumerate(pool[: rng.integers(2, 7)], start=1):
                event("product_impression", self.list_props(product, list_id, position, search_id),
                      product.id, gap=0.8)  # fmt: skip
                shown.add(product.id)

        # Products looked at; remember which list each was clicked in.
        n_views = 1 + rng.poisson({"browse": 1.2, "cart": 2.0}.get(kind, 2.5))
        viewed: list[Product] = []
        clicked_from: dict[int, dict] = {}
        for i in range(n_views):
            product = first_product if (i == 0 and first_product) else self.pick_product(family, who.gender, rng)
            if listing is not None:
                list_id, pool, search_id = listing
                position = next((k for k, p in enumerate(pool, start=1) if p.id == product.id), None)
                if position is not None:
                    props = self.list_props(product, list_id, position, search_id)
                    if product.id not in shown:
                        event("product_impression", props, product.id, gap=2)
                        shown.add(product.id)
                    event("product_click", props, product.id, gap=6)
                    clicked_from[product.id] = {
                        k: props[k] for k in ("list_id", "list_position", "search_id") if k in props
                    }
            if i > 0 or first_product is None:
                event("page_view", {"path": product_path(product)}, gap=1)
            base = self.product_props(product)
            event("product_view", base, product.id, gap=1)
            dwell = min(int(rng.lognormal(9.6, 0.8)), 1_800_000)
            clock[0] = clock[0] + timedelta(milliseconds=dwell)
            event("product_dwell", {**base, "dwell_ms": dwell, "max_scroll_pct": rng.integers(10, 101)},
                  product.id, gap=0.5)  # fmt: skip
            viewed.append(product)

        if kind in ("browse", "signup"):
            if signup:
                self.register(person, event, clock, session)
            session["ended_at"] = clock[0]
            return

        # Cart: a tester trio, a couple of full bottles, or a few sizes of what was viewed.
        owner: tuple[str, Any] = ("u", user_id) if user_id is not None else ("s", session_id)
        cart = self.cart_for(owner, person, user_id, session_id, clock[0])
        r = rng.random()
        picks: list[tuple[Product, int, int]] = []
        if r < config.TRIO_CART_SHARE:
            trio = list(dict.fromkeys(viewed + [self.pick_product(family, who.gender, rng) for _ in range(6)]))
            picks = [(p, 10, 1) for p in trio[:3]]
        elif r < config.TRIO_CART_SHARE + config.COUPLE_CART_SHARE:
            pair = list(dict.fromkeys(viewed + [self.pick_product(family, who.gender, rng) for _ in range(4)]))
            picks = [(p, rng.weighted(config.FULL_BOTTLES, FULL_CUM), 1) for p in pair[:2]]
        else:
            for p in viewed[: rng.integers(1, 4)]:
                picks.append((p, rng.weighted(VOLUMES, VOLUME_CUM), 1 if rng.chance(0.88) else 2))
        for product, volume, qty in picks:
            variant = product.variants[volume]
            in_stock = not variant.track_stock or self.stock[variant.id] > 0
            if not in_stock:
                self.stats["out_of_stock_adds"] += 1
                if rng.chance(config.BACKORDER_SHARE):
                    self.stats["backorder_adds"] += 1
                else:
                    variant = product.variants[10]
                    in_stock = True
            item = cart.items.get(variant.id)
            if item is None:
                item = {"id": self.ids.next("cart_items"), "cart_id": cart.row["id"],
                        "product_id": product.id, "variant_id": variant.id, "quantity": 0,
                        "added_at": clock[0]}  # fmt: skip
                cart.items[variant.id] = item
                self.tables["cart_items"].append(item)
            item["quantity"] += qty
            props = {**self.variant_props(product, variant, in_stock), "quantity": qty,
                     "cart_value_after": money(self.cart_value(cart)), **clicked_from.get(product.id, {})}  # fmt: skip
            event("add_to_cart", props, product.id, gap=20)
        if len(cart.items) >= 2 and rng.chance(0.05) and kind != "purchase":
            vid, item = next(iter(cart.items.items()))
            variant = self.catalog.variants[vid - 1]
            product = self.catalog.products[variant.product_id - 1]
            removed = cart.items.pop(vid)
            self.tables["cart_items"].remove(removed)
            event("remove_from_cart", {**self.variant_props(product, variant, True),
                                       "quantity": removed["quantity"],
                                       "cart_value_after": money(self.cart_value(cart)),
                                       "source": "stepper"}, product.id)  # fmt: skip
        cart.row["updated_at"] = clock[0]
        cart.row.pop("_abandon_at", None)

        if kind in ("purchase", "signup_purchase", "guest_purchase") and cart.items:
            if signup:
                self.register(person, event, clock, session)
                user_id = person.id
                cart.row["user_id"] = person.id
            self.place_order(cart, person, who, event, clock, device)
        session["ended_at"] = clock[0]

    def register(self, person: Person, event, clock: list[datetime], session: Row) -> None:
        event("login", {"method": "register"}, gap=40)
        person.last_login = clock[0]
        session["user_id"] = person.id

    def product_props(self, product: Product) -> dict:
        """The shared product-event properties for the size the page preselects (#129)."""
        variant = product.variants[5]  # the smallest size, never tracked, so always in stock
        return self.variant_props(product, variant, True)

    def variant_props(self, product: Product, variant: Variant, in_stock: bool) -> dict:
        return {
            "product_public_id": product.public_id, "variant_id": variant.public_id,
            "volume_ml": variant.volume_ml, "price": money(variant.price), "in_stock": in_stock,
        }  # fmt: skip

    def list_props(self, product: Product, list_id: str, position: int, search_id: str | None) -> dict:
        props = {**self.product_props(product), "list_id": list_id, "list_position": position}
        if search_id is not None:
            props["search_id"] = search_id
        return props

    # --- orders -----------------------------------------------------------------------------

    def place_order(self, cart: Cart, person: Person | None, who: Person | Visitor, event,
                    clock: list[datetime], device: str) -> None:  # fmt: skip
        rng = self.sim_rng
        first_order = person is None or person.order_count == 0
        day = kyiv_day(clock[0])
        code: Discount | None = None
        if day.month == 3 and day.day <= 8 and rng.chance(config.SPRING_CODE_SHARE):
            code = self.discount_by_slug.get(f"vesna-{day.year}")
        elif person is not None and first_order and rng.chance(config.WELCOME_CODE_SHARE):
            code = self.discount_by_slug["welcome-10"]
        candidates = self.automatic + ([code] if code else [])
        lines_v = self.cart_lines(cart)
        lines = [Line(self.catalog.products[v.product_id - 1].public_id, v.volume_ml, 1, v.price, q)
                 for v, q in lines_v]  # fmt: skip
        if code is not None:
            cart.row["discount_id"] = code.id
        priced = price_cart(lines, candidates, clock[0], self.catalog.free_shipping_threshold)
        event("checkout_start", {
            "subtotal": money(priced.subtotal), "item_count": sum(q for _, q in lines_v),
            "discount_amount": money(priced.discount), "discount_code": code.code if code else None,
        }, gap=30)  # fmt: skip
        clock[0] = clock[0] + timedelta(seconds=rng.uniform(40, 240))  # filling in the form
        t = clock[0]

        if person is not None:
            name, email, phone = person.full_name, person.email, person.phone
            city = person.city if rng.chance(0.85) else rng.weighted(CITY_NAMES, CITY_CUM)
        else:
            self.stats["guest_orders"] += 1
            female = rng.chance(config.FEMALE_SHARE)
            first = rng.pick(config.FIRST_NAMES_F if female else config.FIRST_NAMES_M)
            last = rng.pick(config.LAST_NAMES)
            name = f"{first} {last}"
            email = (f"{first.lower().translate(config.TRANSLIT)}{rng.integers(10, 99999)}"
                     f"@{rng.weighted(DOMAINS, DOMAIN_CUM)}")  # fmt: skip
            phone = f"+380{rng.pick(config.PHONE_PREFIXES)}{rng.integers(1_000_000, 10_000_000)}"
            city = rng.weighted(CITY_NAMES, CITY_CUM)
        is_first = first_order and email.lower() not in self.emails_ordered
        self.emails_ordered.add(email.lower())
        method = "card" if rng.chance(config.CARD_SHARE[device]) else "cod"
        order_id = self.ids.next("orders")
        order = {
            "id": order_id, "user_id": person.id if person else None, "guest_full_name": name,
            "guest_email": email, "guest_phone": phone,
            "shipping_address": f"{city}, Нова Пошта, відділення №{rng.integers(1, 180)}",
            "cart_id": cart.row["id"], "free_shipping": priced.free_shipping, "status": "pending",
            "payment_status": "unpaid", "payment_method": method,
            "subtotal": money(priced.subtotal), "discount_amount": money(priced.discount),
            "shipping_amount": "0.00", "gift_card_amount": "0.00",
            "total_amount": money(priced.total), "currency": "UAH", "created_at": t,
            "updated_at": t, "paid_at": None, "cancelled_at": None, "refunded_at": None,
            "shipped_at": None, "completed_at": None, "arrived_at": None, "waybill_number": None,
            "discount_id": priced.discount_id, "returned_at": None, "cancel_reason": None,
        }  # fmt: skip
        self.tables["orders"].append(order)
        cart.row["status"] = "converted"
        cart.row["updated_at"] = t
        self.active_carts.pop(cart.owner, None)
        items = []
        for (variant, qty), allocated in zip(lines_v, priced.allocation):
            items.append({"variant_id": variant.public_id, "quantity": qty,
                          "unit_price": money(variant.price), "discount_allocated": money(allocated)})  # fmt: skip
            self.tables["order_items"].append({
                "id": self.ids.next("order_items"), "order_id": order_id,
                "product_id": variant.product_id, "variant_id": variant.id,
                "volume_ml": variant.volume_ml, "quantity": qty,
                "price_at_purchase": money(variant.price), "discount_allocated": money(allocated),
            })  # fmt: skip
        tracked = [(v.id, q) for v, q in lines_v if v.track_stock]
        for variant_id, qty in tracked:
            self.move(variant_id, t, "sale", -qty, order_id, "checkout")
        event("purchase", {
            "order_id": order_id, "subtotal": money(priced.subtotal),
            "discount_amount": money(priced.discount), "gift_card_amount": "0.00",
            "total_amount": money(priced.total), "discount_id": priced.discount_id,
            "discount_code": priced.code, "payment_method": method, "items": items,
            "is_first_order": is_first,
        }, gap=2)  # fmt: skip
        if person is not None:
            person.order_count += 1
            person.last_city = city
        self.lifecycle(order, t, method, tracked)

    def lifecycle(self, order: Row, t: datetime, method: str, tracked: list[tuple[int, int]]) -> None:
        """The order's status changes, payment attempts and units coming back, up to `end`."""
        rng = self.sim_rng
        minutes = lambda m: timedelta(minutes=m)  # noqa: E731
        steps: list[tuple[datetime, str | None, str, dict, tuple[str, str] | None]] = [
            (t, "pending", "checkout", {}, None)
        ]
        attempts: list[tuple[datetime, datetime, str]] = []  # created, completed, status
        paid: datetime | None = None
        done = False
        if method == "card":
            created = t + minutes(rng.uniform(0.2, 2))
            completed = created + minutes(rng.uniform(0.3, 5))
            if rng.chance(config.CARD_FIRST_ATTEMPT_FAIL):
                attempts.append((created, completed, "failed"))
                if rng.chance(config.CARD_RETRY_SUCCESS):
                    created = completed + minutes(rng.uniform(1, 90))
                    paid = created + minutes(rng.uniform(0.3, 5))
                    attempts.append((created, paid, "succeeded"))
                else:
                    cancel = t + timedelta(hours=config.UNPAID_ORDER_HOURS + rng.random())
                    steps.append((cancel, "cancelled", "job",
                                  {"cancelled_at": cancel, "cancel_reason": "payment_failed"},
                                  ("cancellation", "job")))  # fmt: skip
                    done = True
            else:
                paid = completed
                attempts.append((created, completed, "succeeded"))
            if paid is not None:
                steps.append((paid, "paid", "payment", {"paid_at": paid, "payment_status": "paid"}, None))
        if not done and rng.chance(config.ORDER_CANCEL_SHARE):
            cancel = (paid or t) + timedelta(hours=rng.uniform(1, 30))
            reasons = ["customer_request", "out_of_stock", "no_answer", "other"]
            weights = [0.45, 0.15, 0.3 if method == "cod" else 0.05, 0.1]
            reason = rng.weighted(reasons, cumulative(weights))
            fields: dict = {"cancelled_at": cancel, "cancel_reason": reason}
            if paid is not None:
                fields.update(payment_status="refunded", refunded_at=cancel + timedelta(days=1))
            steps.append((cancel, "cancelled", "cms", fields, ("cancellation", "cms")))
            done = True
        if not done:
            december = kyiv_day(t).month == 12
            shipped = (paid or t) + timedelta(hours=rng.gamma(2.0, 22 if december else 14))
            waybill = f"2045{rng.integers(0, 10**10):010d}"
            steps.append((shipped, "shipped", "cms", {"shipped_at": shipped, "waybill_number": waybill}, None))
            arrived = shipped + timedelta(hours=rng.gamma(3.0, 8.0))
            steps.append((arrived, None, "cms", {"arrived_at": arrived}, None))
            unclaimed_share = config.COD_UNCLAIMED_SHARE if method == "cod" else config.CARD_UNCLAIMED_SHARE
            if rng.chance(unclaimed_share):
                # Never collected at Nova Poshta: sent back after the storage period.
                back = arrived + timedelta(days=rng.uniform(7, 10))
                fields = {"returned_at": back}
                if paid is not None:
                    fields.update(payment_status="refunded", refunded_at=back + timedelta(days=2))
                steps.append((back, "unclaimed", "cms", fields, ("return", "cms")))
            else:
                completed = arrived + timedelta(days=rng.gamma(1.5, 1.0))
                fields = {"completed_at": completed}
                if method == "cod":
                    fields.update(paid_at=completed, payment_status="paid")
                steps.append((completed, "completed", "cms", fields, None))
                if rng.chance(config.RETURN_SHARE):
                    back = completed + timedelta(days=rng.uniform(2, 14))
                    steps.append((back, "returned", "cms",
                                  {"returned_at": back, "payment_status": "refunded",
                                   "refunded_at": back + timedelta(days=2)},
                                  ("return", "cms")))  # fmt: skip

        for ts, status, source, fields, putback in steps:
            if ts >= self.end and status != "pending":
                break
            order.update({k: v for k, v in fields.items() if not isinstance(v, datetime) or v < self.end})
            order["updated_at"] = ts
            if status is not None:
                order["status"] = status
                self.tables["order_status_history"].append(
                    {"id": 0, "order_id": order["id"], "status": status, "changed_at": ts, "source": source}
                )
            if putback is not None and tracked:
                heapq.heappush(self.heap, (ts, next(self.seq), "putback",
                                           (order["id"], putback[0], putback[1], tracked)))  # fmt: skip
        for number, (created, completed, status) in enumerate(attempts, start=1):
            if created >= self.end:
                break
            finished = completed < self.end
            self.tables["payments"].append({
                "id": 0, "order_id": order["id"], "provider": "simulator",
                "reference": f"{order['id']}-{number}",
                "status": status if finished else "pending", "amount": order["total_amount"],
                "currency": "UAH", "created_at": created,
                "updated_at": completed if finished else created,
                "completed_at": completed if finished else None,
            })  # fmt: skip

    # --- the run ----------------------------------------------------------------------------

    def run(self) -> Output:
        self.build_catalog_rows()
        self.build_people()
        self.build_visitors()
        self.visits.sort()
        for visit in self.visits:
            self.run_stock_events(visit.ts)
            self.run_visit(visit)
        self.run_stock_events(self.end)
        for cart in self.all_carts:
            self.settle_cart(cart, self.end)
            cart.row.pop("_abandon_at", None)
        self.finish()
        return Output(
            tables=self.tables,
            clean_inventory=self.clean_inventory,
            clean_stock={vid: self.stock[vid] + self.adjusted[vid] for vid in self.stock},
            customer_truth=self.customer_truth(),
            stats=self.stats,
            catalog=self.catalog,
        )

    def finish(self) -> None:
        """Rows that depend on the whole history: users, discount counts, final stock, ids."""
        for p in self.people:
            source, medium, campaign = p.first_traffic or config.CHANNEL_TRAFFIC[p.channel] + (None,)
            verified = None
            if self.plan_rng.chance(config.EMAIL_VERIFIED_SHARE):
                verified = p.created + timedelta(minutes=self.plan_rng.uniform(1, 600))
            self.tables["users"].append({
                "id": p.id, "full_name": p.full_name, "email": p.email,
                "password_hash": config.DEMO_PASSWORD_HASH, "phone": p.phone,
                "acquisition_channel": p.channel, "role": "customer",
                "last_login_at": p.last_login, "created_at": p.created,
                "first_touch_source": source, "first_touch_medium": medium,
                "first_touch_campaign": campaign,
                "email_verified_at": verified if verified and verified < self.end else None,
                "city": p.last_city, "marketing_opt_in": p.marketing_opt_in, "locale": p.locale,
            })  # fmt: skip
        counts: dict[int, int] = {}
        for order in self.tables["orders"]:
            if order["discount_id"] is not None:
                counts[order["discount_id"]] = counts.get(order["discount_id"], 0) + 1
        created = self.catalog.created_at
        for d in self.catalog.discounts:
            self.tables["discounts"].append({
                "id": d.id, "slug": d.slug, "code": d.code, "kind": d.kind,
                "value": money(d.value), "scope_volumes_ml": list(d.scope_volumes_ml) if d.scope_volumes_ml else None,
                "scope_product_public_ids": None, "scope_pack_size": d.scope_pack_size,
                "min_quantity": d.min_quantity, "max_sets": d.max_sets, "starts_at": d.starts_at,
                "ends_at": d.ends_at, "max_redemptions": d.max_redemptions,
                "redemption_count": counts.get(d.id, 0), "active": True,
                "created_at": min(created, d.starts_at or created), "updated_at": created,
            })  # fmt: skip
        for row in self.tables["product_variants"]:
            row["stock_quantity"] = self.stock.get(row["id"], 0)
        # Rows written after the fact get serial ids in time order, like the app's.
        for table, key in (("order_status_history", "changed_at"), ("payments", "created_at")):
            rows = self.tables[table]
            rows.sort(key=lambda r: (r[key], r["order_id"]))
            for i, row in enumerate(rows, start=1):
                row["id"] = i

    def customer_truth(self) -> list[Row]:
        return [
            {
                "user_id": p.id, "segment": p.segment, "purchase_rate": round(p.rate, 4),
                "churn_probability": p.churn, "favourite_family": p.family,
                "usual_device": p.device, "acquisition_channel": p.channel,
                "churned_at": p.churned_at,
            }  # fmt: skip
            for p in self.people
        ]


def simulate(customers: int, visitors: int, start: datetime, end: datetime, seed: int) -> Output:
    return Simulation(customers, visitors, start, end, seed).run()
