ALTER TABLE "carts" ADD COLUMN "abandoned_at" timestamp with time zone;--> statement-breakpoint
-- Carts abandoned before this column existed: the best guess is their last activity.
UPDATE "carts" SET "abandoned_at" = "updated_at" WHERE "status" = 'abandoned';
