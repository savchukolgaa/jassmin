ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_type_check";--> statement-breakpoint
ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_target_check";--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "restored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_emails" ADD COLUMN "cart_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carts_user_id_reminder_sent_at_idx" ON "carts" USING btree ("user_id","reminder_sent_at") WHERE "carts"."reminder_sent_at" is not null;--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_cart_id_type_unique" UNIQUE("cart_id","type");--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_type_check" CHECK ("order_emails"."type" in ('confirmation', 'gift_card', 'gift_card_recipient', 'shipped', 'arrived', 'cancelled', 'refunded', 'cart_reminder'));--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_target_check" CHECK (num_nonnulls("order_emails"."order_id", "order_emails"."gift_card_id", "order_emails"."cart_id") = 1);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_locale_check" CHECK ("users"."locale" in ('uk', 'en'));