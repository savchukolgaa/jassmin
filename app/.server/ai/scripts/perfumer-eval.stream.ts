import type { ProductSummary } from "~/lib/products";
import type { PerfumerProductRow } from "../../db/queries/perfumer";
import type { PerfumerTrace } from "../perfumer";
import type { EvalCase } from "./perfumer-eval.cases";

// The eval's (#162) helpers, apart from the script so they can be tested: the script runs the
// models as soon as it's imported.

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
