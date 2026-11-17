# Plan: Measure the streamed AI perfumer reply in the eval (#172)

Issue: https://github.com/savchukolgaa/jassmin/issues/172
Branch: `issue/172`
Worktree: `.claude/worktrees/issue-172`
Status: Planned

## Goal

As the store owner, I want the AI perfumer eval to measure the streamed reply, so I know how
quickly customers see progress and whether the streamed intro is as clean as the regular one.
`pnpm ai:perfumer-eval --stream` runs the same cases through `replyStream` (#164) instead of
`reply`. For each case it reports the time to the first step, the time to the first intro sentence
and the total time, plus the sentences the guard removed. A `granite4.1:3b` run goes into
`docs/ai-perfumer.md`.

## Dependencies & prerequisites

- **#164 (streaming)**: merged (`a915b5a`). `replyStream`, `IntroGuard`, `createChatStreamClient`
  and `ChatStreamFn` exist in `app/.server/ai/`.
- **#162 (eval)**: merged. `app/.server/ai/scripts/perfumer-eval.ts` and
  `perfumer-eval.cases.ts` exist, run with `pnpm ai:perfumer-eval` (`tsx`).
- **#166 (analytics)**: merged. It added `PerfumerDeps.onToolCall`. The new `onTrace` follows the
  same pattern.
- No new packages, env vars or migrations. The recorded run needs a local Ollama with
  `granite4.1:3b`. It's installed on this machine (`curl localhost:11434/api/tags`, 2026-11-17).
- #167 (choosing the live model) is open and will reuse the new timings. It doesn't block this
  issue.

## Decisions & assumptions

- **The trace comes out through a callback, not an event.** I'll add
  `onTrace?: (trace: PerfumerTrace) => void` to `PerfumerDeps`. `replyStream` calls it once, right
  before it yields `{ type: "done" }`, after the intro guard's removals and the cleaned question are
  in the trace. `PerfumerEvent` and the browser contract don't change. `perfumer-chat.ts` only
  passes `signal` and `onToolCall` (`Pick<PerfumerDeps, "signal" | "onToolCall">`), so the route
  never sees the trace. This is the "`onTrace` dependency" option the issue suggests. It fits next
  to `onToolCall` and doesn't change the generator's return type, which the route and tests use.
  `replyWithTrace` ignores `onTrace`, because it already returns the trace.
- **The testable logic goes into its own module.** `perfumer-eval.ts` runs everything at import
  (argv, `.env`, top-level `await`), so tests can't import it. The new
  `app/.server/ai/scripts/perfumer-eval.stream.ts` gets:
  - `collectStreamedReply(events, now = performance.now)`. It reads the events, stamps the first
    `step`, the first `intro` and `done` relative to a start time it's given, and puts a
    `PerfumerReply` back together from them (`intro` = the `intro` texts joined, `picks` from the
    `picks` event, `question` if one was sent). It throws if the stream ends without `done`.
  - `percentile(values, p)` uses the nearest-rank method on the values that exist. With 15 cases,
    p95 is the slowest case.
  - The shared helpers `cyrillicShare`, `meetsExpectation`, `describeTools` and `cell` move here
    from `perfumer-eval.ts`, so both modes use them without copies. The regular path calls the same
    functions, so its output stays the same.
- **Where the clock starts:** total time is measured from just before `replyStream(...)` is called,
  the same as the regular mode (`performance.now()` before `replyWithTrace`), which includes the
  catalog load. First step and first intro are measured from the same start.
- **A case with no tool call has no first step.** Off-topic and injection cases search nothing. The
  table shows `—` for them, and they're left out of the first-step p50/p95. The summary line says
  how many cases had a step. The fallback intro still counts as the first `intro`.
- **Timings in stream mode get one decimal** (`9.4 s`), because a first step can be under a second
  on a hosted model (#167). The regular table keeps whole seconds.
- **The stream table has the issue's columns:** Model, Case, First step, First intro, Total, Tool
  calls, Picks, Invalid ids, Removed sentences, Language, Expected. I keep the Model column because
  the regular table has it and several models can run in one go.
- **Summary line per model (stream mode):** the regular counts (as expected, language, invalid ids,
  removed sentences, errors), then `first step p50 X s / p95 Y s (n/15)`,
  `first intro p50 … / p95 …` and `total p50 … / p95 …`.
- **Removed sentences** are `trace.removedSentences` from `onTrace`. That's the intro guard's
  removals plus the cleaned reasons and question, in one list like the regular mode. I won't add a
  separate "intro only" column.
- **"No invented name or invalid id reaches the reply":** picks are `ProductSummary`s loaded by
  public id, so an invalid id can't become a card. The `Invalid ids` column
  (`trace.droppedPickIds`) shows the ids that were dropped. The doc write-up checks the recorded
  intros for names outside the picks.
- **Warm-up:** the regular warm-up `chat` call already loads the model. Stream mode creates
  `chatStream = createChatStreamClient(config)` next to `chat` and passes both in. With the same
  config and server, it needs no second warm-up.
- **Without `--stream` nothing changes:** the same code path, the same table header, rows and
  summary text. Only the helpers move to another module.
- `--stream` works with `--db`, `--only` and several models. The model filter already skips `--`
  arguments, so `--stream` isn't read as a model name.

## Resolved questions

- **Report the intro guard's removals separately?** — No: one combined "Removed sentences"
  column, like the regular mode; the doc write-up names which removals came from the intro (owner
  accepted the default, 2026-11-17).
- **Who runs the recorded `granite4.1:3b` stream eval?** — `/implement` runs it in the background
  on this machine with `AI_KEEP_ALIVE=30m` and records it with the date and "owner's laptop, CPU,
  Ollama" (owner accepted the default, 2026-11-17).

- **Does the streamed reply already expose a trace?** — No. `replyStream` only gives events and
  `onToolCall`. The doc comment on `onToolCall` says "the streamed reply has no trace to return"
  (source: `app/.server/ai/perfumer.ts`). The `onTrace` dependency added here fixes that.
- **Can adding the trace leak it to the browser?** — No, as long as it's a dependency callback.
  The route and `openPerfumerStream` only pass `signal` and `onToolCall` (source:
  `app/.server/services/perfumer-chat.ts:243-283`).
- **Will the vitest and tsc globs pick up tests in `app/.server/ai/scripts/`?** — Yes. Vitest
  includes `app/**/*.test.ts` (source: `vitest.config.ts`), and tsconfig includes
  `**/.server/**/*` (source: `tsconfig.json`).
- **Which cases, catalog source and checks?** — The same ones: `EVAL_CASES`, the catalog file or
  `--db`, `meetsExpectation`, `cyrillicShare` (source: issue #172 Assumptions,
  `perfumer-eval.ts`).
- **Is a baseline for the comparison already recorded?** — Yes. The `## Results: granite4.1:3b`
  table (2026-11-16) for `reply()`, and the three single-request stream runs under `## Streaming`,
  which end with "A comparison over every case is #172" (source: `docs/ai-perfumer.md`).
- **Is a stream error an event or an exception?** — `replyStream` throws. The caller turns the
  error into an `error` event (source: the `replyStream` doc comment). The eval catches it like
  the regular mode and fills the row's `error`.
- **Part of CI?** — No, like the regular eval (source: issue #172 Assumptions).

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `app/.server/ai/perfumer.ts` | `PerfumerDeps.onTrace`, called by `replyStream` before `done` |
| modify | `app/.server/ai/perfumer.test.ts` | `onTrace` test: tool calls, intro removals, dropped ids, called once, never on error |
| create | `app/.server/ai/scripts/perfumer-eval.stream.ts` | `collectStreamedReply`, `percentile`, and the shared helpers moved out of the script |
| create | `app/.server/ai/scripts/perfumer-eval.stream.test.ts` | Timing and event-to-reply tests with a fake clock and fake `chat`/`chatStream` |
| modify | `app/.server/ai/scripts/perfumer-eval.ts` | `--stream` flag, stream runner, stream table and summary; regular path unchanged |
| modify | `docs/ai-perfumer.md` | Command under `## Eval`, new `## Results: granite4.1:3b, streamed` with comparison |

## Steps

- [x] **1. Expose the streamed trace (`onTrace`)** — In `perfumer.ts`, add
  `onTrace?: (trace: PerfumerTrace) => void` to `PerfumerDeps`, with a doc comment ("the streamed
  reply's trace, for the eval (#172); never sent to the browser"). In `replyStream`, call
  `deps.onTrace?.(run.trace)` right before `yield { type: "done" }`, after the question is cleaned.
  Update the `onToolCall` comment, which says the streamed reply has no trace. In
  `perfumer.test.ts`, under `describe("perfumer.replyStream (#164)")`, add tests with the existing
  `scripted`/`streamed` helpers. (a) `onTrace` is called once, and its trace has the tool calls,
  the intro sentence the guard removed ("Схоже на Aquarius."), the model's pick ids and the
  dropped ones. (b) It isn't called when the reply throws (e.g. `bad_response`). (c) No event
  carries a `trace` property. Check with `pnpm test app/.server/ai/perfumer.test.ts`.
- [x] **2. Move the eval's helpers into a module** — Create
  `app/.server/ai/scripts/perfumer-eval.stream.ts` and move `cyrillicShare`, `describeTools`,
  `cell` and `meetsExpectation` (with its types) out of `perfumer-eval.ts` without changing them.
  Import them back in the script. Check: `pnpm typecheck`, and
  `pnpm ai:perfumer-eval --only en-injection granite4.1:3b` prints the same table format as before
  (header, row, summary).
- [ ] **3. Collect a streamed reply with timings** — In the same module, add:
  ```ts
  export interface StreamTimings { firstStepMs?: number; firstIntroMs?: number; totalMs: number }
  export async function collectStreamedReply(
    events: AsyncIterable<PerfumerEvent>, startedAt: number, now: () => number = performance.now,
  ): Promise<{ reply: PerfumerReply; timings: StreamTimings }>
  export function percentile(values: readonly number[], p: number): number | undefined
  ```
  `collectStreamedReply` records `now() - startedAt` for the first `step`, the first `intro` and
  `done`. It joins the `intro` texts, takes `picks` and `question`, and throws if an `error` event
  arrives or the stream ends before `done`. `percentile` uses nearest rank and returns `undefined`
  for an empty list. Create `perfumer-eval.stream.test.ts`:
  - With a fake clock (a counter advanced per event), a hand-written event list gives the expected
    first step, first intro and total, and the reply is put back together (intro joined, picks,
    question).
  - No `step` events → `firstStepMs` is `undefined`.
  - The fallback intro counts as the first intro.
  - A stream without `done` throws.
  - End to end: `replyStream` with a fake `chat`/`chatStream` (scripted like `perfumer.test.ts`:
    tool round, picks JSON, streamed intro with one invented-name sentence) through
    `collectStreamedReply` gives a reply without that sentence, and `onTrace` reports it.
  - `percentile`: [] → undefined, a single value, p50/p95 of 15 values.
  - `meetsExpectation` and `cyrillicShare`: a couple of cases, now that they can be imported.
- [ ] **4. `--stream` in the eval script** — In `perfumer-eval.ts`:
  - Read `const stream = args.includes("--stream")`.
  - Update the header comment with `[--stream]` and what it measures.
  - In `runModel`, when `stream` is set, create `chatStream = createChatStreamClient(config)`.
    For each case, take `started = performance.now()` and capture the trace with
    `let trace: PerfumerTrace | undefined`. Call `collectStreamedReply(replyStream(test.locale,
    test.messages, { ...source.deps, config, chat, chatStream, onTrace: (t) => { trace = t } }),
    started)`, then build the row with the same language and expectation checks. The row gets
    `firstStep?`, `firstIntro?` (seconds) and the total in `seconds`. Errors are handled like the
    regular path.
  - The progress line on stderr adds `first step … / first intro …`.
  - Add `printStreamTable(rows)` with the stream columns and per-model summary (p50/p95 of the
    three timings, `—` when there are none, `(n/15)` for first step). `printTable` doesn't change
    and is used without `--stream`.
  - Check: `pnpm ai:perfumer-eval --stream --only en-injection granite4.1:3b` and
    `--stream --only uk-aquatic` print sensible rows, and the same commands without `--stream`
    print the regular table.
- [ ] **5. Record the `granite4.1:3b` stream run** — With Ollama running and
  `AI_KEEP_ALIVE=30m`, run `pnpm ai:perfumer-eval --stream granite4.1:3b` (in the background,
  about 30–50 min). In `docs/ai-perfumer.md`:
  - Under `## Eval`, add the `--stream` command and a paragraph on the extra columns, the clock
    start, `—` for no step, and the nearest-rank p50/p95.
  - Add `## Results: granite4.1:3b, streamed` after the regular results: date, machine, command,
    the table, the summary line, and "What this shows". That section compares against the
    2026-11-16 `reply()` table: total per case and overall, as-expected and language counts,
    removed sentences (which came from the intro), and first step and first intro against total.
  - In `## Streaming`, change "A comparison over every case is #172" to point to the new section.
- [ ] **6. Verify** — Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build`. Fix any
  findings, and commit each step on `issue/172`.

## Testing & verification

- **Unit:** `perfumer.test.ts` (`onTrace`) and `perfumer-eval.stream.test.ts` (timings, assembly,
  percentile, helpers, end to end with a fake `chat`/`chatStream`). No model or database needed.
- **Manual:** single cases with and without `--stream` (step 4), then the full stream run (step 5).
  Compare the regular output with `--stream` off before and after step 2 to confirm it hasn't
  changed.
- **Commands:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Acceptance criteria

- [ ] `pnpm ai:perfumer-eval --stream granite4.1:3b` runs every case and prints time to first step,
  time to first intro and total time per case, with p50/p95 — steps 3, 4, 5
- [ ] Removed sentences from the streamed intro are reported, and no invented name or invalid id
  reaches the reply — steps 1, 3, 4, 5
- [ ] Without `--stream` the output is unchanged — steps 2, 4
- [ ] A `granite4.1:3b` stream run is recorded in `docs/ai-perfumer.md` — step 5
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass — step 6

## Out of scope

- Changing the prompts, the intro guard or the engine based on the results (separate issues if
  needed).
- Measuring streaming in the browser, or the SSE route's overhead.
- Comparing other models (#167). The flag supports several models, but only `granite4.1:3b` is
  recorded here.
- Adding the eval to CI.
