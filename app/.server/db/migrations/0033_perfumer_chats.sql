CREATE TABLE "perfumer_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"role" text NOT NULL,
	"text" text,
	"reply" jsonb,
	"error_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "perfumer_messages_role_check" CHECK ("perfumer_messages"."role" in ('user', 'perfumer')),
	CONSTRAINT "perfumer_messages_error_key_check" CHECK ("perfumer_messages"."error_key" in ('unavailable', 'timeout', 'rateLimited', 'tooLong', 'cancelled')),
	CONSTRAINT "perfumer_messages_shape_check" CHECK (("perfumer_messages"."role" = 'user' and "perfumer_messages"."text" is not null and "perfumer_messages"."reply" is null and "perfumer_messages"."error_key" is null)
        or ("perfumer_messages"."role" = 'perfumer' and num_nonnulls("perfumer_messages"."reply", "perfumer_messages"."error_key") = 1))
);
--> statement-breakpoint
CREATE TABLE "perfumer_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"anonymous_id" text NOT NULL,
	"user_id" integer,
	"entry" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "perfumer_threads_entry_check" CHECK ("perfumer_threads"."entry" in ('menu', 'catalog', 'empty_results', 'product', 'corner', 'direct')),
	CONSTRAINT "perfumer_threads_deleted_closed_check" CHECK ("perfumer_threads"."deleted_at" is null or "perfumer_threads"."closed_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "perfumer_messages" ADD CONSTRAINT "perfumer_messages_thread_id_perfumer_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."perfumer_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "perfumer_threads" ADD CONSTRAINT "perfumer_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "perfumer_messages_thread_id_id_idx" ON "perfumer_messages" USING btree ("thread_id","id");--> statement-breakpoint
CREATE INDEX "perfumer_threads_anonymous_id_closed_at_idx" ON "perfumer_threads" USING btree ("anonymous_id","closed_at");--> statement-breakpoint
CREATE INDEX "perfumer_threads_user_id_closed_at_idx" ON "perfumer_threads" USING btree ("user_id","closed_at");--> statement-breakpoint
CREATE INDEX "perfumer_threads_updated_at_idx" ON "perfumer_threads" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "perfumer_threads_active_user_id_unique" ON "perfumer_threads" USING btree ("user_id") WHERE "perfumer_threads"."closed_at" is null and "perfumer_threads"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "perfumer_threads_active_anonymous_id_unique" ON "perfumer_threads" USING btree ("anonymous_id") WHERE "perfumer_threads"."closed_at" is null and "perfumer_threads"."user_id" is null;