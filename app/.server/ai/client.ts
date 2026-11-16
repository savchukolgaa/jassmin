import { chatCompletionResponseSchema } from "./client.schema";
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
}

export interface ChatResult {
  content: string | null;
  toolCalls: ToolCall[];
}

/** One chat-completions call; `signal` bounds it (the perfumer passes one for the whole reply). */
export type ChatFn = (request: ChatRequest, signal: AbortSignal) => Promise<ChatResult>;

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

/** The request body of one call. */
export function toRequestBody(config: PerfumerConfig, request: ChatRequest) {
  return {
    model: config.model,
    messages: request.messages.map(toWireMessage),
    temperature: 0.2,
    stream: false,
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

/** A `ChatFn` that calls the configured server. */
export function createChatClient(config: PerfumerConfig, fetchFn: typeof fetch = fetch): ChatFn {
  const url = `${config.baseUrl}/chat/completions`;

  return async (request, signal) => {
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(toRequestBody(config, request)),
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
    return {
      content: message?.content ?? null,
      toolCalls: (message?.tool_calls ?? []).map((call, index) => ({
        id: call.id ?? `call_${index}`,
        name: call.function.name,
        arguments: call.function.arguments,
      })),
    };
  };
}
