CREATE TABLE "order_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"type" text NOT NULL,
	"locale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_emails_order_id_type_unique" UNIQUE("order_id","type"),
	CONSTRAINT "order_emails_type_check" CHECK ("order_emails"."type" in ('confirmation')),
	CONSTRAINT "order_emails_locale_check" CHECK ("order_emails"."locale" in ('uk', 'en')),
	CONSTRAINT "order_emails_status_check" CHECK ("order_emails"."status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "order_emails_attempts_check" CHECK ("order_emails"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_emails_status_next_attempt_at_idx" ON "order_emails" USING btree ("status","next_attempt_at");