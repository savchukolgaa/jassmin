/**
 * Why a model call failed (#162): the server couldn't be reached or answered with an error
 * (`unavailable`), it took longer than `AI_TIMEOUT_MS` (`timeout`), or its answer didn't match the
 * expected shape (`bad_response`). The chat page (#163) turns these into translated messages.
 */
export type AiErrorKind = "unavailable" | "timeout" | "bad_response";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number | undefined;

  constructor(
    kind: AiErrorKind,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AiError";
    this.kind = kind;
    this.status = options.status;
  }
}

/** The perfumer was asked to reply while `AI_BASE_URL` is unset; no model was called. */
export class PerfumerDisabledError extends Error {
  constructor() {
    super("The AI perfumer is disabled: AI_BASE_URL is not set");
    this.name = "PerfumerDisabledError";
  }
}
