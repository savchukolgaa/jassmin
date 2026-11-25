-- Rolls back 0036_orders_offer_version.sql (#190): the accepted offer versions of orders are lost.
ALTER TABLE "orders" DROP COLUMN "offer_version";
