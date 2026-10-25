// Writes to Strapi for the CMS sync (#40): the app pushes orders and product stock with the
// `STRAPI_SYNC_TOKEN`, which may create and update products and orders. Reads for the storefront
// stay in `client.ts` with the read-only token. Takes its config explicitly, so `pnpm
// db:sync-cms` can run without the web app's env.
import type { z } from "zod";
import type { CmsSyncEnv } from "../env";
import { CMS_TIMEOUT_MS, type StrapiQuery, toCmsError, toStrapiQuery } from "./client";
import { CmsError } from "./errors";

export interface CmsWriteRequest {
  method: "GET" | "POST" | "PUT";
  /** Below `/api/`, e.g. `orders/<documentId>`. */
  path: string;
  query?: StrapiQuery;
  /** Sent as Strapi's `{ data: … }` envelope. */
  data?: unknown;
}

/**
 * Sends one request to Strapi's content API with the sync token and validates the JSON answer
 * with `schema`. Every failure becomes a `CmsError` (`not_configured` without the token).
 */
export async function cmsWrite<T>(
  env: CmsSyncEnv,
  { method, path, query, data }: CmsWriteRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  const { STRAPI_URL, STRAPI_SYNC_TOKEN } = env;
  if (!STRAPI_SYNC_TOKEN) {
    throw new CmsError("not_configured", "STRAPI_SYNC_TOKEN is not set");
  }

  const url = new URL(`api/${path}`, STRAPI_URL.endsWith("/") ? STRAPI_URL : `${STRAPI_URL}/`);
  if (query) {
    url.search = toStrapiQuery(query).toString();
  }

  let body: unknown;
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${STRAPI_SYNC_TOKEN}`,
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify({ data }),
      signal: AbortSignal.timeout(CMS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new CmsError(
        "http",
        `Strapi answered ${response.status} for ${method} ${url.pathname}: ${await response.text().catch(() => "")}`.slice(
          0,
          500,
        ),
        { status: response.status },
      );
    }
    body = await response.json();
  } catch (error) {
    throw toCmsError(error, url);
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new CmsError("invalid_response", `Unexpected Strapi response for ${url.pathname}`, {
      cause: result.error,
    });
  }
  return result.data;
}
