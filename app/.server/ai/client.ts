import { chatCompletionChunkSchema, chatCompletionResponseSchema } from "./client.schema";
import type { PerfumerConfig } from "./config";
import { AiError } from "./errors";

// A small client for `POST {AI_BASE_URL}/chat/completions` (#162), the OpenAI-compatible API that
// Ollama serves under `/v1`, so any compatible local or hosted model works. No SDK on purpose.

/** A JSON Schema object, passed through to the model as is. */
export type JsonSchema = { [key: string]: unknown };

export interface ToolCall {
  id: string;
  name: string;
  /** The raw JSON string the model wrote; the tool validates it. */
  arguments: string;
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  /** Asks for JSON matching this schema (`response_format: json_schema`). */
  responseFormat?: { name: string; schema: JsonSchema };
  /** The most tokens the model may generate (`max_tokens`). */
  maxTokens?: number;
  /**
   * Streamed calls only: called with the tokens the call used, when the server reports them in
   * its last chunk (#167). A stream stopped early never gets there, so it isn't called then.
   */
  onUsage?: (usage: TokenUsage) => void;
}

/** The tokens one call used, as the server reported them (#167). */
export interface TokenUsage {
  input: number;
  output: number;
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
  /** Absent when the server didn't report it. */
  usage?: TokenUsage;
}

/** One chat-completions call; `signal` bounds it (the perfumer passes one for the whole reply). */
export type ChatFn = (request: ChatRequest, signal: AbortSignal) => Promise<ChatResult>;

/**
 * One streamed chat-completions call (#164): the text as the model writes it, in pieces. Stopping
 * the iteration cancels the response; `signal` bounds the whole call.
 */
export type ChatStreamFn = (request: ChatRequest, signal: AbortSignal) => AsyncIterable<string>;

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  switch (message.role) {
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    case "tool":
      return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
    default:
      return { role: message.role, content: message.content };
  }
}

/** The request body of one call; `stream` asks for the answer as server-sent events (#164). */
export function toRequestBody(
  config: PerfumerConfig,
  request: ChatRequest,
  { stream = false }: { stream?: boolean } = {},
) {
  return {
    model: config.model,
    messages: request.messages.map(toWireMessage),
    temperature: 0.2,
    stream,
    // The token counts arrive in the stream's last chunk only when asked for (#167).
    ...(stream ? { stream_options: { include_usage: true } } : {}),
    ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: "auto",
        }
      : {}),
    ...(request.responseFormat
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: request.responseFormat.name,
              schema: request.responseFormat.schema,
              strict: true,
            },
          },
        }
      : {}),
    // Ollama keeps the model loaded this long; other servers ignore it, so send it only when set.
    ...(config.keepAlive ? { keep_alive: config.keepAlive } : {}),
  };
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
  );
}

function timeout(cause: unknown): AiError {
  return new AiError("timeout", "The model took too long to answer", { cause });
}

/**
 * Posts one request and returns the successful response. A refused connection is `unavailable`, an
 * abort or timeout `timeout`, and an HTTP error `bad_response` (400/422) or `unavailable`.
 */
async function post(
  config: PerfumerConfig,
  fetchFn: typeof fetch,
  body: unknown,
  signal: AbortSignal,
  accept: string,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchFn(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: accept,
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (isAbort(error, signal)) {
      throw timeout(error);
    }
    throw new AiError("unavailable", "The model server can't be reached", { cause: error });
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    // 400/422: the server understood the request but refused our payload (e.g. no tool
    // support); anything else (404 unknown model, 401, 429, 5xx) means it can't serve us now.
    const kind =
      response.status === 400 || response.status === 422 ? "bad_response" : "unavailable";
    throw new AiError(kind, `The model server answered ${response.status}: ${detail}`, {
      status: response.status,
    });
  }
  return response;
}

/** A `ChatFn` that calls the configured server. */
export function createChatClient(config: PerfumerConfig, fetchFn: typeof fetch = fetch): ChatFn {
  return async (request, signal) => {
    const response = await post(
      config,
      fetchFn,
      toRequestBody(config, request),
      signal,
      "application/json",
    );

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      if (isAbort(error, signal)) {
        throw timeout(error);
      }
      throw new AiError("bad_response", "The model server didn't answer JSON", { cause: error });
    }

    const parsed = chatCompletionResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AiError("bad_response", "Unexpected chat-completions response", {
        cause: parsed.error,
      });
    }

    const message = parsed.data.choices[0]?.message;
    const usage = toUsage(parsed.data.usage);
    return {
      content: message?.content ?? null,
      toolCalls: (message?.tool_calls ?? []).map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.function.name,
        arguments: call.function.arguments,
      })),
      ...(usage ? { usage } : {}),
    };
  };
}

function toUsage(
  usage: { prompt_tokens: number; completion_tokens: number } | null | undefined,
): TokenUsage | undefined {
  return usage ? { input: usage.prompt_tokens, output: usage.completion_tokens } : undefined;
}

/**
 * The text in one `data:` chunk and the usage it reports, if any; throws `bad_response` when it
 * isn't a chunk.
 */
function parseChunk(data: string): { delta: string; usage: TokenUsage | undefined } {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch (error) {
    throw new AiError("bad_response", "The model server streamed a chunk that isn't JSON", {
      cause: error,
    });
  }
  const parsed = chatCompletionChunkSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiError("bad_response", "Unexpected chat-completions chunk", {
      cause: parsed.error,
    });
  }
  return {
    delta: parsed.data.choices[0]?.delta?.content ?? "",
    usage: toUsage(parsed.data.usage),
  };
}

/**
 * A `ChatStreamFn` that calls the configured server with `stream: true` and reads its server-sent
 * events: `data: {chunk}` lines, then `data: [DONE]`.
 */
export function createChatStreamClient(
  config: PerfumerConfig,
  fetchFn: typeof fetch = fetch,
): ChatStreamFn {
  return async function* stream(request, signal) {
    const response = await post(
      config,
      fetchFn,
      toRequestBody(config, request, { stream: true }),
      signal,
      "text/event-stream",
    );
    if (!response.body) {
      throw new AiError("bad_response", "The model server streamed no body");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          if (isAbort(error, signal)) {
            throw timeout(error);
          }
          throw new AiError("unavailable", "The model server's stream broke off", {
            cause: error,
          });
        }
        buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
        // A complete line ends with a line break; the unfinished last one waits for more.
        const lines = buffer.split(/\r?\n/);
        buffer = chunk.done ? "" : (lines.pop() ?? "");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          if (data === "") continue;
          const { delta, usage } = parseChunk(data);
          if (usage) request.onUsage?.(usage);
          if (delta) yield delta;
        }
        if (chunk.done) return;
      }
    } finally {
      // Stopped early (the customer left, the intro is long enough) or failed: drop the connection.
      await reader.cancel().catch(() => {});
    }
  };
}
