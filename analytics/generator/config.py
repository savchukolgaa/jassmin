"""The synthetic shop's parameters: the customer model, traffic, seasonality and the anomaly rates.

Everything that README.md documents as "the ground truth" or "the anomaly catalogue" is defined
here, so the documentation, the generator and the tests read one source.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

KYIV = ZoneInfo("Europe/Kyiv")

# --- the shop (prices, volumes and the free-delivery threshold come from data/catalog.json) ----

#: Sizes whose stock is counted (#98 tracks none in the real shop; the synthetic shop tracks the
#: full bottles so the inventory ledger, stock-outs and demand forecasting have data, Q4 of #131).
TRACKED_VOLUMES = (30, 50, 100)
FULL_BOTTLES = (30, 50, 100)
#: How likely a cart line is to be each size.
VOLUME_WEIGHTS = {5: 0.18, 10: 0.27, 30: 0.25, 50: 0.20, 100: 0.10}

#: The couple offer (#124) in the synthetic history (Q3 of #131): before/after for uplift studies.
COUPLE_OFFER_START = datetime(2025, 9, 1, tzinfo=KYIV)
#: A cart without activity for this long is marked abandoned by the hourly job (#19).
ABANDONED_CART_HOURS = 24
#: Card orders still unpaid this long after checkout are cancelled by the job (#128).
UNPAID_ORDER_HOURS = 48

#: Every synthetic user can log in with this password when `--load-app-schema` is used.
DEMO_PASSWORD = "jassmin-demo"
#: argon2id of DEMO_PASSWORD, made once with the app's `@node-rs/argon2` (`hashPassword`).
DEMO_PASSWORD_HASH = (
    "$argon2id$v=19$m=19456,t=2,p=1$usr0KDLg8QtnFjVG27BCdg$7OJ8sK9HKXvU9i2A4yHX96+bkXKFSTAJE3VLDFpzZck"
)

# --- customers: the ground truth the ML work (#133) has to recover -----------------------------

#: segment -> (share of customers, mean orders per year while alive, churn probability per order)
SEGMENTS: dict[str, tuple[float, float, float]] = {
    "loyal": (0.08, 6.0, 0.06),
    "regular": (0.22, 3.0, 0.18),
    "occasional": (0.35, 1.3, 0.40),
    "one_time": (0.35, 0.6, 0.85),
}
#: Shape of the Gamma distribution of individual purchase rates around the segment mean.
RATE_GAMMA_SHAPE = 2.0
#: Share of a customer's product views that are in their favourite fragrance family.
FAVOURITE_FAMILY_SHARE = 0.65
#: Share of customers who order in the session they sign up in (accounts made at checkout).
FIRST_ORDER_AT_SIGNUP = 0.7
#: Mean number of visits without buying after a customer churns.
POST_CHURN_VISITS = 1.5
FEMALE_SHARE = 0.72

CHANNELS: dict[str, float] = {
    "instagram": 0.34,
    "google": 0.22,
    "direct": 0.16,
    "telegram": 0.12,
    "referral": 0.09,
    "facebook": 0.07,
}
#: channel -> (traffic source, traffic medium), as the app stores them on sessions and events.
CHANNEL_TRAFFIC: dict[str, tuple[str, str]] = {
    "instagram": ("instagram", "social"),
    "google": ("google", "organic"),
    "direct": ("direct", "none"),
    "telegram": ("t.me", "referral"),
    "referral": ("friend", "referral"),
    "facebook": ("facebook", "paid_social"),
}
DEVICES = ("mobile", "tablet", "desktop")
#: channel -> probabilities of DEVICES.
DEVICE_BY_CHANNEL: dict[str, tuple[float, float, float]] = {
    "instagram": (0.86, 0.04, 0.10),
    "telegram": (0.82, 0.03, 0.15),
    "facebook": (0.72, 0.06, 0.22),
    "google": (0.58, 0.07, 0.35),
    "direct": (0.50, 0.08, 0.42),
    "referral": (0.66, 0.05, 0.29),
}
#: Probability of paying by card (else cash on delivery), by device.
CARD_SHARE = {"desktop": 0.62, "tablet": 0.55, "mobile": 0.52}
CITIES: list[tuple[str, float]] = [
    ("Київ", 0.30),
    ("Львів", 0.12),
    ("Одеса", 0.10),
    ("Харків", 0.09),
    ("Дніпро", 0.09),
    ("Вінниця", 0.06),
    ("Запоріжжя", 0.05),
    ("Івано-Франківськ", 0.05),
    ("Тернопіль", 0.04),
    ("Полтава", 0.04),
    ("Чернівці", 0.03),
    ("Рівне", 0.03),
]
FIRST_NAMES_F = [
    "Олена", "Ірина", "Наталія", "Оксана", "Юлія", "Анна", "Марія", "Катерина", "Тетяна",
    "Вікторія", "Софія", "Дарина", "Ольга", "Христина",
]  # fmt: skip
FIRST_NAMES_M = [
    "Олександр", "Андрій", "Дмитро", "Максим", "Сергій", "Іван", "Тарас", "Богдан", "Віталій",
    "Микола", "Юрій", "Остап",
]  # fmt: skip
LAST_NAMES = [
    "Шевченко", "Коваленко", "Бондаренко", "Ткаченко", "Кравченко", "Олійник", "Мельник",
    "Поліщук", "Лисенко", "Гнатюк", "Марченко", "Руденко", "Мороз", "Петренко", "Савченко",
]  # fmt: skip
EMAIL_DOMAINS = (("gmail.com", 0.70), ("ukr.net", 0.15), ("i.ua", 0.05), ("icloud.com", 0.10))
PHONE_PREFIXES = ("50", "63", "66", "67", "68", "73", "93", "95", "96", "97", "98", "99")
TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d", "е": "e", "є": "ie", "ж": "zh",
    "з": "z", "и": "y", "і": "i", "ї": "i", "й": "i", "к": "k", "л": "l", "м": "m", "н": "n",
    "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "shch", "ь": "", "ю": "iu", "я": "ia", "'": "",
})  # fmt: skip
#: Share of users whose site language is English.
ENGLISH_SHARE = 0.1
MARKETING_OPT_IN_SHARE = 0.48
EMAIL_VERIFIED_SHARE = 0.7

#: Relative visit volume per local hour (evening peak).
HOUR_WEIGHTS = (
    1, 0.5, 0.3, 0.2, 0.2, 0.3, 0.8, 1.5, 2.5, 3.5, 4, 4.2,
    4.5, 4.3, 4.2, 4.4, 4.8, 5.4, 6.3, 7.2, 7.8, 7.0, 5.0, 2.5,
)  # fmt: skip

# --- visits and orders -------------------------------------------------------------------------

#: Share of anonymous visitors (never registered) who leave a cart / place a guest order.
VISITOR_CART_SHARE = 0.12
VISITOR_GUEST_ORDER_SHARE = 0.02
#: Probability a shopper who finds a tracked size out of stock still orders it (a backorder:
#: stock goes negative, a raw-layer anomaly); otherwise they take the 10 ml size instead.
BACKORDER_SHARE = 0.15
#: Reorder policy for tracked sizes: below this stock a supplier order is placed.
REORDER_POINT = 1
REORDER_QUANTITY = (3, 9)  # uniform integer, high exclusive
SUPPLIER_LEAD_DAYS = (5.0, 21.0)
OPENING_STOCK = (2, 9)

ORDER_CANCEL_SHARE = 0.03
CARD_FIRST_ATTEMPT_FAIL = 0.08
CARD_RETRY_SUCCESS = 0.6
COD_UNCLAIMED_SHARE = 0.07
CARD_UNCLAIMED_SHARE = 0.01
RETURN_SHARE = 0.02
WELCOME_CODE_SHARE = 0.35
SPRING_CODE_SHARE = 0.4
TRIO_CART_SHARE = 0.12
COUPLE_CART_SHARE = 0.10

# --- deliberate anomalies (README.md: the anomaly catalogue) -----------------------------------
# Each rate is applied as an exact count, round(rate * rows), so a run hits it exactly.

ANOMALY_RATES: dict[str, float] = {
    "sessions_missing_device_type": 0.03,
    "events_missing_device_type": 0.03,
    "duplicate_events": 0.015,
    "users_missing_phone": 0.12,
    "users_messy_email": 0.02,
    "orders_price_typo": 0.002,
    "orders_shipped_after_completed": 0.004,
    "orders_lowercase_currency": 0.01,
    "order_items_deleted_product": 0.005,
    "events_naive_utc_timestamp": 0.01,
}
#: Fixed counts.
BOT_SESSIONS = 25
BOT_VIEWS = (150, 400)  # per session, high exclusive
BOT_SECONDS_BETWEEN_VIEWS = 0.7
TEST_ACCOUNTS = 15


def seasonality(day: date) -> float:
    """Demand multiplier for a Kyiv calendar day: Ukrainian gifting peaks and a summer dip."""
    m, d = day.month, day.day
    mult = {1: 0.8, 2: 1.15, 3: 1.25, 4: 0.95, 5: 0.95, 6: 0.85, 7: 0.75, 8: 0.85, 9: 1.0,
            10: 1.0, 11: 1.15, 12: 1.6}[m]  # fmt: skip
    if m == 2 and 7 <= d <= 14:
        mult *= 1.9  # Valentine's Day
    if m == 3 and 1 <= d <= 8:
        mult *= 2.6  # 8 March, the biggest perfume day in Ukraine
    if m == 12 and 1 <= d <= 6:
        mult *= 1.8  # St Nicholas Day
    if m == 12 and 15 <= d <= 31:
        mult *= 1.5  # New Year
    if m == 11 and 22 <= d <= 30:
        mult *= 1.7  # Black Friday week
    return mult


#: The largest value of seasonality(), for thinning (8 March: 1.25 * 2.6).
MAX_SEASONALITY = 3.25


def campaign_for(day: date) -> str:
    """The paid-social campaign running on a day."""
    if day.month == 3 and day.day <= 8:
        return "8march"
    if day.month == 2 and day.day <= 14:
        return "valentine"
    if day.month == 11 and day.day >= 20:
        return "black_friday"
    if day.month == 12:
        return "new_year"
    return "always_on"


ONE_DAY = timedelta(days=1)
