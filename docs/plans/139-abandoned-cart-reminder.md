# Plan: Send one reminder email for abandoned carts to customers who opted in (#139)

Issue: https://github.com/savchukolgaa/jassmin/issues/139
Branch: `issue/139`
Worktree: `.claude/worktrees/issue-139`
Status: Planned

## Goal

The store owner wants customers who left perfumes in their cart to get one friendly reminder email, so that some of those carts turn into orders. An hourly job, `pnpm db:send-cart-reminders`, sends one reminder per abandoned cart to registered users who agreed to marketing emails. The email lists the cart's items and links back to the cart with UTM tags, and every reminder has a one-click unsubscribe (RFC 8058).

## Dependencies & prerequisites

- #19 (closed): `carts.status = 'abandoned'` and `carts.abandoned_at`, written by `pnpm db:mark-abandoned-carts` (`db/abandoned-carts.ts`, `markAbandonedCarts` in `db/queries/cart.ts`).
- #128 (closed): `users.marketing_opt_in`, set at registration and on `/account/profile` (`setMarketingOptIn`). Per `app/.server/AGENTS.md`, nothing sends marketing email yet.
- #134 (closed): `composeEmail` (`email/layout.ts`), `withSuppressions` / `getMailer()`, the `email_suppressions` table and the Brevo bounce webhook, which tags each email with `X-Mailin-custom: order-email:<id>`.
- #45 / #138 (closed): the `order_emails` outbox with its lease (`claimOrderEmails`), its retries and `deliverOrderEmails`. Reminders reuse all of it.
- #18 (closed): UTM attribution. `resolveTrafficAttribution` / `utmParam` (`~/lib/analytics`) already set `sessions.traffic_campaign` from `utm_campaign`, but only for visitors who accepted cookies.
- #135 (closed): the token-page pattern (a GET page with a confirm button, so mail scanners can't use a link up) and `ROBOTS_PRIVATE_PAGES`.
- New env var: `EMAIL_UNSUBSCRIBE_SECRET` (in `mailEnvSchema` and `envSchema`, required in production).
- New migration `0029_cart_reminders` with a hand-written rollback in `db/rollbacks/`.
- New static file: `public/email/shop-bottle.jpg`, a small (about 240×300) JPEG of the shop bottle photo with its metadata stripped.

## Decisions & assumptions

1. **The outbox is the existing `order_emails` table, extended, not a new table.** The table gets a nullable `cart_id` (FK `carts.id`, `on delete cascade`) and the new type `cart_reminder`. `order_emails_target_check` becomes "exactly one of `order_id`, `gift_card_id`, `cart_id` is set", and `unique (cart_id, type)` means a cart can get at most one reminder. This way the lease, the retries, suppressions, `message_id` and the bounce webhook (`markOrderEmailBounced` via the `order-email:<id>` tag) all work without changes. The table keeps its name: renaming it buys nothing and touches every caller.
2. **`carts.reminder_sent_at` (timestamptz, nullable) is set when the reminder is queued**, in the same transaction as the `order_emails` insert, by `UPDATE … WHERE reminder_sent_at IS NULL`. Two job runs at once therefore can't queue a cart twice. It counts towards the 7-day limit even if the send fails later (for example, a suppressed address), which errs on the side of sending less. The update must keep `updated_at` unchanged (`set updated_at = updated_at`, like `markAbandonedCarts`), because `updated_at` is the shopper's last activity.
3. **Eligibility is one SQL query** (`listCartReminderCandidates` in `db/queries/cart-reminders.ts`):
   - the cart is `abandoned`, has a `user_id` and has `reminder_sent_at IS NULL`;
   - it was abandoned recently: `abandoned_at >= now() - CART_REMINDER_MAX_AGE_HOURS` (72 h). Without this, the first run after deploy would email every cart ever abandoned;
   - the user has `marketing_opt_in = true`, and their lower-cased email is not in `email_suppressions`;
   - the user has had no reminder in the last 7 days: no other cart of theirs has `reminder_sent_at > now() - interval '7 days'`;
   - the user hasn't ordered since: no `orders` row for them with `created_at > carts.updated_at`;
   - at least one line is still available: the product is `active` and the variant is untracked or has `stock_quantity > 0`, the same rule as `availableStock`;
   - only the user's latest such cart counts (`DISTINCT ON (user_id) … ORDER BY user_id, abandoned_at DESC`), and the batch is limited (`CART_REMINDER_BATCH_SIZE` = 100). The rows are locked with `FOR UPDATE OF carts SKIP LOCKED`.
4. **Eligibility is checked again when the email is built.** A reminder can wait for a retry, so the builder reloads the cart (`findCartReminder`). If the user has opted out or ordered since, or nothing in the cart is available any more, the row is marked `failed` with `last_error = 'not eligible: <reason>'` (final) and nothing is sent. No new status is added, so there is no CHECK rewrite for statuses and no enum mirror change.
5. **The email is in the user's language, from a new `users.locale` column** (nullable text, CHECK `oneOf(LOCALES)`). It is set from the request's locale by `onUserAuthenticated` (login, registration, password reset) and by `createOrder` for a logged-in buyer, and it isn't an ML feature. When queuing, the reminder's locale is `coalesce(users.locale, the locale of the user's latest order_emails row, 'uk')`.
6. **The unsubscribe link uses a signed token, not a token table**. The token is `base64url(userId) + "." + base64url(HMAC-SHA256(EMAIL_UNSUBSCRIBE_SECRET, "unsubscribe:v1:" + userId))`, and it is checked with `timingSafeEqual`. It never expires, can be used again and again (unsubscribing twice is harmless), and gives a retry the same URL. An auth-token row can't do this: only its hash is stored, so a retry couldn't rebuild the link.
7. **Unsubscribing:** a new page `unsubscribe: { uk: "vidpysatysia/:token", en: "unsubscribe/:token", indexable: false }` in `PAGES`, registered with `localizedRoute` in `app/routes.ts`. The page goes in `ROBOTS_PRIVATE_PAGES` and sends `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store`, like the #135 pages.
   - The GET loader only verifies the token and shows a "Unsubscribe" button. A mail scanner opening the link changes nothing.
   - The action runs `unsubscribeMarketing(userId)`, which sets `marketing_opt_in = false` (reusing `setMarketingOptIn`). It accepts two kinds of POST: the page's own form, and the RFC 8058 one-click POST from the mail client (body `List-Unsubscribe=One-Click`, no cookies). The action answers that POST with a 200 and no redirect. There is no CSRF/origin middleware in the app to exempt it from (checked).
   - The headers on every reminder are `List-Unsubscribe: <https://…/vidpysatysia/<token>>` (in the email's language) and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The footer also gets a visible unsubscribe link (a new optional `EmailFooter.unsubscribeUrl`, rendered in HTML and text).
   - `deliverOne` currently **overwrites** `message.headers` with the tag header. It must merge them instead (`{ ...message.headers, ...orderEmailTagHeader(id) }`), or the `List-Unsubscribe` headers would be dropped.
8. **Email content** (`buildCartReminderEmail` in `services/cart-reminder-email.ts`, built with `composeEmail` from `ORDER_FROM ?? CONTACT_FROM`, copy in a new `cartReminderEmail` i18n namespace):
   - a greeting and a short line;
   - up to 3 available lines, each with a photo, the name and the size (`{volume} ml × {quantity}`), and "and N more" when there are more;
   - the total of the available lines at today's prices (`cartTotals`, `numeric` in SQL, formatted with the translator's `formatPrice`);
   - the button "Повернутися до кошика" / "Back to your cart";
   - a signature, and the footer with the unsubscribe link.
   - No discount: the issue wants the plain effect measured first.
   - The layout has no image block yet. Add `{ type: "products"; items: { name; details; imageUrl }[] }` to `EmailBlock`. `renderEmail` renders it as an escaped table with a 64 px `<img>` for each item (only `https:` URLs; otherwise no image), and the text part as one line per item.
   - The photo is `products.image_url` when it's an absolute `https` URL, otherwise `${PUBLIC_SITE_URL}/email/shop-bottle.jpg`. The job runs under `tsx`, which can't import Vite assets like `~/lib/shop-bottle`, so the bottle needs a stable file in `public/` (see the memory note: the bottle photo stands in for every product).
   - Without `PUBLIC_SITE_URL`, no reminder can link back, so the job queues nothing and logs why.
9. **The link back to the cart is** `pathFor(locale, "cart")` plus `?restore=1&utm_source=email&utm_medium=email&utm_campaign=abandoned_cart`, so `/koshyk?…` in Ukrainian and `/en/cart?…` in English. Existing UTM handling attributes the visit to `abandoned_cart` for visitors who accepted cookies; nothing new is needed there.
10. **Restoring the cart.** Today `abandoned` is final, so the link alone would open an empty cart. Restoring follows "reads in loaders, writes in actions":
    - **Guest:** if the cart loader gets `restore=1` from a visitor who isn't logged in, it redirects to the login page with `redirectTo` set to the full cart URL (UTM tags kept). The visit has already been recorded with the campaign before the redirect, and `linkVisitorToUser` hands it to the user after login.
    - **Logged-in user:** `getCartView` also returns `restorable`, the user's latest cart that is `abandoned`, was reminded in the last 7 days (`reminder_sent_at`), has `restored_at IS NULL` and has available lines. It is `null` once the user has ordered since. The cart page shows a banner ("Your cart from {date}: {count} items" with a "Restore" button).
    - **Restore action:** the cart action's new intent `restore` runs `restoreAbandonedCart(userId, cartId)`. It works in one transaction: it locks the abandoned cart and checks it again, gets or creates the user's active cart, and merges the lines into it. The merge uses the line loop from `mergeGuestCart`, moved into a shared `mergeCartLines(tx, fromCartId, toCartId)`: it caps quantities at stock and drops sold-out sizes. The promo code comes along if the active cart has none. The action then sets the abandoned cart's new `carts.restored_at`, without touching `updated_at` (raw SQL), and calls `touchCart` on the active cart.
    - The abandoned cart keeps its status and `abandoned_at`, so "abandoned is final" and the ML features stay true. `restored_at` also gives a click-through measure.
11. **Recovery rate:** `docs/email.md` gets a "Cart reminders" section with a SQL query. It counts carts whose `cart_reminder` email was `sent`, and the ones whose user placed an order (not `cancelled`) within 7 days of `sent_at`, with the rate overall and by week. It also has a second query: orders from sessions with `traffic_campaign = 'abandoned_cart'` (consented visitors only). The recovery rate doesn't depend on cookie consent, because it joins users and orders, not sessions.
12. **The job:** `db/cart-reminders.ts` (`sendCartRemindersJob(db, mailer, env)`) and the CLI `db/scripts/send-cart-reminders.ts`, which uses `parseMailEnv` and `createDb`, like `send-order-emails.ts`. The `package.json` script is `db:send-cart-reminders`, run hourly. The job queues in one transaction (`queueCartReminders`: candidates → set `reminder_sent_at` → insert `order_emails` rows), then calls `deliverOrderEmails({ type: "cart_reminder" }, deps)` to send them right away. `pnpm db:send-order-emails` retries failures as usual. Without `SMTP_URL` the job queues nothing, so reminders don't pile up unsent and then go out all at once days later.
13. **Quiet hours:** none. The job runs hourly, so a reminder goes out about 24–25 h after the last activity, at about the same time of day the customer was shopping.
14. **Deviation (step 2): `EMAIL_UNSUBSCRIBE_SECRET` is optional, also in production**, like `EMAIL_WEBHOOK_SECRET`, instead of required: making it required in `mailEnvSchema` would stop `pnpm db:send-order-emails` (and the app) in production until it is set. Without it the reminder job sends nothing and the unsubscribe page answers 404, and `getEnv()` warns once in production. The env table lives in `docs/setup.md`, not the README, so it is documented there.
15. **Order (steps 5 and 8):** the unsubscribe page (step 8) was built before the email builder (step 5), because `pathFor(locale, "unsubscribe")` needs the page in `PAGES` and every page there must be registered in `app/routes.ts`. The one-click POST gets the page's normal 200 response (any 2xx satisfies RFC 8058), so the action needs no special case.

## Resolved questions

- **Q1–Q5 (open when the plan was written)** — the user chose every recommended default on 2026-11-06: a signed unsubscribe token with `EMAIL_UNSUBSCRIBE_SECRET` (Q1), a new `users.locale` column with fallbacks (Q2), only carts abandoned in the last 72 h (Q3), a "Restore" banner instead of a restore on GET (Q4), and no email-verification check (Q5). The decisions above follow these answers.

- **Is there an outbox to reuse?** Yes. `order_emails` has a lease, retries, suppressions and bounce matching by its `order-email:<id>` tag, and its target CHECK can take a third target (source: `app/.server/db/schema.ts`, `app/.server/services/order-email.ts`, `app/.server/AGENTS.md` → Order email outbox).
- **Does UTM attribution need work?** No. `utmParam(url, "utm_campaign")` fills `sessions.traffic_campaign`, and events copy it, but only with cookie consent (source: `app/lib/analytics.ts`, `app/.server/analytics.ts`, `app/.server/AGENTS.md` → Visitor and events).
- **What is the cart path?** `koshyk` in Ukrainian and `cart` under `/en/` in English, via `pathFor` (source: `app/lib/paths.ts`).
- **Does the link alone bring the cart back?** No. `abandoned` is final and lookups only see `active` carts, so a restore step is needed (source: `app/.server/AGENTS.md` → Cart).
- **Does the login page keep a return URL?** Yes. `redirectTo` goes through `safeRedirect` (source: `app/routes/login.tsx`).
- **Do product photos exist for the email?** `products.image_url` is often null, and the shop uses one bottle photo for every perfume. The `tsx` job can't import the Vite asset, so a copy goes in `public/email/` (source: `app/lib/shop-bottle.ts`, memory "Shop bottle photos are generic").
- **Does "at most once a week" match the copy users agreed to?** Yes. The profile already promises marketing emails "не частіше ніж раз на тиждень" (source: `app/lib/i18n/uk.ts` → `account.profile.marketing.description`).
- **Can the one-click POST reach an action without a session?** Yes. There is no CSRF/origin middleware in `app/` (checked with grep), and the `_shop` visitor middleware doesn't track a request without a consent cookie.
- **Does `composeEmail` support extra headers?** Yes, through `headers`. But `deliverOne` replaces them with the tag header, so that has to become a merge (source: `app/.server/email/layout.ts`, `app/.server/services/order-email.ts`).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | Add `cart_reminder` to `ORDER_EMAIL_TYPES` |
| modify | `app/lib/commerce.ts` (and other mirrors `schema.test.ts` checks) | Add `reminderSentAt`, `restoredAt` to the cart row type |
| modify | `app/.server/db/schema.ts` | `carts.reminder_sent_at`, `carts.restored_at`, `users.locale`, `order_emails.cart_id`, new target check, unique `(cart_id, type)`, partial index for the 7-day lookup |
| create | `app/.server/db/migrations/0029_cart_reminders.sql` (+ meta) | Generated with `pnpm db:generate --name cart_reminders`; rewrites the type and target checks |
| create | `app/.server/db/rollbacks/0029_cart_reminders.sql` | Hand-written reverse |
| create | `app/.server/db/queries/cart-reminders.ts` (+ `.test.ts`) | `listCartReminderCandidates`, `queueCartReminders`, `findCartReminder`, `findRestorableCart`, `markCartRestored` |
| modify | `app/.server/db/queries/order-emails.ts` | `ClaimedOrderEmail.cartId`, `claimOrderEmails` `type` filter |
| modify | `app/.server/db/queries/users.ts` | `setUserLocale` |
| create | `app/.server/unsubscribe-token.ts` (+ `.test.ts`) | `createUnsubscribeToken`, `verifyUnsubscribeToken` (HMAC, `timingSafeEqual`) |
| modify | `app/.server/env.ts`, `env.test.ts`, `.env.example`, `README.md` | `EMAIL_UNSUBSCRIBE_SECRET` |
| modify | `app/.server/email/layout.ts` (+ `layout.test.ts`) | `products` block, `EmailFooter.unsubscribeUrl` |
| create | `app/.server/services/cart-reminder-email.ts` (+ `.test.ts`) | `buildCartReminderEmail`, `cartReminderUrl`, `unsubscribeUrl`, `listUnsubscribeHeaders` |
| modify | `app/.server/services/order-email.ts` (+ `.test.ts`) | `loadCartReminder` dep, `cart_reminder` branch in `buildEmail`, not-eligible handling, merge headers in `deliverOne`, `type` option on `deliverOrderEmails`, label for cart emails |
| create | `app/.server/db/cart-reminders.ts` (+ `.test.ts`) | `sendCartRemindersJob` |
| create | `app/.server/db/scripts/send-cart-reminders.ts` | CLI wrapper |
| modify | `package.json` | `db:send-cart-reminders` |
| create | `app/.server/services/marketing.ts` (+ `.test.ts`) | `unsubscribeMarketing(token)` |
| modify | `app/lib/paths.ts` | `unsubscribe` page |
| modify | `app/routes.ts` | Register `routes/unsubscribe.tsx` |
| create | `app/routes/unsubscribe.tsx` (+ `.test.ts`) | GET confirm page, POST (form and RFC 8058 one-click) |
| modify | `app/.server/seo/robots.ts` (+ test) | Add `unsubscribe` to `ROBOTS_PRIVATE_PAGES` |
| modify | `app/.server/services/cart.ts` (+ `cart.test.ts`) | `mergeCartLines` helper, `restoreAbandonedCart`, `restorable` in `getCartView` |
| modify | `app/routes/cart.tsx`, `app/lib/cart.schema.ts` | `restore=1` guest redirect, `restore` intent |
| create | `app/features/cart/RestoreCartBanner.tsx` | The banner (C+ tokens, `docs/design.md`) |
| modify | `app/.server/services/auth.ts`, `app/.server/services/orders.ts` | Set `users.locale` |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `cartReminderEmail.*`, `unsubscribe.*`, `cart.restore.*`, `email.footer.unsubscribe` |
| create | `public/email/shop-bottle.jpg` | Stable, unfingerprinted bottle photo for emails (EXIF stripped) |
| modify | `docs/email.md` | Cart reminders: job, schedule, unsubscribe, recovery-rate SQL |
| modify | `app/.server/AGENTS.md` | Document the reminder outbox rows, `reminder_sent_at` / `restored_at`, `users.locale`, the unsubscribe token, and that `abandoned` stays final |

## Steps

- [x] **1. Schema and migration.** Add `cart_reminder` to `ORDER_EMAIL_TYPES`. Add these columns:
  - `carts.reminderSentAt` and `carts.restoredAt` (timestamptz, nullable) with doc comments, and update the mirrored row types;
  - `users.locale` (`text().$type<Locale>()`, nullable, CHECK `users_locale_check`);
  - `orderEmails.cartId` (FK `carts.id`, cascade).

  Replace `order_emails_target_check` with `num_nonnulls(order_id, gift_card_id, cart_id) = 1`, and add `unique("order_emails_cart_id_type_unique")` and an index `carts_user_id_reminder_sent_at_idx` (partial, `reminder_sent_at is not null`). Run `pnpm db:generate --name cart_reminders`, check that the SQL rewrites `order_emails_type_check`, and write the rollback (drop the new rows' type first: `delete from order_emails where cart_id is not null`). Run `pnpm db:migrate` and `pnpm db:rollback` and migrate again against a dev database. `schema.test.ts` passes.
- [x] **2. Unsubscribe token and env.** Add `EMAIL_UNSUBSCRIBE_SECRET` (`z.string().min(32)`) to `mailEnvSchema` (spread into `envSchema`), required in production with a refinement like `hasSmtpInProduction` (add it to both schemas). Write `unsubscribe-token.ts`, which is pure and takes the secret as an argument, with tests: round trip, tampered signature, another user id, malformed input, a different secret. Add `.env.example`, a README table row and an `env.test.ts` case. Set a test secret in `vitest.config.ts`.
- [x] **3. Eligibility and queueing queries.** In `db/queries/cart-reminders.ts`:
  - `queueCartReminders(tx, { now, maxAgeHours, intervalDays, limit })`: one CTE that selects the candidates by the rules in Decision 3 (`DISTINCT ON`, `FOR UPDATE OF carts SKIP LOCKED`), sets `reminder_sent_at = now` and `updated_at = updated_at` on them, and inserts `order_emails (cart_id, type, locale)` with the locale from `coalesce(users.locale, latest order_emails.locale, 'uk')`. It uses `on conflict do nothing` and returns the queued cart ids.
  - `findCartReminder(db, cartId)`: the user (name, email, `marketing_opt_in`), whether they ordered since, up to 3 available lines (title, `image_url`, `volume_ml`, quantity) with the count of available lines, and the total of the available lines in SQL.

  Integration tests on `createTestDatabase()` cover each rule: consent on/off, the 7-day limit, ordered since, every line unavailable (archived product, or a tracked size out of stock), a suppressed address, older than 72 h, a guest cart, two abandoned carts (only the latest), running twice (one row), and `updated_at` unchanged.
- [x] **4. Email layout.** Add the `products` block and `EmailFooter.unsubscribeUrl` to `email/layout.ts`, both parts and escaped, with images only from `http(s)` URLs (like buttons, so a local `http://localhost` site shows them in smtp4dev). Add tests with `htmlWords` / `words` and a test that `javascript:` / `data:` image URLs are dropped.
- [x] **5. Reminder email builder.** Write `services/cart-reminder-email.ts`:
  - `buildCartReminderEmail(reminder, translator, env)` returns `composeEmail(…)` with `headers: listUnsubscribeHeaders(url)`;
  - `cartReminderUrl(siteUrl, locale)` builds the cart URL with `restore=1` and the UTM tags;
  - `unsubscribeUrl(siteUrl, locale, token)` uses `pathFor(locale, "unsubscribe", { token })`.

  Add the copy to both i18n files (the `cartReminderEmail` namespace and `email.footer.unsubscribe`). Unit tests cover: Ukrainian and English, the 3-item limit with "and N more", the photo fallback to `/email/shop-bottle.jpg`, the button URL exactly as in the issue (plus `restore=1`), and both headers. Add the `public/email/shop-bottle.jpg` file (resized from `app/assets/shop-bottle/shop-bottle-1280.jpg`, metadata stripped).
- [ ] **6. Delivery through the outbox.** In `services/order-email.ts`:
  - add `loadCartReminder` to `OrderEmailDeps` / `orderEmailDeps`, and `cartId` to `ClaimedOrderEmail` and the `claimOrderEmails` returning list, with an optional `type` filter;
  - in `buildEmail`, add a `cart_reminder` branch that returns a "not eligible" result (opt-out, ordered since, nothing available) which `deliverOne` marks `failed` with `final: true` and doesn't send;
  - in `deliverOne`, merge the headers instead of replacing them, and label the email `cart <id>'s cart_reminder email`;
  - give `deliverOrderEmails` a `type` option.

  Unit tests with the fake deps cover: a reminder is sent with `List-Unsubscribe`, `List-Unsubscribe-Post` and the tag header; a user who opted out after queuing gets nothing; a retry gives the same unsubscribe URL; existing order-email tests still pass.
- [ ] **7. The job.** `db/cart-reminders.ts`: `sendCartRemindersJob(db, mailer, env, now?)` returns `{ queued, report, message }`. It skips with a message when `mailer` or `PUBLIC_SITE_URL` is missing, otherwise runs `queueCartReminders` in a transaction, then `deliverOrderEmails({ type: "cart_reminder" }, orderEmailDeps(db, mailer, env))`. The CLI `db/scripts/send-cart-reminders.ts` mirrors `send-order-emails.ts`, and `package.json` gets `db:send-cart-reminders`. An integration test with a fake mailer checks that one email is sent for an eligible cart and that a second run sends none.
- [x] **8. Unsubscribe page.** *(Done before step 5: the email builder needs the page's path.)* Add `unsubscribe` to `PAGES` and to `ROBOTS_PRIVATE_PAGES`, and register it in `app/routes.ts`. `services/marketing.ts`: `unsubscribeMarketing(token, env, db)` verifies the token and calls `setMarketingOptIn(userId, false)`, and returns `{ ok: true } | { ok: false, error: "invalid-token" }`. `routes/unsubscribe.tsx`:
  - the loader verifies the token only, never writes, and returns `{ valid }` with 404-style copy when the token is invalid;
  - the action validates the form with a zod schema in `app/lib/unsubscribe.schema.ts` (an optional `List-Unsubscribe` field); for the one-click POST it answers 200 with plain text, and for the form it shows the "done" state;
  - the headers are `no-referrer` and `no-store`, and `meta` sets noindex.

  The UI uses C+ tokens and buttons and the `unsubscribe.*` copy in both languages. Route tests cover: GET doesn't change the opt-in, the form POST clears it, the one-click POST with no cookies clears it, a bad token gives the error and no write, and a second POST is still OK.
- [ ] **9. Restoring the cart.**
  - In `services/cart.ts`, move `mergeGuestCart`'s line loop into `mergeCartLines(tx, fromCartId, toCartId)`, so the merge behaviour stays the same and the existing tests still pass.
  - Add `restoreAbandonedCart(userId, cartId, db)`. In one transaction it locks the abandoned cart, checks it is the user's, still `abandoned` and `restored_at IS NULL`, gets or creates the active cart, runs `mergeCartLines`, brings the promo code along if the active cart has none, runs `markCartRestored` (raw SQL, `updated_at` kept) and `touchCart`. It returns `{ ok: true } | { ok: false, error: "not-restorable" }`.
  - `getCartView` for a user adds `restorable: { cartId, abandonedAt, itemCount } | null` (`findRestorableCart`), and the DTO gets the type in `~/lib/cart`.
  - `routes/cart.tsx`: the loader redirects a guest with `restore=1` to `pathFor(locale, "login")?redirectTo=<cart URL with its query>`. Add a `restore` intent to the cart action schema in `app/lib/cart.schema.ts`. Add `features/cart/RestoreCartBanner.tsx` with the `cart.restore.*` copy (`formatDate` for the date).

  Tests cover: restore into no active cart and into an existing one (quantities capped, sold-out sizes dropped), a second restore refused, another user's cart refused, the banner hidden after restore and after an order, and the guest redirect keeping the UTM tags.
- [ ] **10. The user's language.** Add `setUserLocale(db, userId, locale)` in `db/queries/users.ts`. Call it from `onUserAuthenticated` (with the locale of the request, `getLocale(request)`) and in `createOrder` for a logged-in buyer, where `setUserCity` is called. Tests check that the queued reminder uses `users.locale`, falls back to the latest order email's locale, then `uk`.
- [ ] **11. Docs.**
  - `docs/email.md`: a "Cart reminders" section covering the rules, the hourly cron `pnpm db:send-cart-reminders`, `EMAIL_UNSUBSCRIBE_SECRET`, how one-click unsubscribe works, and how to check it in smtp4dev. It also has the recovery-rate SQL: reminded (`order_emails` `cart_reminder` `sent`) → non-cancelled order by the same user within 7 days of `sent_at`, overall and by `date_trunc('week', sent_at)`; restores (`carts.restored_at`); and the campaign query on `sessions.traffic_campaign = 'abandoned_cart'`.
  - `app/.server/AGENTS.md`: update the Order email outbox, Abandoned carts, Cart and `users.marketing_opt_in` ("nothing sends marketing email yet" is no longer true) entries.
- [ ] **12. Verify.** Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, then the manual checks below.

## Testing & verification

- Unit tests: `unsubscribe-token.test.ts`, `layout.test.ts` (products block, footer link), `cart-reminder-email.test.ts`, `order-email.test.ts` (cart reminder branch, merged headers, not-eligible), `env.test.ts`, `robots` test, `client-bundle.guard.test.ts` still green (the new schema stays in `*.schema.ts`).
- DB integration tests (`describe.skipIf(!hasDatabase)`, `createTestDatabase()`): `cart-reminders.test.ts` (queries and job), `cart.test.ts` (restore, merge refactor), `marketing.test.ts`, `unsubscribe` route test.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual check under `pnpm aspire run`:
  1. Register with the marketing box ticked and add two perfumes to the cart. Set the cart's `updated_at` back 25 h in SQL and run `pnpm db:mark-abandoned-carts`, then `pnpm db:send-cart-reminders`.
  2. In smtp4dev, check the email: the items, photos, total, button URL and the language (repeat in English). Check the `List-Unsubscribe` and `List-Unsubscribe-Post` headers.
  3. Run the job again: no second email.
  4. Click the button while logged out: login, then back on the cart with the banner. Click "Restore": the lines are back.
  5. Check `sessions.traffic_campaign = 'abandoned_cart'` (with cookies accepted).
  6. Open the unsubscribe link: confirm, then check `marketing_opt_in = false`. Run `curl -X POST -d "List-Unsubscribe=One-Click" <url>`: answers 200.
  7. Run the recovery-rate query from `docs/email.md`.

## Acceptance criteria

- [ ] An abandoned cart of a user with marketing consent gets one reminder email with its items and a link back to the cart — steps 1, 3, 5, 6, 7, 9
- [ ] Users without consent, users who ordered since, and users reminded in the last 7 days get nothing — steps 3, 6 (re-check at send time)
- [ ] Every reminder has a working one-click unsubscribe — steps 2, 4, 5, 6, 8
- [ ] Visits from the email are attributed to the `abandoned_cart` campaign, and the recovery rate can be queried — steps 5, 9 (UTM kept through login), 11
- [ ] Emails are in the customer's language — steps 5, 10
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 12

## Out of scope

- A series of reminders, SMS/Viber, and browse-abandonment emails (excluded by the issue).
- A promo code in the reminder, and A/B testing one (later).
- Reminders to guests: their email is only known after checkout.
- A newsletter or other marketing emails, which could reuse the unsubscribe token and page later.
- Quiet hours and send-time optimisation.
- Brevo-side list management: unsubscribing is handled in the app (`marketing_opt_in`), not with Brevo contact lists.
