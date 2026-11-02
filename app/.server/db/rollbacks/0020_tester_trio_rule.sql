-- Rolls back 0020_tester_trio_rule.sql. Orders that used the rule keep it (`orders.discount_id`
-- restricts deletes), so it's only removed while no order references it.
DELETE FROM "discounts" d
WHERE d."slug" = 'tester-trio' AND NOT EXISTS (SELECT 1 FROM "orders" o WHERE o."discount_id" = d."id");
