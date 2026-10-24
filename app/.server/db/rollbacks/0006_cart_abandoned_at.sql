-- Rolls back 0006_cart_abandoned_at.sql.
ALTER TABLE "carts" DROP COLUMN "abandoned_at";
