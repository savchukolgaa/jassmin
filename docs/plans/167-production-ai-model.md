# Plan: Choose and set up the AI perfumer's model for the live site (#167)

Issue: https://github.com/savchukolgaa/jassmin/issues/167
Branch: `issue/167`
Worktree: `.claude/worktrees/issue-167`
Status: Planned

## Goal

As the store owner, I want the AI perfumer to run on the live site fast enough and with correct
Ukrainian, so real customers can use it and not only my laptop. Compare at least four models with
`pnpm ai:perfumer-eval` (quality, speed, cost), record the table and the decision in
`docs/ai-perfumer.md`, and set up production purely through env configuration (`AI_BASE_URL`,
`AI_MODEL`, `AI_API_KEY`), with a spending cap, the existing "unavailable" fallback, and a privacy
policy that names the AI provider when messages leave the shop's server.

## Dependencies & prerequisites

- **#162 engine, #163 chat, #164 streaming, #166 analytics, #172 streamed eval**: all merged on
  `main`. The engine already talks to any OpenAI-compatible endpoint (`app/.server/ai/config.ts`,
  `client.ts`), sends `Authorization: Bearer` when `AI_API_KEY` is set, and maps every HTTP error
  except 400/422 (so 401, 402, 429, 5xx) to `unavailable`, which the chat shows with a retry.
- **Rate limit (#163)**: 10 messages / 5 min per IP and per visitor (`perfumerLimiters`). Exists.
- **Hosting is not decided yet** (the site isn't online; no deploy config in the repo). The
  production part of this issue is therefore documentation plus a checklist the owner follows
  when the host exists. See Q1.
- **Accounts / keys (owner)**: one hosted provider account for the open model and one for the
  frontier model (or one gateway covering both, see Decisions), each with a spending limit.
- **Local models**: `granite4.1:3b`, `granite4.1:8b`, `qwen3:4b` pulled in Ollama on the laptop.
- No new packages, no migrations.

## Decisions & assumptions

- **What gets compared**: the five models from the issue, all through the **streamed** eval
  (`pnpm ai:perfumer-eval --stream`), because that is what customers get (#164) and it already
  prints p50/p95 for first step, first intro sentence and total. A plain `reply()` run is optional.
  1. `granite4.1:3b` (laptop, Ollama, baseline; reuse the 2026-11-17 streamed run already in the doc
     if nothing in the engine changed since),
  2. `granite4.1:8b` (laptop, Ollama),
  3. `qwen3:4b` (laptop, Ollama),
  4. one **hosted open model** (e.g. a Qwen3 or Llama instruct model with tool calling) **(unconfirmed, Q2)**,
  5. one **hosted frontier model** (e.g. `claude-haiku-5-5` or a comparable small frontier model)
     **(unconfirmed, Q2)**.
- **"Latency" in the table** is the streamed **total** p50/p95 (the answer is complete), with
  first-intro p50 alongside; the ~10 s acceptance target applies to total p50. **(unconfirmed, Q4)**
- **Cost per 1000 answers needs token counts, which the eval doesn't record yet.** Add usage
  capture: read `usage.prompt_tokens` / `usage.completion_tokens` from each chat-completions
  response (and from the final stream chunk, requesting it with
  `stream_options: { include_usage: true }`), sum them per reply into the trace, and print
  "tokens in / out per answer (mean)" per model. Cost per 1000 answers is then computed from the
  provider's price per million tokens, passed to the eval as `--price-in <usd/M> --price-out
  <usd/M>` (optional; without them the column shows tokens only). For Ollama on the laptop the cost
  is `0` per message (hardware cost noted separately in the doc's prose). Tokens never go to the
  browser or to analytics (the event contract stays unchanged).
- **One provider per eval run.** The eval uses a single `AI_BASE_URL`/`AI_API_KEY` for all model
  arguments, so hosted models are run separately with those env vars set for the command
  (`process.loadEnvFile` doesn't override variables already set in the environment). Document the
  PowerShell and bash forms. No code change needed for this.
- **Ukrainian quality 1–5** is the owner's judgment from the printed intros/reasons; the eval
  can't score it. To make judging possible, add a `--texts` flag that also prints, after the table,
  each case's intro, reasons and question per model (plain text, Markdown-escaped). **(unconfirmed, Q5)**
- **Spending cap = provider-side**, as the issue's Technical section says: a hard monthly limit on
  the provider account/API key plus an email alert at e.g. 50 % and 80 %. When the cap is hit the
  provider answers 402/429, the client maps it to `unavailable`, the chat shows "unavailable" and
  the shop keeps working. No in-app budget counter. **(unconfirmed, Q3)** Add a test that 402 and
  429 map to `unavailable`, so this fallback is pinned.
- **Production timeout**: document `AI_TIMEOUT_MS=30000` for a hosted model (the 90 s default was
  sized for the laptop CPU). `AI_KEEP_ALIVE` is Ollama-only and stays unset for a hosted model.
- **Privacy policy**: add a paragraph to the "Кому ми передаємо дані" section saying that messages
  written to the AI perfumer are sent to the model provider, `{provider}`, only to produce the
  answer, aren't stored by the shop, and shouldn't contain personal data. Shown only when the
  perfumer is enabled **and** a new optional env var `AI_PROVIDER_NAME` (display name, e.g.
  "OpenRouter" or "Anthropic") is set, so Ollama on the shop's own server shows nothing and the
  live site still needs env configuration only. **(unconfirmed, Q6)**
- **Thinking models** (`qwen3:4b`, some hosted ones) may spend many tokens reasoning before
  answering. Run them as configured first; only if the eval shows thinking dominates latency, add an
  optional `AI_REASONING_EFFORT` env sent as `reasoning_effort` (sent only when set, like
  `keep_alive`). Not planned up front.
- **Implemented (step 2):** the trace field is `tokens: { input, output, unreported }`. Every
  streamed call sends `stream_options: { include_usage: true }` (part of the OpenAI spec; checked
  against Ollama, which answers with a final `usage` chunk). A streamed intro that the guard stops
  early never reaches that chunk, so it counts as `unreported` and the totals are then a lower
  bound; the eval says so. The open questions weren't answered before implementing, so the plan's
  recommended defaults apply.
- Models that reject `tools` + strict `response_format: json_schema` show up as `bad_response`
  errors in the eval; that is a valid result for the table ("not compatible"), not something to work
  around in this issue.

## Open questions

- [ ] **Q1: Where will the site be hosted, and is that decided within this issue?** — Why it matters:
  acceptance criterion 3 ("the live site uses it") can only be verified once a host exists, and a
  GPU host would make Ollama-on-server viable. Recommended default: this issue delivers the
  comparison, the decision, the env/secret checklist and the privacy text; the "live site"
  check is a checklist item the owner ticks when hosting goes live (the PR can merge before that,
  leaving the issue open or noting it in the PR). Affects steps: 7, 8.
- [ ] **Q2: Which hosted providers and models to evaluate?** — Why it matters: needs accounts, keys
  and spending limits; also decides where customer messages go (privacy). Recommended default:
  **OpenRouter** as one OpenAI-compatible gateway for both hosted candidates (one key, per-key
  credit limit, usage alerts), with one open model (a Qwen3 instruct model with tool support) and
  one small frontier model (`claude-haiku-5-5` or similar); prices taken from the provider's page on
  the day of the run. Affects steps: 5, 6.
- [ ] **Q3: Is a provider-side spending limit enough, or do you also want an in-app monthly cap?** —
  Why it matters: an in-app cap needs a token/cost counter table and a migration; provider-side
  needs none. Recommended default: provider-side limit + alert only (the issue's Technical
  section), plus the existing rate limit. Affects steps: 2, 7.
- [ ] **Q4: Does "under ~10 s (p50)" mean the whole streamed answer, or the first intro sentence?** —
  Why it matters: it decides which models pass. Recommended default: total p50 of the streamed eval
  ≤ ~10 s, with first-intro p50 reported too. Affects steps: 6.
- [ ] **Q5: Add `--texts` to the eval so you can judge Ukrainian from the actual answers?** —
  Why it matters: the table currently shows only removed sentences, not the answer text; judging
  1–5 from it is guesswork. Recommended default: yes, a small flag. Affects steps: 3.
- [ ] **Q6: How should the privacy policy name the provider?** — Why it matters: the text must stay
  true after a provider change without a code change. Recommended default: optional
  `AI_PROVIDER_NAME` env; the paragraph appears only when it and `AI_BASE_URL` are set. Alternative:
  a fixed sentence naming the chosen provider (code change on every switch). Affects steps: 4.

## Resolved questions

- **Does production need code to switch models?** — No: `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`
  are read from env (`app/.server/env.ts`, `app/.server/ai/config.ts`); the eval already accepts
  any model name. (source: `docs/ai-perfumer.md` → Setup, #162)
- **What happens when the provider fails or the cap is reached?** — The client throws
  `AiError("unavailable")` for any HTTP status other than 400/422 and for unreachable servers; the
  chat answers 503 / an `error` event shown as "unavailable" with retry. (source:
  `app/.server/ai/client.ts` `post()`, `docs/ai-perfumer.md` → Chat page)
- **Is the rate limit already in place?** — Yes, 10 messages / 5 min per IP and per visitor in
  `rate_limits`. (source: `docs/ai-perfumer.md` → Chat page, #163)
- **Do we store message text anywhere?** — No: the thread lives in the browser, and
  `perfumer_message` analytics events hold no text. So the only third party seeing messages would
  be the model provider. (source: `docs/ai-perfumer.md` → Chat page, Analytics, #166)
- **Does the eval measure streamed p50/p95?** — Yes, `--stream` (#172) prints p50/p95 for first
  step, first intro and total. (source: `app/.server/ai/scripts/perfumer-eval.ts`)
- **Does the eval measure tokens or cost?** — No; neither the client nor the trace reads `usage`.
  Hence step 2. (source: `app/.server/ai/client.ts`, `perfumer-eval.ts`)
- **Where's the privacy text?** — `privacy.sharing.text` in `app/lib/i18n/uk.ts` / `en.ts`,
  rendered by `app/features/privacy/PrivacyPolicy.tsx`; the route loader is `app/routes/privacy.tsx`.
  It currently lists only hosting, email and delivery. (source: those files)
- **Can the eval target a hosted provider?** — Yes, via `AI_BASE_URL` / `AI_API_KEY` in the
  environment for the run; one provider per run. (source: `perfumer-eval.ts` header comment)

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/ai/client.ts` | Read `usage` from responses and the last stream chunk; request `stream_options.include_usage` when streaming |
| modify | `app/.server/ai/client.schema.ts` | Optional `usage` in the response/chunk schemas |
| modify | `app/.server/ai/perfumer.ts` | Sum tokens per reply into `PerfumerTrace` (`tokensIn`, `tokensOut`) |
| modify | `app/.server/ai/client.test.ts` | Usage parsed (present/absent); 402 and 429 → `unavailable` |
| modify | `app/.server/ai/perfumer.test.ts` | Trace sums usage across tool rounds and the intro call |
| modify | `app/.server/ai/scripts/perfumer-eval.ts` | Tokens per answer, `--price-in/--price-out` cost per 1000 answers, `--texts` |
| modify | `app/.server/ai/scripts/perfumer-eval.stream.ts` (+ `.test.ts`) | Pure helpers: mean tokens, cost per 1000, text dump formatting |
| modify | `app/.server/env.ts`, `app/.server/env.test.ts` | Optional `AI_PROVIDER_NAME` **(Q6)** |
| modify | `app/routes/privacy.tsx` | Loader returns `aiProvider: string \| null` (only when the perfumer is enabled) |
| modify | `app/features/privacy/PrivacyPolicy.tsx` | Render the AI paragraph when `aiProvider` is set |
| modify | `app/routes/privacy.test.ts` / component test | Paragraph shown/hidden |
| modify | `app/lib/i18n/uk.ts`, `app/lib/i18n/en.ts` | `privacy.sharing.ai` with `{provider}` |
| modify | `aspire-apphost/apphost.mts` | Forward `AI_PROVIDER_NAME` like the other `AI_*` settings |
| modify | `.env.example`, `docs/setup.md` | `AI_PROVIDER_NAME`; production values for `AI_TIMEOUT_MS` |
| modify | `docs/ai-perfumer.md` | Comparison section, decision, production setup checklist; update the #167 forward references |

## Steps

- [x] **1. Baseline check** — In the worktree run `pnpm typecheck`, `pnpm lint`, `pnpm test` to
  confirm a green start.
- [x] **2. Token usage in the client and trace** — Extend the chat-completions response schema and
  stream-chunk schema in `client.schema.ts` with an optional
  `usage: { prompt_tokens: number, completion_tokens: number }`. `createChatClient` returns it with
  the message; `createChatStreamClient` sends `stream_options: { include_usage: true }` and picks
  up `usage` from the final chunk (servers that ignore the option just leave it undefined).
  `perfumer.ts` adds the counts of every call (tool rounds, picks, intro) to `PerfumerTrace`
  (`tokensIn`, `tokensOut`, `undefined` when the server reported none). Nothing new reaches the
  browser or analytics. Tests: usage parsed when present, absent → `undefined`; trace sums across
  rounds; HTTP 402 and 429 → `AiError("unavailable")` (pins the spending-cap fallback).
- [ ] **3. Eval: cost and texts** — In `perfumer-eval.ts` add a `Tokens` column (in/out per case)
  and, in the per-model summary line, mean tokens per answer and, when `--price-in`/`--price-out`
  (USD per million tokens) are given, "cost per 1000 answers ≈ $X". Add `--texts` **(Q5)**: after
  the tables, per model and case, print the intro, each pick's reason and the question as a
  blockquote, for judging Ukrainian. Put the arithmetic (mean, cost per 1000) and text formatting
  in `perfumer-eval.stream.ts` as pure functions with tests. Update the header comment, the
  `docs/ai-perfumer.md` → Eval section and the `docs/setup.md` scripts row; show how to point a run
  at a hosted provider:
  ```powershell
  $env:AI_BASE_URL="https://…/v1"; $env:AI_API_KEY="…"; pnpm ai:perfumer-eval --stream --texts --price-in 0.1 --price-out 0.4 <model>
  ```
- [ ] **4. Privacy policy names the AI provider** **(Q6)** — Add optional `AI_PROVIDER_NAME`
  (`z.string().min(1).max(80).optional()`) to the AI env schema and `parseAiEnv`; forward it in
  `apphost.mts`; document it in `.env.example` and `docs/setup.md`. The privacy loader returns
  `aiProvider` = the name when `isPerfumerEnabled()` and the name is set, else `null`.
  `PrivacyPolicy` renders `t("privacy.sharing.ai", { provider })` after `privacy.sharing.text`.
  Copy (uk source of truth, en translated): messages written to the AI perfumer are sent to
  `{provider}` only to produce the answer; the shop doesn't store them; please don't include
  personal data. Tests: paragraph shown with a provider, hidden without one or with the perfumer
  off; English copy under `<I18nProvider locale="en">`.
- [ ] **5. Run the local evals (owner's laptop)** — `pnpm ai:perfumer-eval --stream --texts
  granite4.1:3b granite4.1:8b qwen3:4b` (Ollama, `AI_KEEP_ALIVE=30m`). If `qwen3:4b` spends most of
  its time thinking, note it (and see Decisions on `AI_REASONING_EFFORT`).
- [ ] **6. Run the hosted evals and decide** **(Q2, Q4)** — Create the provider account(s), set a
  spending limit, run the open and frontier candidates with `--stream --texts --price-in/--price-out`.
  In `docs/ai-perfumer.md` add **"Model comparison (#167)"**: one row per model with valid picks
  (as expected / 15), invented names (invalid ids + removed sentences), Ukrainian 1–5 (owner),
  first-intro p50, total p50/p95, tokens per answer, cost per 1000 answers, where it runs, and
  whether data leaves the shop. Keep the full per-case tables in a collapsed `<details>` per model.
  Write the decision and why (the chosen model must have total p50 ≲ 10 s and Ukrainian judged
  correct on the eval set).
- [ ] **7. Production setup docs** — In `docs/ai-perfumer.md` add **"Production"**: the env values
  for the chosen setup (`AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` as host secrets, never in the repo;
  `AI_TIMEOUT_MS=30000`; `AI_PROVIDER_NAME` if hosted; `AI_KEEP_ALIVE` only for Ollama), the
  spending limit and alert thresholds at the provider **(Q3)**, what customers see when the cap or
  provider fails (unavailable + retry, shop unaffected), how to watch it (the #166
  "Latency and errors" query, provider usage dashboard), and how to switch models (change env,
  re-run the eval first). Link it from `docs/setup.md` → environment table. Replace the "#167"
  forward references in the doc ("hosting … is #167", "comparing models is #167") with links to
  the new sections.
- [ ] **8. Live-site check** **(Q1)** — When hosting exists: set the secrets, deploy, send a
  Ukrainian and an English message on `/parfumer`, confirm the answer arrives in ≲ 10 s and the
  privacy page shows the provider; temporarily set a wrong `AI_API_KEY` (or wait for a cap) to see
  "unavailable" with the rest of the shop working. Record the date in the Production section.
  If hosting isn't live before the PR, leave this as an unchecked item in the PR description.
- [ ] **9. Finish** — `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Confirm the
  analytics fixture tests aren't affected (event contract unchanged).

## Testing & verification

- Unit: `client.test.ts` (usage parsing in JSON and streamed responses; 402/429 → `unavailable`),
  `perfumer.test.ts` (trace token sums), `perfumer-eval.stream.test.ts` (mean tokens, cost per
  1000, text dump escaping), `env.test.ts` (`AI_PROVIDER_NAME`), privacy route/component tests
  (paragraph shown/hidden, uk and en).
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Manual: the eval runs in steps 5–6 (owner's laptop and provider keys); the live check in step 8.
  The eval isn't part of CI.

## Acceptance criteria

- [ ] At least four models are compared with `pnpm ai:perfumer-eval`, and the table is in
  `docs/ai-perfumer.md` — steps 2, 3, 5, 6
- [ ] The chosen setup answers in under ~10 s (p50) with correct Ukrainian on the eval set — steps 3, 6
- [ ] The live site uses it through env configuration only, with a spending cap and a graceful
  "unavailable" fallback — steps 2 (fallback test), 7, 8 **(Q1, Q3)**
- [ ] The privacy policy mentions the AI provider if messages leave the shop's server — step 4

## Out of scope

- Fine-tuning a model (per the issue).
- Choosing or setting up the site's hosting itself (Q1); a GPU server for Ollama unless the
  comparison picks it.
- An in-app spending counter or monthly budget table (unless Q3 says otherwise).
- Changing the prompts, the search nudge or the guard to suit a particular model; that would be a
  separate issue informed by this comparison.
- Recording tokens or cost in analytics events (the event contract stays as is).
