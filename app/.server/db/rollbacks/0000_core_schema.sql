-- Rolls back 0000_core_schema.sql.
DROP TABLE "products";--> statement-breakpoint
DROP TABLE "users";--> statement-breakpoint
DROP TYPE "public"."payment_status_type";--> statement-breakpoint
DROP TYPE "public"."order_status_type";--> statement-breakpoint
DROP TYPE "public"."gender_type";--> statement-breakpoint
DROP TYPE "public"."cart_status_type";
