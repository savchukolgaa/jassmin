CREATE TABLE "cms_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cms_outbox_entity_entity_id_unique" UNIQUE("entity","entity_id"),
	CONSTRAINT "cms_outbox_entity_check" CHECK ("cms_outbox"."entity" in ('order', 'product')),
	CONSTRAINT "cms_outbox_attempts_check" CHECK ("cms_outbox"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "slug" varchar(255);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "cms_outbox_synced_at_next_attempt_at_idx" ON "cms_outbox" USING btree ("synced_at","next_attempt_at");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_slug_unique" UNIQUE("slug");