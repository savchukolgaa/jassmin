# Plan: Build home page with hero, about us, location and contacts sections (#7)

Issue: https://github.com/savchukolgaa/jassmin/issues/7
Branch: `issue/7`
Worktree: `../jassmin-worktrees/issue-7`
Status: Planned

## Goal
A first-time visitor lands on `/` and sees the current tester offer, the brand story, where the store
is and how to reach it. The home route renders four sections in order (Hero, About Us, Location,
Contacts). All copy, images and contact details come from Strapi (`home-page` and `site-settings`),
and the Contacts section has a contact form handled by the home route's `action` that works without
JS and emails the store over SMTP (smtp4dev locally).

## Dependencies & prerequisites
- **#2 (closed)**: `Button`, `ButtonLink`, `buttonClasses` in `app/components/ui/`.
- **#6 (closed)**: `_shop` layout with the header; `ABOUT_LINK` (`/#about`) and `CONTACTS_LINK`
  (`/#contacts`) in `app/components/layout/nav.ts`; the `_shop` `ErrorBoundary` already renders a
  friendly 503 via `describeRouteError` (`app/lib/route-error.ts`).
- **#20 (closed)**: `getHomePage()`, `getSiteSettings()` in `app/.server/cms/content.ts`,
  `cmsUnavailable` in `app/.server/cms/errors.ts`, DTOs in `app/lib/cms.ts`, fixtures in
  `app/.server/cms/__fixtures__/`, seed in `cms/scripts/seed.ts`.
- **#27 (open, not on `main`)**: C+ design foundation: theme tokens (`--color-primary: #c22f4b`,
  `ink`, `blush`, …), Manrope, pill `Button` variants incl. `dark` and `outline-light`, footer,
  motion utilities and `docs/design.md`. The page follows the C+ canvas page
  **"Option C+ — Bold blush, upgraded (chosen)"** (`HomeBoldPlus`).
  **Implement #7 after #27 is merged** (rebase `issue/7` onto `origin/main`). If #27 is still open
  when #7 starts, build with today's tokens/variants and apply the C+ classes in a follow-up commit
  once #27 lands.
- **Popular perfumes page (new issue, not built yet)**: `/popular`, the target of "Order Now".
  Until it's merged, the CTA leads to a 404; that's accepted and noted in the PR.
- **Remaining C+ home sections (new issue)**: marquee, How it works, Build your trio, category
  tiles, Bestsellers. Not part of #7.
- New packages (server-only): `marked`, `sanitize-html`, `nodemailer`; dev: `@types/sanitize-html`,
  `@types/nodemailer`.
- New env vars: `SMTP_URL`, `CONTACT_INBOX`, `CONTACT_FROM` (see step 6).
- New Aspire resource: `smtp4dev` container (`rnwood/smtp4dev`).
- No DB migrations.
- Local data: `pnpm cms:seed` (home page + site settings) and `STRAPI_API_TOKEN` in `.env`.

## Decisions & assumptions
- **Route & data flow.** `app/routes/home.tsx` stays the index route. `loader` calls
  `getHomePage()` and `getSiteSettings()` with `Promise.all`, each wrapped in
  `.catch(cmsUnavailable)`, so a Strapi outage becomes a 503 rendered by the existing `_shop`
  `ErrorBoundary` (header kept). The placeholder `getDatabaseInfo()` call is removed from the home
  route; `app/.server/db/queries/health.ts` and its test stay.
- **Markdown.** `about.body` is Strapi `richtext` (Markdown). The loader renders it to sanitized
  HTML on the server (`renderMarkdown` in `app/.server/markdown.ts`: `marked` → `sanitize-html` with
  a strict allowlist: `p, br, strong, em, ul, ol, li, a, h3, h4, blockquote`; `a[href]` only
  `http`, `https`, `mailto`, `tel`; external links get `rel="noopener noreferrer"`). The component
  injects it with `dangerouslySetInnerHTML`. The loader returns `about: { title, bodyHtml }`.
- **Plain-text multiline fields** (`openingHours`, `customerServiceHours`) are rendered as text with
  `whitespace-pre-line`, never as HTML.
- **Hero layout (C+).** Deep-pink hero band (`bg-primary`, white text), two columns on `md+`,
  stacked on mobile (text first, image second). Left: eyebrow, the Strapi `headline` as `<h1>`, the
  CTA. Right: Strapi hero image in an arch frame (top radius = half the width) with the
  "only 499₴ for 3" `spin-in` badge. The canvas's marquee and second CTA belong to the new
  home-sections issue.
- **CTA: "Order Now" → `/popular`.** Label and href still come from Strapi; the seed and fixture
  change to `ctaLabel: "Order Now"`, `ctaHref: "/popular"`. The `/popular` page itself is the new
  popular perfumes issue. Style: #27's `dark` variant (`bg-ink`), since `#FF5C77` + white fails WCAG
  AA and a `primary` (deep pink) button would vanish on the pink hero. Before #27 lands:
  `variant="primary"`. A pure helper `resolveCtaHref(href)` in `app/lib/links.ts` returns
  `{ kind: "internal", to }` for paths starting with a single `/`, `{ kind: "external", href }` for
  `https:` URLs, and falls back to `/popular` for anything else (e.g. `javascript:`).
  Internal → `ButtonLink`; external → `<a>` with `buttonClasses()`. Existing local Strapi data
  needs a manual edit in the admin (the seed skips existing single types).
- **Hero image optimisation.** Extend the media schema with Strapi's `formats`
  (`thumbnail/small/medium/large`, each `{ url, width, height }`), and `CmsImage` with
  `srcSet: string | null` built from the formats plus the original (absolute URLs, `"<url> <w>w"`).
  The hero `<img>` uses `srcSet`, `sizes="(min-width: 768px) 50vw, 100vw"`, explicit
  `width`/`height`, `fetchPriority="high"`, `decoding="async"` and `alt` from Strapi. A missing hero
  image renders a blush placeholder block (`aria-hidden`).
- **About Us** (`<section id="about">`, blush background): "About us" eyebrow, `about.title` as
  `<h2>`, sanitized body. The canvas's store photo isn't in the Strapi model, so it's omitted.
- **Location**: eyebrow, heading, address and opening hours with inline-SVG icons, a
  "Get directions" link (`https://www.google.com/maps/search/?api=1&query=<encoded address>`), and
  the map `<iframe>` (`title="Map: <address>"`, `loading="lazy"`,
  `referrerPolicy="no-referrer-when-downgrade"`). The map is only rendered when `mapEmbedUrl` passes
  `safeMapEmbedUrl()`: `https:`, host `www.google.com` / `maps.google.com`, `/maps` path.
- **Contacts** (`<section id="contacts">`, `ink` background): phone (`tel:` link), email
  (`mailto:`), customer service hours, social links as `outline-light` pill buttons (labels from
  `SOCIAL_LABELS: Record<SocialPlatform, string>` in `app/lib/cms.ts`, `target="_blank"
  rel="noopener noreferrer"`), and the contact form in a white card.
- **Contact form.**
  - `fetcher.Form method="post"` posting to the home route `action` (a resource route would show
    raw JSON without JS).
  - Fields: `name` (1–100), `email` (valid, ≤254), `message` (10–2000), plus the honeypot `website`
    (visually hidden, `tabIndex={-1}`, `autoComplete="off"`, `aria-hidden`). Validation:
    `contactFormSchema` in `app/features/home/contact-form.ts` (isomorphic; also feeds `maxLength`).
  - Action result (typed union in `app/lib/contact.ts`):
    `{ status: "success" } | { status: "invalid", fieldErrors, values } | { status: "rate_limited" }
    | { status: "delivery_failed", values }`. Returned with `data(result, { status: 400 | 429 | 503 })`;
    user mistakes never throw. `delivery_failed` keeps the typed values and suggests phoning or
    emailing the store directly.
  - **Works without JS:** the browser POSTs to `/?index`, the page re-renders with `actionData`.
    The component reads `fetcher.data ?? actionData`. The form's `action` is `"/?index#contacts"`
    so a no-JS submit lands back on the contacts section (verify React Router keeps the hash).
  - With JS: `Button loading` while `fetcher.state !== "idle"`, `role="status"` success message,
    form reset on success, errors under each field with `aria-invalid` / `aria-describedby`, focus
    on the first invalid field.
  - Honeypot filled → `{ status: "success" }` without sending.
  - `shouldRevalidate` skips re-running the CMS loader after the contact POST.
- **Rate limiting.** In-memory fixed-window limiter `createRateLimiter({ limit, windowMs, now? })`
  in `app/.server/rate-limit.ts`. Contact: 5 submissions / 10 minutes per client key (first
  `X-Forwarded-For` entry, else `X-Real-IP`, else `"anonymous"`). **(unconfirmed)** Fine for one
  Node instance; a shared store is a follow-up if the app is scaled out.
- **Email delivery via SMTP, smtp4dev locally.**
  - `app/.server/mail.ts`: `getMailTransport()` lazily creates one `nodemailer` transport from
    `SMTP_URL` (`connectionTimeout`/`greetingTimeout`/`socketTimeout` ≈ 5–10 s). Tests inject a
    transport instead (`nodemailer` `jsonTransport`).
  - `app/.server/services/contact.ts`: `deliverContactMessage(message, transport)` sends a
    **plain-text** email: `from: CONTACT_FROM`, `to: CONTACT_INBOX`, `replyTo: visitor email`,
    subject `"New message from <name> — jassmin.ua"` (name with CR/LF stripped), body with name,
    email, received-at time and the message. SMTP errors are caught, logged with `console.error`,
    and returned as `delivery_failed`.
  - When `SMTP_URL` is not set: in `development`/`test` the message is logged with
    `console.info("[contact]", …)` and treated as delivered (so the app runs without smtp4dev); in
    `production` it's `delivery_failed` plus an error log.
  - **Aspire:** add a `smtp4dev` container (`builder.addContainer("smtp4dev", "rnwood/smtp4dev")`,
    pinned image tag via `withImageTag`) with an HTTP endpoint for the web UI
    (`withHttpEndpoint({ targetPort: 80, name: "http" })`) and an SMTP endpoint
    (`withEndpoint({ targetPort: 25, name: "smtp", scheme: "smtp" })`), plus `withDataVolume`/
    `withVolume` so messages survive restarts (optional). `web` gets
    `.withEnvironment("SMTP_URL", smtp4dev.getEndpoint("smtp"))` and doesn't wait for it (like
    `cms`: a mail outage only affects the contact form). Check the exact method names against
    `aspire-apphost/.aspire/modules/aspire.mts`.
  - **Without Aspire:** `docker run --rm -p 5000:80 -p 2525:25 rnwood/smtp4dev` and
    `SMTP_URL=smtp://localhost:2525`; UI at http://localhost:5000.
  - `CONTACT_INBOX` defaults to `hello@jassmin.ua` (the seeded store email); `CONTACT_FROM`
    defaults to `"Jassmin website <no-reply@jassmin.ua>"`. In smtp4dev every address is caught, so
    nothing leaves the machine.
- **SEO `meta`.** Title `"Jassmin — <hero.headline>"`; description = first ~160 chars of the about
  body as plain text (`toPlainText()`, computed in the loader as `metaDescription`); `og:title`,
  `og:description`, `og:image`, `og:type=website`. Fallback `"Jassmin"` when `loaderData` is missing.
- **Structure.** Section components in `app/features/home/` (`HeroSection.tsx`, `AboutSection.tsx`,
  `LocationSection.tsx`, `ContactsSection.tsx`, `ContactForm.tsx`, `icons.tsx`); `home.tsx` only
  composes them.

## Resolved questions
- **How are contact form submissions delivered?** — Emailed over SMTP; locally they go to smtp4dev
  (source: user answer on the plan, 2026-10-23).
- **Where does "Order Now" point?** — To a new page that shows only popular perfumes, `/popular`,
  built in its own new issue (source: user answer on the plan, 2026-10-23).
- **Are the extra C+ home sections part of #7?** — No, they go in a new issue (source: user answer
  on the plan, 2026-10-23).
- **Which button colour does "Order Now" use — `#FF5C77`?** — No: #27 replaces it with `#C22F4B`
  primary and a `dark` variant for "Order Now" because `#FF5C77` + white fails WCAG AA (source:
  #27).
- **Is the map optional?** — Strapi requires `location.mapEmbedUrl` (source:
  `cms/src/components/home/location.json`), but the app only renders it after validating it.
- **How is a Strapi outage shown?** — `.catch(cmsUnavailable)` throws a 503 that the `_shop`
  `ErrorBoundary` renders with the header (source: `app/.server/cms/errors.ts`,
  `app/routes/_shop.tsx`, `app/lib/route-error.ts`).
- **Does the header already link to the sections?** — Yes, `/#about` and `/#contacts` (source:
  `app/components/layout/nav.ts`). Sections need matching `id`s plus `scroll-mt-*` for the sticky
  64px header.
- **Is rich text Markdown or Strapi blocks?** — Markdown (source:
  `cms/src/components/home/about.json`, `app/lib/cms.ts`).
- **Is there a DB table for contact messages?** — No, and messages aren't stored in Strapi
  (source: #7, `app/.server/db/schema.ts`).
- **Component tests?** — Vitest runs only `app/**/*.test.ts` in `node`, so tests cover pure
  functions, the action and the loader (source: `vitest.config.ts`).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `package.json`, `pnpm-lock.yaml` | add `marked`, `sanitize-html`, `nodemailer` (+ types) |
| create | `app/.server/markdown.ts` (+ `.test.ts`) | `renderMarkdown()` (sanitized HTML), `toPlainText()` |
| modify | `app/.server/cms/schemas.ts` | media `formats` |
| modify | `app/lib/cms.ts` | `CmsImage.srcSet`, `SOCIAL_LABELS` |
| modify | `app/.server/cms/content.ts` (+ `content.test.ts`, `schemas.test.ts`) | build `srcSet` in `toImage` |
| modify | `app/.server/cms/__fixtures__/home-page.json` | `ctaLabel: "Order Now"`, `ctaHref: "/popular"` |
| modify | `cms/scripts/seed.ts` | same CTA in the seed |
| create | `app/lib/links.ts` (+ `.test.ts`) | `resolveCtaHref`, `safeMapEmbedUrl`, `telHref`, `directionsUrl` |
| create | `app/lib/contact.ts` | `ContactActionResult` type, field limits |
| create | `app/features/home/contact-form.ts` (+ `.test.ts`) | `contactFormSchema`, `parseContactForm(formData)` |
| create | `app/.server/rate-limit.ts` (+ `.test.ts`) | in-memory limiter, `clientKey(request)` |
| modify | `app/.server/env.ts` (+ `env.test.ts`) | `SMTP_URL`, `CONTACT_INBOX`, `CONTACT_FROM` |
| modify | `.env.example`, `README.md` | document the new env vars and smtp4dev |
| create | `app/.server/mail.ts` | lazy `nodemailer` transport from `SMTP_URL` |
| create | `app/.server/services/contact.ts` (+ `.test.ts`) | honeypot, rate limit, `deliverContactMessage` |
| modify | `aspire-apphost/apphost.mts` | `smtp4dev` container, `SMTP_URL` for `web` |
| modify | `aspire-apphost/AGENTS.md`, `app/.server/AGENTS.md` | document `smtp4dev` and the mail module |
| create | `app/features/home/HeroSection.tsx` | hero |
| create | `app/features/home/AboutSection.tsx` | about |
| create | `app/features/home/LocationSection.tsx` | location + map |
| create | `app/features/home/ContactsSection.tsx` | contact details + socials |
| create | `app/features/home/ContactForm.tsx` | `fetcher.Form`, field errors, success state |
| create | `app/features/home/icons.tsx` | pin, clock, phone, mail SVG icons (`aria-hidden`) |
| modify | `app/routes/home.tsx` | loader, action, meta, shouldRevalidate, page |
| create | `app/routes/home.test.ts` | loader/action tests with mocked CMS + services |

## Steps
- [x] **1. Markdown helper** — `pnpm add marked sanitize-html` and `pnpm add -D @types/sanitize-html`.
  Create `app/.server/markdown.ts`: `renderMarkdown(md)` (`marked.parse(md, { async: false, gfm:
  true })` → `sanitizeHtml` with the allowlist, `transformTags` adding `rel`/`target` on absolute
  links) and `toPlainText(md, maxLength)`. Tests: paragraphs/lists survive; `<script>`, `onerror=`,
  `javascript:` links and `<iframe>` are stripped; truncation at a word boundary.
- [x] **2. Responsive image data + CTA in seed/fixture** — `formats` in `strapiMedia`
  (`z.record(z.string(), z.object({ url, width, height }))`, nullish); `srcSet` on `CmsImage`,
  built in `toImage` (sorted by width, absolute URLs, `null` without widths); `SOCIAL_LABELS`.
  Update `content.test.ts` / `schemas.test.ts`. Set `ctaLabel: "Order Now"`, `ctaHref: "/popular"`
  in `cms/scripts/seed.ts` and `__fixtures__/home-page.json`. Check: `pnpm typecheck && pnpm test`.
- [x] **3. Link helpers** — `app/lib/links.ts`: `resolveCtaHref`, `safeMapEmbedUrl`, `telHref`,
  `directionsUrl`. Tests incl. `javascript:`, protocol-relative `//evil.com`, non-Google map hosts,
  empty strings.
- [ ] **4. Loader, meta and static sections** — Rewrite `app/routes/home.tsx`: parallel CMS loader
  returning `{ hero, about: { title, bodyHtml }, location: { …, mapEmbedUrl: safe | null },
  contacts, metaDescription }`, `meta`, and `HeroSection`, `AboutSection` (`id="about"`),
  `LocationSection`, `ContactsSection` (`id="contacts"`, form slot empty for now) inside `<main>`
  in that order. Sections get `scroll-mt-20`; add `scroll-behavior: smooth` on `html` in
  `app/app.css` under `prefers-reduced-motion: no-preference` (unless #27 already does). C+ styling,
  single column under `md`, no horizontal scroll at 375px. Check: view source of `/`; header links
  scroll to About/Kontakt.
- [ ] **5. Contact form validation** — `app/lib/contact.ts` (limits + `ContactActionResult`),
  `app/features/home/contact-form.ts`: `contactFormSchema` (trimmed strings) and
  `parseContactForm(formData)` → `{ ok: true, data, honeypot } | { ok: false, fieldErrors, values }`
  via `z.flattenError`. Tests: valid input, each field's errors, whitespace-only, over-long values,
  `File` entries.
- [ ] **6. Env vars + mail transport + smtp4dev** — `pnpm add nodemailer`,
  `pnpm add -D @types/nodemailer`. In `env.ts` add `SMTP_URL` (optional URL with `smtp:`/`smtps:`
  scheme), `CONTACT_INBOX` (`z.email()`, default `hello@jassmin.ua`), `CONTACT_FROM` (string,
  default `Jassmin website <no-reply@jassmin.ua>`); cases in `env.test.ts`; `.env.example` and the
  README env table. Create `app/.server/mail.ts` (`getMailTransport(): Transporter | null`). In
  `aspire-apphost/apphost.mts` add the `smtp4dev` container (HTTP UI + SMTP endpoints, external
  HTTP endpoint so the UI opens from the dashboard) and pass `SMTP_URL` to `web` without
  `waitFor`. Check: `pnpm aspire:build`, then `pnpm aspire run` shows `smtp4dev` with a UI link.
- [ ] **7. Rate limiter and contact service** — `app/.server/rate-limit.ts`:
  `createRateLimiter({ limit, windowMs, now? })` → `check(key): { allowed, retryAfterMs }`, and
  `clientKey(request)`. `app/.server/services/contact.ts`: `submitContactMessage(input, { key,
  transport })` → honeypot short-circuit → limiter → `deliverContactMessage()` → result. Tests with
  fake `now` and a `jsonTransport`: limit reached, window reset, separate keys, header parsing,
  honeypot never sends, email fields (`to`, `replyTo`, subject without CR/LF, plain-text body),
  transport error → `delivery_failed`, no `SMTP_URL` in dev → logged and success.
- [ ] **8. Action + ContactForm UI** — In `home.tsx` add `action({ request })`: parse
  `request.formData()`, return `data({ status: "invalid", … }, { status: 400 })` on errors, call
  `submitContactMessage`, map to 429 / 503 / success. Add `shouldRevalidate`. Build `ContactForm.tsx`
  with `useFetcher<typeof action>()`, `fetcher.data ?? actionData`, labelled inputs, per-field
  errors, `maxLength`, honeypot, `Button loading`, success (`role="status"`) and rate-limit /
  delivery-failed (`role="alert"`) messages, reset + focus handling. Plug it into
  `ContactsSection`. Check with JS on and disabled; open the smtp4dev UI and confirm the email
  arrived with the right reply-to.
- [ ] **9. Route tests** — `app/routes/home.test.ts`: `vi.mock` `~/.server/cms/content` and
  `~/.server/services/contact`. Loader: mapped data from fixtures; unsafe `mapEmbedUrl` → `null`;
  `CmsError` → thrown 503. Action: invalid → 400; valid → success, delivered once; rate limited →
  429; delivery failure → 503 with values; honeypot → success without delivery.
- [ ] **10. Docs & polish** — README: "Home page" note (content in Strapi `home-page` /
  `site-settings`, contact emails, smtp4dev UI under Aspire / docker command without it, rate
  limit). Update `aspire-apphost/AGENTS.md` (resource list) and `app/.server/AGENTS.md` (mail
  module, new env vars). Run all checks and an axe/Lighthouse pass on `/` at desktop and 375px
  (contrast, labels, one `h1`, section `h2`s).

## Testing & verification
- Unit: `markdown.test.ts`, `links.test.ts`, `contact-form.test.ts`, `rate-limit.test.ts`,
  `services/contact.test.ts`, `env.test.ts`, updated `cms/content.test.ts` + `cms/schemas.test.ts`,
  `routes/home.test.ts`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm aspire:build`, `pnpm build`.
- Manual (`pnpm aspire run`, seeded Strapi):
  - View source of `/`: hero headline, about text, address and contact details are in the HTML.
  - Edit the headline / hours in the Strapi admin, reload `/`: the change shows without a rebuild.
  - Click "Order Now": navigates to `/popular` (404 until the popular perfumes issue is merged).
  - Header "About us" / "Kontakt" from `/` and from another page scroll to the right section and
    the heading isn't hidden under the sticky header.
  - Contact form: empty submit, bad email, short message, success → email visible in the smtp4dev
    UI; 6 quick submissions → rate-limit message; stop `smtp4dev` → delivery-failed message; repeat
    with JS disabled.
  - Stop `cms` (or unset `STRAPI_API_TOKEN`): `/` shows the 503 page with the header.
  - Responsive at 375px, 768px, 1280px; no horizontal scroll.

## Acceptance criteria
- [ ] Sections render server-side in order: Hero, About Us, Location, Contacts — step 4
- [ ] Section text, images and contact details come from Strapi, and changing them in Strapi updates the page without a deploy — steps 2, 4
- [ ] "Order Now" uses the primary button style and navigates correctly — steps 2, 3, 4 (C+ `dark` variant per #27; target `/popular` from the new issue)
- [ ] Header "About us" / "Kontakt" links scroll to the right sections — step 4
- [ ] Contact form validates input, shows success/error states and works without client JS — steps 5–9
- [ ] The page shows an error page, not a crash, when Strapi is unreachable — steps 4, 9
- [ ] Page is responsive on mobile and desktop — steps 4, 8, 10

## Out of scope
- The `/popular` page itself (new popular perfumes issue).
- The C+ marquee, "How it works", "Build your trio", category tiles and Bestsellers (new
  home-sections issue).
- Storing contact messages in the database, and choosing a production SMTP provider.
- Theme tokens, Manrope, button variants, footer and motion utilities (#27).
- A shared/distributed rate-limit store, CAPTCHA, CSP headers, and `Cache-Control` tuning.
- Changing the Strapi content model (e.g. a store photo or hero subtitle field).
