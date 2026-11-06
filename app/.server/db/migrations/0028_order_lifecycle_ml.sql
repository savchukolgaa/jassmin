CREATE TABLE "order_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" integer NOT NULL,
	"status" "order_status_type" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "order_status_history_source_check" CHECK ("order_status_history"."source" in ('checkout', 'payment', 'cms', 'job'))
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "discount_allocated" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_status_history_order_id_changed_at_idx" ON "order_status_history" USING btree ("order_id","changed_at");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_discount_allocated_check" CHECK ("order_items"."discount_allocated" >= 0);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancel_reason_check" CHECK ("orders"."cancel_reason" in ('customer_request', 'out_of_stock', 'no_answer', 'payment_failed', 'other'));--> statement-breakpoint
-- Backfill (#128). A returned or unclaimed order came back at its last update at the latest.
UPDATE "orders" SET "returned_at" = "updated_at" WHERE "status" IN ('returned', 'unclaimed');--> statement-breakpoint
-- The discount of older orders, split over all their lines in proportion to the line totals and
-- rounded down to kopiyky, with the rest on the largest line (the rules then in force can't be
-- replayed). The lines of every order add up to its discount_amount.
WITH "lines" AS (
	SELECT
		"oi"."id",
		"o"."discount_amount" AS "discount",
		"oi"."price_at_purchase" * "oi"."quantity" AS "line_total",
		sum("oi"."price_at_purchase" * "oi"."quantity") OVER (PARTITION BY "oi"."order_id") AS "order_total"
	FROM "order_items" "oi"
	JOIN "orders" "o" ON "o"."id" = "oi"."order_id"
	WHERE "o"."discount_amount" > 0
),
"shares" AS (
	SELECT
		"id",
		floor("discount" * "line_total" * 100 / "order_total") / 100 AS "share"
	FROM "lines"
	WHERE "order_total" > 0
)
UPDATE "order_items" SET "discount_allocated" = "s"."share"
FROM "shares" "s"
WHERE "order_items"."id" = "s"."id";--> statement-breakpoint
-- Put the kopiyky the rounding left over on each order's largest line.
WITH "ranked" AS (
	SELECT
		"oi"."id",
		"oi"."order_id",
		row_number() OVER (
			PARTITION BY "oi"."order_id"
			ORDER BY "oi"."price_at_purchase" * "oi"."quantity" DESC, "oi"."id"
		) AS "rank"
	FROM "order_items" "oi"
),
"missing" AS (
	SELECT "o"."id" AS "order_id", "o"."discount_amount" - sum("oi"."discount_allocated") AS "rest"
	FROM "orders" "o"
	JOIN "order_items" "oi" ON "oi"."order_id" = "o"."id"
	WHERE "o"."discount_amount" > 0
	GROUP BY "o"."id", "o"."discount_amount"
)
UPDATE "order_items" SET "discount_allocated" = "order_items"."discount_allocated" + "m"."rest"
FROM "ranked" "r"
JOIN "missing" "m" ON "m"."order_id" = "r"."order_id"
WHERE "order_items"."id" = "r"."id" AND "r"."rank" = 1 AND "m"."rest" <> 0;--> statement-breakpoint
-- The delivery city of each user's latest order (`formatShippingAddress` writes "<city>, <branch>").
UPDATE "users" SET "city" = "latest"."city"
FROM (
	SELECT DISTINCT ON ("user_id")
		"user_id",
		nullif(trim(split_part("shipping_address", ', ', 1)), '') AS "city"
	FROM "orders"
	WHERE "user_id" IS NOT NULL
	ORDER BY "user_id", "created_at" DESC, "id" DESC
) "latest"
WHERE "users"."id" = "latest"."user_id";--> statement-breakpoint
-- One history row per status the order is known to have reached, from its timestamps. Only
-- checkout, the payment callback and Strapi changed statuses before #128, so the source follows
-- from the column; `returned_at` is approximate (the order's last update).
INSERT INTO "order_status_history" ("order_id", "status", "changed_at", "source")
SELECT "order_id", "status"::"order_status_type", "changed_at", "source"
FROM (
	SELECT "id" AS "order_id",
		CASE WHEN "payment_method" = 'gift_card' THEN 'paid' ELSE 'pending' END AS "status",
		"created_at" AS "changed_at", 'checkout' AS "source", 0 AS "step"
	FROM "orders"
	UNION ALL
	-- A cash-on-delivery order is paid when it's completed: a payment, not a `paid` status.
	SELECT "id", 'paid', "paid_at", CASE WHEN "payment_method" = 'card' THEN 'payment' ELSE 'cms' END, 1
	FROM "orders"
	WHERE "paid_at" IS NOT NULL AND "payment_method" <> 'gift_card'
		AND NOT ("payment_method" = 'cod' AND "completed_at" IS NOT NULL AND "paid_at" = "completed_at")
	UNION ALL
	SELECT "id", 'shipped', "shipped_at", 'cms', 2 FROM "orders" WHERE "shipped_at" IS NOT NULL
	UNION ALL
	SELECT "id", 'completed', "completed_at", 'cms', 3 FROM "orders" WHERE "completed_at" IS NOT NULL
	UNION ALL
	SELECT "id", 'cancelled', "cancelled_at", 'cms', 4 FROM "orders" WHERE "cancelled_at" IS NOT NULL
	UNION ALL
	SELECT "id", "status"::text, "returned_at", 'cms', 5 FROM "orders" WHERE "returned_at" IS NOT NULL
) "rows"
ORDER BY "changed_at", "order_id", "step";
