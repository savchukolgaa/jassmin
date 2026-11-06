-- Rolls back 0027_order_status_emails.sql (#138). Deletes the queued order status emails (their
-- types no longer pass the CHECK), restores the old type list and drops the arrival time and the
-- waybill number.
DELETE FROM "order_emails" WHERE "type" IN ('shipped', 'arrived', 'cancelled', 'refunded');--> statement-breakpoint
ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_type_check";--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_type_check" CHECK ("order_emails"."type" in ('confirmation', 'gift_card', 'gift_card_recipient'));--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_waybill_number_check";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "waybill_number";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "arrived_at";
