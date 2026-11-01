-- Rolls back 0018_product_image_meta.sql. The images fall back to a plain `src` (#88).
ALTER TABLE "products" DROP COLUMN "image_formats";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "image_height";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "image_width";
