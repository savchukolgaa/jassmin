-- Rolls back 0029_inventory_movements.sql (#130): the inventory ledger and its daily view are lost.
DROP VIEW "inventory_daily";--> statement-breakpoint
DROP TABLE "inventory_movements";--> statement-breakpoint
DROP FUNCTION "inventory_movements_append_only"();
