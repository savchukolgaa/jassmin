CREATE TABLE "product_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT uuidv7() NOT NULL,
	"product_id" integer NOT NULL,
	"volume_ml" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "product_variants_product_id_volume_ml_unique" UNIQUE("product_id","volume_ml"),
	CONSTRAINT "product_variants_volume_ml_check" CHECK ("product_variants"."volume_ml" in (7, 10, 30, 50, 100)),
	CONSTRAINT "product_variants_price_check" CHECK ("product_variants"."price" >= 0),
	CONSTRAINT "product_variants_stock_quantity_check" CHECK ("product_variants"."stock_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cart_items" DROP CONSTRAINT "cart_items_cart_id_product_id_unique";--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_variants_product_id_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
-- Hand-written (#26): one variant per existing product from its legacy volume, price and stock.
-- Products with a volume outside PERFUME_VOLUMES_ML get none; their legacy columns are kept.
INSERT INTO "product_variants" ("product_id", "volume_ml", "price", "stock_quantity")
SELECT "id", "volume_ml", "price", "stock_quantity" FROM "products"
WHERE "volume_ml" IN (7, 10, 30, 50, 100);--> statement-breakpoint
-- Point existing cart and order lines at their product's (only) variant. Cart lines without one
-- can't be bought any more and are dropped; order lines are kept with variant_id = NULL.
ALTER TABLE "cart_items" ADD COLUMN "variant_id" integer;--> statement-breakpoint
UPDATE "cart_items" SET "variant_id" = "product_variants"."id" FROM "product_variants"
WHERE "product_variants"."product_id" = "cart_items"."product_id";--> statement-breakpoint
DELETE FROM "cart_items" WHERE "variant_id" IS NULL;--> statement-breakpoint
ALTER TABLE "cart_items" ALTER COLUMN "variant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "variant_id" integer;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "volume_ml" integer;--> statement-breakpoint
UPDATE "order_items"
SET "variant_id" = "product_variants"."id", "volume_ml" = "product_variants"."volume_ml"
FROM "product_variants"
WHERE "product_variants"."product_id" = "order_items"."product_id";--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_variant_id_unique" UNIQUE("cart_id","variant_id");