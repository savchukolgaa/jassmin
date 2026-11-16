import { describe, expect, it, vi } from "vitest";
import { createChatClient, createChatStreamClient, toRequestBody } from "./client";
import type { PerfumerConfig } from "./config";
import { AiError } from "./errors";

const config: PerfumerConfig = {
  baseUrl: "http://localhost:11434/v1",
  model: "granite4.1:3b",
  apiKey: undefined,
  timeoutMs: 90_000,
  keepAlive: undefined,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

async function failure(promise: Promise<unknown>): Promise<AiError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof AiError)) {
    throw new Error(`Expected an AiError, got ${String(error)}`);
  }
  return error;
}

describe("createChatClient", () => {
  it("posts to /chat/completions and returns the content and tool calls", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      json({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_a",
                  type: "function",
                  function: { name: "search_perfumes", arguments: '{"families":["водяні"]}' },
                },
                // An object instead of a string, and no id.
                { function: { name: "similar_to", arguments: { title: "Sauvage" } } },
              ],
            },
          },
        ],
      }),
    );
    const chat = createChatClient({ ...config, apiKey: "sk-test", keepAlive: "30m" }, fetchFn);

    const result = await chat({ messages: [{ role: "user", content: "морські" }] }, signal());

    expect(result).toEqual({
      content: null,
      toolCalls: [
        { id: "call_a", name: "search_perfumes", arguments: '{"families":["водяні"]}' },
        { id: "call_1", name: "similar_to", arguments: '{"title":"Sauvage"}' },
      ],
    });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk-test");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "granite4.1:3b",
      keep_alive: "30m",
      stream: false,
    });
  });

  it("sends no Authorization header without a key", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      json({ choices: [{ message: { content: "ok" } }] }),
    );
    const result = await createChatClient(config, fetchFn)({ messages: [] }, signal());
    expect(result).toEqual({ content: "ok", toolCalls: [] });
    expect(new Headers(fetchFn.mock.calls[0]?.[1]?.headers).has("Authorization")).toBe(false);
  });

  it("maps a refused connection to unavailable", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    const error = await failure(createChatClient(config, fetchFn)({ messages: [] }, signal()));
    expect(error.kind).toBe("unavailable");
  });

  it("maps a timed-out request to timeout", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const error = await failure(createChatClient(config, fetchFn)({ messages: [] }, signal()));
    expect(error.kind).toBe("timeout");
  });

  it("maps HTTP errors: 400 to bad_response, 404 and 500 to unavailable", async () => {
    for (const [status, kind] of [
      [400, "bad_response"],
      [404, "unavailable"],
      [500, "unavailable"],
    ] as const) {
      const fetchFn = vi.fn<typeof fetch>(async () => json({ error: "nope" }, status));
      const error = await failure(createChatClient(config, fetchFn)({ messages: [] }, signal()));
      expect(error.kind).toBe(kind);
      expect(error.status).toBe(status);
    }
  });

  it("maps a non-JSON or unexpected body to bad_response", async () => {
    for (const response of [
      () => new Response("<html>", { status: 200 }),
      () => json({ choices: [] }),
      () => json({ choices: [{ message: { tool_calls: [{ function: {} }] } }] }),
    ]) {
      const fetchFn = vi.fn<typeof fetch>(async () => response());
      const error = await failure(createChatClient(config, fetchFn)({ messages: [] }, signal()));
      expect(error.kind).toBe("bad_response");
    }
  });
});

/** A streamed response whose body arrives in these pieces. */
function sse(pieces: readonly string[], { onCancel }: { onCancel?: () => void } = {}): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const piece = pieces[index++];
      if (piece === undefined) {
        controller.close();
      } else {
        controller.enqueue(encoder.encode(piece));
      }
    },
    cancel() {
      onCancel?.();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

const chunk = (content: string | null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const pieces: string[] = [];
  for await (const piece of iterable) {
    pieces.push(piece);
  }
  return pieces;
}

async function streamFailure(iterable: AsyncIterable<string>): Promise<AiError> {
  return failure(collect(iterable));
}

describe("createChatStreamClient (#164)", () => {
  it("asks for a stream and yields the text pieces in order until [DONE]", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () =>
      sse([
        `${chunk("Ось ")}${chunk(null)}`,
        // A chunk split in the middle of its line, and a CRLF line end.
        `data: {"choices":[{"delta":{"content":"свіжі"}}]}`,
        "\r\n\r\n: a comment\n\n",
        chunk(" аромати."),
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
        chunk("never read"),
      ]),
    );
    const stream = createChatStreamClient(config, fetchFn);

    const pieces = await collect(stream({ messages: [] }, signal()));

    expect(pieces).toEqual(["Ось ", "свіжі", " аромати."]);
    const init = fetchFn.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toMatchObject({ stream: true });
    expect(new Headers(init?.headers).get("Accept")).toBe("text/event-stream");
  });

  it("ends without [DONE] when the body ends", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => sse([chunk("Один."), chunk(" Два.")]));
    const pieces = await collect(
      createChatStreamClient(config, fetchFn)({ messages: [] }, signal()),
    );
    expect(pieces).toEqual(["Один.", " Два."]);
  });

  it("cancels the response when the caller stops early", async () => {
    const onCancel = vi.fn();
    const fetchFn = vi.fn<typeof fetch>(async () =>
      sse([chunk("Один."), chunk(" Два."), chunk(" Три.")], { onCancel }),
    );
    for await (const piece of createChatStreamClient(config, fetchFn)({ messages: [] }, signal())) {
      expect(piece).toBe("Один.");
      break;
    }
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("maps HTTP errors and refused connections like the plain client", async () => {
    const notFound = vi.fn<typeof fetch>(async () => json({ error: "model not found" }, 404));
    expect(
      (await streamFailure(createChatStreamClient(config, notFound)({ messages: [] }, signal())))
        .kind,
    ).toBe("unavailable");

    const refused = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(
      (await streamFailure(createChatStreamClient(config, refused)({ messages: [] }, signal())))
        .kind,
    ).toBe("unavailable");
  });

  it("maps an abort while reading to timeout", async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(chunk("Ось")));
          init?.signal?.addEventListener("abort", () =>
            stream.error(new DOMException("aborted", "AbortError")),
          );
        },
      });
      return new Response(body);
    });
    const pieces: string[] = [];
    const error = await failure(
      (async () => {
        for await (const piece of createChatStreamClient(config, fetchFn)(
          { messages: [] },
          controller.signal,
        )) {
          pieces.push(piece);
          controller.abort();
        }
      })(),
    );
    expect(pieces).toEqual(["Ось"]);
    expect(error.kind).toBe("timeout");
  });

  it("maps a chunk that isn't JSON or a chunk to bad_response", async () => {
    for (const piece of ["data: <html>\n\n", 'data: {"error":"overloaded"}\n\n']) {
      const fetchFn = vi.fn<typeof fetch>(async () => sse([piece]));
      const error = await streamFailure(
        createChatStreamClient(config, fetchFn)({ messages: [] }, signal()),
      );
      expect(error.kind).toBe("bad_response");
    }
  });
});

describe("toRequestBody", () => {
  it("adds tools, the JSON schema response format and tool messages in wire format", () => {
    const body = toRequestBody(config, {
      messages: [
        { role: "system", content: "rules" },
        {
          role: "assistant",
          content: null,
          toolCalls: [{ id: "c1", name: "search_perfumes", arguments: "{}" }],
        },
        { role: "tool", toolCallId: "c1", content: "[]" },
      ],
      tools: [{ name: "search_perfumes", description: "Search", parameters: { type: "object" } }],
      responseFormat: { name: "answer", schema: { type: "object" } },
    });

    expect(body.messages).toEqual([
      { role: "system", content: "rules" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "search_perfumes", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "[]" },
    ]);
    expect(body).toMatchObject({
      tool_choice: "auto",
      tools: [{ type: "function", function: { name: "search_perfumes" } }],
      response_format: { type: "json_schema", json_schema: { name: "answer", strict: true } },
    });
    expect(body).not.toHaveProperty("keep_alive");
  });
});
