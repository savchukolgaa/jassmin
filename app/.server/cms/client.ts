import type { z } from "zod";
import type { Locale } from "~/lib/i18n";
import { getEnv } from "../env";
import { CmsError } from "./errors";

/** Strapi is local and fast; a slow CMS should fail the page quickly rather than hang it. */
export const CMS_TIMEOUT_MS = 5000;

export type StrapiQueryValue = string | number | boolean | StrapiQuery | StrapiQueryValue[];
export interface StrapiQuery {
  [key: string]: StrapiQueryValue;
}

/**
 * Serializes nested Strapi query params into bracket notation, e.g.
 * `{ populate: { seo: { populate: ["ogImage"] } } }` → `populate[seo][populate][0]=ogImage`.
 */
export function toStrapiQuery(query: StrapiQuery): URLSearchParams {
  const params = new URLSearchParams();

  const append = (key: string, value: StrapiQueryValue): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        append(`${key}[${index}]`, item);
      });
    } else if (typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) {
        append(`${key}[${childKey}]`, child);
      }
    } else {
      params.append(key, String(value));
    }
  };

  for (const [key, value] of Object.entries(query)) {
    append(key, value);
  }
  return params;
}

export interface CmsFetchOptions {
  /** The Strapi locale to read; Strapi's default locale (`uk`) when omitted. */
  locale?: Locale;
}

/**
 * GETs `/api/<path>` from Strapi with the app's read-only token, only ever asking for published
 * content, and validates the JSON body with `schema`. Every failure becomes a `CmsError`; a
 * missing localization of a single type is an `http` error with `status: 404`.
 */
export async function cmsFetch<T>(
  path: string,
  query: StrapiQuery,
  schema: z.ZodType<T>,
  { locale }: CmsFetchOptions = {},
): Promise<T> {
  const { STRAPI_URL, STRAPI_API_TOKEN } = getEnv();
  if (!STRAPI_API_TOKEN) {
    throw new CmsError("not_configured", "STRAPI_API_TOKEN is not set");
  }

  // Relative to the base so a STRAPI_URL with a path prefix (https://host/cms) keeps it.
  const url = new URL(`api/${path}`, STRAPI_URL.endsWith("/") ? STRAPI_URL : `${STRAPI_URL}/`);
  url.search = toStrapiQuery({
    ...query,
    ...(locale ? { locale } : {}),
    status: "published",
  }).toString();

  let response: Response;
  let body: unknown;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${STRAPI_API_TOKEN}` },
      signal: AbortSignal.timeout(CMS_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new CmsError("http", `Strapi answered ${response.status} for ${url.pathname}`, {
        status: response.status,
      });
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

/** Turns a fetch, timeout or JSON failure into a `CmsError` (an existing one passes through). */
export function toCmsError(error: unknown, url: URL): CmsError {
  if (error instanceof CmsError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new CmsError("timeout", `Strapi did not answer within ${CMS_TIMEOUT_MS} ms`, {
      cause: error,
    });
  }
  if (error instanceof SyntaxError) {
    return new CmsError("invalid_response", `Strapi sent invalid JSON for ${url.pathname}`, {
      cause: error,
    });
  }
  return new CmsError("unreachable", `Could not reach Strapi at ${url.origin}`, { cause: error });
}
