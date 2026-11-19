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
| `perfumer_message` | server | The AI perfumer chat's action takes a message (answered, failed, cancelled or rate-limited). |
| `perfumer_feedback` | server | A customer rates a perfumer answer 👍 or 👎. |

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
| `perfumer` | The perfumes an AI perfumer answer recommends (#166); each answer is its own list, positions 1–4. |

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

## AI perfumer events (#166)

The chat page's action (`app/routes/perfumer.tsx`) records them, and only ids, counts, timings and
keys: **never text**. The customer's message, the perfumer's intro, reasons and question can hold
personal data, so none of them is stored in an event, and the strict schemas refuse any other key.
The saved chats (#180) keep the text in `perfumer_threads` / `perfumer_messages` only: the
generator, the warehouse and the notebooks never read those tables
(`app/.server/perfumer-privacy.guard.test.ts`). How to read them: [ai-perfumer.md → Analytics](ai-perfumer.md#analytics).

### `perfumer_message`

One per message the action accepts, whether it was answered, failed, cancelled or rate-limited. A
message refused as too long (or malformed) records nothing.

| Property | Type | Meaning |
|----------|------|---------|
| `reply_id` | uuid | Generated by the server per message; the answer's rating names it. |
| `turn` | int 1–100 | The customer's message number in the conversation, counted from the saved thread (#180; before it, sent by the page). |
| `latency_ms` | int 0–600 000 | Server time from accepting the message to the result; 0 when rate-limited. |
| `model` | string \| null | `AI_MODEL`; `null` when rate-limited (the model wasn't called). |
| `tool_calls` | array (≤ 12) | Each catalog tool call: `name` (`search_perfumes`, `similar_to`, or `other` for anything else) and `argument_keys`, the names of its arguments (`families`, `max_price_uah`, …), never their values. |
| `pick_ids` | uuid[] (≤ 4) | `products.public_id` of the perfumes recommended, in order. |
| `asked_question` | boolean | The answer asked a clarifying question. |
| `error` | `unavailable` \| `timeout` \| `bad_response` \| `rate_limited` \| `cancelled` \| null | Why there was no answer; `null` when answered. Finer than the chat's error message. |
| `entry` | `menu` \| `catalog` \| `empty_results` \| `product` \| `corner` \| `direct` | How the conversation was opened: the `?from=` of the link to the chat (the header and mobile menu send `menu`), kept for the whole conversation; `direct` without one. |

```json
{ "reply_id": "6f9b3c2a-…", "turn": 2, "latency_ms": 8400, "model": "granite4.1:3b",
  "tool_calls": [{ "name": "search_perfumes", "argument_keys": ["families", "max_price_uah"] }],
  "pick_ids": ["01a1652b-…"], "asked_question": true, "error": null, "entry": "menu" }
```

### `perfumer_feedback`

The 👍/👎 under an answer: `reply_id` (the answer's), `turn` (the message it answered) and
`rating` (`up` \| `down`). Pressing the other button records a new event, so the latest one per
`reply_id` is the answer's rating.

```json
{ "reply_id": "6f9b3c2a-…", "turn": 2, "rating": "up" }
```

The perfumer's product cards are the `perfumer` list: their impressions and clicks are ordinary
`product_impression` / `product_click` events with `list_id: "perfumer"`. Their add-to-cart button
(#169) posts the list too, so `add_to_cart` has `list_id: "perfumer"` and the card's
`list_position`, and an order is attributed to an answer through it. A card added in the moment
before its answer finishes streaming has no list (those cards aren't a list yet).

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
