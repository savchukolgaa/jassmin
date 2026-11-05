# Security headers, CSP and rate limits

Every response the app renders carries the standard browser security headers, every HTML page gets a Content-Security-Policy with a new nonce per request, and the rate limits are kept in PostgreSQL (#143). This page explains each part, how to change it, and what to check after deploying.

## Where the headers come from

`securityHeadersMiddleware` (`app/.server/security-headers.ts`) is the first entry in `root.tsx`'s `middleware`, so it wraps every response React Router produces: pages, `.data` requests from client navigations, resource routes (`/sitemap.xml`, `/robots.txt`, `/og/products/*.png`, `/cms/*`, `/payments/*`, `/api/events`, `/csp-report`), redirects and error pages. It makes the nonce, puts it in `nonceContext`, waits for the response and sets the headers on it. The builders (`buildCsp`, `buildSecurityHeaders`) are pure functions with unit tests next to them.

Static files (`/assets/*` and `public/`) are served by `react-router-serve` before the app runs, so they don't get these headers. That's fine: securityheaders.com grades the HTML page, and fingerprinted JS, CSS and fonts can't be framed. If you want `X-Content-Type-Options: nosniff` on them too, add it in the hosting proxy.

## The headers

| Header | Value | Why |
|--------|-------|-----|
| `Content-Security-Policy` (or `-Report-Only`) | see below, HTML only | Only scripts carrying this request's nonce run, so injected markup can't execute (XSS). |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Browsers use HTTPS for a year after the first visit, so a later visit can't be downgraded to plain HTTP. Sent only when `NODE_ENV=production` **and** `PUBLIC_SITE_URL` is `https://`: behind a TLS-terminating proxy the request itself is HTTP. No `preload` until the domain is final. |
| `X-Content-Type-Options` | `nosniff` | Browsers trust the `Content-Type` instead of guessing, so an upload can't be run as a script. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Other sites only see the shop's origin, never a path with an order id or a query. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` | The shop and anything it embeds can't ask for these. |
| `X-Frame-Options` | `DENY` | No framing (clickjacking), for browsers that don't know `frame-ancestors`. |
| `Cross-Origin-Opener-Policy` | `same-origin` | A window the shop opens, or that opens the shop, can't reach into it. |
| `Reporting-Endpoints` | `csp="/csp-report"` | Where the Reporting API sends CSP reports (HTML only). |

## The Content-Security-Policy

```
default-src 'self';
script-src 'self' 'nonce-<per request>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: <STRAPI_URL origin>;
font-src 'self' data:;
connect-src 'self';                      (+ ws: in development, for Vite's HMR)
frame-src https://www.google.com https://maps.google.com;
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none';
report-uri /csp-report; report-to csp
```

- **Scripts:** `entry.server.tsx` passes the nonce to React (its own streaming scripts), to `<ServerRouter>` and, through `NonceProvider` / `useNonce()` (`app/lib/nonce.tsx`), to the root layout's inline theme script, `<Links>`, `<ScrollRestoration>` and `<Scripts>`. `'strict-dynamic'` lets the nonced bootstrap load the route modules. Never add `'unsafe-inline'` to `script-src`: give a new inline script `nonce={useNonce()}` instead. JSON-LD blocks (`type="application/ld+json"`) aren't executed and need no nonce.
- **Styles:** `'unsafe-inline'` stays because of React `style` attributes (the order progress bar in `OrderProgress.tsx`) and the `<style>` tags Vite injects in development. To drop it, replace inline `style` attributes with classes (or CSS variables set from a class), then check the dev server too.
- **Images:** CMS and product images are absolute `STRAPI_URL` upload URLs, so the policy takes that origin from the env.
- **Fonts:** self-hosted `@fontsource` files; Vite inlines the small subsets as `data:` URIs.
- **Frames:** the home page map is Strapi's `mapEmbedUrl`, a Google Maps embed.
- **Forms:** forms post only to the shop.

### Adding an allowed origin

Edit `buildCsp` in `app/.server/security-headers.ts`, add a case to `security-headers.test.ts`, and check the affected page in the browser with `CSP_MODE=enforce`. Common cases:

- **Another map provider** (OpenStreetMap, Mapbox): add its embed origin to `FRAME_ORIGINS`.
- **A real card payment provider** (e.g. LiqPay's hosted checkout): add its origin to `form-action`. Chrome also checks `form-action` against the redirect after a form POST, so the checkout redirect to the provider's page is blocked without it.
- **An image CDN or cloud upload provider for Strapi**: add its origin to `img-src` (or derive it from a new env var next to `STRAPI_URL`).
- **Third-party scripts** (analytics, chat): a plain `<script src>` from another origin is blocked. Load it from a nonced script instead (`'strict-dynamic'` then trusts what that script loads), and add its beacon or font origin to `connect-src` / `font-src`.

## Report-only and enforced mode (`CSP_MODE`)

| `CSP_MODE` | Header | Effect |
|------------|--------|--------|
| `report-only` (default) | `Content-Security-Policy-Report-Only` | Nothing is blocked; violations are reported to `/csp-report` and logged. |
| `enforce` | `Content-Security-Policy` | Violations are blocked, and still reported. |

Release with `report-only`, watch the logs for a week, fix any real violation, then set `CSP_MODE=enforce` and restart. Development and CI can run with `enforce` to catch problems early. Switching back to `report-only` is the emergency off switch if a deploy breaks a page.

## Reading CSP reports

`/csp-report` (`app/routes/csp-report.ts`) accepts both report formats (`application/csp-report` from `report-uri`, `application/reports+json` from `report-to`), at most 16 KB per request and 30 requests per client IP per minute (counted in memory, so a report flood never becomes database writes). It stores nothing and answers 204. Each violation becomes one log line:

```
[csp] {"directive":"script-src-elem","blockedUri":"https://evil.example/x.js","documentPath":"/vkhid","disposition":"report"}
```

Query strings and fragments are removed from every URL first, so tokens or emails in a URL never reach the logs.

- `directive` is what was violated, `blockedUri` what was blocked (`inline` / `eval` for inline code), `documentPath` the page.
- **Noise:** browser extensions inject scripts and styles into every page, so you'll see `chrome-extension:` / `moz-extension:` sources or `inline` violations on random pages from a few visitors. Ignore those.
- **Real problems** show up on many visitors and the same `documentPath`, e.g. a new third-party image origin in `img-src` after staff linked one in Strapi, or `inline` on every page after someone added an inline script without the nonce.

## Rate limits

Failed logins (5 per email and 20 per IP per 15 minutes), wrong current passwords on the profile page (5 per user), refused promo and gift card codes (10 per client per 15 minutes), contact messages (5 per client per 10 minutes) and analytics beacons (60 per client per minute) are counted in the `rate_limits` table (`app/.server/rate-limit.ts`). So the limits survive restarts and deploys, and every app instance shares them. Each hit is one atomic `INSERT … ON CONFLICT DO UPDATE`, so concurrent hits are all counted. The stored key is the limiter's name and a SHA-256 of the email, user id or IP, never the value itself. `pnpm db:prune-rate-limits` (daily cron) deletes ended windows; see [setup.md](setup.md#rate-limits).

## Client IP

The per-IP limits need the client's IP, which behind a proxy only arrives in `X-Forwarded-For`. A client can send that header itself, so only the entries added by your own proxies count. `TRUSTED_PROXY_HOPS` says how many there are, and `getClientIp` (`app/.server/client-ip.ts`) takes the entry that many places from the right:

| Setup | `TRUSTED_PROXY_HOPS` | `X-Forwarded-For` the app sees | Client IP |
|-------|----------------------|--------------------------------|-----------|
| No proxy (or unknown) | `0` (default) | ignored | unknown |
| One hosting proxy / load balancer | `1` | `<anything the client sent>, 203.0.113.7` | `203.0.113.7` |
| CDN in front of a load balancer | `2` | `…, 203.0.113.7, <CDN edge>` | `203.0.113.7` |

With `0` the IP is unknown, because `react-router-serve` doesn't give the app the socket address. The per-IP login limit is then skipped (the per-email one still applies), and the other limits fall back to the visitor id, or one key shared by everyone (the contact form, `/csp-report`). Production logs a warning at startup in that case. So set `TRUSTED_PROXY_HOPS` to the number of proxies in front of the app as soon as hosting is decided. Too high a number lets clients pick their own IP again.

## After deploying

1. `curl -I https://<domain>/` shows the headers above, including `Strict-Transport-Security`, and `curl -I https://<domain>/sitemap.xml` all of them except the CSP.
2. Check [securityheaders.com](https://securityheaders.com/) for the home page: the target is **A** or better. In `report-only` mode it doesn't count the CSP as present, so expect the final grade after switching to `enforce`.
3. Watch the `[csp]` log lines for a week, then switch `CSP_MODE` to `enforce`.
4. Make sure `TRUSTED_PROXY_HOPS` matches the hosting setup (no startup warning), and that the `pnpm db:prune-rate-limits` cron job runs.
