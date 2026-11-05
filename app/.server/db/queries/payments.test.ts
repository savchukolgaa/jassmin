import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasDatabase, pgErrorCode, type TestDatabase } from "../test-utils";

const sampleOrder = {
  guestFullName: "Test Buyer",
  guestEmail: "buyer@example.com",
  guestPhone: "+380501234567",
  shippingAddress: "Kyiv, Nova Poshta branch 1",
  paymentMethod: "card",
  subtotal: "2450.00",
  totalAmount: "2450.00",
} as const;

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("payment queries", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    const { createTestDatabase } = await import("../test-utils");
    const { migrateLatest } = await import("../migrator");
    testDb = await createTestDatabase("jassmin_payments_queries_test");
    await migrateLatest(testDb.db);
  }, 30_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { orders } = await import("../schema");
    // Cascades to payments.
    await testDb.db.delete(orders);
  });

  async function order(values: Partial<{ status: "pending" | "cancelled" }> = {}) {
    const { orders } = await import("../schema");
    const [row] = await testDb.db
      .insert(orders)
      .values({ ...sampleOrder, ...values })
      .returning();
    if (!row) throw new Error("no order");
    return row;
  }

  async function attempt(orderId: number, reference: string) {
    const { insertPayment } = await import("./payments");
    return insertPayment(testDb.db, {
      orderId,
      provider: "simulator",
      reference,
      amount: "2450.00",
      currency: "UAH",
    });
  }

  it("counts attempts and finds the latest attempt's status", async () => {
    const { countPayments, findLatestPaymentStatus, markPayment } = await import("./payments");
    const { id } = await order();
    expect(await countPayments(testDb.db, { orderId: id })).toBe(0);
    expect(await findLatestPaymentStatus(testDb.db, { orderId: id })).toBeUndefined();

    const first = await attempt(id, `${id}-1`);
    await markPayment(testDb.db, first, {
      status: "failed",
      providerPaymentId: "sim_1",
      lastCallback: { status: "failure" },
    });
    expect(await findLatestPaymentStatus(testDb.db, { orderId: id })).toBe("failed");

    await attempt(id, `${id}-2`);
    expect(await countPayments(testDb.db, { orderId: id })).toBe(2);
    expect(await findLatestPaymentStatus(testDb.db, { orderId: id })).toBe("pending");
  });

  it("keeps references unique", async () => {
    const { id } = await order();
    await attempt(id, `${id}-1`);
    expect(await pgErrorCode(attempt(id, `${id}-1`))).toBe("23505");
  });

  it("records a callback and completes the attempt once it leaves pending", async () => {
    const { lockPaymentByReference, markPayment } = await import("./payments");
    const { id } = await order();
    const paymentId = await attempt(id, `${id}-1`);

    await markPayment(testDb.db, paymentId, {
      status: "pending",
      providerPaymentId: null,
      lastCallback: { status: "processing" },
    });
    expect(await lockPaymentByReference(testDb.db, `${id}-1`)).toMatchObject({
      status: "pending",
      lastCallback: { status: "processing" },
      completedAt: null,
    });

    await markPayment(testDb.db, paymentId, {
      status: "succeeded",
      providerPaymentId: "sim_1",
      lastCallback: { status: "success" },
    });
    const done = await lockPaymentByReference(testDb.db, `${id}-1`);
    expect(done).toMatchObject({ status: "succeeded", providerPaymentId: "sim_1" });
    expect(done?.completedAt).toBeInstanceOf(Date);
    expect(await lockPaymentByReference(testDb.db, "missing")).toBeUndefined();
  });

  it("marks a pending unpaid order paid exactly once", async () => {
    const { findPayableOrder, markOrderPaid } = await import("./payments");
    const { id } = await order();

    expect(await markOrderPaid(testDb.db, id)).toBe(true);
    const paid = await findPayableOrder(testDb.db, id);
    expect(paid).toMatchObject({ paymentStatus: "paid", status: "paid" });

    expect(await markOrderPaid(testDb.db, id)).toBe(false);
  });

  it("doesn't mark an order paid once it is no longer pending", async () => {
    const { findPayableOrder, markOrderPaid } = await import("./payments");
    const { id } = await order({ status: "cancelled" });

    expect(await markOrderPaid(testDb.db, id)).toBe(false);
    expect(await findPayableOrder(testDb.db, id, { lock: true })).toMatchObject({
      paymentStatus: "unpaid",
      status: "cancelled",
      totalAmount: "2450.00",
      currency: "UAH",
    });
  });
});
