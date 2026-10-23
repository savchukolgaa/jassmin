-- Rolls back 0002_analytics_schema.sql.
ALTER TABLE "carts" DROP CONSTRAINT "carts_session_id_sessions_session_id_fk";--> statement-breakpoint
DROP TABLE "user_events";--> statement-breakpoint
DROP TABLE "sessions";
