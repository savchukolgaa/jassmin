ALTER TABLE "products" ADD COLUMN "popular_rank" integer;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_popular_rank_check" CHECK ("products"."popular_rank" > 0);