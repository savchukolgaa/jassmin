# Plan: Build home page with hero, about us, location and contacts sections (#7)

Issue: https://github.com/savchukolgaa/jassmin/issues/7
Branch: `issue/7`
Worktree: `../jassmin-worktrees/issue-7`
Status: Planned

## Goal
A first-time visitor lands on `/` and sees the current tester offer, the brand story, where the store
is and how to reach it. The home route renders four sections in order (Hero, About Us, Location,
Contacts). All copy, images and contact details come from Strapi (`home-page` and `site-settings`),
and the Contacts section has a contact form handled by the home route's `action` that works without JS.

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
  motion utilities (`fade-up`, `spin-in`, `marquee`, `reveal`) and `docs/design.md`. The page layout
  follows the C+ canvas page **"Option C+ — Bold blush, upgraded (chosen)"** (`HomeBoldPlus`).
  **Implement #7 after #27 is merged** (rebase `issue/7` onto `origin/main`). If #27 is still open
  when #7 starts, build with today's tokens/variants and leave the C+-specific classes for a
  follow-up commit once #27 lands.
- New packages: `marked` (Markdown → HTML) and `sanitize-html` + `@types/sanitize-html` (server-side
  sanitizing). Both are server-only. #13 will reuse the same helper for blog posts.
- No new env vars, no DB migrations.
- Local data: `pnpm cms:seed` (home page + site settings) and `STRAPI_API_TOKEN` in `.env`.

## Decisions & assumptions
- **Route & data flow.** `app/routes/home.tsx` keeps its index route. `loader` calls
  `getHomePage()` and `getSiteSettings()` with `Promise.all`, each wrapped in
  `.catch(cmsUnavailable)`, so a Strapi outage becomes a 503 rendered by the existing `_shop`
  `ErrorBoundary` (header kept). The placeholder `getDatabaseInfo()` call is removed from the home
  route; `app/.server/db/queries/health.ts` and its test stay (they're still a useful health check).
- **Markdown.** `about.body` is Strapi `richtext` (Markdown). The loader renders it to sanitized
  HTML on the server (`renderMarkdown` in `app/.server/markdown.ts`: `marked` → `sanitize-html` with
  a strict allowlist: `p, br, strong, em, ul, ol, li, a, h3, h4, blockquote`; `a[href]` only
  `http`, `https`, `mailto`, `tel`; external links get `rel="noopener noreferrer"`). The component
  injects the returned string with `dangerouslySetInnerHTML`. The loader returns
  `about: { title, bodyHtml }` instead of the raw Markdown.
- **Plain-text multiline fields** (`openingHours`, `customerServiceHours`) are rendered as text with
  `whitespace-pre-line`, never as HTML.
- **Hero layout & CTA (C+).** Deep-pink hero band (`bg-primary`, white text), two columns on `md+`,
  stacked on mobile (text first, image second). Left: small eyebrow, the Strapi `headline` as
  `<h1>`, and the CTA as `ButtonLink` with `ctaLabel` / `ctaHref`. Right: Strapi hero image in an
  arch frame (top radius = half the width) with the "only 499₴ for 3" `spin-in` badge from the
  canvas. The canvas's second CTA ("See all perfumes") and the scrolling offer marquee are included
  as static decoration only if #27's utilities exist (marquee is `aria-hidden`).
- **CTA button style.** The issue asks for `#FF5C77` "primary". #27 supersedes this: `#FF5C77`
  with white text fails WCAG AA, `primary` becomes `#C22F4B`, and "Order Now" uses the new `dark`
  variant (`bg-ink`), which is also the only variant visible on the pink hero. Before #27 lands:
  `variant="primary"`.
- **CTA href.** `ctaHref` is editor-controlled. A small pure helper `resolveCtaHref(href)` in
  `app/lib/links.ts` returns `{ kind: "internal", to }` for paths starting with a single `/`,
  `{ kind: "external", href }` for `https:` URLs, and falls back to `/catalog/women` for anything
  else (e.g. `javascript:`). Internal → `ButtonLink`; external → `<a>` with `buttonClasses()`.
  **(unconfirmed, see Q2)** The seed and fixture currently use `/catalog`, which 404s because only
  `/catalog/:gender` exists; the seed/fixture default changes to `/catalog/women`.
- **Hero image optimisation.** Extend the media schema with Strapi's `formats`
  (`thumbnail/small/medium/large`, each `{ url, width, height }`), and `CmsImage` with
  `srcSet: string | null` built from the formats plus the original (absolute URLs, `"<url> <w>w"`).
  The hero `<img>` uses `srcSet`, `sizes="(min-width: 768px) 50vw, 100vw"`, explicit
  `width`/`height`, `fetchPriority="high"`, `decoding="async"` and `alt` from Strapi. A missing hero
  image renders a blush placeholder block (`aria-hidden`), not a broken image.
- **About Us** (`<section id="about">`, blush background): "About us" eyebrow, `about.title` as
  `<h2>`, sanitized body. The canvas's store photo isn't in the Strapi model, so it's omitted.
- **Location**: eyebrow, heading, address and opening hours with inline-SVG icons, a
  "Get directions" link (`https://www.google.com/maps/search/?api=1&query=<encoded address>`,
  `outline`/secondary style), and the map `<iframe>` (`title="Map: <address>"`,
  `loading="lazy"`, `referrerPolicy="no-referrer-when-downgrade"`, rounded card). The map is only
  rendered when `mapEmbedUrl` passes `safeMapEmbedUrl()`: `https:` and host `www.google.com` /
  `maps.google.com` with a `/maps` path. Otherwise the section shows address/hours only.
- **Contacts** (`<section id="contacts">`, dark `ink` background): phone (`tel:` link, digits and
  `+` only), email (`mailto:`), customer service hours, social links as `outline-light` pill
  buttons (label from a `SOCIAL_LABELS: Record<SocialPlatform, string>` map in `app/lib/cms.ts`,
  `target="_blank" rel="noopener noreferrer"`), and the contact form in a white card.
- **Contact form.**
  - `fetcher.Form method="post"` posting to the home route `action` (no separate resource route:
    without JS a resource route would show raw JSON). An `intent` field is unnecessary because the
    home route has a single action.
  - Fields: `name` (1–100), `email` (valid, ≤254), `message` (10–2000), plus the honeypot `website`
    (visually hidden, `tabIndex={-1}`, `autoComplete="off"`, `aria-hidden`). Validation is a zod
    schema `contactFormSchema` in `app/features/home/contact-form.ts` (isomorphic, also gives the
    client the same max lengths for `maxLength` attributes).
  - Action result (typed union in `app/lib/contact.ts`):
    `{ status: "success" } | { status: "invalid", fieldErrors, values } | { status: "rate_limited" }`.
    Returned with `data(result, { status: 400 | 429 })`; user mistakes never throw.
  - **Works without JS:** the browser POSTs to `/?index`, the page re-renders with `actionData`.
    The component reads `fetcher.data ?? actionData`. The form's `action` is `"/?index#contacts"`
    so a no-JS submit lands back on the contacts section (verify that React Router keeps the hash;
    if it doesn't, add `id="contacts"` scroll via the hash on the success re-render).
  - With JS: `Button` shows `loading` while `fetcher.state !== "idle"`, a `role="status"` success
    message appears and the form is reset (`useEffect` on `fetcher.data?.status === "success"`).
    Errors render under each field with `aria-invalid` / `aria-describedby`, and the first invalid
    field gets focus.
  - Honeypot filled → return `{ status: "success" }` without delivering (don't tip off bots).
  - `shouldRevalidate` on the home route skips re-running the CMS loader after the contact
    submission (`formAction` targets the home route and method is POST); the `_shop` loader still
    revalidates normally.
- **Rate limiting.** In-memory fixed-window limiter `createRateLimiter({ limit, windowMs })` in
  `app/.server/rate-limit.ts` (a `Map<key, { count, resetAt }>`, pruned on access, `now` injectable
  for tests). Contact uses 5 submissions / 10 minutes per client key. The key is the first
  `X-Forwarded-For` entry, else `X-Real-IP`, else `"anonymous"`. **(unconfirmed)** Good enough for a
  single Node instance; a shared store (Redis/Postgres) is a follow-up if the app is scaled out.
- **Delivery of messages.** **(unconfirmed, see Q1)** No email provider and no table exist.
  `app/.server/services/contact.ts` exposes `deliverContactMessage(message)` which, for now, logs a
  structured line (`console.info("[contact]", { name, email, length, receivedAt })` and the message
  body) so nothing is silently dropped in dev. The function is the single seam where email sending
  plugs in later; the action only depends on it.
- **SEO `meta`.** Title `"Jassmin — <hero.headline>"`; description = first ~160 chars of the about
  body as plain text (`toPlainText()` from the markdown helper, computed in the loader as
  `metaDescription`); `og:title`, `og:description`, `og:image` (hero image URL), `og:type=website`.
  When `loaderData` is missing (error), fall back to `"Jassmin"` / `"Jassmin perfume store"`.
- **Out-of-scope canvas sections.** The C+ canvas also shows "How it works", "Build your trio",
  category tiles and "Bestsellers". They aren't in the issue and need products (#8) and the trio
  picker; they're not built here **(unconfirmed, see Q3)**.
- **Structure.** Section components live in `app/features/home/` (`HeroSection.tsx`,
  `AboutSection.tsx`, `LocationSection.tsx`, `ContactsSection.tsx`, `ContactForm.tsx`) and take
  plain DTO props; `home.tsx` only composes them.

## Open questions
- [ ] **Q1: How should contact form submissions be delivered?** — Why it matters: the issue says
  "emailed to the store (or logged)" and asks to confirm; emailing needs a provider (SMTP / Resend /
  …), credentials and env vars; logging means messages only live in server logs. Recommended
  default: log via `deliverContactMessage()` now, add email delivery in a follow-up issue. Affects
  steps: 6.
- [ ] **Q2: Where should the hero CTA ("Order Now") point, and what should its label be?** — Why it
  matters: the seeded `ctaHref` is `/catalog`, which 404s (only `/catalog/:gender` exists, #8), the
  seeded label is "Choose your testers" while the issue says "Order Now", and the C+ canvas links it
  to the on-page trio picker. Recommended default: keep label/href from Strapi; change the seed and
  fixture to `ctaLabel: "Order Now"`, `ctaHref: "/catalog/women"`; editors can change it in Strapi
  once a tester-set page exists. Existing local Strapi data needs a manual edit (the seed skips
  existing single types). Affects steps: 2, 4.
- [ ] **Q3: Should the extra C+ home sections (How it works, Build your trio, category tiles,
  Bestsellers) be part of #7?** — Why it matters: they're on the chosen design but not in the
  issue, and Bestsellers/trio depend on products (#8) and cart (#10). Recommended default: no;
  build only the four issue sections (plus the decorative marquee if #27 provides it) and file a
  follow-up issue for the rest. Affects steps: 4.

## Resolved questions
- **Which button style/colour does "Order Now" use — `#FF5C77`?** — No: #27 replaces it with
  `#C22F4B` primary and a `dark` variant for "Order Now" because `#FF5C77` + white fails WCAG AA
  (source: #27, memory "Storefront design: Option C+").
- **Is the map optional?** — In Strapi `location.mapEmbedUrl` is required (source:
  `cms/src/components/home/location.json`, `app/.server/cms/schemas.ts`), but the app still treats
  it as optional at render time because it's validated against an allowlist before use.
- **How is a Strapi outage shown?** — Already handled: `.catch(cmsUnavailable)` throws a 503 that
  the `_shop` `ErrorBoundary` renders with the header (source: `app/.server/cms/errors.ts`,
  `app/routes/_shop.tsx`, `app/lib/route-error.ts`).
- **Does the header already link to the sections?** — Yes, `/#about` and `/#contacts` (source:
  `app/components/layout/nav.ts`). The sections only need matching `id`s plus `scroll-mt-*` so the
  sticky 64px header doesn't cover the heading.
- **Is rich text Markdown or Strapi blocks?** — Markdown (`richtext`) (source:
  `cms/src/components/home/about.json`, comment in `app/lib/cms.ts`).
- **Is there a DB table for contact messages?** — No, and the issue says submissions are not stored
  in Strapi (source: #7, `app/.server/db/schema.ts`).
- **Component tests?** — Vitest runs only `app/**/*.test.ts` in a `node` environment, so tests cover
  pure functions, the action and the loader, not rendered components (source: `vitest.config.ts`).

## Files
| Action | Path | Purpose |
|--------|------|---------|
| modify | `package.json`, `pnpm-lock.yaml` | add `marked`, `sanitize-html`, `@types/sanitize-html` |
| create | `app/.server/markdown.ts` (+ `.test.ts`) | `renderMarkdown()` (sanitized HTML), `toPlainText()` |
| modify | `app/.server/cms/schemas.ts` | media `formats` |
| modify | `app/lib/cms.ts` | `CmsImage.srcSet`, `SOCIAL_LABELS` |
| modify | `app/.server/cms/content.ts` (+ `content.test.ts`, `schemas.test.ts`) | build `srcSet` in `toImage` |
| modify | `app/.server/cms/__fixtures__/home-page.json` | `ctaLabel`/`ctaHref` per Q2 |
| modify | `cms/scripts/seed.ts` | seed `ctaLabel: "Order Now"`, `ctaHref: "/catalog/women"` |
| create | `app/lib/links.ts` (+ `.test.ts`) | `resolveCtaHref`, `safeMapEmbedUrl`, `telHref`, `directionsUrl` |
| create | `app/lib/contact.ts` | `ContactActionResult` type, field limits |
| create | `app/features/home/contact-form.ts` (+ `.test.ts`) | `contactFormSchema`, `parseContactForm(formData)` |
| create | `app/.server/rate-limit.ts` (+ `.test.ts`) | in-memory limiter, `clientKey(request)` |
| create | `app/.server/services/contact.ts` (+ `.test.ts`) | `submitContactMessage()`: honeypot, rate limit, deliver |
| create | `app/features/home/HeroSection.tsx` | hero |
| create | `app/features/home/AboutSection.tsx` | about |
| create | `app/features/home/LocationSection.tsx` | location + map |
| create | `app/features/home/ContactsSection.tsx` | contact details + socials |
| create | `app/features/home/ContactForm.tsx` | `fetcher.Form`, field errors, success state |
| create | `app/features/home/icons.tsx` | pin, clock, phone, mail SVG icons (`aria-hidden`) |
| modify | `app/routes/home.tsx` | loader, action, meta, shouldRevalidate, page |
| create | `app/routes/home.test.ts` | loader/action tests with mocked CMS + services |
| modify | `README.md` | note on contact form delivery and rate limit |

## Steps
- [ ] **1. Markdown helper** — `pnpm add marked sanitize-html` and `pnpm add -D @types/sanitize-html`.
  Create `app/.server/markdown.ts`: `renderMarkdown(md: string): string` (`marked.parse(md, {
  async: false, gfm: true })` then `sanitizeHtml` with the allowlist from Decisions, `transformTags`
  adding `rel`/`target` on absolute links) and `toPlainText(md, maxLength)` (sanitize with no
  allowed tags, collapse whitespace, cut at a word boundary with "…"). Tests: paragraphs/lists
  survive; `<script>`, `onerror=`, `javascript:` links and `<iframe>` are stripped; plain text
  truncation. Check: `pnpm test`.
- [ ] **2. Responsive image data + seed/fixture CTA** — In `schemas.ts` add
  `formats: z.record(z.string(), z.object({ url, width: int, height: int })).nullish()` to
  `strapiMedia`. In `app/lib/cms.ts` add `srcSet: string | null` to `CmsImage` and
  `SOCIAL_LABELS`. In `content.ts` `toImage`, build `srcSet` from formats + original sorted by
  width (absolute URLs; `null` when there are no widths). Update `content.test.ts` /
  `schemas.test.ts` expectations (hero `srcSet` from the fixture). Change `ctaLabel`/`ctaHref` in
  `cms/scripts/seed.ts` and `__fixtures__/home-page.json` (Q2). Check: `pnpm typecheck && pnpm test`.
- [ ] **3. Link helpers** — `app/lib/links.ts`: `resolveCtaHref`, `safeMapEmbedUrl(url): string |
  null`, `telHref(phone)` (`tel:` + `+`/digits), `directionsUrl(address)`. Unit tests for each,
  including `javascript:`, protocol-relative `//evil.com`, non-Google map hosts and empty strings.
- [ ] **4. Loader, meta and static sections** — Rewrite `app/routes/home.tsx`:
  `loader` → `Promise.all([getHomePage().catch(cmsUnavailable), getSiteSettings().catch(cmsUnavailable)])`
  and returns `{ hero, about: { title, bodyHtml }, location: { …, mapEmbedUrl: safe | null },
  contacts: siteSettings, metaDescription }`. Add `meta` per Decisions. Build `HeroSection`,
  `AboutSection` (`id="about"`), `LocationSection`, `ContactsSection` (`id="contacts"`, form slot
  left empty for now) in `app/features/home/`, in that order inside `<main>`. Sections get
  `scroll-mt-20`; add `scroll-behavior: smooth` on `html` in `app/app.css` inside a
  `prefers-reduced-motion: no-preference` query (unless #27 already does). Styling follows the C+
  canvas (hero `bg-primary` + arch image + badge, about `bg-blush`, contacts `bg-ink`), responsive:
  single column under `md`, no horizontal scroll at 375px. Check in the running app: `/` renders
  all four sections server-side (view source), header links scroll to About/Kontakt.
- [ ] **5. Contact form validation** — `app/lib/contact.ts` (limits + `ContactActionResult`),
  `app/features/home/contact-form.ts`: `contactFormSchema` (trimmed strings; messages in English
  matching the UI) and `parseContactForm(formData)` returning `{ ok: true, data, honeypot } |
  { ok: false, fieldErrors, values }` using `z.flattenError`. Tests: valid input, each field's
  errors, whitespace-only, over-long values, non-string `FormData` entries (`File`).
- [ ] **6. Rate limiter and contact service** — `app/.server/rate-limit.ts`:
  `createRateLimiter({ limit, windowMs, now? })` with `check(key): { allowed, retryAfterMs }`, and
  `clientKey(request)`. `app/.server/services/contact.ts`: `submitContactMessage(input, { key })`
  → honeypot short-circuit → limiter → `deliverContactMessage()` (log, per Q1) → result. Tests with
  fake `now`: limit reached, window reset, separate keys, header parsing, honeypot never delivers.
- [ ] **7. Action + ContactForm UI** — In `home.tsx` add `action({ request })`: read
  `request.formData()`, `parseContactForm`, return `data({ status: "invalid", … }, { status: 400 })`
  on errors; call `submitContactMessage`; return `data({ status: "rate_limited" }, { status: 429 })`
  or `{ status: "success" }`. Add `shouldRevalidate` (skip after the home POST). Build
  `ContactForm.tsx` with `useFetcher<typeof action>()`, `fetcher.data ?? actionData` (passed down
  from the route), labelled inputs, per-field errors with `aria-invalid`/`aria-describedby`,
  `maxLength` from `app/lib/contact.ts`, honeypot, `Button loading`, `role="status"` success /
  `role="alert"` rate-limit messages, reset + focus handling. Plug it into `ContactsSection`.
  Check manually with JS on and with JS disabled (DevTools → disable JavaScript): errors, success,
  values preserved on error, lands on `#contacts`.
- [ ] **8. Route tests** — `app/routes/home.test.ts`: `vi.mock` `~/.server/cms/content` and
  `~/.server/services/contact`. Loader: returns mapped data from fixtures; unsafe `mapEmbedUrl`
  → `null`; `CmsError` → thrown 503 `data` response. Action: invalid → 400 with field errors;
  valid → success and delivery called once; rate limited → 429; honeypot → success without
  delivery.
- [ ] **9. Docs & polish** — README: short "Home page" note (content edited in Strapi `home-page` /
  `site-settings`, contact submissions are logged until email is set up, rate limit). Run the full
  checks and a Lighthouse/axe pass on `/` at desktop and 375px (contrast, labels, heading order:
  one `h1`, section `h2`s).

## Testing & verification
- Unit: `markdown.test.ts`, `links.test.ts`, `contact-form.test.ts`, `rate-limit.test.ts`,
  `services/contact.test.ts`, updated `cms/content.test.ts` + `cms/schemas.test.ts`,
  `routes/home.test.ts`.
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run`, seeded Strapi):
  - View source of `/`: hero headline, about text, address and contact details are in the HTML.
  - Edit the headline / hours in the Strapi admin, reload `/`: the change shows without a rebuild.
  - Click "Order Now": navigates to the configured href.
  - Header "About us" / "Kontakt" from `/` and from another page (e.g. `/blog`) scroll to the section
    and the heading isn't hidden under the sticky header.
  - Contact form: empty submit, bad email, short message, success; repeat 6× → rate-limit message;
    repeat with JS disabled.
  - Stop the `cms` resource (or unset `STRAPI_API_TOKEN`): `/` shows the 503 page with the header.
  - Responsive at 375px, 768px, 1280px; no horizontal scroll.

## Acceptance criteria
- [ ] Sections render server-side in order: Hero, About Us, Location, Contacts — step 4
- [ ] Section text, images and contact details come from Strapi, and changing them in Strapi updates the page without a deploy — steps 2, 4
- [ ] "Order Now" uses the primary button style and navigates correctly — steps 2, 3, 4 (C+ `dark` variant per #27, Q2)
- [ ] Header "About us" / "Kontakt" links scroll to the right sections — step 4
- [ ] Contact form validates input, shows success/error states and works without client JS — steps 5, 6, 7, 8
- [ ] The page shows an error page, not a crash, when Strapi is unreachable — steps 4, 8
- [ ] Page is responsive on mobile and desktop — steps 4, 7, 9

## Out of scope
- Email delivery of contact messages and storing them in the DB (Q1 follow-up).
- The C+ canvas's "How it works", "Build your trio" picker, category tiles and Bestsellers (Q3).
- Theme tokens, Manrope, button variants, footer and motion utilities (#27).
- A tester-set / `/catalog` landing page (#8).
- A shared/distributed rate-limit store, CAPTCHA, CSP headers, and `Cache-Control` tuning.
- Changing the Strapi content model (e.g. a store photo or hero subtitle field).
