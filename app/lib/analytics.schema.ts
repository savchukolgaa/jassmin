// The JSON body the client tracker posts to `/api/events` (#18), as a zod schema. Imported only by route loaders/actions, server code and tests, so zod stays out of the client
// bundle (#96).
import { z } from "zod";
import { CLIENT_EVENT_TYPES, MAX_CLIENT_EVENTS } from "./analytics";

/** A same-site path: starts with one `/` (so not `//host`) and has no backslash. */
const sitePath = z
  .string()
  .max(2048)
  .refine((path) => path.startsWith("/") && !path.startsWith("//") && !path.includes("\\"));

/** The JSON body the client tracker posts to `/api/events`. */
export const clientEventBatchSchema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(CLIENT_EVENT_TYPES),
        path: sitePath,
        referrer: sitePath.optional(),
      }),
    )
    .min(1)
    .max(MAX_CLIENT_EVENTS),
});

export type ClientEventBatch = z.infer<typeof clientEventBatchSchema>;

export type ClientEvent = ClientEventBatch["events"][number];
