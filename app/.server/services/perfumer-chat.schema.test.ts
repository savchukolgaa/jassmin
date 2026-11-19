import { describe, expect, it } from "vitest";
import { parseStoredPerfumerReply } from "./perfumer-chat.schema";

const PRODUCT = "01a1652b-6e25-7c03-ae47-25b57131fb06";
const REPLY_ID = "6f9b3c2a-1d4e-4b8a-9c7d-2e5f8a1b3c4d";

describe("parseStoredPerfumerReply (#180)", () => {
  it("accepts a saved answer: product ids with reasons, the question, the id, turn and rating", () => {
    const reply = {
      picks: [{ productId: PRODUCT, reason: "Свіжий і легкий." }],
      question: "Вам ближчі тихі аромати?",
      replyId: REPLY_ID,
      turn: 2,
      rating: "up",
    };
    expect(parseStoredPerfumerReply(reply)).toEqual(reply);
    expect(parseStoredPerfumerReply({ picks: [], replyId: REPLY_ID, turn: 1 })).toEqual({
      picks: [],
      replyId: REPLY_ID,
      turn: 1,
    });
  });

  it.each([
    ["not an object", "reply"],
    [
      "product data instead of an id",
      { picks: [{ product: {}, reason: "" }], replyId: REPLY_ID, turn: 1 },
    ],
    [
      "a product id that isn't a UUID",
      { picks: [{ productId: "p1", reason: "" }], replyId: REPLY_ID, turn: 1 },
    ],
    [
      "more than 4 picks",
      { picks: Array(5).fill({ productId: PRODUCT, reason: "" }), replyId: REPLY_ID, turn: 1 },
    ],
    ["no reply id", { picks: [], turn: 1 }],
    ["turn 0", { picks: [], replyId: REPLY_ID, turn: 0 }],
    ["an unknown rating", { picks: [], replyId: REPLY_ID, turn: 1, rating: "meh" }],
  ])("refuses %s", (_name, value) => {
    expect(parseStoredPerfumerReply(value)).toBeNull();
  });
});
