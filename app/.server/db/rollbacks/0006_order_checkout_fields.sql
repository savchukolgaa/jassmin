-- Rolls back 0006_order_checkout_fields.sql.
DROP INDEX "orders_cart_id_unique";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_cart_id_carts_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "free_shipping";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "cart_id";
