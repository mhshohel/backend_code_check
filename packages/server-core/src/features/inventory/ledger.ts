import type { Tx } from '../../db/db';

export const MOVEMENT_KINDS = ['RECEIPT', 'RESERVE', 'RELEASE', 'SHIP', 'RETURN_RESTOCK', 'ADJUSTMENT'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

// RESERVE/RELEASE reference the order, SHIP the shipment, RETURN_RESTOCK the return.
export type ReferenceType = 'order' | 'shipment' | 'return';

export type StockChange = {
  skuId: string;
  warehouseId: string;
  kind: MovementKind;
  onHandDelta: number;
  reservedDelta: number;
  referenceType?: ReferenceType | null;
  referenceId?: string | null;
  reason?: string | null;
  actorUserId?: string | null;
};

export type LockedBalance = { skuId: string; warehouseId: string; onHand: number; reserved: number };

export class StockInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockInvariantError';
  }
}

/**
 * Locks balance rows in the global order (sku_id, warehouse_id). Every
 * writer uses this order, so two transactions touching the same SKUs wait
 * for each other instead of deadlocking.
 */
export async function lockBalancesForSkus(tx: Tx, skuIds: readonly string[]): Promise<LockedBalance[]> {
  const result = await tx.query<LockedBalance>(
    `SELECT sku_id AS "skuId", warehouse_id AS "warehouseId", on_hand AS "onHand", reserved
     FROM inventory_balances WHERE sku_id = ANY($1::uuid[])
     ORDER BY sku_id, warehouse_id FOR UPDATE`,
    [[...new Set(skuIds)]],
  );
  return result.rows;
}

export async function lockBalance(tx: Tx, skuId: string, warehouseId: string): Promise<LockedBalance | null> {
  const result = await tx.query<LockedBalance>(
    `SELECT sku_id AS "skuId", warehouse_id AS "warehouseId", on_hand AS "onHand", reserved
     FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2 FOR UPDATE`,
    [skuId, warehouseId],
  );
  return result.rows[0] ?? null;
}

export type InsertedMovement = { id: string; skuId: string; warehouseId: string; kind: MovementKind };

/**
 * Applies stock changes: one ledger row per change and one balance update
 * per (sku, warehouse), in the caller's transaction. The balance update is
 * conditional (defense in depth on top of the row locks and CHECK
 * constraints): if any row would break an invariant, nothing is applied.
 */
export async function applyStockChanges(tx: Tx, changes: readonly StockChange[]): Promise<InsertedMovement[]> {
  if (changes.length === 0) return [];
  const sorted = [...changes].sort(compareBalanceKey);
  const totals = sumByBalanceKey(sorted);

  const updated = await tx.query<{ sku_id: string }>(
    `UPDATE inventory_balances b
     SET on_hand = b.on_hand + d.on_hand_delta,
         reserved = b.reserved + d.reserved_delta,
         version = b.version + 1,
         updated_at = now()
     FROM unnest($1::uuid[], $2::uuid[], $3::int[], $4::int[]) AS d(sku_id, warehouse_id, on_hand_delta, reserved_delta)
     WHERE b.sku_id = d.sku_id AND b.warehouse_id = d.warehouse_id
       AND b.on_hand + d.on_hand_delta >= 0
       AND b.reserved + d.reserved_delta >= 0
       AND b.reserved + d.reserved_delta <= b.on_hand + d.on_hand_delta
     RETURNING b.sku_id`,
    [
      totals.map((t) => t.skuId),
      totals.map((t) => t.warehouseId),
      totals.map((t) => t.onHandDelta),
      totals.map((t) => t.reservedDelta),
    ],
  );
  if (updated.rowCount !== totals.length) {
    throw new StockInvariantError('A stock change would break an inventory invariant; the transaction was rolled back.');
  }

  const inserted = await tx.query<InsertedMovement>(
    `INSERT INTO inventory_movements
       (sku_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, actor_user_id)
     SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::int[], $5::int[], $6::text[], $7::uuid[], $8::text[], $9::uuid[])
     RETURNING id::text AS id, sku_id AS "skuId", warehouse_id AS "warehouseId", kind`,
    [
      sorted.map((c) => c.skuId),
      sorted.map((c) => c.warehouseId),
      sorted.map((c) => c.kind),
      sorted.map((c) => c.onHandDelta),
      sorted.map((c) => c.reservedDelta),
      sorted.map((c) => c.referenceType ?? null),
      sorted.map((c) => c.referenceId ?? null),
      sorted.map((c) => c.reason ?? null),
      sorted.map((c) => c.actorUserId ?? null),
    ],
  );
  return inserted.rows;
}

export function compareBalanceKey(a: { skuId: string; warehouseId: string }, b: { skuId: string; warehouseId: string }): number {
  // Lowercase canonical UUID text sorts like PostgreSQL's uuid ordering.
  if (a.skuId !== b.skuId) return a.skuId < b.skuId ? -1 : 1;
  if (a.warehouseId !== b.warehouseId) return a.warehouseId < b.warehouseId ? -1 : 1;
  return 0;
}

export function sumByBalanceKey(
  changes: readonly Pick<StockChange, 'skuId' | 'warehouseId' | 'onHandDelta' | 'reservedDelta'>[],
): { skuId: string; warehouseId: string; onHandDelta: number; reservedDelta: number }[] {
  const totals = new Map<string, { skuId: string; warehouseId: string; onHandDelta: number; reservedDelta: number }>();
  for (const change of changes) {
    const key = `${change.skuId}|${change.warehouseId}`;
    const total = totals.get(key) ?? { skuId: change.skuId, warehouseId: change.warehouseId, onHandDelta: 0, reservedDelta: 0 };
    total.onHandDelta += change.onHandDelta;
    total.reservedDelta += change.reservedDelta;
    totals.set(key, total);
  }
  return [...totals.values()].sort(compareBalanceKey);
}
