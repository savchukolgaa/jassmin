import { z } from "zod";

// The path after `/uploads/` that the app's Strapi media proxy accepts (#176, `routes/uploads.$.ts`):
// one or more segments of letters, digits, `.`, `_` and `-`, none starting with a dot. That rules out
// `..`, hidden files, empty segments and anything encoded, so the proxy can only ever ask Strapi for
// a file under its own `/uploads/`. Strapi names uploads like `small_photo_3f2a1c9b.jpg`.

const SEGMENT = "[A-Za-z0-9_-][A-Za-z0-9._-]*";

export const uploadPathSchema = z
  .string()
  .max(512)
  .regex(new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`));
