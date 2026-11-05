# Plan: Send the shop's emails through a transactional provider with SPF, DKIM and DMARC (#134)

Issue: https://github.com/savchukolgaa/jassmin/issues/134
Branch: `issue/134`
Worktree: `.claude/worktrees/issue-134`
Status: Planned (open questions answered)

## Goal

As the store owner, I want every email the shop sends (order confirmations, gift card codes,
contact messages, the email-changed notice) to go out from `no-reply@jassmin.ua` through a real
transactional provider and reach the inbox instead of spam. The code keeps sending over SMTP with
nodemailer, so only `SMTP_URL` changes. We document the SPF/DKIM/DMARC records for the owner in
`docs/email.md`, give every email one branded HTML + plain-text layout in Ukrainian and English,
and record hard bounces and spam complaints so those addresses never get mail again.

## Dependencies & prerequisites

- **#45 order email outbox** (`order_emails`, `services/order-email.ts`, `pnpm db:send-order-emails`):
  merged, on `origin/main`.
- **#125 gift card emails** (`gift_card`, `gift_card_recipient` types): merged.
- **#54 email-changed notice** (`services/profile.ts` → `notifyEmailChanged`): merged.
- No new npm packages. nodemailer is already a dependency. HTML is built with template strings
  and an escape helper, without `react-dom/server` or MJML (see Decisions).
- **One migration**, `0024_email_suppressions`: the new `email_suppressions` table plus
  `order_emails.message_id`, with a hand-written rollback in `db/rollbacks/`.
- **New env var** `EMAIL_WEBHOOK_SECRET`, and `SMTP_URL` becomes required in production.
- **Owner actions outside the repo**: create the provider account, add the DNS records, create
  the webhook in the provider dashboard and run the mail-tester check. The code can be merged
  before this; the "SPF/DKIM/DMARC = PASS" criterion is checked by hand after the DNS change.

## Decisions & assumptions

### Provider: Brevo (Q1)

| | **Brevo** | Postmark | Amazon SES |
|---|---|---|---|
| Price (check at sign-up) | Free: 300 emails/day; paid from about €9/month for 5k/month | No free tier after 100 test emails; about $15/month for 10k | About $0.10 per 1,000; needs an AWS account and a request to leave the sandbox |
| Where | EU company (France), GDPR DPA | US | AWS region of your choice (e.g. eu-central-1) |
| Deliverability | Good. Shared IPs; DKIM on your own domain | Best in class; transactional-only streams | Good, but reputation is your job; no help with setup |
| SMTP relay | `smtp-relay.brevo.com`, 587 STARTTLS / 465 TLS | `smtp.postmarkapp.com` | `email-smtp.<region>.amazonaws.com` |
| Bounce/complaint webhook | JSON per event (`hard_bounce`, `spam`, `blocked`, `invalid_email`, …), **auth: bearer token or basic auth, no HMAC** | JSON, basic auth, no HMAC | Through SNS; verifying the signature means fetching X.509 certs. Most work |
| Custom Return-Path | Not on the basic plans (DMARC aligns through DKIM) | Yes (CNAME `pm-bounces`) | Yes (custom MAIL FROM) |

**Why Brevo:** a small shop sends far fewer than 300 emails a day, so it's free. It's an EU
processor (simpler under the privacy policy, #18), its SMTP works unchanged with
`smtpOptionsFromUrl`, and its webhook is plain JSON. DMARC passes on DKIM alignment alone
(relaxed alignment, `d=jassmin.ua`), so no custom Return-Path is needed. Postmark is the fallback
if deliverability to Ukr.net turns out poor.

The code is **provider-agnostic except for one adapter**: the webhook payload parser
(`app/.server/email/webhook-brevo.ts` and its zod schema). Switching providers means a new parser
and a new `SMTP_URL`, nothing else.

### Webhook authentication (Q2)

The issue says "signed with the provider's secret". Brevo (like Postmark) doesn't sign webhooks
with an HMAC. It sends a configured credential with each request. We configure the webhook with
**bearer auth** = `EMAIL_WEBHOOK_SECRET` (32+ characters) and check
`Authorization: Bearer <secret>` in constant time. For that we pull the existing
`sha256` + `timingSafeEqual` check out of `cms/sync-auth.ts` into a shared helper
(`app/.server/bearer-auth.ts`, `checkBearerSecret(request, secret)`), so both routes use the
same code. Without the secret the route answers 503, as `/cms/*` does.

### Message layout

- New module `app/.server/email/layout.ts`. Each builder describes its email as a list of
  **blocks** (`heading`, `paragraph`, `lines` (an item list), `amounts` (label/value rows),
  `code` (gift card code), `signature`). `renderEmail(blocks, translator, env)` produces both
  `html` and `text` from that one list, so the two parts can't drift apart.
- HTML: a 600 px table layout with inline styles (email clients ignore `<style>`/CSS variables),
  using the C+ colours from `docs/design.md`: a `primary` `#C22F4B` header band with a white
  **text wordmark "JASSMIN"** (serif stack `Georgia, 'Times New Roman', serif`; web fonts don't
  load in most clients) (Q3), `ink` `#1F1A1C` headings, `body` `#4A4245` copy,
  `muted` `#5F5558` captions, `card` `#F7F3F4` amount table, `line` `#E5DADD` dividers, and a
  `primary` footer with white text. `lang="uk|en"`, `<meta name="color-scheme" content="light">`
  (C+ is light-only), and a hidden preheader.
- Every interpolated value is HTML-escaped (`escapeHtml`). The layout never inserts raw HTML from
  data.
- Footer: the shop's contacts from env: `CONTACT_INBOX` (mailto), the site
  (`PUBLIC_SITE_URL`, left out when unset), and a localized one-line "why you got this" note.
  The phone and hours live in Strapi, which the retry job can't read, so they're left out (Q4).
- Copy for the layout (footer, preheader fallback) goes in a new `email` namespace in
  `app/lib/i18n/uk.ts` / `en.ts`.

### Headers

- `composeEmail({ from, to, replyTo, subject, blocks, translator, env })` in `email/layout.ts`
  returns `Mail.Options` with `html`, `text`, `replyTo` and an explicit
  `messageId: <${randomUUID()}@jassmin.ua>`, whose domain comes from the `from` address.
  Every builder uses it, so every email has Reply-To and a jassmin.ua Message-ID.
- The defaults stay: `CONTACT_FROM` = `Jassmin website <no-reply@jassmin.ua>`, `CONTACT_INBOX`
  = `hello@jassmin.ua`. The contact form email keeps `replyTo` = the visitor, on purpose.

### Suppressions

- Table `email_suppressions`: `address text primary key` (stored lowercase), `reason text not
  null` (CHECK, one of `EMAIL_SUPPRESSION_REASONS` = `hard_bounce`, `complaint`, `blocked`,
  `invalid` in `~/lib/enums`), `detail text` (the provider's reason, at most 500 chars, nullable),
  `created_at timestamptz default now()`. Inserts use `on conflict do nothing`: the first reason
  wins.
- Webhook event mapping (Brevo): `hard_bounce` → `hard_bounce`, `spam` → `complaint`,
  `blocked` → `blocked`, `invalid_email` → `invalid`. `soft_bounce`, `deferred`, `delivered`,
  `opened` and unknown events are acknowledged (200) and ignored, so Brevo doesn't retry them.
  The body may hold one event or an array of them.
- **Sending skips suppressed addresses** in one place: `withSuppressions(sender, isSuppressed)` in
  `mail.ts` wraps a `MailSender`. It drops suppressed `to`/`cc`/`bcc` addresses, and when no
  recipient is left it throws `SuppressedRecipientError` (carrying the reason) without calling
  SMTP. `mail.ts` stays free of DB imports. The lookup `findEmailSuppressions(db, addresses)` is in
  `db/queries/email-suppressions.ts`, and each caller wires it with its own pool:
  - `getMailer()` in new `app/.server/services/mailer.ts` (the app pool), used by
    `services/orders.ts`, `services/gift-cards.ts`, `services/profile.ts`, `services/contact.ts`
    instead of `getMailTransport()`;
  - `db/scripts/send-order-emails.ts` with its own `createDb` pool.
- `deliverOrderEmails`: a `SuppressedRecipientError` marks the row `failed` **at once**
  (`final: true`, `last_error = "suppressed: <reason>"`), with no retries.
- **Bounces after sending**: when an order email is sent we store its `message_id` on the row
  (`markOrderEmailSent(db, id, messageId)`), and we also send the header
  `X-Mailin-custom: order-email:<id>`, which Brevo echoes back in webhook events. The webhook marks
  the matching `sent` row `failed` with `last_error = "<reason>: <detail>"`. It matches on the
  custom tag first, then on `message-id` (Brevo may rewrite the Message-ID, so the tag is the
  reliable key) **(unconfirmed; check on the first real bounce)**. An event that matches no row
  only adds the suppression.
- To lift a suppression (a customer fixed their mailbox), the owner deletes the row. `docs/email.md`
  gives the SQL. A CLI command is out of scope.

### Env

- A shared refinement: `NODE_ENV === "production"` needs `SMTP_URL`. It applies to **both**
  `envSchema` (the web app won't start) and `parseMailEnv` (the retry job won't start). Spreading
  `mailEnvSchema.shape` drops refinements, so both schemas add it. The existing "dev logs the
  contact message instead" branch stays for development. The production branch in `contact.ts`
  becomes unreachable but stays as a defensive check.
- `PUBLIC_SITE_URL` moves into `mailEnvSchema`, so the retry job can link the site in the footer.
  It's still spread into `envSchema`, and its production refine is unchanged.
- `EMAIL_WEBHOOK_SECRET`: `z.string().min(32).optional()` in `envSchema` (web app only). Without
  it, `/hooks/email` answers 503, and in production `getEnv()` logs a one-time `console.warn`
  that bounces aren't recorded (Q5).
- `smtps://` (port 465) is the documented form for Brevo, so TLS never depends on STARTTLS being
  offered. `smtpOptionsFromUrl` stays as it is.

### Contact form email

It goes to the store, not a customer. Its subject and labels are hard-coded in English today. It
moves to the shared layout with i18n keys (`contactEmail` namespace) and is rendered in **`uk`**
(the shop's language) (Q6).

## Resolved questions

The owner accepted every recommended default on 2026-11-05:

- **Q1: Which provider?** Brevo (free tier, EU, simple webhook). Postmark stays the fallback if
  delivery to Ukr.net turns out poor (source: owner, 2026-11-05).
- **Q2: Is a bearer token enough for "signed with the provider's secret"?** Yes: a bearer token
  checked in constant time, plus zod validation of the body. Brevo doesn't HMAC-sign webhooks
  (source: owner, 2026-11-05).
- **Q3: Logo?** A white serif text wordmark "JASSMIN" on the `primary` band; an image can replace
  it later (source: owner, 2026-11-05).
- **Q4: Phone in the footer?** No: email and site only, no `SHOP_PHONE` (source: owner,
  2026-11-05).
- **Q5: Is `EMAIL_WEBHOOK_SECRET` required in production?** No: optional. The webhook answers 503
  without it, and the app logs a `console.warn` at startup in production when it's missing
  (source: owner, 2026-11-05).
- **Q6: Contact email language?** Ukrainian, through i18n keys (`contactEmail` namespace) (source:
  owner, 2026-11-05).

From the codebase:

- **Does the code change for the provider?** No: nodemailer and `smtpOptionsFromUrl` already
  handle `smtp(s)://user:pass@host:port`. Only `SMTP_URL` changes (source: `app/.server/mail.ts`,
  issue assumptions).
- **Sender and reply address?** `no-reply@jassmin.ua` / `hello@jassmin.ua`, already the
  `CONTACT_FROM` / `CONTACT_INBOX` defaults (source: `app/.server/env.ts`).
- **Which emails exist?** The order confirmation, gift card buyer, gift card recipient (all through
  the `order_emails` outbox), the contact message and the email-changed notice (source:
  `services/order-email.ts`, `services/contact.ts`, `services/profile.ts`).
- **How do we authenticate a webhook from a third party?** Reuse the `/cms/*` pattern: bearer
  secret, `sha256` + `timingSafeEqual`, 503 when unconfigured, 401 when wrong, POST-only resource
  route outside the layout with a 405 `loader` (source: `app/.server/cms/sync-auth.ts`,
  `app/routes/cms.products.ts`, `app/routes.ts`).
- **Can the retry job use the app DB pool?** No: `db/index.ts` validates the web app's whole env.
  The job brings its own pool, so the suppression lookup is injected (source: `app/.server/AGENTS.md`
  → `services/order-email.ts`).
- **Where do the colours come from?** The C+ tokens in `docs/design.md` (`primary`, `ink`, `body`,
  `muted`, `card`, `line`). C+ is light-only (source: `docs/design.md` → Colour tokens).
- **How are status-like columns constrained?** With text + CHECK from a value array in
  `~/lib/enums`, as in `order_emails` (source: `app/.server/db/schema.ts`).
- **What does "required in production" look like?** A `.refine` on `envSchema`, as with
  `PUBLIC_SITE_URL` (source: `app/.server/env.ts`, `env.test.ts`).
- **Marketing/newsletter consent?** Out of scope; every email here is transactional (issue).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/env.ts` | `SMTP_URL` required in production (both schemas); `EMAIL_WEBHOOK_SECRET`; `PUBLIC_SITE_URL` into `mailEnvSchema` |
| modify | `app/.server/env.test.ts` | Cases for the above; production fixtures get an `SMTP_URL` |
| create | `app/.server/bearer-auth.ts` (+ `.test.ts`) | `checkBearerSecret(request, secret)`, pulled out of `cms/sync-auth.ts` |
| modify | `app/.server/cms/sync-auth.ts` | Delegates to `checkBearerSecret` |
| create | `app/.server/email/layout.ts` (+ `.test.ts`) | Blocks, `renderEmail` (HTML + text), `composeEmail` (headers, Message-ID), `escapeHtml` |
| modify | `app/.server/mail.ts` (+ `mail.test.ts`) | `withSuppressions`, `SuppressedRecipientError`, `recipientAddresses` |
| create | `app/.server/services/mailer.ts` | `getMailer()`: app transport wrapped with the app-pool suppression lookup |
| modify | `app/.server/services/order-email.ts` (+ test) | Builders → blocks + `composeEmail`; suppressed → final `failed`; store `messageId`; `X-Mailin-custom` tag |
| modify | `app/.server/services/contact.ts` (+ test) | Layout + i18n copy; `getMailer()` |
| modify | `app/.server/services/profile.ts` (+ test) | Email-changed notice through layout; `getMailer()` |
| modify | `app/.server/services/orders.ts`, `services/gift-cards.ts` | `getMailer()` instead of `getMailTransport()` |
| modify | `app/.server/db/scripts/send-order-emails.ts` | Wrap its transport with `withSuppressions` on its own pool |
| modify | `app/lib/enums.ts` | `EMAIL_SUPPRESSION_REASONS` |
| modify | `app/.server/db/schema.ts` (+ `schema.test.ts` if mirrored) | `emailSuppressions` table; `orderEmails.messageId` |
| create | `app/.server/db/migrations/0024_email_suppressions.sql` (+ meta) | Generated with `pnpm db:generate` |
| create | `app/.server/db/rollbacks/0024_email_suppressions.sql` | Drop the table and the column |
| create | `app/.server/db/queries/email-suppressions.ts` (+ `.test.ts`) | `suppressEmails`, `findEmailSuppressions` |
| modify | `app/.server/db/queries/order-emails.ts` (+ test) | `markOrderEmailSent(…, messageId)`, `markOrderEmailBounced(db, { orderEmailId?, messageId?, error })` |
| create | `app/.server/email/webhook-brevo.ts` (+ `.schema.ts`, `.test.ts`) | Parse the Brevo event(s) → `{ address, reason, detail, orderEmailId?, messageId? }[]` |
| create | `app/.server/services/email-webhook.ts` (+ test) | Apply parsed events in one transaction: suppress + mark order emails |
| create | `app/routes/hooks.email.ts` (+ `.test.ts`) | POST `/hooks/email`: auth → JSON → zod → service; 405 loader |
| modify | `app/routes.ts` | Register `hooks/email` outside the layout |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `email` (layout) and `contactEmail` namespaces |
| create | `docs/email.md` | Provider setup, DNS records step by step, webhook, verification, suppressions |
| modify | `.env.example`, `docs/setup.md`, `README.md` (env table if present) | `SMTP_URL` (prod), `EMAIL_WEBHOOK_SECRET`, link to `docs/email.md` |
| modify | `app/.server/AGENTS.md` | Mail section: layout, suppressions, webhook; drop "send plain-text emails" |

## Steps

- [x] **1. Env.** In `env.ts`, add a `requireSmtpInProduction` refinement on `envSchema` and
  apply it in `parseMailEnv` too (`mailEnvSchema.refine(...)` used there). Move `PUBLIC_SITE_URL`
  (with its transform) into `mailEnvSchema` and add it to `mailSource`. Add
  `EMAIL_WEBHOOK_SECRET: z.string().min(32).optional()` (empty counts as unset) to `envSchema`,
  and a one-time `console.warn` from `getEnv()` in production when it's unset (Q5).
  `env.test.ts`: production fails without `SMTP_URL` (app and mail env), the existing production
  fixtures get an `SMTP_URL`, a short webhook secret is refused, and an empty one is unset. Update
  `.env.example` and the env table in `docs/setup.md`. Check with `pnpm typecheck && pnpm test`.
- [x] **2. Shared bearer check.** Create `bearer-auth.ts` with
  `checkBearerSecret(request, secret | undefined): Response | null` (the body of today's
  `checkCmsSyncAuth`), and make `checkCmsSyncAuth` call it. Its tests cover 503, 401, a token with
  a different length, and success. The existing `cms.*` route tests must still pass.
- [ ] **3. Layout.** Create `email/layout.ts`:
  - `type EmailBlock` (the union above), `escapeHtml`;
  - `renderEmail(blocks, { translator, siteUrl?, inbox, preheader })` → `{ html, text }`;
  - `composeEmail({ from, to, replyTo, subject, blocks, translator, env, headers? })` →
    `Mail.Options` with a `messageId` on the `from` domain, `text` and `html`.

  Text rules: a heading is underlined with `=`, `amounts` become `label: value` lines, `code`
  stands on its own line, and the footer is separated with `--`. Add the `email.*` i18n keys (both
  files). Tests in both locales: `lang` attribute and footer copy; user input with `<script>` and
  `&` is escaped; every block's text appears in both the HTML (tags stripped, entities decoded)
  and the text part, in order, which is the "text matches HTML" test; `messageId` ends in
  `@jassmin.ua>`; `replyTo` is set.
- [ ] **4. Order and gift card emails on the layout.** Rewrite `buildOrderConfirmationEmail`,
  `buildGiftCardEmail` and `buildGiftCardRecipientEmail` to build blocks and call `composeEmail`,
  keeping today's copy keys and order. `OrderEmailEnv` gains `PUBLIC_SITE_URL`. Update
  `order-email.test.ts` (its assertions on `text` should mostly hold) and add one HTML snapshot or
  `toContain` per builder in `uk` and `en`.
- [ ] **5. Contact and email-changed notice on the layout.** `buildEmailChangedNotice` →
  `composeEmail`. `buildContactEmail` → `composeEmail` with the new `contactEmail.*` keys,
  rendered with `createTranslator("uk")`. The visitor's name and message are escaped in the
  HTML, and `replyTo` stays the visitor. Update both test files.
- [ ] **6. Schema and migration.** Add `EMAIL_SUPPRESSION_REASONS` to `~/lib/enums`. In
  `schema.ts`, add `emailSuppressions` (columns above, `email_suppressions_reason_check` via
  `oneOf`, `email_suppressions_address_lowercase_check` `address = lower(address)`) and
  `orderEmails.messageId: text()`. Run `pnpm db:generate` and rename it to
  `0024_email_suppressions`. Write the rollback. Queries: `suppressEmails(executor, entries)`
  (lowercases, `onConflictDoNothing`) and `findEmailSuppressions(db, addresses)` →
  `Map<address, reason>`. Change `markOrderEmailSent(db, id, messageId?)` and add
  `markOrderEmailBounced`, which only touches `status = 'sent'` rows, sets `failed` and
  `last_error`, and matches by id or message id. Add integration tests next to the queries,
  following `order-emails.test.ts`.
- [ ] **7. Skip suppressed recipients.** In `mail.ts`, add `withSuppressions(sender, lookup)`
  and `SuppressedRecipientError` (the reason, no address in the message). It handles string, object
  and array forms of `to`/`cc`/`bcc` (a `recipientAddresses` helper) and compares lowercase
  addresses. `services/mailer.ts`: `getMailer()` = `getMailTransport()` wrapped with
  `findEmailSuppressions(db, …)`, or `null`. Switch `orders.ts`, `gift-cards.ts`, `profile.ts`
  and `contact.ts` to it. In `send-order-emails.ts`, wrap the job's transport with the job's
  `db`. In `deliverOne`, catch `SuppressedRecipientError` → `markFailed(id, { error:
  "suppressed: <reason>", final: true })`, count it as `gaveUp`, and log without the address.
  Pass `message.messageId` to `markSent`, and add the header `X-Mailin-custom:
  order-email:<id>`. Tests: `mail.test.ts` (one suppressed `to` → nothing sent; a mix keeps the
  rest; a case difference is still suppressed); `order-email.test.ts` (a suppressed recipient →
  `failed` on the first attempt, `sendMail` never called).
- [ ] **8. Webhook.** In `email/webhook-brevo.schema.ts`, a zod schema for one Brevo event
  (`event`, `email`, optional `message-id`, `reason`, `X-Mailin-custom`, `ts_event`, passthrough
  ignored) and for `event | event[]`. `webhook-brevo.ts`: map events → suppression entries (null
  for ignored events) and parse `order-email:<id>`. `services/email-webhook.ts`:
  `applyEmailEvents(entries, db)` in one `db.transaction`, which inserts the suppressions and marks
  the matching order emails bounced. Route `app/routes/hooks.email.ts`: `checkBearerSecret(request,
  getEnv().EMAIL_WEBHOOK_SECRET)` → `readJsonBody` (400) → `safeParse` (422 with issues) → apply →
  `200 { recorded: n }`. `loader` answers 405. Register `route("hooks/email",
  "routes/hooks.email.ts")` in `routes.ts` with a comment, outside the layout. Tests: a bad or
  missing secret → 401 and nothing written; no secret configured → 503; malformed → 400/422;
  `hard_bounce` and `spam` → suppressed; `soft_bounce` → 200 and nothing written; an array body;
  a tagged event marks its order email `failed`.
- [ ] **9. `docs/email.md`.** Cover:
  1. why (spam and Gmail's/Yahoo's 2024 sender rules);
  2. creating the Brevo account and an SMTP key, and `SMTP_URL=smtps://<login>:<smtp-key>@smtp-relay.brevo.com:465` (URL-encode `@` in the login);
  3. adding the `jassmin.ua` domain in Brevo;
  4. DNS records, each in a table of type / host / value / TTL:
     - the Brevo verification TXT (`brevo-code:…`);
     - SPF `v=spf1 include:spf.brevo.com ~all`, merged into any existing SPF (only one SPF record is allowed);
     - the DKIM records Brevo shows (CNAMEs or TXT, copied exactly);
     - DMARC `_dmarc` `v=DMARC1; p=none; rua=mailto:dmarc@jassmin.ua; fo=1`, with a dated note to move to `p=quarantine` after two clean weeks of reports, then optionally `p=reject`;
     - a note that Brevo's basic plans have no custom Return-Path, so DMARC aligns through DKIM;
  5. the webhook: URL `https://jassmin.ua/hooks/email`, the events to tick (hard bounce, spam, blocked, invalid email), bearer auth = `EMAIL_WEBHOOK_SECRET`, and how to generate a secret (`openssl rand -hex 32`);
  6. verification: `dig`/`nslookup` commands, a mail-tester.com score ≥ 9/10, and Gmail "Show original" → SPF/DKIM/DMARC `PASS`;
  7. suppressions: what's recorded, and the SQL to lift one;
  8. local development: smtp4dev is unchanged.

  Link it from `docs/setup.md` (Order emails / mail section) and the README docs list.
- [ ] **10. Docs and agent notes.** Update the mail bullets and the `order_emails` bullet
  (`message_id`) in `app/.server/AGENTS.md`, plus a suppressions bullet. Run the full
  `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Testing & verification

- Unit: `env.test.ts`, `bearer-auth.test.ts`, `email/layout.test.ts` (uk + en, escaping, text ≙
  HTML, headers), `mail.test.ts` (suppressions), `order-email.test.ts`, `contact.test.ts`,
  `profile` tests, `webhook-brevo.test.ts`.
- Integration (DB, like the existing query tests): `email-suppressions.test.ts`,
  `order-emails.test.ts` (message id, bounced), `services/email-webhook.test.ts`,
  `routes/hooks.email.test.ts`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (local): `pnpm aspire run`, place an order, send a contact message, change the profile
  email and buy a gift card (simulator). In smtp4dev, check that each has the branded HTML and a
  text part, a `Message-ID` on jassmin.ua and `Reply-To`, in `/` and `/en`. Insert a suppression
  row for the test address and place another order: its `order_emails` row is `failed` with
  `suppressed: hard_bounce`. `curl` `/hooks/email` with a sample Brevo payload, with and without
  the bearer.
- Manual (production, owner): follow `docs/email.md` and get mail-tester ≥ 9/10 and Gmail PASS for
  SPF/DKIM/DMARC.

## Acceptance criteria

- [ ] With the provider's `SMTP_URL`, order confirmations and contact messages are delivered from
  `no-reply@jassmin.ua`: steps 4, 5, 7, 9 (the code needs no provider-specific change; delivery is
  confirmed manually after the DNS setup)
- [ ] `docs/email.md` lists every DNS record, and a test email shows SPF, DKIM and DMARC = PASS:
  step 9 (PASS is a manual check by the owner)
- [ ] Every email uses the shared branded layout, with HTML and plain text, in Ukrainian and
  English: steps 3, 4, 5
- [ ] Hard bounces and spam complaints are recorded and never sent to again: steps 6, 7, 8
- [ ] Production doesn't start without `SMTP_URL`: step 1
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass: step 10

## Out of scope

- New email types (password reset, verification, status updates, abandoned-cart reminders) and
  newsletters or marketing consent.
- A UI or CLI for viewing or lifting suppressions (the SQL is documented).
- Retrying or outboxing the contact form and email-changed notice (they stay best effort).
- Open/click tracking, a dedicated IP, BIMI.
- Changing the smtp4dev setup in Aspire.
