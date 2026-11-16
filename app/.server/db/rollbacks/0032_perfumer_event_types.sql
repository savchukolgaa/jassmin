-- Rolls back 0032_perfumer_event_types.sql (#166). Deletes the AI perfumer events (their types no
-- longer pass the CHECK) and restores the old type list.
DELETE FROM "user_events" WHERE "event_type" IN ('perfumer_message', 'perfumer_feedback');--> statement-breakpoint
ALTER TABLE "user_events" DROP CONSTRAINT "user_events_event_type_check";--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_event_type_check" CHECK ("user_events"."event_type" in ('page_view', 'product_view', 'search', 'add_to_cart', 'remove_from_cart', 'checkout_start', 'purchase', 'login', 'review_submit', 'product_impression', 'product_click', 'product_dwell'));
