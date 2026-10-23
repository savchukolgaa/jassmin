-- Rolls back 0001_commerce_schema.sql. The enums belong to 0000_core_schema.
DROP TABLE "order_items";--> statement-breakpoint
DROP TABLE "orders";--> statement-breakpoint
DROP TABLE "cart_items";--> statement-breakpoint
DROP TABLE "carts";
