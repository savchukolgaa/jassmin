import { data } from "react-router";

export type CmsErrorKind =
  /** `STRAPI_API_TOKEN` (or, for writes, `STRAPI_SYNC_TOKEN`) is not set. */
  | "not_configured"
  /** Network failure: Strapi is down or the URL is wrong. */
  | "unreachable"
  | "timeout"
  /** Strapi answered with a non-2xx status. */
  | "http"
  /** The response wasn't JSON or didn't match the expected schema. */
  | "invalid_response";

/** Strapi could not deliver content. Loaders turn it into a 503 with `cmsUnavailable`. */
export class CmsError extends Error {
  override readonly name = "CmsError";
  readonly kind: CmsErrorKind;
  readonly status: number | undefined;

  constructor(kind: CmsErrorKind, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.kind = kind;
    this.status = options?.status;
  }
}

export function isCmsError(error: unknown): error is CmsError {
  return error instanceof CmsError;
}

/**
 * Rethrows a `CmsError` as a 503 response for the route `ErrorBoundary`, and anything else
 * unchanged. Use it in loaders: `await getHomePage().catch(cmsUnavailable)`.
 */
export function cmsUnavailable(error: unknown): never {
  if (isCmsError(error)) {
    console.error(`[cms] ${error.kind}: ${error.message}`, error.cause ?? "");
    throw data({ message: "Content is temporarily unavailable" }, { status: 503 });
  }
  throw error;
}
