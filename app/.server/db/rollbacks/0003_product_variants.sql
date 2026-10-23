-- Rolls back 0003_product_variants.sql. Cart lines for several sizes of one product would break
-- the restored unique (cart_id, product_id), so all but the oldest line per product are dropped.
ALTER TABLE "cart_items" DROP CONSTRAINT "cart_items_cart_id_variant_id_unique";--> statement-breakpoint
DELETE FROM "cart_items" a USING "cart_items" b
WHERE a."cart_id" = b."cart_id" AND a."product_id" = b."product_id" AND a."id" > b."id";--> statement-breakpoint
ALTER TABLE "cart_items" DROP COLUMN "variant_id";--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_product_id_unique" UNIQUE("cart_id","product_id");--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "variant_id";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "volume_ml";--> statement-breakpoint
DROP TABLE "product_variants";
