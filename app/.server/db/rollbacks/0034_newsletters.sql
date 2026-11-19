-- Rolls back 0034_newsletters.sql (#181): every sent newsletter and its deliveries are lost, and
-- their queued pushes to Strapi are dropped.
DELETE FROM "cms_outbox" WHERE "entity" = 'newsletter';--> statement-breakpoint
ALTER TABLE "cms_outbox" DROP CONSTRAINT "cms_outbox_entity_check";--> statement-breakpoint
DROP TABLE "newsletter_deliveries";--> statement-breakpoint
DROP TABLE "newsletters";--> statement-breakpoint
ALTER TABLE "cms_outbox" ADD CONSTRAINT "cms_outbox_entity_check" CHECK ("cms_outbox"."entity" in ('order', 'product', 'gift_card'));
