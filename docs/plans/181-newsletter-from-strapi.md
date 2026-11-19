# Plan: Write and send a newsletter from Strapi to customers who opted in (#181)

Issue: https://github.com/savchukolgaa/jassmin/issues/181
Branch: `issue/181`
Worktree: `.claude/worktrees/issue-181`
Status: Planned

## Goal

The store owner writes a newsletter (uk and en) in Strapi, with up to 4 featured products, sends a
test to their own address, and then presses "send" once. The app queues one delivery for each
customer who opted in to marketing email, has a verified address and isn't suppressed, in their own
language. A scheduled job sends the deliveries in batches through the existing mail setup, within a
daily limit, with the existing one-click unsubscribe. Strapi shows the status and counts.

## Dependencies & prerequisites

All on `origin/main`:

- `users.marketing_opt_in` (#54), `users.email_verified_at` (#135), `users.locale` (#139).
- `email_suppressions` and `withSuppressions` / `getMailer()` (#134); `/hooks/email` records
  bounces by address, whatever the `X-Mailin-custom` tag (`webhook-brevo.test.ts` already treats a
  `newsletter:3` tag as unknown and still suppresses).
- Unsubscribe token, page `/vidpysatysia/:token`, `listUnsubscribeHeaders`, `unsubscribeUrl`,
  the `products` email block and `photoOf` (#139, `services/cart-reminder-email.ts`).
- `composeEmail` / `renderEmail` with `preheader` and `footer.unsubscribeUrl` (#134, `email/layout.ts`).
- Strapi write-through (`checkCmsSyncAuth`, `postToApp`, `describeAppSyncError`) and the
  `cms_outbox` push (#40, `services/cms-push.ts`).
- The production scheduler (`deploy/crontab`, #176) and Aspire 17 (#184).
- `resolveTrafficAttribution` already stores `utm_source=newsletter` as `sessions.traffic_source =
  'newsletter'` (`app/lib/analytics.ts`, tested in `analytics.test.ts`), and the warehouse passes
  `traffic_source` through lowercased (`stg_sessions.sql`).

New: migration `0033_newsletters` (+ rollback), env var `NEWSLETTER_DAILY_LIMIT`, the
`api::newsletter.newsletter` Strapi type, and the first Strapi admin extension (`cms/src/admin/app.tsx`).
No new packages (`marked` is already used by `markdown.ts`).

## Decisions & assumptions

- **Content travels in the send request.** Strapi's send handler reads the newsletter (both
  locales, products populated) and POSTs the whole content to the app's
  `/cms/newsletters/:documentId/send`. The app stores a snapshot in `newsletters`, so later Strapi
  edits can't change what's still queued, and the job never calls Strapi to send.
- **Strapi field names:** Strapi reserves `status`, so the read-only fields are `newsletterStatus`
  (`draft | sending | sent`), `queuedCount`, `sentCount`, `failedCount`, `skippedCount` and
  `sentAt` (same convention as `orderStatus`, `app/.server/AGENTS.md` → CMS sync). Draft & Publish
  is off (saving is enough; nothing is ever published to the site).
- **Products:** a non-localized relation to `api::product.product`; the send handler sends their
  `publicId`s, the app validates at most 4, unique UUIDs. Cards are rendered **when each email is
  sent** (current price and photo; an archived or sold-out product is left out), reading
  `listProductSummariesByPublicIds` directly (the job must not import `services/products.ts`,
  which imports `db/index.ts`).
- **Price on a card:** "від <lowest available size price>", the same "from" price as the shop's
  product cards, formatted with the delivery locale's `formatPrice`.
- **Language:** a delivery's `locale` is the language of the email it gets: `users.locale ?? 'uk'`,
  then `'uk'` when the newsletter has no en version. The email's chrome (footer, buttons) uses the
  same language.
- **Recipients** are chosen in SQL at send time, in the same transaction that inserts the
  newsletter: `marketing_opt_in` and `email_verified_at is not null` and no
  `email_suppressions` row for `lower(email)`. **Before each email** the job reads the user again
  and marks the delivery `skipped` (with the reason in `error`) when the opt-in was withdrawn or
  the address got suppressed; `withSuppressions` is the backstop.
- **One send per newsletter:** `newsletters.strapi_document_id` is unique; a second send answers
  `already-sent` (from the pre-check or `23505`).
- **Weekly rule:** a send is refused with `too-soon` (and the next allowed time) when another
  newsletter's `sent_at` (when it was queued) is less than 7 days ago, and with `another-sending`
  while one is still `sending`. Two simultaneous presses are serialized with
  `pg_advisory_xact_lock` on a fixed key inside the send transaction.
- **No recipients:** a send with zero eligible customers is refused (`no-recipients`) so it doesn't
  use up the week.
- **Daily limit:** `NEWSLETTER_DAILY_LIMIT` caps newsletter emails attempted in the **last 24
  hours** (rolling window, so no calendar day can exceed it, whatever timezone Brevo resets in).
  Each run sends `limit − attempted in the last 24 h`, at most. The default is **200**, leaving ~100 a day of Brevo's
  free 300 for transactional mail.
- **Delivery queue:** the same lease as `claimOrderEmails` (`UPDATE … WHERE id IN (… FOR UPDATE
  SKIP LOCKED)`, counting `attempts`, moving `next_attempt_at`), so concurrent runs never share a
  row. A send error retries up to 3 attempts (delays 15 min, 60 min) and then becomes `failed`;
  `SuppressedRecipientError` becomes `skipped` at once. Delivery is at least once.
- **Status:** the app stores `sending` from the send and `sent` once no delivery is `queued` (set by
  the job, with `completed_at`). `draft` exists only in Strapi.
- **Counts back to Strapi** through `cms_outbox` (new entity `newsletter`, keyed by the Strapi
  `documentId`): queued in the send transaction and by every job run that changed a newsletter's
  deliveries. Pushed with `STRAPI_SYNC_TOKEN` as a `PUT newsletters/<documentId>` (token writes
  pass the document middleware untouched).
- **Locked after sending:** the Strapi document middleware keeps staff from changing the read-only
  fields (it restores the stored values) and refuses update and delete once `newsletterStatus` isn't
  `draft`; a clone starts as a fresh `draft` with zero counts and a new slug.
- **Test send** goes only to the Strapi admin user who pressed it (their admin email, taken from the
  admin session on the Strapi side, never from the browser), once per available language, with
  `[Тест]` / `[Test]` before the subject. It creates no deliveries, isn't counted, ignores the weekly
  rule and the daily limit, and goes through `getMailer()` (a suppressed address still gets
  nothing). Its unsubscribe link is signed for the shop user with that email when there is one,
  otherwise left out (the headers too). Sent synchronously, so the admin sees success or the error.
- **Body:** Strapi `richtext` is Markdown. A new `email/markdown.ts` turns it into email blocks with
  `marked`'s lexer, supporting paragraphs, `###`/`####` headings, bullet and numbered lists, bold,
  italic and links; images, HTML and code are dropped (product cards carry the photos). Two new
  `EmailBlock`s keep the "no raw HTML in a block" rule: `rich` (a paragraph of inline runs
  `{ text, strong?, em?, href? }`) and `list` (`ordered`, items of runs). `renderEmail` escapes and
  inline-styles them; the text part writes a link as `text (url)`.
- **UTM:** every link to the shop (relative links, and absolute ones on `PUBLIC_SITE_URL`'s origin)
  in the body, the product cards and the "to the shop" button gets
  `utm_source=newsletter&utm_medium=email&utm_campaign=<slug>` (existing `utm_*` replaced). External
  links, `mailto:`/`tel:` and the unsubscribe link are left alone.
- **Slug** (the campaign): Strapi `uid` from the uk subject, non-localized, validated by the app as
  `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 80 characters (it goes into `utm_campaign`, which
  `utmParam` cuts at 100 and lowercases).
- **Tagging:** each email carries `X-Mailin-custom: newsletter:<delivery id>` (merged with the
  unsubscribe headers, like `deliverOne`), for tracing in Brevo. Bounces need no change: the webhook
  suppresses by address. Mapping a bounce back to the delivery is out of scope.
- **Sender:** `ORDER_FROM ?? CONTACT_FROM`, `Reply-To: CONTACT_INBOX`, like the cart reminder.
- **Config:** the send route refuses with 503 `mail-not-configured` without SMTP,
  `PUBLIC_SITE_URL` or `EMAIL_UNSUBSCRIBE_SECRET` (nothing queued), and the job logs the same and
  sends nothing, like `sendCartRemindersJob`.
- Shared unsubscribe helpers (`unsubscribeUrl`, `listUnsubscribeHeaders`, `photoOf`) move from
  `cart-reminder-email.ts` to `email/marketing.ts` and are re-imported by the reminder, so both
  marketing emails use one implementation.

## Resolved questions

- **Default `NEWSLETTER_DAILY_LIMIT`?** — 200, leaving ~100 a day of Brevo's free 300 for order,
  status, reminder and auth emails; production sets it explicitly. (source: owner, 2026-11-19)
- **When does the 7-day rule start?** — From when the previous newsletter was queued (send
  pressed); a send is also refused while the previous one is still `sending`. (source: owner,
  2026-11-19)
- **Lock a sending or sent newsletter in Strapi?** — Yes: edits and deletes are refused once it
  isn't `draft`; staff clone it to reuse it. (source: owner, 2026-11-19)
- **Does the test send both languages?** — Yes, one email per language the newsletter has.
  (source: owner, 2026-11-19)
- **UTM tags on external links?** — No, only links to the shop. (source: owner, 2026-11-19)

- **Does `utm_source=newsletter` show up as `newsletter` in acquisition analytics without changes?**
  — Yes: `resolveTrafficAttribution` stores `utm_source` as `sessions.traffic_source` (and
  `users.first_touch_*` / `acquisition_channel` follow `resolveAcquisitionChannel`); there's a test
  for exactly `?utm_source=newsletter` (`app/lib/analytics.test.ts`), and the warehouse keeps the
  value (`analytics/warehouse/models/staging/stg_sessions.sql`). Only a test with the full newsletter
  tags is added. (source: `app/lib/analytics.ts`)
- **Can Strapi's field be called `status`?** — No, Strapi reserves it; use `newsletterStatus`.
  (source: `app/.server/AGENTS.md` → CMS sync, `orderStatus`)
- **How does a bounce from a newsletter get suppressed?** — `/hooks/email` suppresses by address
  whatever the tag; nothing to add. (source: `app/.server/email/webhook-brevo.ts`,
  `webhook-brevo.test.ts`)
- **Must the job avoid `db/index.ts`?** — Yes, CLI jobs run without the web app's env and use
  `createDb`; the mail env comes from `parseMailEnv`. (source: `app/.server/db/cart-reminders.ts`,
  `app/.server/AGENTS.md` → Database)
- **How is a marketing email made compliant?** — `listUnsubscribeHeaders(url)` plus
  `footer.unsubscribeUrl`, merged headers, opt-in and suppression checks. (source:
  `services/cart-reminder-email.ts`, `app/.server/AGENTS.md` → Database, `users.marketing_opt_in`)
- **Is there an existing Strapi admin extension to add the buttons to?** — No; `cms/src/admin/` has
  only `tsconfig.json`, so this issue adds `cms/src/admin/app.tsx`. (source: `cms/src/admin/`)
- **Rich text format?** — Strapi `richtext` is Markdown, rendered on the site by `renderMarkdown`
  (`marked` + `sanitize-html`). (source: `cms/src/api/offer/content-types/offer/schema.json`,
  `app/.server/markdown.ts`)
- **Does the sync token need new permissions?** — Yes, `find`/`update` on the newsletter type;
  `pnpm cms:seed -- --token` grants missing permissions to an existing token. (source:
  `docs/setup.md` → Content, gift cards note)

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/enums.ts` | `NEWSLETTER_STATUSES`, `NEWSLETTER_DELIVERY_STATUSES`; `newsletter` in `CMS_SYNC_ENTITIES` |
| create | `app/lib/newsletter.ts` | DTO types, `NEWSLETTER_MAX_PRODUCTS`, `NEWSLETTER_INTERVAL_DAYS`, `newsletterUtm(slug)` (isomorphic, no zod) |
| create | `app/lib/newsletter.schema.ts` (+ `.test.ts`) | zod `cmsNewsletterSendSchema` |
| modify | `app/.server/db/schema.ts`, `schema.test.ts` | `newsletters`, `newsletter_deliveries` |
| create | `app/.server/db/migrations/0033_newsletters.sql` (+ meta) | tables, checks, indexes, rewritten `cms_outbox` entity check |
| create | `app/.server/db/rollbacks/0033_newsletters.sql` | reverse |
| create | `app/.server/db/queries/newsletters.ts` (+ `.test.ts`) | insert with recipients, rules, claim, recheck, mark, finish, counts |
| modify | `app/.server/env.ts`, `env.test.ts`, `.env.example`, `README.md` | `NEWSLETTER_DAILY_LIMIT` in `mailEnvSchema` |
| create | `app/.server/email/marketing.ts` | shared `unsubscribeUrl`, `listUnsubscribeHeaders`, `photoOf`, `withUtm` |
| modify | `app/.server/services/cart-reminder-email.ts` | import the shared helpers |
| create | `app/.server/email/markdown.ts` (+ `.test.ts`) | Markdown → `rich` / `heading` / `list` blocks with UTM'd links |
| modify | `app/.server/email/layout.ts`, `layout.test.ts` | `rich` and `list` blocks; `EmailProduct.url` / `price` |
| create | `app/.server/services/newsletter-email.ts` (+ `.test.ts`) | `buildNewsletterEmail` |
| create | `app/.server/services/newsletters.ts` (+ `.test.ts`) | `sendNewsletter`, `sendNewsletterTest`, `deliverNewsletters`, deps factory |
| create | `app/routes/cms.newsletters.$id.send.ts` (+ `.test.ts`) | POST route for Strapi |
| modify | `app/routes.ts` | register the route |
| create | `app/.server/db/send-newsletters.ts` (+ `.test.ts`) | `sendNewslettersJob` |
| create | `app/.server/db/scripts/send-newsletters.ts` | CLI wrapper |
| modify | `package.json` | `db:send-newsletters` |
| modify | `app/.server/services/cms-push.ts` (+ test), `app/lib/cms-sync.ts` | push `newsletter` entities |
| modify | `app/lib/i18n/uk.ts`, `en.ts` | `newsletterEmail.*` |
| create | `cms/src/api/newsletter/**` | content type, controller, services, default + custom routes |
| create | `cms/src/admin/app.tsx` | "Send test to me" / "Send to subscribers" document actions |
| modify | `cms/src/sync/middleware.ts` (+ test) | read-only fields, lock after sending |
| modify | `cms/src/utils/app-sync.ts` (+ test) | Ukrainian messages for the new error codes |
| modify | `cms/src/index.ts` | protected UID, read-only edit metadata, labels |
| modify | `cms/scripts/seed.ts` | sync token permissions for newsletters; a sample draft newsletter |
| modify | `deploy/crontab` | every 15 minutes |
| modify | `aspire-apphost/apphost.mts`, `production.mts` | `db-send-newsletters` resource; `NEWSLETTER_DAILY_LIMIT` |
| modify | `docs/email.md`, `docs/setup.md`, `app/.server/AGENTS.md`, `app/lib/analytics.test.ts` | docs; UTM test |

## Steps

- [ ] **1. Enums, env and shared types.** Add `NEWSLETTER_STATUSES = ["sending", "sent"]`,
  `NEWSLETTER_DELIVERY_STATUSES = ["queued", "sent", "failed", "skipped"]` and `"newsletter"` in
  `CMS_SYNC_ENTITIES` (`app/lib/enums.ts`, `enums.test.ts`). Add `NEWSLETTER_DAILY_LIMIT`
  (`z.coerce.number().int().positive()`, default 200) to `mailEnvSchema` so both `getEnv()` and
  `parseMailEnv` see it; `.env.example`, the README table and `env.test.ts`. Create
  `app/lib/newsletter.ts` with the constants (`NEWSLETTER_MAX_PRODUCTS = 4`,
  `NEWSLETTER_INTERVAL_DAYS = 7`, `NEWSLETTER_MAX_ATTEMPTS = 3`) and `NewsletterContent`,
  `NewsletterCounts`, `NewsletterSendResult` types. Check: `pnpm typecheck`.

- [ ] **2. Schema and migration.** In `db/schema.ts`:
  - `newsletters`: `id` serial, `strapiDocumentId` varchar(64) unique
    (`newsletters_strapi_document_id_unique`), `slug` varchar(80) unique, `subjectUk`,
    `preheaderUk`, `bodyUk` (text, not null except preheader), `subjectEn`, `preheaderEn`,
    `bodyEn` (nullable; a CHECK that `subject_en` and `body_en` are both set or both null),
    `productPublicIds` uuid[] not null default `{}` (CHECK `cardinality <= 4`), `status` (CHECK
    from `NEWSLETTER_STATUSES`), `sentAt` timestamptz not null (queued time), `completedAt`,
    `createdAt`; index on `sent_at`.
  - `newsletter_deliveries`: `id`, `newsletterId` (FK, `on delete restrict`), `userId` (FK users,
    `on delete cascade`), `locale` (CHECK `LOCALES`), `status` (CHECK, default `queued`),
    `attempts` int default 0, `nextAttemptAt` timestamptz default now, `sentAt`, `error`
    (text), `messageId`, `createdAt`; unique `(newsletter_id, user_id)`
    (`newsletter_deliveries_newsletter_user_unique`); indexes `(status, next_attempt_at)` and
    `(sent_at)` (the 24 h count).
  - `pnpm db:generate --name newsletters`, then hand-edit to rewrite `cms_outbox_entity_check` with
    `newsletter`; write `db/rollbacks/0033_newsletters.sql`. Add the new statuses' CHECKs to `schema.test.ts`. Check: `pnpm db:migrate`, `pnpm db:rollback`,
    migrate again; `migrator.test.ts`.

- [ ] **3. Email building blocks.** Move `unsubscribeUrl`, `listUnsubscribeHeaders` and `photoOf`
  to `email/marketing.ts` (cart reminder imports them; its tests stay green) and add
  `withUtm(url, siteUrl, utm)`: resolves relative URLs against `siteUrl`, tags only same-origin
  `http(s)` URLs, replaces existing `utm_*`. Add `rich` and `list` to `EmailBlock` and
  `url?` / `price?` to `EmailProduct` in `email/layout.ts`; render with inline C+ styles, escaped,
  `http(s)` links only (else plain text), text part `text (url)`; tests in `layout.test.ts` with
  `htmlWords` / `words`. Create `email/markdown.ts`: `markdownToEmailBlocks(markdown, linkFn)`
  walks `marked.lexer` tokens (paragraph → `rich`, heading → `heading`, list → `list`,
  blockquote → `rich`, anything else dropped; inline `strong`/`em`/`link`/`text`/`codespan` as
  text; images dropped) and runs every href through `linkFn`. Tests: formatting, nested emphasis,
  links tagged, `javascript:` links dropped to text, HTML tags dropped, empty body.

- [ ] **4. Queries and the send service.** `db/queries/newsletters.ts`:
  - `findNewsletterSendBlock(tx, now)`: the newest newsletter's `sentAt`/`status` → `too-soon`
    (with `nextAllowedAt`) or `another-sending`.
  - `insertNewsletterWithDeliveries(tx, content)`: inserts the newsletter (`status 'sending'`,
    `sent_at = now()`), then `insert into newsletter_deliveries (newsletter_id, user_id, locale)
    select … from users u where u.marketing_opt_in and u.email_verified_at is not null and not exists
    (suppression for lower(u.email))`, locale `case when <has en> and u.locale = 'en' then 'en'
    else 'uk' end`; returns the count.
  - `newsletterCounts(db, id)`, `findNewsletterByDocumentId`.
  `services/newsletters.ts`: `sendNewsletter(documentId, input, deps)` — checks config, then one
  `db.transaction`: `pg_advisory_xact_lock`, already-sent check, send block, insert, zero → throw
  to roll back and return `no-recipients`, `enqueueCmsSync(tx, "newsletter", id)`; after commit
  `void pushToCms()` in the route. `23505` on the document id → `already-sent`.
  `sendNewsletterTest(input, testEmail, deps)` builds the email per language for the staff
  address with the shop user's unsubscribe token when a user has that email, sends through the
  injected mailer, returns `{ sent: n }` or `mail-failed`. Integration tests with
  `createTestDatabase()`: recipient selection (opted out, unverified, suppressed incl. mixed-case
  email, `locale` null / `en` / `en` without an en version), second send refused, 7-day rule
  (6 days refused, 7 days allowed), `another-sending`, `no-recipients` writes nothing, concurrent
  sends produce one newsletter.

- [ ] **5. The delivery job.** `db/queries/newsletters.ts`: `countNewsletterAttemptsSince(db,
  since)` (deliveries whose `sent_at` is in the window, any status except `queued`/`skipped`),
  `claimNewsletterDeliveries(db, limit, now)` (lease: `status = 'queued' and next_attempt_at <=
  now`, ordered by `newsletter_id, id`, `FOR UPDATE SKIP LOCKED`, `attempts + 1`, push
  `next_attempt_at` by the retry delay), `findNewsletterRecipient(db, deliveryId)` (user's name,
  email, current opt-in, verified, suppressed; the newsletter's content), `markDeliverySent` /
  `markDeliveryFailed` / `markDeliverySkipped` (stamp `sent_at` on sent/failed), and
  `finishNewsletters(db)` (sets `sent` and `completed_at` where no `queued` delivery is left,
  returns the ids). `services/newsletters.ts` → `deliverNewsletters(deps)`: budget =
  `NEWSLETTER_DAILY_LIMIT − countNewsletterAttemptsSince(now − 24 h)`; if ≤ 0 log and stop; claim
  that many; per delivery re-check (opted out → `skipped: unsubscribed`, suppressed → `skipped:
  suppressed`, unverified → `skipped: unverified`), load the product summaries once per
  newsletter, build with `buildNewsletterEmail`, send with headers merged with
  `X-Mailin-custom: newsletter:<id>`; `SuppressedRecipientError` → skipped; other errors → back to
  `queued` until `NEWSLETTER_MAX_ATTEMPTS`, then `failed`; then `finishNewsletters` and
  `enqueueCmsSync` for every newsletter touched. It never rejects and returns a report.
  `db/send-newsletters.ts` (`sendNewslettersJob(db, mailer, env)`, missing-config message like
  `sendCartRemindersJob`), `db/scripts/send-newsletters.ts` (copy of the cart-reminder wrapper) and
  `"db:send-newsletters"` in `package.json`; the script also runs `deliverCmsSync` for the queued
  newsletter rows when `STRAPI_SYNC_TOKEN` is set (`parseCmsSyncEnv`), otherwise
  `pnpm db:sync-cms` picks them up. Tests: limit 3 with 5 queued sends 3, a second run the same
  day sends 0, a run 24 h later sends the rest and marks `sent`; unsubscribe after queuing →
  skipped and not mailed; suppressed after queuing → skipped; transient error retried then
  failed; two concurrent runs never send one delivery twice.

- [ ] **6. The newsletter email.** `services/newsletter-email.ts` →
  `buildNewsletterEmail({ newsletter, recipient, products }, translator, env, links)`: the
  greeting, the body blocks (`markdownToEmailBlocks` with `withUtm`), the `products` block (up to
  4 cards: brand + title, "від {price}", photo via `photoOf`, `url` = `productHref` under the
  locale's prefix with UTM), a button to the catalog/home with UTM, the "why you get this"
  paragraph, `subject` and `preheader` from the content, `footer.unsubscribeUrl`, and
  `listUnsubscribeHeaders`. Copy in `newsletterEmail.*` (`uk.ts` source of truth, `en.ts`):
  `greeting`, `productsHeading`, `priceFrom`, `button`, `why`, `testPrefix`. Tests: uk and en parts
  match (`htmlWords`/`words`), every shop link carries the three UTM tags with the slug, the
  unsubscribe URL in the footer and in `List-Unsubscribe` is the same and untagged,
  `List-Unsubscribe-Post` is set, a missing product is left out, HTML in the body is escaped.

- [ ] **7. The send route.** `app/lib/newsletter.schema.ts`: `cmsNewsletterSendSchema` =
  discriminated union on `mode`: `test` (`testEmail`: trimmed, lowercased email) and `send`;
  both with `slug`, `content.uk` (`subject` 1–150, `preheader` ≤ 200 or blank → `null`, `body`
  1–20 000), optional `content.en` (all blank → absent; subject without body refused), and
  `productPublicIds` (≤ 4 unique UUIDs). Errors are message keys/codes, like `~/lib/cms-sync`.
  `routes/cms.newsletters.$id.send.ts`: `checkCmsSyncAuth`, `readJsonBody`, `safeParse` → 422
  `invalid-input` with `toSyncIssues`, then `sendNewsletter` / `sendNewsletterTest`; answers 200
  with `{ status, counts, sentAt }` (send) or `{ sent }` (test), 409 `already-sent` /
  `another-sending`, 422 `too-soon` (`nextAllowedAt`) / `no-recipients`, 503
  `mail-not-configured`, 502 `mail-failed` (test). After a send it calls only `void pushToCms()`;
  the first batch goes out with the next cron run (within 15 minutes), so the daily budget is
  counted in one place. `loader` answers 405. Register in `app/routes.ts`. Tests: auth (401/503),
  every validation rule, each refusal's status and body, a test send calls the mailer only for the
  given address.

- [ ] **8. Push counts to Strapi.** `loadNewsletter(id)` in the cms-push deps (document id,
  status, counts, `sentAt`), `toStrapiNewsletterData` in `~/lib/cms-sync` (`newsletterStatus`,
  `queuedCount`, `sentCount`, `failedCount`, `skippedCount`, `sentAt`), and a `newsletter` branch
  in `pushOne` that `PUT`s `newsletters/<documentId>` (no upsert: the document exists; a 404 is
  logged and the row marked synced). Tests in `cms-push.test.ts`.

- [ ] **9. Strapi content type, handler and middleware.**
  - `cms/src/api/newsletter/content-types/newsletter/schema.json`: collection type, Draft &
    Publish off, i18n localized; `subject` (string, required, max 150, localized), `preheader`
    (string, max 200, localized), `body` (richtext, required, localized), `slug` (uid from
    `subject`, required, regex, not localized), `products` (one-way `manyToMany` relation to
    `api::product.product`, not localized), `newsletterStatus` (enum, default
    `draft`), the four counts (integer, default 0), `sentAt` (datetime); default controller,
    service and router.
  - Custom admin-only routes `POST /newsletter-actions/:documentId/send` and `…/test` (router
    `type: "admin"` if Strapi 5.59 supports it for API routes; otherwise a content-API route with
    `auth: false` and policy `admin::isAuthenticatedAdmin`, which `useFetchClient` satisfies with
    the admin JWT — verify against the running Strapi). The controller loads the document in `uk`
    and `en` with `products` (`publicId`), refuses more than 4 products before calling the app,
    builds the body and calls `postToApp`; for `send`, it then updates `newsletterStatus`, counts
    and `sentAt` from the answer (via `strapi.documents`, so the admin sees them at once). The test
    address is `ctx.state.user.email` (the admin user).
  - `cms/src/sync/middleware.ts`: for `NEWSLETTER_UID` staff edits, restore the read-only fields
    from the stored document on update, reset them on create/clone, and refuse update/delete when
    the stored `newsletterStatus` isn't `draft` with a Ukrainian `ApplicationError`. Tests in
    `middleware.test.ts`.
  - `cms/src/utils/app-sync.ts`: messages for `already-sent`, `too-soon` (with the date in
    Kyiv time), `another-sending`, `no-recipients`, `mail-not-configured`, `mail-failed`, and
    newsletter field hints for `invalid-input`; tests in `app-sync.test.ts`.
  - `cms/src/index.ts`: add the UID to `PROTECTED_UIDS`; make `newsletterStatus`, the counts and
    `sentAt` non-editable with Ukrainian labels and descriptions (`updateEditMetadata`).
  - `cms/scripts/seed.ts`: grant the sync token `find`/`findOne`/`update` on newsletters; seed one
    draft newsletter (uk + en, two products).

- [ ] **10. Admin buttons.** `cms/src/admin/app.tsx`: `bootstrap(app)` registers two document
  actions on the content-manager for `api::newsletter.newsletter` only
  (`app.getPlugin("content-manager").apis.addDocumentAction`): "Надіслати тест собі" (enabled for
  a saved document without unsaved changes) and "Надіслати підписникам" (only while `draft`, with
  a confirmation dialog that states it can't be undone and that sending is paced over days). Both
  call the custom routes with `useFetchClient`, show the result with `useNotification` (the
  Ukrainian message from the error body) and refetch the document. Add `@strapi/admin` types only
  if the CMS build needs them. Check: `pnpm cms:build`, then click both in a local Strapi.

- [ ] **11. Scheduling and Aspire.** `deploy/crontab`: `*/15 * * * * pnpm --silent
  db:send-newsletters` with a comment. `aspire-apphost/apphost.mts`: explicit-start
  `db-send-newsletters` like `db-send-order-emails` (`SMTP_URL` = smtp4dev, `STRAPI_URL` = cms,
  waits for `db-migrate`). `production.mts`: `NEWSLETTER_DAILY_LIMIT` on `web` and `scheduler`
  (plain value `200`). Check: `pnpm aspire run`, start the resource, see the emails in smtp4dev.

- [ ] **12. Analytics check and docs.** Add a test in `app/lib/analytics.test.ts` for a URL with
  `utm_source=newsletter&utm_medium=email&utm_campaign=<slug>` → `{ source: "newsletter", medium:
  "email", campaign: <slug> }`. `docs/email.md`: a "Newsletter" section (writing it in Strapi,
  test, send, the weekly and daily rules, Brevo's free plan and shared budget, unsubscribe and
  bounces, measuring visits and orders by `traffic_campaign`). `docs/setup.md`: the job, the cron
  line, `NEWSLETTER_DAILY_LIMIT`, the sync token permission, the Aspire resource.
  `app/.server/AGENTS.md`: Database (tables, rules, lease) and mail (new blocks, shared marketing
  helpers; the newsletter is now marketing email besides the cart reminder). Update
  `docs/analytics-events.md` only if anything there lists campaign sources.

- [ ] **13. Finish.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm cms:build`;
  an end-to-end run under Aspire (below). Remove nothing from this plan until the PR is merged.

## Testing & verification

- Unit: `newsletter.schema.test.ts`, `email/markdown.test.ts`, `layout.test.ts` (new blocks),
  `newsletter-email.test.ts`, `withUtm`, route tests, `app-sync.test.ts`, `middleware.test.ts`,
  `cms-push.test.ts`, `env.test.ts`, `enums.test.ts`, `analytics.test.ts`.
- Integration (`createTestDatabase()`): recipient selection; no double send; 7-day rule; daily
  limit and continuing after 24 h; skip after unsubscribing or a bounce after queuing; retries;
  concurrent runs and concurrent sends; status `sent` and the outbox row.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm cms:build`; `pnpm
  db:rollback` then migrate again.
- Manual (Aspire, smtp4dev): seed users (uk, en, null locale; one unverified, one opted out, one
  suppressed); write a newsletter in Strapi with 2 products and an en version; "Send test to me"
  → two emails to the admin only; "Send" → Strapi shows `sending` and the queued count; set
  `NEWSLETTER_DAILY_LIMIT=2`, start `db-send-newsletters` → 2 emails, again → 0; unsubscribe one
  queued user via their link; move the deliveries' `sent_at` back a day and run again → the rest,
  the unsubscribed one skipped, Strapi shows `sent` with counts; click a product card with cookies
  accepted → `sessions.traffic_source = 'newsletter'`, `traffic_campaign = <slug>`; a second
  "Send" and a send of another newsletter are refused with Ukrainian messages; check the
  `List-Unsubscribe` headers in smtp4dev and that a one-click POST unsubscribes.

## Acceptance criteria

- [ ] Staff can write a uk/en newsletter with featured products in Strapi and send a test to
  themselves — steps 3, 4, 6, 7, 9, 10
- [ ] Sending emails every opted-in, verified, not suppressed customer exactly once, in their
  language — steps 2, 4, 5, 6
- [ ] Customers who unsubscribed or bounced, even after queuing, get nothing — steps 4, 5
- [ ] Every email has a working unsubscribe link and one-click unsubscribe headers — steps 3, 6
- [ ] Sending respects `NEWSLETTER_DAILY_LIMIT` and continues the next day; a second send within 7
  days is refused — steps 1, 4, 5, 11
- [ ] Strapi shows the newsletter's status and counts — steps 7, 8, 9
- [ ] Links carry UTM tags, and visits from a newsletter appear as `newsletter` in the acquisition
  analytics — steps 3, 6, 12
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 13

## Out of scope

- Segments, A/B tests, open-tracking pixels, a drag-and-drop editor (from the issue).
- Newsletter sign-up for people without an account (from the issue).
- Scheduling a send for later; cancelling a newsletter that is already sending.
- Mapping a bounce or complaint back to its delivery row (suppression already works by address).
- Images inside the body text (product cards carry photos).
- Synthetic newsletter traffic in `analytics/` (its generator and warehouse are unchanged).
