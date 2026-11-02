// Parses the popular page's `page` param with zod. Imported only by route loaders/actions, server code and tests, so zod stays out of the client
// bundle (#96).
import { z } from "zod";

const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

/** The `page` search param, like the catalog's: 1 when missing or invalid. */
export function parsePopularPage(params: URLSearchParams): number {
  return pageSchema.parse(params.get("page") ?? undefined);
}
