# Email delivery: provider, DNS and bounces

The shop sends every email over SMTP from `no-reply@jassmin.ua`, with replies going to
`hello@jassmin.ua` (#134). That covers order confirmations, gift card codes, contact form messages,
the email-changed notice, and the password reset and email verification links (#135). In production the SMTP server is **Brevo**, a transactional email
provider. Locally it's smtp4dev, which catches everything.

Mail from a domain without SPF, DKIM and DMARC lands in spam, or is rejected by Gmail, Yahoo and
Ukr.net. Since 2024 Gmail and Yahoo require all three from bulk senders, and they penalise
unauthenticated mail from small senders too. This guide sets them up once. The DNS steps need
whoever controls the `jassmin.ua` DNS zone (the registrar's or the DNS host's control panel).

## Contents

1. [Why Brevo](#why-brevo)
2. [Create the Brevo account and SMTP key](#1-create-the-brevo-account-and-smtp-key)
3. [Add and authenticate the domain](#2-add-and-authenticate-the-domain)
4. [DNS records](#3-dns-records)
5. [Configure the app](#4-configure-the-app)
6. [Bounce and complaint webhook](#5-bounce-and-complaint-webhook)
7. [Check that it works](#6-check-that-it-works)
8. [Tighten DMARC after two weeks](#7-tighten-dmarc-after-two-weeks)
9. [Suppressed addresses](#suppressed-addresses)
10. [Local development](#local-development)
11. [Switching providers](#switching-providers)

## Why Brevo

| | **Brevo** (chosen) | Postmark | Amazon SES |
|---|---|---|---|
| Price | Free up to 300 emails/day; paid plans from about €9/month | About $15/month for 10,000 | About $0.10 per 1,000, plus AWS setup |
| Company | EU (France), GDPR data processing agreement | US | AWS, region of your choice |
| Webhook | Plain JSON; bearer-token auth | JSON; basic auth | Through SNS, with certificate-signed messages |

A small shop sends far fewer than 300 emails a day, so Brevo's free plan covers it, and an EU
processor is simpler under the privacy policy. Postmark is the fallback if delivery to Ukr.net
turns out poor. Check prices when you sign up; they change.

## 1. Create the Brevo account and SMTP key

1. Sign up at [brevo.com](https://www.brevo.com/) with the shop's email.
2. Open **SMTP & API → SMTP**. Note the **SMTP server** (`smtp-relay.brevo.com`) and your **login**
   (it looks like `xxxxxx@smtp-brevo.com`).
3. Click **Generate a new SMTP key**, name it `jassmin-web`, and copy the key. It's shown only once.

## 2. Add and authenticate the domain

1. Open **Senders, Domains & Dedicated IPs → Domains → Add a domain** and enter `jassmin.ua`.
2. Choose to authenticate it yourself ("I will add the records myself"). Brevo then shows the
   exact DNS records for your account. The next section explains each one; **always copy the values
   from Brevo's screen**, not from this guide, as Brevo's keys are unique to your account.
3. Under **Senders**, add `no-reply@jassmin.ua` (name: `Jassmin`). Brevo only sends from senders on
   this list.

## 3. DNS records

Add these in the DNS zone of `jassmin.ua`. Use a TTL of 3600 (1 hour), or the panel's default.
"Host" is the name relative to the domain; some panels want `@` for the domain itself, others the
full name (`_dmarc.jassmin.ua`).

| # | Type | Host | Value | Purpose |
|---|---|---|---|---|
| 1 | TXT | `@` | `brevo-code:<code from Brevo>` | Proves to Brevo that you own the domain |
| 2 | TXT | `@` | `v=spf1 include:spf.brevo.com ~all` | **SPF**: Brevo's servers may send for jassmin.ua |
| 3 | CNAME | `brevo1._domainkey` | `b1.jassmin-ua.dkim.brevo.com` (as Brevo shows it) | **DKIM** key 1: signs every message with `d=jassmin.ua` |
| 4 | CNAME | `brevo2._domainkey` | `b2.jassmin-ua.dkim.brevo.com` (as Brevo shows it) | **DKIM** key 2 (used when Brevo rotates keys) |
| 5 | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@jassmin.ua; fo=1` | **DMARC**: report only, for now |

Notes:

- **One SPF record only.** If `jassmin.ua` already has a `v=spf1 …` TXT record (for example for
  the mailbox host of `hello@jassmin.ua`), don't add a second one. Add `include:spf.brevo.com` to
  the existing one, e.g. `v=spf1 include:_spf.google.com include:spf.brevo.com ~all`. Two SPF
  records make both fail.
- **DKIM**: if Brevo shows a single TXT record (`mail._domainkey`, value `k=rsa; p=…`) instead of
  the two CNAMEs, add that instead. Older accounts use that form. Copy it exactly, as one line.
- **DMARC reports** (`rua=`) go to `dmarc@jassmin.ua`, so create that address, or an alias to
  `hello@jassmin.ua`, first. Each mailbox provider then sends a daily XML report of who sent mail
  as jassmin.ua and whether it passed. Free services such as
  [dmarcian](https://dmarcian.com/) or [Postmark's DMARC digests](https://dmarc.postmarkapp.com/)
  turn them into a readable weekly summary; give them their own `rua` address if you use one.
- **Return-Path / bounce domain**: Brevo's standard plans send with Brevo's own Return-Path, so
  there's no record to add. DMARC still passes, because the DKIM signature is on `jassmin.ua` and
  DMARC needs only SPF **or** DKIM to align. (If Brevo offers a custom bounce domain on your plan,
  add the CNAME it shows; it's optional.)

Back in Brevo, click **Authenticate this email domain** / **Verify**. DNS changes can take from a
few minutes to a few hours to appear; Brevo shows a green tick per record once it sees them.

To check the records yourself:

```bash
nslookup -type=TXT jassmin.ua                        # SPF and brevo-code
nslookup -type=CNAME brevo1._domainkey.jassmin.ua    # DKIM
nslookup -type=TXT _dmarc.jassmin.ua                 # DMARC
# or: dig +short TXT jassmin.ua, dig +short CNAME brevo1._domainkey.jassmin.ua, …
```

## 4. Configure the app

Set these on the production server (see the [environment table](setup.md#environment-variables)):

```bash
# Brevo's SMTP relay over TLS. URL-encode the login's "@" as %40.
SMTP_URL=smtps://xxxxxx%40smtp-brevo.com:<smtp-key>@smtp-relay.brevo.com:465
CONTACT_FROM=Jassmin <no-reply@jassmin.ua>     # the default is "Jassmin website <…>"
CONTACT_INBOX=hello@jassmin.ua                 # replies and contact messages go here
EMAIL_WEBHOOK_SECRET=<64 hex characters, see below>
PUBLIC_SITE_URL=https://jassmin.ua
```

- Production **refuses to start without `SMTP_URL`**: both the web app and
  `pnpm db:send-order-emails` fail at startup with "SMTP_URL is required in production".
- If the key contains `/`, `:` or `@`, URL-encode them too (`%2F`, `%3A`, `%40`).
- Port 587 with STARTTLS (`smtp://…:587`) also works, but `smtps://…:465` never sends a password
  before TLS is up.
- Every email has an HTML and a plain-text part in the shared branded layout, `Reply-To:
  hello@jassmin.ua` (the contact form uses the visitor's address instead), and a `Message-ID` on
  jassmin.ua.

## 5. Bounce and complaint webhook

When an address doesn't exist (a **hard bounce**) or a customer clicks **Report spam** (a
**complaint**), Brevo tells the app, and the app never sends to that address again. Sending to
dead addresses and to people who complained is what ruins a sender's reputation.

1. Generate a secret and set it as `EMAIL_WEBHOOK_SECRET` on the server:
   ```bash
   openssl rand -hex 32
   ```
   Without it, `/hooks/email` answers 503, nothing is recorded, and production logs a warning at
   startup.
2. Create the webhook with Brevo's API. It's the reliable way to set the bearer token; the
   dashboard form may not offer it. Create an API key under **SMTP & API → API keys** first:
   ```bash
   curl -X POST https://api.brevo.com/v3/webhooks \
     -H "api-key: <BREVO_API_KEY>" -H "content-type: application/json" \
     -d '{
       "type": "transactional",
       "description": "Jassmin bounces and complaints",
       "url": "https://jassmin.ua/hooks/email",
       "events": ["hardBounce", "spam", "blocked", "invalid"],
       "auth": { "type": "bearer", "token": "<EMAIL_WEBHOOK_SECRET>" }
     }'
   ```
   It shows up in the dashboard under **Transactional → Settings → Webhook** afterwards.
3. What the app does with each event (`app/.server/email/webhook-brevo.ts`):

   | Brevo event | Recorded as | Effect |
   |---|---|---|
   | `hard_bounce` | `hard_bounce` | The address is suppressed |
   | `spam` | `complaint` | The address is suppressed |
   | `blocked` | `blocked` | The address is suppressed (Brevo refused to send to it) |
   | `invalid_email` | `invalid` | The address is suppressed |
   | `soft_bounce`, `deferred`, `delivered`, opens, clicks, others | — | Acknowledged (200) and ignored |

   When the event is about an order or gift card email, that `order_emails` row becomes `failed`,
   with the reason in `last_error` (e.g. `hard_bounce: 550 5.1.1 User unknown`). The app finds the
   row by the `X-Mailin-custom: order-email:<id>` header it sends, which Brevo echoes back, or
   else by the Message-ID.

The route answers 401 for a wrong or missing token, 400 for a body that isn't JSON and 422 for one
that isn't a Brevo event.

## 6. Check that it works

1. **mail-tester.com.** Open [mail-tester.com](https://www.mail-tester.com/), copy the address it
   shows, and send a message there from the site. The easiest way is the contact form with
   `CONTACT_INBOX` temporarily set to that address; you can also place a test order with that
   address as the customer email. Click **Then check your score**. **Aim for 9/10 or more.** The
   report lists anything missing (SPF, DKIM, DMARC, blacklists, HTML problems).
2. **Gmail.** Place a test order with a Gmail address. In Gmail, open the confirmation, then
   **⋮ → Show original**. The summary at the top must say:
   - **SPF:** `PASS` with IP …
   - **DKIM:** `PASS` with domain `jassmin.ua`
   - **DMARC:** `PASS`

   Also check that the message isn't in Spam, and that both the HTML and the plain-text part are
   in the source (`Content-Type: multipart/alternative`).
3. **Ukr.net.** Send a test order to a `@ukr.net` mailbox and check that it arrives in the inbox.
4. **Webhook.** Order with an address that can't exist on a real domain, e.g.
   `no-such-user-1234@gmail.com`. Within a minute or two:
   ```sql
   SELECT * FROM email_suppressions ORDER BY created_at DESC LIMIT 5;
   SELECT id, status, last_error FROM order_emails ORDER BY id DESC LIMIT 5;
   ```
   should show the address as `hard_bounce` and its confirmation as `failed`. Brevo's dashboard
   (**Transactional → Logs**) shows the webhook calls and their responses.

## 7. Tighten DMARC after two weeks

`p=none` only collects reports. After **two weeks** of reports showing that only Brevo (and your
mailbox host, if it sends as jassmin.ua) sends for the domain, and that they pass:

1. Change the `_dmarc` record to `v=DMARC1; p=quarantine; rua=mailto:dmarc@jassmin.ua; fo=1`.
   Receivers now put failing mail as jassmin.ua in spam, so nobody can pose as the shop.
2. Optionally, a month later and with clean reports: `p=reject`.

If a report shows a legitimate sender failing (for example a newsletter tool added later), add it
to SPF and DKIM before tightening.

## Suppressed addresses

The `email_suppressions` table (address, reason, detail, created_at) lists every address that gets
no more email. Every send checks it: the app's mailer (`app/.server/services/mailer.ts`) and the
retry job (`pnpm db:send-order-emails`) drop suppressed recipients, and an order email whose
recipient is suppressed is marked `failed` at once with `suppressed: <reason>`, without retries.
The contact form email goes to `CONTACT_INBOX`, so it's only affected if the shop's own inbox
bounces.

To let an address receive email again (the customer fixed their mailbox, or a complaint was a
mistake), delete its row:

```sql
SELECT * FROM email_suppressions WHERE address = 'olena@example.com';
DELETE FROM email_suppressions WHERE address = 'olena@example.com';
```

Addresses are stored lowercase. To resend an order email that failed, queue it again (the retry
job sends it within 5 minutes):

```sql
UPDATE order_emails
SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL, updated_at = now()
WHERE id = <id>;
```

If Brevo itself also blocked the address, remove it from Brevo's list too, under
**Transactional → Contacts → Blocked contacts**.

## Local development

Nothing changes locally: `pnpm aspire run` passes smtp4dev as `SMTP_URL`, and without Aspire you
run `docker run --rm -p 5000:80 -p 2525:25 rnwood/smtp4dev:v3` with
`SMTP_URL=smtp://localhost:2525` (see [Home page and contact form](setup.md#home-page-and-contact-form)).
smtp4dev shows both the HTML and the text part of each message. The webhook can't reach a local
machine; its behaviour is covered by tests (`app/routes/hooks.email.test.ts`), and you can try it
with curl:

```bash
curl -i http://localhost:5173/hooks/email \
  -H "Authorization: Bearer $EMAIL_WEBHOOK_SECRET" -H "content-type: application/json" \
  -d '{"event":"hard_bounce","email":"test@example.com","reason":"550 test"}'
```

## Switching providers

The sending code is provider-neutral: another SMTP provider only needs a new `SMTP_URL` and its own
DNS records (SPF include, DKIM keys). Only the webhook is Brevo-specific: write a new schema and
adapter next to `app/.server/email/webhook-brevo.schema.ts` and `webhook-brevo.ts` that turn the
provider's events into `EmailEvent`s, and point `/hooks/email` at them.
