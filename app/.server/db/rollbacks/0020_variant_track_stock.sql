-- Rolls back 0020_variant_track_stock.sql. Every size counts its stock again (#98).
ALTER TABLE "product_variants" DROP COLUMN "track_stock";
