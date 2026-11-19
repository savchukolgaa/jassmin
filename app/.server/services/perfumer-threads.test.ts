import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { StoredPerfumerReply } from "~/lib/perfumer";
import { hasDatabase, type TestDatabase } from "../db/test-utils";

const REPLY_ID = "6f9b3c2a-1d4e-4b8a-9c7d-2e5f8a1b3c4d";

// Integration test: runs only when a database is configured, on its own throwaway database.
describe.skipIf(!hasDatabase)("saved AI perfumer chats (#180)", () => {
  let testDb: TestDatabase;
  let userId = 0;
  const guest = { userId: null, anonymousId: "anon-guest" };
  const customer = () => ({ userId, anonymousId: "anon-guest" });

  beforeAll(async () => {
    const { createTestDatabase } = await import("../db/test-utils");
    const { migrateLatest } = await import("../db/migrator");
    testDb = await createTestDatabase("jassmin_perfumer_threads_test");
    await migrateLatest(testDb.db);
  }, 60_000);

  afterAll(async () => {
    await testDb?.drop();
  });

  beforeEach(async () => {
    const { perfumerThreads, products, users } = await import("../db/schema");
    await testDb.db.delete(perfumerThreads);
    await testDb.db.delete(products);
    await testDb.db.delete(users);
    const [user] = await testDb.db
      .insert(users)
      .values({ fullName: "Olha", email: "olha@example.com", passwordHash: "hash" })
      .returning({ id: users.id });
    userId = user?.id ?? 0;
  });

  /** A listed product with one 30 ml size; returns its `public_id` and variant id. */
  async function product(title: string, price = "450.00") {
    const { products, productVariants } = await import("../db/schema");
    const [row] = await testDb.db
      .insert(products)
      .values({ title, brand: "House", gender: "women", price, volumeMl: 30 })
      .returning({ id: products.id, publicId: products.publicId });
    if (!row) throw new Error("no product");
    const [variant] = await testDb.db
      .insert(productVariants)
      .values({ productId: row.id, volumeMl: 30, price, stockQuantity: 5 })
      .returning({ id: productVariants.id });
    return { id: row.id, publicId: row.publicId, variantId: variant?.id ?? 0 };
  }

  async function threads() {
    return import("./perfumer-threads");
  }

  async function send(
    owner: { userId: number | null; anonymousId: string },
    message: string,
    options: { entry?: "direct" | "menu" | "catalog"; retry?: boolean } = {},
  ) {
    const { beginPerfumerTurn } = await threads();
    return beginPerfumerTurn(
      { owner, message, entry: options.entry ?? "direct", retry: options.retry ?? false },
      testDb.db,
    );
  }

  function answer(intro: string, picks: StoredPerfumerReply["picks"], turn = 1, question?: string) {
    return {
      intro,
      reply: { picks, replyId: REPLY_ID, turn, ...(question ? { question } : {}) },
    };
  }

  async function end(
    threadId: number,
    value: Parameters<typeof answer> | { errorKey: "timeout" | "cancelled" | "unavailable" },
  ) {
    const { endPerfumerTurn } = await threads();
    await endPerfumerTurn(threadId, Array.isArray(value) ? answer(...value) : value, testDb.db);
  }

  async function view(owner: { userId: number | null; anonymousId: string | null }) {
    const { getPerfumerThreadView } = await threads();
    return getPerfumerThreadView(owner, testDb.db);
  }

  it("creates the thread on the first message and appends the next ones to it", async () => {
    const first = await send(guest, "Щось свіже", { entry: "menu" });
    expect(first).toMatchObject({ turn: 1, entry: "menu" });
    expect(first.history).toEqual([{ role: "user", content: "Щось свіже" }]);

    await end(first.threadId, ["Ось свіжі аромати.", []]);
    const second = await send(guest, "А дешевше?");
    // A direct follow-up keeps the entry the conversation was opened with (#166).
    expect(second).toMatchObject({ threadId: first.threadId, turn: 2, entry: "menu" });
    expect(second.history).toEqual([
      { role: "user", content: "Щось свіже" },
      { role: "assistant", content: "Ось свіжі аромати." },
      { role: "user", content: "А дешевше?" },
    ]);
  });

  it("gives two first messages at once one thread", async () => {
    const [a, b] = await Promise.all([send(guest, "Один"), send(guest, "Два")]);
    expect(a.threadId).toBe(b.threadId);
    expect((await view(guest))?.items.map((item) => item.role)).toEqual(["user", "user"]);
  });

  it("builds the history from stored messages only: current names, no errors, the last 10", async () => {
    const { publicId } = await product("Ocean Two");
    const { products } = await import("../db/schema");
    let threadId = 0;
    for (let n = 1; n <= 7; n++) {
      ({ threadId } = await send(guest, `Питання ${n}`));
      await end(
        threadId,
        n % 2
          ? [`Відповідь ${n}`, [{ productId: publicId, reason: "Свіжий." }], n]
          : { errorKey: "timeout" },
      );
    }
    // The product was renamed since: the model reads today's name.
    await testDb.db
      .update(products)
      .set({ title: "Ocean Three" })
      .where(eq(products.publicId, publicId));
    const { history } = await send(guest, "Останнє");
    expect(history).toHaveLength(10);
    expect(history.at(-1)).toEqual({ role: "user", content: "Останнє" });
    expect(history.at(-2)).toEqual({
      role: "assistant",
      content: "Відповідь 7\n- Ocean Three (House)",
    });
    expect(history.some((message) => message.content.includes("timeout"))).toBe(false);
  });

  it("answers the stored message again on a retry, without a copy or the error", async () => {
    const { threadId } = await send(guest, "Щось тепле");
    await end(threadId, { errorKey: "timeout" });
    const again = await send(guest, "Щось тепле", { retry: true });
    expect(again.turn).toBe(1);
    expect((await view(guest))?.items).toEqual([
      expect.objectContaining({ role: "user", text: "Щось тепле" }),
    ]);

    // After a broken stream: the message saved, its end not (yet), or a cancel marker.
    expect((await send(guest, "Щось тепле", { retry: true })).turn).toBe(1);
    await end(threadId, { errorKey: "cancelled" });
    expect((await send(guest, "Щось тепле", { retry: true })).turn).toBe(1);
    expect((await view(guest))?.items).toHaveLength(1);

    // A retry of another message is an ordinary message.
    await end(threadId, ["Ось теплі.", []]);
    expect((await send(guest, "Ще раз", { retry: true })).turn).toBe(2);
  });

  it("shows saved answers with current prices, without archived products, and the errors", async () => {
    const { products, productVariants } = await import("../db/schema");
    const kept = await product("Ocean Two", "450.00");
    const archived = await product("Old Rose");
    const { threadId } = await send(guest, "Щось свіже");
    await end(threadId, [
      "Ось що є.",
      [
        { productId: kept.publicId, reason: "Свіжий." },
        { productId: archived.publicId, reason: "Трояндовий." },
      ],
      1,
      "Вам ближчі тихі аромати?",
    ]);
    await send(guest, "Тихіші");
    await end(threadId, { errorKey: "timeout" });
    await send(guest, "Ще");
    await end(threadId, { errorKey: "cancelled" });

    await testDb.db
      .update(productVariants)
      .set({ price: "399.00" })
      .where(eq(productVariants.id, kept.variantId));
    await testDb.db.update(products).set({ active: false }).where(eq(products.id, archived.id));

    const saved = await view(guest);
    expect(saved?.entry).toBe("direct");
    expect(saved?.items.map((item) => item.role)).toEqual([
      "user",
      "perfumer",
      "user",
      "error",
      "user",
      "cancelled",
    ]);
    const reply = saved?.items[1];
    if (reply?.role !== "perfumer") throw new Error("no answer");
    expect(reply).toMatchObject({ replyId: REPLY_ID, turn: 1 });
    expect(reply.reply.intro).toBe("Ось що є.");
    expect(reply.reply.question).toBe("Вам ближчі тихі аромати?");
    expect(reply.reply.picks.map((pick) => pick.product.title)).toEqual(["Ocean Two"]);
    expect(reply.reply.picks[0]?.product.minPrice).toBe("399.00");
    expect(saved?.items[3]).toMatchObject({ role: "error", error: "timeout", retryText: "Тихіші" });
  });

  it("keeps the rating on the saved answer, only for its owner", async () => {
    const { ratePerfumerReply } = await threads();
    const { threadId } = await send(guest, "Щось свіже");
    await end(threadId, ["Ось що є.", []]);
    expect(
      await ratePerfumerReply({ userId: null, anonymousId: "someone" }, REPLY_ID, "up", testDb.db),
    ).toBe(false);
    expect(await ratePerfumerReply(guest, REPLY_ID, "down", testDb.db)).toBe(true);
    expect((await view(guest))?.items[1]).toMatchObject({ rating: "down" });
  });

  it("keeps a customer's and a logged-out browser's chats apart", async () => {
    await send(customer(), "Для акаунта");
    expect(await view(guest)).toBeNull();
    expect(await view({ userId, anonymousId: "another-device" })).toMatchObject({
      items: [expect.objectContaining({ text: "Для акаунта" })],
    });
    await send(guest, "Як гість");
    expect((await view(guest))?.items).toEqual([expect.objectContaining({ text: "Як гість" })]);
    expect(await view({ userId: null, anonymousId: null })).toBeNull();
  });

  it("starts a new chat: the old thread is closed, the next message opens another", async () => {
    const { startNewPerfumerChat } = await threads();
    const { threadId } = await send(guest, "Перша розмова");
    expect(await startNewPerfumerChat(guest, testDb.db)).toBe(true);
    expect(await view(guest)).toBeNull();
    const next = await send(guest, "Друга розмова");
    expect(next.threadId).not.toBe(threadId);
    expect(next.turn).toBe(1);
  });

  it("deletes a chat for the customer but keeps its rows until the retention job", async () => {
    const { deletePerfumerChat } = await threads();
    const { perfumerMessages, perfumerThreads } = await import("../db/schema");
    const { threadId } = await send(guest, "Приватне питання");
    expect(await deletePerfumerChat(guest, testDb.db)).toBe(true);
    expect(await view(guest)).toBeNull();

    const [thread] = await testDb.db
      .select()
      .from(perfumerThreads)
      .where(eq(perfumerThreads.id, threadId));
    expect(thread?.deletedAt).toBeInstanceOf(Date);
    expect(thread?.closedAt).toBeInstanceOf(Date);
    expect(
      await testDb.db
        .select()
        .from(perfumerMessages)
        .where(eq(perfumerMessages.threadId, threadId)),
    ).toHaveLength(1);

    // An answer that arrives after the delete isn't saved, and the next message starts afresh.
    await end(threadId, ["Пізно.", []]);
    expect(
      await testDb.db
        .select()
        .from(perfumerMessages)
        .where(eq(perfumerMessages.threadId, threadId)),
    ).toHaveLength(1);
    expect((await send(guest, "Нова")).threadId).not.toBe(threadId);
  });

  describe("at login", () => {
    async function merge() {
      const { mergeGuestPerfumerThread } = await threads();
      await mergeGuestPerfumerThread(userId, guest.anonymousId, testDb.db);
    }

    async function age(threadId: number, minutes: number) {
      const { perfumerThreads } = await import("../db/schema");
      await testDb.db
        .update(perfumerThreads)
        .set({ updatedAt: new Date(Date.now() - minutes * 60_000) })
        .where(eq(perfumerThreads.id, threadId));
    }

    it("gives the guest's chat to the account", async () => {
      await send(guest, "Як гість");
      await merge();
      expect(await view(guest)).toBeNull();
      expect((await view({ userId, anonymousId: "phone" }))?.items).toEqual([
        expect.objectContaining({ text: "Як гість" }),
      ]);
    });

    it("keeps the more recent chat when the account already has one", async () => {
      const own = await send({ userId, anonymousId: "laptop" }, "Старіша, з акаунта");
      await age(own.threadId, 60);
      await send(guest, "Новіша, як гість");
      await merge();
      expect((await view(customer()))?.items).toEqual([
        expect.objectContaining({ text: "Новіша, як гість" }),
      ]);

      // The other way round: the account's chat is newer and stays.
      await send(guest, "Знову гість");
      const guestThread = await send(guest, "…");
      await age(guestThread.threadId, 120);
      await merge();
      expect((await view(customer()))?.items).toEqual([
        expect.objectContaining({ text: "Новіша, як гість" }),
      ]);
      expect(await view(guest)).toBeNull();
    });

    it("does nothing without a guest chat", async () => {
      await send(customer(), "З акаунта");
      await merge();
      expect((await view(customer()))?.items).toHaveLength(1);
    });
  });
});
