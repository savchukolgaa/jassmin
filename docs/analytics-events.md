# Analytics events

The contract for `user_events.event_properties` (#129): which events the shop records, when they
fire, and what their properties hold. It's what an ETL or a recommendation model can rely on.

- **Types:** `EventPropertiesMap` in `app/lib/analytics.ts`.
- **Validation:** `eventPropertiesSchemas` in `app/lib/analytics.schema.ts` checks every event
  before it's stored, so a row that doesn't match its type's contract is never written.
- **Tests:** `app/lib/analytics.schema.test.ts` holds a valid example of each type.

## Rules for every event

- **Consent first.** Nothing is recorded until the visitor accepts analytics cookies, and bots are
  never recorded (`isTrackingAllowed`). The browser sends nothing without consent either.
- **No personal data.** Properties never hold names, emails, phones or addresses. Unknown keys are
  rejected, so a stray field can't slip in.
- **snake_case keys.** Money is an exact decimal string in hryvnias (`"1890.00"`), never a float.
  Ids are the public UUIDs (`products.public_id`, `product_variants.public_id`), except
  `order_id` and `discount_id`, which are serial ids.
- **Columns, not properties.** Who, when and where come from the row's columns:
  - `user_id` and `anonymous_id`: the visitor;
  - `session_id`: the visit;
  - `product_id`: `products.id`, for product events;
  - `source` / `medium` / `campaign`: the visit's traffic source;
  - `device_type`, `referrer` and `created_at`.

## Who records what

| Event | Recorded by | When |
|-------|-------------|------|
| `page_view` | server / browser | A full page load (server), or a client-side navigation (browser). |
| `product_view` | server | A product page's loader. |
| `product_impression` | browser | A card in a product list stayed at least half visible for 1 s. |
| `product_click` | browser | A card's photo or title link is clicked (left or middle button). |
| `product_dwell` | browser | The visitor leaves a product page. |
| `search` | server | The catalog loads with a filter or a non-default sort. |
| `add_to_cart` | server | The cart action adds units: a card's or the product page's button, or the cart page's "+". |
| `remove_from_cart` | server | The cart action removes units: "−" or "Remove". |
| `checkout_start` | server | The checkout page loads with a cart that can be ordered. |
| `purchase` | server | Checkout places an order, once per order. |
| `login` | server | A login, registration or password reset signs the visitor in. |
| `review_submit` | — | Reserved; nothing records it yet. |

Browser events go through `POST /api/events` (`CLIENT_EVENT_TYPES`) in batches of at most 20.
Impressions wait up to 5 s to go out together; the rest go at once. The server fills
`product_id` and drops events about unknown products, but `price` / `in_stock` are what the
browser showed.

## Product events

`product_view`, `product_impression`, `product_click`, `product_dwell`, `add_to_cart` and
`remove_from_cart` share these properties:

| Property | Type | Meaning |
|----------|------|---------|
| `product_public_id` | uuid | The product. |
| `variant_id` | uuid \| null | The size. For a view, impression or dwell it's the size the page or card preselects: the smallest in stock, else the smallest. For a click it's the size picked on the card. For the cart it's the size added or removed. `null` for a product without sizes. |
| `volume_ml` | int \| null | That size's volume. |
| `price` | decimal string \| null | That size's price at that moment. |
| `in_stock` | boolean | Whether that size was in stock at that moment (before the change, for the cart). |
| `list_id` | `ListId`, optional | The list the product was shown in (below). Required on impressions and clicks. |
| `list_position` | int ≥ 1, optional | The card's place in the list, 1-based and counted across pages: the 2nd card of page 2 (12 a page) is 14. Required on impressions and clicks. |
| `search_id` | uuid, optional | The `search` event whose results the list shows. |

### Lists (`list_id`)

| `list_id` | Where |
|-----------|-------|
| `catalog` | `/katalog/zhinochi`, `/katalog/cholovichi` (and `/en/catalog/…`) without filters. |
| `search` | The same catalog with a filter or a non-default sort; carries `search_id`. |
| `popular` | The popular perfumes page. |
| `trio` | The popular page opened from the home page's "Build your trio" (with `family` params). |
| `offers` | The products under each offer on the offers page; positions count within that offer. |
| `similar` | The perfumes suggested on an archived product's page. |
| `home` | The home page's bestsellers. |

A list render is one set of products on one page of one list. Each card sends at most one
impression per list render: going to another page, changing the filters or coming back to the
page starts a new one. A card counts as seen once at least half of it has been on screen for 1
second (`MIN_IMPRESSION_VISIBLE_MS`) without a break while the tab was visible. Cards scrolled
past faster don't count.

### `product_view`

The shared properties, without a list.

```json
{ "product_public_id": "01a1652b-…", "variant_id": "01a1652b-…", "volume_ml": 10,
  "price": "490.00", "in_stock": true }
```

### `product_impression` / `product_click`

The shared properties with `list_id` and `list_position`, plus `search_id` for a search.

```json
{ "product_public_id": "01a1652b-…", "variant_id": "01a1652b-…", "volume_ml": 10,
  "price": "490.00", "in_stock": true, "list_id": "search", "list_position": 14,
  "search_id": "0b6f1b8e-…" }
```

### `product_dwell`

The shared properties (the preselected size), plus:

| Property | Type | Meaning |
|----------|------|---------|
| `dwell_ms` | int, 0–1 800 000 | Visible time on the page, capped at 30 min. |
| `max_scroll_pct` | int, 0–100 | How much of the page has been on screen, at the deepest point. |

The event is sent once per product page view, on the first of: the tab is hidden, the page is
closed, or the visitor navigates on. The clock starts when the page is first visible, so a page
opened in a background tab and closed unseen sends nothing.

```json
{ "product_public_id": "01a1652b-…", "variant_id": "01a1652b-…", "volume_ml": 10,
  "price": "490.00", "in_stock": true, "dwell_ms": 42000, "max_scroll_pct": 80 }
```

### `add_to_cart` / `remove_from_cart`

The shared properties, plus:

| Property | Type | Meaning |
|----------|------|---------|
| `quantity` | int ≥ 1 | Units added or removed. |
| `cart_value_after` | decimal string | The cart subtotal after the change, before discounts. |
| `source` | `"stepper"`, optional | The cart page's +/− buttons. |

A card's button also posts its list, so the event has its `list_id`, `list_position` and
`search_id`. The product page's button has no list.

```json
{ "product_public_id": "01a1652b-…", "variant_id": "01a1652b-…", "volume_ml": 50,
  "price": "1890.00", "in_stock": true, "quantity": 1, "cart_value_after": "2380.00",
  "list_id": "home", "list_position": 2 }
```

## `search`

| Property | Type | Meaning |
|----------|------|---------|
| `search_id` | uuid | Links the results' impressions, clicks and cart adds to this search. |
| `query` | string \| null | Reserved for a text search; the catalog only has filters, so always `null`. |
| `gender` | `women` \| `men` | The catalog. |
| `fragrance_family` | string \| null | The family filter (the stored Ukrainian value). |
| `brand` | string \| null | The brand filter. |
| `sort` | `newest` \| `price_asc` \| `price_desc` | The sort. |
| `page` | int ≥ 1 | The page shown. |
| `result_count` | int | Products matching, across all pages. |
| `product_public_ids` | uuid[] (≤ 24) | The results shown on that page, in order. |

Every page of a filtered catalog is its own search with its own `search_id`.

```json
{ "search_id": "0b6f1b8e-…", "query": null, "gender": "women", "fragrance_family": "Квіткові",
  "brand": null, "sort": "price_asc", "page": 2, "result_count": 31,
  "product_public_ids": ["01a1652b-…", "…"] }
```

## `page_view`

`{ "path": "/en/catalog/women?sort=newest" }`: the path and query of the page.

## `checkout_start`

| Property | Type | Meaning |
|----------|------|---------|
| `subtotal` | decimal string | The cart subtotal. |
| `item_count` | int | Units in the cart. |
| `discount_amount` | decimal string | The discount the cart gets now. |
| `discount_code` | string \| null | The applied promo code, if any. |

## `purchase`

| Property | Type | Meaning |
|----------|------|---------|
| `order_id` | int | `orders.id`. |
| `subtotal`, `discount_amount`, `gift_card_amount`, `total_amount` | decimal string | The order's amounts; `total_amount` is what's left to pay. |
| `discount_id` | int \| null | The discount rule applied. |
| `discount_code` | string \| null | Its promo code, when it has one. |
| `payment_method` | `card` \| `cod` \| `gift_card` | `gift_card` when a gift card paid it all. |
| `items` | array (≥ 1) | Each line: `variant_id`, `quantity`, `unit_price`, `discount_allocated` (the line's share of the discount, as `order_items.discount_allocated`). |
| `is_first_order` | boolean | No earlier order of the same user or, for anyone, with the same email (any case), in any status. |

```json
{ "order_id": 42, "subtotal": "1890.00", "discount_amount": "189.00",
  "gift_card_amount": "0.00", "total_amount": "1701.00", "discount_id": 3,
  "discount_code": "JASSMIN10", "payment_method": "cod",
  "items": [{ "variant_id": "01a1652b-…", "quantity": 1, "unit_price": "1890.00",
              "discount_allocated": "189.00" }],
  "is_first_order": true }
```

## `login`

`{ "method": "login" | "register" | "password_reset" }`.

## Rows recorded before #129

Older rows weren't rewritten. They have camelCase keys, and their product events have no price,
stock or list. Tell them apart by their keys:

| Event | Old key | New key |
|-------|---------|---------|
| `product_view` | `publicId` | `product_public_id` |
| `search` | `fragranceFamily`, `total` (no `search_id`, `query` or `product_public_ids`) | `fragrance_family`, `result_count` |
| `add_to_cart` / `remove_from_cart` | `variantId`, `volumeMl` | `variant_id`, `volume_ml` (`quantity`, `source` unchanged) |
| `checkout_start` | `itemCount`, `discountAmount`, `discountCode` | `item_count`, `discount_amount`, `discount_code` |
| `purchase` | `orderId`, `totalAmount`, `discountAmount`, `discountId`, `discountCode`, `giftCardAmount`, `paymentMethod` | `order_id`, `total_amount`, `discount_amount`, `discount_id`, `discount_code`, `gift_card_amount`, `payment_method` |

`page_view` (`path`) and `login` (`method`) didn't change.

## Changing the contract

1. Change the types in `EventPropertiesMap` and the schema in `eventPropertiesSchemas` together;
   `satisfies` fails `pnpm typecheck` when they differ.
2. Update the example in `analytics.schema.test.ts` and this document.
3. A new event type also needs:
   - an entry in `EVENT_TYPES`;
   - a migration that rewrites `user_events_event_type_check`, with its rollback;
   - for a browser event, an entry in `CLIENT_EVENT_TYPES` and a branch in `clientEventBatchSchema`.
4. Never reuse a key for a different meaning: add a new key instead, so older rows stay readable.
