import { isRouteErrorResponse } from "react-router";
import type { TranslateFunction } from "./i18n";

export interface RouteErrorDescription {
  message: string;
  details: string;
  /** Only in development, for unexpected errors. */
  stack?: string;
}

/**
 * Turns an error caught by a route `ErrorBoundary` into text that is safe to show, in the
 * active locale (`t` from `useT()`).
 */
export function describeRouteError(
  error: unknown,
  t: TranslateFunction,
  dev: boolean = import.meta.env.DEV,
): RouteErrorDescription {
  if (isRouteErrorResponse(error) && error.status === 503) {
    // Thrown by `cmsUnavailable` when Strapi is down or answers unexpectedly.
    return { message: "503", details: t("errors.unavailable") };
  }
  if (isRouteErrorResponse(error) && error.status === 403) {
    // Thrown by `requireAdmin` for logged-in users without the admin role.
    return { message: "403", details: t("errors.forbidden") };
  }
  if (isRouteErrorResponse(error)) {
    // `statusText` comes from our own code, not from users, so it isn't translated.
    return error.status === 404
      ? { message: "404", details: t("errors.notFound") }
      : { message: t("errors.status"), details: error.statusText || t("errors.unexpected") };
  }
  if (dev && error instanceof Error) {
    return { message: t("errors.title"), details: error.message, stack: error.stack };
  }
  return { message: t("errors.title"), details: t("errors.unexpected") };
}
