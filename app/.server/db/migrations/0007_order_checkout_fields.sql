ALTER TABLE "orders" ADD COLUMN "cart_id" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "free_shipping" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_cart_id_unique" ON "orders" USING btree ("cart_id");