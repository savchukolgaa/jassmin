-- Rolls back 0023_gift_cards.sql (#125). Restoring the old NOT NULLs and checks fails on purpose
-- once gift cards were bought or used (gift card payments and emails have no order, and fully
-- covered orders are `gift_card`): roll back only a database where they never were.
ALTER TABLE "payments" DROP CONSTRAINT "payments_target_check";--> statement-breakpoint
DROP INDEX "payments_gift_card_id_idx";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "gift_card_id";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "order_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_target_check";--> statement-breakpoint
ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_gift_card_id_type_unique";--> statement-breakpoint
ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_type_check";--> statement-breakpoint
ALTER TABLE "order_emails" DROP COLUMN "gift_card_id";--> statement-breakpoint
ALTER TABLE "order_emails" ALTER COLUMN "order_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_type_check" CHECK ("order_emails"."type" in ('confirmation'));--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_gift_card_payment_check";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_payment_method_check";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_amounts_check";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "gift_card_amount";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_method_check" CHECK ("orders"."payment_method" in ('card', 'cod'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check" CHECK ("orders"."subtotal" >= 0 and "orders"."discount_amount" >= 0 and "orders"."shipping_amount" >= 0 and "orders"."total_amount" >= 0);--> statement-breakpoint
ALTER TABLE "carts" DROP COLUMN "gift_card_id";--> statement-breakpoint
ALTER TABLE "cms_outbox" DROP CONSTRAINT "cms_outbox_entity_check";--> statement-breakpoint
ALTER TABLE "cms_outbox" ADD CONSTRAINT "cms_outbox_entity_check" CHECK ("cms_outbox"."entity" in ('order', 'product'));--> statement-breakpoint
DROP TABLE "gift_card_redemptions";--> statement-breakpoint
DROP TABLE "gift_cards";
