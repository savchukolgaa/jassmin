import { fragranceFamilyLabel } from "~/lib/catalog";
import { createTranslator, type Locale } from "~/lib/i18n";
import type { PerfumerEvent, PerfumerMessage, PerfumerPick, PerfumerReply } from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import type { PerfumerProductRow } from "../db/queries/perfumer";
import {
  cleanProse,
  type GuardContext,
  IntroGuard,
  limitLength,
  MAX_INTRO,
  MAX_QUESTION,
  MAX_REASON,
  type ModelPick,
  selectPicks,
} from "./answer-guard";
import {
  AliasMap,
  CATALOG_TOOL_DEFINITIONS,
  runCatalogTool,
  type ToolCallRecord,
} from "./catalog-tools";
import {
  type ChatFn,
  type ChatMessage,
  type ChatStreamFn,
  createChatClient,
  createChatStreamClient,
  type JsonSchema,
  type TokenUsage,
} from "./client";
import { getPerfumerConfig, type PerfumerConfig } from "./config";
import { AiError, PerfumerDisabledError } from "./errors";
import {
  MODEL_ANSWER_JSON_SCHEMA,
  MODEL_PICKS_JSON_SCHEMA,
  type ModelAnswer,
  type ModelPicks,
  modelAnswerSchema,
  modelPicksSchema,
  perfumerMessagesSchema,
} from "./perfumer.schema";
import {
  finalInstructions,
  finalPicksInstructions,
  introInstructions,
  searchFirst,
  systemPrompt,
} from "./prompts";
import { foldLatin } from "./synonyms";

// The AI perfumer engine (#162): the customer's words → at most 3 rounds of read-only catalog
// tool calls → one structured answer, whose picks must be products the tools returned and whose
// text loses every sentence naming a perfume outside them. Stateless: the caller passes the
// conversation, and nothing is stored. `replyStream` (#164) gives the same reply as events, with
// the intro written after the picks are fixed so it can stream through the guard.

/** Rounds in which the model may call tools before it must answer. */
export const MAX_TOOL_ROUNDS = 3;

/** Tool calls run per round; further ones are answered with an error. */
const MAX_CALLS_PER_ROUND = 4;

/**
 * Tokens a tool round may generate: enough for tool calls. When the model answers in prose
 * instead, that text is discarded for the structured answer, so it's cut short (on a CPU every
 * token costs time).
 */
const TOOL_ROUND_MAX_TOKENS = 256;

/** Tokens the final JSON answer may take: an intro, four reasons and a question. */
const FINAL_MAX_TOKENS = 800;

/** Tokens the streamed intro may take: 1–3 sentences, at most `MAX_INTRO` characters. */
const INTRO_MAX_TOKENS = 240;

export interface PerfumerDeps {
  /** `getPerfumerConfig()` by default; `null` means disabled. */
  config?: PerfumerConfig | null;
  chat?: ChatFn;
  /** The streamed calls of `replyStream` (#164); `createChatStreamClient(config)` by default. */
  chatStream?: ChatStreamFn;
  loadCatalog?: () => Promise<PerfumerProductRow[]>;
  loadSummaries?: (publicIds: readonly string[]) => Promise<Map<string, ProductSummary>>;
  /**
   * Cancels the reply early, e.g. the chat request's `request.signal` when the customer leaves or
   * cancels (#163). `AI_TIMEOUT_MS` still bounds it; a cancelled reply throws a `timeout` `AiError`.
   */
  signal?: AbortSignal;
  /**
   * Called with each catalog tool call as it runs, for analytics (#166), in `reply` and
   * `replyStream` alike.
   */
  onToolCall?: (record: ToolCallRecord) => void;
  /**
   * `replyStream` only: called once with the finished reply's trace, just before `done`, for the
   * eval (#172). Never part of the events, so it doesn't reach the browser. `replyWithTrace`
   * returns its trace instead.
   */
  onTrace?: (trace: PerfumerTrace) => void;
}

/** What happened during one reply, for the eval script (#162) and logs. */
export interface PerfumerTrace {
  toolCalls: ToolCallRecord[];
  /** Tool rounds the model used (0–3). */
  rounds: number;
  /** The ids the model picked, valid or not. */
  modelPickIds: string[];
  /** Picked ids the tools never returned, or products no longer for sale. */
  droppedPickIds: string[];
  /** Sentences the guard removed. */
  removedSentences: string[];
  /** Whether the model picked perfumes without searching and was told to search. */
  searchNudged: boolean;
  /**
   * The tokens every model call of the reply used, for the eval's cost estimate (#167). `unreported`
   * counts the calls the server gave no usage for (or a streamed intro stopped early), so `input`
   * and `output` are then a lower bound.
   */
  tokens: TokenUsage & { unreported: number };
}

function addUsage(trace: PerfumerTrace, usage: TokenUsage | undefined): void {
  if (usage) {
    trace.tokens.input += usage.input;
    trace.tokens.output += usage.output;
  } else {
    trace.tokens.unreported += 1;
  }
}

export interface PerfumerResult {
  reply: PerfumerReply;
  trace: PerfumerTrace;
}

async function defaultCatalog(): Promise<PerfumerProductRow[]> {
  const [{ db }, { listPerfumerProducts }] = await Promise.all([
    import("../db"),
    import("../db/queries/perfumer"),
  ]);
  return listPerfumerProducts(db);
}

async function defaultSummaries(publicIds: readonly string[]) {
  const { getProductSummaries } = await import("../services/products");
  return getProductSummaries(publicIds);
}

/** A zod schema's `safeParse`, as far as `parseJsonAnswer` needs it. */
interface AnswerSchema<T> {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false };
}

/** The model's JSON answer, tolerating a Markdown code fence around it. */
function parseJsonAnswer<T>(content: string | null, schema: AnswerSchema<T>): T | undefined {
  if (!content) {
    return undefined;
  }
  const json = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** One reply in progress: the conversation so far, the aliases handed out and the trace. */
interface ReplyRun {
  locale: Locale;
  config: PerfumerConfig;
  chat: ChatFn;
  signal: AbortSignal;
  catalog: PerfumerProductRow[];
  aliases: AliasMap;
  trace: PerfumerTrace;
  history: ChatMessage[];
  /** What the customer wrote: catalog perfumes they named may be named back. */
  customerText: string[];
  deps: PerfumerDeps;
}

/** Validates the input and loads the catalog. `extraSignal` also cancels the reply. */
async function startReply(
  locale: Locale,
  messages: readonly PerfumerMessage[],
  deps: PerfumerDeps,
  extraSignal?: AbortSignal,
): Promise<ReplyRun> {
  const conversation = perfumerMessagesSchema.parse(messages);
  const config = deps.config === undefined ? getPerfumerConfig() : deps.config;
  if (!config) {
    throw new PerfumerDisabledError();
  }
  const signals = [AbortSignal.timeout(config.timeoutMs), deps.signal, extraSignal].filter(
    (signal) => signal !== undefined,
  );
  const trace: PerfumerTrace = {
    toolCalls: [],
    rounds: 0,
    modelPickIds: [],
    droppedPickIds: [],
    removedSentences: [],
    searchNudged: false,
    tokens: { input: 0, output: 0, unreported: 0 },
  };
  const chat = deps.chat ?? createChatClient(config);
  return {
    locale,
    config,
    // Every call's tokens go into the trace.
    chat: async (request, signal) => {
      const result = await chat(request, signal);
      addUsage(trace, result.usage);
      return result;
    },
    signal: AbortSignal.any(signals),
    catalog: await (deps.loadCatalog ?? defaultCatalog)(),
    aliases: new AliasMap(),
    trace,
    history: [{ role: "system", content: systemPrompt(locale) }, ...conversation],
    customerText: conversation.filter((m) => m.role === "user").map((m) => m.content),
    deps,
  };
}

/** Runs one tool round: the calls it ran, or `null` when the model called no tool. */
async function toolRound(run: ReplyRun): Promise<ToolCallRecord[] | null> {
  const result = await run.chat(
    { messages: run.history, tools: CATALOG_TOOL_DEFINITIONS, maxTokens: TOOL_ROUND_MAX_TOKENS },
    run.signal,
  );
  if (result.toolCalls.length === 0) {
    return null;
  }
  run.trace.rounds += 1;
  run.history.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
  const records: ToolCallRecord[] = [];
  for (const [index, call] of result.toolCalls.entries()) {
    if (index >= MAX_CALLS_PER_ROUND) {
      run.history.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify({ error: "Too many tool calls at once." }),
      });
      continue;
    }
    const tool = runCatalogTool(run.catalog, call.name, call.arguments, run.aliases);
    run.trace.toolCalls.push(tool.record);
    run.deps.onToolCall?.(tool.record);
    records.push(tool.record);
    run.history.push({ role: "tool", toolCallId: call.id, content: tool.content });
  }
  return records;
}

/** A final, structured answer: no tools, JSON only. One retry when it isn't valid. */
async function structuredAnswer<T>(
  run: ReplyRun,
  instructions: string,
  format: { name: string; schema: JsonSchema },
  schema: AnswerSchema<T>,
): Promise<T> {
  const messages: ChatMessage[] = [...run.history, { role: "system", content: instructions }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await run.chat(
      { messages, responseFormat: format, maxTokens: FINAL_MAX_TOKENS },
      run.signal,
    );
    const answer = parseJsonAnswer(result.content, schema);
    if (answer) {
      return answer;
    }
  }
  throw new AiError("bad_response", "The model's answer isn't the expected JSON");
}

/** Like `reply`, with a trace of the tool calls and of what the guard removed. */
export async function replyWithTrace(
  locale: Locale,
  messages: readonly PerfumerMessage[],
  deps: PerfumerDeps = {},
): Promise<PerfumerResult> {
  const run = await startReply(locale, messages, deps);
  const finalAnswer = () =>
    structuredAnswer<ModelAnswer>(
      run,
      finalInstructions(locale),
      { name: "perfumer_answer", schema: MODEL_ANSWER_JSON_SCHEMA },
      modelAnswerSchema,
    );

  for (let round = 0; round < MAX_TOOL_ROUNDS && (await toolRound(run)); round++) {}
  let answer = await finalAnswer();

  // Picks without a search: the model skipped the tools (seen in the eval with granite4.1:3b), so
  // its ids are invented. Tell it to search and give it one more round. An off-topic answer has
  // no picks and never gets here.
  if (run.trace.toolCalls.length === 0 && answer.picks.length > 0) {
    run.trace.searchNudged = true;
    run.history.push({ role: "system", content: searchFirst(locale) });
    if (await toolRound(run)) {
      answer = await finalAnswer();
    }
  }

  const { picks, clean } = await validatePicks(run, answer.picks);
  const translator = createTranslator(locale);
  const intro =
    clean(answer.intro, MAX_INTRO) ||
    translator.t(picks.length ? "perfumer.fallbackIntro" : "perfumer.fallbackIntroEmpty");
  const question = answer.question ? clean(answer.question, MAX_QUESTION) : "";

  return { reply: { intro, picks, ...(question ? { question } : {}) }, trace: run.trace };
}

/**
 * The catalog titles and brands the customer wrote ("схоже на La Vie Est Belle"): real products,
 * so the reply may name them back. Names outside the catalog are never allowed.
 */
function namesIn(customerText: readonly string[], catalogNames: readonly string[]): string[] {
  const folded = ` ${customerText.map(foldLatin).join(" ")} `;
  return catalogNames.filter((name) => {
    const own = foldLatin(name);
    return own.length >= 3 && folded.includes(` ${own} `);
  });
}

interface ValidatedPicks {
  /** Active, in-stock products the tools returned, with cleaned reasons. */
  picks: PerfumerPick[];
  /** The aliases of `picks`, in order, for the streamed intro's prompt. */
  aliases: string[];
  /** The guard's context: the picks' names and those the customer wrote are allowed. */
  context: GuardContext;
  /** Cleans a text with `context`, noting removed sentences in the trace. */
  clean: (text: string, max: number) => string;
}

async function validatePicks(
  run: ReplyRun,
  modelPicks: readonly ModelPick[],
): Promise<ValidatedPicks> {
  const { locale, catalog, aliases, trace, deps } = run;
  const translator = createTranslator(locale);
  trace.modelPickIds = modelPicks.map((pick) => pick.id);

  // A pick can only be a product a tool returned in this reply; without a tool call (an
  // off-topic message, an injection) there are none.
  const toolRan = trace.toolCalls.some((call) => call.ok);
  const selected = selectPicks(toolRan ? modelPicks : [], aliases);
  const summaries = selected.length
    ? await (deps.loadSummaries ?? defaultSummaries)(selected.map((pick) => pick.publicId))
    : new Map<string, ProductSummary>();

  const kept = selected.flatMap((pick) => {
    const product = summaries.get(pick.publicId);
    return product?.inStock ? [{ product, reason: pick.reason }] : [];
  });
  const keptIds = new Set(kept.map((pick) => pick.product.id));
  trace.droppedPickIds = modelPicks
    .map((pick) => pick.id)
    .filter((id) => {
      const publicId = aliases.publicIdFor(id);
      return !toolRan || !publicId || !keptIds.has(publicId);
    });

  const catalogNames = catalog.flatMap((product) => [product.title, product.brand]);
  const context: GuardContext = {
    locale,
    allowedNames: [
      ...kept.flatMap((pick) => [pick.product.title, pick.product.brand]),
      ...namesIn(run.customerText, catalogNames),
    ],
    catalogNames,
  };
  const clean = (text: string, max: number): string => {
    const result = cleanProse(limitLength(text, max), context);
    trace.removedSentences.push(...result.removed);
    return result.text;
  };

  const families = new Map(catalog.map((product) => [product.publicId, product.fragranceFamilies]));
  const picks: PerfumerPick[] = kept.map(({ product, reason }) => {
    const cleaned = clean(reason, MAX_REASON);
    if (cleaned) {
      return { product, reason: cleaned };
    }
    const labels = (families.get(product.id) ?? []).map((f) => fragranceFamilyLabel(f, translator));
    return {
      product,
      reason: labels.length
        ? translator.t("perfumer.fallbackReason", { families: labels.join(", ") })
        : translator.t("perfumer.fallbackReasonPlain"),
    };
  });

  return {
    picks,
    aliases: picks.map((pick) => aliases.aliasFor(pick.product.id)),
    context,
    clean,
  };
}

/**
 * The perfumer's reply to a conversation (1–10 messages, the last from the customer): an intro,
 * 0–4 picks of active, in-stock catalog products with reasons, and an optional question. Throws
 * `PerfumerDisabledError` when `AI_BASE_URL` is unset (no model is called) and `AiError` when the
 * model is unavailable, too slow or answers nonsense.
 */
export async function reply(
  locale: Locale,
  messages: readonly PerfumerMessage[],
  deps: PerfumerDeps = {},
): Promise<PerfumerReply> {
  return (await replyWithTrace(locale, messages, deps)).reply;
}

/**
 * The same reply as `reply`, as events while it's produced (#164): a `step` per catalog tool call
 * as soon as it ran, the intro sentence by sentence (`intro`), then `picks`, the `question` if any
 * and `done`. The picks are fixed first (one JSON call, validated as in `reply`); the intro is
 * then streamed by a separate call that knows them, and each sentence passes the guard before it's
 * yielded. Leaving the iteration early (the customer left) or `deps.signal` stops the model call.
 * Throws like `reply`; the caller turns errors into an `error` event.
 */
export async function* replyStream(
  locale: Locale,
  messages: readonly PerfumerMessage[],
  deps: PerfumerDeps = {},
): AsyncGenerator<PerfumerEvent, void, undefined> {
  const stop = new AbortController();
  try {
    const run = await startReply(locale, messages, deps, stop.signal);
    const steps = (records: readonly ToolCallRecord[]): PerfumerEvent[] =>
      records.flatMap((record) => (record.step ? [{ type: "step", step: record.step }] : []));
    const finalPicks = () =>
      structuredAnswer<ModelPicks>(
        run,
        finalPicksInstructions(locale),
        { name: "perfumer_picks", schema: MODEL_PICKS_JSON_SCHEMA },
        modelPicksSchema,
      );

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const records = await toolRound(run);
      if (!records) break;
      yield* steps(records);
    }
    let answer = await finalPicks();

    // The same nudge as in `replyWithTrace`: picks without a search are invented ids.
    if (run.trace.toolCalls.length === 0 && answer.picks.length > 0) {
      run.trace.searchNudged = true;
      run.history.push({ role: "system", content: searchFirst(locale) });
      const records = await toolRound(run);
      if (records) {
        yield* steps(records);
        answer = await finalPicks();
      }
    }

    const validated = await validatePicks(run, answer.picks);

    // The intro, streamed through the guard: each sentence is yielded once it's complete and
    // clean. The call stops when the intro is long enough.
    const guard = new IntroGuard(validated.context, MAX_INTRO);
    const chatStream = deps.chatStream ?? createChatStreamClient(run.config);
    let introUsage: TokenUsage | undefined;
    const intro = chatStream(
      {
        messages: [
          ...run.history,
          { role: "system", content: introInstructions(locale, validated.aliases) },
        ],
        maxTokens: INTRO_MAX_TOKENS,
        onUsage: (usage) => {
          introUsage = usage;
        },
      },
      run.signal,
    );
    for await (const piece of intro) {
      const text = guard.push(piece);
      if (text) yield { type: "intro", text };
      if (guard.full) break;
    }
    addUsage(run.trace, introUsage);
    const rest = guard.end();
    if (rest) yield { type: "intro", text: rest };
    run.trace.removedSentences.push(...guard.removed);
    if (guard.empty) {
      const { t } = createTranslator(locale);
      yield {
        type: "intro",
        text: t(validated.picks.length ? "perfumer.fallbackIntro" : "perfumer.fallbackIntroEmpty"),
      };
    }

    yield { type: "picks", picks: validated.picks };
    const question = answer.question ? validated.clean(answer.question, MAX_QUESTION) : "";
    if (question) yield { type: "question", text: question };
    deps.onTrace?.(run.trace);
    yield { type: "done" };
  } finally {
    // Finished, failed or abandoned by the caller: no model call may outlive the reply.
    stop.abort();
  }
}
