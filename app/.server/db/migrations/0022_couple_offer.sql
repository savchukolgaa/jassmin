-- #124: the couple offer. A new rule kind, `percent_every_nth` (a percent off every n-th
-- qualifying unit, dearest first), and the shop's `couple-15` rule: 15% off the cheaper of each
-- pair of single 30/50/100 ml bottles. Like the tester trio (0021) the rule is created in every
-- database, and one that exists is kept as it is. To change the percent later, add a migration
-- that updates `value` where `slug = 'couple-15'`, and edit `checkout.discountCouple` and the
-- Strapi couple-offer texts.
ALTER TABLE "discounts" DROP CONSTRAINT "discounts_kind_check";--> statement-breakpoint
ALTER TABLE "discounts" DROP CONSTRAINT "discounts_value_check";--> statement-breakpoint
ALTER TABLE "discounts" DROP CONSTRAINT "discounts_min_quantity_check";--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_kind_check" CHECK ("discounts"."kind" in ('percent', 'fixed_amount', 'fixed_price_set', 'percent_every_nth'));--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_value_check" CHECK ("discounts"."value" >= 0 and ("discounts"."kind" not in ('percent', 'percent_every_nth') or ("discounts"."value" > 0 and "discounts"."value" <= 100)));--> statement-breakpoint
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_min_quantity_check" CHECK ("discounts"."min_quantity" >= 1 and ("discounts"."kind" not in ('fixed_price_set', 'percent_every_nth') or "discounts"."min_quantity" >= 2));--> statement-breakpoint
INSERT INTO "discounts" ("slug", "kind", "value", "scope_volumes_ml", "scope_pack_size", "min_quantity")
VALUES ('couple-15', 'percent_every_nth', '15.00', '{30,50,100}', 1, 2)
ON CONFLICT ("slug") DO NOTHING;
