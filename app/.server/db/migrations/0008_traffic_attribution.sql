ALTER TABLE "sessions" ADD COLUMN "traffic_medium" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "traffic_campaign" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_touch_source" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_touch_medium" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_touch_campaign" text;