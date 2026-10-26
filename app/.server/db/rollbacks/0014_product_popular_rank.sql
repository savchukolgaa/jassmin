-- Rolls back 0014_product_popular_rank.sql.
ALTER TABLE "products" DROP CONSTRAINT "products_popular_rank_check";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "popular_rank";
