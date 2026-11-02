// Parses the blog list's search params with zod. Imported only by route loaders/actions, server code and tests, so zod stays out of the client
// bundle (#96).
import { z } from "zod";
import type { BlogSearch } from "./blog";

const blogSearchSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/** Reads `?page=` from the blog list URL; bad values fall back to page 1. */
export function parseBlogSearch(params: URLSearchParams): BlogSearch {
  return blogSearchSchema.parse({ page: params.get("page") ?? undefined });
}
