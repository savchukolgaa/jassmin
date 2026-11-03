-- #98: the tester trio (any three single 10 ml sizes for 499 ₴, up to three sets per order) as the
-- seed defines it, so every database has it, not only seeded ones. A rule that exists is kept as
-- it is, with its redemption count. To change the price later, add a migration that updates
-- `value` where `slug = 'tester-trio'`, and edit the Strapi texts that state it.
INSERT INTO "discounts" ("slug", "kind", "value", "scope_volumes_ml", "scope_pack_size", "min_quantity", "max_sets")
VALUES ('tester-trio', 'fixed_price_set', '499.00', '{10}', 1, 3, 3)
ON CONFLICT ("slug") DO NOTHING;
