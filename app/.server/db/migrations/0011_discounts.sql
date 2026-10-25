CREATE TABLE "discounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"code" varchar(40),
	"kind" text NOT NULL,
	"value" numeric(10, 2) NOT NULL,
	"scope_volumes_ml" integer[],
	"scope_product_public_ids" uuid[],
	"scope_pack_size" integer,
	"min_quantity" integer DEFAULT 1 NOT NULL,
	"max_sets" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"max_redemptions" integer,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_slug_unique" UNIQUE("slug"),
	CONSTRAINT "discounts_kind_check" CHECK ("discounts"."kind" in ('percent', 'fixed_amount', 'fixed_price_set')),
	CONSTRAINT "discounts_value_check" CHECK ("discounts"."value" >= 0 and ("discounts"."kind" <> 'percent' or ("discounts"."value" > 0 and "discounts"."value" <= 100))),
	CONSTRAINT "discounts_min_quantity_check" CHECK ("discounts"."min_quantity" >= 1 and ("discounts"."kind" <> 'fixed_price_set' or "discounts"."min_quantity" >= 2)),
	CONSTRAINT "discounts_max_sets_check" CHECK ("discounts"."max_sets" is null or "discounts"."max_sets" > 0),
	CONSTRAINT "discounts_window_check" CHECK ("discounts"."starts_at" is null or "discounts"."ends_at" is null or "discounts"."ends_at" > "discounts"."starts_at"),
	CONSTRAINT "discounts_redemptions_check" CHECK ("discounts"."redemption_count" >= 0 and ("discounts"."max_redemptions" is null or ("discounts"."max_redemptions" > 0 and "discounts"."redemption_count" <= "discounts"."max_redemptions")))
);
--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "discount_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "discount_id" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "discounts_code_unique" ON "discounts" USING btree (lower("code"));--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_discount_id_idx" ON "orders" USING btree ("discount_id");