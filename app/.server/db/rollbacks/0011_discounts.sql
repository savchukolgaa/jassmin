-- Rolls back 0011_discounts.sql.
DROP INDEX "orders_discount_id_idx";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_discount_id_discounts_id_fk";--> statement-breakpoint
ALTER TABLE "carts" DROP CONSTRAINT "carts_discount_id_discounts_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "discount_id";--> statement-breakpoint
ALTER TABLE "carts" DROP COLUMN "discount_id";--> statement-breakpoint
DROP TABLE "discounts";
