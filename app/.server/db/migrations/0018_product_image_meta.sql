ALTER TABLE "products" ADD COLUMN "image_width" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "image_height" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "image_formats" jsonb;