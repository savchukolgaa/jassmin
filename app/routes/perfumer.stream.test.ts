import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PerfumerDeps } from "~/.server/ai/perfumer";
import type { PerfumerEvent } from "~/lib/perfumer";

const ai = vi.hoisted(() => ({
  isPerfumerEnabled: vi.fn(() => true),
  getPerfumerConfig: vi.fn(() => ({ model: "granite4.1:3b" })),
}));
const engine = vi.hoisted(() => ({ replyStream: vi.fn(), replyWithTrace: vi.fn() }));
const analytics = vi.hoisted(() => ({ ensureVisitor: vi.fn(), trackEvent: vi.fn() }));

vi.mock("~/.server/ai/config", () => ai);
vi.mock("~/.server/ai/perfumer", () => engine);
vi.mock("~/.server/analytics", () => analytics);

const { action } = await import("./perfumer.stream");

type ActionArgs = Parameters<typeof action>[0];

const reply: PerfumerEvent[] = [
  { type: "step", step: { tool: "search", families: ["водяні"], found: 2 } },
  { type: "intro", text: "Ось легкі аромати." },
  { type: "picks", picks: [] },
  { type: "done" },
];

function post(
  payload: unknown,
  {
    ip = "203.0.113.7",
    path = "/parfumer/stream",
    signal,
  }: { ip?: string; path?: string; signal?: AbortSignal } = {},
): ActionArgs {
  const body = new URLSearchParams({
    payload: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    body,
    headers: { "X-Forwarded-For": ip },
    signal,
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

/** The events in a streamed response. */
async function eventsOf(response: Response): Promise<unknown[]> {
  const text = new TextDecoder().decode(await response.arrayBuffer());
  return text
    .split("\n\n")
    .flatMap((frame) => frame.split("\n").filter((line) => line.startsWith("data: ")))
    .map((line) => JSON.parse(line.slice(6)));
}

const ask = (content = "Щось свіже на літо") => ({ messages: [{ role: "user", content }] });

/** The signal the engine got, once it was called. */
function engineSignal(): AbortSignal | undefined {
  const deps = engine.replyStream.mock.calls[0]?.[2] as Pick<PerfumerDeps, "signal"> | undefined;
  return deps?.signal;
}

beforeEach(() => {
  vi.clearAllMocks();
  ai.isPerfumerEnabled.mockReturnValue(true);
  engine.replyStream.mockImplementation(async function* () {
    yield* reply;
  });
  analytics.ensureVisitor.mockResolvedValue({ anonymousId: "visitor-1", sessionId: "s-1" });
});

describe("perfumer stream route (#164)", () => {
  it("is a 404 while the perfumer is disabled", async () => {
    ai.isPerfumerEnabled.mockReturnValue(false);
    const status = await Promise.resolve(action(post(ask()))).then(
      () => undefined,
      (error: unknown) => (error as { init?: { status?: number } }).init?.status,
    );
    expect(status).toBe(404);
    expect(engine.replyStream).not.toHaveBeenCalled();
  });

  it("streams the engine's events in the page's language", async () => {
    const response = await action(post(ask(), { path: "/en/perfumer/stream" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    // `done` carries the reply's id, for its rating (#166).
    expect(await eventsOf(response)).toEqual([
      ...reply.slice(0, -1),
      { type: "done", replyId: expect.any(String) },
    ]);
    expect(engine.replyStream).toHaveBeenCalledWith(
      "en",
      [{ role: "user", content: "Щось свіже на літо" }],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("refuses a message over 500 characters with a 400 error event", async () => {
    const response = await action(post(ask("а".repeat(501))));

    expect(response.status).toBe(400);
    expect(await eventsOf(response)).toEqual([{ type: "error", error: "tooLong" }]);
    expect(engine.replyStream).not.toHaveBeenCalled();
  });

  it("treats a tampered payload as unavailable", async () => {
    const response = await action(post("not json"));
    expect(response.status).toBe(503);
    expect(await eventsOf(response)).toEqual([{ type: "error", error: "unavailable" }]);
  });

  it("shares the action's rate limit: 429 with an error event", async () => {
    analytics.ensureVisitor.mockResolvedValue({ anonymousId: "visitor-limit", sessionId: "s-9" });
    for (let n = 0; n < 10; n++) {
      const response = await action(post(ask(), { ip: "198.51.100.1" }));
      expect(response.status).toBe(200);
      await response.arrayBuffer();
    }
    const response = await action(post(ask(), { ip: "198.51.100.1" }));

    expect(response.status).toBe(429);
    expect(await eventsOf(response)).toEqual([{ type: "error", error: "rateLimited" }]);
    expect(engine.replyStream).toHaveBeenCalledTimes(10);
    // The refused message is recorded too (#166).
    expect(analytics.trackEvent).toHaveBeenLastCalledWith(expect.anything(), "perfumer_message", {
      properties: expect.objectContaining({ error: "rate_limited", model: null }),
    });
  });

  it("stops the model call when the request is aborted", async () => {
    const controller = new AbortController();
    analytics.ensureVisitor.mockResolvedValue({ anonymousId: "visitor-3", sessionId: "s-3" });

    await action(post(ask(), { ip: "198.51.100.3", signal: controller.signal }));
    expect(engineSignal()?.aborted).toBe(false);

    controller.abort();
    expect(engineSignal()?.aborted).toBe(true);
  });

  it("stops the model call when the response body is cancelled", async () => {
    analytics.ensureVisitor.mockResolvedValue({ anonymousId: "visitor-4", sessionId: "s-4" });

    const response = await action(post(ask(), { ip: "198.51.100.4" }));
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();

    expect(engineSignal()?.aborted).toBe(true);
  });

  it("records one perfumer_message when the stream ends, with the turn and entry (#166)", async () => {
    analytics.ensureVisitor.mockResolvedValue({ anonymousId: "visitor-166", sessionId: "s-166" });
    const response = await action(
      post({ ...ask(), turn: 3, entry: "empty_results" }, { ip: "198.51.100.66" }),
    );
    expect(analytics.trackEvent).not.toHaveBeenCalled();
    const events = await eventsOf(response);

    expect(analytics.trackEvent).toHaveBeenCalledTimes(1);
    const [, type, options] = analytics.trackEvent.mock.calls[0] ?? [];
    expect(type).toBe("perfumer_message");
    expect(options.properties).toMatchObject({
      reply_id: (events.at(-1) as { replyId: string }).replyId,
      turn: 3,
      entry: "empty_results",
      model: "granite4.1:3b",
      error: null,
    });
    expect(JSON.stringify(options)).not.toContain("Ось легкі аромати.");
  });
});
