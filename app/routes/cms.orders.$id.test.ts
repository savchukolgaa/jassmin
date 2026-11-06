import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CmsOrderResult } from "~/.server/services/cms-sync";
import type { CmsOrderChange, CmsOrderState } from "~/lib/cms-sync";

const SECRET = "s".repeat(32);

const order = { orderId: 7, status: "shipped" } as CmsOrderState;

const applyCmsOrderChange = vi.hoisted(() =>
  vi.fn(
    async (_orderId: number, _change: CmsOrderChange): Promise<CmsOrderResult> => ({
      ok: true,
      order,
    }),
  ),
);

const pushToCms = vi.hoisted(() => vi.fn());

vi.mock("~/.server/services/cms-sync", () => ({ applyCmsOrderChange, pushToCms }));
vi.mock("~/.server/env", () => ({ getEnv: () => ({ CMS_SYNC_SECRET: SECRET }) }));

type ActionArgs = Parameters<typeof import("./cms.orders.$id").action>[0];

function post(id: string, body: string, secret = SECRET): ActionArgs {
  const request = new Request(`http://localhost/cms/orders/${id}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body,
  });
  return { request, params: { id }, context: {} } as unknown as ActionArgs;
}

describe("cms orders sync route", () => {
  beforeEach(() => {
    applyCmsOrderChange.mockClear();
    pushToCms.mockClear();
  });

  it("applies a status change and answers with the stored order", async () => {
    const { action } = await import("./cms.orders.$id");

    const response = await action(post("7", JSON.stringify({ status: "shipped" })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(order);
    expect(applyCmsOrderChange).toHaveBeenCalledWith(7, { status: "shipped" });
    expect(pushToCms).toHaveBeenCalledOnce();
  });

  it("rejects a wrong secret", async () => {
    const { action } = await import("./cms.orders.$id");

    const response = await action(post("7", JSON.stringify({ status: "shipped" }), "x"));

    expect(response.status).toBe(401);
    expect(applyCmsOrderChange).not.toHaveBeenCalled();
  });

  it("answers 404 for an id that can't be an order and for an unknown order", async () => {
    const { action } = await import("./cms.orders.$id");

    expect((await action(post("abc", "{}"))).status).toBe(404);
    applyCmsOrderChange.mockResolvedValueOnce({ ok: false, error: "unknown-order" });
    expect((await action(post("8", "{}"))).status).toBe(404);
  });

  it("answers 400 for a body that isn't JSON and 422 for an unknown status", async () => {
    const { action } = await import("./cms.orders.$id");

    expect((await action(post("7", "nope"))).status).toBe(400);
    const response = await action(post("7", JSON.stringify({ status: "delivered" })));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "invalid-input" });
  });

  it("answers 422 with a refused transition", async () => {
    applyCmsOrderChange.mockResolvedValueOnce({
      ok: false,
      error: "invalid-transition",
      from: "cancelled",
      to: "shipped",
    });
    const { action } = await import("./cms.orders.$id");

    const response = await action(post("7", JSON.stringify({ status: "shipped" })));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "invalid-transition",
      from: "cancelled",
      to: "shipped",
    });
  });

  it("passes the cancel reason on and refuses an unknown one (#128)", async () => {
    const { action } = await import("./cms.orders.$id");

    await action(post("7", JSON.stringify({ status: "cancelled", cancelReason: "no_answer" })));
    expect(applyCmsOrderChange).toHaveBeenCalledWith(7, {
      status: "cancelled",
      cancelReason: "no_answer",
    });

    const unknown = await action(
      post("7", JSON.stringify({ status: "cancelled", cancelReason: "bored" })),
    );
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ error: "invalid-input" });
  });

  it("answers 422 when a cancellation has no reason (#128)", async () => {
    applyCmsOrderChange.mockResolvedValueOnce({
      ok: false,
      error: "cancel-reason-required",
      from: "pending",
      to: "cancelled",
    });
    const { action } = await import("./cms.orders.$id");

    const response = await action(post("7", JSON.stringify({ status: "cancelled" })));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "cancel-reason-required",
      from: "pending",
      to: "cancelled",
    });
  });
});
