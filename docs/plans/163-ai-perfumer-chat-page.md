# Plan: Add the AI perfumer chat page with product-card recommendations (#163)

Issue: https://github.com/savchukolgaa/jassmin/issues/163
Branch: `issue/163`
Worktree: `.claude/worktrees/issue-163`
Status: Planned, design approved. **Implementation starts after #162 (the engine) is merged.**

## Goal

A customer opens `/parfumer` (`/en/perfumer`), describes the scent they want, and gets the AI
perfumer's answer as a short intro, 0–4 catalog product cards each with a reason, and an optional
follow-up question. The local model is slow (20–80 s per answer), so the page echoes the message at
once, shows an animated "the perfumer is choosing…" bubble with rotating hints and a cancel button,
and keeps the conversation across reloads. The page and its menu link exist only when the engine is
enabled.

## Dependencies & prerequisites

- **#162 (engine), open, planned in parallel.** Not on `origin/main` yet. This plan is written
  against the contract in #162's issue body and must be re-checked against the merged code before
  step 3:
  - `isPerfumerEnabled(): boolean` — false unless `AI_BASE_URL` is set. Assumed exported from
    `app/.server/ai/perfumer.ts` **(unconfirmed: exact module)**.
  - `perfumer.reply(locale, messages)` →
    `{ intro: string, picks: { product: ProductSummary, reason: string }[], question?: string }`,
    picks 0–4, products loaded from the database (`ProductSummary` from `app/lib/products.ts`).
  - `messages`: the conversation, max 10. Assumed OpenAI-style
    `{ role: "user" | "assistant", content: string }[]` **(unconfirmed: exact type)**.
  - Typed errors from `app/.server/ai/client.ts`: `unavailable`, `timeout`, `bad_response`.
  - Whether `reply` accepts an `AbortSignal` **(unconfirmed)**: if it does, the action passes
    `request.signal` so a cancelled request stops the model call.
- **#167 (model choice), open.** The UI hard-codes no model name or answer time: hints say
  "this may take a minute", not a figure tied to `granite4.1:3b`.
- Env vars come from #162 (`AI_BASE_URL`, `AI_MODEL`, …). This issue adds none.
- No migration: rate-limit counters go into the existing `rate_limits` table (#143).
- New dev dependency: `axe-core` for the accessibility test (see Decisions).

## Decisions & assumptions

- **Route.** `PAGES.perfumer = { uk: "parfumer", en: "perfumer", indexable: true }` in
  `app/lib/paths.ts`, registered with `localizedRoute("perfumer", "routes/perfumer.tsx")` inside the
  `_shop` layout, so the header, footer, cookie banner and visitor middleware apply.
- **Disabled = 404.** Both `loader` and `action` `throw data(null, { status: 404 })` when
  `!isPerfumerEnabled()` (same pattern as `app/routes/payments.simulator.tsx`). The `_shop` loader
  returns `perfumerEnabled` so `Header` and `MobileMenu` hide the link.
- **Sitemap.** `SitemapSources` gets `perfumerEnabled: boolean`; `sitemapPages` adds
  `everyLocale("perfumer")` only when true, and `"perfumer"` joins `SITEMAP_PAGES` so the existing
  "covers every indexable page" test still passes. `getSitemap` passes `isPerfumerEnabled()`.
- **Wire format.** The action takes a single form field `payload` holding JSON
  `{ messages: { role, content }[] }`, submitted with `useFetcher().submit` (a form field keeps the
  action testable with `FormData` like the other actions). Validated by `perfumerRequestSchema` in
  `app/lib/perfumer.schema.ts`: 1–10 messages, the last one `user`, each `content` trimmed,
  1–500 characters. A message over 500 characters → `perfumer.errors.tooLong`; any other shape
  error → `perfumer.errors.unavailable` (only a tampered request can hit it).
- **Assistant turns in history.** The client keeps each perfumer reply structured (for the cards)
  and sends it back as text built by `replyToHistoryText(reply)` in `app/lib/perfumer.ts`: the intro,
  then "Picks: <title> (<brand>), …", then the question, cut to 500 characters. Product titles come
  from the server's own reply, so this reveals nothing new to the model. **(unconfirmed: depends on
  how #162 wants assistant turns.)**
- **History trimming.** The client sends only the last 10 messages (`MAX_HISTORY = 10`); the server
  rejects more. The thread itself (what's shown and stored) is not trimmed.
- **Rate limit.** Two limiters in `app/.server/rate-limit.ts`, following `loginLimiters`:
  `perfumerLimiters.byIp` and `perfumerLimiters.bySession`, each `limit: 10`,
  `windowMs: 5 * 60_000`, `appRateLimitStore`. The action checks both `isBlocked` before calling the
  engine and `hit`s both for every accepted message (not just failures). Keys: `getClientIp(request)`
  and the visitor's `anonymousId` from `ensureVisitor(args)` (as `app/routes/cart.tsx` does), each
  falling back to the other.
- **Action result** (typed, locale-independent, `app/lib/perfumer.ts`):
  `{ ok: true, reply: PerfumerReply } | { ok: false, error: PerfumerErrorKey }` with
  `PerfumerErrorKey = "unavailable" | "timeout" | "rateLimited" | "tooLong"`; the engine's
  `bad_response` maps to `unavailable`, unknown throws are logged and mapped to `unavailable`.
- **State.** `usePerfumerThread()` (in `app/features/perfumer/`) holds
  `{ id, role: "user", text } | { id, role: "perfumer", reply } | { id, role: "error", error, retryText }`
  items, mirrors them to `sessionStorage` key `jassmin.perfumer.thread` (versioned
  `{ v: 1, items }`, parsed defensively without zod, dropped when invalid or over ~50 items), and
  restores them in a `useEffect` after hydration so SSR and the first client render match. One
  thread for both languages: stored replies stay in the language they were written in. Product data
  in stored replies can go stale (price, stock); the card link always leads to the live product page.
- **Cancel.** Each submit gets a turn id; "Скасувати" (shown after 10 s) marks the turn cancelled so
  its result is ignored, re-enables the input and removes the thinking bubble (the customer's message
  stays, with no error). If React Router v8's fetcher exposes `reset()`/abort, call it too so the
  browser aborts the request and the server's `request.signal` fires — verify in step 6.
- **Cards.** Reuse `ProductCard` (default variant, `headingLevel={3}`) with a new
  `purchase?: boolean` prop (default `true`); the perfumer passes `false`, which hides
  `AddToCartForm` and the size picker so the card shows image, brand, title, family, from-price and
  link (adding to the cart from the chat is out of scope, a follow-up issue) **(#169)**. The reason sits under each
  card as plain text. No `listIndex` / `ProductListProvider`: tagging clicks with `list: "perfumer"`
  is #166, which needs a new `LIST_IDS` value and an event-contract change. The product page's own
  analytics still run after the click.
- **Plain text only.** Intro, reasons, question and the customer's text render as React text nodes
  (`whitespace-pre-line`), never `dangerouslySetInnerHTML` or markdown.
- **Design (approved 2026-11-16).** Build to the C+ canvas artboards `C+ AI perfumer — /parfumer
  (#163)` and `C+ AI perfumer, phone width (#163)`
  (https://claude.ai/artifact/RCvne95y2han2bw8dWm1iW), using the `docs/design.md` tokens (white
  header #72, serif headings #73):
  - **Empty thread:** a deep-pink hero band like `/popular`: uppercase eyebrow "AI парфумер", serif
    `h1`, intro, "Спробуйте:" and the 4 example chips as white pills with `primary-dark` text and
    `chip-hover`; under it, one muted paragraph with tips on what to write.
  - **Once the thread has messages:** the hero becomes a slim deep-pink strip: a white round bottle
    icon, the `h1` "AI парфумер" at card-heading size, the line "Радить лише аромати, які є в
    наявності", and an `outline-light` `sm` "Почати спочатку" button on the right.
  - **Thread** in a ~800px column: customer bubbles right-aligned, `primary` with white text,
    radius 24 with the bottom-right corner 8; perfumer turns start with a small blush bottle avatar
    and the "AI парфумер" name in `muted`, then the intro in a white bubble with a `line` border
    (top-left corner 8); cards in a grid of `minmax(300px, 1fr)` (two per row on desktop, one on
    phones); the question in a blush box with a 2px `primary` border, a question-mark icon and the
    label "Уточнення"; errors in a blush bubble with an alert icon, plus a `primary` `sm` "Спробувати
    ще раз" only for `unavailable` and `timeout`; a cancelled turn as a centred `card` pill "Запит
    скасовано. Напишіть ще раз, коли будете готові."
  - **Card** (`ProductCard purchase={false}`): white with a `line` border, photo, uppercase brand in
    `primary-dark`, serif title link, family chip, serif "від … ₴", then a blush box "Чому вам
    пасує" with the reason. `lift` on hover.
  - **Thinking bubble:** three `primary` bouncing dots, "Парфумер підбирає аромати…", the rotating
    hint plus " · зазвичай до хвилини" (no model-specific time, #167), and after 10 s an outlined
    "Скасувати" pill.
  - **Input bar:** a `card` pill-shaped field (radius 28) with a round 48px `primary` send button
    (an up arrow, `aria-label` "Надіслати"; grey while disabled); under it the disclaimer on the left
    and, on the right, the counter from 400 characters or the "Enter — надіслати · Shift+Enter —
    новий рядок" hint (hidden below `lg`). Over 500 characters: `primary-dark` border and counter
    and a `role="alert"` line "Повідомлення задовге: скоротіть його до 500 символів."
  - **Motion:** `animate-fade-up` for new bubbles, `animate-pop` for the thinking bubble and the
    cancel button, dots `motion-safe:` only; with reduced motion the hints still change as text.
  - `docs/design.md` gets a section describing this and a row in "Pages and issues".
- **Mobile.** The page is a column with the thread growing and the input bar `sticky bottom-0` with
  a white background and safe-area padding (`pb-[env(safe-area-inset-bottom)]`); the input scrolls
  into view on focus. When the cookie banner is open it sits above the input bar (the banner is
  fixed; the page adds bottom padding while it shows).
- **Accessibility.** The thread `<ol>` has `aria-live="polite"` and `aria-relevant="additions"`; the
  thinking bubble has `role="status"`; after a reply or error, focus returns to the textarea
  (`ref.focus()` in an effect keyed on the finished turn); the textarea has a visible label
  (visually hidden) and `aria-describedby` for the counter and disclaimer; every control is a real
  `button`/`a` with `focusRing`.
- **axe check.** Add `axe-core` as a dev dependency and run it in a jsdom test on the rendered page
  (the `color-contrast` rule disabled: jsdom has no layout). No other accessibility library.
- **Header placement.** "AI парфумер" / "AI perfumer" goes after "Акції"/"Offers" in the header's
  inline nav and in the mobile menu, not in the footer. No floating corner button in this issue
  **(#165)**.

## Resolved questions

- **Add to cart from the chat (Q1)** — Not in this issue: the perfumer's cards hide the cart
  controls (`ProductCard purchase={false}`) and link to the product page. The follow-up is #169
  (size picker and add-to-cart in the chat, `list: "perfumer"`), which depends on #163 and #166
  (owner, 2026-11-16).
- **Floating corner chat button (Q3b)** — Added to #165, not built here: a link button to the chat
  page in the bottom-right corner, hidden on the chat, cart, checkout and payment pages, raised above
  the cookie banner and the cart toast. Its design is on the C+ canvas
  (`C+ AI perfumer corner button (#165)`), waiting for the owner's approval (owner, 2026-11-16).
  #163 only provides `perfumerEnabled` from the `_shop` loader, which #165 reuses.
- **Design** — Approved by the owner on 2026-11-16: the two `C+ AI perfumer` artboards on the C+
  canvas (see Decisions → Design).
- **Header link (Q3)** — A plain nav item after "Акції"/"Offers" in the header and mobile menu, no
  footer link, no badge (owner, 2026-11-16). Check that the header still fits at `lg` (1024 px) and
  move the inline nav breakpoint to `xl` if it doesn't.
- **One thread or one per language (Q4)** — One shared thread for both languages (owner accepted the
  default, 2026-11-16). Older replies stay in the language they were written in; the model answers
  in the page's locale from then on.
- **How is the rate limit stored?** — In the `rate_limits` table through `createRateLimiter` with
  `appRateLimitStore`; tests get an in-memory store from `vitest.setup.ts` (source:
  `app/.server/rate-limit.ts`, #143).
- **What is "per session"?** — The visitor's `anonymousId` via `ensureVisitor`, which works without
  analytics consent, as for the promo-code limiter's fallback (source: `app/routes/cart.tsx`,
  `app/.server/analytics.ts`).
- **Does the CSP need changes?** — No: the action is same-origin and product images already load on
  catalog pages (source: issue, `docs/security.md`).
- **Card click analytics and the `perfumer` list id?** — #166 adds `list: "perfumer"` and the
  `perfumer_message` event; this issue renders untracked cards (source: #166 Technical).
- **How do pages 404?** — `throw data(null, { status: 404 })` from the loader (source:
  `app/routes/payments.simulator.tsx`).
- **Sitemap coverage test** — `SITEMAP_PAGES` must list every `indexable` page; a conditional page
  is still listed there and filtered in `sitemapPages` (source: `app/.server/services/sitemap.ts`
  and its test).
- **DOM tests** — files named `*.dom.test.ts` with `// @vitest-environment jsdom`, using
  `@testing-library/react` (source: `app/features/analytics/ProductList.dom.test.ts`).
- **Which model, and how fast?** — Deferred to #167 (owner); the UI is model-agnostic.
- **Streaming** — #164; the action returns the whole reply. Keep the reply type and thread items
  so streaming can fill a perfumer bubble later.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/paths.ts` | `PAGES.perfumer` |
| modify | `app/routes.ts` | register `routes/perfumer.tsx` in `_shop` |
| create | `app/lib/perfumer.ts` | DTO types (`PerfumerReply`, `PerfumerPick`, `PerfumerErrorKey`, `PerfumerActionResult`, `ChatMessage`), `MAX_MESSAGE_LENGTH = 500`, `MAX_HISTORY = 10`, `replyToHistoryText`, `toHistory` |
| create | `app/lib/perfumer.schema.ts` | zod request schema + `parsePerfumerRequest` |
| create | `app/lib/perfumer.schema.test.ts` | schema tests |
| create | `app/lib/perfumer.test.ts` | history helpers |
| modify | `app/.server/rate-limit.ts` | `perfumerLimiters` |
| create | `app/.server/services/perfumer-chat.ts` | `answerPerfumerMessage(...)`: limits, engine call, error mapping (keeps the route thin and testable with injected deps) |
| create | `app/.server/services/perfumer-chat.test.ts` | rate limit and error mapping |
| create | `app/routes/perfumer.tsx` | loader (404 / meta data), action, page |
| create | `app/routes/perfumer.test.ts` | 404 when disabled, action validation and results |
| modify | `app/routes/_shop.tsx` | return `perfumerEnabled` |
| modify | `app/components/layout/nav.ts` | `perfumer` nav link |
| modify | `app/components/layout/Header.tsx`, `MobileMenu.tsx` | show the link when enabled |
| modify | `app/components/layout/Header.test.ts` | link shown / hidden |
| modify | `app/.server/services/sitemap.ts` (+ test), `app/routes/sitemap.xml.ts` | conditional sitemap entry |
| modify | `app/features/catalog/ProductCard.tsx` (+ `ProductCard.dom.test.ts`) | `purchase` prop |
| create | `app/features/perfumer/PerfumerPage.tsx` | hero, chips, thread, input, start over, disclaimer |
| create | `app/features/perfumer/MessageThread.tsx` | bubbles, cards with reasons, question, error + retry |
| create | `app/features/perfumer/ThinkingBubble.tsx` | dots, rotating hints, cancel after 10 s |
| create | `app/features/perfumer/PerfumerInput.tsx` | auto-growing textarea, Enter/Shift+Enter, counter |
| create | `app/features/perfumer/usePerfumerThread.ts` | thread state, `sessionStorage`, fetcher, cancel, retry |
| create | `app/features/perfumer/thread-storage.ts` (+ test) | load/save/validate the stored thread |
| create | `app/features/perfumer/perfumer-ui.test.ts` | uk/en rendering of intro, cards, question, errors |
| create | `app/features/perfumer/PerfumerPage.dom.test.ts` | chips send, reload keeps the thread, cancel, focus, axe |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `perfumer` namespace, `nav.perfumer` |
| modify | `package.json`, `pnpm-lock.yaml` | `axe-core` dev dependency |
| modify | `docs/design.md` | perfumer page section and canvas table row |
| modify | `docs/ai-perfumer.md` (from #162) | a short "Chat page" section: route, limits, storage |

## Steps

- [ ] **1. Rebase on #162 and confirm the contract** — `git fetch origin && git rebase origin/main`
  once #162 is merged. Check `isPerfumerEnabled`'s module, the `reply` signature, the message type,
  the error class/keys and `AbortSignal` support; update the **(unconfirmed)** items in this plan
  and adjust the types in step 2 to import from the engine where they're isomorphic.
- [ ] **2. Shared types, schema and copy** — `app/lib/perfumer.ts` (types, limits,
  `replyToHistoryText`, `toHistory(items)` → last 10 `ChatMessage`s, skipping error items),
  `app/lib/perfumer.schema.ts` (zod, messages keyed with `msg("perfumer.errors.tooLong")`), and the
  `perfumer` namespace in `uk.ts`/`en.ts`: page title/meta description, hero eyebrow/title/intro,
  the 4 chips (uk text from the issue; en: "A fresh summer scent under 500 ₴", "A gift for him",
  "Something like La Vie Est Belle", "A sweet vanilla scent for winter"), input label/placeholder,
  send, counter (`{count}` plural), thinking hints (3–4), cancel, start over, retry, disclaimer
  with contact link text, question label, "why it fits" label, and `errors.unavailable | timeout |
  rateLimited | tooLong`; plus `nav.perfumer`. Tests: schema (empty, 501 chars, 11 messages, last
  not `user`, trimming) and history helpers. `pnpm typecheck` passes (key parity).
- [ ] **3. Server service and limiters** — `perfumerLimiters` in `rate-limit.ts`;
  `answerPerfumerMessage({ locale, messages, ipKey, sessionKey, signal }, deps)` in
  `app/.server/services/perfumer-chat.ts`: blocked on either key → `rateLimited` (engine not called);
  otherwise hit both, call `deps.reply`, map errors (`timeout` → `timeout`, `unavailable` /
  `bad_response` / unknown → `unavailable`, logged), return `PerfumerActionResult`. Tests with a fake
  `reply`: 10 accepted then the 11th `rateLimited`, per-IP and per-session independently, window
  resets after 5 minutes (injected clock), each error mapping, success passthrough.
- [ ] **4. Path, route registration, menu and sitemap** — `PAGES.perfumer`; `routes.ts`;
  `_shop` loader returns `perfumerEnabled: isPerfumerEnabled()`; `navLinks().perfumer`; `Header` and
  `MobileMenu` render it only when `perfumerEnabled` (read from the layout's loader data, as the
  header state is passed today); sitemap `perfumerEnabled` source. Check the header at 1024 px.
  Tests: header with/without the link; sitemap with/without the perfumer URLs; existing path-table
  tests (`paths.test.ts`, `.server/paths.test.ts`) still pass.
- [ ] **5. `ProductCard` `purchase` prop** — when `false`, the default card skips `AddToCartForm`
  and `SizePicker` and shows `product.fromPrice` for ranges (no skeleton needed, since no size can
  be picked). Test in `ProductCard.dom.test.ts`.
- [ ] **6. Route module and thread hook** — `app/routes/perfumer.tsx`:
  `loader` 404s when disabled, else returns `{}` (meta via `metaTranslator(matches)`: title and
  description; `hreflang` comes from `indexable`); `action` 404s when disabled, parses `payload`
  with `parsePerfumerRequest`, calls `answerPerfumerMessage` with `getLocale(request)`,
  `getClientIp(request)`, `(await ensureVisitor(args)).anonymousId` and `request.signal`, returns the
  result with `data(...)`. `usePerfumerThread`: `useFetcher<typeof action>()`, `send(text)` appends
  the user item and submits `toHistory(items + new)`, appends the perfumer/error item when the
  fetcher returns for the current turn id, `cancel()`, `retry(errorItem)` (removes the error and
  re-sends its `retryText` without duplicating the user bubble), `startOver()` (clears state and
  storage); `thread-storage.ts` load/save. Verify whether the v8 fetcher can be reset/aborted and
  wire it into `cancel()`. Route tests: loader/action 404 when disabled, `tooLong`, success shape,
  `rateLimited` after 10 posts.
- [ ] **7. `MessageThread`** — `<ol aria-live="polite">` of bubbles: customer text; perfumer intro,
  then a grid of `ProductCard purchase={false} headingLevel={3}` with the reason under each
  (`<p>` with a small "Чому підходить" label), then the question in a highlighted blush bubble;
  error bubble with the translated message and a "Спробувати ще раз" button (`rateLimited` and
  `tooLong` errors show no retry: waiting or editing is the fix). All text as text nodes with
  `whitespace-pre-line`.
- [ ] **8. `ThinkingBubble` and `PerfumerInput`** — dots (`motion-safe:animate-bounce` with
  staggered delays), a hint rotating every ~4 s via `setInterval` (cleared on unmount),
  `role="status"`, and "Скасувати" appearing after 10 s. Input: textarea growing with content up to
  ~6 lines (`field-sizing: content` with a JS height fallback), Enter sends, Shift+Enter newline,
  IME composition ignored (`event.nativeEvent.isComposing`), counter shown from 400 characters and
  red over 500 (send disabled), disabled while waiting, `maxLength` not set so pasted text shows the
  counter rather than being cut silently.
- [ ] **9. `PerfumerPage`** — hero with eyebrow, `h1`, intro and the 4 chips (each a `button` that
  calls `send`; shown only while the thread is empty), the thread, the sticky input bar with
  "Почати спочатку" (shown when the thread isn't empty; no confirmation) and the disclaimer under the input
  ("AI-парфумер може помилятися…" + link to `pathFor(locale, "home", {}, { hash: "contacts" })`).
  Focus returns to the textarea when a turn finishes. Mobile layout and cookie-banner padding as in
  Decisions.
- [ ] **10. Component tests** — `perfumer-ui.test.ts` (render to string, uk and in
  `<I18nProvider locale="en">`): intro, cards linking to `productHref`, reasons, question, each error
  message, disclaimer link. `PerfumerPage.dom.test.ts` (jsdom, router stub with a fake action):
  clicking a chip submits that text; the customer bubble and thinking state show immediately; cancel
  after 10 s (fake timers) removes the thinking state; a stored thread in `sessionStorage` renders
  after mount (reload); start over clears it; Enter sends, Shift+Enter doesn't; focus returns to the
  input; `axe.run(container)` reports no violations (contrast rule off). Add `axe-core`
  (`pnpm add -D axe-core`).
- [ ] **11. Manual check** — `pnpm aspire run` with Ollama and `AI_BASE_URL` set: send each chip in
  uk and en, cancel a slow answer, reload mid-thread, hit the rate limit (11 messages), check a
  phone width (360 px) in devtools with the on-screen keyboard emulated, keyboard-only use and
  VoiceOver/NVDA announcement of replies. Then unset `AI_BASE_URL`: `/parfumer` 404s, the menu link
  and the sitemap entries are gone.
- [ ] **12. Docs** — `docs/design.md`: a `C+ Perfumer` paragraph (layout, bubbles, chips, motion,
  mobile input) and its row in "Pages and issues" (no canvas artboard); `docs/ai-perfumer.md`: the
  chat page section (route, 10 messages × 500 chars, 10 per 5 min per IP and per session,
  `sessionStorage`, plain text only).
- [ ] **13. Verify** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Testing & verification

- Unit: `perfumer.schema.test.ts`, `perfumer.test.ts`, `perfumer-chat.test.ts` (limits with the
  in-memory store and an injected clock, error mapping), `thread-storage.test.ts` (invalid/old
  data dropped), sitemap and header tests.
- Route: `perfumer.test.ts` — loader and action 404 when disabled (mock `isPerfumerEnabled`),
  validation errors, success, rate limit, with the engine mocked via `vi.mock`.
- Components: `perfumer-ui.test.ts` (uk + en), `PerfumerPage.dom.test.ts` (chips, cancel, reload,
  start over, keyboard, focus, axe), `ProductCard.dom.test.ts` (`purchase={false}`).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: step 11.

## Acceptance criteria

- [ ] With the engine enabled, `/parfumer` and `/en/perfumer` show the chat, and a message returns
  an intro and 0–4 product cards with reasons that link to the product pages — steps 4, 6, 7, 10, 11
- [ ] While waiting, the customer sees their message, an animated thinking state and can cancel;
  errors show a friendly message with retry — steps 6, 7, 8, 10
- [ ] Example prompts, start over, and reload-safe history work — steps 6, 9, 10
- [ ] The page works and looks right on mobile and desktop in the C+ design, is keyboard and
  screen-reader friendly, and shows the AI disclaimer — steps 7–9, 10 (axe), 11, 12
- [ ] The page and its menu link are hidden when the engine is disabled — steps 4, 6, 11
- [ ] Length, history and rate limits are enforced with clear messages — steps 2, 3, 6, 8
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 13

## Out of scope

- The engine itself, its prompt, tools and eval (#162); model choice and hosting (#167).
- Token streaming (#164); the reply arrives whole.
- Perfumer entry buttons on other pages (#165), including the floating corner button.
- Adding to the cart from the chat (#169).
- Analytics: `perfumer_message`/`perfumer_feedback` events, `list: "perfumer"` card tagging,
  thumbs up/down (#166).
- Storing conversations on the server.
