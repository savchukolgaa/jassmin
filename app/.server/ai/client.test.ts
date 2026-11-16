import { describe, expect, it, vi } from "vitest";
import { createChatClient, toRequestBody } from "./client";
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
