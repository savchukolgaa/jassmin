-- Rolls back 0008_traffic_attribution.sql.
ALTER TABLE "users" DROP COLUMN "first_touch_campaign";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "first_touch_medium";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "first_touch_source";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "traffic_campaign";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "traffic_medium";
