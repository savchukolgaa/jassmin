# Plan: Rewrite the README as a portfolio showcase with screenshots and architecture (#141)

Issue: https://github.com/savchukolgaa/jassmin/issues/141
Branch: `issue/141`
Worktree: `.claude/worktrees/issue-141`
Status: Planned

## Goal

A recruiter or reviewer opening the repo should understand in two minutes what Jassmin is, how it's
built and why. The top of `README.md` becomes a showcase: pitch and badges, a hero screenshot,
features, a Mermaid architecture diagram, the tech stack, key engineering decisions with links,
quality numbers and the AI-assisted workflow. The developer setup guide moves, complete, to
`docs/setup.md`, and the README keeps a short "Getting started". A `LICENSE` file is added.

## Dependencies & prerequisites

- **#125 (gift cards) and #126 (offers page) are being implemented in parallel.** Both edit
  `README.md`: #126 changes the seed description ("gift ideas" → "gift cards", current line ~224,
  already committed on `issue/126`), and #125 plans a "Gift cards" section, a new `db:*` script, the
  new Strapi type and the sync token's permissions (`docs/plans/125-gift-cards.md` on `issue/125`,
  Files table and steps around lines 263, 397 and 408). Whichever lands second has to port the
  other's README edits. This plan moves those sections **verbatim** to `docs/setup.md` in one
  dedicated commit so the port is mechanical (step 2), and rebases on `origin/main` before the PR
  (step 10).
- **#142 (CI) is planned in parallel.** It adds `.github/workflows/ci.yml` (job `check`) and asks for
  a CI status badge in the README. This plan owns the badge row: it adds the badge if #142 has
  merged by then, otherwise it leaves the exact badge line as a commented-out placeholder (step 4).
  #142 should then only uncomment it, not add a second badge.
- **#131 (synthetic shop data) is open.** Screenshots must be taken on synthetic data, never on
  real customer data, so the screenshots are a **later step** (step 11, not part of this PR).
- **Hosting is not set up yet.** The live demo link is "coming soon" (step 4) and filled in later
  (step 11).
- **#133 (analytics case study) is open.** Its README doesn't exist yet, so this README links to
  the issue, not to a file (step 6).
- No packages, env vars or migrations. Link checking and Mermaid rendering use `pnpm dlx` one-offs,
  nothing is added to `package.json`.
- **Scope restriction from the owner:** only `README.md`, `docs/**` and `LICENSE` may change.

## Decisions & assumptions

- **Split:** `README.md` = showcase + condensed "Getting started" (prerequisites, quick start, the
  `pnpm aspire` note, the main scripts, links). `docs/setup.md` = everything from today's README
  that is reference material: "Without Aspire", environment variables, the full scripts table,
  abandoned carts, order emails, card payments, database migrations, project structure, Strapi
  (running, first-time setup, content model, translations), special offers, home page and contact
  form, products and orders in Strapi, SEO and sitemap submission, admin role, conventions.
  The text is moved as-is in its own commit, with only the heading levels and internal anchors
  adjusted. Out-of-date lines are fixed afterwards in a separate commit (step 3), so the move
  stays easy to rebase and review.
- **Keep the headings that other files point to:** `scripts/aspire.mjs` says "see README →
  Prerequisites", so the README keeps a `### Prerequisites` heading. `app/.server/AGENTS.md` line 8
  says "the README table" for env vars; the README's Getting started gets a one-line pointer to
  `docs/setup.md#environment-variables`. Updating that AGENTS.md line is outside the allowed files
  and is a follow-up after #125 and #126 merge.
- **Issue/PR links are full URLs** (`https://github.com/savchukolgaa/jassmin/issues/40`,
  `…/pull/63`). GitHub autolinks `#40` only in issues, PRs and comments, not in repository Markdown
  files. Decisions link the PR where one exists (more useful to a reviewer: it holds the diff and
  the measurements), with the issue in the text.
- **No broken images while screenshots are pending.** The hero is an HTML comment naming the
  intended file plus a visible line "Screenshots coming soon, taken on synthetic data (#131)". An
  `<img>` to a missing file would break the "all links work" criterion.
- **Licence default: source-available, all rights reserved** (the issue's default; the shop is a
  real business). `LICENSE` grants permission to read and evaluate the code (e.g. for hiring or code
  review) and nothing else; the Jassmin name, logo, product texts and images are excluded.
  Copyright holder: "Ольга Савчук" (the git author name), year 2026.
- **The repo is public**, so the CI badge renders and issue/PR links work for every reader.
- **Badges:** a static shields.io licence badge and the CI badge from #142. No coverage or Lighthouse badges: they'd need a service or would go stale.
- **Numbers are measured, not guessed.** The test count is read from `pnpm test` output on the day
  of writing (today ~161 test files and ~1,530 `it`/`test` calls by grep; the issue says "over
  1,600", the exact Vitest count decides). Lighthouse numbers come from PR #97 (#96), with how and
  when they were measured: mobile Performance 90 home / 94 `/katalog/zhinochi` / 92 product page,
  SEO 100, CLS 0, Accessibility 90 home and 95–96 elsewhere; Lighthouse 12.6.1, local production
  build, median of 3 runs. The README says "measured locally" and links the PR.
- **Mermaid diagram** (`flowchart LR`), only what exists on `main`:
  - Browser ⇄ React Router v8 SSR server (loaders = reads, actions = writes; locale and analytics
    middleware; `app/.server/`).
  - Server ⇄ PostgreSQL via Drizzle: system of record (products, carts, orders, users, payments,
    `sessions`/`user_events`).
  - Strapi admin (staff) → `POST /cms/*` with `CMS_SYNC_SECRET` → server, which validates and
    applies in one transaction (write-through, #40). Strapi has its own `strapidb`.
  - Server → `cms_outbox` → Strapi REST (sync token); server reads published content with the
    read-only token.
  - Server → `order_emails` outbox → SMTP (smtp4dev locally).
  - Server ⇄ payment provider (simulator, signed callback, #44).
  - `sessions` / `user_events` → analytics/ML (LTV, churn, #133), dotted as "planned".
  - An Aspire subgraph around PostgreSQL, Strapi, smtp4dev and the web resource, labelled "local
    orchestration".
  Labels stay short; no colours or styling that break GitHub's light and dark themes.
- **Engineering decisions (6–7 bullets, one "why" each):**
  1. SSR with loaders/actions, no REST layer or client data library → less JS, works without JS
     (contact form), simpler auth (#96 / PR #97 for the JS budget).
  2. PostgreSQL is the system of record, Strapi is only the staff UI with write-through
     (#40 / PR #63).
  3. Transactional checkout and a discount engine: stock, order, items, cart status and outbox rows
     in one transaction; promo codes and offers (#59 / PR #62), the couple offer (#124 / PR #127).
  4. Outbox pattern for emails and CMS sync: an order never exists without its email and Strapi
     row, retries with backoff (#45, #40).
  5. i18n with translated URLs and hreflang, type-checked dictionaries (#84 / PR #93).
  6. Privacy-aware analytics with a schema built for LTV/churn: consent, visitor cookies, ML feature
     columns that are never dropped (#5, #18 / PR #50).
  7. SEO and Core Web Vitals: metadata, structured data, sitemap, CWV, generated share images
     (#85–#88 / PRs #91, #92, #94, #95; #105 / PR #117).
- **Features list** (shopper-facing first, then staff): catalog for women and men (no unisex
  catalog), five sizes per perfume, cart, checkout with card or cash on delivery, promo codes and
  offers, accounts and order history, order emails, blog and offers from Strapi, Ukrainian and
  English with translated URLs, staff management in Strapi. Gift cards (#125) are added only if
  #125 has merged by step 10.
- **"How it's built"** describes the issue → plan → worktree → PR workflow and links
  `docs/skills/README.md`, `.claude/skills/` and `AGENTS.md`. It states plainly that the code is
  written with an AI coding agent under the owner's review, and what guards quality (plans, strict
  TypeScript, tests, CI from #142).

## Resolved questions

Answered by the owner:

- **Which licence?** — Source available for review, all rights reserved (view and evaluate only),
  not MIT.
- **Is the repo public, and whose copyright?** — Public now (confirmed with `gh repo view`:
  `PUBLIC`). Copyright holder "Ольга Савчук".
- **Fix outdated lines while moving them to `docs/setup.md`?** — Yes, in a separate commit after
  the verbatim move (step 3). Known so far: "Checkout has no discounts yet" in Special offers
  (wrong since #59/#124); the seed list of offers (#126 changes it). `unisex` in the Strapi product
  `gender` is **not** stale: `cms/src/api/product/content-types/product/schema.json:39` still
  allows it, even though the shop has no unisex catalog.
- **Update `app/.server/AGENTS.md` ("the README table")?** — Not in this PR; fix it in a small
  follow-up after #125 and #126 merge.

Answered from the repo and issues:

- **Does GitHub autolink `#40` in the README?** — No, only in issues, PRs and comments; use full
  URLs (GitHub docs on autolinked references).
- **Is there a LICENSE today?** — No `LICENSE` file, and `package.json` has `"private": true` and no
  `license` field (source: repo root). Adding a `license` field is out of the allowed paths.
- **Does anything else depend on README headings?** — `scripts/aspire.mjs:20` ("README →
  Prerequisites") and `app/.server/AGENTS.md:8` ("the README table"); `AGENTS.md:3` says "Read
  `README.md` for setup" (source: grep). Handled by keeping `Prerequisites` and adding pointers.
- **Which README edits do #125 and #126 make?** — #126: seed description "gift ideas" → "gift
  cards" (committed on `issue/126`). #125: gift cards section, new script, Strapi type, sync token
  permissions (source: `docs/plans/125-gift-cards.md` on `issue/125`).
- **What's the CI workflow and job name for the badge?** — `.github/workflows/ci.yml`, job `check`
  (source: #142). Badge: `https://github.com/savchukolgaa/jassmin/actions/workflows/ci.yml/badge.svg?branch=main`.
- **Lighthouse numbers** — from PR #97 (#96), see Decisions.
- **Analytics README** — not written yet (#133 open); link the issue.
- **Node version** — README and `.nvmrc` say 24 LTS; `engines` says `>=22`. Keep the README's
  wording.
- **Catalog scope** — only women's and men's catalogs, no unisex (owner's decision, project memory).
- **Product photos** — one generic Jassmin bottle photo for all perfumes (#118, #122); screenshots
  will show that photo, which is expected.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| create | `docs/setup.md` | Full developer and operations guide, moved from `README.md` |
| modify | `README.md` | Showcase on top, condensed Getting started, links to `docs/setup.md` |
| create | `docs/screenshots/README.md` | Shot list, naming, size limits and how to capture (for step 11) |
| create | `LICENSE` | Source-available, all rights reserved |
| modify | `docs/skills/README.md` | Only if needed: link back to the README's "How it's built" (check in step 7) |

No other files change.

## Steps

- [x] **1. Inventory** — List every `##`/`###` heading of the current `README.md` and every
  internal anchor link (`](#…)`), and decide for each whether it stays in the README or moves to
  `docs/setup.md` (per Decisions). Note the anchors that will change.
- [x] **2. Move the setup guide (one commit)** — Create `docs/setup.md` with a title, a one-line
  intro ("Developer setup and operations guide for Jassmin. The project overview is in the
  [README](../README.md).") and a table of contents. Move the sections verbatim, demoting nothing
  except where needed for a consistent tree. Fix internal anchors (`#card-payments-simulator`,
  `#order-emails`, `#abandoned-carts`, `#seo`, `#admin-role`,
  `#products-and-orders-in-strapi`, "Content (Strapi CMS)") so they point inside `docs/setup.md`,
  and relative paths (`app/...`, `cms/...`) get the `../` prefix where they are links. Remove the
  moved text from `README.md`. Commit: "Move the setup guide to docs/setup.md (#141)". Check: a diff
  of the moved text shows only anchor/path changes.
- [ ] **3. Fix out-of-date lines in `docs/setup.md` (separate commit)** — Read the moved guide
  against the code on `main` and correct what's wrong, e.g. "Prices aren't changed. Checkout has no
  discounts yet" in Special offers (promo codes and offer discounts exist since #59, the couple
  offer since #124: describe what checkout applies, pointing at `app/.server/services/` for the
  rules), and any env var, script or Strapi type that's missing or gone (compare with
  `app/.server/env.ts`, `package.json` scripts, `cms/src/api/`). Check each claim in the code before
  changing it. Commit: "Bring the setup guide up to date (#141)". Note every fix for the PR
  description.
- [ ] **4. Header, pitch and badges** — Title, one-line pitch (e.g. "A bilingual, server-rendered
  e-commerce site for a small perfume shop in Ukraine: React Router v8 SSR, PostgreSQL, Strapi"),
  then the badge row: CI badge (live if #142 is merged, otherwise this exact line in an HTML
  comment: `<!-- CI badge, enable once #142 is merged: [![CI](…/ci.yml/badge.svg?branch=main)](…/actions/workflows/ci.yml) -->`),
  licence badge, and "Live demo: coming soon". Below: the hero placeholder comment
  (`<!-- hero: docs/screenshots/home-desktop.webp + home-phone.webp, see docs/screenshots/README.md -->`)
  and the visible "Screenshots coming soon" line. Create `docs/screenshots/README.md` now: the shot
  list (home, catalog, product, cart, checkout × desktop 1440×900 and phone 390×844), file names
  (`<page>-<desktop|phone>.webp`), the 200 KB limit, the "synthetic data only, no personal data"
  rule and the capture steps, so step 11 is mechanical.
- [ ] **5. Features and tech stack** — A short Features list (Decisions). Keep the existing Stack
  table, add rows for i18n (own typed dictionaries, translated URLs), email (Nodemailer + outbox),
  payments (provider interface, simulator) and tests (Vitest, real PostgreSQL integration tests).
  Check each row against `package.json`.
- [ ] **6. Architecture** — The Mermaid `flowchart` from Decisions, with 3–4 sentences under it
  explaining reads/writes, the system of record and the outboxes. Link #133 for the analytics case
  study. Check it renders: `pnpm dlx @mermaid-js/mermaid-cli -i <extracted .mmd> -o <scratch>.svg`
  (scratchpad, not committed), and on GitHub after pushing the branch (step 10).
- [ ] **7. Engineering decisions, Quality, How it's built** — The 6–7 decision bullets with full
  issue/PR URLs. Quality: run `pnpm test` in the worktree (with a database configured, so the DB
  tests run) and quote the file and test counts with the date; `pnpm typecheck` and `pnpm lint`
  (strict TS, no `any`, Biome); Lighthouse numbers from PR #97 with how they were measured;
  accessibility: only the measured Lighthouse scores and what's in `docs/design.md` (focus rings,
  motion), no unmeasured claims. Mention CI (#142) with a link to its issue, or to the workflow if
  merged. How it's built: the workflow (Decisions), links to `docs/skills/README.md`,
  `.claude/skills/`, `AGENTS.md`, and to `docs/plans/` as where plans live while an issue is open.
- [ ] **8. Getting started and LICENSE** — README "Getting started": `### Prerequisites` (as today),
  `### Quick start` (as today, including the `pnpm aspire` note), the five everyday commands
  (`dev`, `typecheck`, `lint`, `test`, `build`), and a list of links into `docs/setup.md`
  (environment variables, all scripts, Strapi setup, jobs, payments, migrations, SEO, admin role).
  Add a short "Licence" section linking `LICENSE`. Write `LICENSE` (source available, all rights reserved): copyright line
  (year 2026, holder "Ольга Савчук"), the permitted use (view and evaluate), everything else reserved,
  brand and content excluded, no warranty. If the owner picks MIT, use the standard MIT text.
- [ ] **9. Link check** — Run `pnpm dlx markdown-link-check README.md docs/setup.md
  docs/screenshots/README.md` (or `lychee` if available) from the worktree. Every relative link and
  anchor must resolve. The repo is public, so issue/PR URLs can be checked too; if the checker is rate-limited by GitHub,
  check them with `gh issue view <n>` / `gh pr view <n>` instead and record that they exist. List
  any out-of-date lines still left after step 3.
- [ ] **10. Rebase, port and push** — `git fetch origin && git rebase origin/main`. If #125 or #126
  merged first and touched `README.md` in sections that moved, take main's version of those
  sections, apply their edits to `docs/setup.md`, and drop them from the README. Re-check the CI
  badge (step 4) and the gift-card feature line (step 5). Push `issue/141` and check on GitHub that
  the Mermaid diagram renders, in light and dark theme, and that the README reads well at phone
  width.
- [ ] **11. Later, not in this PR: screenshots and live demo** — Once #131 provides synthetic data
  (and hosting exists for the demo): capture home, catalog, product, cart and checkout at desktop
  (1440×900) and phone (390×844) per `docs/screenshots/README.md`, convert to WebP under 200 KB
  each, check them for personal data, commit to `docs/screenshots/`, replace the hero placeholder
  with a desktop + phone pair and add a small gallery. Replace "Live demo: coming soon" with the URL.

## Testing & verification

- No code changes, so no new Vitest tests. Still run, from the worktree:
  `pnpm --dir "$WT" typecheck`, `pnpm --dir "$WT" lint` (Biome checks Markdown only if configured;
  it must stay green), `pnpm --dir "$WT" test` (also gives the numbers for step 7) and
  `pnpm --dir "$WT" build`.
- Link check (step 9) and Mermaid render check (steps 6, 10).
- Manual: read the README top to bottom on GitHub as a reviewer (two-minute test); follow every
  `docs/setup.md` link from the Getting started list; confirm nothing from the old README is lost
  (compare headings from step 1 with `docs/setup.md`).

## Acceptance criteria

- [ ] The README opens with a pitch, a screenshot and the features, and the setup guide is still
  complete (in the README or `docs/setup.md`) — steps 2, 3, 4, 5, 8. The screenshot part is a
  placeholder until step 11.
- [ ] A Mermaid architecture diagram renders on GitHub — steps 6, 10
- [ ] Screenshots show desktop and phone layouts and contain no real customer data — step 11
  (deferred: needs #131); this PR adds the shot list and placeholders
- [ ] The key decisions link to their issues or PRs — step 7
- [ ] A `LICENSE` file exists — step 8
- [ ] All links in the README work — step 9

## Out of scope

- Taking the screenshots and adding the live demo URL (step 11, after #131 and hosting).
- The analytics case study README (#133) and a separate portfolio site.
- The CI workflow and branch protection (#142); this plan only places the badge.
- Changing files outside `README.md`, `docs/**` and `LICENSE` (e.g. `app/.server/AGENTS.md`,
  `scripts/aspire.mjs`, a `license` field in `package.json`).
- Updating `app/.server/AGENTS.md` ("the README table"): a follow-up after #125 and #126 merge.
