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
      emailsQueued: false,
    }),
  ),
);

const pushToCms = vi.hoisted(() => vi.fn());
const deliverOrderStatusEmails = vi.hoisted(() => vi.fn());

vi.mock("~/.server/services/cms-sync", () => ({ applyCmsOrderChange, pushToCms }));
vi.mock("~/.server/services/orders", () => ({ deliverOrderStatusEmails }));
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
    deliverOrderStatusEmails.mockClear();
  });

  it("sends the order status emails a change queued, after the commit (#138)", async () => {
    const { action } = await import("./cms.orders.$id");

    applyCmsOrderChange.mockResolvedValueOnce({ ok: true, order, emailsQueued: true });
    const response = await action(
      post("7", JSON.stringify({ status: "shipped", waybillNumber: "2045 0000 0000 01" })),
    );

    expect(response.status).toBe(200);
    // Strapi gets the order only, not the email flag.
    expect(await response.json()).toEqual(order);
    expect(applyCmsOrderChange).toHaveBeenCalledWith(7, {
      status: "shipped",
      waybillNumber: "20450000000001",
    });
    expect(deliverOrderStatusEmails).toHaveBeenCalledWith(7);
  });

  it("answers 422 for a waybill number that isn't 14 digits (#138)", async () => {
    const { action } = await import("./cms.orders.$id");

    const response = await action(post("7", JSON.stringify({ waybillNumber: "12345" })));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "invalid-input",
      issues: [{ path: "waybillNumber" }],
    });
    expect(applyCmsOrderChange).not.toHaveBeenCalled();
  });

  it("applies a status change and answers with the stored order", async () => {
    const { action } = await import("./cms.orders.$id");

    const response = await action(post("7", JSON.stringify({ status: "shipped" })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(order);
    expect(applyCmsOrderChange).toHaveBeenCalledWith(7, { status: "shipped" });
    expect(pushToCms).toHaveBeenCalledOnce();
    // Nothing was queued, so nothing to send.
    expect(deliverOrderStatusEmails).not.toHaveBeenCalled();
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
});
