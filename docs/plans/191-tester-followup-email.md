# Plan: Email tester buyers a personal discount on a full bottle of the perfumes they tried (#191)

Issue: https://github.com/savchukolgaa/jassmin/issues/191
Branch: `issue/191`
Worktree: `.claude/worktrees/issue-191`
Status: Planned

## Goal
Customers who bought testers (10 ml) and agreed to marketing email get one email about
`TESTER_FOLLOWUP_DAYS` (12) days after delivery: "Який аромат вам сподобався?", with a card per
perfume they tried and a personal, single-use code for `TESTER_FOLLOWUP_PERCENT` (10) % off a full
bottle (30/50/100 ml) of those perfumes, valid 30 days. A daily job queues and sends it through
the existing `order_emails` outbox, the link opens the product page and the code is applied in the
cart, and the redeemed discount's slug (`tester-followup-*`) measures the effect for #183.

## Dependencies & prerequisites
All present on `origin/main`:
- Order lifecycle timestamps `orders.shipped_at`, `arrived_at`, `completed_at`, `returned_at`,
  `cancelled_at` and `order_status_history` (#128, #138). The Nova Poshta tracking job (#137) was
  closed as not planned: staff set `arrived`/`completed` in Strapi, so the shipped + 3 days
  fallback matters.
- `order_emails` outbox, `deliverOrderEmails`, the not-eligible re-check and the cart reminder job
  as the pattern (#45, #139: `app/.server/db/cart-reminders.ts`,
  `app/.server/db/queries/cart-reminders.ts`, `app/.server/services/cart-reminder-email.ts`).
- Marketing rules: `users.marketing_opt_in`, `email_verified_at` (#135), `email_suppressions`
  (#134), `listUnsubscribeHeaders` / `unsubscribeUrl` / `photoOf` in `app/.server/email/marketing.ts`
  and `EMAIL_UNSUBSCRIBE_SECRET` (#139).
- Newsletter deliveries for spacing (`newsletter_deliveries.sent_at` / `status`, #181).
- Discounts with code, product/volume/pack scopes, `ends_at`, `max_redemptions` and
  `redeemDiscount` (#59); `applyPromoCode` in `app/.server/services/cart.ts`.
- Scheduler `deploy/crontab` and `aspire-apphost/production.mts` (#176); Aspire dev apphost.

New: one migration (rewrites `order_emails_type_check`), two optional env variables
(`TESTER_FOLLOWUP_DAYS`, `TESTER_FOLLOWUP_PERCENT`), one pnpm script. No new packages.

## Decisions & assumptions
- **Tester line** = an `order_items` line whose variant is `volume_ml = 10` on a `pack_size = 1`
  product (the 3 × 10 ml set product, `pack_size = 3`, doesn't say which perfumes were in it).
  **Full bottle** = `volume_ml in (30, 50, 100)`, `pack_size = 1`.
- **Delivery date** = `coalesce(completed_at, arrived_at, shipped_at + interval '3 days')`, for
  orders in status `shipped` or `completed` with `returned_at is null` (so `cancelled`,
  `returned`, `unclaimed` and `pending`/`paid` are out). `completed_at` (picked up / cash
  collected) is the truest "delivered"; `arrived_at` (at the branch) next.
- **Due window:** delivered between `now − (TESTER_FOLLOWUP_DAYS + TESTER_FOLLOWUP_WINDOW_DAYS)`
  and `now − TESTER_FOLLOWUP_DAYS`, `TESTER_FOLLOWUP_WINDOW_DAYS = 14` (a constant, like
  `CART_REMINDER_MAX_AGE_HOURS`). An order held back by the spacing rules is retried daily inside
  the window, and launching the job never emails months-old orders.
- **Eligibility** (one SQL statement, `findTesterFollowupCandidates`):
  registered user (`orders.user_id` not null), `marketing_opt_in`, `email_verified_at is not null`,
  not in `email_suppressions`; no `tester_followup` row for the order yet; no `tester_followup`
  row for any of the user's orders created in the last 30 days (any status); no cart reminder in
  the last 7 days (`carts.reminder_sent_at`, set at queue time, so pending ones count) and no
  newsletter delivery sent in the last 7 days or still `queued`; no order (not `cancelled`) placed
  after the tester order with a full-bottle line of any tried perfume (Q1: confirmed); at
  least one tried perfume still `active` with a full-bottle size in stock (`availableStock > 0`,
  untracked counts as in stock). `distinct on (user_id)` picks the user's latest due order, so
  one user never gets two in a run. Batch limit 100.
- **Queuing**, one transaction per order (`queueTesterFollowup`): insert the discount
  (`slug = tester-followup-<orderId>` – unique, so a concurrent run fails cleanly; `kind
  'percent'`, `value = TESTER_FOLLOWUP_PERCENT`, `code` = `TRY-` + 8 characters from
  `GIFT_CARD_CODE_ALPHABET` with a retry on the code's unique index, `scope_product_public_ids` =
  the still-available tried perfumes, `scope_volumes_ml = [30, 50, 100]`, `scope_pack_size = 1`,
  `max_redemptions = 1`, `starts_at = now`, `ends_at = now + 30 days`) and the `order_emails` row
  (`order_id`, `type 'tester_followup'`, `locale = coalesce(users.locale, 'uk')`,
  `on conflict do nothing`; if nothing was inserted, roll back). The email finds its discount by
  slug, so no new column.
- **Personal** means a unique random code with one redemption; it isn't tied to the account
  (Q2: confirmed). One discount per order still applies (`priceCart` picks the best).
- **Send-time re-check** (`testerFollowupNotEligible`, like `reminderNotEligible`): unsubscribed,
  unverified, order now cancelled/returned/unclaimed, a bottle bought since, the discount gone,
  inactive or expired, or no tried perfume with a full size in stock → `failed` with
  `not eligible: …`. Sold-out perfumes are dropped from the cards at send time too; suppression is
  already handled by `withSuppressions` / `SuppressedRecipientError`.
- **Spacing only constrains the follow-up**: cart reminders and newsletters don't wait for it (Q3: confirmed).
- **Email** (`services/tester-followup-email.ts`, `composeEmail` blocks like the cart reminder):
  greeting, "Який аромат вам сподобався?" intro, a `products` block (one card per perfume:
  `photoOf(imageUrl)`, brand + title, "from <lowest full-size price>", and `url` = the product
  link, which `EmailProduct.url` (#181) already makes clickable and writes out in the text part),
  a "Choose a bottle" button to the first perfume's link, a `code` block with the code, the
  percent and the expiry (`formatDate(endsAt)`). Footer with `unsubscribeUrl` and `listUnsubscribeHeaders`. Links:
  `${PUBLIC_SITE_URL}${productHref(locale, product)}?code=<CODE>&utm_source=email&utm_medium=email&utm_campaign=tester_followup`.
- **`?code=` flow:** applying a code to a cart without a full bottle fails (`applyPromoCode` only
  stores a code that applies now), so the product page carries the code into "add to cart": the
  product loader parses `?code=` with `promoCodeSchema` (invalid → ignored) and returns it; the
  page shows a short note ("Ваш код … застосується в кошику") and `AddToCartForm` posts it as a
  hidden `promoCode`. The cart `add` intent gets `promoCode: promoCodeSchema.optional().catch(undefined)`;
  after a successful add the action calls `applyPromoCode` (rate-limited by `promoCodeLimiter`
  like `apply-promo`; a refusal never fails the add, the result carries `promo: <status|error>`).
  The cart page's loader also reads `?code=` and pre-fills `PromoCodeForm`, so a code link to the
  cart works too. The product redirect for old slugs already keeps the query.
- **Analytics:** no new `user_events` type (it would change the event contract and the synthetic
  generator, #129/#131). The "event" is the `order_emails` row (`type = 'tester_followup'`,
  `sent_at`) plus the discount slug on `orders.discount_id`; `docs/analytics-events.md` documents
  that and the conversion SQL.
- Not adding `TESTER_FOLLOWUP_WINDOW_DAYS` or the 30/7-day spacing as env variables: constants
  next to the query, like the cart reminder's.

## Open questions
All three answered on 2026-11-25: use the recommended defaults.
- [x] **Q1: When the customer already bought a bottle of one of several tried perfumes, skip the whole email or just drop that perfume?** — Why it matters: the issue says "hasn't ordered a full bottle of any of those perfumes since", which reads as skipping; dropping would still offer the others. Recommended default: skip the whole email (literal reading; the customer already converted). Affects steps: 3, 4.
- [x] **Q2: Should the code work only for the customer's own account?** — Why it matters: "personal" could mean bound to `user_id`, which needs a `discounts.user_id` column and a check in `priceCart`/`applyPromoCode`/checkout. Recommended default: no binding; a unique random code with `max_redemptions = 1` (forwarding it to a friend is harmless and still a sale). Affects steps: 2, 4.
- [x] **Q3: Should cart reminders and newsletters also hold off for 7 days after a tester follow-up?** — Why it matters: the issue only constrains the follow-up; a reminder could still land a day after it. Recommended default: no (reminders are time-sensitive, newsletters are staff-triggered to everyone); revisit if it shows up in practice. Affects steps: 3.

## Resolved questions
- **Is there a "delivered" date?** — No single column; `completed_at`, `arrived_at` (set by staff in Strapi) and `shipped_at` exist, and the tracking job #137 was closed as not planned. Hence the `coalesce` with shipped + 3 days (source: `app/.server/db/schema.ts` orders, `gh issue view 137`).
- **Can `order_emails` hold one follow-up per order?** — Yes: `order_emails_order_id_type_unique` on `(order_id, type)` and `order_id` is the target; only `order_emails_type_check` needs the new type (source: `app/.server/db/schema.ts`, `app/.server/AGENTS.md` → Order email outbox).
- **Do discounts support the offer?** — Yes: `percent` with `scope_product_public_ids`, `scope_volumes_ml`, `scope_pack_size`, `ends_at`, `max_redemptions` (source: `app/.server/db/schema.ts` discounts, `app/.server/AGENTS.md` → Discounts).
- **Does the cart support `?code=`?** — No; only the `apply-promo` intent, and a code is stored only if it applies to the cart now, so it must be applied after the bottle is added (source: `app/routes/cart.tsx`, `applyPromoCode` in `app/.server/services/cart.ts`).
- **Which locale?** — `users.locale`, else `uk`, as the issue says; the queue uses `coalesce(users.locale, 'uk')` (cart reminders add the last order email's locale in between, `queueCartReminders`, but the issue is explicit) (source: #191).
- **Is the newsletter spacing data available?** — Yes: `newsletter_deliveries.sent_at` and `status = 'queued'` (source: `app/.server/db/schema.ts`, #181).
- **What sets a job's environment?** — `parseMailEnv` (`mailEnvSchema`), not `getEnv()`; production values go in the env loop of `aspire-apphost/production.mts` (source: `app/.server/AGENTS.md` → Environment, `aspire-apphost/AGENTS.md`).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | add `tester_followup` to `ORDER_EMAIL_TYPES` |
| create | `app/.server/db/migrations/0038_tester_followup_email.sql` (+ `meta/`) | rewrite `order_emails_type_check` |
| create | `app/.server/db/rollbacks/0038_tester_followup_email.sql` | restore the old check |
| modify | `app/.server/db/schema.test.ts` | type check expectations if they list types |
| modify | `app/.server/env.ts`, `app/.server/env.test.ts`, `.env.example` | `TESTER_FOLLOWUP_DAYS` (1–60, default 12), `TESTER_FOLLOWUP_PERCENT` (1–50, default 10) in `mailEnvSchema` |
| create | `app/.server/db/queries/tester-followups.ts` (+ `.test.ts`) | `findTesterFollowupCandidates`, `queueTesterFollowups`, `findTesterFollowup` |
| create | `app/.server/services/tester-followup-email.ts` (+ `.test.ts`) | `buildTesterFollowupEmail`, `testerFollowupUrl`, `TESTER_FOLLOWUP_UTM` |
| modify | `app/.server/services/order-email.ts` (+ `.test.ts`) | `loadTesterFollowup` dep, `buildTesterFollowup`, not-eligible re-check, label |
| create | `app/.server/db/tester-followups.ts` (+ `.test.ts`) | `sendTesterFollowupsJob` (config check, queue, deliver) |
| create | `app/.server/db/scripts/send-tester-followups.ts` | CLI wrapper |
| modify | `package.json` | `db:send-tester-followups` |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `testerFollowupEmail.*`, product page code note, cart promo result copy |
| modify | `app/lib/cart.schema.ts`, `app/lib/cart.ts`, `app/routes/cart.tsx` (+ `cart.test.ts`) | `promoCode` on `add`, apply after adding, `?code=` prefill |
| modify | `app/routes/product.tsx`, `app/features/product/ProductPurchase.tsx`, `app/features/cart/AddToCartForm.tsx`, `app/features/cart/PromoCodeForm.tsx` | carry the code into add-to-cart, show the note |
| modify | `deploy/crontab` | daily run |
| modify | `aspire-apphost/apphost.mts`, `aspire-apphost/production.mts`, `aspire-apphost/AGENTS.md` | `db-send-tester-followups` resource; production values |
| modify | `docs/email.md`, `docs/setup.md`, `docs/analytics-events.md`, `README.md` (env table if it lists them), `app/.server/AGENTS.md` | documentation |
| check | `app/lib/i18n/uk.ts`/`en.ts` privacy copy (`privacy.*`) | marketing-email wording still covers it |

## Steps
- [x] **1. Email type and migration** — Add `"tester_followup"` (comment: #191, target `order_id`) to `ORDER_EMAIL_TYPES`; `pnpm db:generate` a migration that drops and re-adds `order_emails_type_check`, plus a rollback that deletes `tester_followup` rows and restores the old check. Fix any exhaustive switch/record over `OrderEmailType` (`ORDER_STATUS_BUILDERS`, `GIFT_CARD_BUILDERS` narrowing in `buildEmail`, CMS/Strapi mappings – grep `OrderEmailType`). Check: `pnpm typecheck`, migrator tests.
- [x] **2. Env variables** — `TESTER_FOLLOWUP_DAYS` and `TESTER_FOLLOWUP_PERCENT` in `mailEnvSchema` (and `parseMailEnv`'s source mapping, `|| undefined` like `NEWSLETTER_DAILY_LIMIT`), `.env.example`, `env.test.ts` cases (defaults, bounds).
- [x] **3. Eligibility query** — `app/.server/db/queries/tester-followups.ts`: constants (`TESTER_FOLLOWUP_WINDOW_DAYS = 14`, `TESTER_FOLLOWUP_INTERVAL_DAYS = 30`, `MARKETING_GAP_DAYS = 7`, `TESTER_FOLLOWUP_VALID_DAYS = 30`, `TESTER_FOLLOWUP_BATCH_SIZE = 100`, `TESTER_VOLUME_ML = 10`, `FULL_BOTTLE_VOLUMES_ML = [30, 50, 100]`) and `findTesterFollowupCandidates(db, { days, now? })` – one SQL statement with every rule in Decisions, returning `{ orderId, userId, locale, productPublicIds }` (the tried perfumes still active with a full size in stock). Integration tests with `test-utils.ts`: consent, unverified, suppressed, guest, not delivered / pending, cancelled, returned, unclaimed, too early / too late (window), shipped-only fallback (+3 days), bottle bought since (and a cancelled bottle order doesn't count), 30-day per-user spacing, 7-day gap after a cart reminder and after a newsletter (sent and queued), sold-out perfume dropped, all sold out → no row, the set product (`pack_size 3`) ignored, one row per user.
- [x] **4. Queue** — `queueTesterFollowups(db, { days, percent, now?, generateCode? })`: for each candidate, `db.transaction`: insert the discount (retry the code on a `discounts_code_unique` conflict, as gift cards do), insert the `order_emails` row `on conflict do nothing returning id`; nothing returned → throw a sentinel and roll back. Return the queued order ids. `findTesterFollowup(db, orderId)`: user (name, email, opt-in, verified), order status / `returned_at`, `boughtBottleSince`, the discount by slug (code, value, `ends_at`, active, `redemption_count`), and the products in its scope with `public_id`, slug, brand, title, `image_url`, lowest available full-size price, in stock. Tests: discount scope/volumes/pack/`max_redemptions = 1`/`ends_at = +30 d`/percent from the option; running twice queues once; concurrent runs (two `queueTesterFollowups` in parallel) queue once.
- [x] **5. Email** — `services/tester-followup-email.ts`: `TESTER_FOLLOWUP_UTM` (`email`/`email`/`tester_followup`), `testerFollowupUrl(siteUrl, locale, product, code)` via `productHref`, `buildTesterFollowupEmail(followup, translator, env, links)` with `composeEmail` (blocks per Decisions), subject "Який аромат вам сподобався?" / "Which one did you like?", `formatPrice` / `formatDate` from the translator, footer `unsubscribeUrl`, `headers: listUnsubscribeHeaders(url)`. i18n keys `testerFollowupEmail.*` in both files. Tests (pattern: `cart-reminder-email.test.ts`): uk and en copy, one card per available perfume, sold-out dropped, the code, percent and expiry date, link with `?code=` and UTM tags, unsubscribe URL in footer and `List-Unsubscribe` / `List-Unsubscribe-Post` headers, HTML and text parts.
- [x] **6. Outbox wiring** — `order-email.ts`: `loadTesterFollowup(orderId)` in `OrderEmailDeps`/`orderEmailDeps`, `testerFollowupNotEligible(followup, now)` and `buildTesterFollowup` (same env guard as `buildCartReminder`), branch in `buildEmail` before the status-email check; `deliverOne`'s label already covers orders. Tests in `order-email.test.ts` with injected deps: sends, each not-eligible reason marks `failed` final, suppressed recipient, headers merged with the bounce tag.
- [x] **7. Job and script** — `app/.server/db/tester-followups.ts`: `sendTesterFollowupsJob(db, mailer, env)` mirroring `sendCartRemindersJob` (missing `SMTP_URL`/`PUBLIC_SITE_URL`/`EMAIL_UNSUBSCRIBE_SECRET` → queues nothing), then `deliverOrderEmails({ type: "tester_followup" }, …)`; must not import `db/index.ts`. `db/scripts/send-tester-followups.ts` copied from `send-cart-reminders.ts`; `package.json` `"db:send-tester-followups"`. Test the job like `cart-reminders.test.ts` (smtp-less, configured, message).
- [x] **8. `?code=` in the cart** — `cart.schema.ts`: optional `promoCode` on `add`; `cart.ts` (`CartActionResult`): optional `promo` on the `add` success; `cart.tsx` action: after a successful add with a code, rate-limit check, `applyPromoCode`, `promoCodeLimiter.hit` on refusal, return the status; cart loader: `code` from `?code=` (parsed with `promoCodeSchema`, invalid → `null`) for `PromoCodeForm`'s default value. `product.tsx` loader returns `promoCode` (parsed the same way); `ProductPurchase`/`AddToCartForm` render a hidden `promoCode` input and a note under the button; after adding, the "Added to cart" status says the code was applied (or why not). Tests: `cart.test.ts` (add with a valid code applies it, an inapplicable or unknown code still adds, malformed code ignored, rate limit), `AddToCartForm.dom.test.ts` (hidden field), product loader test if one exists.
- [ ] **9. Scheduling** — `deploy/crontab`: `0 7 * * * pnpm --silent db:send-tester-followups` (10:00 Kyiv, a sensible hour to receive it; comment #191). `aspire-apphost/apphost.mts`: explicit-start `db-send-tester-followups` child of `jassmindb`, after `db-migrate`, `SMTP_URL` from `smtp4dev`, as `db-send-cart-reminders`. `production.mts`: `TESTER_FOLLOWUP_DAYS=12`, `TESTER_FOLLOWUP_PERCENT=10` in the web/scheduler env loop. Check: `pnpm aspire run` shows the resource and it sends to smtp4dev.
- [ ] **10. Documentation** — `docs/email.md`: new "Tester follow-up" section (who, when, spacing, the offer, the job, local testing) and contents entry; `docs/setup.md`: env table rows, job table row, short section; `aspire-apphost/AGENTS.md`: resource and env; `app/.server/AGENTS.md`: Environment, outbox type list, marketing-email list (#191 is the third), Cart `?code=`; `docs/analytics-events.md`: "Tester follow-up (#191)" with the `order_emails`/slug definition and SQL "follow-up sent → full-bottle order of a tried perfume within 30 days" (overall, and how many used the code: `orders.discount_id` → `discounts.slug like 'tester-followup-%'`); re-read the privacy copy (`privacy.*`) and adjust only if it names the marketing emails individually.
- [ ] **11. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; run the analytics fixture tests only if the order-email enum is part of their contract (step 1 grep). Manual check under Aspire: seed a user with `marketing_opt_in` and a verified email, a completed tester order with `completed_at` 12 days ago, start `db-send-tester-followups`, open the email in smtp4dev, follow a link, add a 50 ml bottle and see the code applied in the cart.

## Testing & verification
- Unit/integration: steps 3–8 as listed (eligibility matrix, one email per order, discount scope/single use/expiry, sold-out drop, locale, unsubscribe headers, `?code=` link and cart application, job configuration).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: Aspire run with smtp4dev (step 11), both locales (a user with `locale = 'en'`).

## Acceptance criteria
- [ ] About 12 days after a tester order is delivered, an opted-in customer gets exactly one email with the perfumes they tried — steps 1, 3, 4, 5, 6, 7
- [ ] The email has a personal code for 10 % off a full bottle (30/50/100 ml) of those perfumes, single-use and valid for 30 days — steps 2, 4, 5
- [ ] No email goes to guests, customers without consent, suppressed addresses, cancelled or returned orders, or customers who already bought a bottle of those perfumes — steps 3, 6
- [ ] Marketing emails are spaced: at most one follow-up per 30 days, and none within 7 days of another marketing email — step 3
- [ ] The link opens the product with the code applied in the cart — steps 5, 8
- [ ] The job runs daily in production and from the Aspire dashboard — steps 7, 9
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 11

## Out of scope
- Guest buyers, several follow-up emails, a rating question, A/B testing the discount (per the issue).
- Binding the code to the account (Q2) and making other marketing emails wait for the follow-up (Q3).
- A new `user_events` event type; the dashboard itself (#183).
- Showing the follow-up discount in Strapi or an admin UI for discounts.
