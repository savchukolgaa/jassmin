-- Rolls back 0013_product_families_notes_code.sql. `fragrance_family` keeps the primary family.
ALTER TABLE "products" DROP CONSTRAINT "products_fragrance_family_primary_check";--> statement-breakpoint
DROP INDEX "products_fragrance_families_idx";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "store_code";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "notes";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "fragrance_families";
