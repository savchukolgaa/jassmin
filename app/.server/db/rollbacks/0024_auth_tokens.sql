-- Rolls back 0024_auth_tokens.sql (#135): every outstanding reset and verification link stops
-- working, and the verification state and password change times are lost.
DROP TABLE "auth_tokens";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "password_changed_at";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "email_verified_at";
