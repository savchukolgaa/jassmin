// `pnpm ai:perfumer-eval [models…] [--db] [--only <case>] [--stream] [--texts]
//   [--price-in <usd/M> --price-out <usd/M>]`: runs the AI perfumer (#162) on the
// cases in `perfumer-eval.cases.ts` against a real model and prints a Markdown table: the tool
// arguments, picks, invented ids, sentences the guard removed (invented names), the language and
// the time per answer. Not part of the tests or CI; record results in docs/ai-perfumer.md.
//
// `--stream` (#172) runs the cases through `replyStream` (#164) instead, as the chat does, and adds
// the time to the first step, to the first intro sentence and to `done`, with their p50/p95.
//
// For comparing models (#167) every table has the tokens per answer, and the summary their mean;
// with `--price-in`/`--price-out` (the provider's USD per million tokens) also the cost of 1000
// answers. `--texts` prints each answer after the table, for judging the language by eye.
//
// The model server is `AI_BASE_URL` (default: local Ollama, http://localhost:11434/v1) with
// `AI_API_KEY`, one server per run; the models are the arguments (default: `AI_MODEL`). The catalog is the owner's list in `catalog-data.ts`
// with the shared price table, so no database is needed; `--db` reads the app database instead.
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { PERFUME_VOLUMES_ML } from "~/lib/enums";
import type { PerfumerReply } from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import { CATALOG_PRODUCTS } from "../../db/catalog-data";
import { CATALOG_PRICES } from "../../db/catalog-prices";
import type { PerfumerProductRow } from "../../db/queries/perfumer";
import { getDatabaseUrl, parseAiEnv } from "../../env";
import { createChatClient, createChatStreamClient } from "../client";
import type { PerfumerConfig } from "../config";
import { AiError } from "../errors";
import { type PerfumerDeps, type PerfumerTrace, replyStream, replyWithTrace } from "../perfumer";
import { EVAL_CASES, type EvalCase } from "./perfumer-eval.cases";
import {
  type AnswerTokens,
  cell,
  collectStreamedReply,
  cyrillicShare,
  describeTokens,
  describeTools,
  formatAnswerText,
  isLocalServer,
  meetsExpectation,
  parsePrices,
  percentile,
  summarizeTokens,
} from "./perfumer-eval.stream";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const args = process.argv.slice(2);
const useDb = args.includes("--db");
const stream = args.includes("--stream");
const texts = args.includes("--texts");
const prices = parsePrices(args);
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;
const env = parseAiEnv(process.env);
const VALUE_FLAGS = new Set(["--only", "--price-in", "--price-out"]);
const models = args.filter(
  (arg, i) => !arg.startsWith("--") && !VALUE_FLAGS.has(args[i - 1] ?? ""),
);
if (models.length === 0) {
  models.push(env.AI_MODEL);
}
const baseUrl = env.AI_BASE_URL ?? "http://localhost:11434/v1";

/** The owner's catalog as the perfumer sees it, every size in stock at the shared prices. */
function fileCatalog(): PerfumerProductRow[] {
  const sizes = PERFUME_VOLUMES_ML.flatMap((ml) => {
    const price = CATALOG_PRICES[ml];
    return price ? [{ ml, price }] : [];
  });
  return CATALOG_PRODUCTS.map((entry) => ({
    publicId: entry.publicId,
    title: entry.title,
    brand: entry.brand,
    gender: entry.gender,
    fragranceFamilies: [...entry.fragranceFamilies],
    notes: [...entry.notes],
    popularRank: entry.popularRank,
    active: true,
    sizes,
  }));
}

function fileSummary(product: PerfumerProductRow): ProductSummary {
  const variants = product.sizes.map((size) => ({
    id: `${product.publicId}-${size.ml}`,
    volumeMl: size.ml,
    price: size.price,
    inStock: true,
  }));
  const first = variants[0];
  return {
    id: product.publicId,
    slug: null,
    title: product.title,
    brand: product.brand,
    gender: product.gender,
    packSize: 1,
    image: null,
    variants,
    minPrice: first?.price ?? "0.00",
    hasPriceRange: variants.length > 1,
    volumes: variants.map((v) => v.volumeMl),
    inStock: variants.length > 0,
    defaultVariant: { id: first?.id ?? "", volumeMl: first?.volumeMl ?? 0 },
    fragranceFamily: product.fragranceFamilies[0] ?? null,
  };
}

async function catalogDeps(): Promise<{
  catalog: PerfumerProductRow[];
  deps: Pick<PerfumerDeps, "loadCatalog" | "loadSummaries">;
  close: () => Promise<void>;
}> {
  if (!useDb) {
    const catalog = fileCatalog();
    const byId = new Map(catalog.map((p) => [p.publicId, p]));
    return {
      catalog,
      deps: {
        loadCatalog: async () => catalog,
        loadSummaries: async (ids) =>
          new Map(
            ids.flatMap((id) => {
              const product = byId.get(id);
              return product ? [[id, fileSummary(product)] as const] : [];
            }),
          ),
      },
      close: async () => {},
    };
  }
  const url = getDatabaseUrl(process.env);
  if (!url) {
    throw new Error("--db needs DATABASE_URL (or JASSMINDB_URI).");
  }
  const [{ createDb }, { listPerfumerProducts }, { getProductSummaries }] = await Promise.all([
    import("../../db/client"),
    import("../../db/queries/perfumer"),
    import("../../services/products"),
  ]);
  const db = createDb(url);
  const catalog = await listPerfumerProducts(db);
  return {
    catalog,
    deps: {
      loadCatalog: async () => catalog,
      loadSummaries: (ids) => getProductSummaries(ids, db),
    },
    close: () => db.$client.end(),
  };
}

interface Row {
  model: string;
  id: string;
  seconds: number;
  tools: string;
  picks: string;
  invalidIds: number;
  removed: string[];
  language: boolean;
  expected: boolean;
  error?: string;
  /** `--stream` only: seconds to the first step (none when no tool ran) and the first intro. */
  firstStep?: number;
  firstIntro?: number;
  /** None when the answer failed. */
  tokens?: AnswerTokens;
  reply?: PerfumerReply;
}

interface Answer {
  reply: PerfumerReply;
  trace: PerfumerTrace;
  firstStep?: number;
  firstIntro?: number;
}

/** The streamed reply as the chat gets it, with its trace (`onTrace`) and timings. */
async function streamedAnswer(
  test: EvalCase,
  deps: PerfumerDeps,
  started: number,
): Promise<Answer> {
  let trace: PerfumerTrace | undefined;
  const { reply, timings } = await collectStreamedReply(
    replyStream(test.locale, test.messages, {
      ...deps,
      onTrace: (t) => {
        trace = t;
      },
    }),
    started,
  );
  if (!trace) {
    throw new Error("replyStream finished without a trace");
  }
  return {
    reply,
    trace,
    ...(timings.firstStepMs === undefined ? {} : { firstStep: timings.firstStepMs / 1000 }),
    ...(timings.firstIntroMs === undefined ? {} : { firstIntro: timings.firstIntroMs / 1000 }),
  };
}

/** Seconds with one decimal, or `—`. */
const seconds = (value: number | undefined) =>
  value === undefined ? "—" : `${value.toFixed(1)} s`;

async function runModel(
  model: string,
  source: Awaited<ReturnType<typeof catalogDeps>>,
): Promise<Row[]> {
  const config: PerfumerConfig = {
    baseUrl,
    model,
    apiKey: env.AI_API_KEY,
    timeoutMs: env.AI_TIMEOUT_MS * 3,
    // Ollama's `keep_alive`; a hosted API may refuse the unknown parameter (#167).
    keepAlive: env.AI_KEEP_ALIVE ?? (isLocalServer(baseUrl) ? "30m" : undefined),
  };
  const chat = createChatClient(config);
  const chatStream = createChatStreamClient(config);
  // Load the model first so the first case isn't charged for it.
  await chat(
    { messages: [{ role: "user", content: "ok" }] },
    AbortSignal.timeout(config.timeoutMs),
  ).catch(() => undefined);

  const rows: Row[] = [];
  for (const test of EVAL_CASES.filter((c) => !only || c.id === only)) {
    const started = performance.now();
    try {
      const deps: PerfumerDeps = { ...source.deps, config, chat, chatStream };
      const answer: Answer = stream
        ? await streamedAnswer(test, deps, started)
        : await replyWithTrace(test.locale, test.messages, deps);
      const { reply, trace, firstStep, firstIntro } = answer;
      const text = [reply.intro, ...reply.picks.map((p) => p.reason), reply.question ?? ""].join(
        " ",
      );
      const share = cyrillicShare(text);
      rows.push({
        model,
        id: test.id,
        seconds: (performance.now() - started) / 1000,
        tools: describeTools(trace),
        picks: reply.picks.map((p) => p.product.title).join(", ") || "—",
        invalidIds: trace.droppedPickIds.length,
        removed: trace.removedSentences,
        language: test.locale === "uk" ? share >= 0.6 : share <= 0.1,
        expected: meetsExpectation(test, reply.picks, source.catalog),
        tokens: trace.tokens,
        reply,
        ...(firstStep === undefined ? {} : { firstStep }),
        ...(firstIntro === undefined ? {} : { firstIntro }),
      });
    } catch (error) {
      rows.push({
        model,
        id: test.id,
        seconds: (performance.now() - started) / 1000,
        tools: "—",
        picks: "—",
        invalidIds: 0,
        removed: [],
        language: false,
        expected: false,
        error: error instanceof AiError ? `${error.kind}: ${error.message}` : String(error),
      });
    }
    const last = rows.at(-1);
    const timings = stream
      ? `first step ${seconds(last?.firstStep)}, first intro ${seconds(last?.firstIntro)}, `
      : "";
    console.error(
      `${model} ${test.id}: ${last?.error ?? last?.picks} (${timings}${last?.seconds.toFixed(0)} s)`,
    );
  }
  return rows;
}

/** Tokens in / out of one answer, `—` when it failed or the server reported none. */
function tokensCell(tokens: AnswerTokens | undefined): string {
  if (!tokens || (tokens.input === 0 && tokens.output === 0)) return "—";
  return `${tokens.input} / ${tokens.output}${tokens.unreported > 0 ? "+" : ""}`;
}

/** The model's tokens per answer and, with prices, the cost of 1000 answers (#167). */
function tokenSentence(mine: readonly Row[]): string {
  const answers = mine.flatMap((r) => (r.tokens ? [r.tokens] : []));
  return describeTokens(summarizeTokens(answers, prices));
}

function printTable(rows: readonly Row[]): void {
  console.log(
    "| Model | Case | Time | Tool calls | Picks | Invalid ids | Removed sentences | Language | Expected | Tokens in / out |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  for (const row of rows) {
    console.log(
      `| ${row.model} | ${row.id} | ${row.seconds.toFixed(0)} s | ${cell(row.error ?? row.tools)} | ${cell(row.picks)} | ${row.invalidIds} | ${cell(row.removed.join(" / ") || "—")} | ${row.language ? "✓" : "✗"} | ${row.expected ? "✓" : "✗"} | ${tokensCell(row.tokens)} |`,
    );
  }
  for (const model of new Set(rows.map((r) => r.model))) {
    const mine = rows.filter((r) => r.model === model);
    const times = mine.map((r) => r.seconds);
    console.log(
      `\n**${model}**: ${mine.filter((r) => r.expected).length}/${mine.length} as expected, language ${mine.filter((r) => r.language).length}/${mine.length}, invalid ids ${mine.reduce((n, r) => n + r.invalidIds, 0)}, removed sentences ${mine.reduce((n, r) => n + r.removed.length, 0)}, errors ${mine.filter((r) => r.error).length}, ${Math.min(...times).toFixed(0)}–${Math.max(...times).toFixed(0)} s per answer (p50 ${seconds(percentile(times, 50))} / p95 ${seconds(percentile(times, 95))}); ${tokenSentence(mine)}.`,
    );
  }
}

/** `--stream`: the timings first, with p50/p95 per model. */
function printStreamTable(rows: readonly Row[]): void {
  console.log(
    "| Model | Case | First step | First intro | Total | Tool calls | Picks | Invalid ids | Removed sentences | Language | Expected | Tokens in / out |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const row of rows) {
    console.log(
      `| ${row.model} | ${row.id} | ${seconds(row.firstStep)} | ${seconds(row.firstIntro)} | ${seconds(row.seconds)} | ${cell(row.error ?? row.tools)} | ${cell(row.picks)} | ${row.invalidIds} | ${cell(row.removed.join(" / ") || "—")} | ${row.language ? "✓" : "✗"} | ${row.expected ? "✓" : "✗"} | ${tokensCell(row.tokens)} |`,
    );
  }
  const spread = (values: number[]) =>
    `p50 ${seconds(percentile(values, 50))} / p95 ${seconds(percentile(values, 95))}`;
  for (const model of new Set(rows.map((r) => r.model))) {
    const mine = rows.filter((r) => r.model === model);
    const steps = mine.flatMap((r) => (r.firstStep === undefined ? [] : [r.firstStep]));
    const intros = mine.flatMap((r) => (r.firstIntro === undefined ? [] : [r.firstIntro]));
    console.log(
      `
**${model}** (streamed): ${mine.filter((r) => r.expected).length}/${mine.length} as expected, language ${mine.filter((r) => r.language).length}/${mine.length}, invalid ids ${mine.reduce((n, r) => n + r.invalidIds, 0)}, removed sentences ${mine.reduce((n, r) => n + r.removed.length, 0)}, errors ${mine.filter((r) => r.error).length}; first step ${spread(steps)} (${steps.length}/${mine.length} cases searched), first intro ${spread(intros)}, total ${spread(mine.map((r) => r.seconds))}; ${tokenSentence(mine)}.`,
    );
  }
}

const source = await catalogDeps();
try {
  console.error(
    `${source.catalog.length} perfumes from ${useDb ? "the database" : "catalog-data.ts"}; ${baseUrl}${stream ? "; streamed" : ""}`,
  );
  const rows: Row[] = [];
  for (const model of models) {
    rows.push(...(await runModel(model, source)));
  }
  if (stream) {
    printStreamTable(rows);
  } else {
    printTable(rows);
  }
  if (texts) {
    console.log("\n### Answers\n");
    for (const row of rows) {
      if (row.reply) console.log(`${formatAnswerText(row.model, row.id, row.reply)}\n`);
    }
  }
} finally {
  await source.close();
}
