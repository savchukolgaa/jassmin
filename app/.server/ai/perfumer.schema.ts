import { z } from "zod";
import { PERFUMER_MAX_MESSAGE_LENGTH, PERFUMER_MAX_MESSAGES } from "~/lib/perfumer";
import type { JsonSchema } from "./client";

// The perfumer's input and the model's final answer (#162).

/** The conversation a caller passes: 1–10 messages, the last one from the customer. */
export const perfumerMessagesSchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().trim().min(1).max(PERFUMER_MAX_MESSAGE_LENGTH),
    }),
  )
  .min(1)
  .max(PERFUMER_MAX_MESSAGES)
  .refine((messages) => messages.at(-1)?.role === "user", {
    message: "The last message must be the customer's",
  });

/** The model's final answer, parsed leniently: limits are applied afterwards by the guard. */
export const modelAnswerSchema = z.object({
  intro: z.string().default(""),
  picks: z
    .array(z.object({ id: z.coerce.string(), reason: z.string().default("") }))
    .nullish()
    .transform((picks) => picks ?? []),
  question: z
    .string()
    .nullish()
    .transform((question) => question ?? undefined),
});

export type ModelAnswer = z.infer<typeof modelAnswerSchema>;

/**
 * The same answer as a JSON Schema for `response_format`. Every property is required and the
 * question nullable, so providers with strict structured outputs accept it too.
 */
export const MODEL_ANSWER_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    intro: { type: "string" },
    picks: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        properties: { id: { type: "string" }, reason: { type: "string" } },
        required: ["id", "reason"],
        additionalProperties: false,
      },
    },
    question: { type: ["string", "null"] },
  },
  required: ["intro", "picks", "question"],
  additionalProperties: false,
};
