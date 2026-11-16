# Plan: Stream the AI perfumer's progress and answer to the chat (#164)

Issue: https://github.com/savchukolgaa/jassmin/issues/164
Branch: `issue/164`
Worktree: `.claude/worktrees/issue-164`
Status: Planned

## Goal

A customer waiting 20–80 s for the AI perfumer should see it working, not a frozen page. The chat
streams the reply over server-sent events: a progress step ("Шукаю в каталозі: цитрусові, до
600 ₴") as soon as a catalog tool runs, then the intro sentence by sentence, then the validated
product cards and the question. The normal action (#163) stays as the fallback when streaming fails.

## Dependencies & prerequisites

- **#162** (engine: `app/.server/ai/perfumer.ts`, `answer-guard.ts`, `catalog-tools.ts`,
  `client.ts`) and **#163** (chat page: `app/routes/perfumer.tsx`, `app/features/perfumer/`,
  `app/.server/services/perfumer-chat.ts`) are merged on `origin/main` (1de78cd, 29dc62f).
- No new packages, env vars or migrations. `AI_BASE_URL` / `AI_TIMEOUT_MS` keep their meaning.
- CSP: `connect-src 'self'` already allows a same-origin `fetch` (`app/.server/security-headers.ts`).
- Manual verification needs Ollama with `granite4.1:3b` (see `docs/ai-perfumer.md` → Setup).

## Decisions & assumptions

1. **Two final calls when streaming.** `reply()` asks for `{ intro, picks, question }` in one JSON
   call, so the intro can't be checked before the picks are known. `replyStream()` instead:
   1. runs the same tool rounds (yielding a `step` per tool call),
   2. asks for `{ picks, question }` as JSON (`MODEL_PICKS_JSON_SCHEMA`, a new final instruction),
   3. validates the picks exactly as today (`selectPicks`, `getProductSummaries`, in stock),
   4. streams the intro in a third call (`stream: true`, no tools) told which aliases it picked, and
      cleans it **per completed sentence** with the same `cleanProse` context (picks' names allowed),
   5. sends `picks` (cards from the database, reasons cleaned), then `question`, then `done`.
   This costs one extra short model call (~1–3 s on the CPU with Ollama's prompt cache).
2. **`reply()` stays as it is**, so the fallback action and the eval (`pnpm ai:perfumer-eval`) keep
   their behaviour and recorded results. Shared parts (setup, tool round, pick validation, reason
   cleaning) are extracted so the two paths don't diverge.
3. **Events** (`PerfumerEvent` in `app/lib/perfumer.ts`, isomorphic, no zod), in this order:
   `step`* → `intro`* → `picks` → `question`? → `done`; or `error` at any point (then the stream
   ends). Payloads are locale-independent data, translated by the client:
   - `step`: `{ tool: "search", gender?, families: FragranceFamily[], maxPriceUah?, found: number }`
     or `{ tool: "similar", title?: string, found: number }`. **Only resolved, catalog-safe values:**
     families after the synonym mapping (`synonyms.ts`), the similar perfume's *catalog* title (when
     found), never the model's raw note words ("лантан", "іншант") or an unmatched title.
     `ToolCallRecord` gains an optional `step` filled by `runCatalogTool`.
   - `intro`: `{ text }`, one or more whole cleaned sentences (with a leading space when needed).
   - `picks`: `{ picks: PerfumerPick[] }` (0–4, possibly empty).
   - `question`: `{ text }`.
   - `error`: `{ error: PerfumerErrorKey }`.
   - `done`: `{}`.
4. **"Typing in"**: the server sends whole sentences (the guard needs a complete sentence before it
   can pass it); the client reveals each sentence character by character (`motion-safe`, ~25 ms per
   character, instant with reduced motion). Text is still rendered as plain text nodes.
5. **Intro fallback and cap.** If the streamed intro ends empty (every sentence removed, or the model
   wrote none), the server sends the translated `perfumer.fallbackIntro` / `fallbackIntroEmpty` as an
   `intro` event, like `validate()` does. `MAX_INTRO` (600) is applied cumulatively; once reached,
   the rest of the model's text is dropped and the model call is aborted.
6. **Resource route** `perfumerStream` in `app/lib/paths.ts`: `parfumer/stream` /
   `en/perfumer/stream` (`indexable: false`), registered with `localizedRoute` **inside the `_shop`
   layout** like `checkoutPay`, so `getLocale` (path-based) and the visitor middleware
   (`ensureVisitor`) work as in the action. Action-only (POST); `loader`-less, so GET is a 405.
   It reads the same `payload` form field with `parsePerfumerRequest`, and 404s while disabled.
7. **Same rate limit, counted once per message.** `perfumer-chat.ts` gets `admitPerfumerMessage`
   (the limiter check + hit, extracted from `answerPerfumerMessage`) and `streamPerfumerMessage`,
   which maps `AiError`s to `error` events exactly like the action maps them to keys. A fallback
   after a failed stream posts to the action, which counts the message again; accepted, since the
   limit is 10 per 5 minutes and fallbacks are rare.
8. **Response** `new Response(ReadableStream)`: `Content-Type: text/event-stream; charset=utf-8`,
   `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. Frames are
   `event: <type>\ndata: <json>\n\n`; a `: ping` comment every 15 s while the model works keeps
   proxies from closing an idle connection. A rejection before streaming (`rateLimited`, `tooLong`)
   is still an event stream with one `error` event, sent with the action's status (429/400), so the
   client handles both the same way and does **not** fall back.
9. **Abort on disconnect.** The route passes an `AbortSignal` that fires on `request.signal`
   (client closed the page or cancelled, which aborts the `fetch`) **or** the stream's `cancel()`;
   `replyStream` combines it with `AI_TIMEOUT_MS` and its own controller, aborted in the generator's
   `finally`, so leaving the `for await` (or a thrown error) also stops the model call.
10. **Model streaming client.** `createChatStreamClient(config)` in `client.ts` returns
    `ChatStreamFn = (request, signal) => AsyncIterable<string>` (content deltas): same request body
    with `stream: true`, parsing the OpenAI-compatible SSE (`data: {choices:[{delta:{content}}]}`,
    `data: [DONE]`) with a zod schema in `client.schema.ts`; same `AiError` kinds as `createChatClient`.
    Only the intro call streams; tool rounds and the JSON call don't need to.
11. **Client: the narrow "no client fetching" exception.** `usePerfumerStream` uses `fetch` + a
    stream reader because `useFetcher` can't stream. Documented in `docs/ai-perfumer.md` and noted in
    the AGENTS.md architecture rule so it isn't copied elsewhere. No library: a small SSE parser
    (`app/features/perfumer/sse.ts`) and a hand-written event guard (no zod in the browser, #96).
12. **Fallback** to the existing `useFetcher` action when the stream can't be used: `fetch` rejects
    (not an abort), the response isn't `text/event-stream`, there's no `response.body`, or the stream
    ends/breaks before `done` or `error`. Also mid-stream. The pending turn keeps
    its steps and returns to the rotating hints while the action runs. An `error` event is shown as
    today (retry where `isRetryable`); it doesn't trigger the fallback.
13. **Thread state.** The pending turn (`PendingTurn`) gains `steps`, `intro` (text so far) and
    `picks`; only the finished reply (`{ intro, picks, question }`) joins `items` and
    `sessionStorage`, so storage and `toHistory` are unchanged.
14. **UI** (Option C+, `docs/design.md`): the thinking bubble lists step chips (pill, `bg-blush`,
    `animate-pop`, the latest with the dots, earlier ones with a check) instead of the rotating hint
    once the first step arrives; when the first `intro` arrives, the bubble becomes a perfumer turn in
    progress (same layout as `PerfumerTurn`) with the intro typing in and the dots below it until
    `picks`. Screen readers: the steps' container is `role="status"` (each new step announced); the
    typing intro is `aria-busy="true"` until `done`, so it's read once. The cancel button keeps its
    10 s delay.

## Resolved questions

- **Is an extra model call for the intro acceptable?** — Yes: the intro is streamed in a third call
  after the picks are fixed, adding roughly 1–3 s locally (decision 1). (source: the owner, Q1)
- **Fall back to the action when the stream breaks after progress was shown?** — Yes, on every
  transport failure, keeping the steps shown; a second failure shows the action's error as today
  (decision 12). (source: the owner, Q2)
- **Should the eval also measure the streaming path?** — Not in this issue; #172 adds a
  `--stream` mode to `pnpm ai:perfumer-eval`. (source: the owner, Q3)
- **Where does the locale come from in a resource route?** — From the path (`getLocale` →
  `localeFromPath`), so the stream route needs `uk`/`en` paths, registered like `checkoutPay`.
  (source: `app/.server/locale.ts`, `app/routes.ts`, `app/lib/paths.ts`)
- **Does the CSP allow the fetch?** — Yes, same origin under `connect-src 'self'`.
  (source: `app/.server/security-headers.ts`)
- **Does the engine already support cancelling?** — Yes, `deps.signal` combined with
  `AbortSignal.timeout(AI_TIMEOUT_MS)`; the chat client passes it to `fetch`.
  (source: `app/.server/ai/perfumer.ts`, `client.ts`, #163)
- **How are sentences split?** — `splitSentences` splits after `.!?…` followed by whitespace; the
  incremental guard uses the same rule, so a sentence is complete when a terminator is followed by
  whitespace or the stream ends. (source: `app/.server/ai/answer-guard.ts`)
- **What may a step show?** — The model's note words are often nonsense and a `similar_to` title may
  not exist; the guard's rule "names never come from the model" applies, so steps show resolved
  families, the gender, the budget and catalog titles only. (source: `docs/ai-perfumer.md` → Results)
- **Where do the rate limits live?** — `perfumerLimiters` in `app/.server/rate-limit`, applied in
  `answerPerfumerMessage`. (source: `app/.server/services/perfumer-chat.ts`)

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/lib/perfumer.ts` | `PerfumerStep`, `PerfumerEvent`, `isPerfumerEvent` guard |
| modify | `app/lib/paths.ts` | `perfumerStream` page (`parfumer/stream`, `en/perfumer/stream`) |
| modify | `app/routes.ts` | register `routes/perfumer.stream.ts` with `localizedRoute` in `_shop` |
| create | `app/routes/perfumer.stream.ts` | POST resource route: validate, rate limit, SSE response |
| create | `app/routes/perfumer.stream.test.ts` | route tests |
| modify | `app/.server/ai/client.ts`, `client.schema.ts` | `createChatStreamClient`, chunk schema |
| modify | `app/.server/ai/client.test.ts` | streaming client tests |
| modify | `app/.server/ai/catalog-tools.ts` | `step` on `ToolCallRecord` |
| modify | `app/.server/ai/answer-guard.ts` | `IntroGuard` (incremental per-sentence cleaning) |
| modify | `app/.server/ai/answer-guard.test.ts` | `IntroGuard` tests |
| modify | `app/.server/ai/perfumer.schema.ts` | `modelPicksSchema`, `MODEL_PICKS_JSON_SCHEMA` |
| modify | `app/.server/ai/prompts.ts` | `finalPicksInstructions`, `introInstructions` (uk/en) |
| modify | `app/.server/ai/perfumer.ts` | shared helpers, `replyStream` |
| modify | `app/.server/ai/perfumer.test.ts` | stream order, abort, per-sentence removal |
| modify | `app/.server/services/perfumer-chat.ts` (+ test) | `admitPerfumerMessage`, `streamPerfumerMessage` |
| create | `app/features/perfumer/sse.ts` (+ `sse.test.ts`) | SSE frame parser |
| create | `app/features/perfumer/usePerfumerStream.ts` | fetch + reader → events, abort |
| modify | `app/features/perfumer/usePerfumerThread.ts` | stream first, fallback to the fetcher |
| create | `app/features/perfumer/StepList.tsx` | step chips with translated sentences |
| create | `app/features/perfumer/TypingText.tsx` | reveals text by character (motion-safe) |
| modify | `app/features/perfumer/ThinkingBubble.tsx`, `MessageThread.tsx` | steps, streaming turn |
| modify | `app/features/perfumer/PerfumerPage.dom.test.ts`, `perfumer-ui.test.ts` | UI + fallback tests |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `perfumer.steps.*` |
| modify | `docs/ai-perfumer.md`, `docs/design.md`, `AGENTS.md` | streaming, the fetch exception, UI |

## Steps

- [ ] **1. Shared event types.** In `app/lib/perfumer.ts` add `PerfumerStep` and `PerfumerEvent`
  (decision 3) and `isPerfumerEvent(value: unknown): value is PerfumerEvent`, a hand-written guard
  (checks `type` and the payload's fields; products are trusted as server data). Add
  `PERFUMER_STREAM_EVENTS` as a `const` tuple. Unit tests in `perfumer-ui.test.ts`.
- [ ] **2. Step data from the tools.** In `catalog-tools.ts` add `step?: PerfumerStep` to
  `ToolCallRecord`, set by `runCatalogTool` for successful calls: for search, the resolved families
  (the synonym-mapped ones the ranking used), `gender`, `max_price_uah`, `found`; for `similar_to`,
  `reference?.title` and `found`. Failed calls get no step. Extend `catalog-tools.test.ts`: raw note
  words never appear in a step; an unknown similar title gives `title: undefined`.
- [ ] **3. Streaming model client.** `client.schema.ts`: `chatCompletionChunkSchema`
  (`choices[0].delta.content` nullable). `client.ts`: `ChatStreamFn` and `createChatStreamClient`,
  sharing headers/body with `createChatClient` (`toRequestBody(config, request, { stream: true })`),
  reading `response.body` through `TextDecoderStream`, splitting on blank lines, yielding non-empty
  deltas, stopping at `[DONE]`; errors map to `unavailable` / `timeout` / `bad_response` as today.
  Tests with a fake `fetch` returning a `ReadableStream`: deltas in order, chunks split mid-line,
  `[DONE]`, HTTP 404 → `unavailable`, abort → `timeout`.
- [ ] **4. Engine: `replyStream`.**
  - `perfumer.schema.ts`: `modelPicksSchema` (`picks`, `question`) and `MODEL_PICKS_JSON_SCHEMA`.
  - `prompts.ts`: `finalPicksInstructions(locale)` (JSON with picks and question only) and
    `introInstructions(locale, pickIds)` (1–3 plain sentences introducing the chosen aliases, or, with
    none, saying nothing fit / politely declining; no names, ids or prices; no JSON).
  - `answer-guard.ts`: `class IntroGuard { constructor(context, max); push(delta): string;
    end(): string; removed: string[]; full: boolean }` — buffers deltas, cleans each sentence as it
    completes with `cleanProse`, returns the kept text, stops at `max` (`full`).
  - `perfumer.ts`: extract `prepareReply()` (parse, config, signal, catalog, history, aliases,
    trace), `toolRound()` returning the new `ToolCallRecord[]` (or `null`), `validatePicks()` and
    `cleanReasons()` from `validate()`; `replyWithTrace` uses them and behaves as before (existing
    tests unchanged). Add `replyStream(locale, messages, deps & { chatStream? }):
    AsyncGenerator<PerfumerEvent>` following decision 1, including the search nudge, `step` events
    right after each tool round, the intro fallback, and an internal `AbortController` aborted in
    `finally`. Errors propagate as `AiError` (the service maps them).
  - Tests (`perfumer.test.ts`, fake `chat`/`chatStream`): event order `step, step, intro…, picks,
    question, done`; an invented name in the second intro sentence is removed while the first and
    third arrive; an all-removed intro yields the fallback; no tool call → `picks: []`; breaking out of
    the `for await` aborts the signal the fake `chatStream` received; `deps.signal` abort → `timeout`.
- [ ] **5. Chat service.** In `perfumer-chat.ts` extract `admitPerfumerMessage(input, limiters)` →
  `{ ok: true } | { ok: false, error: "rateLimited" }`; `answerPerfumerMessage` uses it (tests
  unchanged). Add `streamPerfumerMessage(input, deps): AsyncGenerator<PerfumerEvent>` that admits,
  then forwards `replyStream`'s events, mapping a thrown `AiError` / unknown error / abort to one
  `error` event with the same keys and logging as the action. Tests: rate-limited yields only
  `error: rateLimited` and never calls the engine; `AiError("timeout")` → `error: timeout`.
- [ ] **6. Resource route.** `paths.ts` `perfumerStream`; `routes.ts` `...localizedRoute(
  "perfumerStream", "routes/perfumer.stream.ts")` next to `perfumer` (inside the layout, with a
  comment). `app/routes/perfumer.stream.ts`: `action` → 404 unless enabled; `parsePerfumerRequest`
  (an `error` stream with 400 for `tooLong`); `getLocale` + `ensureVisitor`; an `AbortController`
  aborted by `request.signal` and by the stream's `cancel()`; a `ReadableStream` that encodes
  frames (`event:`/`data:`), sends `: ping` every 15 s, closes after `done`/`error`, and clears the
  timer in `finally`. Headers per decision 8; status 429 when the first event is `rateLimited`.
  Check the security-headers middleware still applies (it must not buffer the body).
  Tests (`perfumer.stream.test.ts`, mocking the service like `perfumer.test.ts`): 404 when disabled,
  content type and frame format, 429 stream for rate limit, aborting `request.signal` aborts the
  signal the engine got, cancelling the response body does the same.
- [ ] **7. Client SSE parsing.** `app/features/perfumer/sse.ts`: `createSseParser()` with
  `push(chunk): { event, data }[]` handling `\n`/`\r\n`, frames split across chunks, comments
  (`:`), multi-line `data`. `sse.test.ts`.
- [ ] **8. `usePerfumerStream`.** `streamPerfumerReply({ url, payload, signal, onEvent })`:
  `fetch(url, { method: "POST", body: FormData, signal, headers: { Accept: "text/event-stream" } })`,
  checks content type and `body`, pipes through `TextDecoderStream` and the parser, JSON-parses and
  guards each event with `isPerfumerEvent`, resolves `"done" | "error"` or throws `StreamFailed`
  (transport failure, before or after events) — an `AbortError` is rethrown as is. The URL comes from
  `pathFor(locale, "perfumerStream")`.
- [ ] **9. Wire it into the thread.** In `usePerfumerThread`: `send`/`retry` start the stream with an
  `AbortController` kept in a ref; events update the pending turn (`steps`, `intro`, `picks`,
  `question`); `done` assembles `{ intro, picks, question }` into a `perfumer` item; `error` adds an
  `error` item; `StreamFailed` (not after a cancel) falls back to the existing `submitForm` path with
  the same payload. `cancel`, `startOver` and unmount abort the controller and `reset()` the fetcher.
  Skip streaming entirely when `ReadableStream`/`TextDecoderStream` are missing.
- [ ] **10. UI.** `StepList.tsx` renders `PerfumerStep`s as translated sentences
  (`perfumer.steps.search` "Шукаю в каталозі: {families}", `…searchFor` with gender, `…upTo`
  "до {price}" via `formatPrice`, `…similar` "Шукаю схожі на «{title}»", `…similarUnknown`,
  `…found` plural "{count} аромат/аромати/ароматів"); family labels via `fragranceFamilyLabel`.
  `ThinkingBubble` takes `steps` and shows `StepList` instead of the hint once there's one.
  `MessageThread` renders a streaming turn when `pending.intro` is set: `TypingText` for the intro,
  the dots until picks, then the cards as in `PerfumerTurn` (extract the shared card list). Keys in
  `uk.ts` and `en.ts`. Follow `docs/design.md` tokens and motion rules.
- [ ] **11. UI tests** (`PerfumerPage.dom.test.ts`, mocking `fetch` with a `ReadableStream`): steps
  appear before the reply; the intro then the cards appear; cancel aborts the fetch signal; a 500 /
  non-event-stream response / a broken stream falls back to the action (fetcher submit called once);
  an `error: rateLimited` event shows the error without a fallback; the finished reply is saved to
  `sessionStorage` like an action reply. English copy under `<I18nProvider locale="en">`.
- [ ] **12. Docs.** `docs/ai-perfumer.md`: a "Streaming" section (route, events, order, the two-step
  final answer, per-sentence guard, abort, ping, fallback) and the fetch exception; `docs/design.md`:
  step chips and the typing intro; `AGENTS.md`: one clause in the "Reads in loaders" rule naming the
  perfumer stream as the only `fetch` exception.
- [ ] **13. Verify.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`; then the manual checks
  below with Ollama.

## Testing & verification

- Unit: `client.test.ts` (streaming), `catalog-tools.test.ts` (steps), `answer-guard.test.ts`
  (`IntroGuard`), `perfumer.test.ts` (event order, abort on early exit, per-sentence removal,
  fallback intro), `perfumer-chat.test.ts` (stream errors, rate limit), `perfumer.stream.test.ts`
  (route), `sse.test.ts`, `perfumer-ui.test.ts` (event guard), `PerfumerPage.dom.test.ts` (UI,
  cancel, fallback). `app/lib/client-bundle.guard.test.ts` must still pass (no zod in the browser).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual (`pnpm aspire run` with `AI_BASE_URL` set): ask "щось свіже з морськими нотами до 600 грн"
  → a step within a few seconds, the intro typing in, then the cards; English at `/en/perfumer`;
  cancel after 10 s and confirm in the Ollama log / CPU that generation stops; close the tab mid-reply,
  same check; block `/parfumer/stream` in DevTools (request blocking) → the reply still arrives via
  the action; reduced motion → the intro appears without typing; check the CSP report endpoint logs
  nothing.

## Acceptance criteria

- [ ] The first visible progress appears within a few seconds of sending, while the model is still
  working — steps 2, 4, 6, 8, 9, 10
- [ ] The intro appears progressively, followed by the validated product cards — steps 3, 4, 9, 10
- [ ] Closing the page or pressing cancel stops the model call on the server — steps 4, 6, 9
- [ ] If streaming fails, the page falls back to the normal request — steps 8, 9, 11
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 13

## Out of scope

- Streaming each card's reason (the issue's out of scope).
- Changing `reply()`, its prompt, or the eval and its recorded results (#172).
- Persisting conversations on the server, or resuming a stream after a reload.
- WebSockets or a client fetching library.
- Hosting or choosing a faster model (#167); analytics events for the chat (#166).
