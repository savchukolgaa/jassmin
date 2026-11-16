import { z } from "zod";

// Arguments of the perfumer's catalog tools (#162). Small models write sloppy arguments (null for
// "not set", a comma-separated string for a list, "female" for women), so the schemas forgive what
// they safely can and reject the rest; the error goes back to the model as the tool's result.

const unset = (value: unknown) => (value === null || value === "" ? undefined : value);

const stringList = (max: number) =>
  z.preprocess(
    (value) => {
      const v = unset(value);
      return typeof v === "string" ? v.split(",") : v;
    },
    z
      .array(z.string().trim().max(60))
      .transform((items) => items.filter(Boolean))
      .pipe(z.array(z.string()).max(max))
      .optional(),
  );

const GENDER_WORDS: Record<string, "women" | "men" | undefined> = {
  women: "women",
  woman: "women",
  female: "women",
  her: "women",
  жіночі: "women",
  жінка: "women",
  жінки: "women",
  men: "men",
  man: "men",
  male: "men",
  him: "men",
  чоловічі: "men",
  чоловік: "men",
  чоловіки: "men",
};

export const searchPerfumesArgsSchema = z.object({
  // "unisex", "any" and the like mean no filter.
  gender: z.preprocess(
    (value) => (typeof value === "string" ? GENDER_WORDS[value.trim().toLowerCase()] : undefined),
    z.enum(["women", "men"]).optional(),
  ),
  families: stringList(6),
  notes: stringList(8),
  max_price_uah: z.preprocess(unset, z.coerce.number().positive().max(100_000).optional()),
  limit: z.preprocess(unset, z.coerce.number().int().min(1).max(8).optional()),
});

export type SearchPerfumesArgs = z.infer<typeof searchPerfumesArgsSchema>;

export const similarToArgsSchema = z.object({
  title: z.string().trim().min(2).max(100),
  gender: searchPerfumesArgsSchema.shape.gender,
  max_price_uah: searchPerfumesArgsSchema.shape.max_price_uah,
  limit: searchPerfumesArgsSchema.shape.limit,
});

export type SimilarToArgs = z.infer<typeof similarToArgsSchema>;
