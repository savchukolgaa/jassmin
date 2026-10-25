import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderStatus, PaymentMethod } from "~/lib/enums";
import { hasDatabase, type TestDatabase } from "../db/test-utils";
import { createSimulator, type SimulatorOutcome } from "../payments/simulator";

const SECRET = "s".repeat(32);
const ORIGIN = "http://localhost:5173";

const sampleOrder = {
  guestFullName: "Олена Коваль",
  guestEmail: "olena@example.com",
  guestPhone: "+380671234567",
  shippingAddress: "Київ, Відділення №12",
  subtotal: "2450.00",
  totalAmount: "2450.00",
} as const;

beforeAll(() => {
  // `services/payments` imports the app's db, which validates the env on import.
  vi.stubEnv("SESSION_SECRET", SECRET);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("isPayable", () => {
  it("only lets a pending, unpaid card order start a payment", async () => {
    const { isPayable } = await import("./payments");
    const order = { paymentMethod: "card", paymentStatus: "unpaid", status: "pending" };
    expect(isPayable(order)).toBe(true);
    expect(isPayable({ ...order, paymentMethod: "cod" })).toBe(false);
    expect(isPayable({ ...order, paymentStatus: "paid" })).toBe(false);
    expect(isPayable({ ...order, status: "cancelled" })).toBe(false);
  });
});

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("payments service", () => {
  let testDb: TestDatabase;
  const simulator = createSimulator(SECRET);
  const deps = () => ({ db: testDb.db, provider: simulator });

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_payments_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { orders } = await import("../db/schema");
    await testDb.db.delete(orders);
  });

  async function order(
    values: { paymentMethod?: PaymentMethod; status?: OrderStatus } = {},
  ): Promise<number> {
    const { orders } = await import("../db/schema");
    const [row] = await testDb.db
      .insert(orders)
      .values({ ...sampleOrder, paymentMethod: "card", ...values })
      .returning({ id: orders.id });
    if (!row) throw new Error("no order");
    return row.id;
  }

  async function orderRow(orderId: number) {
    const { eq } = await import("drizzle-orm");
    const { orders } = await import("../db/schema");
    const [row] = await testDb.db.select().from(orders).where(eq(orders.id, orderId));
    return row;
  }

  async function paymentRows(orderId: number) {
    const { asc, eq } = await import("drizzle-orm");
    const { payments } = await import("../db/schema");
    return testDb.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .orderBy(asc(payments.id));
  }

  /** Starts an attempt and returns the simulator's checkout for it. */
  async function start(orderId: number) {
    const { startPayment } = await import("./payments");
    const result = await startPayment({ orderId, locale: "uk", origin: ORIGIN }, deps());
    if (!result.ok) throw new Error(result.error);
    const url = new URL(result.redirectUrl);
    const checkout = simulator.verifyCheckout(
      url.searchParams.get("data") ?? "",
      url.searchParams.get("signature") ?? "",
    );
    if (!checkout) throw new Error("checkout should verify");
    return checkout;
  }

  function callbackForm(fields: { data: string; signature: string }): FormData {
    const form = new FormData();
    form.set("data", fields.data);
    form.set("signature", fields.signature);
    return form;
  }

  async function callback(checkout: Awaited<ReturnType<typeof start>>, outcome: SimulatorOutcome) {
    const { handlePaymentCallback } = await import("./payments");
    return handlePaymentCallback(callbackForm(simulator.buildCallback(checkout, outcome)), deps());
  }

  describe("startPayment", () => {
    it("charges the stored total and numbers the attempts", async () => {
      const orderId = await order();

      const first = await start(orderId);
      expect(first).toMatchObject({
        reference: `${orderId}-1`,
        amount: "2450.00",
        currency: "UAH",
        description: `Замовлення №${orderId} в Jassmin`,
        result_url: `${ORIGIN}/checkout/success/${orderId}`,
        callback_url: `${ORIGIN}/payments/callback`,
        locale: "uk",
      });
      const second = await start(orderId);
      expect(second.reference).toBe(`${orderId}-2`);

      expect(await paymentRows(orderId)).toMatchObject([
        { reference: `${orderId}-1`, provider: "simulator", status: "pending", amount: "2450.00" },
        { reference: `${orderId}-2`, status: "pending" },
      ]);
    });

    it("refuses cash-on-delivery, paid, cancelled and missing orders", async () => {
      const { startPayment } = await import("./payments");
      const input = (orderId: number) => ({ orderId, locale: "uk" as const, origin: ORIGIN });
      const cod = await order({ paymentMethod: "cod" });
      const cancelled = await order({ status: "cancelled" });
      const paid = await order();
      await callback(await start(paid), "success");

      for (const orderId of [cod, cancelled, paid]) {
        expect(await startPayment(input(orderId), deps())).toEqual({
          ok: false,
          error: "not-payable",
        });
      }
      expect(await startPayment(input(999_999), deps())).toEqual({
        ok: false,
        error: "not-found",
      });
      expect(await paymentRows(cod)).toEqual([]);
    });

    it("only lets a viewer pay an order they may see", async () => {
      const { startPayment } = await import("./payments");
      const orderId = await order();
      const input = { orderId, locale: "uk" as const, origin: ORIGIN };

      expect(
        await startPayment({ ...input, viewer: { userId: null, orderIds: [orderId + 1] } }, deps()),
      ).toEqual({ ok: false, error: "not-found" });
      expect(await paymentRows(orderId)).toEqual([]);

      const result = await startPayment(
        { ...input, viewer: { userId: null, orderIds: [orderId] } },
        deps(),
      );
      expect(result).toMatchObject({ ok: true, reference: `${orderId}-1` });
    });

    it("is unavailable without a provider", async () => {
      const { startPayment } = await import("./payments");
      const orderId = await order();
      expect(
        await startPayment(
          { orderId, locale: "uk", origin: ORIGIN },
          { db: testDb.db, provider: null },
        ),
      ).toEqual({ ok: false, error: "unavailable" });
    });
  });

  describe("handlePaymentCallback", () => {
    it("marks the order paid on a verified success", async () => {
      const orderId = await order();
      const checkout = await start(orderId);

      expect(await callback(checkout, "success")).toEqual({ ok: true, result: "paid" });

      const paid = await orderRow(orderId);
      expect(paid).toMatchObject({ paymentStatus: "paid", status: "paid" });
      expect(paid?.paidAt).toBeInstanceOf(Date);
      const [payment] = await paymentRows(orderId);
      expect(payment).toMatchObject({ status: "succeeded", lastCallback: { status: "success" } });
      expect(payment?.providerPaymentId).toMatch(/^sim_/);
      expect(payment?.completedAt).toBeInstanceOf(Date);
      // The paid order is queued for Strapi (#40).
      const { and, eq, isNull } = await import("drizzle-orm");
      const { cmsOutbox } = await import("../db/schema");
      const queued = await testDb.db
        .select({ id: cmsOutbox.id })
        .from(cmsOutbox)
        .where(
          and(
            eq(cmsOutbox.entity, "order"),
            eq(cmsOutbox.entityId, orderId),
            isNull(cmsOutbox.syncedAt),
          ),
        );
      expect(queued).toHaveLength(1);
    });

    it("doesn't change the order again on a repeated callback", async () => {
      const { handlePaymentCallback } = await import("./payments");
      const orderId = await order();
      const checkout = await start(orderId);
      const form = callbackForm(simulator.buildCallback(checkout, "success"));
      await handlePaymentCallback(form, deps());
      const first = await orderRow(orderId);

      expect(await handlePaymentCallback(form, deps())).toEqual({ ok: true, result: "ignored" });
      // A late failure for the same attempt doesn't undo it either.
      expect(await callback(checkout, "failure")).toEqual({ ok: true, result: "ignored" });
      expect(await paymentRows(orderId)).toMatchObject([{ status: "succeeded" }]);
      const again = await orderRow(orderId);
      expect(again?.paidAt).toEqual(first?.paidAt);
      expect(again?.updatedAt).toEqual(first?.updatedAt);
    });

    it("rejects an invalid signature and changes nothing", async () => {
      const { handlePaymentCallback } = await import("./payments");
      const orderId = await order();
      const { data } = simulator.buildCallback(await start(orderId), "success");

      expect(
        await handlePaymentCallback(callbackForm({ data, signature: "forged" }), deps()),
      ).toEqual({ ok: false, error: "invalid-signature" });
      expect(await orderRow(orderId)).toMatchObject({ paymentStatus: "unpaid", paidAt: null });
      expect(await paymentRows(orderId)).toMatchObject([{ status: "pending" }]);
    });

    it("leaves the order unpaid on a failure and lets a retry succeed", async () => {
      const orderId = await order();

      expect(await callback(await start(orderId), "failure")).toEqual({
        ok: true,
        result: "failed",
      });
      expect(await orderRow(orderId)).toMatchObject({
        paymentStatus: "unpaid",
        status: "pending",
        paidAt: null,
      });

      expect(await callback(await start(orderId), "success")).toEqual({ ok: true, result: "paid" });
      expect(await paymentRows(orderId)).toMatchObject([
        { status: "failed" },
        { status: "succeeded" },
      ]);
    });

    it("ignores a callback whose amount differs from the attempt", async () => {
      const { eq } = await import("drizzle-orm");
      const { payments } = await import("../db/schema");
      const orderId = await order();
      const checkout = await start(orderId);
      // As if the attempt had been for another amount than the callback reports.
      await testDb.db
        .update(payments)
        .set({ amount: "9999.00" })
        .where(eq(payments.orderId, orderId));

      expect(await callback(checkout, "success")).toEqual({ ok: true, result: "ignored" });
      expect(await orderRow(orderId)).toMatchObject({ paymentStatus: "unpaid" });
    });

    it("ignores an unknown reference", async () => {
      const orderId = await order();
      const checkout = await start(orderId);
      expect(await callback({ ...checkout, reference: "999999-1" }, "success")).toEqual({
        ok: true,
        result: "ignored",
      });
      expect(await orderRow(orderId)).toMatchObject({ paymentStatus: "unpaid" });
    });

    it("records a success for an order cancelled meanwhile without touching the order", async () => {
      const { eq } = await import("drizzle-orm");
      const { orders } = await import("../db/schema");
      const orderId = await order();
      const checkout = await start(orderId);
      await testDb.db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, orderId));

      expect(await callback(checkout, "success")).toEqual({ ok: true, result: "ignored" });
      expect(await orderRow(orderId)).toMatchObject({
        status: "cancelled",
        paymentStatus: "unpaid",
      });
      expect(await paymentRows(orderId)).toMatchObject([{ status: "succeeded" }]);
    });
  });

  describe("getPaymentView", () => {
    it("follows the order and its latest attempt", async () => {
      const { getPaymentView } = await import("./payments");
      const orderId = await order();
      expect(await getPaymentView(orderId, testDb.db)).toBe("pending");

      await callback(await start(orderId), "failure");
      expect(await getPaymentView(orderId, testDb.db)).toBe("failed");

      const retry = await start(orderId);
      expect(await getPaymentView(orderId, testDb.db)).toBe("pending");

      await callback(retry, "success");
      expect(await getPaymentView(orderId, testDb.db)).toBe("paid");
    });

    it("is null for cash-on-delivery and cancelled orders", async () => {
      const { getPaymentView } = await import("./payments");
      expect(await getPaymentView(await order({ paymentMethod: "cod" }), testDb.db)).toBeNull();
      expect(await getPaymentView(await order({ status: "cancelled" }), testDb.db)).toBeNull();
    });
  });
});
