import { isRouteErrorResponse } from "react-router";

export interface RouteErrorDescription {
  message: string;
  details: string;
  /** Only in development, for unexpected errors. */
  stack?: string;
}

/** Turns an error caught by a route `ErrorBoundary` into text that is safe to show. */
export function describeRouteError(
  error: unknown,
  dev: boolean = import.meta.env.DEV,
): RouteErrorDescription {
  if (isRouteErrorResponse(error) && error.status === 503) {
    // Thrown by `cmsUnavailable` when Strapi is down or answers unexpectedly.
    return {
      message: "503",
      details: "This content is temporarily unavailable. Please try again in a few minutes.",
    };
  }
  if (isRouteErrorResponse(error)) {
    return error.status === 404
      ? { message: "404", details: "The requested page could not be found." }
      : { message: "Error", details: error.statusText || "An unexpected error occurred." };
  }
  if (dev && error instanceof Error) {
    return { message: "Oops!", details: error.message, stack: error.stack };
  }
  return { message: "Oops!", details: "An unexpected error occurred." };
}
