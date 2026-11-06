-- Rolls back 0027_order_lifecycle_ml.sql (#128): the status history, return times, cancel
-- reasons, per-line discounts, cities and marketing opt-ins are lost.
DROP TABLE "order_status_history";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_cancel_reason_check";--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_discount_allocated_check";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "marketing_opt_in";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "cancel_reason";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "returned_at";--> statement-breakpoint
ALTER TABLE "order_items" DROP COLUMN "discount_allocated";
