// Inventory ledger (#130): one append-only row per change of a tracked size's stock, written in the
// transaction that changed `product_variants.stock_quantity`, with the stock right after it. A
// trigger refuses updates and deletes, so these functions only insert and read. For every tracked
// size the movements add up to its `stock_quantity` (`inventoryBalance`).
import { and, asc, between, eq, inArray, sql } from "drizzle-orm";
import type { InventoryDay, InventoryMovement } from "~/lib/commerce";
import type { InventoryMovementReason, InventoryMovementSource } from "~/lib/enums";
import type { Db } from "../client";
import { inventoryDaily, inventoryMovements } from "../schema";

/** A `Db` or a transaction. */
type Executor = Pick<Db, "select" | "insert">;

export interface NewInventoryMovement {
  variantId: number;
  reason: InventoryMovementReason;
  /** Units added (positive) or taken off (negative); a 0 is skipped, not stored. */
  quantityDelta: number;
  /** The size's stock right after the change. */
  stockAfter: number;
  source: InventoryMovementSource;
  orderId?: number | null;
  /** When it happened; the database's `now()` when left out. */
  occurredAt?: Date;
  note?: string | null;
}

/**
 * Records stock changes. Call it in the transaction that changed the stock, while the size's row
 * is locked, so `stockAfter` and the row order match the real order of changes. Zero deltas are
 * dropped (the table refuses them).
 */
export async function insertInventoryMovements(
  db: Executor,
  movements: readonly NewInventoryMovement[],
): Promise<void> {
  const rows = movements.filter((movement) => movement.quantityDelta !== 0);
  if (rows.length === 0) return;
  await db.insert(inventoryMovements).values(rows);
}

/** The sum of the size's movements: its stock according to the ledger (0 without any). */
export async function inventoryBalance(db: Executor, variantId: number): Promise<number> {
  const [row] = await db
    .select({ balance: sql<number>`coalesce(sum(${inventoryMovements.quantityDelta}), 0)::int` })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.variantId, variantId));
  return row?.balance ?? 0;
}

/** Which of these sizes have ledger rows; those can't be deleted (`on delete restrict`). */
export async function variantsWithMovements(
  db: Executor,
  variantIds: readonly number[],
): Promise<Set<number>> {
  if (variantIds.length === 0) return new Set();
  const rows = await db
    .select({ variantId: inventoryMovements.variantId })
    .from(inventoryMovements)
    .where(inArray(inventoryMovements.variantId, [...variantIds]))
    .groupBy(inventoryMovements.variantId);
  return new Set(rows.map((row) => row.variantId));
}

/** The size's movements, oldest first. */
export function listInventoryMovements(
  db: Executor,
  variantId: number,
): Promise<InventoryMovement[]> {
  return db
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.variantId, variantId))
    .orderBy(asc(inventoryMovements.id));
}

/** The size's days in `inventory_daily` from `from` to `to` (`YYYY-MM-DD`, Europe/Kyiv). */
export function listInventoryDays(
  db: Executor,
  variantId: number,
  from: string,
  to: string,
): Promise<InventoryDay[]> {
  return db
    .select()
    .from(inventoryDaily)
    .where(and(eq(inventoryDaily.variantId, variantId), between(inventoryDaily.day, from, to)))
    .orderBy(asc(inventoryDaily.day));
}
