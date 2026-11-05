import { redirect } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUser: vi.fn() }));
const orders = vi.hoisted(() => ({ getAccountOrders: vi.fn() }));
const giftCards = vi.hoisted(() => ({ getAccountGiftCards: vi.fn() }));

vi.mock("~/.server/services/auth", () => auth);
vi.mock("~/.server/services/orders", () => orders);
vi.mock("~/.server/services/gift-cards", () => giftCards);
const verification = vi.hoisted(() => ({ sendVerificationEmail: vi.fn() }));
vi.mock("~/.server/services/email-verification", () => verification);
vi.mock("~/.server/env", () => ({
  getEnv: () => ({}),
  getSiteUrl: () => "https://jassmin.ua",
}));

type LoaderArgs = Parameters<typeof import("./account._index").loader>[0];

const load = async () => {
  const { loader } = await import("./account._index");
  const request = new Request("http://localhost/account");
  return loader({ request, params: {}, context: {} } as unknown as LoaderArgs);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("account dashboard loader", () => {
  it("loads the logged-in user's orders and the gift cards they bought (#125)", async () => {
    const result = { current: [], previous: [] };
    const cards = [{ id: 12, status: "active" }];
    auth.requireUser.mockResolvedValueOnce({
      id: 3,
      fullName: "Олена Коваль",
      email: "o@e.com",
      emailVerified: false,
    });
    orders.getAccountOrders.mockResolvedValueOnce(result);
    giftCards.getAccountGiftCards.mockResolvedValueOnce(cards);

    expect(await load()).toEqual({
      ...result,
      giftCards: cards,
      email: "o@e.com",
      emailVerified: false,
    });
    expect(orders.getAccountOrders).toHaveBeenCalledWith(3);
    expect(giftCards.getAccountGiftCards).toHaveBeenCalledWith(3);
  });

  it("redirects logged-out visitors to login without loading orders", async () => {
    auth.requireUser.mockRejectedValueOnce(redirect("/login?redirectTo=%2Faccount"));

    await expect(load()).rejects.toMatchObject({ status: 302 });
    expect(orders.getAccountOrders).not.toHaveBeenCalled();
    expect(giftCards.getAccountGiftCards).not.toHaveBeenCalled();
  });
});

describe("resending the verification email (#135)", () => {
  type ActionArgs = Parameters<typeof import("./account._index").action>[0];
  const unverified = { id: 41, fullName: "Олена", email: "o@e.com", emailVerified: false };

  async function resend(fields: Record<string, string> = { intent: "resend-verification" }) {
    const { action } = await import("./account._index");
    const request = new Request("http://localhost/en/account?index", {
      method: "POST",
      body: new URLSearchParams(fields),
    });
    const result = await action({ request, params: {}, context: {} } as unknown as ActionArgs);
    const { data, init } = result as unknown as { data: unknown; init?: { status?: number } };
    return { status: init?.status ?? 200, body: data };
  }

  beforeEach(async () => {
    const { verificationEmailLimiter } = await import("~/.server/rate-limit");
    verificationEmailLimiter.reset(String(unverified.id));
    auth.requireUser.mockResolvedValue(unverified);
  });

  it("sends the link again in the page's language", async () => {
    expect(await resend()).toEqual({ status: 200, body: { resent: true } });
    expect(verification.sendVerificationEmail).toHaveBeenCalledWith({
      userId: 41,
      locale: "en",
      siteUrl: "https://jassmin.ua",
    });
  });

  it("allows 3 per hour", async () => {
    for (let i = 0; i < 3; i++) expect((await resend()).status).toBe(200);
    expect(await resend()).toEqual({
      status: 429,
      body: { error: "auth.errors.tooManyRequests" },
    });
    expect(verification.sendVerificationEmail).toHaveBeenCalledTimes(3);
  });

  it("sends nothing for a confirmed email or an unknown intent", async () => {
    auth.requireUser.mockResolvedValue({ ...unverified, emailVerified: true });
    expect((await resend()).status).toBe(200);
    expect(await resend({ intent: "other" })).toEqual({
      status: 400,
      body: { error: "errors.invalid" },
    });
    expect(verification.sendVerificationEmail).not.toHaveBeenCalled();
  });
});

describe("account layout", () => {
  it("isn't indexed or cached", async () => {
    const { headers, meta } = await import("./account");
    type MetaArgs = Parameters<typeof meta>[0];
    const matches = [{ id: "root", loaderData: { locale: "en" } }];

    expect(meta({ matches } as unknown as MetaArgs)).toEqual([
      { title: "My account — Jassmin" },
      { name: "robots", content: "noindex, follow" },
    ]);
    expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
  });

  it("greets the user by first name and redirects logged-out visitors", async () => {
    const { loader } = await import("./account");
    type AccountLoaderArgs = Parameters<typeof loader>[0];
    const args = {
      request: new Request("http://localhost/account"),
      params: {},
      context: {},
    } as unknown as AccountLoaderArgs;

    auth.requireUser.mockResolvedValueOnce({ id: 3, fullName: "Олена Коваль", email: "o@e.com" });
    expect(await loader(args)).toEqual({ firstName: "Олена", email: "o@e.com" });

    auth.requireUser.mockRejectedValueOnce(redirect("/login?redirectTo=%2Faccount"));
    await expect(loader(args)).rejects.toMatchObject({ status: 302 });
  });
});
