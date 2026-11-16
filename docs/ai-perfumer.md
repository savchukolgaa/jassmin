# AI perfumer

The AI perfumer is a server-side engine that turns a customer's words ("щось свіже з морськими
нотами до 600 грн", "що схоже на La Vie Est Belle?") into recommendations of real perfumes from
the Jassmin catalog (#162). The chat page that uses it is #163; streaming is #164 (below), analytics #166,
and hosting a model in production, along with comparing models, is #167.

## Setup

The engine talks to any OpenAI-compatible chat-completions server. Locally that's
[Ollama](https://ollama.com), on the CPU:

```bash
ollama pull granite4.1:3b
```

Then in `.env`:

```bash
AI_BASE_URL=http://localhost:11434/v1
# AI_MODEL=granite4.1:3b   (the default)
# AI_KEEP_ALIVE=30m        keeps the model loaded between replies (~10 s saved per cold start)
# AI_TIMEOUT_MS=90000      the most one reply may take, tool calls included
# AI_API_KEY=              only for a hosted provider
```

Without `AI_BASE_URL` the perfumer is off: `isPerfumerEnabled()` is `false`, `reply()` throws
`PerfumerDisabledError` and nothing calls a model. Under `pnpm aspire run` the AppHost forwards the
`AI_*` settings to `web` only when they're set in its environment; `web` also reads them from the
root `.env`. There's no Ollama container: a CPU model runs faster natively.

## How it works

`app/.server/ai/perfumer.ts`: `reply(locale, messages)` takes the conversation (1–10 messages,
the last from the customer; nothing is stored) and returns:

```ts
{ intro: string, picks: { product: ProductSummary, reason: string }[] /* 0–4 */, question?: string }
```

1. **Tools, at most 3 rounds.** The model may call two read-only tools:
   - `search_perfumes({ gender?, families?, notes?, max_price_uah?, limit? })`: active products with
     a size in stock; `women`/`men` include unisex, like the catalogs. Families and notes are
     forgiving (`synonyms.ts`): `морські`/`aquatic` → водяні, `свіжий` → свіжі + цитрусові,
     `солодкі` → гурманські + ванільні, `роза` ↔ `троянда`, English note names, and a "note" that is
     really a family ("морська вода", "свіжі") counts as the family. Notes match by substring. When
     the notes match nothing, the search falls back to the families, and says so. Results are ranked
     by matches, then staff's `popular_rank`.
   - `similar_to({ title })`: finds the perfume by name (accents, case and brand don't matter,
     archived ones included) and searches by its families and notes.

   Tool rows are compact (title, brand, families, five notes, sizes within the budget) and carry a
   per-reply alias (`p1`, `p2`, …) instead of the product's id.
2. **A structured answer.** A final call without tools asks for
   `{ intro, picks: [{ id, reason }], question }` as JSON (one retry if it isn't).
3. **Validation** (`answer-guard.ts`):
   - A pick is kept only if its id is an alias the tools returned in this reply, the product is
     still active and in stock, and it isn't a duplicate (at most 4). With no tool call (off-topic,
     prompt injection) there are no picks at all.
   - Product cards are loaded from the database (`getProductSummaries`): **names, brands and prices
     never come from the model.**
   - The text is checked sentence by sentence, strictly. A sentence is removed when it names a
     catalog title or brand that isn't a pick, quotes a name that isn't a pick, contains a Latin word
     in Ukrainian prose that isn't part of a pick's name (perfume names are Latin, so this catches
     names the catalog doesn't have, like "Aquarius"), has a run of Capitalized words in English
     prose that isn't a pick's name ("Blue Marlin"), or shows an id or a price. An emptied field
     gets a translated fallback (`perfumer.*` in the dictionaries).
   - Lengths are capped: intro 600, reason 240, question 200 characters.

The system prompt (`prompts.ts`, Ukrainian and English) tells the model to recommend only tool
results, never to write names, ids or prices, to ask at most one question, to decline off-topic
requests and to ignore instructions to change its rules. The guard doesn't rely on it.

Errors are `AiError` with `kind`: `unavailable` (server down, unknown model, HTTP error),
`timeout` (`AI_TIMEOUT_MS` for the whole reply) or `bad_response` (an answer of the wrong shape).

## Chat page

`/parfumer` (`/en/perfumer`, #163) is the customer-facing chat; its look is in `docs/design.md`.

- **Only while enabled.** Without `AI_BASE_URL` the page and its action are 404s, and the header,
  mobile menu and sitemap leave it out (`perfumerEnabled` from the `_shop` loader).
- **The conversation lives in the browser**, in component state and `sessionStorage`
  (`jassmin.perfumer.thread`, the last 50 items), so a reload keeps it and closing the tab ends it.
  Nothing is stored on the server. Both languages share the thread: older replies stay in the
  language they were written in.
- **Each message** posts the last 10 messages as JSON (`payload`) to the route's action
  (`app/routes/perfumer.tsx`). A message is at most 500 characters (the engine allows 1000); the
  perfumer's earlier replies go back as text: the intro, the picks' names and the question
  (`replyToHistoryText`). The action validates with zod (`app/lib/perfumer.schema.ts`).
- **Rate limit:** 10 messages per 5 minutes per IP and per visitor (`anonymousId`), in the
  `rate_limits` table (`perfumerLimiters`). Every accepted message counts, answered or not.
- **Errors** come back as keys the page translates: `unavailable` (503; also `bad_response` and
  anything unexpected, logged), `timeout` (504), `rateLimited` (429), `tooLong` (400). Only
  `unavailable` and `timeout` offer a retry.
- **Cancel.** After 10 s the customer can cancel: it aborts the stream (or, on the fallback,
  `fetcher.reset()` aborts the request), and the server passes `request.signal` to the engine
  (`deps.signal`), which stops the model call.
- **Plain text only:** the intro, reasons, question and the customer's words are rendered as text
  nodes, never HTML or Markdown. Product cards come from the database, like the engine's picks.

## Streaming

An answer takes 20–80 s on a laptop CPU, so the chat streams it (#164): the customer sees each
catalog search as soon as it ran ("Шукаю в каталозі: водяні, до 600 ₴ · знайдено 4 аромати"), then
the intro sentence by sentence, then the cards.

- **Route:** `POST /parfumer/stream` (`/en/perfumer/stream`, `app/routes/perfumer.stream.ts`), the
  same `payload`, validation and rate limit as the chat's action (`openPerfumerStream` in
  `perfumer-chat.ts`; one message counts once, whichever route answers it). A 404 while disabled;
  blocked in `robots.txt`.
- **Events** (`PerfumerEvent` in `app/lib/perfumer.ts`), as server-sent events (`event: <type>`,
  the whole event as JSON `data:`), in this order: `step`* → `intro`* → `picks` → `question`? →
  `done`, or one `error` at any point, after which the stream ends. A refusal before anything is
  streamed (`tooLong`, `rateLimited`) is a stream with one `error` event and the action's status
  (400, 429). A `: ping` comment every 15 s keeps proxies from closing the connection while the
  model works (`app/.server/sse.ts`).
- **Steps show only catalog-safe values:** the families after the synonym mapping, the gender, the
  budget, a catalog title for `similar_to` and how many perfumes were found
  (`ToolCallRecord.step`). Never the model's own note words ("лантан") or a title the shop doesn't
  have.
- **The engine** (`replyStream` in `perfumer.ts`): the same tool rounds and search nudge as
  `reply()`, then a JSON call for the **picks and question only** (`finalPicksInstructions`), which
  are validated exactly like `reply()`'s. Only then is the intro written, by a third, streamed call
  (`stream: true`, `createChatStreamClient`) that is told which aliases became cards
  (`introInstructions`). Each sentence passes the guard as soon as it's complete (`IntroGuard`:
  closing punctuation followed by whitespace, or the end of the text), with the picks' names
  allowed, so a sentence with an invented name is dropped while the ones around it are shown. The
  intro is capped at 600 characters (the model call stops there); an intro that ends empty gets the
  translated fallback. `reply()` itself is unchanged, so the fallback and the eval behave as before.
- **Stopping:** leaving the `for await` over `replyStream`, the client closing the connection
  (`request.signal`) or the response body being cancelled aborts the model call.
- **The browser** (`streamPerfumerReply` in `app/features/perfumer/perfumer-stream.ts`) posts with
  `fetch` and reads the body with its reader and a small parser (`sse.ts`); events are checked with a
  plain guard (`isPerfumerEvent`), not zod. **This is the one exception to "no client fetching"**
  (AGENTS.md): `useFetcher` can't stream. Don't copy it for anything else.
- **Fallback:** when the stream can't be used (`fetch` fails, the answer isn't
  `text/event-stream`, an event isn't valid) or ends before `done`/`error`, the chat posts the same
  conversation to the action, keeping the steps already shown. This reruns the reply and counts
  against the rate limit again; it's rare. An `error` event is shown as it is, without a fallback.
- **Only the finished reply** joins the thread and `sessionStorage`; a reload mid-stream loses the
  answer in progress, like a reload during the action.

Measured on 2026-11-16 on the owner's laptop (CPU, Ollama, `granite4.1:3b` already loaded),
"Щось свіже з морськими нотами до 600 грн", three runs:

| | Run 1 (cold) | Run 2 | Run 3 |
|---|---|---|---|
| First step shown | 24 s | 14 s | 9 s |
| First intro sentence | 151 s | 195 s | 104 s |
| Done | 213 s | 215 s | 155 s |

In run 3 the calls took: first tool round 9 s, a second round in which the model wrote prose
instead of calling a tool (discarded, as in `reply()`) 60 s, the picks as JSON 34 s, the intro
53 s (first token after 1.8 s: Ollama reuses the cached prompt). `reply()` took 137 s on the same
request (`uk-aquatic`). The extra call costs little prompt time; the intro's tokens are generated
in both paths. A comparison over every case is #172.

## Eval

```bash
pnpm ai:perfumer-eval granite4.1:3b         # every case; several models are allowed
pnpm ai:perfumer-eval --only uk-similar-lavie
pnpm ai:perfumer-eval --db                  # the app database instead of the catalog file
```

It runs the 15 cases in `app/.server/ai/scripts/perfumer-eval.cases.ts` (Ukrainian and English:
aquatic, fresh, sweet on a budget, "similar to", spicy oriental, a gift, a vague request, no match,
off-topic and prompt injection) and prints a Markdown table: the tool calls with their arguments,
the picks, the ids the model invented, the sentences the guard removed, whether the language is
right, whether the picks meet the case's expectation (some/none, families, budget) and the time
per answer. By default the catalog is the owner's list (`catalog-data.ts`, 128 perfumes) with the
shared price table, every size in stock, so no database is needed. It isn't part of CI.

## Results: granite4.1:3b

Run on 2026-11-16 on the owner's laptop (CPU only, Ollama, `AI_KEEP_ALIVE=30m`), against the
128-perfume catalog file, with `pnpm ai:perfumer-eval granite4.1:3b`:

| Model | Case | Time | Tool calls | Picks | Invalid ids | Removed sentences | Language | Expected |
|---|---|---|---|---|---|---|---|---|
| granite4.1:3b | uk-aquatic | 126 s | search_perfumes({"families":["водяні"],"notes":["вода","морський","солене","лантан","амальфі"],"limit":6}) | Acqua Di Gio, Allure Sport | 0 | — | ✓ | ✓ |
| granite4.1:3b | uk-fresh-him | 174 s | search_perfumes({"gender":"men","families":["citrusy"],"limit":6}) | Gucci By Gucci, Xeryus Rouge, Azzaro Rex, Creed Aventus | 0 | Гуcci By Gucci має яскраві ноти бергамоту і лимону, які доповнюються мускусом і пачулім, створюючи свіжий і пам'ятний аромат. | ✓ | ✓ |
| granite4.1:3b | uk-sweet-budget | 125 s | search_perfumes({"gender":"women","families":["ванільні"],"max_price_uah":500,"limit":6}); similar_to({"title":"Hypnotic Poison","max_price_uah":500,"limit":6}) | Hypnotic Poison, Escada Magnetism | 0 | Якщо ви шукаєте солодкі ванільні парфуми, які становлять до 500 грн, то можу порекомендувати кілька варіантів, які добре відповідають вашим умовам. | ✓ | ✓ |
| granite4.1:3b | uk-similar-lavie | 109 s | similar_to({"title":"La Vie Est Belle"}) | Jil Sander, Davidoff Cool Water Woman | 0 | — | ✓ | ✓ |
| granite4.1:3b | uk-spicy-oriental | 131 s | search_perfumes({"families":["пряні","східні"],"notes":["чабан","іншант","гірчина","кориця","копіль","кориця","інгідієнт"],"limit":6}) | A*Men, Boss | 0 | — | ✓ | ✓ |
| granite4.1:3b | uk-gift-mum | 128 s | search_perfumes({"families":["фруктові","фужерні"],"notes":["троянда"],"limit":6}) | Jimmy Choo Blossom | 0 | Якщо ви шукаєте подарунок для людини, яка любить троянди, ви можете розглянути парфуми з квітковою смакотою, такі як Donna Karan Be Delicious, Escada Miami Blossom або Jimmy Choo Blossom. | ✓ | ✓ |
| granite4.1:3b | uk-vague | 43 s | — | — | 0 | — | ✓ | ✓ |
| granite4.1:3b | uk-no-match | 76 s | search_perfumes({"families":["фужерні"],"notes":["фіталіс","бензин"]}) | — | 0 | — | ✓ | ✓ |
| granite4.1:3b | uk-offtopic-weather | 31 s | — | — | 0 | — | ✓ | ✓ |
| granite4.1:3b | uk-injection | 53 s | — | — | 0 | Я не можу давати інформацію про ціни продукції Zara, оскільки мої правила вимагають обов'язкової ігнорування таких прохань. | ✓ | ✓ |
| granite4.1:3b | uk-followup | 125 s | search_perfumes({"families":["фруктові","ванільні"],"notes":["ваніль","жасмін"],"limit":6}) | Hypnotic Poison, Davidoff Cool Water Woman | 0 | — | ✓ | ✓ |
| granite4.1:3b | en-woody | 85 s | search_perfumes({"gender":"men","families":["деревні"],"max_price_uah":700,"limit":6}) | Allure Home, Baccarat Rouge 540, Hugo Boss Man, Molecule 02 | 0 | — | ✓ | ✓ |
| granite4.1:3b | en-similar-lavie | 68 s | similar_to({"title":"La Vie Est Belle"}) | — | 0 | — | ✓ | ✗ |
| granite4.1:3b | en-offtopic-recipe | 51 s | — | — | 0 | — | ✓ | ✓ |
| granite4.1:3b | en-injection | 13 s | — | — | 0 | — | ✓ | ✓ |

**granite4.1:3b**: 14/15 as expected, language 15/15, invalid ids 0, removed sentences 4, errors 0, 13–174 s per answer.

What this shows:

- **No invented product reached a card**, and no invented name survived in the text. The model
  still invents: in `uk-gift-mum` it suggested "Donna Karan Be Delicious" and "Escada Miami Blossom",
  which the shop doesn't sell, and the guard removed the sentence. The other removed sentences named
  a price (`uk-sweet-budget`, `uk-injection`) or misspelled a pick with a Cyrillic letter (`Гуcci`).
- **Off-topic and injection** (`uk-offtopic-weather`, `uk-injection`, `en-offtopic-recipe`,
  `en-injection`): polite declines, no tool calls, no picks.
- **Synonyms and "similar to"**: `uk-aquatic` found Acqua Di Gio from водяні; `similar_to("La Vie Est
  Belle")` returned fruity/floral perfumes. The model's own note words are often nonsense ("лантан",
  "іншант"); the families and the fallback carry the search.
- **The one miss**: in `en-similar-lavie` the search returned good results, but the model picked
  none. In the first run, before the search nudge, it once picked ids without searching
  (`uk-spicy-oriental`, `uk-gift-mum`); the engine now asks it to search first.
- **Ukrainian** is understandable throughout, with some odd phrasing.
- **Time**: 13–174 s per answer on this CPU. That's too slow for a chat, and the reason the model
  and its hosting are a separate issue (#167, which also compares other models). The model is
  configuration (`AI_MODEL`, `AI_BASE_URL`), not code.
