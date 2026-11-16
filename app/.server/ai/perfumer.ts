import { fragranceFamilyLabel } from "~/lib/catalog";
import { createTranslator, type Locale } from "~/lib/i18n";
import type { PerfumerMessage, PerfumerPick, PerfumerReply } from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import type { PerfumerProductRow } from "../db/queries/perfumer";
import {
  cleanProse,
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
import { type ChatFn, type ChatMessage, createChatClient } from "./client";
import { getPerfumerConfig, type PerfumerConfig } from "./config";
import { AiError, PerfumerDisabledError } from "./errors";
import {
  MODEL_ANSWER_JSON_SCHEMA,
  type ModelAnswer,
  modelAnswerSchema,
  perfumerMessagesSchema,
} from "./perfumer.schema";
import { finalInstructions, searchFirst, systemPrompt } from "./prompts";
import { foldLatin } from "./synonyms";

// The AI perfumer engine (#162): the customer's words → at most 3 rounds of read-only catalog
// tool calls → one structured answer, whose picks must be products the tools returned and whose
// text loses every sentence naming a perfume outside them. Stateless: the caller passes the
// conversation, and nothing is stored.

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

export interface PerfumerDeps {
  /** `getPerfumerConfig()` by default; `null` means disabled. */
  config?: PerfumerConfig | null;
  chat?: ChatFn;
  loadCatalog?: () => Promise<PerfumerProductRow[]>;
  loadSummaries?: (publicIds: readonly string[]) => Promise<Map<string, ProductSummary>>;
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

/** The model's JSON answer, tolerating a Markdown code fence around it. */
function parseAnswer(content: string | null): ModelAnswer | undefined {
  if (!content) {
    return undefined;
  }
  const json = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = modelAnswerSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Like `reply`, with a trace of the tool calls and of what the guard removed. */
export async function replyWithTrace(
  locale: Locale,
  messages: readonly PerfumerMessage[],
  deps: PerfumerDeps = {},
): Promise<PerfumerResult> {
  const conversation = perfumerMessagesSchema.parse(messages);
  const config = deps.config === undefined ? getPerfumerConfig() : deps.config;
  if (!config) {
    throw new PerfumerDisabledError();
  }
  const chat = deps.chat ?? createChatClient(config);
  const signal = AbortSignal.timeout(config.timeoutMs);
  const catalog = await (deps.loadCatalog ?? defaultCatalog)();

  const aliases = new AliasMap();
  const trace: PerfumerTrace = {
    toolCalls: [],
    rounds: 0,
    modelPickIds: [],
    droppedPickIds: [],
    removedSentences: [],
    searchNudged: false,
  };
  const history: ChatMessage[] = [
    { role: "system", content: systemPrompt(locale) },
    ...conversation,
  ];

  /** Runs one tool round; `false` when the model called no tool. */
  const toolRound = async (): Promise<boolean> => {
    const result = await chat(
      { messages: history, tools: CATALOG_TOOL_DEFINITIONS, maxTokens: TOOL_ROUND_MAX_TOKENS },
      signal,
    );
    if (result.toolCalls.length === 0) {
      return false;
    }
    trace.rounds += 1;
    history.push({ role: "assistant", content: result.content, toolCalls: result.toolCalls });
    for (const [index, call] of result.toolCalls.entries()) {
      if (index >= MAX_CALLS_PER_ROUND) {
        history.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify({ error: "Too many tool calls at once." }),
        });
        continue;
      }
      const run = runCatalogTool(catalog, call.name, call.arguments, aliases);
      trace.toolCalls.push(run.record);
      history.push({ role: "tool", toolCallId: call.id, content: run.content });
    }
    return true;
  };

  /** The final, structured answer: no tools, JSON only. One retry when it isn't valid. */
  const finalAnswer = async (): Promise<ModelAnswer> => {
    const messages: ChatMessage[] = [
      ...history,
      { role: "system", content: finalInstructions(locale) },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await chat(
        {
          messages,
          responseFormat: { name: "perfumer_answer", schema: MODEL_ANSWER_JSON_SCHEMA },
          maxTokens: FINAL_MAX_TOKENS,
        },
        signal,
      );
      const answer = parseAnswer(result.content);
      if (answer) {
        return answer;
      }
    }
    throw new AiError("bad_response", "The model's answer isn't the expected JSON");
  };

  for (let round = 0; round < MAX_TOOL_ROUNDS && (await toolRound()); round++) {}
  let answer = await finalAnswer();

  // Picks without a search: the model skipped the tools (seen in the eval with granite4.1:3b), so
  // its ids are invented. Tell it to search and give it one more round. An off-topic answer has
  // no picks and never gets here.
  if (trace.toolCalls.length === 0 && answer.picks.length > 0) {
    trace.searchNudged = true;
    history.push({ role: "system", content: searchFirst(locale) });
    if (await toolRound()) {
      answer = await finalAnswer();
    }
  }

  const reply = await validate(locale, answer, {
    catalog,
    aliases,
    trace,
    deps,
    customerText: conversation.filter((m) => m.role === "user").map((m) => m.content),
  });
  return { reply, trace };
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

async function validate(
  locale: Locale,
  answer: ModelAnswer,
  {
    catalog,
    aliases,
    trace,
    deps,
    customerText,
  }: {
    catalog: readonly PerfumerProductRow[];
    aliases: AliasMap;
    trace: PerfumerTrace;
    deps: PerfumerDeps;
    /** What the customer wrote: catalog perfumes they named may be named back. */
    customerText: readonly string[];
  },
): Promise<PerfumerReply> {
  const translator = createTranslator(locale);
  trace.modelPickIds = answer.picks.map((pick) => pick.id);

  // A pick can only be a product a tool returned in this reply; without a tool call (an
  // off-topic message, an injection) there are none.
  const toolRan = trace.toolCalls.some((call) => call.ok);
  const modelPicks: ModelPick[] = toolRan ? answer.picks : [];
  const selected = selectPicks(modelPicks, aliases);
  const summaries = selected.length
    ? await (deps.loadSummaries ?? defaultSummaries)(selected.map((pick) => pick.publicId))
    : new Map<string, ProductSummary>();

  const kept = selected.flatMap((pick) => {
    const product = summaries.get(pick.publicId);
    return product?.inStock ? [{ product, reason: pick.reason }] : [];
  });
  const keptIds = new Set(kept.map((pick) => pick.product.id));
  trace.droppedPickIds = answer.picks
    .map((pick) => pick.id)
    .filter((id) => {
      const publicId = aliases.publicIdFor(id);
      return !toolRan || !publicId || !keptIds.has(publicId);
    });

  const catalogNames = catalog.flatMap((product) => [product.title, product.brand]);
  const context = {
    locale,
    allowedNames: [
      ...kept.flatMap((pick) => [pick.product.title, pick.product.brand]),
      ...namesIn(customerText, catalogNames),
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

  const intro =
    clean(answer.intro, MAX_INTRO) ||
    translator.t(picks.length ? "perfumer.fallbackIntro" : "perfumer.fallbackIntroEmpty");
  const question = answer.question ? clean(answer.question, MAX_QUESTION) : "";

  return { intro, picks, ...(question ? { question } : {}) };
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
