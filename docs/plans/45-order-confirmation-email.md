# Plan: Send order-confirmation email after checkout (#45)

Issue: https://github.com/savchukolgaa/jassmin/issues/45
Branch: `issue/45`
Worktree: `.claude/worktrees/issue-45`
Status: Planned

## Goal
Shoppers, guests and registered users alike, should get an order-confirmation email after checkout
so they have a record of the order, its total and the delivery details. Guests have no account
page, so today the success page is their only record. Once the order transaction has committed,
`/checkout` sends one plain-text email to the order's address, in the language the shopper checked
out in. A mail failure is logged and never affects the order or the redirect.

## Dependencies & prerequisites
- #11 (checkout) is merged: `createOrder` in `app/.server/services/orders.ts`, the `/checkout`
  action in `app/routes/checkout.tsx` and the success page `app/routes/checkout-success.tsx`.
- Mail transport is in place: `getMailTransport()` in `app/.server/mail.ts` (`SMTP_URL`, smtp4dev
  under Aspire, already wired in the AppHost). No new packages, migrations or Aspire changes.
- New env var: `ORDER_FROM` (optional), see the decisions below.

## Decisions & assumptions
- **Fire-and-forget after commit.** The action calls `void sendOrderConfirmation(...)` only when
  `result.placed` is true, after `createOrder` returns (so the transaction has committed). That way
  a double submit (`placed: false`) or a failed order (`cart-empty`, `insufficient-stock`, a thrown
  error) sends nothing. Not awaiting it keeps the redirect fast, the same way `trackEvent` works. The
  function catches everything (the DB read included), so it never rejects. A process crash between
  commit and send loses the email; that's acceptable here because there's no outbox or retry
  **(unconfirmed, Q3)**.
- **The email is built from the stored order, not the form input.** The service re-reads the order
  with the same queries the success page uses (`findOrder` + `listOrderLines`), so the email shows
  exactly what was saved: `price_at_purchase`, the SQL-computed totals and the normalised phone.
  `getOrderConfirmation` is split into a viewer-free `loadOrderConfirmation(orderId, db)`, which
  the email service uses, plus the existing viewer check.
- **Locale:** `await getLocale(request)` in the action, passed to the service, which uses
  `createTranslator(locale)`. The locale isn't stored on the order.
- **Pure builder plus injectable deps**, mirroring `services/contact.ts`:
  `buildOrderConfirmationEmail(order, translator, env): Mail.Options` is pure and unit-tested.
  `sendOrderConfirmation(orderId, locale, deps = defaultDeps())` takes
  `{ mailer: MailSender | null; env; loadOrder }`. `MailSender` is reused from `contact.ts`, or
  moved to `mail.ts` so both services share it.
- **Missing `SMTP_URL`:** skip and log with `console.info("[order-email] SMTP_URL is not set; …")`,
  in every environment (the issue says "skip sending and log it"). In development the message text
  goes into the log too, as the contact form does. Unlike the contact form, production does *not*
  report an error to the shopper.
- **Headers:** `to: { name: stripLineBreaks(fullName), address: email }`. The subject only holds
  the order number and the brand (`orderEmail.subject`: "Замовлення №{id} прийнято — Jassmin").
  `from` is `ORDER_FROM`, `replyTo` is `CONTACT_INBOX`, so a reply reaches the store. The CR/LF
  stripping (`/[\r\n]+/g` → space) moves into a small exported helper `stripLineBreaks` in
  `mail.ts`, and `contact.ts` uses it too.
- **`ORDER_FROM`:** a new optional env var. When it's unset it falls back to `CONTACT_FROM`, so
  nothing has to be configured **(unconfirmed, Q1)**.
- **Content** (plain text, every label from `orderEmail.*`):
  1. Greeting with the name, and "Your order №{id} of {date} has been received" (`formatDate(createdAt.toISOString())`, Kyiv time).
  2. Lines: `{title} — {volume}, {quantity} × {unitPrice} = {lineTotal}`. The volume comes from
     `formatVolume` (`~/lib/products`); `title === null` → `checkout.deletedProduct`; `volumeMl === null` drops the volume.
  3. Subtotal, delivery (`checkout.shippingFree` when `freeShipping`, otherwise
     `checkout.shippingCarrierRate`) and total (`totalAmount`), all through `formatPrice`.
  4. Payment: the method label and the card/cod note. These reuse `checkout.payment.*`, so they
     match the success page; `PAYMENT_KEYS` moves from `checkout-success.tsx` to `~/lib/checkout`
     and both use it.
  5. Delivery: Nova Poshta, then `fullName, phone`, then `shippingAddress`.
  6. Contact line: "Questions? Reply to this email or write to {email}" with `CONTACT_INBOX`
     **(unconfirmed, Q2)**.
- New keys go only where wording differs from the page: `orderEmail.subject`, `greeting`,
  `intro`, `itemsHeading`, `line`, `subtotal`, `shipping`, `total`, `paymentHeading`,
  `deliveryHeading`, `deliveryCarrier`, `contact` and `signature`, added to both `uk.ts` and `en.ts`.

## Open questions
- [ ] **Q1: A separate sender for order emails, or `CONTACT_FROM` again?** Why it matters: it
  decides which address shoppers see and which address has to be authorised (SPF/DKIM) on the real
  SMTP provider. Recommended default: an optional `ORDER_FROM` that falls back to `CONTACT_FROM`
  (`Jassmin website <no-reply@jassmin.ua>`). Affects steps: 1, 3.
- [ ] **Q2: What goes in the contact line?** Why it matters: the store's phone lives in Strapi
  (`SiteSettings.phone`), and fetching it at send time adds a CMS dependency that can fail.
  Recommended default: reply-to plus `CONTACT_INBOX` only, with no CMS call. The phone can be added
  later, best-effort through `getSiteSettings(locale).catch(() => null)`. Affects steps: 3.
- [ ] **Q3: Is fire-and-forget delivery good enough?** Why it matters: a crash or restart between
  commit and send loses the email, and there's no retry or record of sending (no `orders` column).
  Recommended default: yes for now, with a logged error on failure. A persistent outbox/retry is a
  separate issue. Affects steps: 4.

## Resolved questions
- **Should a double submit send a second email?** No. `createOrder` returns `placed: false` for it,
  and the `purchase` event is already gated the same way (source: `app/routes/checkout.tsx`,
  `app/.server/services/orders.ts`).
- **Which totals to show, given shipping is always 0?** `shipping_amount` is always `0`. Below
  1000 UAH the recipient pays Nova Poshta, and `orders.free_shipping` records which case applies, so
  the email reuses the success page's free/carrier-rate wording (source: `app/.server/AGENTS.md`
  "Orders", `app/lib/checkout.ts`).
- **Card/cod note wording:** reuse `checkout.payment.cardNote` / `codNote`, which the success page
  already shows (source: `app/routes/checkout-success.tsx`, `app/lib/i18n/uk.ts`).
- **Is `formatDate` safe for server-side use?** Yes, it formats in `Europe/Kyiv` regardless of the
  server's TZ (source: `app/lib/i18n/translator.ts`).
- **Header sanitising pattern:** `/[\r\n]+/g` → space, as in `buildContactEmail` (source:
  `app/.server/services/contact.ts`). The email address is already validated by `emailSchema`.
- **How to test without SMTP:** an injectable `MailSender` fake plus `vi.mock("../env")` /
  `vi.mock("../mail")` (source: `app/.server/services/contact.test.ts`).
- **Payment-status emails (paid/failed):** out of scope, they belong to #44 (source: issue #45).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/env.ts` | Optional `ORDER_FROM` (empty → unset) |
| modify | `app/.server/env.test.ts` | `ORDER_FROM` unset/empty/set cases |
| modify | `.env.example`, `README.md` | Document `ORDER_FROM`; mention order emails next to `SMTP_URL` |
| modify | `app/.server/mail.ts` (+ `mail.test.ts`) | `stripLineBreaks` helper and shared `MailSender` type |
| modify | `app/.server/services/contact.ts` | Use `stripLineBreaks` / shared `MailSender` (no behaviour change) |
| modify | `app/.server/services/orders.ts` | Extract `loadOrderConfirmation(orderId, db)` |
| modify | `app/lib/checkout.ts` | Move `PAYMENT_KEYS` here |
| modify | `app/routes/checkout-success.tsx` | Import `PAYMENT_KEYS` |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `orderEmail.*` namespace |
| create | `app/.server/services/order-email.ts` | `buildOrderConfirmationEmail`, `sendOrderConfirmation` |
| create | `app/.server/services/order-email.test.ts` | Body (uk/en), headers, skip and failure paths |
| modify | `app/routes/checkout.tsx` | Call `void sendOrderConfirmation(...)` for a placed order |
| modify | `app/routes/checkout.test.ts` | Called once when placed; not on failure or double submit; rejection doesn't break redirect |
| modify | `app/.server/AGENTS.md` | Document the order email under "Markdown, mail…" and "Orders" |

## Steps
- [ ] **1. Env: `ORDER_FROM`.** Add `ORDER_FROM: z.string().min(1).optional()` to `envSchema`, and
  `ORDER_FROM: source.ORDER_FROM || undefined` in `parseEnv`. Document it in `.env.example` and the
  README table (default: same as `CONTACT_FROM`). Add `env.test.ts` cases. Check: `pnpm test app/.server/env.test.ts`.
- [ ] **2. Shared mail helpers and order loader.** In `mail.ts`, export
  `stripLineBreaks(value: string)` and move the `MailSender` interface there. Switch `contact.ts`
  over to both, keeping `contact.test.ts` green. In `orders.ts`, extract `loadOrderConfirmation`
  (`findOrder` + `listOrderLines`, returning `OrderConfirmation` without `userId`), which
  `getOrderConfirmation` then calls after the viewer check. Move `PAYMENT_KEYS` to `~/lib/checkout`
  and import it in `checkout-success.tsx`. Check: `pnpm typecheck && pnpm test`.
- [ ] **3. Translations and the email builder.** Add `orderEmail.*` to `uk.ts`, then `en.ts`
  (typecheck enforces the same shape). Create `services/order-email.ts` with
  `buildOrderConfirmationEmail(order: OrderConfirmation, translator: Translator, env: Pick<Env, "ORDER_FROM" | "CONTACT_FROM" | "CONTACT_INBOX">): Mail.Options`,
  which returns `{ from, to: { name, address }, replyTo, subject, text }` with the content listed
  under the decisions. Lines are joined with `"\n"`; no HTML. Check: unit tests for the uk and en
  bodies, written as exact `toEqual` text like `contact.test.ts` (normalise `formatPrice`'s
  narrow no-break spaces as `translator.test.ts` does).
- [ ] **4. Sending.** Add
  `sendOrderConfirmation(orderId: number, locale: Locale, deps: OrderEmailDeps = defaultDeps()): Promise<void>`,
  with deps `{ mailer: MailSender | null; env; loadOrder: (id) => Promise<OrderConfirmation | undefined> }`.
  Without a mailer, log `[order-email] SMTP_URL is not set` (plus the text outside production) and
  return. When the order is missing, `console.error` and return. Otherwise `sendMail`. Any error
  anywhere goes to `console.error("[order-email] …", error)` and is swallowed: the function never
  rejects. `defaultDeps()` is built inside the `try`, so an env/transport error is caught too.
  Check: tests for skipped without SMTP, a rejecting `sendMail` resolving, and a throwing
  `loadOrder` resolving.
- [ ] **5. Wire into `/checkout`.** In the action's `if (result.placed)` block, next to the
  `purchase` event, add `void sendOrderConfirmation(result.orderId, await getLocale(request));`.
  Update `routes/checkout.test.ts` (mock `~/.server/services/order-email` and `~/.server/locale`): it's
  called once with the order id and the locale when placed; it's not called for `placed: false`,
  `cart-empty`, `insufficient-stock` or validation errors; and a rejecting mock still gives the
  redirect. Check: `pnpm test app/routes/checkout.test.ts`.
- [ ] **6. Docs and full verification.** Update `app/.server/AGENTS.md` (mail section: order
  emails, `ORDER_FROM`, never fails checkout; Orders section: sent after commit, only for
  `placed`). Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`, then do the manual
  check below.

## Testing & verification
- `order-email.test.ts`:
  - The uk body and the en body for a `cod` order under the free-shipping threshold and a `card`
    order over it: number, date, lines, totals, payment note and address.
  - A deleted product line and a missing volume.
  - The name's CR/LF is stripped in `to`, and the subject holds no user input.
  - `from` falls back to `CONTACT_FROM`; `replyTo` is `CONTACT_INBOX`.
  - Without a mailer, nothing is sent and the skip is logged.
  - Transport and loader errors resolve without throwing.
- `checkout.test.ts`: an email is sent only for placed orders, with the request's locale (a `locale=en` cookie → `"en"`), and the redirect survives a rejection.
- `env.test.ts`, plus the existing `contact.test.ts`, `orders.test.ts` and `checkout-success.test.ts`, stay green.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: run `pnpm aspire run`, then place one guest order in Ukrainian and one in English (switch
  the language first). Open smtp4dev from the dashboard and check that exactly one email per order
  arrives, with the right language and content. Then stop smtp4dev (or unset `SMTP_URL` outside
  Aspire), place an order, and check that the redirect to the success page works and the skip or
  failure shows up in the log.

## Acceptance criteria
- [ ] After a successful checkout, the order's email address receives one confirmation email — steps 4, 5
- [ ] The email contains the order number, lines, totals, payment method and delivery address — step 3
- [ ] The email is in the language the shopper checked out in (uk or en) — steps 3, 5
- [ ] A mail failure or missing `SMTP_URL` never fails the order or the redirect — steps 4, 5
- [ ] No email is sent when order creation fails — step 5

## Out of scope
- Payment-status emails (paid/failed), which belong to #44.
- HTML email templates.
- A persistent outbox, retries, or recording that the email was sent on the order.
- Storing the checkout locale on `orders`.
- Resending from `/admin`.
- Store-side notification emails for new orders.
