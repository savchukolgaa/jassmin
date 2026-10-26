ALTER TABLE "products" ADD COLUMN "fragrance_families" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "notes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "store_code" varchar(20);--> statement-breakpoint
CREATE INDEX "products_fragrance_families_idx" ON "products" USING gin ("fragrance_families");--> statement-breakpoint
-- Products before #65 have one family: it becomes the whole list, so the check below holds.
UPDATE "products" SET "fragrance_families" = ARRAY["fragrance_family"] WHERE "fragrance_family" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_fragrance_family_primary_check" CHECK ("products"."fragrance_family" is not distinct from "products"."fragrance_families"[1]);