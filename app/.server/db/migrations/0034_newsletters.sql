CREATE TABLE "newsletter_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"newsletter_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"locale" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletter_deliveries_newsletter_id_user_id_unique" UNIQUE("newsletter_id","user_id"),
	CONSTRAINT "newsletter_deliveries_locale_check" CHECK ("newsletter_deliveries"."locale" in ('uk', 'en')),
	CONSTRAINT "newsletter_deliveries_status_check" CHECK ("newsletter_deliveries"."status" in ('queued', 'sent', 'failed', 'skipped')),
	CONSTRAINT "newsletter_deliveries_attempts_check" CHECK ("newsletter_deliveries"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "newsletters" (
	"id" serial PRIMARY KEY NOT NULL,
	"strapi_document_id" text NOT NULL,
	"slug" text NOT NULL,
	"subject_uk" text NOT NULL,
	"preheader_uk" text,
	"body_uk" text NOT NULL,
	"subject_en" text,
	"preheader_en" text,
	"body_en" text,
	"product_public_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'sending' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "newsletters_strapi_document_id_unique" UNIQUE("strapi_document_id"),
	CONSTRAINT "newsletters_slug_unique" UNIQUE("slug"),
	CONSTRAINT "newsletters_status_check" CHECK ("newsletters"."status" in ('sending', 'sent')),
	CONSTRAINT "newsletters_en_check" CHECK (("newsletters"."subject_en" is null) = ("newsletters"."body_en" is null) and ("newsletters"."preheader_en" is null or "newsletters"."body_en" is not null)),
	CONSTRAINT "newsletters_products_check" CHECK (cardinality("newsletters"."product_public_ids") <= 4)
);
--> statement-breakpoint
ALTER TABLE "cms_outbox" DROP CONSTRAINT "cms_outbox_entity_check";--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_deliveries_newsletter_id_newsletters_id_fk" FOREIGN KEY ("newsletter_id") REFERENCES "public"."newsletters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_deliveries" ADD CONSTRAINT "newsletter_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_deliveries_status_next_attempt_at_idx" ON "newsletter_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "newsletter_deliveries_sent_at_idx" ON "newsletter_deliveries" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "newsletters_sent_at_idx" ON "newsletters" USING btree ("sent_at");--> statement-breakpoint
ALTER TABLE "cms_outbox" ADD CONSTRAINT "cms_outbox_entity_check" CHECK ("cms_outbox"."entity" in ('order', 'product', 'gift_card', 'newsletter'));