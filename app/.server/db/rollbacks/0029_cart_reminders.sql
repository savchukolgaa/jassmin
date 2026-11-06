-- Rolls back 0029_cart_reminders.sql (#139): the queued and sent cart reminders, the reminder and
-- restore times and the users' languages are lost.
DELETE FROM "order_emails" WHERE "cart_id" IS NOT NULL OR "type" = 'cart_reminder';--> statement-breakpoint
ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_type_check";--> statement-breakpoint
ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_target_check";--> statement-breakpoint
ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_cart_id_type_unique";--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_locale_check";--> statement-breakpoint
DROP INDEX "carts_user_id_reminder_sent_at_idx";--> statement-breakpoint
ALTER TABLE "order_emails" DROP COLUMN "cart_id";--> statement-breakpoint
ALTER TABLE "carts" DROP COLUMN "restored_at";--> statement-breakpoint
ALTER TABLE "carts" DROP COLUMN "reminder_sent_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "locale";--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_type_check" CHECK ("order_emails"."type" in ('confirmation', 'gift_card', 'gift_card_recipient', 'shipped', 'arrived', 'cancelled', 'refunded'));--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_target_check" CHECK (("order_emails"."order_id" is null) <> ("order_emails"."gift_card_id" is null));
