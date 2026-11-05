CREATE TABLE "email_suppressions" (
	"address" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_reason_check" CHECK ("email_suppressions"."reason" in ('hard_bounce', 'complaint', 'blocked', 'invalid')),
	CONSTRAINT "email_suppressions_address_lowercase_check" CHECK ("email_suppressions"."address" = lower("email_suppressions"."address"))
);
--> statement-breakpoint
ALTER TABLE "order_emails" ADD COLUMN "message_id" text;