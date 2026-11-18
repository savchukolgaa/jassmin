import { performance } from "node:perf_hooks";
import type { PerfumerEvent, PerfumerReply } from "~/lib/perfumer";
import type { ProductSummary } from "~/lib/products";
import type { PerfumerProductRow } from "../../db/queries/perfumer";
import type { PerfumerTrace } from "../perfumer";
import type { EvalCase } from "./perfumer-eval.cases";

// The eval's (#162) helpers, apart from the script so they can be tested: the script runs the
// models as soon as it's imported. `collectStreamedReply` and `percentile` are for `--stream`
// (#172).

/** The share of letters that are Cyrillic. */
export function cyrillicShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu) ?? [];
  return letters.length ? cyrillic.length / letters.length : 0;
}

export function describeTools(trace: PerfumerTrace): string {
  return (
    trace.toolCalls
      .map((call) => `${call.ok ? "" : "✗"}${call.name}(${JSON.stringify(call.arguments)})`)
      .join("; ") || "—"
  );
}

export const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");

export function meetsExpectation(
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

/** When a streamed reply's events arrived, in milliseconds from the start of the reply. */
export interface StreamTimings {
  /** The first `step`; none when no catalog tool ran (off-topic, injection). */
  firstStepMs?: number;
  /** The first `intro` sentence, the translated fallback included. */
  firstIntroMs?: number;
  /** `done`. */
  totalMs: number;
}

/**
 * Reads a streamed reply (`replyStream`, #164) to the end: when its first step, first intro
 * sentence and `done` arrived, counted from `startedAt` on the `now` clock, and the reply put back
 * together from the events as the chat shows it. Throws on an `error` event or a stream that ends
 * before `done`.
 */
export async function collectStreamedReply(
  events: AsyncIterable<PerfumerEvent>,
  startedAt: number,
  now: () => number = () => performance.now(),
): Promise<{ reply: PerfumerReply; timings: StreamTimings }> {
  let firstStepMs: number | undefined;
  let firstIntroMs: number | undefined;
  let intro = "";
  let picks: PerfumerReply["picks"] = [];
  let question: string | undefined;
  for await (const event of events) {
    const at = now() - startedAt;
    switch (event.type) {
      case "step":
        firstStepMs ??= at;
        break;
      case "intro":
        firstIntroMs ??= at;
        intro += event.text;
        break;
      case "picks":
        picks = event.picks;
        break;
      case "question":
        question = event.text;
        break;
      case "error":
        throw new Error(`The stream sent an error: ${event.error}`);
      case "done":
        return {
          reply: { intro, picks, ...(question ? { question } : {}) },
          timings: {
            ...(firstStepMs === undefined ? {} : { firstStepMs }),
            ...(firstIntroMs === undefined ? {} : { firstIntroMs }),
            totalMs: at,
          },
        };
    }
  }
  throw new Error("The stream ended before done");
}

/** The nearest-rank percentile `p` (0–100) of `values`; `undefined` when there are none. */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

// Cost and texts (#167): what a model would cost per 1000 answers, from the tokens it used, and
// the answers themselves, so the owner can judge the Ukrainian.

/** USD per million tokens, from the provider's price page on the day of the run. */
export interface TokenPrices {
  input: number;
  output: number;
}

/**
 * `--price-in <usd/M> --price-out <usd/M>`: both or neither, non-negative numbers. Throws with a
 * usage message otherwise.
 */
export function parsePrices(args: readonly string[]): TokenPrices | undefined {
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const raw = args[index + 1];
    const number = raw === undefined ? Number.NaN : Number(raw);
    if (!Number.isFinite(number) || number < 0) {
      throw new Error(`${flag} needs a price in USD per million tokens, e.g. ${flag} 0.15`);
    }
    return number;
  };
  const input = value("--price-in");
  const output = value("--price-out");
  if (input === undefined && output === undefined) return undefined;
  if (input === undefined || output === undefined) {
    throw new Error("Give both --price-in and --price-out (USD per million tokens)");
  }
  return { input, output };
}

/** The tokens of one answer, as in `PerfumerTrace.tokens`. */
export interface AnswerTokens {
  input: number;
  output: number;
  unreported: number;
}

export interface TokenSummary {
  /** Answers that finished (failed ones have no trace). */
  answers: number;
  meanInput: number;
  meanOutput: number;
  /** Model calls without usage across all answers: the means are then a lower bound. */
  unreported: number;
  /** USD for 1000 answers like these; only with prices. */
  costPer1000?: number;
}

/** Mean tokens per answer and, with `prices`, the cost of 1000 such answers. */
export function summarizeTokens(
  answers: readonly AnswerTokens[],
  prices?: TokenPrices,
): TokenSummary | undefined {
  if (answers.length === 0) return undefined;
  const sum = (pick: (a: AnswerTokens) => number) => answers.reduce((n, a) => n + pick(a), 0);
  const meanInput = sum((a) => a.input) / answers.length;
  const meanOutput = sum((a) => a.output) / answers.length;
  return {
    answers: answers.length,
    meanInput,
    meanOutput,
    unreported: sum((a) => a.unreported),
    ...(prices
      ? { costPer1000: (meanInput * prices.input + meanOutput * prices.output) / 1000 }
      : {}),
  };
}

/** One summary phrase: "tokens per answer 4,210 in / 180 out; ≈ $0.71 per 1000 answers". */
export function describeTokens(summary: TokenSummary | undefined): string {
  if (!summary) return "tokens unknown (no answer finished)";
  if (summary.meanInput === 0 && summary.meanOutput === 0 && summary.unreported > 0) {
    return "tokens unknown (the server reported no usage)";
  }
  const round = (n: number) => Math.round(n).toLocaleString("en-US");
  const lowerBound =
    summary.unreported > 0 ? ` (at least: ${summary.unreported} calls reported no usage)` : "";
  const cost =
    summary.costPer1000 === undefined
      ? ""
      : `; ≈ $${summary.costPer1000.toFixed(2)} per 1000 answers`;
  return `tokens per answer ${round(summary.meanInput)} in / ${round(summary.meanOutput)} out${lowerBound}${cost}`;
}

/** `--texts`: one answer as quoted Markdown, for judging its language by eye. */
export function formatAnswerText(model: string, caseId: string, reply: PerfumerReply): string {
  const quote = (text: string) => `> ${text.replaceAll("\n", " ")}`;
  const lines = [`#### ${model} · ${caseId}`, "", quote(reply.intro)];
  for (const pick of reply.picks) {
    lines.push(">", quote(`**${pick.product.title}**: ${pick.reason}`));
  }
  if (reply.question) {
    lines.push(">", quote(`*${reply.question}*`));
  }
  return lines.join("\n");
}

/**
 * Whether the model server runs on this machine (Ollama): only then does the eval send
 * `keep_alive`, which a strict hosted API may refuse as an unknown parameter.
 */
export function isLocalServer(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
