# Card payments with LiqPay

Customers pay for orders and gift cards by card, Apple Pay, Google Pay or Privat24 on
**LiqPay's** hosted payment page (#192). LiqPay is PrivatBank's payment service. The shop never
sees or stores card details: it sends the shopper to LiqPay with the amount, and LiqPay tells the
shop the result in a signed server-to-server callback. Cash on delivery is unaffected.

This guide covers how it works, testing in LiqPay's sandbox, opening the merchant account, going
live, refunds and the fiscal receipt (ПРРО) question. The local **simulator** (no account, no
network) is still there for offline development: see
[setup.md → Card payments](setup.md#card-payments).

## Contents

1. [How it works](#how-it-works)
2. [Settings](#settings)
3. [Testing in the sandbox](#testing-in-the-sandbox)
4. [Opening the LiqPay account](#opening-the-liqpay-account)
5. [Going live](#going-live)
6. [Refunds](#refunds)
7. [Fiscal receipts (ПРРО): a question for the accountant](#fiscal-receipts-прро-a-question-for-the-accountant)
8. [Troubleshooting](#troubleshooting)

## How it works

1. The shopper places a card order (or buys a gift card). The app creates a payment attempt in
   `payments` with a reference like `42-1` (`G7-1` for a gift card) and the **stored** total, never
   an amount from the browser.
2. The app redirects the browser to `https://www.liqpay.ua/api/3/checkout` with two fields:
   `data`, the base64 JSON of the payment (API version 7: amount, currency, description,
   `order_id` = the reference, the return and callback URLs, the language), and `signature`,
   base64(SHA3-256(private key + data + private key)). Building it needs no call to LiqPay.
3. The shopper pays on LiqPay's page and comes back to the order's (or gift card's) result page.
4. LiqPay POSTs the result to `https://<shop-domain>/payments/callback`. The app checks the
   signature (in constant time; LiqPay's legacy SHA-1 signature is accepted too), that the
   `public_key` is the shop's, and that the amount and currency match the attempt. Only then:
   - `success` → the order is `paid` (or the gift card is activated and its code emailed);
   - `failure`, `error`, `reversed` → the attempt failed; the order stays unpaid and the result
     page offers **Try again**;
   - `processing`, `wait_*`, `*_verify` (e.g. `3ds_verify`) and anything unknown → still pending
     (unknown statuses are logged). Nothing is ever marked paid by anything but `success`.
5. A repeated callback changes nothing a second time, and a forged, malformed or mismatched one
   changes nothing at all. See `app/.server/services/payments.ts` and
   `app/.server/payments/liqpay.ts`.

The return and callback URLs come from `PUBLIC_SITE_URL`, so LiqPay always gets the public
`https://` address, not the address the app sees behind the proxy. The CSP allows the redirect to
LiqPay in `form-action` ([security.md](security.md)).

## Settings

| Variable | What it is |
|----------|------------|
| `PAYMENT_PROVIDER` | `liqpay` turns card payments on with LiqPay. `simulator` is the local fake. Unset, empty or `none`: card payment is off and checkout offers only cash on delivery. |
| `LIQPAY_PUBLIC_KEY` | The shop's public key from the LiqPay cabinet. Required with `liqpay`. |
| `LIQPAY_PRIVATE_KEY` | The shop's private key. A secret: never commit it, never send it to anyone. Required with `liqpay`. |
| `LIQPAY_SANDBOX` | `true`: LiqPay's test mode, test cards only and no money moves. Unset, it's **on** outside production and **off** in production. A staging server running in production mode can set `true` on purpose; the app then logs a warning at startup. |
| `LIQPAY_ORDER_PREFIX` | Optional, e.g. `dev-olga-`. Put in front of every `order_id` sent to LiqPay. LiqPay refuses an `order_id` it has already seen, and a reset development database starts again at `1-1`, so give each development or staging database its own prefix. Production leaves it unset. Letters, digits, `_` and `-`, up to 32. |

The app refuses to start with `PAYMENT_PROVIDER=liqpay` and a key that is missing or still the
deploy's `pending` placeholder.

## Testing in the sandbox

1. In the LiqPay cabinet (`https://www.liqpay.ua`), open your shop's settings and copy the
   **sandbox** (test) public and private keys.
2. LiqPay must reach your callback URL over the internet, and `localhost` isn't reachable. Start a
   tunnel to the app, for example with
   [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/):

   ```bash
   cloudflared tunnel --url http://localhost:<web port>
   ```

   It prints an `https://….trycloudflare.com` address.
3. In the root `.env`:

   ```dotenv
   PAYMENT_PROVIDER=liqpay
   LIQPAY_PUBLIC_KEY=sandbox_i…
   LIQPAY_PRIVATE_KEY=sandbox_…
   LIQPAY_ORDER_PREFIX=dev-<your name>-
   PUBLIC_SITE_URL=https://….trycloudflare.com
   ```

   Sandbox mode is on by itself outside production. Restart the app.
4. Open the shop **through the tunnel address**, place a card order and pay with one of the test
   cards from LiqPay's documentation (the sandbox section of the API docs). You come back to the
   order page, and within a few seconds it shows the order paid. In the database the attempt is
   `succeeded` and the order `paid`.
5. Also try a declined test card: the order stays unpaid and **Try again** starts a new attempt.
   Then buy a gift card the same way: it becomes active and its code email is queued.

Without a tunnel the payment page still works, but the callback never arrives, so the order stays
"waiting for payment". Use the simulator when you don't need LiqPay itself.

## Opening the LiqPay account

The owner opens a LiqPay merchant account for the ФОП at `https://www.liqpay.ua` (sign in with
Privat24 or register, then add a shop/website in the cabinet). LiqPay reviews the site before it
activates the shop. Have these on the site first (#190):

- the **public offer** (договір публічної оферти);
- **delivery and payment** terms, naming card payment through LiqPay;
- **returns and exchanges** terms;
- the **seller's details**: the ФОП's full name, РНОКПП, address, phone and email (#190);
- the **privacy policy**, which names LiqPay as the processor of card payments once
  `PAYMENT_PROVIDER=liqpay`.

LiqPay may also ask for the ФОП's registration documents and the bank account for payouts. Their
current list is in the cabinet when you add the shop.

When asked for URLs, give:

| What LiqPay asks for | Value |
|----------------------|-------|
| Site | `https://<shop-domain>` |
| Callback / `server_url` | `https://<shop-domain>/payments/callback` (the app sends it with every payment too) |
| Return / `result_url` | sent by the app with every payment: the order's or gift card's result page |

## Going live

Only after #190 is on the site and LiqPay has approved the shop:

1. Copy the **live** public and private keys from the LiqPay cabinet.
2. In the deployment state file (`production.json`, see
   [deploy.md → Changing a setting or a secret](deploy.md#changing-a-setting-or-a-secret)), set:

   ```json
   "Parameters:liqpay-public-key": "i…",
   "Parameters:liqpay-private-key": "…",
   "Parameters:payment-provider": "liqpay"
   ```

   On the first deploy Aspire asked for both keys; `pending` was the answer until now.
   `payment-provider` defaults to `none` (card payments off); add the line if it isn't there.
3. Run `pnpm aspire:deploy`. Production always sets `LIQPAY_SANDBOX=false`, so these are real
   payments.
4. Check: the checkout's card option names Apple Pay, Google Pay and LiqPay; place a small real
   order, pay, and see it become paid in Strapi; then refund it (below).

To turn card payments off again, set `"Parameters:payment-provider": "none"` and deploy. Orders
already paid stay paid.

## Refunds

Refunds are made in the **LiqPay cabinet**, not in the app: find the payment by its order id (the
reference, e.g. `42-1`) and refund it in full or in part. Then set the order's payment status to
**Кошти повернено** (refunded) in Strapi, so the shop's records and analytics match. LiqPay's
`reversed` callback for an already-paid attempt changes nothing in the app.

A paid order that is cancelled (by staff, or a payment that arrives after the unpaid order was
cancelled, which the app logs as needing a manual refund) needs the same refund by hand.

## Fiscal receipts (ПРРО): a question for the accountant

Ukrainian law can require a fiscal receipt (ПРРО/РРО) for card payments made online, depending on
the ФОП's group and how the money is received. **Ask the accountant** before going live:

- Does this ФОП have to issue a fiscal receipt for card payments taken through LiqPay?
- If yes: LiqPay's own ПРРО service (fiscalisation in the cabinet, sent with the payment as
  `rro_info`), or a separate ПРРО such as Checkbox?

The app issues no receipts today. If they're needed, that is a separate issue.

## Troubleshooting

- **The order stays "waiting for payment".** The callback didn't arrive or was refused. Check the
  `web` logs for `Payment callback …` lines. Is `PUBLIC_SITE_URL` the public `https://` address?
  Locally: is the tunnel running and are you browsing through it?
- **LiqPay shows an error about the `order_id`.** It has seen that `order_id` before: set or change
  `LIQPAY_ORDER_PREFIX` on development and staging databases.
- **LiqPay says the signature is wrong.** The private key doesn't belong to the public key (live
  and sandbox keys mixed up, or a stray space).
- **The app won't start: `PAYMENT_PROVIDER=liqpay needs LIQPAY_PUBLIC_KEY and LIQPAY_PRIVATE_KEY`.**
  A key is missing or still `pending`.
- **The browser refuses to open LiqPay's page** (with `CSP_MODE=enforce`): `form-action` must list
  `https://www.liqpay.ua` ([security.md](security.md)).
