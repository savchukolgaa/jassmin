-- Rolls back 0011_cms_catalog_and_orders.sql.
DROP TABLE "cms_outbox";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_slug_unique";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "active";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "slug";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "completed_at";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "shipped_at";
