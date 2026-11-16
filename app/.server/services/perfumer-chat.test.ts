import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PerfumerReply } from "~/lib/perfumer";
import { AiError } from "../ai/errors";
import { createMemoryRateLimitStore, createRateLimiter } from "../rate-limit";
import { answerPerfumerMessage, type PerfumerChatDeps } from "./perfumer-chat";

const answer: PerfumerReply = { intro: "Ось що є.", picks: [] };
const messages = [{ role: "user" as const, content: "Щось свіже" }];

let now = 0;
let deps: PerfumerChatDeps & { reply: ReturnType<typeof vi.fn<PerfumerChatDeps["reply"]>> };

function limiter(name: string) {
  return createRateLimiter({
    name,
    limit: 10,
    windowMs: 5 * 60_000,
    store: createMemoryRateLimitStore(),
    now: () => now,
  });
}

beforeEach(() => {
  now = Date.parse("2026-11-16T12:00:00Z");
  deps = {
    reply: vi.fn<PerfumerChatDeps["reply"]>(async () => answer),
    limiters: { byIp: limiter("ip"), bySession: limiter("session") },
  };
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const ask = (ipKey: string | undefined, sessionKey: string | undefined, signal?: AbortSignal) =>
  answerPerfumerMessage({ locale: "uk", messages, ipKey, sessionKey, signal }, deps);

describe("answerPerfumerMessage", () => {
  it("returns the engine's reply in the page's language", async () => {
    await expect(ask("1.1.1.1", "visitor")).resolves.toEqual({ ok: true, reply: answer });
    expect(deps.reply).toHaveBeenCalledWith("uk", messages, {});
  });

  it("passes the request's signal to the engine", async () => {
    const signal = new AbortController().signal;
    await ask("1.1.1.1", "visitor", signal);
    expect(deps.reply).toHaveBeenCalledWith("uk", messages, { signal });
  });

  it("allows 10 messages per IP in 5 minutes, then refuses without calling the model", async () => {
    for (let n = 0; n < 10; n++) {
      expect((await ask("1.1.1.1", `visitor-${n}`)).ok).toBe(true);
    }
    await expect(ask("1.1.1.1", "another")).resolves.toEqual({ ok: false, error: "rateLimited" });
    expect(deps.reply).toHaveBeenCalledTimes(10);
    // Another IP is unaffected.
    expect((await ask("2.2.2.2", "another")).ok).toBe(true);
  });

  it("allows 10 messages per visitor, whatever their IP", async () => {
    for (let n = 0; n < 10; n++) {
      await ask(`10.0.0.${n}`, "visitor");
    }
    await expect(ask("10.0.0.99", "visitor")).resolves.toEqual({
      ok: false,
      error: "rateLimited",
    });
  });

  it("counts failed answers too, and lets the customer go on after 5 minutes", async () => {
    deps.reply.mockRejectedValue(new AiError("timeout", "slow"));
    for (let n = 0; n < 10; n++) {
      await ask("1.1.1.1", "visitor");
    }
    expect((await ask("1.1.1.1", "visitor")).ok).toBe(false);
    expect(deps.reply).toHaveBeenCalledTimes(10);

    now += 5 * 60_000;
    deps.reply.mockResolvedValue(answer);
    await expect(ask("1.1.1.1", "visitor")).resolves.toEqual({ ok: true, reply: answer });
  });

  it("limits a request without an IP by its visitor", async () => {
    for (let n = 0; n < 10; n++) {
      await ask(undefined, "visitor");
    }
    expect(await ask(undefined, "visitor")).toEqual({ ok: false, error: "rateLimited" });
  });

  it.each([
    ["timeout", "timeout"],
    ["unavailable", "unavailable"],
    ["bad_response", "unavailable"],
  ] as const)("maps the engine's %s error to %s", async (kind, error) => {
    deps.reply.mockRejectedValue(new AiError(kind, "failed"));
    await expect(ask("1.1.1.1", "visitor")).resolves.toEqual({ ok: false, error });
  });

  it("maps an unexpected error to unavailable and logs it", async () => {
    deps.reply.mockRejectedValue(new Error("database down"));
    await expect(ask("1.1.1.1", "visitor")).resolves.toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(console.error).toHaveBeenCalled();
  });
});
