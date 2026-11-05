-- Rolls back 0022_couple_offer.sql. Orders that used the couple offer keep it (`orders.discount_id`
-- restricts deletes), so the rule is only removed while no order references it. While a
-- `percent_every_nth` rule is left, restoring the old checks fails on purpose: roll back only a
-- database where the couple offer was never used (or deal with those rules by hand first).
DELETE FROM "discounts" d
WHERE d."slug" = 'couple-15' AND NOT EXISTS (SELECT 1 FROM "orders" o WHERE o."discount_id" = d."id");--> statement-breakpoint
ALTER TABLE "discounts" DROP CONSTRAINT "discounts_kind_check";--> statement-breakpoint
ALTER TABLE "discounts" DROP CONSTRAINT "discounts_value_check";--> statement-breakpoint
ALTER TABLE "discounts" DROP CONSTRAINT "discounts_min_quantity_check";--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_kind_check" CHECK ("discounts"."kind" in ('percent', 'fixed_amount', 'fixed_price_set'));--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_value_check" CHECK ("discounts"."value" >= 0 and ("discounts"."kind" <> 'percent' or ("discounts"."value" > 0 and "discounts"."value" <= 100)));--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_min_quantity_check" CHECK ("discounts"."min_quantity" >= 1 and ("discounts"."kind" <> 'fixed_price_set' or "discounts"."min_quantity" >= 2));
