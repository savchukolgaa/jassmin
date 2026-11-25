-- Rolls back 0037_liqpay_provider.sql (#192). Deletes the LiqPay payment attempts (their provider no
-- longer passes the CHECK) and restores the simulator-only list. Orders and gift cards they paid
-- keep their paid state; only the attempt rows go.
DELETE FROM "payments" WHERE "provider" = 'liqpay';--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_provider_check";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_check" CHECK ("payments"."provider" in ('simulator'));
