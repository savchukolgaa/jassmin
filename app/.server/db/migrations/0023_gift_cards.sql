CREATE TABLE "gift_card_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"gift_card_id" integer NOT NULL,
	"order_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversed_at" timestamp with time zone,
	CONSTRAINT "gift_card_redemptions_gift_card_id_order_id_unique" UNIQUE("gift_card_id","order_id"),
	CONSTRAINT "gift_card_redemptions_amount_check" CHECK ("gift_card_redemptions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(16) NOT NULL,
	"initial_amount" numeric(10, 2) NOT NULL,
	"balance" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'UAH' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"buyer_user_id" integer,
	"buyer_email" varchar(255) NOT NULL,
	"recipient_email" varchar(255),
	"locale" text NOT NULL,
	"payment_id" integer,
	"activated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_code_unique" UNIQUE("code"),
	CONSTRAINT "gift_cards_status_check" CHECK ("gift_cards"."status" in ('pending', 'active', 'used_up', 'expired')),
	CONSTRAINT "gift_cards_locale_check" CHECK ("gift_cards"."locale" in ('uk', 'en')),
	CONSTRAINT "gift_cards_initial_amount_check" CHECK ("gift_cards"."initial_amount" in (500, 1000, 2000)),
	CONSTRAINT "gift_cards_balance_check" CHECK ("gift_cards"."balance" >= 0 and "gift_cards"."balance" <= "gift_cards"."initial_amount"),
	CONSTRAINT "gift_cards_activation_check" CHECK ("gift_cards"."status" = 'pending' or ("gift_cards"."activated_at" is not null and "gift_cards"."expires_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "cms_outbox" DROP CONSTRAINT "cms_outbox_entity_check";--> statement-breakpoint
ALTER TABLE "order_emails" DROP CONSTRAINT "order_emails_type_check";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_payment_method_check";--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_amounts_check";--> statement-breakpoint
ALTER TABLE "order_emails" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "gift_card_id" integer;--> statement-breakpoint
ALTER TABLE "order_emails" ADD COLUMN "gift_card_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gift_card_amount" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "gift_card_id" integer;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_redemptions" ADD CONSTRAINT "gift_card_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_card_redemptions_order_id_idx" ON "gift_card_redemptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "gift_cards_buyer_user_id_idx" ON "gift_cards" USING btree ("buyer_user_id");--> statement-breakpoint
CREATE INDEX "gift_cards_status_expires_at_idx" ON "gift_cards" USING btree ("status","expires_at");--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_gift_card_id_idx" ON "payments" USING btree ("gift_card_id");--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_gift_card_id_type_unique" UNIQUE("gift_card_id","type");--> statement-breakpoint
ALTER TABLE "cms_outbox" ADD CONSTRAINT "cms_outbox_entity_check" CHECK ("cms_outbox"."entity" in ('order', 'product', 'gift_card'));--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_target_check" CHECK (("order_emails"."order_id" is null) <> ("order_emails"."gift_card_id" is null));--> statement-breakpoint
ALTER TABLE "order_emails" ADD CONSTRAINT "order_emails_type_check" CHECK ("order_emails"."type" in ('confirmation', 'gift_card', 'gift_card_recipient'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_gift_card_payment_check" CHECK ("orders"."payment_method" <> 'gift_card' or ("orders"."total_amount" = 0 and "orders"."gift_card_amount" > 0));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_method_check" CHECK ("orders"."payment_method" in ('card', 'cod', 'gift_card'));--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check" CHECK ("orders"."subtotal" >= 0 and "orders"."discount_amount" >= 0 and "orders"."shipping_amount" >= 0 and "orders"."gift_card_amount" >= 0 and "orders"."total_amount" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_target_check" CHECK (("payments"."order_id" is null) <> ("payments"."gift_card_id" is null));