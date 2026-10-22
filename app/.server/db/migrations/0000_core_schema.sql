CREATE TYPE "public"."cart_status_type" AS ENUM('active', 'converted', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."gender_type" AS ENUM('women', 'men', 'unisex');--> statement-breakpoint
CREATE TYPE "public"."order_status_type" AS ENUM('pending', 'paid', 'shipped', 'completed', 'cancelled', 'returned', 'unclaimed');--> statement-breakpoint
CREATE TYPE "public"."payment_status_type" AS ENUM('unpaid', 'paid', 'refunded');--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"public_id" uuid DEFAULT uuidv7() NOT NULL,
	"title" varchar(255) NOT NULL,
	"brand" varchar(255) NOT NULL,
	"gender" "gender_type" NOT NULL,
	"fragrance_family" text,
	"description" text,
	"price" numeric(10, 2) NOT NULL,
	"volume_ml" integer NOT NULL,
	"pack_size" integer DEFAULT 1 NOT NULL,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "products_stock_quantity_check" CHECK ("products"."stock_quantity" >= 0),
	CONSTRAINT "products_pack_size_check" CHECK ("products"."pack_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"full_name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"phone" varchar(50),
	"acquisition_channel" text DEFAULT 'direct' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "products_gender_idx" ON "products" USING btree ("gender");