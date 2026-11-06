ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_type_check";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "arrived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "waybill_number" varchar(20);--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_type_check" CHECK ("order_emails"."type" in ('confirmation', 'gift_card', 'gift_card_recipient', 'shipped', 'arrived', 'cancelled', 'refunded'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_waybill_number_check" CHECK ("orders"."waybill_number" ~ '^[0-9]{14}$');