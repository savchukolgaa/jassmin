-- Rolls back 0024_email_suppressions.sql (#134). Drops the suppression list, so suppressed
-- addresses get email again, and the Message-IDs kept for matching bounces.
ALTER TABLE "order_emails" DROP COLUMN "message_id";--> statement-breakpoint
DROP TABLE "email_suppressions";
