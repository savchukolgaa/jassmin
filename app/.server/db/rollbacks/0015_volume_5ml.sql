-- Rolls back 0015_volume_5ml.sql. 5 ml sizes are deleted (their cart lines cascade); the 7 ml sizes
-- the migration deleted aren't restored.
DELETE FROM "product_variants" WHERE "volume_ml" = 5;--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_volume_ml_check";--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_volume_ml_check" CHECK ("product_variants"."volume_ml" in (7, 10, 30, 50, 100));
