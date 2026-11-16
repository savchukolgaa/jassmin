import { z } from "zod";

// The parts of an OpenAI-compatible chat-completions response the perfumer reads (#162). Ollama,
// llama.cpp and hosted providers all answer this shape; anything else is a `bad_response`.

const toolCallSchema = z.object({
  // Some servers leave the id out; the client then makes one up so tool results can refer to it.
  id: z.string().min(1).optional(),
  type: z.literal("function").optional(),
  function: z.object({
    name: z.string().min(1),
    // A JSON string per the spec; a few servers send the object itself.
    arguments: z
      .union([z.string(), z.record(z.string(), z.unknown())])
      .transform((value) => (typeof value === "string" ? value : JSON.stringify(value))),
  }),
});

export const chatCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z.array(toolCallSchema).nullish(),
        }),
      }),
    )
    .min(1),
});

/**
 * One `data:` chunk of a streamed response (`stream: true`, #164): the next piece of the text. The
 * last chunk may have no `delta` content (a finish reason only), and some servers send no choices.
 */
export const chatCompletionChunkSchema = z.object({
  choices: z.array(
    z.object({
      delta: z.object({ content: z.string().nullish() }).nullish(),
    }),
  ),
});
