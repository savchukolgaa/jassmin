-- #66: the shop sells 5, 10, 30, 50 and 100 ml; 7 ml goes away. Products with a 7 ml size are queued
-- for Strapi (like `enqueueCmsSync`), so the next `pnpm db:sync-cms` removes the size there too.
INSERT INTO "cms_outbox" ("entity", "entity_id")
SELECT DISTINCT 'product', "product_id" FROM "product_variants" WHERE "volume_ml" = 7
ON CONFLICT ("entity", "entity_id") DO UPDATE SET "version" = "cms_outbox"."version" + 1, "attempts" = 0, "next_attempt_at" = now(), "last_error" = NULL, "synced_at" = NULL, "updated_at" = now();--> statement-breakpoint
-- Cart lines on these sizes cascade; order lines keep their `volume_ml` snapshot (`variant_id` is set null).
DELETE FROM "product_variants" WHERE "volume_ml" = 7;--> statement-breakpoint
-- The deprecated product columns follow the smallest remaining size, as `productWrite` does.
UPDATE "products" SET "price" = v."price", "volume_ml" = v."volume_ml", "stock_quantity" = v."stock_quantity"
FROM (
  SELECT DISTINCT ON ("product_id") "product_id", "price", "volume_ml", "stock_quantity"
  FROM "product_variants" ORDER BY "product_id", "volume_ml"
) v
WHERE v."product_id" = "products"."id" AND "products"."volume_ml" = 7;--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_volume_ml_check";--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_volume_ml_check" CHECK ("product_variants"."volume_ml" in (5, 10, 30, 50, 100));
