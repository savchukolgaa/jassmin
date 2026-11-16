import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PerfumerReply } from "~/lib/perfumer";

const ai = vi.hoisted(() => ({
  isPerfumerEnabled: vi.fn(() => true),
  getPerfumerConfig: vi.fn(() => ({ model: "granite4.1:3b" })),
}));
const engine = vi.hoisted(() => ({ replyWithTrace: vi.fn(), replyStream: vi.fn() }));
const analytics = vi.hoisted(() => ({ ensureVisitor: vi.fn(), trackEvent: vi.fn() }));

vi.mock("~/.server/ai/config", () => ai);
vi.mock("~/.server/ai/perfumer", () => engine);
vi.mock("~/.server/analytics", () => analytics);

const { action, loader, meta } = await import("./perfumer");

type LoaderArgs = Parameters<typeof loader>[0];
type MetaArgs = Parameters<typeof meta>[0];

const get = (url = "http://localhost/parfumer") =>
  ({ request: new Request(url), params: {}, context: {} }) as unknown as LoaderArgs;

type ActionArgs = Parameters<typeof action>[0];

const answer: PerfumerReply = { intro: "Ось легкі аромати.", picks: [], question: "Для кого?" };

function post(payload: unknown, { ip = "203.0.113.7", path = "/parfumer" } = {}): ActionArgs {
  return postForm(
    { payload: typeof payload === "string" ? payload : JSON.stringify(payload) },
    { ip, path },
  );
}

function postForm(
  fields: Record<string, string>,
  { ip = "203.0.113.7", path = "/parfumer" } = {},
): ActionArgs {
  const body = new URLSearchParams(fields);
  const request = new Request(`http://localhost${path}`, {
    method: "POST",
    body,
    headers: { "X-Forwarded-For": ip },
  });
  return { request, params: {}, context: {} } as unknown as ActionArgs;
}

/** A `data()` result's payload and status. */
function unwrap(result: unknown): { status: number; body: unknown } {
  const { data, init } = result as { data: unknown; init?: { status?: number } };
  return { status: init?.status ?? 200, body: data };
}

/** The status of a thrown `data()` response. */
async function thrownStatus(run: () => unknown): Promise<number | undefined> {
  try {
    await run();
  } catch (error) {
    return (error as { init?: { status?: number } }).init?.status;
  }
  return undefined;
}

const ask = (content = "Щось свіже на літо") => ({ messages: [{ role: "user", content }] });

beforeEach(() => {
  vi.clearAllMocks();
  ai.isPerfumerEnabled.mockReturnValue(true);
  engine.replyWithTrace.mockResolvedValue({ reply: answer, trace: { toolCalls: [] } });
  analytics.ensureVisitor.mockResolvedValue({ anonymousId: "visitor-1", sessionId: "s-1" });
});

describe("perfumer route", () => {
  it("is a 404, page and action, while the perfumer is disabled", async () => {
    ai.isPerfumerEnabled.mockReturnValue(false);

    expect(await thrownStatus(() => loader(get()))).toBe(404);
    expect(await thrownStatus(() => action(post(ask())))).toBe(404);
    expect(engine.replyWithTrace).not.toHaveBeenCalled();
  });

  it("renders the page while it's enabled", () => {
    expect(loader(get())).toEqual({ prefill: null });
  });

  it("passes a prefilled message from `q` to the page, trimmed (#165)", () => {
    const q = encodeURIComponent("  Схоже на Light Blue від Dolce & Gabbana ");
    expect(loader(get(`http://localhost/parfumer?q=${q}`))).toEqual({
      prefill: "Схоже на Light Blue від Dolce & Gabbana",
    });
  });

  it.each([
    ["empty", "%20%20"],
    ["over 500 characters", "а".repeat(501)],
  ])("drops a prefilled message that is %s (#165)", (_name, q) => {
    expect(loader(get(`http://localhost/parfumer?q=${q}`))).toEqual({ prefill: null });
  });

  it("keeps `q` out of the canonical URL (#165)", () => {
    const tags = meta({
      matches: [{ id: "root", loaderData: { locale: "en", site: { url: "https://jassmin.ua" } } }],
      location: { pathname: "/en/perfumer", search: "?q=Something%20fresh" },
      loaderData: { prefill: "Something fresh" },
    } as unknown as MetaArgs);

    expect(tags).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://jassmin.ua/en/perfumer",
    });
  });

  it("answers in the page's language with the engine's reply", async () => {
    const { status, body } = unwrap(await action(post(ask(), { path: "/en/perfumer" })));

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, reply: answer, replyId: expect.any(String) });
    expect(engine.replyWithTrace).toHaveBeenCalledWith(
      "en",
      [{ role: "user", content: "Щось свіже на літо" }],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("refuses a message over 500 characters without calling the model", async () => {
    const { status, body } = unwrap(await action(post(ask("а".repeat(501)))));

    expect(status).toBe(400);
    expect(body).toEqual({ ok: false, error: "tooLong" });
    expect(engine.replyWithTrace).not.toHaveBeenCalled();
    // No valid turn, so no event either.
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });

  it("treats a tampered payload as unavailable", async () => {
    const { body } = unwrap(await action(post("not json")));
    expect(body).toEqual({ ok: false, error: "unavailable" });
  });

  it("allows 10 messages per 5 minutes, then answers rateLimited", async () => {
    // The limits' counters last for the whole file: a visitor and IP of its own.
    analytics.ensureVisitor.mockResolvedValue({ anonymousId: "visitor-limit", sessionId: "s-9" });
    for (let n = 0; n < 10; n++) {
      expect(unwrap(await action(post(ask(), { ip: "198.51.100.1" }))).status).toBe(200);
    }
    const { status, body } = unwrap(await action(post(ask(), { ip: "198.51.100.1" })));

    expect(status).toBe(429);
    expect(body).toEqual({ ok: false, error: "rateLimited" });
    expect(engine.replyWithTrace).toHaveBeenCalledTimes(10);
    // The refused message is recorded too.
    expect(analytics.trackEvent).toHaveBeenLastCalledWith(expect.anything(), "perfumer_message", {
      properties: expect.objectContaining({ error: "rate_limited", model: null }),
    });
  });

  it("maps a model timeout to the timeout error", async () => {
    const { AiError } = await import("~/.server/ai/errors");
    engine.replyWithTrace.mockRejectedValue(new AiError("timeout", "slow"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    analytics.ensureVisitor.mockResolvedValue({ anonymousId: "visitor-2", sessionId: "s-2" });

    const { status, body } = unwrap(await action(post(ask(), { ip: "198.51.100.2" })));

    expect(status).toBe(504);
    expect(body).toEqual({ ok: false, error: "timeout" });
  });

  it("records one perfumer_message per answer, with the turn and entry and no text (#166)", async () => {
    analytics.ensureVisitor.mockResolvedValue({ anonymousId: "visitor-3", sessionId: "s-3" });
    const payload = { ...ask("Щось як La Vie Est Belle"), turn: 4, entry: "product" };
    const { body } = unwrap(await action(post(payload, { ip: "198.51.100.3" })));

    expect(analytics.trackEvent).toHaveBeenCalledTimes(1);
    const [, type, options] = analytics.trackEvent.mock.calls[0] ?? [];
    expect(type).toBe("perfumer_message");
    expect(options.properties).toMatchObject({
      reply_id: (body as { replyId: string }).replyId,
      turn: 4,
      entry: "product",
      model: "granite4.1:3b",
      error: null,
      asked_question: true,
    });
    const json = JSON.stringify(options);
    for (const text of ["La Vie", answer.intro, answer.question ?? ""]) {
      expect(json).not.toContain(text);
    }
  });
});

describe("perfumer feedback (#166)", () => {
  const REPLY = "6f9b3c2a-1d4e-4b8a-9c7d-2e5f8a1b3c4d";
  const rate = (fields: Record<string, string> = {}, ip = "198.51.100.20") =>
    postForm({ intent: "feedback", replyId: REPLY, turn: "2", rating: "up", ...fields }, { ip });

  it("records the rating as perfumer_feedback, without calling the model", async () => {
    const { status, body } = unwrap(await action(rate()));

    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(analytics.trackEvent).toHaveBeenCalledWith(expect.anything(), "perfumer_feedback", {
      properties: { reply_id: REPLY, turn: 2, rating: "up" },
    });
    expect(engine.replyWithTrace).not.toHaveBeenCalled();
  });

  it("refuses a bad rating with a 400 and records nothing", async () => {
    const { status, body } = unwrap(await action(rate({ rating: "meh" })));

    expect(status).toBe(400);
    expect(body).toEqual({ ok: false });
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });

  it("is a 404 while the perfumer is disabled", async () => {
    ai.isPerfumerEnabled.mockReturnValue(false);
    expect(await thrownStatus(() => action(rate()))).toBe(404);
  });

  it("limits ratings like the tracker's batches: 60 a minute", async () => {
    for (let n = 0; n < 60; n++) {
      expect(unwrap(await action(rate({}, "198.51.100.21"))).status).toBe(200);
    }
    expect(unwrap(await action(rate({}, "198.51.100.21"))).status).toBe(429);
  });
});
