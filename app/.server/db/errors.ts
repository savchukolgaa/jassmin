/** PostgreSQL's `unique_violation`. */
export const UNIQUE_VIOLATION = "23505";

/** The PostgreSQL error code (e.g. `23505`) of a failed query, unwrapping Drizzle's error. */
export function pgErrorCode(error: unknown): string | undefined {
  const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    return String(cause.code);
  }
  return undefined;
}
