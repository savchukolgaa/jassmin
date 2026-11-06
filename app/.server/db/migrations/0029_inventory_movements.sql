CREATE TABLE "inventory_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"variant_id" integer NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"quantity_delta" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"order_id" integer,
	"source" text NOT NULL,
	"note" text,
	CONSTRAINT "inventory_movements_reason_check" CHECK ("inventory_movements"."reason" in ('opening_balance', 'sale', 'cancellation', 'return', 'receipt', 'adjustment')),
	CONSTRAINT "inventory_movements_source_check" CHECK ("inventory_movements"."source" in ('checkout', 'cms', 'job', 'migration')),
	CONSTRAINT "inventory_movements_quantity_delta_check" CHECK ("inventory_movements"."quantity_delta" <> 0),
	CONSTRAINT "inventory_movements_stock_after_check" CHECK ("inventory_movements"."stock_after" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_variant_id_occurred_at_idx" ON "inventory_movements" USING btree ("variant_id","occurred_at");--> statement-breakpoint
-- The ledger is append-only (#130): no updates or deletes, except the order FK nulling
-- `order_id` when an order is deleted.
CREATE FUNCTION "inventory_movements_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.order_id IS NOT NULL
    AND NEW.order_id IS NULL
    AND (NEW.id, NEW.variant_id, NEW.occurred_at, NEW.reason, NEW.quantity_delta, NEW.stock_after, NEW.source, NEW.note)
      IS NOT DISTINCT FROM
      (OLD.id, OLD.variant_id, OLD.occurred_at, OLD.reason, OLD.quantity_delta, OLD.stock_after, OLD.source, OLD.note)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'inventory_movements is append-only (% refused)', TG_OP;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "inventory_movements_append_only"
  BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION "inventory_movements_append_only"();--> statement-breakpoint
-- One row per currently tracked size and day (Europe/Kyiv), from its first movement to today
-- (#130). Rows of one size are written under its row lock, so their id order is the stock order.
CREATE VIEW "inventory_daily" AS
WITH movements AS (
  SELECT m.id, m.variant_id, m.reason, m.quantity_delta, m.stock_after,
    (m.occurred_at AT TIME ZONE 'Europe/Kyiv')::date AS day
  FROM "inventory_movements" m
  JOIN "product_variants" v ON v.id = m.variant_id AND v.track_stock
),
per_day AS (
  SELECT variant_id, day,
    coalesce(-sum(quantity_delta) FILTER (WHERE reason = 'sale'), 0)::integer AS units_sold,
    bool_or(stock_after = 0) AS hit_zero,
    (array_agg(stock_after ORDER BY id DESC))[1] AS closing
  FROM movements
  GROUP BY variant_id, day
),
days AS (
  SELECT variant_id,
    generate_series(
      min(day)::timestamp,
      greatest(max(day), (now() AT TIME ZONE 'Europe/Kyiv')::date)::timestamp,
      interval '1 day'
    )::date AS day
  FROM per_day
  GROUP BY variant_id
),
filled AS (
  SELECT d.variant_id, d.day,
    coalesce(p.units_sold, 0) AS units_sold,
    coalesce(p.hit_zero, false) AS hit_zero,
    p.closing,
    count(p.closing) OVER (PARTITION BY d.variant_id ORDER BY d.day) AS grp
  FROM days d
  LEFT JOIN per_day p ON p.variant_id = d.variant_id AND p.day = d.day
),
carried AS (
  SELECT variant_id, day, units_sold, hit_zero,
    first_value(closing) OVER (PARTITION BY variant_id, grp ORDER BY day) AS closing_stock
  FROM filled
)
SELECT variant_id, day, units_sold, closing_stock,
  (hit_zero OR coalesce(lag(closing_stock) OVER (PARTITION BY variant_id ORDER BY day), 1) = 0)
    AS was_out_of_stock
FROM carried;--> statement-breakpoint
-- Existing stock becomes the opening balance of every tracked size (#130).
INSERT INTO "inventory_movements" ("variant_id", "reason", "quantity_delta", "stock_after", "source", "note")
SELECT "id", 'opening_balance', "stock_quantity", "stock_quantity", 'migration', 'Stock when the ledger started (#130)'
FROM "product_variants"
WHERE "track_stock" AND "stock_quantity" > 0
ORDER BY "id";
