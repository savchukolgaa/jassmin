// `pnpm ai:perfumer-eval [models…] [--db] [--only <case>]`: runs the AI perfumer (#162) on the
// cases in `perfumer-eval.cases.ts` against a real model and prints a Markdown table: the tool
// arguments, picks, invented ids, sentences the guard removed (invented names), the language and
// the time per answer. Not part of the tests or CI; record results in docs/ai-perfumer.md.
//
// The model server is `AI_BASE_URL` (default: local Ollama, http://localhost:11434/v1); the models
// are the arguments (default: `AI_MODEL`). The catalog is the owner's list in `catalog-data.ts`
// with the shared price table, so no database is needed; `--db` reads the app database instead.
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { PERFUME_VOLUMES_ML } from "~/lib/enums";
import type { ProductSummary } from "~/lib/products";
import { CATALOG_PRODUCTS } from "../../db/catalog-data";
import { CATALOG_PRICES } from "../../db/catalog-prices";
import type { PerfumerProductRow } from "../../db/queries/perfumer";
import { getDatabaseUrl, parseAiEnv } from "../../env";
import { createChatClient } from "../client";
import type { PerfumerConfig } from "../config";
import { AiError } from "../errors";
import { type PerfumerDeps, type PerfumerTrace, replyWithTrace } from "../perfumer";
import { EVAL_CASES, type EvalCase } from "./perfumer-eval.cases";

if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const args = process.argv.slice(2);
const useDb = args.includes("--db");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;
const env = parseAiEnv(process.env);
const models = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--only");
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

/** The share of letters that are Cyrillic. */
function cyrillicShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu) ?? [];
  return letters.length ? cyrillic.length / letters.length : 0;
}

function describeTools(trace: PerfumerTrace): string {
  return (
    trace.toolCalls
      .map((call) => `${call.ok ? "" : "✗"}${call.name}(${JSON.stringify(call.arguments)})`)
      .join("; ") || "—"
  );
}

const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");

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
}

function meetsExpectation(
  test: EvalCase,
  picks: { product: ProductSummary }[],
  catalog: readonly PerfumerProductRow[],
): boolean {
  if (test.picks === "some" && picks.length === 0) return false;
  if (test.picks === "none" && picks.length > 0) return false;
  const families = new Map(catalog.map((p) => [p.publicId, p.fragranceFamilies]));
  return picks.every(({ product }) => {
    const own = families.get(product.id) ?? [];
    const familyOk = !test.families || own.some((f) => (test.families as string[]).includes(f));
    const priceOk = test.maxPrice === undefined || Number(product.minPrice) <= test.maxPrice;
    return familyOk && priceOk;
  });
}

async function runModel(
  model: string,
  source: Awaited<ReturnType<typeof catalogDeps>>,
): Promise<Row[]> {
  const config: PerfumerConfig = {
    baseUrl,
    model,
    apiKey: env.AI_API_KEY,
    timeoutMs: env.AI_TIMEOUT_MS * 3,
    keepAlive: env.AI_KEEP_ALIVE ?? "30m",
  };
  const chat = createChatClient(config);
  // Load the model first so the first case isn't charged for it.
  await chat(
    { messages: [{ role: "user", content: "ok" }] },
    AbortSignal.timeout(config.timeoutMs),
  ).catch(() => undefined);

  const rows: Row[] = [];
  for (const test of EVAL_CASES.filter((c) => !only || c.id === only)) {
    const started = performance.now();
    try {
      const { reply, trace } = await replyWithTrace(test.locale, test.messages, {
        ...source.deps,
        config,
        chat,
      });
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
    console.error(
      `${model} ${test.id}: ${last?.error ?? last?.picks} (${last?.seconds.toFixed(0)} s)`,
    );
  }
  return rows;
}

function printTable(rows: readonly Row[]): void {
  console.log(
    "| Model | Case | Time | Tool calls | Picks | Invalid ids | Removed sentences | Language | Expected |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const row of rows) {
    console.log(
      `| ${row.model} | ${row.id} | ${row.seconds.toFixed(0)} s | ${cell(row.error ?? row.tools)} | ${cell(row.picks)} | ${row.invalidIds} | ${cell(row.removed.join(" / ") || "—")} | ${row.language ? "✓" : "✗"} | ${row.expected ? "✓" : "✗"} |`,
    );
  }
  for (const model of new Set(rows.map((r) => r.model))) {
    const mine = rows.filter((r) => r.model === model);
    const times = mine.map((r) => r.seconds);
    console.log(
      `\n**${model}**: ${mine.filter((r) => r.expected).length}/${mine.length} as expected, language ${mine.filter((r) => r.language).length}/${mine.length}, invalid ids ${mine.reduce((n, r) => n + r.invalidIds, 0)}, removed sentences ${mine.reduce((n, r) => n + r.removed.length, 0)}, errors ${mine.filter((r) => r.error).length}, ${Math.min(...times).toFixed(0)}–${Math.max(...times).toFixed(0)} s per answer.`,
    );
  }
}

const source = await catalogDeps();
try {
  console.error(
    `${source.catalog.length} perfumes from ${useDb ? "the database" : "catalog-data.ts"}; ${baseUrl}`,
  );
  const rows: Row[] = [];
  for (const model of models) {
    rows.push(...(await runModel(model, source)));
  }
  printTable(rows);
} finally {
  await source.close();
}
