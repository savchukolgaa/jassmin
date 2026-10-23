-- Rolls back 0005_cart_active_unique.sql.
DROP INDEX "carts_active_guest_session_id_unique";--> statement-breakpoint
DROP INDEX "carts_active_user_id_unique";
