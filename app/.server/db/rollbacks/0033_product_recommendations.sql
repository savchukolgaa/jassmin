-- Rolls back 0033_product_recommendations.sql (#182): the computed recommendations are lost; run
-- `pnpm db:build-recommendations` again after migrating back up.
DROP TABLE "product_recommendations";
