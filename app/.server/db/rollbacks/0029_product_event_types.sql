-- Rolls back 0029_product_event_types.sql (#129). Deletes the product list events (their types no
-- longer pass the CHECK) and restores the old type list.
DELETE FROM "user_events" WHERE "event_type" IN ('product_impression', 'product_click', 'product_dwell');--> statement-breakpoint
ALTER TABLE "user_events" DROP CONSTRAINT "user_events_event_type_check";--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_event_type_check" CHECK ("user_events"."event_type" in ('page_view', 'product_view', 'search', 'add_to_cart', 'remove_from_cart', 'checkout_start', 'purchase', 'login', 'review_submit'));
