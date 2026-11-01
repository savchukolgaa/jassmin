-- #87: when a product was last edited, for the sitemap's `lastmod`. Existing rows start at their
-- creation time, so the first sitemap doesn't claim that every product changed today.
ALTER TABLE "products" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "products" SET "updated_at" = "created_at";
