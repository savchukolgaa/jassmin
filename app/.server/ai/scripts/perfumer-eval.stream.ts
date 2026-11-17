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
