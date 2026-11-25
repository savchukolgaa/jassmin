-- Rolls back 0038_tester_followup_email.sql (#191): the queued and sent tester follow-ups are lost.
-- Their `tester-followup-*` discounts stay (orders may reference them) and expire on their own.
DELETE FROM "order_emails" WHERE "type" = 'tester_followup';--> statement-breakpoint
ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_type_check";--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_type_check" CHECK ("order_emails"."type" in ('confirmation', 'gift_card', 'gift_card_recipient', 'shipped', 'arrived', 'cancelled', 'refunded', 'cart_reminder'));
