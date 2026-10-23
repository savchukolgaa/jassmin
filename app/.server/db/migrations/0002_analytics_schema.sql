CREATE TABLE "sessions" (
	"session_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" integer,
	"anonymous_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"landing_page" text,
	"traffic_source" text,
	"device_type" text
);
--> statement-breakpoint
CREATE TABLE "user_events" (
	"event_id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" integer,
	"anonymous_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"product_id" integer,
	"event_properties" jsonb,
	"source" text,
	"medium" text,
	"campaign" text,
	"device_type" text,
	"referrer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_events_event_type_check" CHECK ("user_events"."event_type" in ('page_view', 'product_view', 'search', 'add_to_cart', 'remove_from_cart', 'checkout_start', 'purchase', 'login', 'review_submit'))
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_anonymous_id_idx" ON "sessions" USING btree ("anonymous_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_events_user_id_created_at_idx" ON "user_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "user_events_anonymous_id_idx" ON "user_events" USING btree ("anonymous_id");--> statement-breakpoint
CREATE INDEX "user_events_event_type_created_at_idx" ON "user_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "user_events_session_id_idx" ON "user_events" USING btree ("session_id");--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("session_id") ON DELETE set null ON UPDATE no action;