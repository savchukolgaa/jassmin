-- Rolls back 0019_product_description_en.sql. English product pages show the Ukrainian
-- description again (#100).
ALTER TABLE "products" DROP COLUMN "description_en";
