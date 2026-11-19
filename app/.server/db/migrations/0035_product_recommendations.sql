CREATE TABLE "product_recommendations" (
	"product_id" integer NOT NULL,
	"recommended_product_id" integer NOT NULL,
	"score" double precision NOT NULL,
	"rank" smallint NOT NULL,
	"signals" integer NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "product_recommendations_pkey" PRIMARY KEY("product_id","recommended_product_id"),
	CONSTRAINT "product_recommendations_not_self_check" CHECK ("product_recommendations"."product_id" <> "product_recommendations"."recommended_product_id"),
	CONSTRAINT "product_recommendations_rank_check" CHECK ("product_recommendations"."rank" between 1 and 12),
	CONSTRAINT "product_recommendations_signals_check" CHECK ("product_recommendations"."signals" > 0)
);
--> statement-breakpoint
ALTER TABLE "product_recommendations" ADD CONSTRAINT "product_recommendations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_recommendations" ADD CONSTRAINT "product_recommendations_recommended_product_id_products_id_fk" FOREIGN KEY ("recommended_product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_recommendations_product_id_rank_idx" ON "product_recommendations" USING btree ("product_id","rank");